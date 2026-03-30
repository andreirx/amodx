import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "./db.js";

/**
 * Debounced CloudFront cache invalidation via DynamoDB marker.
 *
 * Instead of calling CloudFront on every mutation (~100ms), the HOF writes
 * a timestamp marker to DynamoDB (~5ms). A separate scheduled Lambda
 * (debounce-flush) polls every 10 seconds and fires the actual CloudFront
 * invalidation once 15 minutes have elapsed since the last mutation.
 *
 * Markers:
 *   PK: SYSTEM, SK: CDN_PENDING    — consumed by debounce-flush, deleted after CloudFront invalidation
 *   PK: SYSTEM, SK: CDN_LAST_CHANGE — persistent high-water mark, never deleted, read by nightly-cache-flush
 *
 * Design decisions:
 * - DynamoDB PutItem unconditional (always overwrites) — latest mutation wins.
 * - All mutation Lambdas already have DDB write access — no new IAM needed.
 * - Debounce window: 15 minutes. Admin can bypass via "GO LIVE NOW" button.
 * - Best-effort: marker write errors are logged but don't fail the response.
 * - CDN_LAST_CHANGE enables the nightly flush to skip entirely on days with zero changes.
 *
 * @module
 */

/** DynamoDB keys for the invalidation markers */
const CDN_PENDING_PK = "SYSTEM";
const CDN_PENDING_SK = "CDN_PENDING";
const CDN_LAST_CHANGE_SK = "CDN_LAST_CHANGE";

async function markCdnPending(): Promise<void> {
    if (!TABLE_NAME) {
        console.log("[CDN] Skipping marker — TABLE_NAME not set");
        return;
    }

    const now = Date.now();

    try {
        // CDN_PENDING: consumed by debounce-flush, deleted after CloudFront invalidation
        // CDN_LAST_CHANGE: persistent high-water mark, read by nightly-cache-flush to skip quiet days
        await Promise.all([
            db.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    PK: CDN_PENDING_PK,
                    SK: CDN_PENDING_SK,
                    updatedAt: now,
                },
            })),
            db.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    PK: CDN_PENDING_PK,
                    SK: CDN_LAST_CHANGE_SK,
                    updatedAt: now,
                },
            })),
        ]);
        console.log("[CDN] Invalidation markers written");
    } catch (error) {
        console.error("[CDN] Failed to write invalidation markers:", error);
        // Don't fail the request — markers are best-effort
    }
}

/**
 * Higher-order function that wraps a Lambda handler to mark the CDN cache
 * as pending invalidation after any successful (2xx) mutation response.
 *
 * A separate scheduled Lambda (debounce-flush) reads this marker and fires
 * the actual CloudFront /* invalidation after the debounce window expires.
 *
 * Usage:
 *   const _handler: Handler = async (event) => { ... };
 *   export const handler = withInvalidation(_handler);
 *
 * For multi-export files:
 *   const _updateHandler: Handler = async (event) => { ... };
 *   export const updateHandler = withInvalidation(_updateHandler);
 */
export function withInvalidation<T extends (...args: any[]) => any>(handler: T): T {
    return (async (...args: any[]) => {
        const result = await handler(...args);

        // Write marker on successful responses only
        if (result && typeof result === "object" && "statusCode" in result) {
            const statusCode = result.statusCode as number;
            if (statusCode >= 200 && statusCode < 300) {
                await markCdnPending();
            }
        }

        return result;
    }) as T;
}
