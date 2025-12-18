import { EventBridgeEvent } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js"; // Ensure .js extension
import { PutCommand } from "@aws-sdk/lib-dynamodb";

interface AuditPayload {
    tenantId: string;
    actorId: string;
    action: string;
    details: any;
    ip?: string;
    timestamp: string;
}

export const handler = async (event: EventBridgeEvent<string, AuditPayload>) => {
    console.log("Processing Audit Event:", JSON.stringify(event));

    const { tenantId, actorId, action, details, ip, timestamp } = event.detail;
    const id = crypto.randomUUID();

    try {
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `AUDIT#${timestamp}#${id}`,
                id,
                tenantId,
                actorId,
                action,
                details,
                ip,
                createdAt: timestamp,
                Type: 'AuditLog'
            }
        }));
        console.log("Audit Log Saved");
    } catch (e) {
        console.error("Failed to save audit log", e);
        // In a real prod system, we would send this to a Dead Letter Queue (DLQ)
        throw e;
    }
};
