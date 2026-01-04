import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-central-1' });
const db = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

// Helper to simulate API Gateway Event
export const createEvent = (
    tenantId: string,
    body: any = null,
    pathParams: any = null,
    queryParams: any = null,
    userId: string = "test-admin",
    role: string = "GLOBAL_ADMIN",
    email: string = "admin@agency.com"
): any => {
    return {
        headers: {
            "x-tenant-id": tenantId,
            "content-type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined,
        pathParameters: pathParams,
        queryStringParameters: queryParams,
        requestContext: {
            http: { sourceIp: "127.0.0.1" },
            authorizer: {
                lambda: {
                    sub: userId,
                    email: email,
                    role: role,
                    tenantId: "GLOBAL"
                }
            }
        }
    };
};

export const generateTenantId = () => `test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

export async function cleanupTenant(tenantId: string) {
    if (!tenantId.startsWith("test-")) return;

    // 1. Find all records for this tenant (PK = TENANT#id)
    const pk = `TENANT#${tenantId}`;
    const itemsToDelete: any[] = [];

    const query = await db.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": pk }
    }));

    if (query.Items) itemsToDelete.push(...query.Items);

    // 2. Also delete the System Config (PK = SYSTEM, SK = TENANT#id)
    itemsToDelete.push({ PK: "SYSTEM", SK: `TENANT#${tenantId}` });

    // 3. Batch Delete
    for (let i = 0; i < itemsToDelete.length; i += 25) {
        const batch = itemsToDelete.slice(i, i + 25);
        const requests = batch.map(item => ({
            DeleteRequest: { Key: { PK: item.PK, SK: item.SK } }
        }));

        try {
            await db.send(new BatchWriteCommand({
                RequestItems: { [TABLE_NAME]: requests }
            }));
        } catch (e) {
            console.error("Cleanup failed for batch", e);
        }
    }
}
