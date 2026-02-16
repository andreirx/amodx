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

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// Helper: Ensure slug format (lowercase, hyphens, leading slash)
const cleanSlug = (str: string) => {
    const cleaned = str.toLowerCase().trim().replace(/[^a-z0-9-\/]/g, '').replace(/[\s_-]+/g, '-');
    return cleaned.startsWith('/') ? cleaned : '/' + cleaned;
};

export const handler: AmodxHandler = async (event) => {
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
