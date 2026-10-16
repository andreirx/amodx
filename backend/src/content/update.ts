import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand, TransactWriteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { z } from "zod";
import { AccessPolicySchema } from "@amodx/shared";
import { requireRole } from "../auth/policy.js";
import { checkSlugCommerceConflict } from "../lib/slug-guard.js";
import { revalidateTenantPaths } from "../lib/revalidate.js";
import { normalizeSlug } from "../lib/slug.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// STRICT SCHEMA - No Defaults!
// BACKEND-CONTRACT-1 D2: the five SEO/schema fields accept `null` because GET returns `null` for
// them (the merge below stores `null` when nothing is set) — a GET→PUT round-trip must validate.
// Field semantics in the merge: absent = keep the current value, `null` = clear, string = set.
const StrictUpdateSchema = z.object({
    title: z.string().optional(),
    slug: z.string().optional(),
    status: z.string().optional(),
    commentsMode: z.string().optional(),
    blocks: z.array(z.any()).optional(),
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    seoKeywords: z.string().nullable().optional(),
    featuredImage: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    accessPolicy: AccessPolicySchema.optional(),
    themeOverride: z.any().optional(),
    hideNav: z.boolean().optional(),
    hideFooter: z.boolean().optional(),
    hideSharing: z.boolean().optional(),
    schemaType: z.string().nullable().optional(),
});

const _handler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;
        const nodeId = event.pathParameters?.id;

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id" }) };
        // BACKEND-CONTRACT-1 D1: a forbidden caller is a 403, not a 500 (same shape as create.ts).
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!nodeId || !event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing ID or Body" }) };

        // BACKEND-CONTRACT-1 D1: a malformed body or a schema mismatch is the CLIENT's error → 400.
        // Before D1 both threw inside this `try` and the catch below answered 500.
        let body: unknown;
        try {
            body = JSON.parse(event.body);
        } catch {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
        }

        // 1. Parse using the strict local schema
        // This guarantees 'blocks' is undefined if not sent, never []
        const parsed = StrictUpdateSchema.safeParse(body);
        if (!parsed.success) {
            return { statusCode: 400, body: JSON.stringify({ error: "Validation failed", issues: parsed.error.issues }) };
        }
        const input = parsed.data;

        // 1. Fetch Current State (to snapshot it)
        const currentRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` }
        }));
        const current = currentRes.Item;
        if (!current) return { statusCode: 404, body: "Content not found" };

        // 2. Prepare Snapshot Item (The version we are about to overwrite)
        const currentVersion = current.version || 1;
        const snapshotItem = {
            ...current,
            SK: `CONTENT#${nodeId}#v${currentVersion}`, // Save as v1, v2...
            snapshotCreatedAt: new Date().toISOString() // Metadata for history list
        };

        // 3. Prepare Update Logic
        const oldSlug = current.slug;
        // BACKEND-CONTRACT-1 D3: a slug that DIFFERS from the stored one is normalised (same
        // normaliser as create), so a rename is stored in the form the renderer matches.
        // Absent, or resent unchanged, = keep the stored slug as it is: the admin resends `slug` on
        // every save, and a legacy non-normal slug (e.g. a raw WordPress import) must not be renamed
        // — and its live URL moved — by an unrelated edit.
        const newSlug = input.slug === undefined || input.slug === oldSlug ? oldSlug : normalizeSlug(input.slug);
        const slugChanged = newSlug !== oldSlug;

        // Check slug doesn't conflict with commerce URL prefixes
        if (slugChanged) {
            const conflict = await checkSlugCommerceConflict(tenantId, newSlug);
            if (conflict) {
                return { statusCode: 400, body: JSON.stringify({ error: conflict }) };
            }
        }

        const timestamp = new Date().toISOString();
        const userId = auth.sub;

        // 2. Merge Logic using strict undefined checks
        // If input.blocks is undefined, use current.blocks.
        // D2: the five nullable fields use `keepOrSet` — `??` would read a `null` (clear) as "keep".
        const keepOrSet = (sent: string | null | undefined, stored: unknown) =>
            sent === undefined ? (stored ?? null) : sent;
        const updateValues = {
            ":t": input.title ?? current.title,
            ":b": input.blocks ?? current.blocks,
            ":s": input.status ?? current.status,
            ":cm": input.commentsMode ?? current.commentsMode ?? "Hidden",
            ":ap": input.accessPolicy ?? current.accessPolicy ?? { type: 'Public' },
            ":st": keepOrSet(input.seoTitle, current.seoTitle),
            ":sd": keepOrSet(input.seoDescription, current.seoDescription),
            ":sk": keepOrSet(input.seoKeywords, current.seoKeywords),
            ":fi": keepOrSet(input.featuredImage, current.featuredImage),
            ":tags": input.tags ?? current.tags ?? [],
            ":to": input.themeOverride ?? current.themeOverride ?? {},
            ":hn": input.hideNav ?? current.hideNav ?? false,
            ":hf": input.hideFooter ?? current.hideFooter ?? false,
            ":hs": input.hideSharing ?? current.hideSharing ?? false,
            ":sch": keepOrSet(input.schemaType, current.schemaType),
            ":u": timestamp,
            ":ub": userId,
            ":v": currentVersion + 1 // INCREMENT VERSION
        };

        const updateExprBase = "SET title = :t, blocks = :b, #s = :s, commentsMode = :cm, accessPolicy = :ap, seoTitle = :st, seoDescription = :sd, seoKeywords = :sk, featuredImage = :fi, tags = :tags, hideNav = :hn, hideFooter = :hf, hideSharing = :hs, themeOverride = :to, schemaType = :sch, updatedAt = :u, updatedBy = :ub, version = :v";

        // 4. Transaction: Snapshot + Update (+ Redirects if needed)
        const transactItems: any[] = [
            // A. Save the Snapshot
            {
                Put: {
                    TableName: TABLE_NAME,
                    Item: snapshotItem
                }
            }
        ];

        if (slugChanged) {
            // B. Handle Slug Change (Redirect Old -> New)
            transactItems.push({
                Put: {
                    TableName: TABLE_NAME,
                    Item: {
                        PK: `TENANT#${tenantId}`,
                        SK: `ROUTE#${oldSlug}`,
                        Type: "Route",
                        IsRedirect: true,
                        RedirectTo: newSlug,
                        CreatedAt: timestamp,
                        UpdatedBy: userId
                    }
                }
            });
            transactItems.push({
                Put: {
                    TableName: TABLE_NAME,
                    Item: {
                        PK: `TENANT#${tenantId}`,
                        SK: `ROUTE#${newSlug}`,
                        TargetNode: `NODE#${nodeId}`,
                        Type: "Route",
                        CreatedAt: timestamp,
                        CreatedBy: userId
                    },
                    ConditionExpression: "attribute_not_exists(SK)"
                }
            });
            transactItems.push({
                Update: {
                    TableName: TABLE_NAME,
                    Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` },
                    UpdateExpression: updateExprBase + ", slug = :sl",
                    ExpressionAttributeNames: { "#s": "status" },
                    ExpressionAttributeValues: { ...updateValues, ":sl": newSlug }
                }
            });
        } else {
            // C. Just Update Content
            transactItems.push({
                Update: {
                    TableName: TABLE_NAME,
                    Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` },
                    UpdateExpression: updateExprBase,
                    ExpressionAttributeNames: { "#s": "status" },
                    ExpressionAttributeValues: updateValues
                }
            });
        }

        await db.send(new TransactWriteCommand({ TransactItems: transactItems }));

        // Audit Log
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_PAGE",
            target: { id: nodeId, title: input.title || current.title },
            details: {
                version: currentVersion + 1,
                slugChanged,
                fieldsUpdated: Object.keys(input)
            },
            ip: event.requestContext.http.sourceIp
        });

        // Purge the ISR (Layer 2) entries for this page. cache-2: keyed by the tenant's
        // DOMAIN, which is what middleware rewrites to and therefore what the S3 entry is
        // keyed by — the previous tenantId-keyed purge addressed nothing in production.
        // On a rename both slugs are purged: the new path (fresh content) and the old one
        // (which now serves a redirect).
        await revalidateTenantPaths(tenantId, "page", [newSlug, slugChanged ? oldSlug : undefined]);

        return { statusCode: 200, body: JSON.stringify({ message: "Updated", version: currentVersion + 1, slug: newSlug }) };
    } catch (error: any) {
        console.error(error);
        // BACKEND-CONTRACT-1 D1: mapped as create.ts does — every TransactionCanceledException → 409.
        // The case this mapping is for: the conditional `ROUTE#<newSlug>` Put finds the slug taken
        // (reason ConditionalCheckFailed). The SDK documents other reasons that land here too
        // (TransactionConflict, ProvisionedThroughputExceeded, ThrottlingError, ValidationError,
        // ItemCollectionSizeLimitExceeded); they also answer 409, exactly as in create.ts.
        if (error.name === "TransactionCanceledException") {
            return { statusCode: 409, body: JSON.stringify({ error: "Update cancelled by the database transaction (for example, the new slug is already taken)" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

// cache-4a: ORDINARY class — edge invalidated via the fast lane in `revalidateTenantPaths()`
// (targeted, ~10s). No `withInvalidation()` wrapper.
// CACHE-10: `revalidateTenantPaths()` also arms the bulk `/*` lane (CDN_PENDING) so listings
// refresh ≤ ~16 min (bulk `/*` due ≤15 min after the first pending change — max wait) — the
// "GO LIVE NOW" banner therefore shows after this edit too.
export const handler = _handler;
