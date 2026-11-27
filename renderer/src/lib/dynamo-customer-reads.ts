import { QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
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

// 12. Fetch customer orders by email (CUSTORDER# adjacency)
export async function getCustomerOrders(tenantId: string, email: string) {
    const tableName = requireTableName();

    // Paginate through all results
    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
        const result = await docClient.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": `CUSTORDER#${normalizeEmail(email)}#`,
            },
            // `total` and `status` are DynamoDB reserved words: each needs an alias (PROJECTION-RESERVED-1).
            ProjectionExpression: "orderNumber, #total, #s, createdAt, SK",
            ExpressionAttributeNames: { "#s": "status", "#total": "total" },
            ExclusiveStartKey: lastKey,
        }));
        allItems.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allItems
        .map((item: any) => ({
            orderNumber: item.orderNumber,
            total: item.total,
            status: item.status,
            createdAt: item.createdAt,
            orderId: item.SK.split("#").pop(),
        }))
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// 13. Fetch customer profile by email
export async function getCustomerProfile(tenantId: string, email: string) {
    const tableName = requireTableName();

    const result = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `TENANT#${tenantId}`, SK: `CUSTOMER#${normalizeEmail(email)}` },
        ProjectionExpression: "email, #n, phone, birthday, defaultAddress",
        ExpressionAttributeNames: { "#n": "name" },
    }));
    return result.Item || null;
}
