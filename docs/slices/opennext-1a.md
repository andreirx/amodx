# Slice OPENNEXT-1A — built-bundle serving harness (baseline on open-next 3.1.3)

Status: BUILT (increments 1+2) — baseline on 3.1.3 complete. Increment 1 (OPENNEXT-1A-1, 2026-10-15; review cycle 1 escalate → operator rulings OPENNEXT1A-G4 / OPENNEXT1A-NO30D, cycle 2 approved; operator gates on the unchanged candidate: next 39/39, bundle 45/45, diff --check 0). Increment 2 (OPENNEXT-1A-2, 2026-10-15, builder gates: next 39/39, bundle 58/58; review pending) — § Increment 1A-2. ROADMAP shows `BUILT 2026-10-15 (increments 1+2; 58 rows on the bundle)`.
Track: CACHE (test infrastructure for the `opennext-1` upgrade). Maturity target: the harness enters as
PROTOTYPE (increment 1) and reaches MATURE when increment 2's B-rows run green and `opennext-1b` has used it to
produce its expectation diff.
Depends: `docs/slices/opennext-1-upgrade.md` § Ratification (human, 2026-10-15): `OPENNEXT1-HARNESS = A`
(harness first, on 3.1.3, as its own slice, before the upgrade). Ratified order: `siteid-binding-1` →
`opennext-1c` + `opennext-1d` (SHIPPED) → **`opennext-1a`** → `opennext-1b`.
Source plan: `docs/slices/opennext-1-upgrade.md` § 8.1 (binding design), § 4.1 (row expectations), § 6.3
(B-SHARP / B-VERSION).
Builder: claude / claude-opus-5-5. Reviewer: codex / gpt-6-sol.
Deliverable surface: `renderer/test/serving-bundle/`, `renderer/test/serving-contract/`, one
`renderer/package.json` script, docs. **No product code (`renderer/src`, `middleware.ts`), no open-next version,
patch or `open-next.config.ts` change. No infra change.**

## 1. Purpose / risk retired

`renderer/test/serving-contract/` runs the serving contract against `next start`. It never executes the OpenNext
adapter — the code that serves every production request on Lambda: Function URL event conversion, OpenNext
routing, middleware execution, the S3 incremental cache, the DynamoDB tag cache, the SQS revalidation queue and
the response-header rewriting (`fixISRHeaders`, the cache-8 `swr=300` patch). The upgrade to `@opennextjs/aws`
4.1.9 changes behaviour in every one of those areas (spec § 3), so today it could be verified only by
deploy-and-probe.

**Risk retired:** an adapter change (the 4.x upgrade, a patch re-cut, a config change) reaching production with
an unseen serving-contract change. After this slice the same rows run against the built Lambda artefact, with
expectations keyed by the adapter version, so the upgrade becomes a reviewed list of expectation changes.
Built on 3.1.3 first, it is the baseline the upgrade is diffed against.

Tie to the vision: AMODX serves up to 99 tenant sites from one deployment. The serving contract (tenant
isolation at the edge, no cached 404, no cached failed read, no Set-Cookie on cacheable HTML) is what keeps one
tenant's failure from becoming every visitor's cached page. This harness lets that contract be proven on the
code that actually serves it.

## 2. Design as built (increment 1)

### 2.1 Abstractions (one line each)

- *serving target* (`harness.mjs` § SERVING TARGET) — users: the 39 contract rows and the B-rows; axis: the
  serving adapter (`next start` vs the Lambda bundle — a demonstrated volatile mechanism, spec § 3); dispatch:
  two concrete targets behind the same helpers (`startStubs`, `buildRenderer`, `startRenderer`; `request()`
  unchanged); rejected: a grep of the bundle (proves a string, not a state).
- *stored-entries reader* (`contract.test.mjs` `storedIsrEntries`) — users: rows `d3`, `e1`, `h1c`, `p1`; axis:
  where the adapter persists ISR entries (filesystem vs S3); rejected: duplicating those rows per target. (The
  slice packet also listed `a2`; `a2` counts DynamoDB reads and does not call this function — verified by grep.)
- *versioned expectation* (`harness.mjs` `versionedExpectation`) — users: `contract.test.mjs` and
  `bundle.test.mjs`; axis: the open-next major the bundle was built with; dispatch: a table per file keyed by
  major; rejected: per-row `if (version …)` branches (an upgrade would silently pass every row nobody edited).
- *startStubs()* (`harness.mjs`) — users: both test files; axis: the target (DynamoDB only vs DynamoDB + tag
  table + S3 + SQS); rejected: each file starting three stubs and summing their `unhandled` lists itself.

The Lambda host and the three stubs are the binding design of spec § 8.1 items 3–4, not new abstractions.

### 2.2 Lambda host (`renderer/test/serving-bundle/lambda-host.mjs`)

One child Node process, cwd `renderer/.open-next/server-functions/default` (the directory CDK uploads,
`infra/lib/renderer-hosting.ts:237-240`), imports `./index.mjs` and calls `handler` (the bundle's
`export * from "./renderer/index.mjs"`). Module state persists across requests (= warm container); `restart()`
respawns (= cold container). The child prints `LAMBDA_HOST_READY {"port","openNextVersion"}`; the version is
`globalThis.openNextVersion`, set by the bundle's own banner while loading.

- **HTTP port** — a viewer request through an emulated CloudFront edge (`edgeRequestHeaders`): the
  `HostRewriteFunction` jobs (a)–(c) (`x-forwarded-host`, `x-origin-verify`, `x-has-session`;
  `renderer-hosting.ts:361`), then only the `RendererOriginPolicy` allowlist (`:404`, eight headers, infra test
  `(h)`) plus the `RendererCachePolicy` keyed headers (`:473`, infra test `(a1)`; CloudFront forwards keyed
  headers), `User-Agent: Amazon CloudFront`, and cookies as `cookies[]`. Converted field by field per spec § 8.1
  item 3 (`toFunctionUrlEvent`); the result mapped back with each `cookies[i]` as its own `Set-Cookie`
  (`toHttpResponse`).
- **IPC `invoke(event)`** — a raw invocation, no edge: the warmer event, direct Function URL calls.
- Both paths call `handler` through one child function, `callHandler` (its only call site), which records every
  result's headers for B-NO30D — so every path that obtains a handler result feeds that check (review-0 rule).

Full tables (edge headers, event fields): `renderer/test/serving-bundle/README.md`.

### 2.3 Stubs

| Stub | Models | Operations the 3.1.3 adapter + renderer actually emitted (EXECUTED, full increment-1 run) |
|---|---|---|
| S3 (`s3-stub.mjs`) | Put/Get/Head/DeleteObject, ListObjectsV2 (prefix), one bucket | `GetObject→404` 8, `PutObject` 7, `GetObject→200` 7 — all path-style |
| SQS (`sqs-stub.mjs`) | `AmazonSQS.SendMessage` (JSON) | none (no STALE response in increment 1) |
| DynamoDB (`ddb-stub.mjs`, extended) | renderer table (unchanged) + tag table (`Query` by `path` @`revalidate`, with and without `revalidatedAt >`; `Query` by `tag`; `BatchWriteItem`) | renderer `Query@GSI_Domain` 90, `GetItem` 77, `Query` 1; tag `Query@revalidate` 14; tag rows written **0** |

Any operation a stub does not model is answered with a loud error and listed in `unhandled()`; row `(journals)`
fails on any. Reason: the adapter swallows S3/SQS/tag errors, so a broken cache leaves every other row green
(negative control (a), § 5).

**S3 addressing: path-style, VERIFIED** on every run by row `(journals)` (endpoint `http://127.0.0.1:<port>`;
the SDK falls back to path-style for an IP host). No `*.localhost` DNS shim.

**Measured S3 key layout** (next 16.3.8 route-scoped keys under the 3.1.3 prefix):
`_cache/<buildId>/route-cache/APP_PAGE/<sha256>/$/<host>/<path>.cache`. The CACHE-10 purge already handles this
layout (`renderer/src/app/api/revalidate/route.ts:27-41`).

**Tag rows written = 0** on 3.1.3: open-next 3.1.3 `adapters/cache.js` derives tags only for `kind === "PAGE"`,
and Next 16 stores app pages as `APP_PAGE`. This is the defect spec § 8.1 B-TAG characterizes (increment 2).

### 2.4 Environment (`harness.mjs` `bundleEnv`)

Constructed from `rendererEnv()` plus every variable of the RendererServer `environment` block
(`infra/lib/renderer-hosting.ts:244-266`): `NODE_ENV` (:245), `TABLE_NAME` (:246), `API_URL` (:247),
`CACHE_BUCKET_NAME` (:248), `CACHE_BUCKET_KEY_PREFIX` (:249, `_cache`), `CACHE_BUCKET_REGION` (:250),
`AMODX_API_KEY_SECRET` (:252), `REVALIDATION_SECRET` (:254), `NEXTAUTH_SECRET` (:256), `NEXTAUTH_URL` (:257),
`REVALIDATION_QUEUE_URL` (:259), `REVALIDATION_QUEUE_REGION` (:260), `CACHE_DYNAMO_TABLE` (:261),
`ORIGIN_VERIFY_SECRET` (:263, **armed**), `RECAPTCHA_SITE_KEY` (:265, optional; `""`). Hermetic additions:
`AWS_ENDPOINT_URL_S3`/`_SQS` (stubs), `AWS_ENDPOINT_URL` (catch-all `http://127.0.0.1:1`, so Secrets Manager and
any unstubbed service fail locally), `AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE` (a missing file: the
operator's `~/.aws/config` could set `ignore_configured_endpoint_urls` and void every endpoint override). `(iso1)`
asserts every RendererServer variable is set and every endpoint is on 127.0.0.1. Values and the source table:
`renderer/test/serving-bundle/README.md` § Environment.

The build (`rm -rf .open-next && npm run build:open`, as `renderer-hosting.ts:94-113` does) runs under the same
`NODE_OPTIONS=--require no-dotenv.cjs` journal; `(iso3)` asserts the npm root, `open-next build`, `next build`, a
`next build` worker and the Lambda host child loaded it, and that `next build` reported no env file.

### 2.5 Version-explicit expectations

Each row resolves its expectation for the bundle's open-next major (`globalThis.openNextVersion` of the running
bundle — `open-next.output.json` has no version field, OBSERVED) from a table keyed `"3"`, `"4"` or `"3,4"`.
No key for the built major → the row fails `(<row>) no expectation for version N`. 4.x keys follow spec § 4.1:
"same" there → `"3,4"` here; `c2` (BREAKS on 4.x) and the doubled-Location rows carry `"3"` only and get their
`"4"` key in `opennext-1b`. B-VERSION's `"4"` key is the ratified pin package `@opennextjs/aws`.

### 2.6 Runner and placement

`npm run test:serving-bundle` = `SERVING_TARGET=bundle node --test --test-concurrency=1
test/serving-bundle/bundle.test.mjs`; `bundle.test.mjs` imports `contract.test.mjs` first (deviation D1, § 4).
Placement = the deploy gate: `docs/runbooks/deploy-track-cache.md` § Preconditions, next to
`scripts/verify-opennext-patch.mjs` (kept; B-NO30D overlaps its LAYER 2 on the live handler). CI unchanged; PR
CI keeps `npm run test:serving` (`next` target).

## 3. Row inventory and 3.1.3 results

Both targets EXECUTED 2026-10-15 (final runs in the build report). `SAME` = the row's assertions as written.

| Row(s) | `next` target | `bundle` entry | Bundle 3.1.3 result |
|---|---|---|---|
| iso1 | pass | `"3,4"` bundle-env: the Lambda child's real env; every RendererServer var set; all AWS endpoints on 127.0.0.1; ORIGIN_VERIFY_SECRET non-empty | pass |
| iso2, iso4 | pass | `"3,4"` SAME | pass |
| iso3 | pass | `"3,4"` bundle-build-tree (§ 2.4) | pass — 18–19 processes covered (varies with the build's worker count), 8 `.env*` accesses blocked |
| a1 a2 c1 a3 b1 b2 b3 c d2 m1 m2 m3 p1 p2 t1 t2 h1 e2 f g1 g2 g3 | pass | `"3,4"` SAME | pass |
| c2 | pass | `"3"` SAME (installed-source check) | pass |
| d1 h1b h1c h2 | pass | `"3"` doubled-location | pass — MISS `Location` = `<target>,<target>` (e.g. `/no-such-page?nf=1,/no-such-page?nf=1`); the HIT carries one (OBSERVED by probe); stored entry holds one |
| d3 | pass | `"3,4"` s3-journal: the 307 is stored AND PUT; no PUT ever stored a 404 | pass |
| e1 | pass | `"3,4"` absent-or-no-store + no S3 PUT for the key | pass — observed value: 500, **no** Cache-Control (absent) |
| g4 accept ×3 | pass | `"3,4"` `{ behindEdgeStatus: 500 }`: not 403 AND the pinned status | pass — `/api/consent` 500, `/api/contact` 500, `/api/leads` 500, each `Unexpected end of JSON input` (guard passed, empty body) |
| g4 reject ×3 | pass (403) | `"3,4"` `{ behindEdgeStatus: 500 }`; title "(g4) <route>: behind the edge the renderer guard is inert (Origin stripped); the edge 403 is proven by infra test (i), not here"; asserts the pinned status and no guard rejection body | pass — `/api/consent` 500, `/api/contact` 500, `/api/leads` 500, each `Unexpected end of JSON input`: Origin/Sec-Fetch-Site never reach the Lambda, so the renderer guard is inert (as in production) |
| (journals) | not registered | `"3,4"` SAME | pass — 0 unhandled, all S3 path-style |
| B-WARM | — | `"3,4"` | pass — `{serverId:"<short id, e.g. n1iyt2>", type:"warmer"}`, no DynamoDB/S3/SQS call (wrapper `node_modules/open-next/dist/wrappers/aws-lambda.js:11-13`, `:2-8`) |
| B-ORIGINVERIFY | — | `"3,4"` | pass — wrong and missing `x-origin-verify` → 403 `Direct access forbidden`; right one → 200 |
| B-VERSION | — | `"3"` open-next, `"4"` @opennextjs/aws | pass — bundle 3.1.3, declared `^3.1.3`, locked 3.1.3 |
| B-SHARP | — | `"3,4"` sharp 0.35.5 + `@img/sharp-linux-arm64` | pass — sharp 0.35.5; `@img`: colour, sharp-libvips-linux-arm64, sharp-linux-arm64, sharp-wasm32 |
| B-NO30D | — | `"3,4"`; claim "no cache-directive header of any suite response carries 2592000; Set-Cookie excluded" | pass — 46 handler results (42 edge HTTP + 4 raw invocations: the warmer and B-ORIGINVERIFY's three direct calls), none carries 2592000 outside Set-Cookie (1 carries it in Set-Cookie: `amodx_ref`, excluded, D2). Coverage rule (review-0): `lambda-host.mjs` `callHandler` is the handler's only call site and records every result. **Limit (increment 1):** no STALE response in increment 1 — closed by increment 1A-2: the SWR patch window is now proven by B-STALE's response passing through B-NO30D (§ Increment 1A-2) |

Totals (increment 1): `next` 39/39; `bundle` 45/45 (39 + `(journals)` + 5 B-rows). Increment 1A-2: `bundle` 58/58 (§ Increment 1A-2).

**Reduced guarantee (ruling OPENNEXT1A-G4):** the bundle suite proves the renderer behind the edge; the edge
security rule is proven by infra (i). **Inventory scope:** the increment-1 operation inventory contains NO SQS
call and no STALE row; SQS and `fixISRHeaders` STALE behaviour are increment 1A-2's.

## 4. Deviations from the packet (recorded, not silent)

- **D1 — runner shape.** The packet's script listed both files. `node --test` sorts its file list (EXECUTED:
  `a/a.test.mjs` ran before `z.test.mjs` given first), and `serving-bundle/` sorts before `serving-contract/`, so
  the B-rows ran first, in another process, on a stale `.open-next`, with no responses for B-NO30D (OBSERVED in
  the first run). Fix: one entry file (`bundle.test.mjs` imports the contract suite); responses shared in memory.
- **D2 — B-NO30D excludes `Set-Cookie`** (ratified: ruling OPENNEXT1A-NO30D, operator 2026-10-15). The literal
  rule ("no header value contains 2592000") failed on the referral cookie `amodx_ref`, `Max-Age=2592000`
  (`renderer/src/app/api/ref/route.ts:88`, `maxAge: WINDOW_SECONDS`, defined at `:67` — the 30-day referral
  window). A cookie lifetime is not a cache directive; every other header stays checked, and the row logs how
  many responses carried the value only in `Set-Cookie`. The row's claim is "no cache-directive header of any
  suite response carries 2592000; Set-Cookie excluded". The spec's B-NO30D text is corrected by the operator at
  closeout (dated note under the spec's Ratification section); this slice does not edit the spec.
- **D3 — the edge also forwards the cache-key headers.** The packet said "CloudFront Function headers + the ORP
  allowlist". CloudFront also forwards every header in the cache key (`RendererCachePolicy`: `RSC`,
  `Next-Router-*`), so the host forwards them too (needed by B-RSC in increment 2; no increment-1 row sends them).
  It also emulates the `User-Agent: Amazon CloudFront` replacement (Next reads User-Agent).
- **D4 — one extra B-row, `B-ORIGINVERIFY`.** The packet asked for "one row that sends a wrong `x-origin-verify`
  → 403"; it has its own row name so the inventory can cite it.
- **D5 — `g4` restated on the bundle** (ratified: ruling OPENNEXT1A-G4, operator 2026-10-15). Spec § 4.1 says
  `g4` is "same in-process"; the packet's edge rule ("everything else the test sends is dropped") strips
  `Origin`, which makes the renderer guard inert — the production behaviour `renderer/src/lib/origin-guard.ts`
  documents. All six rows pin the status the handler returns (`"3,4": 500`); the reject rows are retitled; the
  accept rows keep "not 403" plus the pinned status. Job (d) of the CloudFront Function is not emulated (a hand
  copy of a security barrier; spec phase 2, not triggered — no row needs it for a renderer property).

## 5. Negative controls (EXECUTED 2026-10-15; each by a temporary one-line edit, restored, checksum-verified)

- (a) `CACHE_BUCKET_NAME` → `serving-bundle-negctl-other-bucket` for one run: `(journals)` FAILS listing
  `s3: GetObject/PutObject on bucket "serving-bundle-negctl-other-bucket" …`; `a2 d3 p1 h1c e1 e2` also fail;
  **`a1` still passes** — the adapter swallowed the S3 errors, which is why `(journals)` exists.
- (b) wrong `x-origin-verify` → 403: row `B-ORIGINVERIFY` (part of every run), with the right-secret control → 200.
- (c) `a1: { "3,4": SAME }` → `a1: { "4": SAME }`: `(a1)` FAILS with `(a1) no expectation for version 3 (bundle
  open-next 3.1.3)`; `(a2)` fails as a cascade (it expects the HIT that `(a1)`'s request sets up).
- (d) `g4: { behindEdgeStatus: 500 }` → `400` (review-0 rework): exactly the six `(g4)` rows FAIL ("pinned status
  behind the edge"), 39/45 pass — the pin discriminates.
- (e) IPC path bypasses `callHandler` (`await handler(m.event)` in the child's invoke listener) (revision 1):
  only `(B-NO30D)` FAILS, `the B-WARM invocation is not in the record`, 44/45 pass — the record covers raw
  invocations and the row detects a path that stops feeding it.

**Evidence for increment 1A-2 (EXECUTED probe, 2026-10-15, not a committed row):** `restart()` on a warm host
after `/published` was MISS then HIT → the cold container answered `x-nextjs-cache: STALE` with
`cache-control: s-maxage=2, stale-while-revalidate=300` (the cache-8 patched window, live in the handler) on two
consecutive requests, and the SQS stub journaled ONE `SendMessage` (body
`{"host":"fixture.serving-contract.test","url":"/fixture.serving-contract.test/published"}`, group
`revalidate-0`, deduplication id present). Zero unhandled stub calls. B-STALE turns this into a row.

## 6. Findings (not fixed here — no product change in this slice)

- **F1 — doubled `Location` on a MISS-rendered 307** reproduced locally (ratification finding, staging
  2026-10-15): `Location: /x?nf=1,/x?nf=1` on the MISS, single on the HIT and in the stored entry. Row
  D3-LOCATION (increment 2) characterizes it; root cause not traced in this increment.
- **F2 — infra test `(h)` title says "EXACTLY the ten forwarded headers"**; it asserts eight since the
  2026-10-13 removal of `x-isr`/`x-prerender-revalidate`. Name ≠ contract; a rename is an infra change (not in
  this slice's allocation) → proposed for the next infra slice.
- **F3 — `renderer/package.json` declares `"open-next": "^3.1.3"`**, a caret range, not a pin; the lockfile
  pins 3.1.3. B-VERSION compares with both. `opennext-1b` replaces it with the exact `"4.1.9"` (spec § 6.2).
- **F4 — the `next` target has the same `~/.aws/config` exposure** the bundle target closes with
  `AWS_CONFIG_FILE` (HOME is passed through; an `ignore_configured_endpoint_urls` setting would void
  `AWS_ENDPOINT_URL_DYNAMODB`). Not changed here (the packet keeps the `next` target unchanged); one line in
  `rendererEnv()` plus `(iso1)`'s allowlist would close it.
- **F5 — build cost is far below the spec estimate**: 13.1 s with no `.next`, 5.9–6.8 s warm (spec: 60–90 s).
  The `npm install sharp` step was served from the npm cache; a cold npm cache adds a registry download.
- **F6 — an empty/invalid-body POST to the write proxies answers 500 where 400 belongs** (characterized by the
  six `(g4)` bundle rows, pinned `500` `Unexpected end of JSON input`). Parse site: `renderer/src/app/api/consent/
  route.ts:20` (`await req.json()` inside `try`), caught at `:58-60` → `NextResponse.json({ error: err.message },
  { status: 500 })`; same pattern in `api/contact/route.ts:23` / `:61-63` and `api/leads/route.ts:22` / `:75-76`.
  Effects: a client error is reported as a server error (and leaks the parser's message). Not fixed here (no
  product change in this slice); a fix would move the pinned status to 400 and change the `(g4)` entry.

## 7. Non-scope

No product code, no open-next version/patch/config, no infra, no CI change, no deploy. No full CloudFront
emulation (edge cache, job (d)) — spec phase 2. No `next`-target behaviour change. Increment 2's rows.

## 8. Architectural boundaries

Tests and test infrastructure only; they import nothing from `renderer/src` and nothing from `infra/` (the edge
header lists are literals pinned by infra tests `(h)` and `(a1)`). Hermetic: no AWS endpoint, no credential,
no `.env*` read (iso1–iso4 on both targets). Tenant isolation is the contract under test, not something this
slice changes.

## 9. Migration / deployment notes

None — nothing deploys. Operator: re-run `npm run test:serving` and `npm run test:serving-bundle` on the
unchanged candidate before commit. The bundle suite replaces `renderer/.open-next` with a test build; CDK
rebuilds it on every deploy.

## 10. Definition of Done (increment 1)

- [x] `npm run test:serving` 39/39 (next target unchanged).
- [x] `npm run test:serving-bundle` 45/45 on 3.1.3.
- [x] Negative controls (a)(b)(c) recorded.
- [x] Docs: this file, both READMEs, `docs/testing-strategy.md`, deploy runbook gate, ROADMAP row.
- [ ] Reviewer approval; operator re-run; commit.

## 11. Evidence required before the slice closes

Increment 1: the build report (both runs, timings, operation inventory, negative controls). Increment 2: its
B-rows green or characterized, then `opennext-1b` uses the harness for the 4.x diff.

## 12. Exit criterion

`opennext-1b` can build 4.1.9 and read, row by row, which expectations change.

## Increment 1A-2

Status: **BUILT 2026-10-15** (OPENNEXT-1A-2; cycle 2 applies the operator rulings on review-0, § 1A-2.7; review cycle 2 escalated on OPENNEXT1A-ROUTEERR-MEANS → operator ruling applied by the operator (means (2) carries `/500`; means (1) characterized on 4.x, INFERRED until 1B) and gates re-run by the operator: next 39/39, bundle 58/58, diff --check 0).
Builder gates EXECUTED on the cycle-2 candidate: `npm run test:serving` 39/39 (next target unchanged),
`npm run test:serving-bundle` 58/58 (39 + `(journals)` + 18 B-rows), negative controls (a)–(f) below,
`git diff --check` 0. Review pending. Maturity: the harness stays PROTOTYPE until
`opennext-1b` has used it for its expectation diff (§ header); its row set is now complete.

### 1A-2.1 What was added (support code; one line per abstraction)

- *outbound-call interceptor* (`renderer/test/serving-bundle/outbound-shim.cjs`, a `--require` preload) —
  users: the Lambda host child (B-CASE; every row: refuses any outbound call) and the revalidation-function
  child (B-REVAL: routes the HEAD to the host); axis: none — it is a test seam (spec § 8.1 B-CASE/B-REVAL
  require observing and redirecting calls made inside the built code, unobtainable from outside the
  process); rejected: an HTTP-mocking package (a new dependency) and a DNS shim (cannot see the HTTPS call
  or its headers, and `.test` resolution depends on the operator's resolver).
- *host controls* (`lambda-host.mjs`: `outbound()`, `requests()`, `forwardViewerHeaders(names)`, `sync()`)
  and *stub controls* (`s3-stub.mjs` `listReturnsNothing(bool)`, `ddb-stub.mjs` `putItem(item)`) — methods
  on existing handles, each named by the rows that use it (README tables); rejected: header-borne control
  signals on the wire (a surface the bundle could see).
- `runRevalidationFunction` (`lambda-host.mjs`) — users: B-REVAL and negative control (c); the binding
  design of spec § 8.1 B-REVAL; placed beside the Lambda host because it shares the child/IPC/shim
  conventions; rejected: an inline spawn in the row.
- `operationInventory(stubs, label)` moved from `contract.test.mjs` to `harness.mjs` — two concrete callers
  now (contract describe, B-rows describe); rejected: a copy.
- `harness.mjs` `request()`: optional `body` (POSTs to `/api/revalidate`), `timeoutMs` (B-CASE), and
  `rawHeaders` in the result (D3-LOCATION: node:http keeps only the first of repeated `Location` lines).
- Fixtures: two isolation tenants `a.serving-contract.test` (`/`, with a `postGrid` block; `/about`; post
  P `/listed-post`) and `b.serving-contract.test` (`/about`). No `next`-target row requests them.

**Outbound-interceptor design.** Patches `https.request`, `https.get`, `http.request`/`http.get` to a
non-loopback host and `globalThis.fetch` to a non-loopback host before the bundle loads, then calls
`syncBuiltinESMExports()` (open-next's `proxyRequest` reads `import("node:https").then((m) => m.request)`,
the ESM facade). Each call is journaled to the parent over IPC (`{ api, method, url, headers }`) and
redirected to `SERVING_BUNDLE_OUTBOUND_REDIRECT` (deleted from the environment before the bundle loads):
`http://127.0.0.1:1` in the Lambda host child (refused locally), the host's port in the revalidation
child, unset only for control (c). Loopback HTTP (the stubs) is untouched. Not seen: raw `net`/`tls`
sockets and HTTP/2 — the two built `index.mjs` files use neither (VERIFIED by grep: server
`import("node:https").then(c=>c.request)`, revalidation `import F from"node:https"` + `F.request`).

### 1A-2.2 Rows — observed 3.1.3 values and the 4.x entries (EXECUTED, gate-2 run, 2026-10-15)

| Row | 3.1.3 observed (asserted under `"3"`) | 4.x entry |
|---|---|---|
| B-ISO | A and B `/about`: 200 MISS, own titles, no cross text; S3 keys `_cache/<buildId>/route-cache/APP_PAGE/<sha256>/$/{a,b}.serving-contract.test/about.cache` (one each); `x-next-cache-tags` NOT sent to the client — from the stored `meta.headers`: `_N_T_/layout,…,_N_T_/a.serving-contract.test/about` | `"3,4"` same (no-go if not, spec) |
| B-REFLECT | XFH A, `/b.serving-contract.test/about` → 307 `Location /b.serving-contract.test/about?nf=1,…` (doubled), no B text; stored only `a.serving-contract.test/b.serving-contract.test/about` (307); nothing new under B | `"3,4"` same |
| B-TAG | **characterized** — purge neutralized: POST 200 `purged:0`; tag-table ops from the POST to the next GET: `Query`, `Query` (by tag; two per POST, one of them after the POST answered), `Query@revalidate`; 0 writes; 0 `_N_T_/a.serving-contract.test/about` rows; next GET `HIT`, old title. Control (a): purge active → `purged:2`, `MISS`, edited title | tag row present, `MISS`, edited title |
| B-LISTING | v2 neutralized: 200 `HIT`, body contains the ORIGINAL title, not the edit (E3 executable); v1 purge active (`purged:2`): 200 `MISS`, new title, original gone. Edited titles do not contain the original | `"3,4"` same |
| B-XISR | **characterized** (origin side; prod edge strips both headers). Without headers (sent first): `/published` 200 `HIT` `s-maxage=31536000`; `/_site/fixture-tenant` 403, body "Preview URLs are only accessible via CloudFront or localhost.". With them: `/published` → 307 `MISS` `s-maxage=31536000` `Location /?nf=1,/?nf=1`, stored under key `published` (307); `/_site/fixture-tenant` → 307 `MISS` `s-maxage=31536000` `Location /fixture-tenant?nf=1,…`, stored under `_site/fixture-tenant` | status, `cache-control`, `x-nextjs-cache` and body marker (`<title>`, else body) identical to the no-header request, both paths; nothing stored outside the tenant key |
| B-RSC | navigation (`RSC: 1` + router state tree + Next-computed `_rsc`) → 200 `text/x-component` `HIT`, `Vary: rsc, next-router-state-tree, …`; `?_rsc=x` without header → HTML `HIT`; bare `RSC: 1` → 307 `Location /fixture.serving-contract.test/published?_rsc` (F8) | navigation same; bare: record |
| B-PREVIEW | `/_site/fixture-tenant` from `d111wtnnjzzsb1.cloudfront.net` → 200, `private, no-cache, no-store, max-age=0, must-revalidate`, `Set-Cookie amodx_preview_base=%2F_site%2Ffixture-tenant…`; flight canonical (RSC payload in the HTML, `"c":[…]`) = `["","fixture-tenant","_dyn"]`; `x-middleware-rewrite: https://d111wtnnjzzsb1.cloudfront.net/fixture-tenant/_dyn` | record (`_dyn` presence not pinned) |
| B-ROUTEERR | both means make routing throw (child log asserted). (1) XFH `fixture serving-contract.test` → `Routing failed. TypeError: Invalid URL`, then Next `⨯ TypeError: Invalid URL` → 500 `text/plain` body `Internal Server Error`, no `Cache-Control`, nothing stored. (2) (D13) raw invocation, `accept-language` with a line feed → `Routing failed. TypeError: Headers.append…` → the unrewritten path renders as `[siteId]=routeerr-probe` → 307 `MISS` `s-maxage=31536000` `Location /?nf=1,/?nf=1`, stored under the non-host key `routeerr-probe` (the B2 defect) | both: Next's `/500` page — status 500, `Cache-Control` contains `no-store`, `<title>` = the title of this build's prerendered global-error page (`.open-next/cache/<buildId>/_global-error.cache`; today "500: This page couldn’t load"), nothing stored. For (1) this is INFERRED to fail on 4.1.9 — DECISION OPENNEXT1A-ROUTEERR-MEANS |
| B-CASE | packet request (`Fixture.Serving-Contract.TEST` `/tenant/fixture-tenant`) → 403, 0 outbound. Reach variant (`MixedCase.staging.serving-contract.test` `/tenant/fixture-tenant`) → **characterized**: one `https.request GET https://mixedcase.staging.serving-contract.test/fixture-tenant/_dyn`; no answer within 3 s (refused; 3.1.3 `proxyRequest` has no `error` listener) | no outbound |
| D3-LOCATION | MISS 307: handler result `location` = ONE string `/no-such-page?nf=1,/no-such-page?nf=1`; 1 `Location` line on the wire; HIT `/no-such-page?nf=1` | record |
| B-STALE | warm `HIT` (control (b)); after `restart()`: `STALE`, `s-maxage=2, stale-while-revalidate=300`, 1 `SendMessage` body `{"host":"fixture.serving-contract.test","url":"/fixture.serving-contract.test/published"}`, group `revalidate-0` | `4-noseed`: STALE, no Cache-Control, 1; `4-seed`: HIT, `s-maxage=31536000`, 0 — opennext-1b selects |
| B-REVAL | message source: B-STALE's journal (ruling OPENNEXT1A-SEED-REVAL). Function HEAD `https://fixture.serving-contract.test/fixture.serving-contract.test/published`, viewer headers `x-prerender-revalidate` = the build's previewModeId, `x-isr: 1`; the edge forwarded neither; host answered 307 `MISS` `s-maxage=31536000`, doubled Location. Asserted: the 3.1.3 rule (success iff 200 + `REVALIDATED`) applied to that answer → `batchItemFailures: [serving-bundle-reval-1]`; pinned 307 / `MISS` / 1 failure | asserted rule (spec E6, § 3.G G4): success iff status ∈ {200, 307, 308, 404} AND `REVALIDATED`, else exactly one batch-item failure. Source: B-STALE's journal on `4-noseed`; fixture `REVALIDATION_MESSAGE_3_1_3` on `4-seed` (proves the function's contract, not the queue emission) |
| B-LEAK | **characterized** over 76 responses: `x-middleware-rewrite` ×47 (every rewritten response), `x-middleware-set-cookie` ×2 (preview); no `x-middleware-next` | none |
| B-NO30D | now complete: 76 handler results (72 edge, 4 invoke), none carries 2592000 outside Set-Cookie (1 in Set-Cookie, excluded); a STALE response is in the record — **proven by B-STALE's response passing through B-NO30D** | `"3,4"` same |

**Operation inventory, B-rows' stubs (EXECUTED, gate-2 run)** — extends § 2.3 with SQS and HEAD traffic:
DynamoDB `renderer:Query@GSI_Domain` 62, `renderer:GetItem` 53, `tag:Query@revalidate` 22, `tag:Query` 8,
`renderer:Query` 2; S3 `GetObject→404` 11, `PutObject` 11, `GetObject→200` 11, `ListObjectsV2` 16,
`DeleteObjects` 2; SQS `SendMessage` 1; tag rows written 0; Lambda-host outbound `https.request GET` 1
(B-CASE); viewer requests GET 26, POST 4, HEAD 1 (the revalidation HEAD). The revalidation function made
one outbound `HEAD` (journaled in its own child). Contract-rows inventory unchanged from increment 1.

### 1A-2.3 Negative controls

- (a) B-TAG with the purge ACTIVE → `MISS` + edited title. **Built into B-TAG** (every run).
- (b) B-STALE without `restart()` → `HIT`. **Built into B-STALE** (the warm GET before the restart).
- (c) B-REVAL with the redirect off (shim journals only) — EXECUTED once (2026-10-15, local probe; not in
  every run because it makes a real DNS lookup of a `.test` name): the function logged `Error revalidating
  page`, returned `batchItemFailures: [negc-1]`; the Lambda host received 0 HEADs. The redirect is what
  routes the HEAD.
- The interceptor's own positive control is B-CASE's reach variant (it must journal exactly one call).
- Cycle 2 (class rule), EXECUTED once by temporary edits on a copy-restored file (checksum verified),
  `.agent-manager/slices/OPENNEXT-1A-2/negctl-def.log`: (d) B-XISR evaluated with its 4.x logic on 3.1.3 →
  FAILS "/published: differs from the no-header request"; (e) B-LISTING variant 2 with the purge ACTIVE →
  FAILS "variant 2: the listing does not show the original title"; (f) B-ROUTEERR evaluated with its 4.x
  `/500` logic on 3.1.3 → FAILS "(1) Cache-Control". Exactly those three rows failed (55/58).
- (c) re-run on the cycle-2 candidate: same result (0 HEADs at the host, record failed).

### 1A-2.4 Deviations from the packet (recorded)

- **D6 — B-CASE reach variant added.** The packet's request answers 403 at the SITEID-BINDING-1 by-id host
  gate before any rewrite (the spec row predates that gate), so on its own it cannot show the E20 defect.
  The row keeps it (asserted as observed: 403, no outbound) and adds one request on a mixed-case host that
  passes the gate. `.test` TLD; the call is refused locally.
- **D7 — B-ISO asserts the observed key layout and tag source** (route-scoped keys; tag from stored
  `meta.headers`, the client gets no `x-next-cache-tags`), as the packet allowed.
- **D8 — B-XISR uses `/_site/<id>` without a trailing slash**: with it, Next's trailing-slash 308 answers
  before the middleware, header or not (OBSERVED), so the row would not test the bypass.
- **D9 — controls (a) and (b) are permanent parts of their rows**; (c) was executed once (DNS).
- **D10 — the Lambda host child now refuses outbound calls** (before: they would have gone to the network).
  The contract rows' results and their inventory are unchanged (39 + `(journals)` green; same counts).
- **D11 — B-RSC's request is a client-navigation request** (router state tree + `_rsc` from Next's own
  `computeCacheBustingSearchParam`); a bare `RSC: 1` is recorded separately (F8).
- **D13 — B-ROUTEERR has a second means (cycle 2).** The packet fixed means (1) (invalid XFH host), which
  works (routing throws) but cannot show the row's stated guarantee on either version: on 3.1.3 Next fails
  on the same host, so the "unrewritten render" never happens; on 4.1.9 the `/500` event is built with
  `new URL` on that host and throws again (INFERRED from the 4.1.9 source). Means (2) — a raw invocation
  whose `accept-language` value contains a line feed (not sendable through any HTTP server, so not through
  CloudFront) — keeps the host valid: OBSERVED on 3.1.3 it reproduces B2 exactly. Means (1) stays in the
  row, asserted as observed. Decision OPENNEXT1A-ROUTEERR-MEANS below.
- **D12 — B-PREVIEW on 3.1.3 asserts `_dyn` IS in the flight canonical.** The packet's 3.1.3 cell says
  "(expect no `_dyn`)"; spec § 3.B B5 places "no `_dyn`" on 4.x, and the bundle shows `_dyn` on 3.1.3.
  Asserted as observed; contradiction recorded here.

### 1A-2.5 Findings (no product change in this slice)

- **F7 — B-XISR quantifies the origin-side hole (spec § 3.C C1 / § 5.4).** If `x-isr` ever reached the
  function (an ORP change, or a rollback that keeps a 4.x ORP), any value would skip the whole middleware:
  a cacheable 307 stored under a non-host key (`published`), and `/_site/<id>` past the preview gate. Prod
  is protected only by the ORP (infra test (h)). Matches the spec prediction.
- **F8 — bare `RSC: 1` → 307 to the rewritten internal path** (`/<host>/published?_rsc`, no
  Cache-Control). Not predicted by spec § 8.1 B-RSC. Mechanism INFERRED: 3.1.3 hands Next the rewritten URL
  (spec § 3.B B4), and Next 16's `_rsc` hash check redirects to that URL. A real client navigation (router
  headers + hash) is served correctly. Exact cause of the bare-shape mismatch (the query reset on a
  middleware rewrite, `core/routing/middleware.js:123-130`, is a candidate) not traced.
- **F9 — B-ROUTEERR: with an invalid-host trigger, Next fails too**, so B2's "renders the unrewritten path"
  is not reachable by this means; the observable is 500 with no Cache-Control (not stored). Note: a routing
  exception on 3.1.3 skips the whole middleware, including the `ORIGIN_VERIFY_SECRET` check (INFERRED from
  `core/requestHandler.js:24-29`; not separately probed).
- **F10 — 3.1.3 `proxyRequest` never answers when its outbound call fails** (no `error` listener,
  `core/routing/util.js:188-223`): a Lambda would run to its timeout. Reached only through the
  case-sensitive `isExternal` (B-CASE). In production the proxy target is CloudFront, so the call normally
  succeeds — as a second invocation (E20).
- **F11 — doubled `Location` is produced inside the adapter/Next** (D3-LOCATION: the handler result already
  holds the doubled string). Appended to the `docs/TECH-DEBT.md` entry.
- **F13 — 3.1.3 B2 reproduced (B-ROUTEERR means (2)):** a routing exception on 3.1.3 renders the
  UNREWRITTEN path with `[siteId]` = its first segment and stores a cacheable 307 under that non-host key —
  the defect spec § 3.B B2 describes (OBSERVED; reached here only through an invalid header value).
- **F12 — B-REVAL confirms on the bundle** what TECH-DEBT "background revalidation HEAD and the doubled
  path" measured under `next start`: the HEAD for `/<host>/published` gets the host's own 307 `MISS`
  `s-maxage=31536000`, and the record fails. Whether that 307 is stored in S3 was NOT asserted by the row.

### 1A-2.6 Definition of Done (increment 2)

- [x] `npm run test:serving` 39/39 (EXECUTED).
- [x] `npm run test:serving-bundle` 58/58 with the 3.1.3 entries (EXECUTED).
- [x] Negative controls (a)–(f) (EXECUTED).
- [x] Docs: this section, `renderer/test/serving-bundle/README.md`, `renderer/test/serving-contract/README.md`,
  `docs/testing-strategy.md`, `docs/TECH-DEBT.md` (one appended line), `docs/ROADMAP.md`,
  `docs/runbooks/deploy-track-cache.md` (the B-NO30D sentence; allocated by the cycle-2 ruling).
- [ ] Reviewer approval; operator re-run; commit.

### 1A-2.7 Cycle 2 — operator rulings on review-0 (2026-10-15) and how they were applied

- **OPENNEXT1A-SEED-REVAL:** B-REVAL takes B-STALE's journaled message where B-STALE's expectation queues
  one (3.x, `4-noseed`), else the fixture `REVALIDATION_MESSAGE_3_1_3` (`fixtures.mjs`, the 3.1.3 body
  copied verbatim). The branch is chosen from B-STALE's EXPECTATION, not from whether a message exists, so
  a missing 3.x message fails the row instead of falling back silently. The row logs its source. On 4.x
  B-REVAL therefore needs B-STALE's 4.x entry selected (it fails "no expectation for version 4" until then,
  like B-STALE itself).
- **Class rule — rule stated once:** *every version entry asserts the observable that carries the row's
  stated guarantee; a log line is never the only check of a guaranteed property.* Applied to B-LISTING
  (original title present in a 200 listing), B-XISR (4.x: four fields identical, both paths), B-ROUTEERR
  (4.x: `/500` page marker), B-REVAL (both: the version's success rule asserted against the actual
  answer), B-STALE (warm status added). The 4.x entries that stay `"record"` — B-RSC bare shape, B-PREVIEW
  canonical, D3-LOCATION — are the ones the packet itself marks "record" for 4.x; each still asserts its
  version-independent guarantee (status / no-store / cookie; 307 + MISS + single-valued HIT).
- **Allocation:** `docs/runbooks/deploy-track-cache.md` B-NO30D sentence updated.

DECISION OPENNEXT1A-ROUTEERR-MEANS (open; does not block the 3.1.3 baseline): see the build report of
cycle 2. Question: should B-ROUTEERR keep means (1) under its 4.x `/500` assertion, given the 4.1.9 source
predicts a handler crash (502) for it?

## References

`docs/slices/opennext-1-upgrade.md` § 3, § 4.1, § 6.3, § 8.1, § Ratification; `renderer/test/serving-bundle/README.md`;
`renderer/test/serving-contract/README.md`; `docs/testing-strategy.md` taxonomy item 2;
`docs/runbooks/deploy-track-cache.md` § Preconditions; `infra/lib/renderer-hosting.ts`.
