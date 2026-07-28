# CACHE-6: Distribution transport hotfixes (revalidation header + image query strings)

- **Status:** SHIPPED 2026-07-28 — deployed to production by the human, verified live (staging probe suite + prod probes: bijup.com s-maxage/Hit/age, session bypass, nf no-loop)
  changes applied — documentation reconciliation only, **no code and no comment changed**;
  revision 1 applied iteration 0's two truth corrections), review
  pending. Authored by the operator the same day from live staging probe findings. Nothing
  deployed. Build run, mutation checks and synth fragments: § *Build run — 2026-07-28*;
  revision 1: § *Revision 1 — 2026-07-28 (review iteration 0)*; revision 2:
  § *Revision 2 — 2026-07-28 (review iteration 1)*. Authoritative status lives in
  `docs/ROADMAP.md` § Track CACHE.
- **Track:** CACHE
- **⚠ Production-impacting defects, pre-existing in prod** — both verified live.
- **CDK-change justification (standing directive):** both changes repair BROKEN
  deployed behavior — named, probe-verified gains.

## Defects (both OBSERVED on the deployed staging distribution 2026-07-28; defect 2
also OBSERVED on prod amodx.net)

1. **ISR revalidation transport-dead through CloudFront.** The `api/*`
   origin-request policy (`RendererOriginPolicy`, renderer-hosting.ts ~336) whitelists
   7 headers; `x-revalidation-token` is not among them. CloudFront strips it →
   `/api/revalidate` 401s for every caller through the distribution — and backend
   Lambdas call `RENDERER_URL=https://<distribution-domain>`. Deployed ISR purges have
   never worked (independent of the keying bug cache-2 fixed). Evidence: token
   sha-match between Lambda env and Secrets Manager, 401 through distribution, ORP
   inspected via get-origin-request-policy.
2. **Image optimization broken for all tenants.** `_next/image*` behavior uses
   `CACHING_OPTIMIZED` (query strings excluded from cache key) with NO origin-request
   policy → CloudFront strips `?url&w&q` → image Lambda returns 500
   `"url" parameter is required`. OBSERVED identically on staging AND prod.

## Scope (exactly two changes in `infra/lib/renderer-hosting.ts`)

1. Add `'x-revalidation-token'` to the `RendererOriginPolicy` header allowlist
   (comment: why — see defect 1).
2. `_next/image*` behavior: replace `CACHING_OPTIMIZED` with a dedicated
   `ImageCachePolicy`: query allowlist EXACTLY `url,w,q` (in key AND therefore
   forwarded), headers none, cookies none, gzip+brotli on, defaultTtl 1 day,
   maxTtl 365d, minTtl 0 (the image Lambda's own Cache-Control governs beyond the
   default). No origin-request policy needed once the cache policy keys the queries.

## Also required

- Extend `infra/test/amodx-stack.test.ts`: assert the ORP header set (8 incl. the
  token header) and the image behavior's query allowlist — these two defects existed
  precisely because no assertion pinned them.
- Doc ripples: `docs/caching-architecture.md` (§Distribution Layout, §Open hazards →
  record both as found-and-fixed), TECH-DEBT entries closed/added as appropriate.
- Reconciliation per precedent.

## Non-scope

- No other infra edits. No behavior/origin restructuring. No prod deploy (operator
  deploys staging; HUMAN deploys prod).

## Definition of Done

1. Both changes present; `cdk synth` green; the two new assertions pass and FAIL when
   the fix is reverted (mutation check, temporary, proven reverted).
2. Root build + typecheck green.

## Evidence

- `EXECUTED`: infra test transcript incl. mutation checks; synth fragment showing the
  ORP headers + image cache policy.
- `NOT RUN` (operator): staging deploy + live re-probe (`/api/revalidate` 200 +
  S3 `_cache` entry purged; `_next/image` 200 image/*).

---

## Build run — 2026-07-28

Implemented exactly the two changes in § Scope. Nothing deployed; nothing committed.

### Files changed

| File | Change |
|---|---|
| `infra/lib/renderer-hosting.ts` | (1) `'x-revalidation-token'` added as the 8th `RendererOriginPolicy` header, with the defect-1 rationale. (2) `_next/image*` gets a dedicated `ImageCachePolicy` (`url,w,q` keyed; headers/cookies none; gzip+brotli; 1 d / 365 d / 0) replacing `CACHING_OPTIMIZED`, with the defect-2 rationale. **No other edit** — proven by template diff, below. |
| `infra/test/amodx-stack.test.ts` | New `(g)` (image query key) and `(h)` (ORP header list). New helper `cachePolicyByConstructId()` — `onlyResource('AWS::CloudFront::CachePolicy')` throws now that a second policy exists, so the five existing call sites in `(a1)`–`(a4)`/`(b2)` were repointed at `RendererCachePolicy` by name. Header note scoping the pre-`cache-6` staging diff. |
| `docs/caching-architecture.md` | New § *Transport defects found in `cache-6`* (D1, D2, with the post-deploy checks); new § *Origin Request Policy*; § *Distribution Layout* image row; a warning box on § *Invalidation Mechanisms 5* for anyone debugging a dead purge; Known Gaps 16 + 17. |
| `docs/TECH-DEBT.md` | New § *cache-6 residuals*: the `Vary: Accept` gap, the missing allowlist↔consumer cross-check, and the `sharp` exposure ripple into `dep-1`. |
| `docs/testing-strategy.md` | infra estate row and §6 status: 15 → **17** named assertions. |
| `docs/runbooks/deploy-track-cache.md` | Title + preamble now cover four slices, with the paragraph explaining why `cache-6` changes what two existing probes *mean*. Probe 7 annotated (needs `cache-2` **and** `cache-6`; check for a 401 before suspecting the path); probe 11 annotated with the pre-`cache-6` 500. New probes **7b** (purge returns 200 **and** the `_cache/…` S3 object is gone — the 200 alone only proves transport) and **11b** (`w=1080` bytes ≠ `w=256` bytes — the only probe that distinguishes "`w` is in the cache key" from "`w` merely reached the origin"). New rollback note: reverting either change restores the *pre-existing broken* behaviour, so it is a return to broken, not to safe. Stale line corrected — it read "`test-4` … is not started". |
| `infra/ARCHITECTURE.md` | **Revision 2.** § *Testing*: 15 → **17**, `(g)`/`(h)` described and each contrasted with the cache-key assertion it is easily confused with (`(a2)`, `(a1)`); "all 15 red" warning → "all 17". |
| `docs/ROADMAP.md`, `CURRENT_SLICE.md` | `cache-6` row + deploy-order reconciliation; revision status. |
| `docs/TECH-DEBT.md`, `docs/ROADMAP.md` | **Revision 2** stale-count ripples — see § *Revision 2*. |

**Reconciliation basis.** This table is the full inventory, checked against
`git diff --stat` plus `git status --short` for untracked files, not assembled from memory.
The eight tracked modified paths are `CURRENT_SLICE.md`, `docs/ROADMAP.md`,
`docs/TECH-DEBT.md`, `docs/caching-architecture.md`, `docs/runbooks/deploy-track-cache.md`,
`docs/testing-strategy.md`, `infra/lib/renderer-hosting.ts`, `infra/test/amodx-stack.test.ts`,
plus `infra/ARCHITECTURE.md` added in revision 2; the one untracked path is this slice doc.
Every one appears above. Nothing outside `infra/lib/renderer-hosting.ts` and
`infra/test/` is a code change.

### Deviation from the slice text, raised not hidden

§ Also required says to record both defects in `docs/caching-architecture.md` § *Open hazards*.
That section is titled **"Open hazards activated by cache-1"**, and neither defect was
activated by `cache-1` — both predate the whole track and neither is a cache-key defect. Filing
them there would have made the section's title false, which is the one thing a heading may not
be. They are instead in an adjacent section, § *Transport defects found in `cache-6`*, named
**D1/D2** rather than H4/H5 to keep the two classes distinguishable, and § *Open hazards* now
carries a forward pointer to it explaining why. The instruction's intent — both recorded as
found-and-fixed, next to the hazards, discoverable from them — is met.

### Evidence

| # | Claim | Label | Evidence |
|---|---|---|---|
| 1 | `x-revalidation-token` is the header both sides use | `OBSERVED` | `backend/src/lib/revalidate.ts:87,125` send it; `renderer/src/app/api/revalidate/route.ts:10-11` 401s when it ≠ `REVALIDATION_SECRET` |
| 2 | The optimizer's required **query-string** inputs are `url,w,q` (not its entire input — see row 4), and a missing `url` is the observed 500 | `OBSERVED` | `next/dist/server/image-optimizer.js:520` `const { url, w, q } = query`; `:527` `'"url" parameter is required'` — read from the bundle inside `infra/cdk.out/asset.3c46368…/node_modules/next` |
| 3 | The adapter's own `Cache-Control` governs, so `defaultTtl` is only a floor | `OBSERVED` | `node_modules/open-next/dist/adapters/image-optimization-adapter.js` — `public,max-age=${result.maxAge},immutable` on success, `public,max-age=60` on failure |
| 4 | The adapter emits `Vary: Accept` and negotiates on it — unhonoured at the edge, before and after | `OBSERVED` | same file: `Vary: "Accept"` on both response builders; `optimizeImage(headers, …)` |
| 5 | Infra suite green, 17/17 | `EXECUTED` | `cd infra && npm test` → `Tests: 17 passed, 17 total`, 58.9 s |
| 6 | Mutation M1 — drop `'x-revalidation-token'` → **only `(h)`** fails | `EXECUTED` | `Tests: 1 failed, 16 passed`; failure is `(h)`, diff shows the missing entry |
| 7 | Mutation M2 — restore `CACHING_OPTIMIZED`, remove `ImageCachePolicy` → **only `(g)`** fails | `EXECUTED` | `Tests: 1 failed, 16 passed`; failure is `(g)`: `expected 1 cache policy whose logical id contains "ImageCachePolicy", found 0` |
| 8 | Both mutations reverted, proven | `EXECUTED` | `shasum -a 256 infra/lib/renderer-hosting.ts` = `a4206092e59c342ddfa5078307139c39aa3aac69577253183efc6433dafae1ac`, identical to the pre-mutation golden; zero mutation markers remain. **Superseded by revision 1** — that revision edited comments in this file, so the current hash is `c65b3a50…5f0aab75`; see § *Revision 1*, which re-ran both mutations and re-proved the revert against the new golden |
| 9 | The change surface is **exactly** the two ratified deltas | `EXECUTED` | template diff, below |
| 10 | Root build green | `EXECUTED` | `npm run build` → exit 0 (shared → effects → plugins → backend → admin → renderer → mcp-server → infra) |
| 11 | Typecheck green, 8 workspaces + root | `EXECUTED` | `npm run typecheck` → exit 0 |
| 12 | Every other credential-free suite green | `EXECUTED` | shared 70, backend-unit 51, plugins 172, renderer 29, serving-contract 20/20 (9.5 s) |
| 13 | Live re-probe after deploy | `NOT RUN` | operator-owned; see § *Post-deploy verification* |
| 14 | `cd backend && npm test` | `NOT RUN` | needs real staging DynamoDB |

### Synth fragments (`EXECUTED`, `CDK_OUTDIR=/tmp/cache6-synth`, `Test4Stack.template.json`)

```json
"RendererHostingRendererOriginPolicy17547019": {
  "HeadersConfig": { "HeaderBehavior": "whitelist", "Headers": [
    "Accept", "Accept-Language", "Content-Type", "X-Forwarded-Host",
    "x-origin-verify", "x-tenant-id", "x-automation-key", "x-revalidation-token" ] },
  "CookiesConfig": { "CookieBehavior": "all" },
  "QueryStringsConfig": { "QueryStringBehavior": "all" }
}

"RendererHostingImageCachePolicy2E62717A": {
  "DefaultTTL": 86400, "MaxTTL": 31536000, "MinTTL": 0,
  "Name": "Test4Stack-ImageCache",
  "ParametersInCacheKeyAndForwardedToOrigin": {
    "QueryStringsConfig": { "QueryStringBehavior": "whitelist",
                            "QueryStrings": ["url", "w", "q"] },
    "HeadersConfig": { "HeaderBehavior": "none" },
    "CookiesConfig": { "CookieBehavior": "none" },
    "EnableAcceptEncodingGzip": true, "EnableAcceptEncodingBrotli": true }
}

"_next/image*": { "AllowedMethods": ["GET","HEAD"], "Compress": true,
  "CachePolicyId": { "Ref": "RendererHostingImageCachePolicy2E62717A" } }
```

Note `_next/image*` carries **no** `OriginRequestPolicyId` — the three parameters reach the
Lambda because they are in the cache key, which is the whole point of doing it with one
construct instead of two.

### Template diff — the change surface, measured (`EXECUTED`)

Each mutation round wrote a full template, so `diff(final, M1)` isolates change 1 and
`diff(final, M2)` isolates change 2. Leaf-level comparison of every differing resource:

| Round | Semantic delta | Everything else that differed |
|---|---|---|
| M1 | `RendererOriginPolicy.HeadersConfig.Headers`: 7 → 8 entries | 5 asset-key leaves only (`ImageOptFunction`/`RendererServer` `Code.S3Key`, `DeployRendererAssets.SourceObjectKeys`, the admin runtime-config `Create`/`Update` payloads) |
| M2 | `ImageCachePolicy` resource added; `_next/image*` `CachePolicyId` `"658327ea-…"` → `{"Ref": …}` | the same 5 asset-key leaves |

The asset keys move because every synth re-runs `npm run build:open` and `vite build`, whose
bundle hashes are not reproducible — build nondeterminism, not a semantic change. Confirmed
for M2 that `DefaultCacheBehavior` is byte-identical, the other four behaviors (`api/*`,
`_next/static/*`, `assets/*`, `favicon.ico`) are byte-identical, and the rest of
`DistributionConfig` is byte-identical; the only behavior that moved is `_next/image*`.

### Post-deploy verification — `NOT RUN`, operator-owned

Both are live-transport defects, so **no origin-side or synth-side test can close them**. They
need requests through the real distribution.

1. **D1.** `POST https://<distribution>/api/revalidate` with a correct `x-revalidation-token`
   → expect **200**, and confirm the matching `_cache/<buildId>/<host>/<path>.cache` object is
   gone from the asset bucket. The 200 alone only proves the header survived transport; the
   missing S3 object is what proves the purge happened.
2. **D2.** `curl -sI 'https://<domain>/_next/image?url=%2F_assets%2F<something>&w=640&q=75'`
   → expect **200** with an `image/*` content type (today: 500 `"url" parameter is required`).
   Then repeat with `w=1080` and confirm the bytes differ — that is what proves `w` is in the
   key and not merely forwarded.
3. Expect a **cold `_next/image*` cache** on deploy: changing the cache policy strands every
   existing entry. Since every existing entry is currently a cached 500, this is pure upside.

---

## Revision 1 — 2026-07-28 (review iteration 0)

Two required changes, both **truth corrections in prose and comments**. No CDK property, no
assertion body and no behaviour changed; the deploy artifact is byte-for-byte the revision-0
artifact. Recorded because both corrected claims were the kind that misleads a later reader
into skipping work: one understated a live security question, the other overstated what an
assertion proves.

### R1 — the "`sharp` exposure is zero today" claim was false, and is withdrawn

**What was wrong.** `docs/TECH-DEBT.md` § *cache-6 residuals* argued that because CloudFront
strips the image query string, every request to the image optimizer 500s before decoding, so
"live request-time exposure is **zero today**". The premise is true; the conclusion does not
follow, because **CloudFront is not the only path to that Lambda**.

**Evidence for the correction (`OBSERVED`).** The same function carries its own Lambda Function
URL with no authentication:

```json
"RendererHostingImageOptFunctionFunctionUrl279D4F6A": {
  "Type": "AWS::Lambda::Url",
  "Properties": { "AuthType": "NONE", "TargetFunctionArn": { "Fn::GetAtt": [ … ] } } },
"RendererHostingImageOptFunctioninvokefunctionurl3C0532AE": {
  "Type": "AWS::Lambda::Permission",
  "Properties": { "Action": "lambda:InvokeFunctionUrl", "FunctionUrlAuthType": "NONE",
                  "Principal": "*", … } }
```

Read from `infra/cdk.out/AmodxStack.template.json`; source is
`infra/lib/renderer-hosting.ts:152-154` (`addFunctionUrl({ authType: FunctionUrlAuthType.NONE })`
— pre-existing, untouched by this slice). A request sent directly to that URL never traverses
the distribution, so nothing strips its query string.

**Provenance caveat on that artifact, added in revision 2 (`OBSERVED`).**
`infra/cdk.out/AmodxStack.template.json` is a **stale, pre-`cache-6`** synth — mtime
`2026-07-28 21:13`, and it contains only one `AWS::CloudFront::CachePolicy`
(`RendererCachePolicy`, no `ImageCachePolicy`) and a **7**-entry `RendererOriginPolicy`. It is
still sound evidence for *this* claim, because the Function URL is pre-existing and untouched
by `cache-6`, so the stale template and the current source agree on it. It must **not** be read
as evidence about the two properties this slice changed — for those, use the § *Synth fragments*
above, which come from a fresh isolated synth (`CDK_OUTDIR`, `Test4Stack`), never from
`infra/cdk.out`. Nothing in this slice regenerates `infra/cdk.out`; the operator's artifact is
deliberately left untouched.

**What the entry now says.** `cache-6` **enables the CloudFront path** to the optimizer; it
neither creates nor removes the Function-URL path and it establishes nothing about exposure.
`dep-1` still owns the answer and needs both halves — the reachable input set across *every*
path, and the `sharp` version actually shipped. One lead is passed to it, explicitly labelled
`INFERRED`: the built bundle contains `remotePatterns:[]` (`OBSERVED` as a literal string in
`renderer/.open-next/image-optimization-function/index.mjs`; `renderer/next.config.*` sets no
`images` config), which *would* reject absolute remote URLs **if** it is the config the request
path consults — which is exactly what `dep-1` must verify rather than assume.

Ripple: `docs/TECH-DEBT.md` item 2's exposure bullet now points forward to the residual, so the
warning is reachable from the place `dep-1` will actually read.

### R2 — "the optimizer's entire input" overclaimed; rescoped to its query-string inputs

**What was wrong.** Four files described `url,w,q` as the optimizer's *entire input* / said it
has *no other input*, while the same documents elsewhere (correctly) record that the optimizer
negotiates output format on the `Accept` **header**. Both statements cannot be true. The
accurate claim is narrower and is the one the assertion actually pins: `url,w,q` is the
optimizer's **required query-string input set**, and this policy's full query dimension.

**Corrected in:**

| File | Correction |
|---|---|
| `infra/lib/renderer-hosting.ts` | Lead comment rescoped to "everything the optimizer needs FROM THE QUERY STRING"; the `Vary: Accept` residual promoted from a trailing clause to its own paragraph with the "do not add raw `Accept` to the key" warning |
| `infra/test/amodx-stack.test.ts` | `(g)`'s title → *"the optimizer's required query inputs"*; the "NOTHING ELSE" bullet scoped to query parameters; an explicit *scope of the claim* note added |
| `docs/caching-architecture.md` | § *Distribution Layout* diagram row and D2's "exactly three" bullet both rescoped, each pointing at Known Gap 16 |
| this doc | evidence row 2 rescoped, with a pointer to row 4 (`Vary: Accept`) |

The ratified policy is **unchanged**: `Accept` stays out of the cache key, for the
high-cardinality fragmentation reason already recorded. Only the description changed.

### Evidence — revision 1

| # | Claim | Label | Evidence |
|---|---|---|---|
| R-1 | The Function URL is unauthenticated, so the withdrawn claim was false | `OBSERVED` | template fragment above, from `infra/cdk.out/AmodxStack.template.json` |
| R-2 | Revision 1 changed **no code** in `infra/lib/renderer-hosting.ts` | `EXECUTED` | non-comment diff (all lines whose trimmed form starts with `//` filtered out) of `git show HEAD:infra/lib/renderer-hosting.ts` vs the working file: exactly two hunks — `'x-revalidation-token',` added to the header allowlist, and the `ImageCachePolicy` construct + `cachePolicy: imageCachePolicy`. That is the ratified revision-0 scope and nothing else |
| R-3 | Infra suite still green, 17/17 | `EXECUTED` | `cd infra && npm test` → `Tests: 17 passed, 17 total`, 51.3 s; `(g)` runs under its new title |
| R-4 | Mutation M2 re-run against the retitled `(g)` — only `(g)` fails | `EXECUTED` | `ImageCachePolicy` construct removed + `CACHING_OPTIMIZED` restored → `Tests: 1 failed, 16 passed`; failure is `(g)`: `expected 1 cache policy whose logical id contains "ImageCachePolicy", found 0` |
| R-5 | Mutation M1 re-run — only `(h)` fails | `EXECUTED` | `'x-revalidation-token'` commented out → `Tests: 1 failed, 16 passed`; failure is `(h)` |
| R-6 | Both mutations reverted, proven | `EXECUTED` | `shasum -a 256 infra/lib/renderer-hosting.ts` = `c65b3a507173710791e23f5fa31105497418f738f942dd0e797593af5f0aab75` after each revert, identical to the pre-mutation golden; `grep -c MUTATION-M1-TEMPORARY` = 0; the three surviving `CACHING_OPTIMIZED` uses are the S3 behaviors (lines 528/533/538), which is correct |
| R-7 | Root build + typecheck green after the edits | `EXECUTED` | `npm run build` exit 0; `npm run typecheck` exit 0 (8 workspaces + root) |
| R-8 | Every other credential-free suite green | `EXECUTED` | shared 70, backend-unit 51, plugins 172, renderer 29, serving-contract **20/20** (8.9 s) |
| R-9 | Live re-probe after deploy | `NOT RUN` | operator-owned, unchanged — § *Post-deploy verification* |
| R-10 | `cd backend && npm test` | `NOT RUN` | needs real staging DynamoDB; no backend code in this slice |

### Note for the reviewer's own re-run

Review iteration 0 could not re-run the infra suite: jest failed with `EPERM` creating its
haste-map under the sandbox's temp directory, before any test executed. The suite does not
depend on that location — `cd infra && npx jest --cacheDirectory=./.jest-cache` keeps it inside
the repo. **Not applied to `infra/jest.config.js`**: CI is untouched by this slice, and the
default is correct for the machines the suite normally runs on. Surfaced, not built.

---

## Revision 2 — 2026-07-28 (review iteration 1)

Both required changes were **documentation reconciliation**. Revision 2 changed **no code and
no code comment**: `shasum -a 256 infra/lib/renderer-hosting.ts` is
`c65b3a507173710791e23f5fa31105497418f738f942dd0e797593af5f0aab75`, byte-identical to the
pre-mutation golden that revision 1 proved reverted, and
`infra/test/amodx-stack.test.ts` is `5d5b8d47…3ff6405f`, unchanged since revision 1. The
revision-0 mutation evidence therefore still describes the exact bytes under test.

### R3 — `infra/ARCHITECTURE.md` § *Testing* still claimed 15 assertions

**What was wrong.** The package architecture doc said the suite "makes 15 named assertions" and
warned that an interrupted run reports "*all 15* assertions red". `infra/test/amodx-stack.test.ts`
contains **17** — `OBSERVED` by enumerating the `test(` declarations and confirmed by the run
below. Leaving it stale violates the repository rule that each package's `ARCHITECTURE.md` is
updated after a structural change.

**What it now says.** Count corrected in both places, the intro credits `test-4` *and* `cache-6`,
and `(g)`/`(h)` are described — each contrasted with the cache-key assertion it is easiest to
confuse it with, because that confusion is the actual hazard:

| New assertion | Pins | Not to be confused with |
|---|---|---|
| `(g)` | `_next/image*` keyed by `ImageCachePolicy` on exactly `url,w,q`, and the behavior actually references that policy | `(a2)`, the **default** behavior's seven-parameter allowlist |
| `(h)` | `RendererOriginPolicy` forwards exactly eight headers, `x-revalidation-token` included | `(a1)`, the six headers in the cache **key** — `(a1)` governs which stored response a viewer gets, `(h)` governs what the origin may see at all |

### R4 — § *Files changed* omitted `docs/runbooks/deploy-track-cache.md`

**What was wrong.** The table was assembled per-edit and missed a file that the deterministic
inventory shows was changed. Fixed by adding its row and, so the omission cannot recur silently,
a **reconciliation basis** paragraph naming the command the table is checked against
(`git diff --stat` + `git status --short`) and listing all ten paths explicitly.

The runbook change is not cosmetic and deserved its row: it adds probes **7b** and **11b**, and
`11b` is the only probe in the suite that can distinguish "`w` is in the cache key" from "`w`
merely reached the origin" — without it, a single green `200` on probe 11 would look like
success while every width served the first-requested variant's bytes.

### Stale-count sweep — what was corrected and what was deliberately left

`grep -rn "15 named\|all 15\|15 assertion"` over all tracked `*.md`. Two further **live**
claims were stale and are corrected; the rest are dated evidence and were **left alone**,
because rewriting an `OBSERVED` record to match today's count would be falsifying evidence:

| Location | Claim type | Action |
|---|---|---|
| `infra/ARCHITECTURE.md` ×2 | live description of the suite | corrected → 17 (R3) |
| `docs/TECH-DEBT.md` (CDK-bump gate note) | live description of what the gate gives you | corrected → 17 |
| `docs/ROADMAP.md` `test-4` row | delivery record, but reads as current file content | forward pointer added: "15 as shipped by `test-4`, **17 today**" |
| `docs/testing-strategy.md` | — | already correct ("15 … raised to **17** by `cache-6`"), no edit |
| `docs/TECH-DEBT.md` `ENOTEMPTY` incident | `OBSERVED 2026-07-28` record of one past run | **left** — 15 was true when observed |
| `docs/slices/test-4-…`, `vid-3`, `fnd-1`, `cache-3` | dated build-run transcripts | **left** — historical evidence |

### Evidence — revision 2

| # | Claim | Label | Evidence |
|---|---|---|---|
| S-1 | The suite really contains 17 tests, so `ARCHITECTURE.md` is now true | `OBSERVED` | `grep -n "^\s*test("` → 17 declarations; run S-2 lists all 17 by name |
| S-2 | Infra suite green, 17/17 | `EXECUTED` | `cd infra && npm test` → `Tests: 17 passed, 17 total`, 49.8 s, exit 0 |
| S-3 | Revision 2 changed **no code** | `EXECUTED` | `shasum -a 256` on both infra files = the revision-1 values above; `grep -c MUTATION` = 0 in both; the only non-`.md` path in `git status --short` is unchanged by this revision |
| S-4 | Synth fragments regenerated **fresh**, not re-cited | `EXECUTED` | `CDK_OUTDIR=/tmp/cache6-synth-rev2 npm test` → `Test4Stack.template.json`; ORP = the 8 headers incl. `x-revalidation-token`; `RendererHostingImageCachePolicy2E62717A` = `whitelist ["url","w","q"]`, headers/cookies `none`, gzip+brotli, TTL 86400/0/31536000; `_next/image*` `CachePolicyId` = `{"Ref": …ImageCachePolicy…}`. Byte-for-byte the same values revision 0 recorded |
| S-5 | `infra/cdk.out` is a stale pre-`cache-6` artifact | `OBSERVED` | mtime 21:13; 1 cache policy, 7 ORP headers. Caveat added above; `infra/cdk.out` deliberately **not** regenerated |
| S-6 | Root build + typecheck green | `EXECUTED` | `npm run build` exit 0; `npm run typecheck` exit 0, 0 `error TS` |
| S-7 | Serving contract (e2e) green | `EXECUTED` | `cd renderer && npm run test:serving` → **20/20**, exit 0, 8.8 s (real `next build` + `next start`) |
| S-8 | Unit suites green | `EXECUTED` | shared 70, backend-unit 51, plugins 172, renderer 29 |
| S-9 | Live probes | `NOT RUN` | operator-owned, unchanged — § *Post-deploy verification*. Still the slice's one real coverage gap: both defects are CloudFront deleting request data before the origin runs, so no synth-side or origin-side test can reach them |
| S-10 | `cd backend && npm test` | `NOT RUN` | needs real staging DynamoDB; no backend code in this slice |

### Test-estate observation for the operator (not fixed here)

The serving-contract suite **failed on its first run** in this revision, with
`ENOTEMPTY: directory not empty, rmdir renderer/.next/standalone/node_modules/next` in its
setup hook — 20/20 cancelled, 0 executed. Cause: the infra synth had just run twice and left a
`renderer/.next/standalone` tree behind. `rm -rf renderer/.next` (a gitignored build output —
confirmed via `git check-ignore`) cleared it and the re-run was 20/20.

This is the documented "consecutive runs are not independent" hazard in `docs/TECH-DEBT.md`,
but **wider than that entry states**: the entry describes the infra suite poisoning *itself*,
and what happened here is the infra suite poisoning a *different workspace's* suite. The
failure is loud and its remedy is documented, so it is surfaced, not fixed — the ratified fix
is the same one already queued (lift build orchestration out of the CDK constructors). Worth
knowing for anyone who runs `infra` and `renderer` suites back-to-back and reads the second
red as a regression.
