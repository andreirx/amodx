import { describe, it, expect, afterAll } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.VITE_REGION || 'eu-central-1' });
const db = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

describe('Tenant Isolation', () => {
    const tenantA = `test-iso-A-${Date.now()}`;
    const tenantB = `test-iso-B-${Date.now()}`;

    // Cleanup after test
    afterAll(async () => {
        await db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: `TENANT#${tenantA}`, SK: `CONTENT#page1` } }));
        await db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: `TENANT#${tenantB}`, SK: `CONTENT#page1` } }));
    });

    it('should not allow Tenant A to see Tenant B content', async () => {
        // 1. Create content for both
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: { PK: `TENANT#${tenantA}`, SK: `CONTENT#page1`, title: 'Page A', Type: 'Page' }
        }));

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: { PK: `TENANT#${tenantB}`, SK: `CONTENT#page1`, title: 'Page B', Type: 'Page' }
        }));

        // 2. Query as Tenant A
        const resultA = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantA}` }
        }));

        // 3. Verify
        expect(resultA.Items).toHaveLength(1);
        expect(resultA.Items?.[0].title).toBe('Page A');

        // Ensure no leakage
        const leaks = resultA.Items?.filter(i => i.title === 'Page B');
        expect(leaks).toHaveLength(0);
    });
});
