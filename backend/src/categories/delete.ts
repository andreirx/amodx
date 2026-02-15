import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const id = event.pathParameters?.id;
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId || !id) return { statusCode: 400, body: JSON.stringify({ error: "Missing ID" }) };

        // Check if any child categories reference this one
        const children = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "parentId = :pid",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "CATEGORY#",
                ":pid": id
            },
            ProjectionExpression: "id",
            Limit: 1
        }));

        if (children.Items && children.Items.length > 0) {
            return { statusCode: 409, body: JSON.stringify({ error: "Cannot delete: category has child categories. Reassign or delete them first." }) };
        }

        await db.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CATEGORY#${id}` }
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "DELETE_CATEGORY",
            target: { id },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Deleted" }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
