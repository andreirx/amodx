import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "./db.js";

/**
 * The ids of every product of `tenantId` whose `resourceId` equals `resourceId`, in any status (active, draft,
 * archived). An empty array means no product of this tenant references the resource.
 *
 * Callers: `resources/presign.ts` (download: which products must the caller have bought) and `leads/create.ts`
 * (DIGITAL-FILE-GUARD-1: a resource that a product references is not a lead magnet).
 *
 * Cost: one Query on the tenant's partition, `begins_with(SK, "PRODUCT#")`, with a filter on `resourceId`. DynamoDB
 * applies the filter AFTER it reads, so every call reads (and is billed for) all the tenant's product items, page
 * by page. The loop follows `LastEvaluatedKey` to the end: a match past the first 1 MB page is found. Not a scan:
 * the key condition names one tenant partition.
 *
 * Every page is a strongly consistent read (`ConsistentRead: true`; twice the read units of an eventually consistent
 * read). Reason: `leads/create.ts` signs a link when this answer is EMPTY. An eventually consistent read can miss a
 * product write that completed just before, and that absence would sign the product's file. A consistent read sees
 * every write that completed before the read; it is not a snapshot across pages against edits that run at the same
 * time.
 *
 * Throws when a read fails. A caller that uses the answer to refuse access must treat a throw as "refuse".
 */
export async function productIdsReferencingResource(tenantId: string, resourceId: string): Promise<string[]> {
    const ids: string[] = [];
    let startKey: Record<string, any> | undefined;
    do {
        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            FilterExpression: "resourceId = :resourceId",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "PRODUCT#",
                ":resourceId": resourceId,
            },
            ProjectionExpression: "id",
            ConsistentRead: true,
            ExclusiveStartKey: startKey,
        }));
        for (const item of result.Items ?? []) ids.push(item.id);
        startKey = result.LastEvaluatedKey;
    } while (startKey);
    return ids;
}
