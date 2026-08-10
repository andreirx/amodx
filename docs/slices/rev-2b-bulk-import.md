# REV-2b: Bulk review import — CSV/JSON + media ZIP, attestation-gated

- **Status:** IMPLEMENTED (code + unit/fixture evidence; CDK registration written + infra assertion
  suite EXECUTED 25/25 this cycle — `cdk synth` is the operator's deploy gate, see "Infra" below).
  Maturity: PROTOTYPE → MATURE for the import path. **Revise cycle 2 (2026-08-08): moderation-only
  pipeline — the automated byte-screen dependency eliminated (D-REV-4 SUPERSEDED); this cycle also
  re-scoped rev-2a's now-dead byte-screen code.** **Revise cycle 3 (2026-08-08): completed the
  site-scope moderation VERTICAL (see below), added admin output-surface coverage, reconciled
  `backend/ARCHITECTURE.md`, and removed the dependency-name remnants from comments.**
- **Track:** REV
- **Depends:** rev-1 (d5d8705, schema) + rev-2a (680d81c, media pipeline)

## Scope

1. **Import formats:** CSV and JSON review exports + optional media ZIP. Parse into
   ratified review shapes: scope (site default for business reviews; product when a
   product match is given), source "imported", per-review images referencing ZIP
   entries. Malformed rows -> per-row rejection with reason in the import REPORT
   (never abort-the-batch on one bad row; never silently skip either).
2. **Attestation gate (D-REV-3):** the import endpoint REQUIRES the attestation
   payload (rightsBasis + legal-text version); writes the immutable ImportBatch
   record FIRST; every imported review/image references importBatchId. No batch
   record -> no import (tested).
3. **Media flow:** ZIP entries go through rev-2a's `stageReviewImage` (reuse, no
   duplication) — declared type-AND-size gate, **no byte-screen** (D-REV-4 SUPERSEDED);
   rejected images recorded per-item in the report; reviews land status pending
   (moderation is rev-3's UI; the handler gate exists — human approval is the content control).
4. **Endpoint:** additive action on the EXISTING reviews surface or the existing
   import family (WordPress/WooCommerce importers are precedent - follow their
   handler/route pattern; no new deployable unit unless that pattern already implies
   one - record the choice). Bulk-class for invalidation (debounced, cache-4a
   classification).
5. **Report as output surface (deep-vertical):** the import returns/persists a
   structured report (accepted/rejected per row + per image + reasons + batchId) the
   admin can SEE (minimal admin surface: the existing import UI pattern).

## Non-scope

Moderation UI (rev-3), gallery (rev-4), connectors (rev-5/6). No **additional**
deployable unit beyond the authorized import-family Lambda + `POST /import/reviews`
route (the operator-AUTHORIZED instance #3 of the existing import pattern — see
§ Infra): no new stack, bucket, table, or public route.

## DoD / evidence

Unit: parser (fixture CSV/JSON incl. malformed rows), attestation-required test,
ZIP->pipeline wiring, report shape. Fixture end-to-end run transcript (EXECUTED,
local): small CSV + ZIP -> batch record + pending reviews + staged images (declared type-AND-size
gate, no byte-screen — D-REV-4 SUPERSEDED) + report. Staging regression pre-commit (operator).
Build/typecheck green.

## Implementation (EXECUTED 2026-08-08, local; revise cycle 2 — moderation-only)

- **Handler:** `backend/src/import/reviews.ts` — `POST /import/reviews`, TENANT_ADMIN, bulk
  invalidation (`withInvalidation`, cache-4a). Attestation gate → immutable `ImportBatch`
  write-first (`ConditionExpression: attribute_not_exists` = write-once) → per-row map → media
  STAGE reuse (`stageReviewImage`, rev-2a — declared type-AND-size gate, **no decode**; D-REV-4
  SUPERSEDED) → pending reviews → structured report. The moderation gate (every image `pending`
  until a human approves) is the content control — recorded in the handler comment.
- **Pure parser (test seam):** `backend/src/import/reviews-parse.ts` — CSV/JSON parse, per-row
  validation (malformed → per-row rejection, never abort-the-batch), ZIP-entry MIME inference, and
  `extractImageRefs()` (a malformed row's referenced images still appear in the report). The
  `MAX_REVIEW_IMAGES` (12) count cap is enforced HERE, in the parser, so a >12-reference row is a
  per-row rejection BEFORE the handler stages any bytes (review-1 fix #2) — not a write-time
  `ReviewSchema.parse()` throw that would first stage 13 orphans and emit a lying "accepted" report.
- **Report DTO:** `ReviewImportReport` (+ row/image result types) in `packages/shared/src/index.ts`
  — plain TS types (raw DTO crossing the backend→admin boundary; never re-parsed, so no Zod). The
  per-image field is the FULL disposition: `images: ReviewImportImageResult[]`, a SUM TYPE on
  `status` where an ACCEPTED entry carries the private **original** `assetKey` + staged byte `size`
  and a REJECTED entry carries the reason (revise cycle #3 — accepted photos are first-class, not a
  bare count). Every referenced image appears once, INCLUDING those on rejected rows (reviewer fix).
  The admin renders both by matching `status`.
- **Admin surface:** `admin/src/pages/Reviews.tsx` — "Import reviews" dialog (file + ZIP +
  required rights-basis + versioned attestation checkbox) rendering the structured report, with an
  "Accepted images (staged, pending approval)" section (assetKey + KB size) beside the rejections.
  All colors are CSS theme tokens (Critical Rule 6) — the whole page is de-hardcoded
  (`bg-primary/10 text-primary`, `bg-muted`, `text-destructive`, `fill-primary`); the admin theme
  exposes no success/warning token, so approved maps to the tenant `primary` accent.
- **Dependency:** `fflate@^0.8.2` (pure-JS ZIP, zero native deps, no advisories) — the only
  ZIP handling in the repo. **No `sharp`** (removed from the backend this cycle, D-REV-4 superseded).
- **Media flow:** imported `ReviewImage.assetKey` = the PRIVATE `/original` key; promotion to the
  public bucket stays rev-2a's approve-image path (on human approval, copying the original). Nothing
  public here.
- **Tests (EXECUTED, `npm run test:unit`, no AWS):** `backend/test/unit/review-import-parse.test.ts`
  + `backend/test/unit/review-import.test.ts` (real fflate ZIP, **no sharp**, S3/DDB mocked) —
  attestation-required (writes nothing), batch-first (batch fails → no review), ZIP→stage wiring
  (one `/original` put), per-row/per-image resilience incl. rejected-row images surfaced,
  declared-type gate (HEIC/off-allowlist rejected), product-vs-site scope, JSON source, and — added
  this iteration (review-0 #2/#3) — **ZIP decode+bound is read-only BEFORE the first write**: a
  corrupt ZIP and a bomb-like entry (declared uncompressed size over the per-image cap, refused by
  fflate's `filter` before inflation) each return 400 with NO orphan attestation batch and no S3 put.
  Added this iteration (review-1 #2/#3): a **13-reference row** is one rejected row + 13 rejected
  image dispositions with NO review write and NO staged object (count cap enforced pre-staging), and
  a **mocked S3 `PutObject` rejection** surfaces the referenced image as a rejected disposition
  ("staging failed …") while the row still writes — the "every referenced image appears once"
  invariant holds on the infra-error edge. Parser tests add the count-cap boundary (12 accepted, 13
  rejected). Full unit suite re-run green (`npm run test:unit`, no AWS) — count in the build report.

## Infra (WRITTEN this cycle — operator AUTHORIZED, revise 2026-08-08)

`ReviewImportFunc` is registered immediately after `ImportFunc` / `MediaImportFunc` — instance
**#3** of the import-family pattern (WooImportFunc in the commerce nested stack is #4). A new Lambda
**resource**, NOT a new deployable unit (no new stack/bucket/table), so no STOP was triggered.
(**Superseded by INFRA-SPLIT-1 v2, 2026-08-10:** the three import-family FUNCTIONS — `ImportFunc`,
`MediaImportFunc`, `ReviewImportFunc` — now live in the `CatalogApi` nested stack
`infra/lib/api-catalog.ts`; their routes, incl. `POST /import/reviews`, stay in `infra/lib/api.ts`.
The least-privilege S3 grant below is unchanged and moved with the function.) What was written:

- `NodejsFunction` on `backend/src/import/reviews.ts`, `timeout 15min`, `memorySize 3008` (matching
  the sibling importers). Env: `TABLE_NAME` + `EVENT_BUS_NAME` (from `nodeProps`) + `PRIVATE_BUCKET`.
- **Bundling — PLAIN, no deviation (revise cycle 2, D-REV-4 SUPERSEDED):** the byte-screen was
  removed, so this Lambda no longer pulls `sharp`. It uses the shared `nodeProps` bundling like every
  other importer — **no** `externalModules`/`nodeModules` sharp entries, and **no** Docker / prebuilt
  Lambda-layer deploy caveat. Its only extra dep, `fflate`, is pure-JS and bundles normally. (The
  earlier cross-platform-sharp-binary DECISION_REQUIRED is RESOLVED by elimination — moot.)
- Grants (least-privilege): `table.grantReadWriteData(fn)` (ImportBatch + review writes + the
  `withInvalidation` CDN_PENDING marker); a hand-written `addToRolePolicy` granting EXACTLY
  `s3:PutObject` scoped to `${privateBucket.bucketArn}/review-staging/*` (stages the `/original`
  under the quarantine prefix — the handler's ONE S3 op). **`grantPut(fn)` was REFUSED** (review-1
  blocking least-privilege finding): with no object-key pattern it scopes to the whole bucket
  (`<bucketArn>/*`) AND grants the put-family (`PutObjectLegalHold`/`Retention`/`*Tagging`,
  `Abort*`) — a blast radius over every tenant's private objects. The scoped statement mirrors
  rev-2a's `UpdateReviewFunc` private read (`amodx-stack.ts`). NO public-bucket grant — promotion is
  rev-2a's `UpdateReviewFunc`. EventBus PutEvents is granted by the constructor's end-of-body loop
  over every `NodejsFunction` (publishAudit), so no per-function event grant is added.
- Route `POST /import/reviews` via `HttpLambdaIntegration`, default authorizer (TENANT_ADMIN
  enforced in-handler).
- **Infra assertion ADDED (review-1 fix):** `infra/test/amodx-stack.test.ts` gains a
  `ReviewImportFunc — rev-2b import least-privilege` block (`rev2b-iam-1..3`) mirroring the
  rev-2a `UpdateReviewFunc` IAM assertions: it pins ReviewImportFunc's role to a SOLE `s3:PutObject`
  action, a single statement scoped to `review-staging/*`, and `PRIVATE_BUCKET` env wiring — so a
  future convenience grant that reopens the boundary fails at synth. (rev-2a IAM is asserted, so per
  the revise instruction the rev-2b grant is now asserted too.)
- `cdk synth` + the `infra/test` suite are the operator's deploy gate; the `infra/test` suite was
  EXECUTED this cycle (25/25, synth bundled `ReviewImportFunc` without any native image-decode
  dependency — see the build report).

## Revise cycle 3 (EXECUTED 2026-08-08, local — reviewer review-2 findings)

- **Site-scope moderation VERTICAL completed (finding #1).** The import writes business reviews under
  the DISJOINT `SITEREVIEW#` namespace (rev-1 D-REV-5), but the read/write handlers still assumed the
  `REVIEW#<productId>#` shape, so an imported business review was invisible and un-moderatable. This
  namespace-read was originally flagged as rev-3's job (shared comment: "rev-3's admin list must also
  query the `SITEREVIEW#` prefix"); the reviewer brought it forward because rev-2b's own import UI
  claims imported reviews appear "in the list below". Minimal, no-new-infra, EXISTING routes only:
  - `reviews/list.ts` — no productId → TWO `PK`+`begins_with` queries (`REVIEW#` + `SITEREVIEW#`),
    merged newest-first (never a Scan); productId filter stays a single product query. `scope` added
    to the projection so the admin can discriminate and route the follow-up call.
  - `reviews/update.ts` (`updateReviewFields`) and `reviews/delete.ts` — route a no-productId review
    to the `SITEREVIEW#` key, mirroring the approve-image action. Without this, a surfaced business
    review could be neither approved/hidden nor deleted. The prior `update.ts` "Missing productId"
    400 is now a site-scope update (the `update-review.test.ts` case was updated to the new contract).
  - Admin `Reviews.tsx` — shows "— (site)" for scope=site rows; `handleDelete` omits the productId
    query param for site reviews (serializing `undefined` had sent the literal string "undefined").
  - **DEFERRED, recorded:** a PUBLIC site-review render surface (business-reviews carousel/gallery on
    the storefront) is **rev-4 (gallery)** and needs a new public route = a new deployable unit — out of this
    slice's "no additional deployable unit" scope. rev-2b's deep-vertical output surface ends at the admin moderation
    list, which is now complete. `public-list.ts` stays product-only.
- **Admin output-surface coverage (finding #5).** New pure seam `admin/src/lib/importReportView.ts`
  (`buildImportReportView`) that the import dialog renders verbatim; headless test
  `importReportView.test.ts` (6 cases, vitest node env — no jsdom/RTL) proves the FULL disposition
  reaches the screen: accepted images carry `assetKey` + KB size, every rejection (rows + images,
  including images on rejected rows) is surfaced. New `admin` test tooling: `vitest` devDep +
  `vitest.config.ts` + `test:unit` script (test files excluded from the app `tsc` build).
- **ARCHITECTURE reconciled (finding #4).** `backend/ARCHITECTURE.md` `import/` tree now documents
  `reviews.ts` (+ `woocommerce.ts`/`media.ts`, previously undocumented) and the `reviews-parse.ts`
  pure seam, with the attestation-first write order and the report boundary; the `reviews/` entries
  note the SITEREVIEW# merge and routing.
- **Dependency-name check made precise (finding #3).** The transitional removal comments naming the
  dropped image-decode dependency were rewritten to describe the present moderation-only state.
  `grep -rni "sharp" backend infra packages` (src+test, excl. node_modules/dist/cdk.out) now returns
  ONLY unrelated pre-existing text — `csharp` (a code-block language id) and `sharp`/`sharpness`
  (WebGPU shader math in `packages/effects`); ZERO references to the removed npm dependency. The
  packet's literal lowercase `grep "sharp"` is non-zero ONLY on those unrelated substrings — the
  unavoidable exclusions. `npm ls sharp --all` → the sole `sharp` install is `next`'s
  optionalDependency (renderer, Next-managed, untouched).

## Revise cycle 4 (EXECUTED 2026-08-08, local — reviewer review-3 findings)

- **Attestation identity now FAILS CLOSED (finding #1).** `ImportBatch.attestedBy` is documented as
  the actor EMAIL (CLAUDE.md audit-context rule), but the handler fell back `auth.email || auth.sub`.
  The master-key/robot authorizer context (`sub:"system-robot"`, role `GLOBAL_ADMIN`, NO email) passes
  `requireRole` on the GLOBAL_ADMIN short-circuit and reached the write — persisting `attestedBy:
  "system-robot"`, a false legal-attestation identity, and an audit actor with `email: undefined`.
  Fix: a fail-closed identity gate BEFORE the first write requires a non-empty `auth.email`; a
  principal without one gets **403** and nothing is written or staged. `attestedBy` and the audit
  `actor.email` are now set to that validated email directly — never `auth.sub`. Test:
  `review-import.test.ts` — a `system-robot`/GLOBAL_ADMIN (no-email) caller → 403 with zero
  batch/review/S3 writes; a TENANT_ADMIN with email → 200 and `attestedBy` = that email.
- **Per-image dispositions are consistent with a rejected row (finding #2).** Previously a staged
  image was pushed to the report as `accepted` BEFORE the review `PutCommand`; if that write failed
  (ReviewSchema.parse throw or DDB error) the row became rejected but its images stayed `accepted` —
  a "full disposition" that reported accepted photos no review references. Fix: each row buffers its
  image dispositions locally (`rowImages`); a staged entry is only PROVISIONALLY accepted and is
  committed to the report verbatim ONLY after the review write succeeds. On a row-write failure the
  buffer is flushed with every provisionally-accepted entry converted to REJECTED carrying the
  row-write reason (already-rejected entries keep their more-specific reason) — every referenced
  image still appears exactly once, and the staged orphan expires under the rev-2a private-bucket
  lifecycle rule. Test: `review-import.test.ts` — a mocked review-write failure yields a rejected row
  and its image reported rejected once (never accepted), with the S3 stage still attempted.
- **Fixture end-to-end transcript is now an executable artifact (finding #3).**
  `backend/test/unit/review-import-fixture.test.ts` drives the real handler (S3+DDB mocked, real
  fflate ZIP) and `console.log`s a labelled transcript — CSV + ZIP → ImportBatch (written first,
  attributed to the actor email) → staged private `/original` → PENDING imported review → the
  returned structured report — while asserting each side-effect. Reproduce verbatim:
  `cd backend && npx vitest run review-import-fixture --config vitest.unit.config.ts --disable-console-intercept`
  (vitest buffers `console.log`; the flag surfaces it). The literal transcript is in the build report.

## Revise cycle 5 (EXECUTED 2026-08-08, local — reviewer review-4 = evidence-only)

review-4 OBSERVED the code correct and requested EVIDENCE, not code: (1) the literal fixture
transcript re-run in a builder-capable environment (the review sandbox was read-only — Vitest
`EPERM` on `node_modules/.vite-temp`), (2) correction of build-4's false "no new infra" phrasing,
(3) actual command output/exit statuses for the gates. **No source/config/test file changed this
cycle.** All eight gates were re-EXECUTED locally with captured exit statuses (build 0, typecheck
0, backend `test:unit` 204/204, fixture transcript 1/1, admin `test:unit` 6/6, infra 25/25 incl.
`rev2b-iam-1..3`, `git diff --check` 0, `sharp` zero source refs). **Infra statement corrected:**
`infra/lib/api.ts` DOES add `ReviewImportFunc` + `POST /import/reviews` — it adds no new
*deployable unit/stack/bucket/table*, but it is the authorized import-family Lambda **resource**
#3, not "no infra change." Full literal transcripts: `.agent-manager/slices/REV-IMPL-2B/build-5.md`.

## Revise cycle 6 (EXECUTED 2026-08-08, local — reviewer review-5 = evidence + one doc contradiction)

review-5 OBSERVED the code correct and had exactly two asks, both non-code: (1) the build report
must carry the *literal* captured stdout/exit statuses (build-5's table summarized them but did not
inspectably contain them), and (2) `docs/slices/rev-2b-bulk-import.md` § Non-scope still said the
bald "no new infra", contradicting the same doc's § Infra which records the authorized Lambda +
route. **Fixes this cycle (docs only, no source/config/test change):** § Non-scope now reads "No
**additional** deployable unit beyond the authorized import-family Lambda + `POST /import/reviews`
route (instance #3 — see § Infra): no new stack, bucket, table, or public route", and the rev-4
deferral reference was aligned to the same "no additional deployable unit" wording. All eight gates
re-EXECUTED locally with captured literal transcripts + exit statuses — build 0, typecheck 0,
backend `test:unit` 204/204, fixture transcript 1/1 (full labelled CSV+ZIP → batch-first → private
`/original` → PENDING review → full-disposition report), admin `test:unit` 6/6, infra 25/25 incl.
`rev2b-iam-1..3` + credential-free isolation, `git diff --check` clean, `sharp` zero source deps
(sole install is `next@16 → sharp@0.34.5`, packet-excluded). Full literal transcripts:
`.agent-manager/slices/REV-IMPL-2B/build-6.md`.
