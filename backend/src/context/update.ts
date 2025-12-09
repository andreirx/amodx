import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'] || "DEMO";
        const id = event.pathParameters?.id;
        if (!id || !event.body) return {statusCode: 400, body: "Missing ID or Body"};
        const body = JSON.parse(event.body);

        // 1. Check existence
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `CONTEXT#${id}`
            }
        }));

        if (!existing.Item) return {statusCode: 404, body: "Context not found"};

        // 2. Update
        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `CONTEXT#${id}`
            },
            UpdateExpression: "SET #n = :n, #d = :d",
            ExpressionAttributeNames: {"#n": "name", "#d": "data"},
            ExpressionAttributeValues: {
                ":n": body.name || existing.Item.name,
                ":d": body.data || existing.Item.data
            }
        }));

        return {statusCode: 200, body: JSON.stringify({message: "Updated"})};

    } catch (error: any) {
        return {statusCode: 500, body: JSON.stringify({error: error.message})};
    }
};
