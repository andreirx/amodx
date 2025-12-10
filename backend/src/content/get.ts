import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const nodeId = event.pathParameters?.id;

        if (!nodeId) return { statusCode: 400, body: JSON.stringify({ error: "Missing ID" }) };

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `CONTENT#${nodeId}#LATEST`,
            },
        }));

        if (!result.Item) return { statusCode: 404, body: JSON.stringify({ error: "Content not found" }) };

        return { statusCode: 200, body: JSON.stringify(result.Item) };
    } catch (error: any) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
