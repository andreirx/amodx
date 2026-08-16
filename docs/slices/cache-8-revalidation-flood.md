# CACHE-8: Stop scanner junk from drowning the SWR refresh pipeline

- **Status:** IMPLEMENTED (code complete; production/operator gate NOT RUN — the patch is
  uncommitted and the deploy runbook's pre-deploy gate has not been executed against prod).
  Investigation complete (source-cited, open-next 3.1.3); **MITIGATION (c) IMPLEMENTED
  (pinned open-next patch, REVISE 2); (a),(b),(d) DEFERRED.** (c) bounds the edge-staleness
  *symptom* to 5 min; the *flood itself* (junk enqueue + failures) is still UNMITIGATED in code —
  interim lever stays the manual S3-delete + CloudFront `/*`. The durable flood fix is out of this
  slice's hard constraints (no fork, no CDK): it is `opennext-1` and/or a ratified queue-config change.
  - **Revision 5 (operator `cache8-c2-guard-mechanism`, human-ratified 2026-08-16).** The (c2)
    guard is now TWO LAYERS. LAYER 1 (unchanged) = serving row `(c2)`: reads the INSTALLED open-next
    source, runs in CI (`npm run test:serving`), catches a skipped `postinstall` in ms. LAYER 2 (new)
    = `scripts/verify-opennext-patch.mjs`: builds (if needed) the exact `.open-next` server bundle CDK
    uploads and asserts the patched `s-maxage=2, stale-while-revalidate=300` survives `open-next build`
    while no comma-space fixISRHeaders 30-day form does — proving the property LAYER 1 cannot (that
    bundling preserved the string). EXECUTED this revision → `guard: OK` (exit 0). Placement: manual /
    deploy-runbook gate (`docs/runbooks/deploy-track-cache.md` § Preconditions), NOT CI (`open-next
    build` is multi-minute and CI does not already run it). A full Lambda-invoke harness was explicitly
    NOT built (grep of the shipped artefact proves the same emitted-header property). Confirmed side
    finding, already documented: the built bundle retains exactly ONE `2592000` — `fixSWRCacheHeader()`'s
    replace-target (util.js:264), a no-op for this deployment (renderer ISR pages are `revalidate=false`,
    so Next emits no bare SWR) — which the LAYER-2 script accounts for rather than false-failing on.
  - **Revision 4 (operator `cache8-mitigation-c-resolution = B`, human-ratified 2026-08-16).**
    Mitigation (c) lands as a PINNED-DEPENDENCY PATCH, not a fork: `patches/open-next+3.1.3.patch`
    (applied by root `postinstall: patch-package`) rewrites `fixISRHeaders()`'s edge SWR window
    (`util.js:386` HIT-recompute, `:396` STALE-serve) `stale-while-revalidate=2592000 → =300`.
    Trade-off recorded: more origin renders after the 300 s window. GUARD: serving row `(c2)` asserts
    the patched `300` in the bundled `dist/core/routing/util.js` (the harness serves via `next start`,
    not the open-next bundle, and `fixISRHeaders` can't be imported standalone — so the guard asserts
    the shipped source artefact `open-next build` bundles; a skipped `postinstall` or an open-next
    upgrade fails the suite loudly). `opennext-1` un-parking must re-evaluate this patch. Junk
    re-enqueue-forever (mitigation a/b) stays DEFERRED (open-next/CDK-gated). This supersedes the
    Revision-3 DECISION below (which concluded (c) had no in-scope lever — option B provided one).
  - **Revision 2 (review-1 → revise): mitigation d (middleware scanner shield) WITHDRAWN.** A `.php`
    door-level shield was implemented in revisions 0–1, then removed because the claim that `.php`
    is "provably never a tenant page" is **false**. Counterexample (code-confirmed): tenant IDs are
    arbitrary strings (`backend/src/tenant/create.ts`, `@amodx/shared`) and `getTenantConfig()`
    resolves a bare `SYSTEM / TENANT#wk`; `content/update.ts` persists an unsanitised slug
    (`/index.php` → `ROUTE#/index.php`). So `/wk/index.php` renders a legitimate **200** that the
    shield would `404`. While the first path segment can be any tenant ID and the remainder any
    persisted route, **no path shape at the middleware layer is disjoint from content**, so no
    conservative shield exists. `renderer/middleware.ts` now carries **no** scanner shield.
    Serving-contract rows updated: `(h1)` pins the counterexample (renders 200; goes red if a
    `.php`/scanner shield is re-added), `(h2)` pins the unmitigated state (a scanner path with no
    route still mints the ordinary cacheable `307`). Revision-1 history: review-0 narrowed an
    extension-less denylist to `.php`-only; review-1 then defeated `.php` itself.
  - Deliberately NOT implemented (each source-cited in the caching doc + TECH-DEBT): (a) unachievable
    without forking open-next (enqueue reads incremental-cache STALE state, not a render-controlled
    header); (b) CDK/queue-config change → slice STOP-on-CDK; (c) open-next runtime constant (fork)
    or CloudFront header policy (CDK) — renderer ISR pages are all `revalidate=false`, so it is not
    a renderer-source knob. Full trace: `docs/caching-architecture.md` § "The SWR revalidation queue
    and the scanner-junk flood (cache-8)".
  - **Revision 3 (operator `cache8-remediation-scope` resolution, 2026-08-16).** Scope AMENDED to
    what is safe and possible. Delivered this revision:
    1. Investigation KEPT, with the review-2 correction applied: open-next 3.1.3 has TWO
       `queue.send` sites; `cacheInterceptor.js:49` is gated by `dangerous.enableCacheInterception`,
       which `renderer/open-next.config.ts` leaves undefined (OBSERVED), so **`util.js:312`
       (`revalidateIfRequired`) is the active enqueue site FOR THIS DEPLOYMENT**. Scanner shield
       stays WITHDRAWN permanently (unconstrained tenant slugs make pattern-blocking unprovable-safe).
       `(h1)` legit-arbitrary-slug safety test KEPT.
    2. Mitigation (c) attempted concretely via Next `expireTime` — **VERIFIED NO-OP and reverted.**
       Next emits `stale-while-revalidate` only when `revalidate` is a number < expire
       (`cache-control.js:13`); all renderer ISR pages are `revalidate=false`, so no SWR directive
       exists for `expireTime` to size. MEASURED in the serving harness: header byte-identical
       (`s-maxage=31536000`, no SWR) with/without `expireTime`. Pinned by new serving row `(c1)`. The
       edge `swr=2592000` is an open-next `fixISRHeaders` constant (`util.js:386-396`), unreachable
       by any Next config. **DECISION `cache8-mitigation-c-resolution` RESOLVED (option B, 2026-08-16)
       — SUPERSEDED by Revision 4 above:** (c) was not achievable *via a Next config* in-scope, but a
       pinned-dependency patch of that open-next constant IS in-scope and this revision delivers it.
    3. Root-cause Q3 ANSWERED against prod (read-only CloudWatch + DynamoDB): **every failing record
       is a no-route path** (scanner junk + phantom/renamed-draft slugs); **no genuinely-published
       page fails** (the published article has 0 failures; the failing look-alike has no `ROUTE#`).
       The "frozen stale" symptom on real pages is the CloudFront 30-day SWR re-pin, not queue
       starvation. Diagnosis needs no forbidden boundary; the remedy (bound the SWR window) does →
       STOP. The double-rewrite hypothesis was tested and refuted. Full trace: caching-doc §
       "Root-cause Q3 (prod-log VERIFIED)".
    4. Junk-eviction (mitigation a) stays DEFERRED with the finding documented (needs open-next
       change — parked).
- **Status (original):** PLANNED
- **Track:** CACHE
- **Evidence:** TECH-DEBT 2026-08-16 entry (live-diagnosed): RevalidationFunction
  1,104 failures/12h dominated by bot-scanner URLs (/wk/index.php etc); legitimate
  SWR grid refreshes never complete; CloudFront's own swr (2592000) re-pins stale
  copies at the edge (observed age=194 on s-maxage=2).

## Root-cause questions (investigate FIRST, cite source/logs)

1. WHY do 404-class/nf-handoff URLs enter the revalidation queue at all? Trace the
   enqueue path in the installed open-next 3.1.3 (node_modules source, verify don't
   assume): what marks a rendered response for background revalidation, and what do
   the nf-handoff 307s / scanner-path renders emit that qualifies them?
2. Why do those revalidations FAIL (the "Failed to revalidate" reason for e.g.
   /wk/index.php) — and does a failing record retry/park and starve the FIFO group?

## Scope (smallest set that makes the pipeline junk-proof — pick per findings)

Candidates, in preference order — implement what the investigation supports:
a. Prevent junk from qualifying: ensure 404/nf-handoff responses carry headers/state
   that open-next does NOT enqueue for revalidation (e.g. their cache-control /
   x-nextjs-cache disposition), so scanner paths never enter the queue.
b. Make failures harmless: if (a) is impossible without forking open-next, ensure a
   failed revalidation cannot starve other work (queue/group semantics; source-cite
   what is configurable).
c. Bound the edge staleness: reduce the swr window Next emits for SWR pages
   (fetch-level revalidate config in the post-grid path) from 2592000 to a bounded
   value (e.g. 300s) so even a broken refresh self-limits at the edge. Record the
   trade-off (edge misses after the window).
d. Optional cheap shield: middleware short-circuits known scanner patterns
   (*.php, /wp-*, /wk/*) with a plain 404 no-store BEFORE any render/ISR machinery —
   zero cost, kills the junk at the door. Justify pattern list conservatively
   (never block legitimate tenant slugs — document the patterns + a test proving a
   normal slug passes).

## Non-scope

No open-next fork/upgrade (parked); no CDK unless a queue setting demands it (STOP);
no per-tenant distributions.

## DoD / evidence

Investigation findings source-cited; implemented mitigations each with tests
(serving suite grows: scanner path → 404 no-store, never enqueued — assert via the
harness's queue observation if reachable, else the response-disposition contract);
serving+unit+typecheck green. Operator gate (NOT RUN): post-deploy, RevalidationFunction
error rate collapses and a grid refresh completes within its window without manual purge.
