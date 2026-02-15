import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "#s = :active",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "CATEGORY#",
                ":active": "active"
            },
            ExpressionAttributeNames: { "#s": "status", "#n": "name" },
            ProjectionExpression: "id, #n, slug, parentId, sortOrder, productCount, imageLink, seoTitle, seoDescription"
        }));

        return {
            statusCode: 200,
            headers: { "Cache-Control": "public, max-age=60" },
            body: JSON.stringify({ items: result.Items || [] })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
