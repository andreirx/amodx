import {
    APIGatewayProxyHandlerV2WithLambdaAuthorizer
} from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { ContentItemSchema, TranslationOfInputSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";
import { reservedAddressRefusal } from "../lib/slug-guard.js";
import { revalidateTenantPaths } from "../lib/revalidate.js";
import { normalizeSlug } from "@amodx/shared";
import { planTranslation, membershipActionsOf, TRANSLATION_CHANGED_ERROR } from "./update.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const _handler: AmodxHandler = async (event) => {
    try {
        const auth = event.requestContext.authorizer.lambda;
        const userId = auth.sub;
        const authorName = auth.email || "Robot";
        const tenantId = event.headers['x-tenant-id'];

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // SECURITY: Editors allowed
        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!event.body) return { statusCode: 400, body: "Missing body" };
        // BACKEND-CONTRACT-1 D1: a malformed body or a schema mismatch is the CLIENT's error → 400.
        // Before D1 both threw inside this `try` and the catch below answered 500.
        let body: unknown;
        try {
            body = JSON.parse(event.body);
        } catch {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
        }

        // 1. Validation
        // We use the shared schema to validate types, but we will construct the Item manually below
        // LANG-1A: `translationKey` is never input (rule C1, omitted → dropped); `translationOf` is input only (§ 5).
        const parsed = ContentItemSchema.omit({
            id: true, createdAt: true, author: true, nodeId: true, version: true, translationKey: true
        }).extend({ translationOf: TranslationOfInputSchema }).safeParse(body);
        if (!parsed.success) {
            return { statusCode: 400, body: JSON.stringify({ error: "Validation failed", issues: parsed.error.issues }) };
        }
        const input = parsed.data;

        const nodeId = crypto.randomUUID();
        const contentId = crypto.randomUUID();
        const now = new Date().toISOString();

        // 2. Slug Logic
        // Prefer provided slug, otherwise derive from title
        const rawSlug = input.slug && input.slug.trim() ? input.slug : input.title;
        const slug = normalizeSlug(rawSlug);

        // 2b. Refuse a slug at a reserved address (a built-in page the renderer serves for this kind of site)
        const conflict = await reservedAddressRefusal(tenantId, slug);
        if (conflict) {
            return { statusCode: 400, body: JSON.stringify({ error: conflict }) };
        }

        // 2c. LANG-1A (§ 6.3): with `translationOf`, the link transaction (rules C2, C3 first). A new page holds no key.
        const planned = await planTranslation({ tenantId, selfNodeId: nodeId, selfSlug: slug, selfKeyRead: undefined, translationOf: input.translationOf });
        if (!planned.ok) return { statusCode: planned.statusCode, body: JSON.stringify({ error: planned.error }) };
        const plan = planned.plan;

        // 3. Construct Item Explicitly (Safety & Clarity)
        const contentItem = {
            PK: `TENANT#${tenantId}`,
            SK: `CONTENT#${nodeId}#LATEST`,
            id: contentId,
            nodeId: nodeId,
            slug: slug,
            title: input.title,

            // Core Logic
            status: input.status,
            blocks: input.blocks,
            commentsMode: input.commentsMode,
            accessPolicy: input.accessPolicy,

            // SEO Metadata
            seoTitle: input.seoTitle,
            seoDescription: input.seoDescription,
            seoKeywords: input.seoKeywords,
            featuredImage: input.featuredImage,

            // Design Overrides (Explicitly Mapped)
            themeOverride: input.themeOverride || {},
            hideNav: input.hideNav || false,
            hideFooter: input.hideFooter || false,
            hideSharing: input.hideSharing || false,
            schemaType: input.schemaType || null,

            // System Metadata
            version: 1,
            createdAt: now,
            updatedAt: now,
            author: userId,
            authorEmail: authorName,
            Type: "Page",
        };

        // 4. Transaction. LANG-1A: the page Put and the membership actions of the plan. Without `translationOf` (and
        // for `null`: a new page is in no set) the plan is `unchanged` and this is today's transaction exactly.
        const contentPut = ((): NonNullable<TransactWriteCommandInput["TransactItems"]>[number] => {
            switch (plan.kind) {
                case "unchanged":
                case "leave":   // not reachable on create (no key was read); listed so the switch stays exhaustive
                    return { Put: { TableName: TABLE_NAME, Item: contentItem } };
                case "join":
                    return { Put: {
                        TableName: TABLE_NAME, Item: { ...contentItem, translationKey: plan.key },
                        ConditionExpression: plan.selfCondition.expression,
                    } };
            }
        })();
        await db.send(new TransactWriteCommand({
            TransactItems: [
                contentPut,
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            PK: `TENANT#${tenantId}`,
                            SK: `ROUTE#${slug}`,
                            TargetNode: `NODE#${nodeId}`,
                            Type: "Route",
                            Domain: "localhost", // Legacy field, can be ignored or updated
                            CreatedAt: now
                        },
                        ConditionExpression: "attribute_not_exists(SK)"
                    }
                },
                ...membershipActionsOf(plan),
            ]
        }));

        await publishAudit({
            tenantId,
            actor: { id: userId, email: authorName }, // Assuming authorName is email here
            action: "CREATE_PAGE",
            target: { title: input.title, id: nodeId },
            details: { slug: slug },
            ip: event.requestContext.http.sourceIp
        });

        // cache-2: a CREATE must purge too, which was not true before cache-1.
        // Since cache-1, a request for a URL that does not exist yet stores a **cacheable
        // 307 → <path>?nf=1** in the S3 ISR cache (the not-found handoff; a redirect is a
        // cacheable render outcome — docs/caching-architecture.md § "Which render outcomes
        // are cacheable"). So a slug that was probed before it was published already has an
        // entry, and without this purge the canonical URL keeps answering that redirect
        // until the debounced CloudFront invalidation and the nightly S3 flush clear it.
        //
        // IAM: this Lambda never revalidated before, so it was the one revalidating handler
        // without `props.revalidationSecret.grantRead(...)`. That grant is added by this same
        // slice (`infra/lib/api.ts`, next to `grantReadWriteData(createContentFunc)`) — the
        // code and its IAM must deploy together or this call logs "[Revalidate] No secret
        // available" and purges nothing. See the cache-2 slice doc, § Migration / deployment.
        await revalidateTenantPaths(tenantId, "page", [slug]);

        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "Page Created",
                id: contentId,
                nodeId: nodeId,
                slug: slug,
                tenantId
            }),
        };

    } catch (error: any) {
        console.error(error);
        // LANG-1A: index 1 is the route Put. A cancellation elsewhere happens only with set actions (the target page
        // or its set changed) → its own text. Without set actions the mapping is today's.
        const translationChanged = Array.isArray(error.CancellationReasons) && error.CancellationReasons.length > 2
            && error.CancellationReasons[1]?.Code !== "ConditionalCheckFailed";
        if (error.name === "TransactionCanceledException" && translationChanged) {
            return { statusCode: 409, body: JSON.stringify({ error: TRANSLATION_CHANGED_ERROR }) };
        }
        if (error.name === "TransactionCanceledException") {
            return { statusCode: 409, body: JSON.stringify({ error: "Page with this title/slug already exists" }) };
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

// cache-4a: ORDINARY class — no `withInvalidation()`. The edge (Layer 1) is invalidated by the
// fast lane inside `revalidateTenantPaths()` (targeted, ~10s). Since CACHE-10 that function also
// arms the bulk `/*` lane (CDN_PENDING) so listings refresh ≤ ~16 min (max wait), which shows the
// "GO LIVE NOW" banner. A brand-new slug can already hold a cacheable 307→?nf=1
// (see the comment above the revalidate call), which the fast lane now clears in seconds.
export const handler = _handler;
