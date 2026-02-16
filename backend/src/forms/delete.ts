import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const id = event.pathParameters?.id;
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId || !id) return { statusCode: 400, body: JSON.stringify({ error: "Missing ID" }) };

        // Fetch existing form to get its slug for cleanup
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `FORM#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: JSON.stringify({ error: "Form not found" }) };

        const slug = existing.Item.slug;

        // Delete both the FORM# item and the FORMSLUG# pointer atomically
        await db.send(new TransactWriteCommand({
            TransactItems: [
                { Delete: { TableName: TABLE_NAME, Key: {
                    PK: `TENANT#${tenantId}`,
                    SK: `FORM#${id}`,
                } } },
                { Delete: { TableName: TABLE_NAME, Key: {
                    PK: `TENANT#${tenantId}`,
                    SK: `FORMSLUG#${slug}`,
                } } },
            ],
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "DELETE_FORM",
            target: { title: existing.Item.name, id },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Form deleted" }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
