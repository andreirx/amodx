import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

// Schema for consent data validation
const ConsentSchema = z.object({
    visitorId: z.string().min(1),
    choice: z.enum(["all", "necessary", "denied"]),
    timestamp: z.number(),
    ip: z.string().optional(),
    userAgent: z.string().optional(),
});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        // 1. Extract tenant ID from headers
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing Tenant Context" })
            };
        }

        // 2. Parse and validate request body
        const body = JSON.parse(event.body || "{}");
        const validatedData = ConsentSchema.parse(body);

        const now = new Date().toISOString();
        const consentId = crypto.randomUUID();

        // 3. Store consent record in DynamoDB
        // PK: TENANT#<id>, SK: CONSENT#<visitorId>#<timestamp>
        // This allows querying all consents for a tenant and for a specific visitor
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `CONSENT#${validatedData.visitorId}#${validatedData.timestamp}`,
                id: consentId,
                tenantId,
                visitorId: validatedData.visitorId,
                choice: validatedData.choice,
                timestamp: validatedData.timestamp,
                ip: validatedData.ip || "unknown",
                userAgent: validatedData.userAgent || "unknown",
                createdAt: now,
                Type: "Consent",
                // Store human-readable timestamp for easy auditing
                consentDate: new Date(validatedData.timestamp).toISOString(),
            }
        }));

        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "Consent recorded",
                consentId,
            })
        };

    } catch (e: any) {
        console.error("Consent Create Error:", e);

        // Handle validation errors
        if (e instanceof z.ZodError) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Invalid consent data",
                    details: e.errors
                })
            };
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ error: e.message })
        };
    }
};
