# TEST-5: Deployed-staging e2e for the review import→moderate→display flow

- **Status:** IMPLEMENTED 2026-08-09 (revised same day — 3 operator corrections + review-0..review-5
  fixes applied). Code complete: a green 3-test round-trip against deployed staging (transcript below,
  builder-EXECUTED via `npm run test:e2e:staging`) now covers STAGED-image isolation, a fail-red
  NAMESPACE-COMPLETE cleanup assertion, and a manual `workflow_dispatch` CI job. review-4 made the
  invocation DETERMINISTIC: the gate env var is now baked into the `test:e2e:staging` npm script (single
  source), so opening the gate no longer depends on an inline shell env prefix reaching the Playwright
  worker. review-5 made the per-run namespace COLLISION-RESISTANT: the tenant/product suffix is now a
  `crypto.randomUUID()` `runId` (not `Date.now()`), so two manual jobs dispatched in the same millisecond
  can no longer pick the same namespaces and have their cleanup sweeps delete each other's data on shared
  staging. Validation still PENDING before SHIPPED: the two new CI secrets (`TEST_ADMIN_USER` /
  `TEST_ADMIN_PASSWORD`) must be configured on the manual staging-e2e job and the job dispatched green. Stays in `docs/slices/` until it reaches `SHIPPED`; do not move to
  `docs/shipped/slices/` yet (per `docs/documentation.md` location rules).
- **Track:** TEST
- **Depends:** REV track (shipped); the existing Playwright harness + .env.test admin
- **Source:** batch-A staging pass gap — the authenticated write round-trip was
  verified by hand, not by suite. This automates it (and would have auto-caught the
  reserved-keyword `source` 500 that reached staging live).

## The gap it closes

Code-level fixture E2E (`review-import-fixture.test.ts`) proves the LOGIC with mocked
S3/DDB + a simulated email identity. It cannot prove the flow survives real AWS auth,
IAM, S3, and DynamoDB reserved-keyword enforcement. A real-admin staging round-trip can.

## Scope

1. **Auth:** reuse the existing staging test admin (`admin@staging.amodx.net`, creds in
   `.env.test`). Two setup steps, staging-only, idempotent (script or documented):
   (a) ensure `custom:role=GLOBAL_ADMIN` on that user; (b) obtain a token — prefer
   Playwright through the real admin UI SRP login (matches `content-rendering.spec`,
   zero infra change). If UI-login proves too brittle, the fallback is enabling
   `ADMIN_USER_PASSWORD_AUTH` on the STAGING admin app-client only (documented,
   staging-scoped) — decide in-slice, record which.
2. **Round-trip against DEPLOYED staging:** POST a fixture CSV + small ZIP (real image
   bytes) to `/import/reviews` with a real attestation → assert ImportBatch written,
   review pending, image staged PRIVATE (assert the staged key is NOT publicly
   fetchable via the asset CDN); approve the review + image → assert promotion to
   public + `/public/reviews/{id}` returns it (this exercises the real DynamoDB
   projection — the layer that hid the `source` bug from unit tests).
3. **Isolation:** a second tenant cannot read/promote the first tenant's staged image.
4. **Cleanup:** delete all test-created items (batch, reviews, staged+public objects)
   — staging is shared; leave no orphans (follow the existing test cleanup pattern).
5. CI: separate job, NOT in the credential-free gate (needs staging creds); run
   on-demand / pre-deploy, documented.

## Non-scope

Connectors (rev-5/6); no prod runs; no change to the review feature itself.

## DoD / evidence

EXECUTED green round-trip transcript against deployed staging incl. the private→public
promotion assertion and the isolation check; cleanup verified (no residual test items).

## Execution record (2026-08-09, revised same day — 3 operator-resolved corrections)

**Files:** `tests/e2e/review-flow.spec.ts` (the suite — `runId = crypto.randomUUID()` namespace, review-5),
`tests/e2e/support/staging-admin.ts` (token mint + staging-resource resolution with the prod/staging
safety guards), `.github/workflows/staging-e2e.yml` (the authorised manual CI job — revise-1),
`package.json` (root `test:e2e:staging` script — the deterministic canonical invocation, review-4).
No backend/infra edits.

**Revise-cycle resolution (2026-08-09):**
- **revise-1 (CI scope):** the original "no CI edits" was wrong against the slice's own step-5 DoD.
  Added a NEW workflow file `.github/workflows/staging-e2e.yml` with `on: workflow_dispatch` (manual,
  credentialed) running exactly the on-demand command below. It mirrors how `playwright.yml` injects
  AWS creds and adds the two NEW secrets `TEST_ADMIN_USER` / `TEST_ADMIN_PASSWORD`. It is NOT in the
  push/PR gate and the existing `playwright.yml` jobs are untouched.
- **revise-2 (cleanup fails red on residue):** the post-cleanup verification is now an ASSERTION.
  `afterAll` collects a `problems[]` of any namespace that still has RESIDUAL items — OR whose count
  cannot be obtained (UNVERIFIABLE, fail-closed) — and ends with `expect(problems).toEqual([])`. A leak
  turns the run RED even when every test passed. (Mechanism verified with a throwaway probe: a non-empty
  `problems` list in `afterAll` fails the Playwright run.)
- **revise-3 (isolation exercises a STAGED, pre-promotion image):** the suite was reordered into the
  real lifecycle. Test 1 imports and STOPS pre-promotion (image staged private, review pending).
  Test 2 — the real gap — asserts tenant B can neither presign-view (`image-view-url` → 404) NOR
  approve/promote (`approve-image` → 404, no cross-tenant copy to public) tenant A's STAGED pending
  image, with the owner's `kind="staged"` view as the same-detector positive control (proving we are
  genuinely pre-promotion) and a re-check that B's blocked attempt left the image untouched. Only
  THEN (test 3) does the owner promote, the real DDB projection is checked, and post-promotion row
  isolation stays as the retained SECOND assertion. Test names renamed to match this behaviour.

**Review-0 fixes (2026-08-09):**
- **Locked the setup helper to the mandated admin.** Before any mutation, `staging-admin.ts` asserts
  the configured `TEST_ADMIN_USER` equals `admin@staging.amodx.net` (guard 3a), so a misconfigured CI
  secret cannot point the mint/elevation at another staging user.
- **Valid slice status.** Uses `IMPLEMENTED` (per `docs/documentation.md` taxonomy), not the
  undefined `EXECUTED`.

**Review-1 fixes (2026-08-09):**
- **Fail closed on a missing/absent Cognito `email` attribute.** `staging-admin.ts` guard 3b previously
  read `email ?? user`, so an account with NO `email` attribute passed (the username was substituted).
  Now the helper reads the ACTUAL `email` attribute with NO username fallback and requires it PRESENT
  and equal to `admin@staging.amodx.net` before elevation/mint. Rationale: the import attestation gate
  runs on the id-token's `email` claim, which Cognito populates from this attribute; an emailless
  account must fail closed, not be masked.
- **Namespace-complete cleanup, including failure paths.** The old cleanup deleted only the ids the
  import RESPONSE surfaced, so a batch/staged object written before a mid-import failure (the handler
  writes the batch before row processing, and permits row failures after staging) could be orphaned.
  `afterAll` now (a) still exercises the real `DELETE /reviews/{id}` handler, then (b) SWEEPS both
  per-run tenant namespaces — a single-partition DynamoDB `Query` on `PK = TENANT#<tenant>` (scoped,
  NOT a Scan → no-scan rule holds) and `ListObjectsV2` bounded to this run's unique S3 key prefixes
  (`review-staging/<tenant>/` in the private bucket, `<tenant>/` in the public bucket) — deleting every
  object found. The verification then RE-COUNTS each namespace and asserts ZERO remain. tenant B is
  swept too, so a hypothetical cross-tenant write becomes a caught leak rather than a silent orphan.

**Review-2 fixes (2026-08-09):**
- **Strict-typed the Cognito app-client rebuild (no `unknown` cast).** `staging-admin.ts`'s
  `updateInputFrom` previously built a `Record<string, unknown>` and force-cast it to
  `UpdateUserPoolClientCommandInput` (TS2352 under `--strict`). It now destructures the read-only fields
  (`ClientSecret`/`LastModifiedDate`/`CreationDate`) out of the described client and supplies the
  required `UserPoolId`/`ClientId` explicitly from the already-safety-verified stack outputs, so the
  return is properly typed with no cast. Removing the cast surfaced a real masked mismatch —
  `ExplicitAuthFlows` is `ExplicitAuthFlowsType[]` (a literal union), not `string[]` — so `PASSWORD_FLOW`
  and the `flows` parameter are now typed `ExplicitAuthFlowsType`. Targeted `tsc --strict` on the helper
  is clean.
- **Corrected the test-count evidence.** The spec has **3 test cases**, but `playwright.config.ts`
  declares **3 projects** (chromium/firefox/webkit), so `--list` reports **9** tests and a
  project-unscoped run addresses all 9. The run/skip lines below now state the real counts
  (`--project=chromium` → 3; bare → 9) instead of the earlier bare-command "3 skipped".

**Review-4 fix (2026-08-09) — deterministic gate + fresh EXECUTED run:**
- **Symptom (review-4):** the reviewer ran the previously-documented `STAGING_E2E=1 … npx playwright test …`
  and observed **3 skipped** — the gate stayed closed even though the env assignment was present, so no
  round-trip executed and DoD could not be established against the final tree.
- **Diagnosis:** the gate itself (`RUN = process.env.STAGING_E2E === "1"`, spec line 42) is correct and,
  probed in isolation, opens when the var reaches the worker. The fragility was the **invocation**: an
  inline `VAR=1 <cmd>` shell prefix must survive shell parsing → the `npx` wrapper → the Playwright worker
  spawn, and any break in that chain (shell quoting, a reporter/CWD difference, a wrapper that resets env)
  silently yields an all-skipped run that still exits 0 — indistinguishable from success unless you read
  the skip count.
- **Fix:** removed the inline-env dependency. Added a root-`package.json` script
  `test:e2e:staging` = `STAGING_E2E=1 playwright test review-flow --project=chromium --workers=1`, so the
  gate var is set *by the script* (single source), and pointed both operators and the `workflow_dispatch`
  job at that one script. Nothing an operator/CI shell has to thread correctly.
- **Evidence:** `npm run test:e2e:staging` → **3 passed** against deployed staging (superseded by the
  review-5 run below). Safe default re-confirmed on the final tree: `npx playwright test
  review-flow` → **9 skipped**, `--project=chromium` → **3 skipped**.

**Review-5 fix (2026-08-09) — collision-resistant per-run namespace + dead-buffer removal:**
- **Symptom (review-5):** the per-run tenant/product suffix was `Date.now()` (`review-flow.spec.ts:46`).
  Two manually-dispatched `workflow_dispatch` jobs that START in the same millisecond would select the
  SAME `e2e-rev-{a,b}-<stamp>` namespaces; their mandatory cleanup sweeps (`ddbDeletePartition` /
  `s3DeletePrefix`) would then delete EACH OTHER's data on shared staging — contradicting the comments'
  claimed concurrent-run isolation and risking a misleading green/red.
- **Fix:** replaced the timestamp with one cryptographically collision-resistant identifier —
  `const runId = randomUUID()` (`node:crypto`) — used consistently for `tenantA`, `tenantB`, and
  `productId`. Two runs now share a namespace only on a 122-bit UUID collision (effectively never), so
  concurrent manual dispatches are genuinely isolated and no sweep can cross runs. Comments/docs that
  called the suffix `<stamp>` updated to `<runId>`.
- **Also (review-5 #2):** removed the unused transcript buffer `T` (it accumulated lines that were never
  read — `console.log` already IS the emitted artifact). `log()` now just writes to stdout; no dead state.
- **Evidence:** `npm run test:e2e:staging` → **3 passed (9.7s)** against deployed staging (fresh
  transcript below, builder-EXECUTED, `runId=a7d67de6-…`). Strict `tsc` on the spec + helper clean;
  `--list` (chromium) discovers exactly 3; safe default `--project=chromium` (no env) → **3 skipped**.

**Run command (on-demand / pre-deploy, or the `workflow_dispatch` CI job) — ONE canonical, deterministic
invocation (review-4):**
```bash
npm run test:e2e:staging     # root package.json — BAKES IN STAGING_E2E=1
```
The script is `STAGING_E2E=1 playwright test review-flow --project=chromium --workers=1`. Because the
gate env var is set **by the script itself**, opening the gate no longer depends on an operator/CI shell
threading an inline `STAGING_E2E=1` assignment all the way to the Playwright worker process — the exact
indirection that produced a spurious all-skipped run in review. The `workflow_dispatch` CI job and every
operator now run this one script; AWS creds + admin secrets are still supplied by the environment
(`.env.test` locally, repo secrets in CI).

Result: **3 passed (9.7s)** (review-5 run via `npm run test:e2e:staging`, builder-EXECUTED against
deployed staging — fresh transcript below). 3 test cases, Chromium only. `playwright.config.ts` declares
**3 browser projects** (chromium/firefox/webkit), so a project-unscoped `--list` reports **9** discovered
tests (3 × 3); the script pins `--project=chromium --workers=1` so the shared-staging round-trip mutates
once per case, not thrice.

Credential-free gate stays safe — the suite self-skips unless `STAGING_E2E=1`, so it never runs in the
push-triggered `playwright.yml` E2E step (which sets neither `STAGING_E2E` nor AWS creds).
OBSERVED-skipped (review-4, final tree): `npx playwright test review-flow` (no env, all 3 projects) →
**9 skipped**; `npx playwright test review-flow --project=chromium` (no env) → **3 skipped**.

**Decisions recorded:**
- **Token approach = the slice's ratified fallback (1b).** The staging admin app-client is SRP-only,
  and a headless one-shot cannot reliably drive the admin SPA's SRP login DOM (the slice's "too
  brittle" case), nor add a Node SRP dependency (outside the writable surface). So the helper
  temporarily adds `ALLOW_ADMIN_USER_PASSWORD_AUTH` to the STAGING admin app-client,
  `AdminInitiateAuth`s, and REVERTS ExplicitAuthFlows to the exact prior set in a `finally` (revert
  VERIFIED each run; confirmed `[ALLOW_CUSTOM_AUTH, ALLOW_REFRESH_TOKEN_AUTH, ALLOW_USER_SRP_AUTH]`
  after). A full client-config round-trip means only the flow list changes, for the few hundred ms
  of the mint. This is the documented, idempotent, staging-scoped change the slice authorised.
- **`custom:role=GLOBAL_ADMIN`** is set on `admin@staging.amodx.net` and LEFT set (step 1a) — the
  test admin's intended, documented staging role; idempotent on re-run.
- **Shared-account hazard (not anticipated by the slice, handled):** prod + staging live in ONE AWS
  account (`324037297014`), resources suffixed `-staging`, and ambient creds are account-admin.
  Every id the helper uses is resolved from `AmodxStack-staging` CFN outputs and hard-checked: CFN
  StackId account == `amodx.staging.json`, stack Region output == config region, and `.env.test`
  `ADMIN_API_URL` host + `TABLE_NAME` == this stack's Api host + TableName. Prod has a distinct Api
  host (`vppjxqrc3c…`) and table (`AmodxTable`), so a misconfig THROWS before any mutating call.
- **Why a real admin token (not the existing specs' master key):** the import handler fails closed
  on identity — the master key authenticates as the emailless `system-robot`, which the attestation
  identity gate 403s. This is the exact reason the flow had no suite before.
- **401 discovery:** the parent-stack authorizer's `identitySource` requires BOTH `Authorization`
  AND `x-api-key` present, or API Gateway 401s without invoking it. The spec sends a present-but-
  non-matching `x-api-key` so the authorizer falls through to Cognito JWT verification.

**Redacted transcript (secret values never emitted) — review-5 run via `npm run test:e2e:staging`,
`--reporter=list`. Non-secret run ids shown verbatim; the token/password/api-key/client-secret are never
logged (the helper and spec log only ids, keys, statuses, and HTTP codes). Namespace suffix is now the
per-run `runId = crypto.randomUUID()` (`a7d67de6-cdff-4da7-92e3-c59a83de9ee6`), not a timestamp:**
```
──────────────────────────────────────────────────────────────────────────────────────────
TEST-5 REVIEW IMPORT → MODERATE → DISPLAY — DEPLOYED-STAGING E2E TRANSCRIPT
──────────────────────────────────────────────────────────────────────────────────────────
[safety] verified staging: account=324037297014 region=eu-central-1 table=AmodxTable-staging
[safety] .env.test ADMIN_API_URL + TABLE_NAME match AmodxStack-staging (prod has distinct ids)
[setup] custom:role already GLOBAL_ADMIN
[token] temporarily enabled ALLOW_ADMIN_USER_PASSWORD_AUTH on staging app-client
[token] reverted app-client auth flows to prior set: VERIFIED
[token] minted admin id-token for admin@staging.amodx.net (GLOBAL_ADMIN) — value redacted
[input] tenantA=e2e-rev-a-a7d67de6-cdff-4da7-92e3-c59a83de9ee6  tenantB=e2e-rev-b-a7d67de6-cdff-4da7-92e3-c59a83de9ee6  productId=prod-e2e-a7d67de6-cdff-4da7-92e3-c59a83de9ee6

# TEST 1 — import → staged PRIVATE + review PENDING (pre-promotion)
[1 · POST /import/reviews] tenant=e2e-rev-a-a7d67de6-cdff-4da7-92e3-c59a83de9ee6 → HTTP 200
  batchId=dbe254ba-ce1a-4263-aebe-8f5c369ec3b3  reviewId=ec223a79-cb76-46a8-a81a-d5da78203426
  staged image key (PRIVATE): review-staging/e2e-rev-a-a7d67de6-.../dbe254ba-.../f8b81b9f-.../original
[2 · DDB] ImportBatch present=true  attestedBy=admin@staging.amodx.net
[3 · DDB] Review status=pending source=imported image[0].status=pending
[4 · CDN absence] GET public-CDN/<staged key> → HTTP 403 (expect 403/404: private)
  ✓ 1 import stages the image PRIVATE + review PENDING (pre-promotion) (2.9s)

# TEST 2 — isolation on the STAGED (pending, pre-promotion) image  ← the revise-3 gap
[5a · GET image-view-url as OWNER tenantA] → HTTP 200 (control: 200)
  owner view kind=staged status=pending (proves image is still STAGED/private)
[5b · GET image-view-url as OTHER tenantB, STAGED image] → HTTP 404 (expect 404)
[5c · PUT approve-image as OTHER tenantB, STAGED image] → HTTP 404 (expect 404, no cross-tenant promotion)
[5d · GET image-view-url as OWNER tenantA after B's blocked attempt] kind=staged status=pending (untouched)
  ✓ 2 tenant isolation on the STAGED pending image (1.1s)

# TEST 3 — owner promotes staged→PUBLIC; real DDB projection; post-promotion isolation (2nd assertion)
[6a · PUT /reviews/{id}] status=approved → HTTP 200
[6b · PUT /reviews/{id} approve-image as OWNER] → HTTP 200
  promoted → publicKey=e2e-rev-a-a7d67de6-.../6a4681b0-...-b6dd14ebcfd5.png  assetId=6a4681b0-...
[7 · GET /public/reviews/{productId}] → HTTP 200
  item present=true  source=imported  images=[{"assetKey":"e2e-rev-a-a7d67de6-.../6a4681b0-....png"}]  avg=5
[8 · CDN boundary] promoted public key → HTTP 200 (control: 200)   staged key → HTTP 403 (absence)
[9a · GET image-view-url as OWNER tenantA post-promotion] → HTTP 200 kind=public (control: 200)
[9b · GET image-view-url as OTHER tenantB post-promotion] → HTTP 404 (expect 404)
[9c · PUT approve-image as OTHER tenantB post-promotion] → HTTP 404 (expect 404)
  ✓ 3 owner approval promotes staged→PUBLIC; post-promotion isolation holds (1.8s)

[cleanup] tenants=e2e-rev-a-a7d67de6-…,e2e-rev-b-a7d67de6-… — namespace sweep of all TEST-5 items
[cleanup] DELETE /reviews/{id} (real handler) — ok
[cleanup] DDB sweep TENANT#e2e-rev-a-a7d67de6-cdff-4da7-92e3-c59a83de9ee6 — ok
[cleanup] DDB sweep TENANT#e2e-rev-b-a7d67de6-cdff-4da7-92e3-c59a83de9ee6 — ok
[cleanup] S3 sweep private review-staging/e2e-rev-a-a7d67de6-cdff-4da7-92e3-c59a83de9ee6/ — ok
[cleanup] S3 sweep private review-staging/e2e-rev-b-a7d67de6-cdff-4da7-92e3-c59a83de9ee6/ — ok
[cleanup] S3 sweep public e2e-rev-a-a7d67de6-cdff-4da7-92e3-c59a83de9ee6/ — ok
[cleanup] S3 sweep public e2e-rev-b-a7d67de6-cdff-4da7-92e3-c59a83de9ee6/ — ok
[cleanup-verify] DDB TENANT#e2e-rev-a-a7d67de6-cdff-4da7-92e3-c59a83de9ee6: EMPTY ✓
[cleanup-verify] DDB TENANT#e2e-rev-b-a7d67de6-cdff-4da7-92e3-c59a83de9ee6: EMPTY ✓
[cleanup-verify] S3 private review-staging/e2e-rev-a-a7d67de6-cdff-4da7-92e3-c59a83de9ee6/: EMPTY ✓
[cleanup-verify] S3 private review-staging/e2e-rev-b-a7d67de6-cdff-4da7-92e3-c59a83de9ee6/: EMPTY ✓
[cleanup-verify] S3 public e2e-rev-a-a7d67de6-cdff-4da7-92e3-c59a83de9ee6/: EMPTY ✓
[cleanup-verify] S3 public e2e-rev-b-a7d67de6-cdff-4da7-92e3-c59a83de9ee6/: EMPTY ✓
  (leak assertion: expect(problems).toEqual([]) → passed — zero residue)
  3 passed (9.7s)
```
