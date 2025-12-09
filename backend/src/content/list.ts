import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        // 1. Get Tenant ID from Header (Client Admin Panel sends this)
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: "Missing x-tenant-id header" };

        const type = event.queryStringParameters?.type || "Content"; // "Content" or "Redirect"

        if (type === "Redirect") {
            // Query for Routes that are Redirects
            // Strategy: Query PK=TENANT#..., SK begins_with ROUTE#
            // Filter where IsRedirect = true
            const result = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues: {
                    ":pk": `TENANT#${tenantId}`,
                    ":sk": "ROUTE#"
                }
            }));

            const redirects = result.Items?.filter(i => i.IsRedirect === true) || [];
            return { statusCode: 200, body: JSON.stringify({ items: redirects }) };
        }

        // Default: List Content
        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "CONTENT#"
            }
        }));

        const items = result.Items?.filter(item => item.SK.includes("#LATEST")) || [];
        return { statusCode: 200, body: JSON.stringify({ items }) };

    } catch (error: any) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
