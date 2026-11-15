import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { CategorySchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { purgeStoredPagesOfRequestTenant } from "../lib/revalidate.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const slugify = (str: string) => {
    return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-');
};

const _handler: Handler = async (event) => {
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

        // SMALL-FIXES-1 A: a malformed body or a schema refusal is the CLIENT's error → 400, in the shape of
        // content/create.ts (BACKEND-CONTRACT-1 D1). Before, both threw inside this `try` and the catch answered 500.
        let body: unknown;
        try {
            body = JSON.parse(event.body);
        } catch {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
        }

        const parsed = CategorySchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true, productCount: true
        }).safeParse(body);
        if (!parsed.success) {
            return { statusCode: 400, body: JSON.stringify({ error: "Validation failed", issues: parsed.error.issues }) };
        }
        const input = parsed.data;

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

export const handler = withInvalidation(_handler, purgeStoredPagesOfRequestTenant);
