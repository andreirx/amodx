import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const email = event.pathParameters?.email
            ? decodeURIComponent(event.pathParameters.email)
            : undefined;

        if (!tenantId || !email || !event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };

        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        const body = JSON.parse(event.body);
        const { notes } = body;

        const result = await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CUSTOMER#${email}` },
            UpdateExpression: "SET notes = :notes, updatedAt = :now",
            ExpressionAttributeValues: {
                ":notes": notes ?? "",
                ":now": new Date().toISOString()
            },
            ConditionExpression: "attribute_exists(PK)",
            ReturnValues: "ALL_NEW"
        }));

        return { statusCode: 200, body: JSON.stringify(result.Attributes) };
    } catch (e: any) {
        if (e.name === "ConditionalCheckFailedException") {
            return { statusCode: 404, body: JSON.stringify({ error: "Customer not found" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
