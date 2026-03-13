import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

/**
 * Nightly cache flush Lambda.
 * Triggered by EventBridge cron schedule (daily at 02:00 UTC).
 *
 * Flushes BOTH cache layers:
 *   1. CloudFront edge cache — CreateInvalidation /*
 *   2. OpenNext ISR cache in S3 — delete all objects under _cache/ prefix
 *
 * After both layers are cleared, the next visitor request for any page
 * triggers a fresh render from DynamoDB. Cache refills organically as
 * visitors arrive.
 *
 * Requires env vars:
 *   RENDERER_DISTRIBUTION_ID — CloudFront distribution to invalidate
 *   CACHE_BUCKET_NAME — S3 bucket containing ISR cache
 *   CACHE_BUCKET_KEY_PREFIX — S3 key prefix for ISR cache (default: _cache)
 *
 * Requires IAM:
 *   cloudfront:CreateInvalidation on the distribution
 *   s3:ListBucket + s3:DeleteObject on the cache bucket
 */

const cf = new CloudFrontClient({});
const s3 = new S3Client({});

const distributionId = process.env.RENDERER_DISTRIBUTION_ID;
const bucketName = process.env.CACHE_BUCKET_NAME;
const cachePrefix = process.env.CACHE_BUCKET_KEY_PREFIX || "_cache";

export const handler = async (): Promise<void> => {
    console.log("[NightlyFlush] Starting nightly cache flush");

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
        } catch (error) {
            console.error("[NightlyFlush] CloudFront invalidation failed:", error);
        }
    } else {
        console.warn("[NightlyFlush] RENDERER_DISTRIBUTION_ID not set, skipping CloudFront");
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
        } catch (error) {
            console.error("[NightlyFlush] S3 cache flush failed:", error);
        }
    } else {
        console.warn("[NightlyFlush] CACHE_BUCKET_NAME not set, skipping S3 flush");
    }

    console.log("[NightlyFlush] Complete");
};
