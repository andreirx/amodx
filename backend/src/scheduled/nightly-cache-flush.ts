import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Nightly cache flush Lambda.
 * Triggered by EventBridge cron schedule (daily at 02:00 UTC).
 *
 * Skips entirely if no mutations happened since the last nightly flush.
 * Uses two DynamoDB markers to decide:
 *   - SYSTEM#CDN_LAST_CHANGE  — written by withInvalidation() on every mutation, never deleted
 *   - SYSTEM#CDN_LAST_NIGHTLY_FLUSH — written by this Lambda after a successful flush
 *
 * If lastChange <= lastFlush (or no changes ever), the Lambda exits immediately.
 * This prevents unnecessary CloudFront invalidation and ISR cache purge on quiet days.
 *
 * When it does run, flushes BOTH cache layers:
 *   1. CloudFront edge cache — CreateInvalidation /*
 *   2. OpenNext ISR cache in S3 — delete all objects under _cache/ prefix
 *
 * Requires env vars:
 *   TABLE_NAME — DynamoDB table for markers
 *   RENDERER_DISTRIBUTION_ID — CloudFront distribution to invalidate
 *   CACHE_BUCKET_NAME — S3 bucket containing ISR cache
 *   CACHE_BUCKET_KEY_PREFIX — S3 key prefix for ISR cache (default: _cache)
 *
 * Requires IAM:
 *   dynamodb:GetItem + dynamodb:PutItem on the main table
 *   cloudfront:CreateInvalidation on the distribution
 *   s3:ListBucket + s3:DeleteObject on the cache bucket
 */

const cf = new CloudFrontClient({});
const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const tableName = process.env.TABLE_NAME;
const distributionId = process.env.RENDERER_DISTRIBUTION_ID;
const bucketName = process.env.CACHE_BUCKET_NAME;
const cachePrefix = process.env.CACHE_BUCKET_KEY_PREFIX || "_cache";

export const handler = async (): Promise<void> => {
    console.log("[NightlyFlush] Starting nightly cache flush check");

    // --- Check whether any changes happened since the last nightly flush ---
    if (tableName) {
        try {
            const [lastChangeRes, lastFlushRes] = await Promise.all([
                ddb.send(new GetCommand({
                    TableName: tableName,
                    Key: { PK: "SYSTEM", SK: "CDN_LAST_CHANGE" },
                    ProjectionExpression: "updatedAt",
                })),
                ddb.send(new GetCommand({
                    TableName: tableName,
                    Key: { PK: "SYSTEM", SK: "CDN_LAST_NIGHTLY_FLUSH" },
                    ProjectionExpression: "flushedAt",
                })),
            ]);

            const lastChangeAt = lastChangeRes.Item?.updatedAt as number | undefined;
            const lastFlushedAt = lastFlushRes.Item?.flushedAt as number | undefined;

            if (!lastChangeAt) {
                console.log("[NightlyFlush] No CDN_LAST_CHANGE marker found — no mutations ever. Skipping.");
                return;
            }

            if (lastFlushedAt && lastFlushedAt >= lastChangeAt) {
                console.log(`[NightlyFlush] No changes since last nightly flush. lastChange=${new Date(lastChangeAt).toISOString()}, lastFlush=${new Date(lastFlushedAt).toISOString()}. Skipping.`);
                return;
            }

            console.log(`[NightlyFlush] Changes detected since last flush. lastChange=${new Date(lastChangeAt).toISOString()}, lastFlush=${lastFlushedAt ? new Date(lastFlushedAt).toISOString() : "never"}. Proceeding.`);
        } catch (error) {
            // If marker check fails, proceed with flush as a safety fallback
            console.error("[NightlyFlush] Failed to read change markers, proceeding with flush:", error);
        }
    }

    // Track success — only write CDN_LAST_NIGHTLY_FLUSH if both steps succeed.
    // A failed flush must not suppress future backstop runs.
    let cfOk = false;
    let s3Ok = false;

    // 1. CloudFront /* invalidation
    if (distributionId) {
        try {
            await cf.send(new CreateInvalidationCommand({
                DistributionId: distributionId,
                InvalidationBatch: {
                    CallerReference: `nightly-${Date.now()}`,
                    Paths: {
                        Quantity: 1,
                        Items: ["/*"],
                    },
                },
            }));
            console.log("[NightlyFlush] CloudFront /* invalidation submitted");
            cfOk = true;
        } catch (error) {
            console.error("[NightlyFlush] CloudFront invalidation failed:", error);
        }
    } else {
        console.warn("[NightlyFlush] RENDERER_DISTRIBUTION_ID not set, skipping CloudFront");
        cfOk = true; // not configured = not a failure
    }

    // 2. S3 ISR cache flush — delete all objects under _cache/ prefix
    if (bucketName) {
        try {
            let totalDeleted = 0;
            let continuationToken: string | undefined;

            do {
                const listResult = await s3.send(new ListObjectsV2Command({
                    Bucket: bucketName,
                    Prefix: `${cachePrefix}/`,
                    MaxKeys: 1000,
                    ContinuationToken: continuationToken,
                }));

                const objects = listResult.Contents;
                if (!objects || objects.length === 0) break;

                await s3.send(new DeleteObjectsCommand({
                    Bucket: bucketName,
                    Delete: {
                        Objects: objects.map(obj => ({ Key: obj.Key! })),
                        Quiet: true,
                    },
                }));

                totalDeleted += objects.length;
                continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
            } while (continuationToken);

            console.log(`[NightlyFlush] Deleted ${totalDeleted} ISR cache objects from s3://${bucketName}/${cachePrefix}/`);
            s3Ok = true;
        } catch (error) {
            console.error("[NightlyFlush] S3 cache flush failed:", error);
        }
    } else {
        console.warn("[NightlyFlush] CACHE_BUCKET_NAME not set, skipping S3 flush");
        s3Ok = true; // not configured = not a failure
    }

    // Record that this flush ran — only if both steps succeeded.
    // If either failed, omitting this marker causes the next nightly run to retry.
    if (cfOk && s3Ok && tableName) {
        try {
            await ddb.send(new PutCommand({
                TableName: tableName,
                Item: {
                    PK: "SYSTEM",
                    SK: "CDN_LAST_NIGHTLY_FLUSH",
                    flushedAt: Date.now(),
                },
            }));
        } catch (error) {
            console.error("[NightlyFlush] Failed to write flush marker:", error);
        }
    } else if (!cfOk || !s3Ok) {
        console.warn("[NightlyFlush] Flush incomplete — marker NOT written so next run retries");
    }

    console.log("[NightlyFlush] Complete");
};
