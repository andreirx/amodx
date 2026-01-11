import { EventBridgeEvent } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";

// Match the structure sent by publishAudit
interface AuditEventDetail {
    tenantId: string;
    actor: { id: string; email?: string };
    action: string;
    target?: { id?: string; title?: string };
    details: any;
    ip?: string;
    timestamp: string; // generated in publishAudit
}

export const handler = async (event: EventBridgeEvent<string, AuditEventDetail>) => {
    console.log("Processing Audit Event:", JSON.stringify(event));

    const { tenantId, actor, action, target, details, ip, timestamp } = event.detail;
    const id = crypto.randomUUID();

    try {
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `AUDIT#${timestamp}#${id}`,
                id,
                tenantId,

                // Actor Info
                actorId: actor.id,
                actorEmail: actor.email || "System",

                // Action Info
                action,
                entityId: target?.id,
                entityTitle: target?.title,

                details,
                ip,
                createdAt: timestamp, // Standardization
                Type: 'AuditLog'
            }
        }));
    } catch (e) {
        console.error("Failed to save audit log", e);
        // In a real prod system, we would send this to a Dead Letter Queue (DLQ)
        throw e;
    }
};
