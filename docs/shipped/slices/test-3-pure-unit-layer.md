# TEST-3: Pure unit layer for existing pure logic

- **Status:** SHIPPED 2026-07-28 — deployed to production by the human, verified live (staging probe suite + prod probes: bijup.com s-maxage/Hit/age, session bypass, nf no-loop)
- **Track:** TEST
- **Depends:** test-1 (CI), test-2 (pattern precedent)
- **Source:** `docs/testing-strategy.md` §1
- **Maturity target:** MATURE

## Purpose / risk retired

Pure logic that guards platform invariants has zero unit coverage outside backend's
one file. This slice adds fast, credential-free vitest suites for pure logic that
EXISTS today. (normalizeEmail arrives with fnd-1; the video parser with vid-1 — not
here.)

## Scope

1. `packages/shared`: vitest harness + tests for the Zod schemas' invariant-bearing
   parses (tenant config shape incl. `domain` singular + `urlPrefixes`; content status
   enum; order status enum; IntegrationsSchema). Pin what the schemas ACCEPT and
   REJECT — these are the contracts every workspace trusts.
2. `renderer`: unit tests (plain vitest, no server) for `lib/tenant-directory.ts`
   (verdict cache TTL/bound/fail-open logic — inject clock/lookup), `lib/not-found-handoff.ts`
   (URL construction, NOT_FOUND_PARAM), `lib/revalidate`-adjacent pure helpers if any.
   Do NOT duplicate what test-2's serving suite already pins end-to-end — unit tests
   here cover the pure branches (TTL expiry, cache bound eviction, error fail-open)
   the wire probes can't reach cheaply.
3. `backend`: extend `test/unit/` only where pure helpers exist untested (e.g.
   invalidate-cdn marker-shaping if pure parts are extractable WITHOUT refactoring —
   if a seam would require refactoring src, SKIP and note it; no src changes).
4. CI: add the new suites to the existing unit gate (same jobs, no new secrets).
5. `docs/testing-strategy.md` estate table updated.

## Non-scope

- NO src changes anywhere (if logic isn't testable without a refactor, record it).
- No admin component tests (needs RTL setup — later slice). No e2e/playwright.
- No normalizeEmail (fnd-1), no videoSource (vid-1).

## Definition of Done

1. `packages/shared` and `renderer` have `test` scripts running green, credential-free.
2. Each suite documents which invariant/contract each describe-block pins.
3. CI runs them; runtime addition < ~30s total.

## Evidence

- `EXECUTED`: each workspace's test run transcript + root typecheck + build green.
- `NOT RUN` (operator): CI run on push.
