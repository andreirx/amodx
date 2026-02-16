import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, PutCommand, DeleteCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
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
            Key: { PK: `TENANT#${tenantId}`, SK: `FORM#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: JSON.stringify({ error: "Form not found" }) };

        const oldSlug = existing.Item.slug;
        const newSlug = body.slug ? slugify(body.slug) : oldSlug;
        const slugChanged = newSlug !== oldSlug;

        // If slug changed, check uniqueness of new slug
        if (slugChanged) {
            const slugCheck = await db.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: `FORMSLUG#${newSlug}` },
            }));
            if (slugCheck.Item) return { statusCode: 409, body: JSON.stringify({ error: "A form with this slug already exists" }) };
        }

        const merged: Record<string, any> = {
            ...existing.Item,
            ...body,
            slug: newSlug,
            // Preserve immutable fields
            PK: existing.Item.PK,
            SK: existing.Item.SK,
            id: existing.Item.id,
            tenantId: existing.Item.tenantId,
            createdAt: existing.Item.createdAt,
            updatedAt: new Date().toISOString(),
        };

        if (slugChanged) {
            // Transactional write: update form + delete old slug + create new slug
            await db.send(new TransactWriteCommand({
                TransactItems: [
                    { Put: { TableName: TABLE_NAME, Item: merged } },
                    { Delete: { TableName: TABLE_NAME, Key: {
                        PK: `TENANT#${tenantId}`,
                        SK: `FORMSLUG#${oldSlug}`,
                    } } },
                    { Put: { TableName: TABLE_NAME, Item: {
                        PK: `TENANT#${tenantId}`,
                        SK: `FORMSLUG#${newSlug}`,
                        Type: "FormSlug",
                        formId: id,
                        formName: merged.name,
                    } } },
                ],
            }));
        } else {
            // Simple put — slug unchanged
            await db.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: merged
            }));

            // Also update formName in slug pointer if name changed
            if (body.name && body.name !== existing.Item.name) {
                await db.send(new PutCommand({
                    TableName: TABLE_NAME,
                    Item: {
                        PK: `TENANT#${tenantId}`,
                        SK: `FORMSLUG#${oldSlug}`,
                        Type: "FormSlug",
                        formId: id,
                        formName: body.name,
                    }
                }));
            }
        }

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_FORM",
            target: { title: merged.name, id },
            details: { updatedFields: Object.keys(body) },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify(merged) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
