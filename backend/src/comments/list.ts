import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const pageId = event.queryStringParameters?.pageId;
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };

        // 1. Check Permissions
        let isAdmin = false;
        try {
            // Check if user is staff (Global or Tenant level)
            if (auth.role === 'GLOBAL_ADMIN' || ['TENANT_ADMIN', 'EDITOR'].includes(auth.role || '')) {
                isAdmin = true;
            }
        } catch (e) {}

        // 2. Build Query
        const params: any = {
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": pageId ? `COMMENT#${pageId}#` : `COMMENT#` // <--- Optional PageID
            },
            ScanIndexForward: false // Newest first
        };

        const result = await db.send(new QueryCommand(params));
        const items = result.Items || [];

        // 3. Sanitize
        const sanitized = items
            .filter(c => {
                // Admins see everything. Public sees only Approved.
                if (isAdmin) return true;
                return c.status === 'Approved';
            })
            .map(c => {
                const item: any = {
                    id: c.id,
                    pageId: c.pageId, // Useful for grouping in UI
                    authorName: c.authorName,
                    authorImage: c.authorImage,
                    content: c.content,
                    createdAt: c.createdAt,
                    status: c.status
                };
                // Reveal PII to Admin
                if (isAdmin) {
                    item.authorEmail = c.authorEmail;
                }
                return item;
            });

        return { statusCode: 200, body: JSON.stringify({ items: sanitized }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
