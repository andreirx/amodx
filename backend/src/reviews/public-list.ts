import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const productId = event.pathParameters?.productId;
        if (!productId) return { statusCode: 400, body: JSON.stringify({ error: "Missing productId" }) };

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "#s = :approved",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `REVIEW#${productId}#`,
                ":approved": "approved"
            },
            ExpressionAttributeNames: { "#s": "status" },
            ProjectionExpression: "id, authorName, rating, content, source, createdAt"
        }));

        const items = (result.Items || []).sort(
            (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        // Calculate average rating
        const totalReviews = items.length;
        const averageRating = totalReviews > 0
            ? Math.round((items.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / totalReviews) * 10) / 10
            : 0;

        return {
            statusCode: 200,
            headers: { "Cache-Control": "public, max-age=60" },
            body: JSON.stringify({ items, averageRating, totalReviews })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
