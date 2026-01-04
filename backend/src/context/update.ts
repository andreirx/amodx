import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import {publishAudit} from "../lib/events";
import {requireRole} from "../auth/policy";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;
        const id = event.pathParameters?.id;

        if (!id || !event.body) return { statusCode: 400, body: "Missing ID or Body" };
        const body = JSON.parse(event.body);

        // 1. FAIL if no tenant ID (No more "DEMO")
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // 2. ENFORCE Policy
        // Editors and Admins can list content
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        // 1. Verify
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTEXT#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: "Context not found" };

        // 2. Update
        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTEXT#${id}` },
            UpdateExpression: "SET #t = :t, blocks = :b, tags = :tags, updatedBy = :u, updatedAt = :now",
            ExpressionAttributeNames: { "#t": "title" },
            ExpressionAttributeValues: {
                ":t": body.title || existing.Item.title,
                ":b": body.blocks || existing.Item.blocks || [],
                ":tags": body.tags || existing.Item.tags || [],
                ":u": auth.sub,
                ":now": new Date().toISOString()
            }
        }));

        // Non-blocking (or awaited, it's fast)
        await publishAudit({
            tenantId,
            actorId: auth.sub,
            action: "UPDATE_CONTEXT",
            details: { title: body.title },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Updated" }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
