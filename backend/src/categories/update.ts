import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { CategorySchema, URL_PREFIX_DEFAULTS } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";
import { revalidatePath } from "../lib/revalidate.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const _handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;
        const id = event.pathParameters?.id;

        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId || !id || !event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing Data" }) };

        const body = JSON.parse(event.body);

        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CATEGORY#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: JSON.stringify({ error: "Category not found" }) };

        const input = CategorySchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true, productCount: true
        }).partial().parse(body);

        const merged: Record<string, any> = {
            ...existing.Item,
            ...input,
            updatedAt: new Date().toISOString(),
        };

        // Update GSI attribute if slug changed
        if (input.slug && input.slug !== existing.Item.slug) {
            merged.TenantSlug = `${tenantId}#${input.slug}`;
        }

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: merged
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_CATEGORY",
            target: { title: merged.name, id },
            details: { updatedFields: Object.keys(input).filter(key => input[key as keyof typeof input] !== undefined) },
            ip: event.requestContext.http.sourceIp
        });

        // Cache invalidation: category page
        await revalidatePath(tenantId, `${URL_PREFIX_DEFAULTS.category}/${merged.slug}`);
        // If slug changed, also invalidate old URL
        if (input.slug && input.slug !== existing.Item.slug) {
            await revalidatePath(tenantId, `${URL_PREFIX_DEFAULTS.category}/${existing.Item.slug}`);
        }

        return { statusCode: 200, body: JSON.stringify(merged) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

export const handler = withInvalidation(_handler);
