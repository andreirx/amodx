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

        const formId = event.pathParameters?.id;
        if (!formId) return { statusCode: 400, body: JSON.stringify({ error: "Missing form ID" }) };

        const auth = event.requestContext.authorizer.lambda;
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `FORMSUB#${formId}#`
            },
            ProjectionExpression: "id, formId, formName, #d, submitterEmail, #s, createdAt",
            ExpressionAttributeNames: { "#s": "status", "#d": "data" },
            ScanIndexForward: false
        }));

        // Sort by createdAt descending
        const items = (result.Items || []).sort((a, b) =>
            (b.createdAt || "").localeCompare(a.createdAt || "")
        );

        return { statusCode: 200, body: JSON.stringify({ items }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
