import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// GET /content/{id}/versions
export const listVersionsHandler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const nodeId = event.pathParameters?.id;
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId || !nodeId) return { statusCode: 400, body: "Missing ID" };
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        // Query all items starting with CONTENT#<NodeID>#v
        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `CONTENT#${nodeId}#v`
            },
            // Reverse order (newest versions first)
            ScanIndexForward: false
        }));

        // Map to lightweight summary
        const versions = (result.Items || []).map(v => ({
            version: v.version,
            updatedAt: v.updatedAt || v.snapshotCreatedAt || v.createdAt,
            updatedBy: v.updatedBy || v.author,
            title: v.title,
            status: v.status
        }));

        return { statusCode: 200, body: JSON.stringify({ versions }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
