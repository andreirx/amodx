import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = "DEMO"; // Future: Extract from JWT
        const nodeId = event.pathParameters?.id;

        if (!nodeId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing ID" }) };
        }

        // Fetch the "LATEST" version of this Node
        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `SITE#${tenantId}`,
                SK: `CONTENT#${nodeId}#LATEST`,
            },
        }));

        if (!result.Item) {
            return { statusCode: 404, body: JSON.stringify({ error: "Content not found" }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(result.Item),
        };

    } catch (error: any) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
