import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
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

        if (!body.name) return { statusCode: 400, body: JSON.stringify({ error: "Name is required" }) };

        const slug = body.slug ? slugify(body.slug) : slugify(body.name);
        if (!slug) return { statusCode: 400, body: JSON.stringify({ error: "Slug is required" }) };

        // Check slug uniqueness
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `FORMSLUG#${slug}` },
        }));
        if (existing.Item) return { statusCode: 409, body: JSON.stringify({ error: "A form with this slug already exists" }) };

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const item = {
            PK: `TENANT#${tenantId}`,
            SK: `FORM#${id}`,
            Type: "Form",
            id,
            tenantId,
            name: body.name,
            slug,
            fields: body.fields || [],
            submitButtonText: body.submitButtonText || "Submit",
            successMessage: body.successMessage || "Thank you for your submission!",
            notifyEmail: body.notifyEmail,
            status: body.status || "active",
            createdAt: now,
            updatedAt: now,
        };

        await db.send(new TransactWriteCommand({
            TransactItems: [
                { Put: { TableName: TABLE_NAME, Item: item } },
                { Put: { TableName: TABLE_NAME, Item: {
                    PK: `TENANT#${tenantId}`,
                    SK: `FORMSLUG#${slug}`,
                    Type: "FormSlug",
                    formId: id,
                    formName: body.name,
                } } },
            ],
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_FORM",
            target: { title: body.name, id },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 201, body: JSON.stringify(item) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
