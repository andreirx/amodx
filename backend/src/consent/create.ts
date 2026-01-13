import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js"; // <--- Added .js
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

const ConsentSchema = z.object({
    visitorId: z.string().min(1),
    choice: z.enum(["all", "necessary", "denied"]),
    timestamp: z.number(),
    ip: z.string().optional(),
    userAgent: z.string().optional(),
});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing Tenant Context" })
            };
        }

        const body = JSON.parse(event.body || "{}");

        // Validate input
        const validationResult = ConsentSchema.safeParse(body);

        if (!validationResult.success) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Validation failed",
                    // FIX: Cast to any to avoid "Property errors does not exist" complaint
                    details: (validationResult as any).error.errors
                })
            };
        }

        const input = validationResult.data;
        const consentId = crypto.randomUUID();

        // Store consent record
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `CONSENT#${input.visitorId}#${input.timestamp}`,
                id: consentId,
                tenantId,
                visitorId: input.visitorId,
                choice: input.choice,
                timestamp: input.timestamp,
                ip: input.ip,
                userAgent: input.userAgent,
                createdAt: new Date().toISOString(),
                Type: "Consent"
            }
        }));

        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "Consent recorded",
                consentId
            })
        };

    } catch (e: any) {
        console.error("Consent handler error:", e);
        // FIX: Robust check for ZodError using name property
        if (e instanceof z.ZodError || e.name === 'ZodError') {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Validation failed",
                    details: (e as any).errors || (e as any).issues
                })
            };
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ error: e.message })
        };
    }
};
