import { db, TABLE_NAME } from "./db.js";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import crypto from "crypto";

function hashUrl(url: string): string {
    return crypto.createHash("md5").update(url).digest("hex");
}

/**
 * Store a media URL mapping: oldUrl → newUrl.
 * SK: MEDIAMAP#<md5(oldUrl)> for O(1) lookups and collision-free keys.
 */
export async function writeMediaMapEntry(
    tenantId: string,
    oldUrl: string,
    newUrl: string,
): Promise<void> {
    await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: `TENANT#${tenantId}`,
            SK: `MEDIAMAP#${hashUrl(oldUrl)}`,
            oldUrl,
            newUrl,
            Type: "MediaMap",
        },
    }));
}

/**
 * Load all MEDIAMAP# entries for a tenant into an in-memory map.
 * Returns Map<oldUrl, newUrl>.
 */
export async function loadMediaMap(tenantId: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let lastKey: any = undefined;

    do {
        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "MEDIAMAP#",
            },
            ProjectionExpression: "oldUrl, newUrl",
            ExclusiveStartKey: lastKey,
        }));

        for (const item of result.Items || []) {
            if (item.oldUrl && item.newUrl) {
                map.set(item.oldUrl, item.newUrl);
            }
        }

        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return map;
}
