import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { LeadSchema } from "@amodx/shared";

// NOTE: This endpoint is PUBLIC (or protected by API Key if called by Renderer server-side)
// If public, we need CAPTCHA protection logic here later.

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        // Tenant ID comes from header (Renderer injects it)
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: "Missing Tenant Context" };

        const body = JSON.parse(event.body || "{}");

        // Validate
        const input = LeadSchema.omit({ id: true, tenantId: true, createdAt: true, status: true }).parse(body);

        const id = crypto.randomUUID();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `LEAD#${input.email}`, // Unique by email? Or use UUID to allow dupes?
                // Let's use Email as SK to prevent duplicate spam,
                // but this means they can't submit twice with different data.
                // Better: SK: `LEAD#${id}`, GSI on Email.
                // For simplicity now:
                id,
                tenantId,
                ...input,
                status: "New",
                createdAt: new Date().toISOString(),
                Type: "Lead"
            }
        }));

        return { statusCode: 201, body: JSON.stringify({ message: "Subscribed" }) };

    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
