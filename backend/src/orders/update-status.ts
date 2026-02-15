import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const id = event.pathParameters?.id;

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: "Missing order ID" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        const body = JSON.parse(event.body);
        const { status, note } = body;

        if (!status) return { statusCode: 400, body: JSON.stringify({ error: "Status is required" }) };

        const now = new Date().toISOString();

        // Fetch existing order to get current statusHistory
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `ORDER#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: JSON.stringify({ error: "Order not found" }) };

        const previousStatus = existing.Item.status;
        const statusHistory = existing.Item.statusHistory || [];
        statusHistory.push({ status, timestamp: now, note: note || null });

        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `ORDER#${id}` },
            UpdateExpression: "SET #s = :status, statusHistory = :history, updatedAt = :now",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
                ":status": status,
                ":history": statusHistory,
                ":now": now
            }
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_ORDER_STATUS",
            target: { id, title: existing.Item.orderNumber },
            details: { previousStatus, newStatus: status, note },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Order status updated", status }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
