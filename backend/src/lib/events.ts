import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const client = new EventBridgeClient({});
const BUS_NAME = process.env.EVENT_BUS_NAME;

export async function publishAudit(params: {
    tenantId: string;
    actorId: string;
    action: string;
    details?: any;
    ip?: string;
}) {
    if (!BUS_NAME) {
        console.warn("EventBus not configured, skipping audit log");
        return;
    }

    // Fire and forget (Promise is returned but usually we await it in the handler
    // just to ensure the network call sent, it's very fast: ~10ms)
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
