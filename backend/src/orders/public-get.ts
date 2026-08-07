import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { normalizeEmail } from "@amodx/shared";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const orderId = event.pathParameters?.id;
        const email = event.queryStringParameters?.email;

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!orderId) return { statusCode: 400, body: JSON.stringify({ error: "Missing order ID" }) };
        if (!email) return { statusCode: 400, body: JSON.stringify({ error: "Email query parameter is required" }) };

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `ORDER#${orderId}` }
        }));

        if (!result.Item) return { statusCode: 404, body: JSON.stringify({ error: "Order not found" }) };

        // Verify email ownership. fnd-2: both sides go through the canonical normalizer so
        // the authorization compare cannot be defeated by — or fail on — an encoding variant
        // (fullwidth/NFKC/whitespace) of the same address.
        if (normalizeEmail(result.Item.customerEmail) !== normalizeEmail(email)) {
            return { statusCode: 404, body: JSON.stringify({ error: "Order not found" }) };
        }

        // Strip internal data before returning
        const { internalNotes, PK, SK, ...orderSummary } = result.Item;

        return {
            statusCode: 200,
            headers: { "Cache-Control": "no-cache" },
            body: JSON.stringify(orderSummary)
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
