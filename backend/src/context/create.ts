import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ContextItemSchema } from "@amodx/shared";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const body = JSON.parse(event.body);
        const tenantId = event.headers['x-tenant-id'] || "DEMO";

        // Validate
        const input = ContextItemSchema.omit({ id: true, tenantId: true }).parse(body);
        const id = crypto.randomUUID();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `CONTEXT#${id}`,
                tenantId,
                id,
                ...input
            },
        }));

        return { statusCode: 201, body: JSON.stringify({ id, message: "Context Saved" }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
