import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "./db";

export async function logAudit(params: {
    tenantId: string;
    actorId: string;
    action: string;
    details?: any;
    ip?: string;
}) {
    // Fire and forget (don't await) to keep API fast?
    // Or await for strict compliance? Let's await for now.
    const id = crypto.randomUUID();

    try {
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${params.tenantId}`,
                SK: `AUDIT#${new Date().toISOString()}#${id}`,
                id,
                ...params,
                timestamp: new Date().toISOString(),
                Type: 'AuditLog'
            }
        }));
    } catch (e) {
        console.error("Failed to write audit log:", e);
        // We generally don't crash the request if audit fails, but we log strictly
    }
}
