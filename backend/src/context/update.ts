import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const auth = event.requestContext.authorizer.lambda;
        const id = event.pathParameters?.id;

        if (!id || !event.body) return { statusCode: 400, body: "Missing ID or Body" };
        const body = JSON.parse(event.body);

        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTEXT#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: "Context not found" };

        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTEXT#${id}` },
            UpdateExpression: "SET #n = :n, #d = :d, updatedBy = :u, updatedAt = :t",
            ExpressionAttributeNames: { "#n": "name", "#d": "data" },
            ExpressionAttributeValues: {
                ":n": body.name || existing.Item.name,
                ":d": body.data || existing.Item.data,
                ":u": auth.sub,
                ":t": new Date().toISOString()
            }
        }));

        return { statusCode: 200, body: JSON.stringify({ message: "Updated" }) };

    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
