# CACHE-4a: Instant go-live — changed-path CloudFront invalidation for ordinary edits

- **Status:** IMPLEMENTED (2026-08-07 — code complete; staging deploy + live probes are the
  operator's NOT-RUN gate). See § *Implementation record* at the foot of this doc.
- **Track:** CACHE (implementation wave slice 2; ratified scope from cache-4 row,
  human 2026-07-26: "ordinary admin edits invalidate their changed paths immediately —
  instant go-live; the 15-min debounce + banner remain only for bulk/global mutations")
- **Depends:** cache-1/2/3/6/7 SHIPPED

## The gap this closes

An admin edit today: ISR purge is immediate+precise (cache-2), but the EDGE copy waits
for the 15-min debounced `/*` nuke or GO LIVE NOW. The `/*` sledgehammer exists because
per-edit invalidation used to be all-or-nothing; with domain-keyed purge paths already
computed (revalidate-paths.ts), the SAME path list can drive a targeted CloudFront
invalidation immediately — invalidating 1-3 paths per edit is free-tier and disturbs
no other tenant beyond same-path collateral (which refills from warm ISR without SSR).

## Scope

1. `withInvalidation()`/marker flow: ordinary content/product/category mutations
   ALSO enqueue their changed paths (the exact purgeTargets list, as URI paths) for
   immediate CloudFront invalidation. Mechanism choice for the builder (record it):
   direct CreateInvalidation from a single authorized helper Lambda path, or a
   fast-lane marker the debounce Lambda drains on its 10s resolution — but the
   user-visible outcome must be "visible in seconds", not minutes. Respect the IAM
   boundary: CloudFront rights stay confined to the existing authorized functions —
   if the chosen mechanism needs a grant move, STOP and surface it.
2. Bulk/global mutations (imports, theme changes, tenant settings) KEEP the debounced
   `/*` flow and the pending banner — enumerate which handlers are bulk-class and
   record the classification in the doc.
3. Admin banner semantics: ordinary edits no longer show "pending/GO LIVE" (nothing
   is pending); bulk operations still do. Admin UI change is IN scope (banner logic
   only).
4. Invalidation-volume guardrail: per-path invalidations are free to 1000 paths/mo;
   record expected volume math and a coalescing rule (e.g. batch paths per mutation,
   dedupe within a short window) so a bulk-edit session cannot stampede.
5. Docs: caching-architecture invalidation sections rewritten to the new model.

## Non-scope

Tag-based ISR revalidation (cache-4b). Per-tenant distributions. No CDK changes
expected — if one becomes necessary, STOP and surface (standing directive).

## DoD / evidence

Unit tests for path classification + coalescing (pure); staging deploy + live probe:
edit a page → edge serves fresh within seconds WITHOUT GO LIVE NOW (operator gate);
bulk import still debounces; banner behavior verified per class.

## Implementation record (2026-08-07)

**Mechanism chosen: Option B — fast-lane DynamoDB marker drained by the existing debounce
Lambda.** Forced by the no-CDK / IAM-boundary constraint: Option A (direct `CreateInvalidation`
from ~20 mutation Lambdas) needs `cloudfront:CreateInvalidation` granted to all of them = a CDK
change = STOP. The debounce Lambda already holds `grantReadWriteData` +
`cloudfront:CreateInvalidation` (`infra/lib/amodx-stack.ts:313-317`), and mutation Lambdas
already hold `grantReadWriteData`, so this slice is **code-only, zero IAM/CDK change** — verified
against the CDK, not assumed.

**Files changed**
- `backend/src/lib/edge-invalidation.ts` (NEW, pure) — `normalizeEdgePaths`, `planEdgeInvalidation`,
  `FAST_LANE_WILDCARD_THRESHOLD=30`. Test seam, mirrors `revalidate-paths.ts`.
- `backend/src/lib/invalidate-cdn.ts` — `enqueueEdgeInvalidation(paths)`: in one atomic
  UpdateItem, `ADD`s the changed URI paths to `SYSTEM#CDN_FAST_PENDING.paths` (String Set → atomic
  dedupe/coalescing) AND `ADD`s 1 to `SYSTEM#CDN_FAST_PENDING.rev` (generation counter), plus bumps
  `CDN_LAST_CHANGE`. Does NOT write `CDN_PENDING` (no banner). `withInvalidation()` unchanged
  (still bulk).
- `backend/src/lib/revalidate.ts` — `revalidateTenantPaths` now drives both layers from one
  `purgeTargets` list; routing read + edge enqueue moved BEFORE the `RENDERER_URL` gate.
- `backend/src/scheduled/debounce-flush.ts` — `drainFastLane()` each ~10s iteration: consistent
  read of `{paths, rev}` → targeted invalidation → `DELETE` drained members **conditioned on
  `#rev = :rev`** (the generation snapshotted at read). A concurrent enqueue — including a re-edit
  of an already-queued path, invisible at set-membership level — bumps `rev`, fails the condition,
  and the WHOLE marker is retained for a redundant re-invalidation next cycle (never dropped work).
  Removal only after a confirmed-successful CloudFront call. The loop NEVER returns early — neither
  on absent `CDN_PENDING` NOR after a fired bulk `/*` (review-3): the bulk branch is extracted into
  `flushBulkIfDue()`, gated by a `bulkHandled` latch (so `/*` is submitted at most once per
  invocation) and RETURNS A BOOLEAN instead of `return`ing, so the fast lane keeps draining the full
  ~50s polling window (5×10s sleeps between
  6 iterations; EventBridge re-invokes at ~60s, preserving the ~10s inter-drain gap). Pre-review-3
  the bulk branch `return`ed after submit/fail/skip, stranding a path enqueued mid-invocation for a
  full EventBridge tick (~1 min). The bulk `/*` branch clears
  `CDN_PENDING` ONLY after a confirmed-successful CloudFront submit (a throw or a skipped submit
  retains both markers for retry on the NEXT EventBridge invocation) and deliberately does NOT clear
  `CDN_FAST_PENDING`. (Fixes the
  two defects in CACHE-4A/review-0 — dropped-work-on-failure and the fast-marker race — the
  same-path generation race in CACHE-4A/review-1, and the fast-lane-stall-after-bulk in
  CACHE-4A/review-3.)
- 6 ORDINARY handlers de-wrapped (`content/create`, `content/update`, `products/update`,
  `products/delete`, `categories/update`, `categories/delete`) — edge now via the fast lane.
- `admin/src/components/InvalidationBanner.tsx` — copy: "Site-wide changes pending" (bulk only).
- `backend/test/unit/edge-invalidation.test.ts` (NEW) — coalescing + pipeline; plus (review-2)
  a `//about`/`///x` → `/about`/`/x` collapse case proving the "exactly one leading slash" contract.
- `backend/test/unit/debounce-flush.test.ts` (NEW) — bulk-branch marker retention on failed/
  skipped submit + no-fast-marker-delete race, PLUS (CACHE-4A/review-1) fast-lane same-path
  generation race: a stateful DDB mock models the String Set + `rev` + `ConditionExpression`, and
  asserts a same-path edit enqueued mid-drain survives (fails against the old unconditional
  cleanup) and is re-invalidated on the NEXT in-invocation drain, the happy path clears, and the
  cleanup carries `#rev = :rev`. PLUS (CACHE-4A/review-3) a fresh path enqueued the instant a bulk
  `/*` fires gets a targeted invalidation on the next ~10s drain of the SAME invocation (fails
  against the old return-after-bulk). Now uses FAKE TIMERS (`vi.useFakeTimers` + `runHandler()`)
  because the handler no longer returns early and runs its full polling window.
- `backend/test/unit/invalidate-cdn.test.ts` (NEW, review-2) — the ENQUEUE half of the generation
  protocol: `enqueueEdgeInvalidation()` through a mocked `lib/db.ts` proves ONE atomic
  `UpdateCommand` merges the path String Set AND bumps `rev` (`ADD #paths :p, #rev :one`). Closes
  the review-1/2 gap that the drain race test assumed, rather than proved, the writer invariant.
  **102 unit tests pass total** (was 101; +1 review-3 fast-lane-after-bulk regression).
- `docs/caching-architecture.md` — § *Invalidation model (two classes)* (class table + volume
  math) + reconciled every invalidation subsection. Review-2 reconciliations: per-mutation-class
  table header + rationale now state the "known cache path" distinction (`content/create` ordinary
  because its slug may hold a cached `307→?nf=1`, vs `products/create`/`categories/create` bulk);
  volume math reframed as **per path per `CreateInvalidation` submission** (re-billed across drain
  windows and on a bounded `rev`-race retention), not per globally distinct path; the loop duration
  corrected from "~60s / 6×10s" to "~50s (5×10s sleeps)" in the drain, cost, and monitoring text.
- `backend/ARCHITECTURE.md` (review-2) — added `lib/edge-invalidation.ts`; rewrote the pure-unit
  testing section to describe the two credential-free shapes (pure modules vs narrowly-mocked
  AWS-boundary tests) after the structural change.
- `admin/src/components/InvalidationBanner.tsx` (review-2) — banner comment now names
  product/category creation as bulk (not generic "new-entity creation") and records that page
  creation is ordinary.

**Timing note (review-2):** the drain Lambda spans ~50s of wall time per invocation, not 60 — 6
iterations with a 10s sleep *between* them is 5 sleeps. EventBridge re-invokes at the ~60s mark, so
~10-second fast-lane resolution holds *across* invocations, not within one.

**Mutation-class table:** see `docs/caching-architecture.md` § *Invalidation model → Per-mutation-class table*.

**Review-4 reconciliations (docs/evidence only, no code change):**
- `docs/testing-strategy.md` current-estate backend row corrected from "3 files … 51 tests" to the
  measured **8 files / 102 tests** (adds `email-from` (`email-hotfix-1`), `email-key-normalization`
  (`fnd-2`), and the three `cache-4a` suites); header re-measure date bumped to 2026-08-07.
- `docs/caching-architecture.md` Lambda **cost claims corrected** at both sites (the `**Cost**`
  paragraph and the *Debounce Lambda* table). The prior "well under a dollar" / "< $0.10/month"
  figures were false: at 256 MB (verified `infra/lib/amodx-stack.ts` `DebounceFlushFunc`), 43,200
  invocations/mo × ~50 s × 0.25 GB ≈ **540,000 GB-s/mo**; minus the 400,000 GB-s always-free tier =
  140,000 billable GB-s ≈ **$2.33/mo** compute (floor, this function alone claiming the free tier),
  up to ≈$9/mo if the account-wide tier is consumed elsewhere. Requests free (43,200 ≪ 1M/mo).
- Full-workspace `npm run build` (shared → effects → plugins → backend → admin → renderer → mcp →
  infra) run to completion as BUILDER-EXECUTED evidence (prior report covered only backend build +
  admin typecheck). `npm run typecheck` (all workspaces) and `git diff --check` also re-run clean.

**Deferred (recorded, not built):** `reviews/*` and `content/restore` stay bulk (keyed by
id, not slug — resolving the slug is an unbudgeted extra read); `products/create` /
`categories/create` stay bulk (a brand-new URL has no cached edge entry of its own). A transient
failure of the pre-gate routing read leaves an ordinary edit un-invalidated for that cycle
(bounded; self-heals next edit / GO LIVE NOW).
