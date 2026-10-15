# Slice OPENNEXT-1A — built-bundle serving harness (baseline on open-next 3.1.3)

Status: BUILT increment 1 of 2 (OPENNEXT-1A-1, 2026-10-15; review cycle 1 escalate → operator rulings OPENNEXT1A-G4 / OPENNEXT1A-NO30D, cycle 2 approved; operator gates on the unchanged candidate: next 39/39, bundle 45/45, diff --check 0). Increment 2 (the B-rows) next.
increment 2 (OPENNEXT-1A-2) not started (§ Increment 1A-2). ROADMAP shows `BUILT (increment 1 of 2)`.
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
| B-NO30D | — | `"3,4"`; claim "no cache-directive header of any suite response carries 2592000; Set-Cookie excluded" | pass — 46 handler results (42 edge HTTP + 4 raw invocations: the warmer and B-ORIGINVERIFY's three direct calls), none carries 2592000 outside Set-Cookie (1 carries it in Set-Cookie: `amodx_ref`, excluded, D2). Coverage rule (review-0): `lambda-host.mjs` `callHandler` is the handler's only call site and records every result. **Limit:** no STALE response in increment 1, so the live SWR patch window is not yet proven here (B-STALE, 1A-2; see § 5 probe) |

Totals: `next` 39/39; `bundle` 45/45 (39 + `(journals)` + 5 B-rows).

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

Next increment (not started). Remaining B-rows, from spec § 8.1: **B-ISO, B-TAG, B-LISTING, B-STALE, B-XISR,
B-LEAK, B-RSC, B-PREVIEW, B-ROUTEERR, B-CASE, B-REFLECT, B-REVAL, D3-LOCATION** — next increment. Known stub
work: S3 `ListObjectsV2` with `delimiter` (`CommonPrefixes`) and `DeleteObjects` for the CACHE-10 purge
(`renderer/src/app/api/revalidate/route.ts`); B-REVAL needs the revalidation function driven from the SQS journal.

## References

`docs/slices/opennext-1-upgrade.md` § 3, § 4.1, § 6.3, § 8.1, § Ratification; `renderer/test/serving-bundle/README.md`;
`renderer/test/serving-contract/README.md`; `docs/testing-strategy.md` taxonomy item 2;
`docs/runbooks/deploy-track-cache.md` § Preconditions; `infra/lib/renderer-hosting.ts`.
