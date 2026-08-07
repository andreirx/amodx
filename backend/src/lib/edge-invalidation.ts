/**
 * cache-4a: the pure "coalescing" decision for the fast-lane CloudFront invalidation.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE
 * -----------------------------------
 * Same reason as `revalidate-paths.ts`: this rule is a test seam. `debounce-flush.ts`
 * (the drain) instantiates a CloudFront and a DynamoDB client at module load, so it cannot
 * be exercised from a credential-free unit test. The one piece worth pinning — how a set of
 * accumulated changed paths collapses into the `Paths.Items` of a single `CreateInvalidation`
 * — is extracted here so `test/unit/edge-invalidation.test.ts` can assert it with no AWS SDK
 * and no environment (config `vitest.unit.config.ts`, which has no `setupFiles`).
 *
 * Concrete current users: `planEdgeInvalidation` — `scheduled/debounce-flush.ts#drainFastLane`;
 * `normalizeEdgePaths` — `lib/invalidate-cdn.ts#enqueueEdgeInvalidation` (enqueue side) and
 * `drainFastLane` (via `planEdgeInvalidation`); plus the two unit tests
 * (`test/unit/edge-invalidation.test.ts`, `test/unit/debounce-flush.test.ts`).
 * Axis of variation: none — the logic is fixed; the module exists for the TEST SEAM, exactly
 * as `revalidate-paths.ts` does. Rejected simpler alternative: inline the dedupe/threshold in
 * `debounce-flush.ts` — rejected because the DoD requires a *pure* unit test and that file
 * cannot be imported without booting its AWS clients.
 *
 * THE RULE (coalescing guardrail — cache-4a DoD 4)
 * ------------------------------------------------
 * Ordinary edits each enqueue 1-3 changed paths into a DynamoDB String Set
 * (`SYSTEM#CDN_FAST_PENDING.paths`). The Set dedupes across concurrent mutations for free, so
 * re-saving the same page N times in one drain window costs one path, not N. The debounce
 * Lambda drains that set every ~10s and turns it into ONE targeted invalidation.
 *
 * The guardrail this function adds: if a drain ever finds MORE than
 * `FAST_LANE_WILDCARD_THRESHOLD` distinct paths (a scripted bulk-edit session slipping through
 * the ordinary lane), it collapses to a single `"/*"` wildcard. `/*` bills as ONE path and
 * nukes the whole distribution — cheaper and safer than emitting dozens of targeted paths.
 * This is what stops a stampede from multiplying invalidation volume.
 *
 * @module
 */

/**
 * Distinct-path ceiling before a drain collapses to `/*`. Well under CloudFront's hard limit
 * of 3000 paths per invalidation; chosen for BILLING (free tier is 1000 paths/month), not for
 * the API limit. Ordinary human editing never approaches this in a single ~10s drain window;
 * exceeding it means the change is effectively bulk, so `/*` is the honest answer.
 */
export const FAST_LANE_WILDCARD_THRESHOLD = 30;

/**
 * Normalize a raw list of changed paths for the fast lane: drop non-strings/blanks, guarantee
 * EXACTLY one leading slash (collapsing any accidental `//`), and dedupe while preserving
 * first-seen order.
 *
 * Callers already pass normalized slugs (`revalidate-paths.ts#purgeTargets` guarantees a
 * leading slash), so this is defensive; it is exported for the enqueue side to share. The
 * single-slash collapse matters for BILLING correctness: to CloudFront `//about` and `/about`
 * are two distinct invalidation paths, so a stray double slash would both bill twice and defeat
 * the dedupe below — normalizing to one slash folds them into a single charged path.
 */
export function normalizeEdgePaths(paths: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of paths) {
        if (typeof raw !== "string") continue;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        // Exactly one leading slash: strip every leading slash, then prepend one. `startsWith("/")`
        // alone would preserve `//path` (the reviewer's CACHE-4A/review-2 finding).
        const withSlash = `/${trimmed.replace(/^\/+/, "")}`;
        if (seen.has(withSlash)) continue;
        seen.add(withSlash);
        out.push(withSlash);
    }
    return out;
}

/**
 * Turn an accumulated set of changed paths into the `Paths.Items` of one CloudFront
 * `CreateInvalidation`.
 *
 * - `[]`                       → `[]`      (nothing to invalidate; caller skips the API call)
 * - up to the threshold        → the deduped, slash-normalized paths, verbatim
 * - over the threshold         → `["/*"]`  (collapse to a single wildcard — the guardrail)
 */
export function planEdgeInvalidation(paths: readonly string[]): string[] {
    const normalized = normalizeEdgePaths(paths);
    if (normalized.length === 0) return [];
    if (normalized.length > FAST_LANE_WILDCARD_THRESHOLD) return ["/*"];
    return normalized;
}
