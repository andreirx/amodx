import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        // Security: Only staff can moderate
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };
        if (!event.body) return { statusCode: 400, body: "Missing Body" };

        const { pageId, createdAt, status, action } = JSON.parse(event.body);

        if (!pageId || !createdAt) return { statusCode: 400, body: "Missing Key Fields (pageId, createdAt)" };

        const key = {
            PK: `TENANT#${tenantId}`,
            SK: `COMMENT#${pageId}#${createdAt}`
        };

        if (action === 'DELETE') {
            await db.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: key
            }));
            return { statusCode: 200, body: JSON.stringify({ message: "Deleted" }) };
        }

        if (action === 'UPDATE_STATUS') {
            await db.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: key,
                UpdateExpression: "SET #s = :s",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: { ":s": status || "Hidden" }
            }));
            return { statusCode: 200, body: JSON.stringify({ message: "Status Updated" }) };
        }

        return { statusCode: 400, body: "Invalid Action" };

    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
