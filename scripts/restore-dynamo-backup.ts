import { DynamoDBClient, ScanCommand, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";

const REGION = "eu-central-1";
const SOURCE_TABLE = "Amodx-Rescue"; // The restored backup
const TARGET_TABLE = "AmodxTable";     // The empty live table

const client = new DynamoDBClient({ region: REGION });

async function main() {
    console.log(`📦 Reading from ${SOURCE_TABLE}...`);

    // 1. Scan all data
    const scan = await client.send(new ScanCommand({ TableName: SOURCE_TABLE }));
    const items = scan.Items || [];
    console.log(`found ${items.length} items.`);

    if (items.length === 0) return;

    // 2. Write in batches of 25 (DynamoDB Limit)
    const chunks = [];
    for (let i = 0; i < items.length; i += 25) {
        chunks.push(items.slice(i, i + 25));
    }

    console.log(`🚀 Writing to ${TARGET_TABLE}...`);

    for (const chunk of chunks) {
        const requests = chunk.map(item => ({
            PutRequest: { Item: item }
        }));

        await client.send(new BatchWriteItemCommand({
            RequestItems: {
                [TARGET_TABLE]: requests
            }
        }));
        console.log(`... restored ${chunk.length} items`);
    }

    console.log("✅ Restore Complete.");
}

main().catch(console.error);
