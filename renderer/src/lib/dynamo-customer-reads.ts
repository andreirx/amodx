import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { normalizeEmail } from "@amodx/shared";
import { docClient, requireTableName } from "./dynamo-client";

// 10. Fetch Order for Customer (public - requires email match)
export async function getOrderForCustomer(tenantId: string, orderId: string, email: string) {
    const tableName = requireTableName();

    const result = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `TENANT#${tenantId}`, SK: `ORDER#${orderId}` }
    }));

    if (!result.Item) return null;
    if (result.Item.customerEmail !== normalizeEmail(email)) return null; // stored normalized (orders/create.ts); order-email-1

    const { internalNotes, ...order } = result.Item;
    return order;
}
