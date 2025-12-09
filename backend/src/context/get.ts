import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const id = event.pathParameters?.id;

        if (!id) return { statusCode: 400, body: "Missing ID" };

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `CONTEXT#${id}`
            }
        }));

        if (!result.Item) return { statusCode: 404, body: "Context not found" };

        return { statusCode: 200, body: JSON.stringify(result.Item) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
