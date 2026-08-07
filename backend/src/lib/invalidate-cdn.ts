import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "./db.js";
import { normalizeEdgePaths } from "./edge-invalidation.js";

/**
 * CloudFront cache invalidation via DynamoDB markers. Two classes, since cache-4a:
 *
 *  - BULK / global mutations (theme, tenant settings, imports, popups, forms, bulk-price,
 *    create-of-a-new-entity) use `withInvalidation()` → `CDN_PENDING` → the debounce-flush
 *    Lambda fires a `/*` invalidation after 15 min of quiet. They also show the admin
 *    "GO LIVE NOW" banner.
 *  - ORDINARY edits (an existing page/product/category) instead reach `enqueueEdgeInvalidation()`
 *    via `revalidate.ts#revalidateTenantPaths`, which feeds it the *exact changed URI paths*
 *    computed by `revalidate-paths.ts#purgeTargets`. Those paths accumulate for an immediate
 *    (≈10s) targeted CloudFront invalidation drained by the SAME debounce-flush Lambda. They are
 *    NOT pending and show NO banner — they go live in seconds. See docs/caching-architecture.md
 *    § "Invalidation model".
 *
 * The reason both classes are drained by debounce-flush rather than calling CloudFront
 * directly from the mutation Lambda: `cloudfront:CreateInvalidation` is confined to the two
 * already-authorized functions (debounce-flush, system/invalidation). Mutation Lambdas only
 * ever write DynamoDB — no CloudFront IAM on them — so the fast lane is a DDB write here and
 * a CloudFront call there. This is what keeps cache-4a a code-only change (no CDK).
 *
 * Markers (all PK: SYSTEM):
 *   SK: CDN_PENDING       — bulk `/*` debounce; consumed + deleted by debounce-flush.
 *   SK: CDN_FAST_PENDING  — ordinary edits' changed paths as a String Set (`paths`) plus a
 *                           monotonic generation counter (`rev`); drained (targeted invalidation)
 *                           by debounce-flush every ~10s, members removed after — but only if
 *                           `rev` is unchanged since the drain read it (see below).
 *   SK: CDN_LAST_CHANGE   — persistent high-water mark, never deleted, read by
 *                           nightly-cache-flush to skip quiet days. Written by BOTH classes.
 *
 * Design decisions:
 * - `ADD` on a String Set is atomic and dedupes across concurrent writers — free coalescing.
 * - Every enqueue also `ADD`s 1 to `rev` in the SAME atomic UpdateItem. A String Set carries no
 *   write generation, so a re-edit of an ALREADY-queued path is invisible at the membership
 *   level — the drain would `DELETE` that member and lose the second edit's invalidation. The
 *   `rev` counter is that missing generation: the drain snapshots it with the paths and only
 *   deletes the drained members if `rev` is still equal at cleanup time. A concurrent enqueue
 *   (same OR different path) bumps `rev`, fails the drain's condition, and the whole marker is
 *   retained for a redundant-but-correct re-invalidation next cycle. (Fixes CACHE-4A/review-1.)
 * - All mutation Lambdas already have DDB write access — no new IAM needed.
 * - Best-effort: marker write errors are logged but don't fail the response.
 *
 * @module
 */

/** DynamoDB keys for the invalidation markers */
const CDN_PENDING_PK = "SYSTEM";
const CDN_PENDING_SK = "CDN_PENDING";
const CDN_FAST_PENDING_SK = "CDN_FAST_PENDING";
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
 * cache-4a fast lane. Enqueue the EXACT changed URI paths of an ordinary edit for an
 * immediate targeted CloudFront invalidation, and bump the nightly-flush high-water mark.
 *
 * `paths` are viewer-facing URI paths (e.g. `/about`, `/produs/inel`) — precisely the `slug`
 * fields `revalidate-paths.ts#purgeTargets` already computes for the Layer-2 (ISR) purge.
 * A CloudFront invalidation is keyed on the request URI and is host-agnostic, so no domain is
 * prepended (unlike the S3/ISR key `/<domain>/<slug>`). Same-path collateral across tenants is
 * accepted and cheap — a collided page refills from warm ISR without SSR (ratified, slice doc).
 *
 * Writes:
 *   - `CDN_FAST_PENDING.paths` via `ADD` to a String Set — atomic, deduped, coalescing — AND
 *     `CDN_FAST_PENDING.rev` via `ADD 1`, in the same atomic UpdateItem. `rev` is the write
 *     generation the drain conditions its cleanup on, so a same-path re-edit queued during a
 *     drain is never silently dropped (see the module docstring).
 *   - `CDN_LAST_CHANGE` — so the nightly S3 flush still runs after an ordinary-only day. This
 *     matters because ordinary handlers no longer go through `markCdnPending()` (which is what
 *     used to write this marker for them). Without it, a day of only-ordinary edits whose
 *     targeted invalidation somehow failed would let the nightly backstop skip.
 *
 * Deliberately does NOT write `CDN_PENDING`: an ordinary edit must not raise the "GO LIVE NOW"
 * banner — nothing is pending, it went live in seconds.
 *
 * Best-effort, like `markCdnPending()`: a failed write is logged and swallowed so it can never
 * fail the mutation. The nightly flush is the backstop.
 */
export async function enqueueEdgeInvalidation(paths: string[]): Promise<void> {
    if (!TABLE_NAME) {
        console.log("[CDN] Skipping fast-lane enqueue — TABLE_NAME not set");
        return;
    }

    const clean = normalizeEdgePaths(paths);
    if (clean.length === 0) return;

    const now = Date.now();

    try {
        await Promise.all([
            db.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: CDN_PENDING_PK, SK: CDN_FAST_PENDING_SK },
                // ADD merges the set members AND bumps the generation counter atomically — one
                // UpdateItem, so `paths` and `rev` can never diverge. `rev` gates the drain's
                // cleanup (see module docstring); without it a same-path re-edit is dropped.
                UpdateExpression: "ADD #paths :p, #rev :one SET updatedAt = :t",
                ExpressionAttributeNames: { "#paths": "paths", "#rev": "rev" },
                ExpressionAttributeValues: { ":p": new Set(clean), ":one": 1, ":t": now },
            })),
            db.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: { PK: CDN_PENDING_PK, SK: CDN_LAST_CHANGE_SK, updatedAt: now },
            })),
        ]);
        console.log(`[CDN] Fast-lane enqueued ${clean.length} path(s) for immediate edge invalidation: ${clean.join(", ")}`);
    } catch (error) {
        console.error("[CDN] Failed to enqueue fast-lane invalidation:", error);
        // Don't fail the request — the fast lane is best-effort; nightly flush backstops.
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
