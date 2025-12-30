import { APIGatewayProxyEventV2WithLambdaAuthorizer } from "aws-lambda";

// Helper to simulate API Gateway Event
export const createEvent = (
    tenantId: string,
    body: any = null,
    pathParams: any = null,
    queryParams: any = null,
    userId: string = "test-admin",
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
                    role: "ADMIN"
                }
            }
        }
    };
};

export const generateTenantId = () => `test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

// Standard cleanup helper
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-central-1' });
const db = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

export async function cleanupTenant(tenantId: string) {
    if (!tenantId.startsWith("test-")) return; // Safety check

    // 1. Scan for all items with PK = TENANT#{id}
    // Note: In single table design, Query is better if you know the PK.
    // Here we know PK is TENANT#{id} or SITE#{id} depending on your schema.
    // Based on your code: PK = `TENANT#${id}`

    // We also need to clean up SYSTEM records (Tenant Config)
    // PK = SYSTEM, SK = TENANT#{id}

    const pk = `TENANT#${tenantId}`;

    // Scan is inefficient but okay for cleanup of small test tenants
    // Better: Query using PK
    const itemsToDelete: any[] = [];

    // Get Tenant Data
    const query = await db.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": pk }
    }));

    if (query.Items) itemsToDelete.push(...query.Items);

    // Get Tenant Config
    itemsToDelete.push({ PK: "SYSTEM", SK: `TENANT#${tenantId}` });

    // Batch Delete (Chunks of 25)
    for (let i = 0; i < itemsToDelete.length; i += 25) {
        const batch = itemsToDelete.slice(i, i + 25);
        const requests = batch.map(item => ({
            DeleteRequest: { Key: { PK: item.PK, SK: item.SK } }
        }));

        await db.send(new BatchWriteCommand({
            RequestItems: { [TABLE_NAME]: requests }
        }));
    }
}
