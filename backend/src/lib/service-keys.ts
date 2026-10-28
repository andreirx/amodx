import { createHash, randomBytes, randomUUID } from "node:crypto";
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { ServiceKeyScope, ServiceKeyView } from "@amodx/shared";
import { db, TABLE_NAME } from "./db.js";

/**
 * SERVICE-ACCOUNT-1 — storage of tenant-bound service keys. The only module that knows the two items.
 *
 * One key = two items, written and revoked together in one transaction:
 *   key item     PK TENANT#<tenantId>      SK SVCKEY#<keyId>      — the record the admin lists (kept after revoke)
 *   lookup item  PK SVCKEYHASH#<keyHash>   SK SVCKEYHASH#<keyHash> — what the authorizer reads (deleted on revoke)
 *
 * The secret is never stored. `keyHash` = sha256(secret) hex is the KEY of the authorizer's point read,
 * so no secret comparison exists anywhere: an unknown or revoked secret hashes to an absent item.
 * Name and scopes are immutable after creation (no rename/re-scope route), so their copies on the lookup item
 * cannot drift from the key item. The name is copied so the authorizer's daily SERVICE_KEY_USED audit entry
 * carries a human-readable target title without a second read.
 */

export const SERVICE_KEY_PREFIX = "amx_sk_";

const keyItemKey = (tenantId: string, keyId: string) => ({ PK: `TENANT#${tenantId}`, SK: `SVCKEY#${keyId}` });
const lookupItemKey = (keyHash: string) => ({ PK: `SVCKEYHASH#${keyHash}`, SK: `SVCKEYHASH#${keyHash}` });

/** sha256(secret) as lowercase hex — the stored form and the lookup key. */
export function hashServiceKeySecret(secret: string): string {
    return createHash("sha256").update(secret, "utf8").digest("hex");
}

export interface ServiceKeyLookup {
    tenantId: string;
    keyId: string;
    name: string;
    scopes: ServiceKeyScope[];
    /** UTC YYYY-MM-DD of the last recorded use, or null when never used. */
    lastUsedDay: string | null;
}

function toView(item: Record<string, any>): ServiceKeyView {
    return {
        id: item.id,
        tenantId: item.tenantId,
        name: item.name,
        scopes: item.scopes ?? [],
        createdBy: item.createdBy,
        createdAt: item.createdAt,
        lastUsedAt: item.lastUsedAt ?? null,
        revokedAt: item.revokedAt ?? null,
    };
}

/** Creates a key. The returned `secret` is the only copy that will ever exist: show it once, never log it. */
export async function createServiceKey(
    tenantId: string,
    name: string,
    scopes: ServiceKeyScope[],
    createdBy: string
): Promise<{ view: ServiceKeyView; secret: string }> {
    const secret = SERVICE_KEY_PREFIX + randomBytes(32).toString("base64url");
    const keyHash = hashServiceKeySecret(secret);
    const view: ServiceKeyView = {
        id: randomUUID(),
        tenantId,
        name,
        scopes,
        createdBy,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        revokedAt: null,
    };

    await db.send(new TransactWriteCommand({
        TransactItems: [
            {
                Put: {
                    TableName: TABLE_NAME,
                    Item: { ...keyItemKey(tenantId, view.id), ...view, keyHash, Type: "ServiceKey" },
                    ConditionExpression: "attribute_not_exists(PK)",
                },
            },
            {
                Put: {
                    TableName: TABLE_NAME,
                    Item: { ...lookupItemKey(keyHash), tenantId, keyId: view.id, name, scopes, lastUsedDay: null },
                    ConditionExpression: "attribute_not_exists(PK)",
                },
            },
        ],
    }));

    return { view, secret };
}

/** All keys of one tenant (revoked included), newest first. The hash is projected out. */
export async function listServiceKeys(tenantId: string): Promise<ServiceKeyView[]> {
    const views: ServiceKeyView[] = [];
    let startKey: Record<string, any> | undefined;
    // Follow LastEvaluatedKey: a Query page stops at 1 MB, and a partial list would hide active keys.
    do {
        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "SVCKEY#" },
            // `name` is a DynamoDB reserved word.
            ExpressionAttributeNames: { "#n": "name" },
            ProjectionExpression: "id, tenantId, #n, scopes, createdBy, createdAt, lastUsedAt, revokedAt",
            ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }));
        views.push(...(result.Items ?? []).map(toView));
        startKey = result.LastEvaluatedKey;
    } while (startKey);
    // Sorted after all pages are read, so the order is global, not page-local.
    return views.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Revokes an active key of this tenant: marks the key item `revokedAt` and deletes the lookup item, in one
 * transaction. Returns null when the key is not in this tenant or is already revoked (incl. a concurrent revoke).
 */
export async function revokeServiceKey(tenantId: string, keyId: string): Promise<ServiceKeyView | null> {
    const current = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: keyItemKey(tenantId, keyId),
        ConsistentRead: true,
    }));
    const item = current.Item;
    if (!item || item.revokedAt != null || typeof item.keyHash !== "string") return null;

    const revokedAt = new Date().toISOString();
    try {
        await db.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Update: {
                        TableName: TABLE_NAME,
                        Key: keyItemKey(tenantId, keyId),
                        UpdateExpression: "SET revokedAt = :now",
                        // revokedAt is stored as null at creation; `attribute_type(revokedAt, NULL)` is the
                        // documented DynamoDB condition function that tests for a NULL-typed attribute.
                        ConditionExpression: "attribute_exists(PK) AND attribute_type(revokedAt, :nullType)",
                        ExpressionAttributeValues: { ":now": revokedAt, ":nullType": "NULL" },
                    },
                },
                { Delete: { TableName: TABLE_NAME, Key: lookupItemKey(item.keyHash) } },
            ],
        }));
    } catch (e: any) {
        // A concurrent revoke won the race: the condition on the key item (TransactItems[0]) failed.
        // Any other cancellation (throttling, conflict) is a real error, not "already revoked".
        if (e?.name === "TransactionCanceledException" && e.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") {
            return null;
        }
        throw e;
    }
    return toView({ ...item, revokedAt });
}

/** The authorizer's one point read. null = unknown OR revoked (revoke deletes this item). */
export async function findServiceKeyByHash(keyHash: string): Promise<ServiceKeyLookup | null> {
    const result = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: lookupItemKey(keyHash),
        // Strongly consistent so a revoke is effective on the very next request.
        ConsistentRead: true,
    }));
    const item = result.Item;
    if (!item || typeof item.tenantId !== "string" || !item.tenantId || typeof item.keyId !== "string") return null;
    return {
        tenantId: item.tenantId,
        keyId: item.keyId,
        name: typeof item.name === "string" ? item.name : "",
        scopes: item.scopes ?? [],
        lastUsedDay: item.lastUsedDay ?? null,
    };
}

/**
 * Records a use: `lastUsedAt` (full timestamp) on the key item, `lastUsedDay` on the lookup item.
 * Both updates require the item to exist, so a touch racing a revoke cannot re-create a deleted lookup item.
 */
export async function touchServiceKey(tenantId: string, keyId: string, keyHash: string, day: string): Promise<void> {
    const now = new Date().toISOString();
    await Promise.all([
        db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: keyItemKey(tenantId, keyId),
            UpdateExpression: "SET lastUsedAt = :now",
            ConditionExpression: "attribute_exists(PK)",
            ExpressionAttributeValues: { ":now": now },
        })),
        db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: lookupItemKey(keyHash),
            UpdateExpression: "SET lastUsedDay = :day",
            ConditionExpression: "attribute_exists(PK)",
            ExpressionAttributeValues: { ":day": day },
        })),
    ]);
}
