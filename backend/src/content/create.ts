import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ContentItemSchema } from "@amodx/shared";
import { z } from "zod";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        console.log("Event:", JSON.stringify(event, null, 2));

        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };
        }

        // 1. Parse & Validate Input
        const body = JSON.parse(event.body);

        // For MVP: We assume Tenant is "DEMO". Later we get this from Cognito.
        const tenantId = "DEMO";

        // We expect the frontend to send a partial object, we construct the full record
        const input = ContentItemSchema.omit({
            id: true, createdAt: true, author: true, nodeId: true, version: true
        }).parse(body);

        const nodeId = crypto.randomUUID();
        const contentId = crypto.randomUUID();
        const now = new Date().toISOString();

        // 2. Prepare the Database Item
        const item = {
            PK: `SITE#${tenantId}`,
            SK: `CONTENT#${nodeId}#LATEST`, // Latest pointer
            ...input,
            id: contentId,
            nodeId: nodeId,
            version: 1,
            createdAt: now,
            author: "Admin", // Placeholder
            Type: "Page", // For GSI Indexing
        };

        // 3. Save to DynamoDB
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: item,
        }));

        return {
            statusCode: 201,
            body: JSON.stringify({ message: "Content Created", id: contentId, nodeId: nodeId }),
        };

    } catch (error: any) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || "Internal Server Error" }),
        };
    }
};
