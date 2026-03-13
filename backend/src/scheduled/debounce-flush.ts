import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Debounced CloudFront cache flush Lambda.
 *
 * Triggered by EventBridge every 1 minute. Internally loops 6 times
 * with 10-second sleeps, giving effective 10-second polling resolution
 * on the 15-minute debounce window.
 *
 * Flow:
 *   1. Read SYSTEM#CDN_PENDING marker from DynamoDB
 *   2. If not found → return immediately (no pending changes, ~5ms)
 *   3. If found but updatedAt < 15 min ago → sleep 10s, loop again
 *   4. If found and updatedAt >= 15 min ago → fire CloudFront /* invalidation
 *      then delete marker with conditional expression (race-safe)
 *
 * Race condition safety:
 *   The delete uses ConditionExpression: updatedAt = :original
 *   If a new mutation sneaked in between read and delete, the condition fails,
 *   the marker stays, and the next polling cycle picks it up.
 *
 * Requires env vars:
 *   TABLE_NAME — DynamoDB table with the SYSTEM#CDN_PENDING marker
 *   RENDERER_DISTRIBUTION_ID — CloudFront distribution to invalidate
 *   DEBOUNCE_WINDOW_MS — debounce window in ms (default: 900000 = 15 min)
 *
 * Requires IAM:
 *   dynamodb:GetItem + dynamodb:DeleteItem on TABLE_NAME
 *   cloudfront:CreateInvalidation on the distribution
 */

const cf = new CloudFrontClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME || "";
const distributionId = process.env.RENDERER_DISTRIBUTION_ID;
const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_WINDOW_MS || "900000", 10); // 15 min

const CDN_PENDING_PK = "SYSTEM";
const CDN_PENDING_SK = "CDN_PENDING";

const POLL_INTERVAL_MS = 10_000; // 10 seconds
const MAX_ITERATIONS = 6;        // 6 * 10s = 60s (matches EventBridge 1-min schedule)

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const handler = async (): Promise<void> => {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
        // Read marker
        const result = await ddb.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: CDN_PENDING_PK, SK: CDN_PENDING_SK },
        }));

        const marker = result.Item;

        // No pending changes — return immediately
        if (!marker) {
            if (i === 0) {
                // Only log on first check to avoid noise
                console.log("[DebounceFlush] No pending changes");
            }
            return;
        }

        const updatedAt = marker.updatedAt as number;
        const elapsed = Date.now() - updatedAt;

        if (elapsed >= DEBOUNCE_MS) {
            // Debounce window expired — fire invalidation
            console.log(`[DebounceFlush] Window expired (${Math.round(elapsed / 1000)}s since last change). Invalidating.`);

            // 1. Fire CloudFront /* invalidation
            if (distributionId) {
                try {
                    await cf.send(new CreateInvalidationCommand({
                        DistributionId: distributionId,
                        InvalidationBatch: {
                            CallerReference: `debounce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            Paths: {
                                Quantity: 1,
                                Items: ["/*"],
                            },
                        },
                    }));
                    console.log("[DebounceFlush] CloudFront /* invalidation submitted");
                } catch (error) {
                    console.error("[DebounceFlush] CloudFront invalidation failed:", error);
                    // Don't return — still try to clean up the marker
                }
            } else {
                console.warn("[DebounceFlush] RENDERER_DISTRIBUTION_ID not set, skipping CloudFront");
            }

            // 2. Delete marker (conditional — race-safe)
            try {
                await ddb.send(new DeleteCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: CDN_PENDING_PK, SK: CDN_PENDING_SK },
                    ConditionExpression: "updatedAt = :original",
                    ExpressionAttributeValues: {
                        ":original": updatedAt,
                    },
                }));
                console.log("[DebounceFlush] Marker cleared");
            } catch (error: any) {
                if (error.name === "ConditionalCheckFailedException") {
                    console.log("[DebounceFlush] Marker updated by new mutation during flush — will re-check next cycle");
                } else {
                    console.error("[DebounceFlush] Failed to delete marker:", error);
                }
            }

            return;
        }

        // Not expired yet — sleep and retry
        const remaining = Math.round((DEBOUNCE_MS - elapsed) / 1000);
        console.log(`[DebounceFlush] ${remaining}s remaining in debounce window. Sleeping 10s. (iteration ${i + 1}/${MAX_ITERATIONS})`);

        // Don't sleep on the last iteration — Lambda is about to return anyway
        if (i < MAX_ITERATIONS - 1) {
            await sleep(POLL_INTERVAL_MS);
        }
    }

    console.log("[DebounceFlush] Max iterations reached, returning. EventBridge will re-invoke in ~1 min.");
};
