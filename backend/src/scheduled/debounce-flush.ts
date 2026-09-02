import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { planEdgeInvalidation } from "../lib/edge-invalidation.js";

/**
 * CloudFront cache flush Lambda — drains BOTH invalidation classes (cache-4a).
 *
 * Triggered by EventBridge every 1 minute. Internally loops 6 iterations, sleeping 10s BETWEEN
 * them (5 sleeps ≈ 50s of wall time, not 60 — the last iteration does not sleep) plus per-
 * iteration operation time. EventBridge then re-invokes at the ~60s mark, so the gap between one
 * invocation's last drain and the next invocation's first drain is also ~10s: the fast lane holds
 * ~10-second resolution ACROSS invocations, not because a single invocation spans a full minute.
 *
 * Each iteration:
 *   A. FAST LANE (cache-4a): drain SYSTEM#CDN_FAST_PENDING — the exact changed URI paths of
 *      ordinary edits — and fire ONE targeted CloudFront invalidation for them, then remove the
 *      drained members. This runs every ~10s so an ordinary edit goes live in seconds.
 *      Marker hygiene: the drained members are removed only AFTER a successful CloudFront call,
 *      so a failed invalidation keeps its paths for the next attempt. The removal is CONDITIONAL
 *      on the generation counter `rev` being unchanged since the drain read the set — a
 *      concurrent enqueue (even of an already-queued path, invisible at set-membership level)
 *      bumps `rev`, fails the condition, and the whole marker is retained for a redundant
 *      re-invalidation next cycle instead of dropping the second edit (CACHE-4A/review-1).
 *   B. BULK DEBOUNCE: read SYSTEM#CDN_PENDING; if it is >= 15 min old, fire a `/*` invalidation.
 *      CDN_PENDING is deleted (race-safe) ONLY after CloudFront accepts the batch — a throw or a
 *      skipped submit retains it for the next invocation. This is the sledgehammer for
 *      bulk/global mutations. At most ONE `/*` submission is attempted per invocation (a
 *      `bulkHandled` latch): once attempted — success, transient failure, OR skip — the bulk
 *      branch is not re-entered this invocation, but the loop KEEPS RUNNING so the fast lane
 *      drains every ~10s. A failed bulk retries on the NEXT EventBridge invocation (~1 min);
 *      the fast lane does not wait for it.
 *
 * IDLE-EXIT (human-ratified 2026-09-02, revising CACHE-4A/review-3): the loop exits early on the
 * first iteration that finds NO fast-lane work (after that iteration's bulk check ran). While
 * fast-lane paths exist — including retained-after-failure paths — the full ~10s cadence
 * continues, so active drains keep review-3's resolution. Only the IDLE invocation is cheap.
 *
 * Why review-3's "never return early" was revised: it priced the extra GetItems (negligible) but
 * not the Lambda wall-clock — `await sleep()` bills like work. Measured August 2026: 50.1s × 1,440
 * invocations/day × 2 environments ≈ 1.1M GB-s/month, 2.7× the entire Lambda free tier and 93% of
 * the account's Lambda bill, for a function 99.9% asleep. The revised contract: an edit enqueued
 * while the flusher is idle waits up to one EventBridge tick (~60s) for its FIRST drain, then
 * ~10s resolution while work remains. A bulk marker inside its 15-min window likewise re-checks
 * at tick resolution (its lane tolerates ~1-min latency by design — see review-0 retry note).
 * The full "visible in seconds even from idle" promise returns with the queued event-driven
 * fast-lane slice (edit enqueue directly triggers a drain; see docs/TECH-DEBT.md 2026-09-02).
 *
 * Race condition safety:
 *   - CDN_PENDING delete uses ConditionExpression updatedAt = :original — a mutation that
 *     sneaks in between read and delete fails the condition, the marker stays, next cycle
 *     re-checks.
 *   - CDN_FAST_PENDING cleanup is `DELETE #paths :drained` guarded by `ConditionExpression:
 *     #rev = :rev` (the generation snapshotted at read). If ANY enqueue landed since the read —
 *     including a re-edit of an already-queued path, which an unguarded set `DELETE` would erase —
 *     `rev` advanced, the condition fails, and NOTHING is deleted: the full marker is retained
 *     and re-invalidated next cycle (one redundant targeted invalidation at worst, never dropped
 *     work). When the condition holds, no enqueue happened, so the drained members ARE the whole
 *     set and removing them clears it.
 *   - The bulk `/*` branch does NOT delete CDN_FAST_PENDING. `/*` covers the accumulated paths,
 *     but a path enqueued between the `/*` submit and a delete would be erased before its own
 *     invalidation — so the marker is left for the next fast-lane drain (one redundant targeted
 *     invalidation at worst, never dropped work).
 *
 * Requires env vars:
 *   TABLE_NAME — DynamoDB table with the markers
 *   RENDERER_DISTRIBUTION_ID — CloudFront distribution to invalidate
 *   DEBOUNCE_WINDOW_MS — debounce window in ms (default: 900000 = 15 min)
 *
 * Requires IAM (already granted — see infra/lib/amodx-stack.ts, grantReadWriteData):
 *   dynamodb:GetItem + dynamodb:UpdateItem + dynamodb:DeleteItem on TABLE_NAME
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
const CDN_FAST_PENDING_SK = "CDN_FAST_PENDING";

const POLL_INTERVAL_MS = 10_000; // 10 seconds
const MAX_ITERATIONS = 6;        // 6 iterations, 10s sleep BETWEEN them → 5×10s ≈ 50s of polling.
                                 // EventBridge re-invokes at ~60s, preserving the ~10s inter-drain gap.

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Fire one CloudFront invalidation for `items` ("/*" or a targeted path list). */
async function submitInvalidation(items: string[], callerPrefix: string): Promise<boolean> {
    if (!distributionId) {
        console.warn(`[DebounceFlush] RENDERER_DISTRIBUTION_ID not set, skipping ${callerPrefix} invalidation`);
        return false;
    }
    await cf.send(new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
            CallerReference: `${callerPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            Paths: { Quantity: items.length, Items: items },
        },
    }));
    return true;
}

/**
 * cache-4a fast lane: invalidate the accumulated ordinary-edit paths, then remove exactly what
 * we drained — but only if no enqueue slipped in since we read the set. Best-effort — a failure
 * here is logged and retried next cycle. Two guards:
 *   1. Drained members are removed only AFTER a successful CloudFront call (failed invalidation
 *      keeps its paths).
 *   2. The removal is CONDITIONAL on the generation counter `rev` snapshotted at read time. A
 *      concurrent enqueue — even of a path already in the set, which is invisible at the
 *      set-membership level — bumps `rev` and fails the condition, so the whole marker is
 *      retained and re-invalidated next cycle rather than the second edit being silently dropped.
 *
 * Returns TRUE iff fast-lane work EXISTED this pass (paths present — drained, or retained after a
 * failed invalidation), so the caller keeps the ~10s cadence while work remains and idle-exits
 * otherwise. A failure path returns true: the retained paths ARE pending work.
 */
async function drainFastLane(): Promise<boolean> {
    let item;
    try {
        const res = await ddb.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: CDN_PENDING_PK, SK: CDN_FAST_PENDING_SK },
            ConsistentRead: true, // read the latest rev — an eventually-consistent read could
                                  // snapshot a stale generation and delete a just-enqueued path.
        }));
        item = res.Item;
    } catch (error) {
        console.error("[FastLane] Failed to read CDN_FAST_PENDING:", error);
        return true; // unknown state — assume work exists so the loop retries in ~10s, not ~60s
    }

    // DocumentClient returns a JS Set for a DynamoDB String Set (SS).
    const stored = item?.paths;
    const drained: string[] = stored instanceof Set
        ? Array.from(stored).filter((p): p is string => typeof p === "string")
        : Array.isArray(stored)
            ? stored.filter((p): p is string => typeof p === "string")
            : [];
    if (drained.length === 0) return false;

    // Generation snapshot, read atomically with the paths above. `rev` may be absent on a marker
    // written before this change deployed — treat that as "no generation yet" and gate cleanup
    // on the attribute still not existing (any new enqueue creates it, failing the condition).
    const rev = typeof item?.rev === "number" ? item.rev : undefined;

    const plan = planEdgeInvalidation(drained);
    if (plan.length === 0) return false;

    try {
        const submitted = await submitInvalidation(plan, "fastlane");
        if (!submitted) return true; // no distribution configured — marker kept, still pending work
        console.log(`[FastLane] Invalidated ${plan.length} path(s): ${plan.join(", ")}`);
    } catch (error) {
        console.error("[FastLane] CloudFront invalidation failed — keeping paths for next cycle:", error);
        return true; // retained paths are pending work — retry at ~10s cadence
    }

    // Generation-safe cleanup. Remove exactly the drained members, but ONLY if `rev` is unchanged
    // (no enqueue since the read). On a failed condition, retain the ENTIRE marker — do not delete
    // any member — so the next drain re-invalidates it (redundant, never dropped work).
    const values: Record<string, unknown> = { ":drained": new Set(drained) };
    let conditionExpression: string;
    if (rev === undefined) {
        conditionExpression = "attribute_not_exists(#rev)";
    } else {
        conditionExpression = "#rev = :rev";
        values[":rev"] = rev;
    }

    try {
        await ddb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: CDN_PENDING_PK, SK: CDN_FAST_PENDING_SK },
            UpdateExpression: "DELETE #paths :drained",
            ConditionExpression: conditionExpression,
            ExpressionAttributeNames: { "#paths": "paths", "#rev": "rev" },
            ExpressionAttributeValues: values,
        }));
    } catch (error: any) {
        if (error?.name === "ConditionalCheckFailedException") {
            console.log(
                "[FastLane] New edit enqueued during invalidation (rev advanced) — retaining " +
                "marker; next drain re-invalidates it (redundant, never dropped).",
            );
        } else {
            console.error("[FastLane] Failed to remove drained paths (will re-invalidate next cycle):", error);
        }
    }
    return true; // this pass HAD work — keep the ~10s cadence for any follow-on enqueues/retries
}

/**
 * Bulk debounce branch. Reads SYSTEM#CDN_PENDING; if the 15-min quiet window has expired, fires
 * ONE `/*` invalidation and (on success) clears CDN_PENDING race-safely.
 *
 * Returns TRUE iff a `/*` submission was ATTEMPTED this call — success, transient failure, OR
 * skip (no distribution). The caller latches on that and does not re-enter this branch for the
 * rest of the invocation ("at most one `/*` per invocation"), while STILL draining the fast lane
 * each ~10s. Returns FALSE when nothing was due (no marker, or the window has not yet expired) so
 * the caller keeps checking on later iterations.
 *
 * CRITICAL (CACHE-4A/review-3): this helper never terminates the polling loop. Pre-review-3 the
 * bulk branch `return`ed after a submit/fail/skip, killing the remaining fast-lane drains — a path
 * enqueued the instant a bulk `/*` fired then waited a full EventBridge tick (~1 min) instead of
 * the next ~10s drain. Returning a boolean instead of `return`ing keeps the loop alive.
 */
async function flushBulkIfDue(iteration: number): Promise<boolean> {
    const result = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: CDN_PENDING_PK, SK: CDN_PENDING_SK },
    }));
    const marker = result.Item;

    if (!marker) {
        if (iteration === 0) {
            console.log("[DebounceFlush] No bulk changes pending (fast lane still draining each cycle)");
        }
        return false; // nothing due — keep checking next iteration
    }

    const updatedAt = marker.updatedAt as number;
    const elapsed = Date.now() - updatedAt;

    if (elapsed < DEBOUNCE_MS) {
        const remaining = Math.round((DEBOUNCE_MS - elapsed) / 1000);
        console.log(`[DebounceFlush] ${remaining}s remaining in bulk debounce window. (iteration ${iteration + 1}/${MAX_ITERATIONS})`);
        return false; // window still open — keep checking next iteration
    }

    console.log(`[DebounceFlush] Bulk window expired (${Math.round(elapsed / 1000)}s since last change). Invalidating /*.`);

    // 1. Fire the CloudFront /* invalidation. The pending markers are cleared ONLY after
    //    CloudFront has ACCEPTED the batch. A throw (transient CloudFront error) or a skipped
    //    submit (no distribution configured) must RETAIN both markers so a LATER invocation
    //    retries — deleting them here would silently drop bulk invalidation work and break instant
    //    go-live (CACHE-4A/review-0, correctness defect). The 15-min-debounced bulk lane tolerates
    //    a ~1-min retry latency. Either way this counts as the one bulk attempt for the invocation.
    let submitted = false;
    try {
        submitted = await submitInvalidation(["/*"], "debounce");
        if (submitted) console.log("[DebounceFlush] CloudFront /* invalidation submitted");
    } catch (error) {
        console.error("[DebounceFlush] CloudFront /* invalidation failed — retaining markers for retry:", error);
    }

    if (!submitted) {
        // Markers retained (CDN_PENDING and CDN_FAST_PENDING untouched); a later EventBridge
        // invocation (~1 min) retries the bulk flush. The fast lane keeps draining meanwhile.
        return true; // attempted (and failed/skipped) — do not retry bulk this invocation
    }

    // 2. Deliberately do NOT delete CDN_FAST_PENDING here. A `/*` does cover every fast-lane path,
    //    but a path ADDed between the submit above and now would be erased without ever being
    //    invalidated in its own right (CACHE-4A/review-0, race defect). Leaving the marker costs at
    //    most one redundant targeted invalidation on the next ~10s fast-lane drain — strictly
    //    preferable to dropped work, and that drain still runs THIS invocation (review-3).

    // 3. Delete the bulk marker — conditional, race-safe against a mutation that arrived during
    //    the flush.
    try {
        await ddb.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: CDN_PENDING_PK, SK: CDN_PENDING_SK },
            ConditionExpression: "updatedAt = :original",
            ExpressionAttributeValues: { ":original": updatedAt },
        }));
        console.log("[DebounceFlush] Bulk marker cleared");
    } catch (error: any) {
        if (error.name === "ConditionalCheckFailedException") {
            console.log("[DebounceFlush] Bulk marker updated by new mutation during flush — will re-check next cycle");
        } else {
            console.error("[DebounceFlush] Failed to delete bulk marker:", error);
        }
    }

    return true; // /* submitted — do not submit again this invocation
}

export const handler = async (): Promise<void> => {
    // At most ONE bulk `/*` submission per invocation. Once a submission has been ATTEMPTED
    // (success, transient failure, or skip) this latches true and the bulk branch is skipped for
    // the rest of the invocation. A failed/skipped bulk retries on the NEXT EventBridge
    // invocation; the fast lane never waits for it (CACHE-4A/review-3).
    let bulkHandled = false;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        // A. Fast lane — ordinary edits' changed paths, targeted, every ~10s while work exists.
        const fastHadWork = await drainFastLane();

        // B. Bulk debounce — CDN_PENDING → /* after the 15-min quiet window, at most once.
        const bulkHandledBefore = bulkHandled;
        if (!bulkHandled) {
            bulkHandled = await flushBulkIfDue(i);
        }
        // A bulk attempt THIS pass counts as work: review-0 deliberately leaves CDN_FAST_PENDING
        // untouched when `/*` fires, so a path enqueued during the submit must get its ~10s drain
        // in THIS invocation (review-3 test pins this) — one extra iteration, only on the rare
        // pass where a bulk actually acted.
        const bulkActedThisPass = bulkHandled && !bulkHandledBefore;

        // IDLE-EXIT (ratified 2026-09-02): a pass where neither lane had work has nothing left
        // that benefits from ~10s resolution — the bulk lane re-checks a 15-min clock at
        // EventBridge tick resolution by design. Sleeping through the remaining iterations would
        // bill ~50s of Lambda wall-clock per minute forever (the August 2026 cost incident — see
        // header). Exit.
        if (!fastHadWork && !bulkActedThisPass) {
            if (i === 0) console.log("[DebounceFlush] Idle — exiting until next EventBridge tick.");
            return;
        }

        // Fast-lane work existed this pass — hold the ~10s cadence for follow-on drains.
        if (i < MAX_ITERATIONS - 1) {
            await sleep(POLL_INTERVAL_MS);
        }
    }

    console.log("[DebounceFlush] Max iterations reached, returning. EventBridge will re-invoke in ~1 min.");
};
