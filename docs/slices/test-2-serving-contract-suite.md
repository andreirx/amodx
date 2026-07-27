# TEST-2: Serving-contract characterization suite (renderer)

- **Status:** PLANNED
- **Track:** TEST
- **Depends:** test-1 (CI exists to run it); cache-1/2/3 committed (the contract)
- **Source:** `docs/testing-strategy.md` §2; `docs/caching-architecture.md`
  §Measured serving behaviour + §Serving contract
- **Maturity target:** MATURE

## Purpose / risk retired

The serving contract exists only as prose + one-off probe transcripts. Any future
renderer change can silently regress it (dynamic-API leak, cacheable 404, Set-Cookie on
cacheable HTML, nf-loop). This slice makes the contract executable: a committed suite
that fails when the measured behavior drifts.

## Scope

`renderer/test/serving-contract/` + `npm run test:serving` (renderer workspace):

1. Harness: build once (`next build`), start `next start` on an ephemeral port with a
   LOCAL DynamoDB stub (in-process HTTP stub serving fixture tenants/pages — no real
   AWS, no credentials; the cache-1 relay byproduct harness is prior art and may be
   adapted — it is NOT committed anywhere, reimplement/import deliberately).
2. Assertions (each = one measured row; cite the doc section it pins):
   a. published page: MISS then HIT, `s-maxage`, zero stub reads on HIT, no Set-Cookie
   b. `?page=2` / session-cookie request: `private, no-cache, no-store`
   c. unknown host: 404 + no-store, no render
   d. known tenant missing page: 307→`?nf=1`→404 no-store; the `?nf=1` request never
      loops
   e. read failure AFTER tenant resolution (stub throws): 500, NO Cache-Control,
      nothing cached; next healthy request caches
   f. `?preview=true`: no-store, renders
   g. `/api/*` responses never cacheable
3. Runtime budget: suite < ~3 min (one build, one server, sequential curls).
4. CI: separate job or same workflow after unit gates (still credential-free).
5. `docs/testing-strategy.md` + `docs/caching-architecture.md` note: the suite is the
   executable form of the contract; changes to serving behavior must update both.

## Non-scope

- No CloudFront/warm-edge probes (post-deploy runbook, operator).
- No OpenNext-Lambda-bundle harness (valuable; separate slice if wanted).
- No playwright changes (stale 404 spec is test-5 scope or ride-along ONLY if the fix
  is a direct consequence of asserting the new contract — record the decision).

## Definition of Done

1. Suite exists, credential-free, green from bare checkout, < ~3 min.
2. Each assertion maps to a documented measured behavior (comment references).
3. Mutation check: reintroducing a dynamic-API call on the ISR route (temporary local
   edit, reverted) makes the suite FAIL — proven in the build report.
4. CI runs it.

## Evidence

- `EXECUTED`: suite run transcript (all assertions, timing).
- `EXECUTED`: the mutation check (fail demonstrated, revert verified).
- `NOT RUN` (operator): CI run on push.
