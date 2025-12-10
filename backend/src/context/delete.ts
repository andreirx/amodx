import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const id = event.pathParameters?.id;

        if (!id) return { statusCode: 400, body: "Missing ID" };

        await db.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `CONTEXT#${id}`
            }
        }));

        return { statusCode: 200, body: JSON.stringify({ message: "Deleted" }) };

    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
