import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        // Global Admins might want to see logs for ALL tenants (requires GSI)
        // For now, let's list logs for the specific tenant context
        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };

        const auth = event.requestContext.authorizer.lambda;
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Forbidden";
            return { statusCode: 403, body: JSON.stringify({ error: message }) };
        }

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "AUDIT#"
            },
            ScanIndexForward: false // Newest first
        }));

        return { statusCode: 200, body: JSON.stringify({ items: result.Items || [] }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
