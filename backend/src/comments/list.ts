import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const pageId = event.queryStringParameters?.pageId;

        if (!tenantId || !pageId) return { statusCode: 400, body: "Missing Tenant or Page ID" };

        // Query comments for this specific page
        // Strategy: We need a GSI for this.
        // Let's use the Single Table Pattern efficiently.
        // PK = TENANT#... SK = COMMENT#PageID#Timestamp

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `COMMENT#${pageId}#`
            },
            // Default sort is oldest to newest for comments (usually desired)
        }));

        const items = result.Items || [];

        // Remove emails before sending to public frontend
        const sanitized = items
            .filter(c => c.status === 'Approved')
            .map(c => ({
                id: c.id,
                authorName: c.authorName,
                authorImage: c.authorImage,
                content: c.content,
                createdAt: c.createdAt
            }));

        return { statusCode: 200, body: JSON.stringify({ items: sanitized }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
