import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const auth = event.requestContext.authorizer.lambda;
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "CUSTOMER#"
            },
            ProjectionExpression: "email, #n, phone, orderCount, totalSpent, lastOrderDate, createdAt",
            ExpressionAttributeNames: { "#n": "name" }
        }));

        const items = result.Items || [];

        // Sort by lastOrderDate descending (most recent first)
        items.sort((a, b) => {
            const dateA = a.lastOrderDate ? new Date(a.lastOrderDate).getTime() : 0;
            const dateB = b.lastOrderDate ? new Date(b.lastOrderDate).getTime() : 0;
            return dateB - dateA;
        });

        return { statusCode: 200, body: JSON.stringify({ items }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
