import {
    APIGatewayProxyHandlerV2WithLambdaAuthorizer
} from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ContentItemSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";
import { checkSlugCommerceConflict } from "../lib/slug-guard.js";
import { revalidateTenantPaths } from "../lib/revalidate.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// Helper: Ensure slug format (lowercase, hyphens, leading slash)
const cleanSlug = (str: string) => {
    const cleaned = str.toLowerCase().trim()
        .replace(/[\s_]+/g, '-')       // spaces & underscores → dashes FIRST
        .replace(/[^a-z0-9-\/]/g, '')  // then strip invalid chars
        .replace(/-+/g, '-')           // collapse multiple dashes
        .replace(/-+$/g, '');          // strip trailing dash
    return cleaned.startsWith('/') ? cleaned : '/' + cleaned;
};

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
        const body = JSON.parse(event.body);

        // 1. Validation
        // We use the shared schema to validate types, but we will construct the Item manually below
        const input = ContentItemSchema.omit({
            id: true, createdAt: true, author: true, nodeId: true, version: true
        }).parse(body);

        const nodeId = crypto.randomUUID();
        const contentId = crypto.randomUUID();
        const now = new Date().toISOString();

        // 2. Slug Logic
        // Prefer provided slug, otherwise derive from title
        const rawSlug = input.slug && input.slug.trim() ? input.slug : input.title;
        const slug = cleanSlug(rawSlug);

        // 2b. Check slug doesn't conflict with commerce URL prefixes
        const conflict = await checkSlugCommerceConflict(tenantId, slug);
        if (conflict) {
            return { statusCode: 400, body: JSON.stringify({ error: conflict }) };
        }

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

        // 4. Transaction
        await db.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: contentItem
                    }
                },
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
                }
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
        if (error.name === "TransactionCanceledException") {
            return { statusCode: 409, body: JSON.stringify({ error: "Page with this title/slug already exists" }) };
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

export const handler = withInvalidation(_handler);
