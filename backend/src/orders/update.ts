import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

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
        const now = new Date().toISOString();

        // Only update fields that are present in the body
        const allowedFields: Record<string, string> = {
            trackingNumber: "trackingNumber",
            internalNotes: "internalNotes",
            paymentStatus: "paymentStatus",
            estimatedDeliveryDate: "estimatedDeliveryDate"
        };

        const expressionParts: string[] = ["#updatedAt = :updatedAt"];
        const expressionNames: Record<string, string> = { "#updatedAt": "updatedAt" };
        const expressionValues: Record<string, unknown> = { ":updatedAt": now };

        let hasUpdates = false;

        for (const [inputKey, dbKey] of Object.entries(allowedFields)) {
            if (body[inputKey] !== undefined) {
                hasUpdates = true;
                const placeholder = `:${inputKey}`;
                const nameToken = `#${inputKey}`;
                expressionParts.push(`${nameToken} = ${placeholder}`);
                expressionNames[nameToken] = dbKey;
                expressionValues[placeholder] = body[inputKey];
            }
        }

        if (!hasUpdates) {
            return { statusCode: 400, body: JSON.stringify({ error: "No valid fields to update" }) };
        }

        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `ORDER#${id}`
            },
            UpdateExpression: `SET ${expressionParts.join(", ")}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            ConditionExpression: "attribute_exists(SK)"
        }));

        return { statusCode: 200, body: JSON.stringify({ message: "Order updated" }) };
    } catch (e: any) {
        if (e.name === "ConditionalCheckFailedException") {
            return { statusCode: 404, body: JSON.stringify({ error: "Order not found" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
