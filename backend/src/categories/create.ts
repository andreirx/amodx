import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { CategorySchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const slugify = (str: string) => {
    return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-');
};

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing Tenant" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing Body" }) };

        const body = JSON.parse(event.body);

        const input = CategorySchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true, productCount: true
        }).parse(body);

        // Auto-generate slug if not provided
        if (!input.slug) {
            input.slug = slugify(input.name);
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `CATEGORY#${id}`,
                TenantSlug: `${tenantId}#${input.slug}`,
                Type: "Category",
                id,
                tenantId,
                ...input,
                productCount: 0,
                createdAt: now,
                updatedAt: now,
            }
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_CATEGORY",
            target: { title: input.name, id },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 201, body: JSON.stringify({ id, slug: input.slug, message: "Category created" }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
