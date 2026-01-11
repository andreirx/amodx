import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const client = new EventBridgeClient({});
const BUS_NAME = process.env.EVENT_BUS_NAME;

export interface AuditParams {
    tenantId: string;
    actor: {
        id: string;
        email?: string;
    };
    action: string;
    target?: {
        id?: string;
        title?: string;
    };
    details?: any;
    ip?: string;
}

export async function publishAudit(params: AuditParams) {
    if (!BUS_NAME) {
        console.warn("EventBus not configured, skipping audit log");
        return;
    }

    try {
        await client.send(new PutEventsCommand({
            Entries: [{
                EventBusName: BUS_NAME,
                Source: 'amodx.system',
                DetailType: 'AUDIT_LOG',
                Detail: JSON.stringify({
                    ...params,
                    timestamp: new Date().toISOString()
                }),
            }]
        }));
    } catch (e) {
        console.error("Failed to publish audit event", e);
    }
}
