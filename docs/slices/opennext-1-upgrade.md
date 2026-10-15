# OPENNEXT-1: Upgrade the renderer adapter from `open-next@3.1.3` to `@opennextjs/aws@4.1.x`

- **Status:** PLANNED — specification only (2026-10-13). No code, config, infra, dependency or
  lockfile change is part of this document. Implementation starts only after the
  `DECISION_REQUIRED` blocks in § 11 are ratified.
- **Track:** CACHE / serving adapter. Supersedes the `opennext-1 PARKED` entry in
  `docs/TECH-DEBT.md` (that entry treated the upgrade as an image fix; this spec shows it is the
  structural fix for cache freshness and for two security-class adapter defects).
- **Depends:** `CACHE-10` (committed `51a2fe8`; the prod renderer Lambda was updated
  2026-10-13T14:50Z, VERIFIED `list-functions`, INFERRED to be this commit); the `x-isr` removal
  (`6038706`); the tag-cache GSI rename (`159537b`, `8061298`). All three are the starting state.
- **Source plan:** none. This document is the plan. Its evidence base is four research reports in
  the relay's operational directory (`.agent-manager/slices/OPENNEXT-1-SPEC/research/01..04`,
  gitignored, therefore NOT durable). Every load-bearing claim from them is restated here with its
  own evidence, and the claims they got wrong are corrected in § 0.3.
- **Maturity target:** the serving adapter layer moves from "unsupported, frozen at 3.1.3" to
  MATURE (supported upstream, executable contract through the real bundle). PRODUCTION after a
  14-day prod soak with the § 9 watch list green.
- **Exit criterion:** an edit to a page AND to a listing becomes visible in served HTML through the
  real Lambda bundle without the nightly flush; the `x-isr` hole stays closed; the adapter receives
  upstream security and Next-compatibility fixes again.

---

## 0. How to read this document

### 0.1 Evidence labels

- **VERIFIED** — read for this spec in code (file:line given), in npm metadata, in a live AWS read-only
  call, or in a built artefact. In the repo's taxonomy (`docs/documentation.md`) this is
  `OBSERVED` (artefact/code inspected) or `EXECUTED` (command run, output seen).
- **INFERRED** — reasoned from code, not executed. Each load-bearing INFERRED claim names the
  experiment (§ 8) that settles it. **INFERRED-high** = the full code path was traced; only the
  runtime confirmation is missing.

### 0.2 Path shorthands

| Short | Meaning | How to reproduce |
|---|---|---|
| **O** | `open-next@3.1.3/dist/` (installed, with the cache-8 patch applied) | `node_modules/open-next/dist/` |
| **N** | `@opennextjs/aws@4.1.9/dist/` | `npm pack @opennextjs/aws@4.1.9` and unpack |
| **N10** | `@opennextjs/aws@4.1.10/dist/` | `npm pack @opennextjs/aws@4.1.10` and unpack |
| **NX** | `next@16.3.8/dist/` (installed) | `node_modules/next/dist/` |
| **RH** | `infra/lib/renderer-hosting.ts` | repo |
| **MW** | `renderer/middleware.ts` | repo |
| **RV** | `renderer/src/app/api/revalidate/route.ts` | repo |

### 0.3 Corrections to the research reports (VERIFIED in code)

The four reports disagreed in places. These are the settled answers; the rest of the document
uses them.

| Topic | Report said | Code says |
|---|---|---|
| SQS send on STALE in 4.x | report 03: handed to `waitUntil`, does not block the response | **Awaited inline.** The `aws-lambda` wrapper passes only `streamCreator` (N `overrides/wrappers/aws-lambda.js:29-31`); `queue/sqs.js:23-28` falls back to `await send` when there is no `waitUntil`. Report 04 was right. |
| STALE header in 4.x | report 01 § 2: STALE after `revalidatePath` emits `s-maxage=2, stale-while-revalidate=2592000` | In 4.x a `revalidatePath` produces a **MISS**, not a STALE (§ 3.F). The STALE that does occur (#1250, cold container) carries **no `Cache-Control` at all**: N `core/routing/util.js:330-332` returns early when there is no `s-maxage`, and Next sets none when `cacheEntry.cacheControl` is undefined (NX `build/templates/app-page-runtime.js:1096-1119`, `server/send-payload.js:60`). |
| 3.1.3 default overrides | report 02: 3.1.3 defaulted to the `-lite` variants | With **no** `override` block (amodx), 3.1.3 keeps the non-lite `cache/tag/dynamodb.js`, `cache/incremental/s3.js`, `queue/sqs.js`. The `-lite` default applies only when an override object is given (O `plugins/resolve.js:26-35`). `.open-next/open-next.output.json` confirms `s3` / `dynamodb` / `sqs`. Key layout is identical either way. |
| Target version | all reports: 4.1.9 | **4.1.10 was published 2026-10-13T14:35Z** (npm `time`), after the research. Its only runtime change is in `core/routing/middleware.js` and it is inert for amodx (§ 2.2). |
| `x-isr` needed for revalidation HEADs | reports 01/02: the cache-7 headers stay "both required" | For amodx only `x-prerender-revalidate` is load-bearing. The HEAD URL is `https://<host>/<host>/<slug>`; the doubled path contains a `.`, so MW line 159 returns `NextResponse.next()` and the middleware never rewrites it, bypass or not (§ 5.4). |

---

## 1. Problem statement (plain language)

**What the renderer adapter is.** Next.js produces a web application that expects to run on a
long-lived Node server. AWS Lambda is not that. OpenNext is the translation layer: it turns a
Lambda event into a Node request, runs our `middleware.ts`, runs Next, stores rendered pages in
S3 (the "ISR cache", our Layer 2), records which page depends on which "tag" in a DynamoDB
table, and queues background re-renders in SQS. Every public page of every tenant passes through
it. CloudFront (Layer 1) sits in front and stores what OpenNext tells it to store.

**Where we are.** We run `open-next@3.1.3`, released October 2024. It predates Next 16 by 13
months. We run Next 16.3.8. Nobody upstream tests this pairing. It worked well enough to serve
pages, but on 2026-10-13 we proved that the pairing has failed silently in four ways:

1. **Edits never reached visitors.** `revalidatePath` works by tags. 3.1.3 writes tag rows only
   for the old Pages Router kind `PAGE` (O `adapters/cache.js:209-213`). Every amodx page is App
   Router kind `APP_PAGE`, so no row was ever written and every `revalidatePath` was a no-op.
   The tag table holds **0 items on prod and staging** (VERIFIED, `describe-table` 2026-10-13).
   Edits appeared only at the nightly flush. `CACHE-10` (committed today) works around this by
   deleting the edited tenant's whole S3 cache on every edit.
2. **A cache-poisoning hole.** 3.1.3 skips our tenant middleware for ANY request that carries a
   header named `x-isr` (O `core/routing/middleware.js:27`). CloudFront forwarded that header
   from viewers (cache-7). One anonymous request could store a one-year redirect under a real
   page's address. Reproduced on staging, closed today by no longer forwarding the header
   (`6038706`). The price: OpenNext's background re-render can no longer save anything.
3. **Pages look "stale" once they are older than one second, in every Lambda container that
   did not render them.** This is upstream issue #1250 (still open). It is why the live tenant
   homepages answer `x-nextjs-cache: STALE` today (observed live by report 02). Each STALE response enqueues a background re-render. That
   produced **52,059 SQS messages in the last 7 days** (VERIFIED, CloudWatch). About 91% of them
   are for scanner junk URLs, and the resulting revalidation requests are about a third of all
   renderer invocations (both shares from report 02's Logs Insights counts).
4. **Two adapter parts are broken outright.** The warmer has failed on **every** run (864 of 864
   invocations failed in the last 24 h, VERIFIED) because CDK sets the env names of an older
   OpenNext (`FUNCTION_NAME`/`CONCURRENCY`, RH:267-268) while both versions read `WARM_PARAMS`.
   The image optimizer cannot work with Next 16.3.8 (call-signature mismatch, fixed in 4.x).

**Why the upgrade is the structural fix.** 4.1.x writes tag rows for `APP_PAGE` (N
`adapters/cache.js:450`, upstream #1209 in 4.1.1), so `revalidatePath` starts to work. It
authenticates the internal-request bypass with a per-build secret instead of trusting any header
(N `core/routing/middleware.js:28-31`). It carries every Next 16 / 16.3 / 16.3.8 compatibility
fix (Turbopack runtime detection, 16.3 revalidation semantics, the 16.3.8 cache-key format) and
two security fixes in the routing layer that 3.1.3 lacks (a CVE-2025-29927-class middleware
bypass, #810; a percent-encoded-path middleware bypass, #1199). And it is maintained: security
floors for new Next patches arrive within hours to about a day (§ 2.3).

**What the upgrade does NOT fix by itself.** It does not fix #1250. It does not make
`revalidatePath('/<host>', 'layout')` refresh listings (that call matches nothing in any
version, § 5.2). It does not fix the warmer env names. It still hard-codes the 30-day edge
stale window; for today's routes that code is unreachable on 4.x (§ 5.7), but our patch must be
re-cut or deliberately dropped. Each of these has a decision in § 11.

---

## 2. Target version and rationale

### 2.1 The pin

- **Recommended:** `@opennextjs/aws` **`4.1.10`, exact pin** (no caret). The patch file is keyed
  to the exact version (`patches/@opennextjs+aws+4.1.10.patch`), and patch-package applies a
  patch to a different version with only a warning when context still matches (VERIFIED,
  `node_modules/patch-package/dist/applyPatches.js:170-186`). An exact pin makes every adapter
  change a reviewed diff. Decision `OPENNEXT1-PIN` (§ 11).
- **Peer range:** `next: ">=15.5.27 <16 || >=16.3.8"` (VERIFIED, `npm view
  @opennextjs/aws@4.1.10 peerDependencies`). Our `renderer/package.json:22` `"next": "~16.3.8"`
  satisfies it. Any 16.3.0–16.3.7 downgrade is outside the range.
- **The real guard against an unsupported Next minor is our own `~16.3.8` pin, not the peer
  range.** The range is floor-only, so npm would accept 16.4.x without a warning (INFERRED from
  the range). The 4.x build check (#1094) rejects only a Next *major* missing from its table or
  older than two years.

### 2.2 Why not newer, older, or a different package

| Candidate | Verdict | Evidence |
|---|---|---|
| `4.1.10` (latest, 2026-10-13) | **Recommended** | `dist/` diff vs 4.1.9 = `core/routing/middleware.js` and its `.d.ts` only (VERIFIED, `diff -rq`). The change filters request headers to the list in `x-middleware-override-headers`. Next emits that header only when middleware passes `request.headers` (NX `server/web/spec-extension/response.js:24-40`); MW never does (VERIFIED, grep: only `headers:` at MW:129 is a *response* header). `core/routing/util.js` is byte-identical (VERIFIED `cmp`), so the re-cut patch hunks are unchanged. |
| `4.1.9` | Acceptable fallback | The version every research build and read used. Two real builds of this monorepo succeeded (report 03; artefact still present and re-inspected: bundle carries the patched `300`, sharp 0.35.5 linux-arm64). |
| `< 4.1.7` | Rejected | Not compatible with the Next 16.3.8 scoped cache keys (#1270, 4.1.7). Peer floor `16.3.6` only from 4.1.6. |
| `< 4.1.1` | Rejected | No `APP_PAGE` tag persistence (#1209). The upgrade would not fix "edits never go live". |
| Next 16.4 + a future 4.x | Not now | PR #1285 "Upgrade to Next.js 16.4 and fix routing issues" is OPEN (VERIFIED `gh api`, updated 2026-10-12). Next 16.4.0 shipped 2026-10-06. |
| legacy `open-next` package | Rejected | Frozen at 3.1.3; still the npm `latest` of that name and not deprecated (VERIFIED `npm view open-next`). This matters for § 6.2: `npx open-next` without the new package installed downloads 3.1.3. |

### 2.3 How the pin is maintained, and the expected lag for Next security patches

Measured from npm publish timestamps (report 04 table; spot-checked for this spec: next 16.3.8
2026-09-30T16:07Z → `@opennextjs/aws` 4.1.7 2026-10-02T13:34Z = ~45 h, VERIFIED):

| Kind of Next release | Upstream adapter response | Lag observed |
|---|---|---|
| Security patch inside a minor (16.0.9, 16.0.10, 16.1.5, 16.2.3, 16.2.5, 16.2.6, 16.2.11, 16.3.3) | floor-raising release | **<1 h to ~21 h** |
| Patch that changes cache internals (16.3.8 scoped keys) | compatibility release 4.1.7 | **~45 h** |
| Floor bump after 16.3.6 | 4.1.6 | ~6 days |
| New minor (16.3.0) | in range at once; behaviour fix (#1207) | **22 days** |
| New major (16.0.0) | 3.9.0 "Add support for Next 16" | **27 days** |
| 16.4.0 (2026-10-06) | not yet | ≥ 7 days and counting |

Maintenance rule (proposed, part of `OPENNEXT1-PIN`):

1. A Next **patch** inside 16.3.x: take it under the existing adapter pin (the peer range
   accepts it), run the bundle harness (§ 8.1) and the staging probes. Bump the adapter only if
   the Next patch changes cache or routing internals (16.3.8 was such a patch).
2. A Next **minor**: wait for the upstream adapter release that declares it, then treat it as
   its own slice.
3. An adapter **patch**: diff `dist/` against the pinned version (as done for 4.1.10 in § 2.2),
   re-cut the patch if `util.js` / `adapters/cache.js` moved, run the harness.

Project health, for risk weighting (report 04, VERIFIED there via `gh api`): 91 releases in 24
months; effectively two maintainers; the Cloudflare adapter is the main consumer, and several
fixes are verified on Workers, not Lambda (PR #1302 says so explicitly).

---

## 3. Behaviour change inventory (3.1.3 → 4.1.10)

Every change that touches an amodx surface. **Row rule (every row, no exceptions):** the change;
the 3.1.3 evidence (**O**) and the 4.x evidence (**N**, or **N10** where 4.1.10 differs) as
`file:line`, or `none — checked <path>` where one side has no equivalent code; the amodx surface
as `file:line`; the user-visible effect; and a label. The label covers the *effect*. A runtime
effect stays INFERRED until an experiment in § 8 runs it, even when every code line is VERIFIED.
An "unchanged" row is kept only when the invariant is load-bearing and code on both sides shows
it. Items that are not version changes (observations, untraced risks) are in § 3.M, not here.
amodx shorthands: MW = `renderer/middleware.ts`, RV = `renderer/src/app/api/revalidate/route.ts`,
RH = `infra/lib/renderer-hosting.ts`, PG = `renderer/src/app/[siteId]/[[...slug]]/page.tsx`.

### 3.A Event conversion (Function URL payload v2 → internal event)

| # | Change | 3.1.3 (O) | 4.x (N) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| A1 | `InternalEvent.url` becomes absolute (`https://<x-forwarded-host>…`) instead of relative | `converters/aws-apigw-v2.js:62` | `overrides/converters/aws-apigw-v2.js:64`, `overrides/converters/utils.js:18` | MW:250-252 (reads `x-forwarded-host` itself) | none: the tenant host is derived the same way | code VERIFIED; effect INFERRED (bundle rows a1/c) |
| A2 | `host` overwritten with `x-forwarded-host` before routing — unchanged | `core/requestHandler.js:13-14` | `core/requestHandler.js:31-32` | MW:250-252; `renderer/src/lib/tenant-directory.ts:81` | none | VERIFIED (same code both sides) |
| A3 | Response-header blacklist and cookie handling: `cookies[]` joined into `cookie`; `set-cookie` moved to the response `cookies[]`; 4.x lowercases keys first | `converters/aws-apigw-v2.js:26, 46-49, 88` | `overrides/converters/aws-apigw-v2.js:27, 45-48, 92` | `renderer/src/app/api/ref/route.ts:85` (`amodx_ref`); `renderer/src/app/api/auth/[...nextauth]/route.ts:36-37` (session cookie); MW:239-245 | none expected: cookies still reach the browser one per `Set-Cookie` | code VERIFIED; effect INFERRED (bundle row g3, E18) |

### 3.B Routing order and request handling

| # | Change | 3.1.3 (O) | 4.x (N) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| B1 | Viewer-supplied Next/OpenNext internal headers (`x-middleware-*`, `x-matched-path`, `x-now-route-matches`, `x-nextjs-data`, `x-opennext-*`, …) are stripped from the incoming request | none — checked `core/routingHandler.js` (0 matches for `x-matched-path` / an internal-header list) | `core/routingHandler.js:31-42, 74-76` | RH:410-459 (the ORP already deletes every header not on its allowlist) | none behind CloudFront; hardening only for direct Function-URL hits, which MW:138-145 already 403s | VERIFIED code; effect INFERRED |
| B2 | A routing/middleware exception renders `/500` (no-store) instead of passing the **unrewritten** event to Next | `core/requestHandler.js:24-29` (catch → `warn("Routing failed.")`, event continues) | `core/routingHandler.js:209-218` | MW:261-263; `renderer/src/lib/tenant-directory.ts:81-108` (catches its own errors, fails open) | a middleware crash can no longer render the raw path as `[siteId]=<first segment>` and store a cacheable 307 | code VERIFIED; effect INFERRED (bundle row B-ROUTEERR) |
| B3 | 404 fall-through no longer exempts `/api*` | `core/routingHandler.js:78-96` (`isApiRoute` exemption) | `core/routingHandler.js:168-182` | MW:157 (`/api` passes through); every handler under `renderer/src/app/api/` is a static route in `.next/routes-manifest.json` (report 01 fact 5) | none | INFERRED |
| B4 | `req.url` handed to Next is the **browser-visible** URL (`/about`); the rewritten path travels as `invokePath` | `core/requestHandler.js:62-76` (`url: preprocessedEvent.url`, the rewritten path) | `core/requestHandler.js:205-217` (line 215); Next derives the cache key and the pathname tag from `resolvedPathname` = route pattern + params matched on `invokePath`: NX `server/base-server.js:936-975, 1620-1645`, `server/route-modules/route-module.js:598-615`, `server/app-render/app-render.js:1583-1591` | MW:265-269 (rewrite to `/<host><path>`); PG:22-26 (ISR route) | none if the trace holds: the ISR key keeps `/<host>/…`. If it does not hold: cross-tenant content or no caching (§ 7.1 N1) | code INFERRED-high; **P0 runtime gate** B-ISO / E12 (upstream #1242 is OPEN) |
| B5 | Preview RSC payloads stop carrying the rewritten `/<siteId>/_dyn/…` canonical URL (consequence of B4) | `core/requestHandler.js:62-76` (Next receives the rewritten path as `req.url`) | `core/requestHandler.js:215` (Next receives the visible path) | MW:174-191 (A2b self-heal for leaked `_dyn` links) | new leaked `_dyn` links should stop being minted; the self-heal stays harmless | INFERRED (E19, B-PREVIEW) |

### 3.C Middleware execution

| # | Change | 3.1.3 (O) | 4.x (N / N10) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| C1 | **ISR bypass requires the per-build secret**: `x-isr` AND `x-prerender-revalidate === previewModeId` | `core/routing/middleware.js:26-28` (any `x-isr` value) | `core/routing/middleware.js:25-31` | MW:138-145 (origin verify), MW:170-172 (`/_dyn` refusal), MW:219-224 (`/_site/` host gate), MW:261-263 (unknown-host 404) | a forged `x-isr` can no longer skip the tenant barrier, even if a header reached the origin | code VERIFIED; effect INFERRED (B-XISR, § 8.5) |
| C2 | Matcher also tests the **decoded** path (#1199, percent-encoded bypass) | `core/routing/middleware.js:23` (normalized path only) | `core/routing/middleware.js:33-44` | MW:312-317 (matcher), MW:170-172, MW:186-191 | an encoded path (e.g. `%5Fdyn`) can no longer skip middleware | code VERIFIED; effect INFERRED |
| C3 | `x-middleware-rewrite` / `x-middleware-next` no longer copied into the viewer response | `core/routing/middleware.js:72` (deletes only `x-middleware-override-headers`), `:77-86` (copies every other header) | `core/routing/middleware.js:89-104` | MW:276-278 (every rewritten response) | today every rewritten response exposes `x-middleware-rewrite: https://<host>/<host>/…`, stored in CloudFront with the object; after: gone. Not keyed, no cache effect | code VERIFIED; live leak INFERRED (E22, B-LEAK) |
| C4 | Same-origin redirect `Location` normalized to **relative** (#941) | `core/routing/middleware.js:90-97` (only `http://localhost:3000` replaced) | `core/routing/middleware.js:108-109`; `core/routing/util.js:404` | MW:186-191 (A2b 308) | the 308 `Location` may become relative; contract rows m1/m2 parse the pathname and pass either way | INFERRED |
| C5 | Middleware rewrite keeps the full URL; query passed raw, not re-encoded (#817/#844/#1287) | `core/routing/middleware.js:108-135` | `core/routing/middleware.js:127-146` | MW:195-197 (twin discriminator `search !== ''`), MW:265-269 | none: MW tests only "any query" | INFERRED |
| C6 | Multiple `Set-Cookie` from middleware preserved (`getSetCookie()`, #1191/#1240) | `core/routing/middleware.js:80-84` | `core/routing/middleware.js:105-106, 117-123` | MW:239-245 (one cookie, `amodx_preview_base`) | none today | VERIFIED code; effect INFERRED |
| C7 | (4.1.10 only) request headers not listed in `x-middleware-override-headers` are dropped | none — checked `core/routing/middleware.js` (`:72` deletes the header, no filter) | N10 `core/routing/middleware.js:135-141, 182`; Next emits the header only when `request.headers` is passed (NX `server/web/spec-extension/response.js:24-40`) | MW never passes `request.headers` (grep: the only `headers:` is the response header at MW:129) | none | VERIFIED |

### 3.D Response headers per cache state

CloudFront `RendererCachePolicy` (RH:479-483): `defaultTtl 0`, `minTtl 0`, `maxTtl 365d`. The
origin's directive decides storage, and **no directive means not stored**. Header code:
O `core/routing/util.js` `fixISRHeaders` 364-397, `fixSWRCacheHeader` 254-265,
`addOpenNextHeader` 270-276; N `core/routing/util.js` `fixISRHeaders` 325-356,
`fixSWRCacheHeader` 250-261, `addOpenNextHeader` 266-277.

| # | State: change | 3.1.3 (O) | 4.x (N) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| D1 | ISR MISS: `s-maxage=31536000` in both | `core/routing/util.js:364-397` (`fixISRHeaders` has no MISS branch) | `core/routing/util.js:325-356` (no MISS branch) | PG:22 (`revalidate = false`) | none | VERIFIED code |
| D2 | ISR HIT, warm container: `s-maxage=31536000` in both | `util.js:384` guard (`!== 31536000`) | `util.js:341` guard | PG:22 | none | VERIFIED code |
| D3 | **STALE, cold container (#1250)**: Next emits no `Cache-Control` (NX `build/templates/app-page-runtime.js:1096-1119`, `server/send-payload.js:60`). 3.1.3 writes `s-maxage=2, stale-while-revalidate=300` (patched); 4.x writes nothing | `util.js:390-396` (unconditional STALE branch) | `util.js:330-332` (early return without `s-maxage`) | PG:22; RH:481 (`defaultTtl 0`) | today the edge stores the STALE copy 2 s and serves it stale ≤ 300 s; after: **the edge stores nothing**, so more requests reach Lambda — unless § 5.6 removes the STALE | code VERIFIED; live 3.1.3 shape OBSERVED (report 02); 4.x edge effect INFERRED-high (E1) |
| D4 | Tag-revalidated entry (after `revalidatePath`): 4.x gives a **MISS** + blocking render | none — no tag rows are written for `APP_PAGE` (`adapters/cache.js:209-213`), so no read ever sees a revalidation | `overrides/tagCache/dynamodb.js:95-145`; `utils/cache.js:66-87`; `adapters/cache.js:85-94` | RV:166 | the edited page is fresh on the next request | code VERIFIED; effect INFERRED (E2, B-TAG) |
| D5 | REVALIDATED (revalidation HEAD) → `private, no-cache, no-store…` | `util.js:365-369` | `util.js:333-336` (only if `s-maxage` present) | RH:444-459 (the HEAD cannot reach the origin with `x-prerender-revalidate` today) | none | VERIFIED code |
| D6 | 404 rendered by Next → 4.x forces `private, no-cache, no-store, max-age=0, must-revalidate` (opt-out `OPEN_NEXT_DANGEROUSLY_SET_ERROR_HEADERS`) | none — checked `http/openNextResponse.js` (no error override); only `util.js:237-243` for `rawPath` `/404`, `/500` | `http/openNextResponse.js:154, 225, 330-334` → `utils/cacheHeaders.js:51-57` | `renderer/src/lib/not-found-handoff.ts:55-58` (twin 404); `renderer/src/app/[siteId]/robots.txt/route.ts:11`, `llms.txt/route.ts:12` (handler 404s with no header today) | a 404 can never be stored by CloudFront, whichever route produced it | code VERIFIED; effect INFERRED (E16, E22) |
| D7 | 500 thrown render → same forced no-store | none — checked `http/openNextResponse.js` (no status-based override) and `core/routing/util.js:237-243` (only `rawPath` `/500`) | `http/openNextResponse.js:330-334` → `utils/cacheHeaders.js:51-57` | `renderer/src/lib/dynamo.ts:63-66` (`requireTableName()` throws; failed reads propagate, CACHE-1-D4) | header changes from "none" to no-store; "never stored" holds in both | code VERIFIED; edge effect INFERRED (E21) |
| D8 | 307 `?nf=1` handoff → cacheable in both (307 is not overridden) | none — checked `http/openNextResponse.js` (no status-based override) | `utils/cacheHeaders.js:55` overrides only 404/500 | `renderer/src/lib/not-found-handoff.ts:58` | none | VERIFIED code |
| D9 | Middleware direct responses (403, 404 `private, no-store`, 308) returned as set by MW | `core/requestHandler.js:47-61` | `core/requestHandler.js:100-125`; the post-processing runs on a **copy** of the headers (`http/openNextResponse.js:136-145`), the returned result is unchanged | MW:126-131, MW:143, MW:190, MW:223 | none | VERIFIED code |
| D10 | Route handlers keep their own `Cache-Control`; `fixSWRCacheHeader` rewrites only a *bare* `stale-while-revalidate` | `util.js:254-265` | `util.js:250-261` | `renderer/src/app/[siteId]/sitemap.xml/route.ts:71` (`stale-while-revalidate=59` has a value, so it is untouched); `openai-feed/route.ts:41` | none | VERIFIED code |
| D11 | `X-OpenNext: 1` only if `poweredByHeader` (default true) | `util.js:270-276` (always) | `util.js:266-277` | `renderer/next.config.ts:3-5` (no `poweredByHeader`) | none: still emitted; not keyed | VERIFIED code |
| D12 | `Vary`: Next's own `rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch` passes through | none — checked `core/`, `http/` (no `Vary` handling) | none on the server path — checked `core/`, `http/`; only the disabled `core/routing/cacheInterceptor.js:23` | RH:508-550 (RSC family in the cache key) | none | VERIFIED by absence |

### 3.E Cache read / write (S3 incremental cache)

| # | Change | 3.1.3 (O) | 4.x (N) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| S1 | S3 key layout unchanged: `<CACHE_BUCKET_KEY_PREFIX>/<buildId>/<key>.cache`; 4.x build id = `OPEN_NEXT_BUILD_ID = deploymentId ?? BuildId` (we set no `deploymentId`, so it equals today's `NEXT_BUILD_ID`) | `cache/incremental/s3.js:5, 15-16` | `overrides/incrementalCache/s3.js:5, 14-16`; `adapters/config/index.js:29-30` | RV:96-109 (CACHE-10 purge builds these prefixes); `backend/src/scheduled/nightly-cache-flush.ts:119-135` (deletes `_cache/`) | none: purge and nightly flush keep working | VERIFIED |
| S2 | The stored entry carries `revalidate` (`false` for our routes) | none — `adapters/cache.js:184-193` stores `APP_PAGE` without `revalidate` | `adapters/cache.js:217, 269-280` | PG:22; `renderer/src/app/[siteId]/products/[productId]/page.tsx:9` | none by itself; it is what the #1302 seeding fix reads (§ 5.6) | VERIFIED |
| S3 | Cache write timing: 3.1.3 awaits the S3 PUT inside `set()`; 4.x registers it as detached work and awaits all detached work before the Lambda returns (our wrapper has no `waitUntil`) | `adapters/cache.js:185` (`await …set`) | `adapters/cache.js:199-209`; `utils/promise.js:68-76, 103-123` | every ISR render (PG:22) | none: the PUT still finishes in the same invocation | code VERIFIED; effect INFERRED (bundle harness S3/SQS journal, § 8.1) |
| S4 | Read: an entry without `html` becomes a MISS. An absent `rsc` is **allowed** on read (`rscData` stays undefined) and no longer throws on write | `adapters/cache.js:94-111` (returns `html` unchecked); `adapters/cache.js:188` (`rscData.toString()` throws when `rscData` is undefined) | `adapters/cache.js:119-129` (MISS without `html`), `:147-149` (undefined `rsc` accepted), `:272` (`rscData?.toString`) | PG:22-26 and `renderer/src/app/[siteId]/products/[productId]/page.tsx:9-11` (the two routes that write `APP_PAGE` entries) | robustness only; no change for healthy entries | VERIFIED code |
| S5 | Read path checks tags before returning the entry; `-1` → `null` → MISS. The mechanism exists in **both**; only 4.x has rows for it to find (F1) | `adapters/cache.js:74-78` | `adapters/cache.js:85-94`; `utils/cache.js:66-87` | RV:166 | edited pages become fresh (with F1) | VERIFIED code; effect INFERRED (E2) |

### 3.F Tags (DynamoDB tag cache)

| # | Change | 3.1.3 (O) | 4.x (N) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| F1 | **Tag rows written for `APP_PAGE`** on every set whose rows are missing | `adapters/cache.js:209-213` (`PAGE` only), `:216-226` | `adapters/cache.js:437-473` | RH:128-153 (tag table + GSI); RV:166 | the tag table starts to fill (0 items today, VERIFIED `describe-table`); this is what makes F3 work | code VERIFIED; volume INFERRED |
| F2 | Which tags: implicit `_N_T_` tags from the route pattern (`/layout`, `/[siteId]/layout`, `/[siteId]/[[...slug]]/layout`, `/[siteId]/[[...slug]]/page`) plus **one** pathname tag `_N_T_/<host>/<slug>` (Next code, same in both). The adapter reads them from `x-next-cache-tags` | `adapters/cache.js:211` (read only for `PAGE`) | `adapters/cache.js:450-458`; NX `server/lib/implicit-tags.js:15-41, 63-72` | PG (pattern `[siteId]/[[...slug]]`); products page (adds `/[siteId]/products/layout`); RV:166 | `revalidatePath('/<host>/<slug>')` matches exactly one path; live prod object tags confirm the list (report 02) | VERIFIED |
| F3 | `revalidatePath(p)` writes `{path, tag, expire: now}`; the next read returns `-1` → MISS | `adapters/cache.js:238-252` (writes `{path, tag}`, no `expire` — but finds no paths, F1) | `adapters/cache.js:354-408`; `overrides/tagCache/dynamodb.js:95-145` | RV:166 | edited page fresh on the next request | code VERIFIED; effect INFERRED (E2, B-TAG) |
| F4 | `revalidateTag(tag,'max')` writes `stale: now, expire: now+1y`; original mode still returns `-1` (hard MISS), not SWR | `adapters/cache.js:238` (`revalidateTag(tags)` has no profile parameter) | `adapters/cache.js:360-377`; `overrides/tagCache/dynamodb.js:136-145` | RV:144-148 (`tag` branch); `backend/src/lib/revalidate.ts:116-146` — no backend caller sends `tag` (VERIFIED, grep of `backend/src`) | none today (no caller) | VERIFIED |
| F5 | Rows carry no TTL attribute; `expire` is epoch **ms** (DynamoDB TTL needs seconds); keys are build-id prefixed, so every deploy orphans the old rows | `cache/tag/dynamodb.js:18, 20-24` | `overrides/tagCache/dynamodb.js:15-29` | RH:128-136 (no `timeToLiveAttribute`) | none visible; unbounded but cheap growth (§ 7.1 N6) | VERIFIED code |
| F6 | GSI name `revalidate` (PK `path`, SK `revalidatedAt`) hard-coded — unchanged | `cache/tag/dynamodb.js:34, 82` | `overrides/tagCache/dynamodb.js:44, 110, 167` | RH:149-153 | none: today's GSI fix stays correct | VERIFIED |
| F7 | Tag-cache read failure: original mode logs and treats the entry as fresh (fail-to-cached) in both; `nextMode` throws → MISS (fail-to-render) | `cache/tag/dynamodb.js:98-100` | `overrides/tagCache/dynamodb.js:147-150`; `dynamodb-nextMode.js:89-91` + `adapters/cache.js:189-193` | RH:253 (grant); decision `OPENNEXT1-TAGMODE` | during a DynamoDB outage: original mode serves cached pages, nextMode renders (and then fails on the main-table reads) | VERIFIED code; effect INFERRED |

### 3.G Revalidation queue and function

| # | Change | 3.1.3 (O) | 4.x (N) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| G1 | Enqueue condition unchanged: `x-nextjs-cache: STALE` | `core/routing/util.js:281-322` | `core/routing/util.js:282-321` | RH:154-160 (FIFO queue), RH:252 (send grant) | #1250 volume unchanged unless § 5.6 fixes it | VERIFIED |
| G2 | Message body gains `eTag`, `lastModified`; the consumer reads only `host`/`url` | `core/routing/util.js:313`; `adapters/revalidate.js:10` | `core/routing/util.js:311`; `adapters/revalidate.js:12` | RH:154-160 (1 h retention, :159) | in-flight messages interoperate across deploy and rollback | VERIFIED |
| G3 | SQS send awaited inline in both (4.x hands it to `waitUntil` only when the wrapper provides one; ours does not) | `queue/sqs.js:10-11` | `overrides/queue/sqs.js:23-28`; `overrides/wrappers/aws-lambda.js:29-31` | RH:214-246 (default wrapper; `renderer/open-next.config.ts` sets no override) | none: no TTFB change | VERIFIED |
| G4 | Revalidation success accepts `200, 307, 308, 404` with `REVALIDATED` (was `200` only, #1121) | `adapters/revalidate.js:35-37` | `adapters/revalidate.js:8, 37-40` | `renderer/src/lib/not-found-handoff.ts:58` (the junk 307s); RH:444-459 (the HEAD cannot re-render today) | junk 307s would "succeed forever" instead of "fail forever" — only if the HEAD can re-render, which it cannot while `x-prerender-revalidate` is not forwarded | code VERIFIED; effect INFERRED (E6) |
| G5 | An in-flight message from the previous build carries the old `previewModeId` and no longer bypasses after a deploy | `core/routing/middleware.js:27` (any `x-isr` bypasses); `adapters/revalidate.js:25-26` | `core/routing/middleware.js:28-31`; `adapters/revalidate.js:27-28` | RH:444-459 | at most one logged failure per in-flight message | INFERRED |

### 3.H Warmer

| # | Change | 3.1.3 (O) | 4.x (N) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| H1 | Same `WARM_PARAMS` env contract in both; moved into an override | `adapters/warmer-function.js:15` | `overrides/warmer/aws-lambda.js:7` | RH:266-269 (sets `FUNCTION_NAME`/`CONCURRENCY`) | **still broken after the upgrade** (864/864 failures in 24 h today, VERIFIED) unless CDK changes | VERIFIED |
| H2 | Server wrapper short-circuits `{type:"warmer"}` — unchanged | `wrappers/aws-lambda.js:10-12` | `overrides/wrappers/aws-lambda.js:10-13` | RH:273-277 (5-minute schedule) | none | VERIFIED |

### 3.I Image optimization

| # | Change | 3.1.3 (O) | 4.x (N) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| I1 | `fetchInternalImage` call fixed for Next ≥ 16.2.5. 3.1.3 passes `handleRequest` as the 4th argument; Next 16.3.8 expects it 5th (NX `server/image-optimizer.js:1246, 1256`) | `adapters/plugins/image-optimization/image-optimization.replacement.js:13-16` | `adapters/plugins/image-optimization/image-optimization.replacement.js:42-60` | RH:684-690 (`_next/image*` behavior) | the pre-existing 500 cause is removed | code VERIFIED; live effect INFERRED (parked, not probed) |
| I2 | Unchanged loader: reads `${BUCKET_KEY_PREFIX}/${key}`; ours is `_assets` while assets are uploaded to the bucket root | `overrides/imageLoader/s3.js:4, 15` | `overrides/imageLoader/s3.js:4, 15-20` | RH:202 (`_assets`); RH:700-705 (upload to root); `renderer/next.config.ts:3-5` (no `images.remotePatterns`) | images still fail after the upgrade | layout VERIFIED; failure INFERRED |

### 3.J Build and packaging

| # | Change | 3.1.3 (O) | 4.x (N / N10) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| J2 | `@img/*` (sharp's native binaries) excluded from the server trace | `build/copyTracedFiles.js:114-121` (excludes `node_modules/sharp`, not `@img`) | `build/copyTracedFiles.js:24-36` | RH:216 (server code asset) | server bundle 53.3 MB → 25.9 MB unzipped; 3.1.3 ships 27 MB of useless **darwin-arm64** binaries into the Lambda | VERIFIED (report 03 sizes) |
| J3 | esbuild 0.19.2 → 0.28.2; `@aws-sdk/*` `^3.398.0` → pinned 3.984.0 inside the adapter; new native build dependency `@ast-grep/napi` | `node_modules/open-next/package.json:35, 43` | N10 `package.json:36, 40, 48` (identical lines in 4.1.9) | `renderer/package.json:36`; `.github/workflows/ci.yml:44-55` (lockfile platform-entry rule) | lockfile needs Linux variants (§ 6.7); clears the frozen-esbuild finding (`docs/security-remediation-status.md:378, 387`) | VERIFIED |
| J4 | Native installs (sharp) still swallow errors | `build.js:303-307` (`"Failed to install sharp."`, build continues) | `build/installDeps.js:64-67` | `renderer/package.json:12` | a failed sharp install still yields a "successful" build | VERIFIED |
| J5 | Default sharp version and option source | `build.js:287-289` (default `0.32.6`; `imageOptimization.arch`, `nodeVersion`) | `build/createImageOptimizationBundle.js:77-88` (default `0.35.4`; `imageOptimization.install` used verbatim when given) | `renderer/package.json:12` (`SHARP_VERSION=0.35.5`) | both defaults are below our 0.35.5 pin (GHSA-wq5f-xc86-pv6w); the pin must stay explicit | VERIFIED |
| J6 | npm flags: 3.1.3 passes `--arch --platform --target --libc`; 4.x passes `--os --arch --target --libc` + `additionalArgs`. npm 10 ignores `--arch`, honours `--cpu`; npm 12 rejects `--arch` (#1307) | `build.js:294` | `build/installDeps.js:17-28` | `renderer/package.json:12` (`npm_config_cpu=arm64` etc.) | config must use `--cpu=arm64` (§ 6.1) | VERIFIED (npm 10.9.4 local; report 03 experiments); npm 12 INFERRED |
| J7 | Output dir cleaning: 3.1.3 removes it after compiling the config; 4.x removes it in `initOutputDir` before `next build` (#953) | `build.js:153` | `build/helper.js:347-348` | RH:97-106 (macOS `.DS_Store` ENOTEMPTY retry loop) | the ENOTEMPTY race can surface inside open-next | INFERRED |
| J8 | Bin name still `open-next` | `node_modules/open-next/package.json:7-8` | N10 `package.json:7-8` | `renderer/package.json:12` (`npx open-next build`) | `npx open-next` without the new package installed would fetch legacy 3.1.3 | VERIFIED |

### 3.K Config

| # | Change | 3.1.3 (O) | 4.x (N) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| K1 | `default.architecture` is not a key in either version (silent no-op today) | none — checked `types/open-next.d.ts` (0 matches) | none — checked `types/open-next.d.ts` (0 matches) | `renderer/open-next.config.ts:2-4` | none; it fails `satisfies OpenNextConfig` in 4.x, so it is dropped | VERIFIED |
| K2 | Typed import `@opennextjs/aws/types/open-next.js` resolves via the package `exports` map | `node_modules/open-next/package.json:15-17` (same `"./*"` map; amodx imports no 3.1.3 types) | N10 `package.json:15-20` (`"./*" → "./dist/*"`) | `renderer/tsconfig.json:11` (`moduleResolution: bundler`); `renderer/open-next.config.ts:1-8` (untyped today) | none | VERIFIED (report 03 ran `tsc --noEmit`) |
| K3 | New default `cdnInvalidation: "dummy"`; `dangerous.*` all off | none — checked `plugins/resolve.js` (0 matches for `cdnInvalidation`) | `plugins/resolve.js:23, 35`; `core/routing/util.js:374-383` | `backend/src/lib/invalidate-cdn.ts:117, 190` (our own edge purge) | none: OpenNext never invalidates CloudFront; our fast lane stays the only edge purge | VERIFIED |

### 3.L Environment and IAM

| # | Function: change | 3.1.3 (O) | 4.x (N) | amodx surface | User-visible effect | Label |
|---|---|---|---|---|---|---|
| L1 | Server: same env names (`CACHE_BUCKET_*`, `CACHE_DYNAMO_TABLE`, `REVALIDATION_QUEUE_*`); build id now from `OPEN_NEXT_BUILD_ID` (set at runtime) | `cache/incremental/s3.js:5`; `cache/tag/dynamodb.js:6`; `queue/sqs.js:4` | `overrides/incrementalCache/s3.js:5`; `overrides/tagCache/dynamodb.js:6`; `overrides/queue/sqs.js:4`; `adapters/config/index.js:29-30` | RH:227-240 | none | VERIFIED |
| L2 | Server IAM: S3 Get/Put/Delete; SQS Send; DDB Query (table + `index/revalidate`), BatchWriteItem (+ BatchGetItem in nextMode) | `cache/incremental/s3.js:1`; `cache/tag/dynamodb.js:32, 57, 80, 120`; `queue/sqs.js:11` | `overrides/incrementalCache/s3.js:2`; `overrides/tagCache/dynamodb.js:42, 75, 108, 207`; `overrides/tagCache/dynamodb-nextMode.js:23-33`; `overrides/queue/sqs.js:12` | RH:251-253 (`grantReadWrite`, `grantSendMessages`, `grantReadWriteData`) | none: existing grants cover both modes | VERIFIED (code + grant names) |
| L3 | Revalidation function: no env; HEAD with `x-prerender-revalidate` + `x-isr` | `adapters/revalidate.js:22-27` | `adapters/revalidate.js:24-29` | RH:167-182 (batch 5, no `reportBatchItemFailures`) | none | VERIFIED |
| L4 | Image function: `BUCKET_NAME`, `BUCKET_KEY_PREFIX` | `overrides/imageLoader/s3.js:4` | `overrides/imageLoader/s3.js:4` | RH:201-205 (`_assets`, wrong — parked) | none (parked) | VERIFIED |

### 3.M Not version changes: observations and untraced risks

These were in the inventory but are not behaviour changes with code on either side, so the row
rule cannot apply to them. They stay recorded here, with their evidence and where they are used.

| Item | Why it is not an inventory row | Evidence | Used in |
|---|---|---|---|
| Output layout and `open-next.output.json` are byte-identical (former J1) | no change; the evidence is a build artefact, not code | `diff` of today's `renderer/.open-next/open-next.output.json` and the scratch 4.1.9 build's file printed nothing (report 03, VERIFIED there) | § 6.6 (no CDK path change) |
| Prod image-function invocations = 0 in 14 days (former I3) | a runtime baseline, not a version change | CloudWatch `Invocations` (report 03) | § 11 `OPENNEXT1-IMAGE` |
| `copyTracedFiles` may write outside `.open-next` in a hoisted workspace (former J9, upstream #1260 OPEN) | an untraced risk: the issue text names no line, and no amodx build has shown it | issue #1260; root `package.json:5` (npm workspaces, hoisted `node_modules/next`) | § 7.1 N21; § 9.1 step 1 (`git status` clean + `npm ls next` after the build) |
| Warmer env (former L5) | duplicate of row H1 | H1 | H1 |

---

## 4. Serving contract impact

### 4.1 The 33 rows

Framing (VERIFIED, `renderer/test/serving-contract/harness.mjs`, README): the suite runs
`next start`. It never executes OpenNext. So after the upgrade **only `(c2)` changes as the
suite stands**. The third column answers the real question: does the row hold through the real
Lambda bundle? Count (VERIFIED by listing `contract.test.mjs`): 4 `iso` + 23 named + 6 `g4` = 33.

| Row | Asserts | Through the 4.x bundle | Action |
|---|---|---|---|
| iso1 | child env constructed, not inherited | same | bundle harness needs its own equivalent |
| iso2 | Next env loader loads no `.env*` | same | " |
| iso3 | build/start process trees read no `.env*` | `open-next build` is a new process tree it does not cover | extend the journal to `open-next build` + esbuild workers |
| iso4 | hook survives an execArgv-dropping fork | same | " |
| a1 | `/published` 200, `s-maxage=31536000`, MISS | same (INFERRED-high) | bundle row; also assert the S3 key contains the host (B-ISO) |
| a2 | HIT, 0 render reads | same (INFERRED) | bundle row |
| c1 | ISR page emits no `stale-while-revalidate` | same for MISS/HIT | none |
| **c2** | installed `open-next/core/routing/util.js` carries `300`, not `2592000` | **BREAKS**: `require.resolve("open-next/…")` → MODULE_NOT_FOUND | re-point to `@opennextjs/aws/core/routing/util.js` (resolvable through the package `exports` `"./*" → "./dist/*"`, VERIFIED N10 `package.json:15-20`); body slicer still matches (`export function fixISRHeaders` … next `export function`, N util.js:325, 365) |
| a3 | no `Set-Cookie` on cacheable HTML | same | none |
| b1 | `?page=2` → twin, no-store | routing same; page-2 content INFERRED | bundle row b1 with a 2-page stub (page-2-only item must render) |
| b2 | session cookies → twin | same | none |
| b3 | non-session cookies stay cacheable | same | none |
| c | unknown host → 404 no-store, hostGate 1 | same (INFERRED) | bundle row (proves the edge-bundled middleware reads env and credentials inside the Lambda bundle) |
| d1 | missing page → cacheable 307 `?nf=1` | same | none |
| d2 | `?nf=1` → 404 no-store | same (now also forced by C/D) | none |
| d3 | stored artefact is the 307, no 404 stored | same intent; evidence path differs (S3 journal) | bundle row asserts S3 PUT journal |
| m1/m2 | `/<x>/_dyn/…` → 308 `/_site/<x>/…` | same pathname; `Location` may become relative (C4) | none (test parses pathname) |
| m3 | `/_dyn/…` → 404 no-store | same | none |
| h1 | `/wk/index.php` real tenant route → 200 | same | none |
| h2 | scanner path → cacheable 307 | same | none |
| **e1** | failed read after tenant resolution → 500, **no `Cache-Control`**, nothing stored | **DIFFERS through the bundle**: 500 carries `private, no-cache, no-store, max-age=0, must-revalidate`. The safety property (not stored) holds and is stronger | next-start row unchanged; bundle row accepts both; reword the doc sentence (§ 4.2) |
| e2 | recovery → MISS → HIT | same | none |
| f | `?preview=true` → twin | same | none |
| g1–g3 | `/api/posts`, `/api/ref` | same | none |
| g4 ×6 | write proxies reject/accept by `Origin` | same in-process; inert in prod (CloudFront deletes `Origin`) — pre-existing, documented | unchanged |

### 4.2 `docs/caching-architecture.md` assumptions

| Assumption (doc location) | After upgrade | Action |
|---|---|---|
| `X-Forwarded-Host` is the tenant key; origin resolves tenant from it (§ Architecture Overview, § Multi-Tenant Isolation) | same (A2) | none |
| RSC family keyed because origin `Vary`s; `_rsc` stripped before MW (§ H1) | same (Next-owned; NX `server/web/adapter.js:168-172`) | bundle row B-RSC |
| query allowlist; any query → twin (§ Cache Policy) | same | none |
| `defaultTtl 0` → origin `s-maxage` governs | same, **except cold STALE now has no header → not stored** | rewrite the cache-8 / SWR self-heal narrative (§ 5.6) |
| "no `Cache-Control` header at all on a thrown render" (§ Serving contract, version note) | false **through the bundle** (no-store) | reword: "never stored" is the contract; the header differs by layer |
| "both cache-7 headers must be forwarded" (§ D3) | already reversed by `6038706`; § 5.4 shows only `x-prerender-revalidate` is load-bearing for amodx | rewrite § D3 status |
| "revalidatePath flips entries to STALE" (§ D3, § cache-8 step 3) | wrong in both versions: 3.1.3 writes no rows; 4.x produces a MISS | rewrite |
| "SWR self-heal (cache-7)" and "junk 307 fails forever" (§ cache-8) | both are effects of #1250, not of revalidation | rewrite with § 5.6 |
| `open-next@3.1.3` vs Next 16 section, cache-8 source citations (3.1.3 line numbers) | stale | update citations to N10 |
| § 5 "Layer 2 only clears on nightly flush" | false after upgrade for the edited page | update |

### 4.3 New bundle-only rows

Listed with the harness in § 8.1.

---

## 5. Cache and freshness design after the upgrade

### 5.1 Tag mode

Two modes exist (VERIFIED, N `overrides/tagCache/dynamodb.js`, `dynamodb-nextMode.js`):

| | original (`dynamodb`, default) | `dynamodb-nextMode` |
|---|---|---|
| Rows written per render of a new path | 5–6 (+ GSI copies), `revalidatedAt: 1` | 0 (N `adapters/cache.js:439`) |
| Read cost | 1 GSI query per cache read (deduped per request) | 1 BatchGetItem of the entry's 5–6 tags |
| `revalidatePath(p)` | 1 row per matching path | 1 row per tag |
| A broad tag (`/[siteId]/layout` = every tenant) | 1 row per cached path (prod: tens of thousands, mostly junk) | 1 row |
| Uses the `revalidate` GSI | yes | no (`path = tag = <buildId>/_tag/<tag>`) |
| DynamoDB read failure | serve cached (fail-to-cached) | MISS + render (fail-to-render) |
| Upstream usage on Lambda | the default; what the GSI fix was for | opt-in since 3.5.0 (#717); uses `aws4fetch`, not the SDK |

Freshness behaviour for amodx is the same in both (a `revalidatePath` gives a hard MISS on the
next read). The real advantage of nextMode is cheap broad tags, which this spec does not adopt
(§ 5.3). Recommendation: **original mode**, pinned explicitly in config. Decision
`OPENNEXT1-TAGMODE`.

### 5.2 What makes an edited page fresh

Sequence after the upgrade (all files VERIFIED; behaviour INFERRED-high, settled by E2/E8):

1. Admin save → backend `revalidateTenantPaths()` (`backend/src/lib/revalidate.ts:191-262`).
2. Backend POSTs `/api/revalidate` `{domain, slug}` with a 10 s abort (revalidate.ts:84-96),
   awaited **before** the edge fast lane (revalidate.ts:226-240).
3. RV:166 `revalidatePath('/<domain><slug>')` → OpenNext writes `{path, tag:_N_T_/<domain><slug>,
   expire: now}` (F3). Route handlers flush revalidations as pending work; OpenNext awaits all
   detached promises before returning (N `utils/promise.js:103-123`), so the row exists before
   the 200 (INFERRED, E8).
4. RV:169 `revalidatePath('/<domain>', 'layout')` → tag `_N_T_/<domain>/layout` → `getByTag`
   returns `[]` → **nothing happens**. No page carries that tag: derived tags come from the route
   *pattern* (`/[siteId]/layout`), and the only concrete tag is the full pathname (NX
   `implicit-tags.js:15-41, 63-72`). VERIFIED in code, in **both** versions.
5. RV:171-194 CACHE-10 purge deletes the tenant's S3 objects (if kept, § 5.3).
6. Backend enqueues the exact paths for the CloudFront fast lane (revalidate.ts:248) and arms
   the bulk lane (revalidate.ts:261).
7. Next visitor: edge MISS → origin → S3 object gone (purge) or tag row newer than S3
   `LastModified` → MISS → blocking render from DynamoDB → new S3 object → `s-maxage=31536000`.

### 5.3 What makes listings fresh, and the fate of CACHE-10's purge

A listing (blog grid, home, nav) is its own cached URL that renders other pages' data. No tag
links it to the edited page (§ 5.2 step 4). Today two things refresh listings:

- **CACHE-10's tenant-wide S3 purge** (RV:90-129): deletes every S3 object of the tenant, both
  key layouts, every build id and owner hash. Layer 2.
- **The bulk lane**: one CloudFront `/*` within ~16 min of the first pending change (ratified
  `CACHE10-LISTING-EDGE`, `CACHE10-DEBOUNCE-MAXWAIT`, `docs/TECH-DEBT.md`). Layer 1.

`/*` alone cannot refresh a listing: the edge would refill from the unchanged S3 copy. So after
the upgrade **the S3 purge is still the only Layer-2 listing refresher**. The TECH-DEBT line
"Remove the S3 purge when opennext-1 makes `revalidatePath` effective for `APP_PAGE`" is right
for the edited page and wrong for listings.

Options are in decision `OPENNEXT1-CACHE10-PURGE`. Recommended: **keep the purge unchanged**.
The key layout it depends on is unchanged in 4.x (S1). A tenant tag (wrap tenant/content reads in
`unstable_cache(…, {tags:['tenant:<id>']})` and call `revalidateTag`) is the precise
replacement, but it changes the renderer data layer, creates FETCH entries under
`_cache/__fetch/`, and interacts with the D4 "failed reads throw" rule. That is its own slice
(deferred, § 12).

Double invalidation is harmless: tag row + deleted object both yield a MISS; `updateTagsOnSet`
does not rewrite rows that exist (N `adapters/cache.js:462-463`).

### 5.4 `x-isr` / `x-prerender-revalidate` forwarding

**How 4.x authenticates the internal request (VERIFIED).** The middleware bypass needs
`x-isr` present AND `x-prerender-revalidate` equal to `PrerenderManifest.preview.previewModeId`
(N `core/routing/middleware.js:28-31`). `previewModeId` is a random value generated by each
`next build` (32 characters in today's build, VERIFIED). Where it exists:

- the server bundle (`.next/prerender-manifest.json`, `.next/server/middleware-manifest.json`)
  and the revalidation function bundle — server-side only;
- **not** in the public assets: grep of `.open-next/assets` for the value returned 0 hits in
  today's 3.1.3 build AND in the 4.1.9 scratch build (VERIFIED);
- Next also puts it in the `__prerender_bypass` cookie when `draftMode().enable()` is called.
  amodx never calls `draftMode` (VERIFIED, grep of `renderer/src` and MW).

**Can a viewer still trigger the bypass?** Only with the secret. A viewer `x-isr: 1` without it
runs the middleware normally. The viewer value still sets the ALS flag `isISRRevalidation`
(N `core/requestHandler.js:26`), but that flag only *narrows* `isOnDemandRevalidate`
(N `build/patch/patchedAsyncStorage.js:9-11`), the fetch-cache patches (unused) and CDN
invalidation (dummy). It cannot widen anything. INFERRED-high.

**Is forwarding needed at all?** No, for two reasons:

1. **Only `x-prerender-revalidate` is load-bearing for amodx.** The revalidation HEAD goes to
   `https://<host>/<host>/<slug>` (the rewritten path is the queued URL, N util.js:294-298). The
   doubled path contains a `.`, so MW:159 returns `NextResponse.next()` with no rewrite, bypass
   or not. Next then re-renders because of `x-prerender-revalidate`.
2. **There is no legitimate STALE to re-render.** Every amodx ISR route is `revalidate = false`
   (VERIFIED: `renderer/src/app/[siteId]/[[...slug]]/page.tsx:22`,
   `[siteId]/products/[productId]/page.tsx:9`, `[siteId]/layout.tsx:19`; the four site route
   handlers are `force-dynamic` or plain handlers; no time-based ISR,
   `docs/caching-architecture.md` line 5). Freshness is explicit (§ 5.2,
   § 5.3). The only STALE source is #1250, which is false staleness. If § 5.6 removes it, the
   queue goes idle.

Recommendation: **keep both headers un-forwarded**; the infra test that pins their absence
(`infra/test/amodx-stack.test.ts:483-489`) stays. A second reason is rollback safety: if 4.x
re-forwarded `x-isr` and the release were rolled back to 3.1.3 without also reverting the ORP,
the poisoning hole would reopen (§ 9.3). Decision `OPENNEXT1-XISR`.

### 5.5 The fast lane, the bulk lane, the nightly flush

| Mechanism | After upgrade | Why |
|---|---|---|
| Fast lane (exact-path CloudFront invalidation, ~1–2 s) | keep, unchanged | 4.x `cdnInvalidation` defaults to `dummy` (K3); OpenNext never touches CloudFront |
| Ordering "S3 purge before edge enqueue" | keep | the same race exists with tag rows: an edge refill before the tag write re-pins `s-maxage=31536000` |
| Bulk lane (`/*` ≤ ~16 min) | keep | still the only tenant-wide edge refresh (CloudFront paths carry no host) |
| Nightly flush (`backend/src/scheduled/nightly-cache-flush.ts`) | keep as backstop; add orphan cleanup (decision `OPENNEXT1-ORPHANS`) | it runs only when `CDN_LAST_CHANGE > CDN_LAST_NIGHTLY_FLUSH` (lines 64-75). Prod has had no edit since 2026-09-16, so it has skipped every night since 09-17 (VERIFIED by report 03 from the flush log lines of 2026-10-11/12/13). |

**Orphan state today (VERIFIED, read-only `aws s3 ls` 2026-10-13):** 7 build-id prefixes under
`_cache/`; the current build is `t8bhm_x9jMj3wJqw4-v8k` (90 objects, read from the public
`BUILD_ID` object at the bucket root); one orphan prefix `7OXuKVtLyIL4CEsxuxIQA` holds 41,631
objects / 792 MB, mostly scanner junk. Junk keys such as
`_cache/<build>/route-cache/APP_PAGE/<owner>/$/.aws/credentials.cache` belong to **no tenant**
(a dotted first segment skips the tenant rewrite, MW:159), so CACHE-10's tenant purge never
deletes them; only the change-gated nightly flush does. Their storage costs about $0.02/month
(≈ 0.8 GB at S3 Standard list price, INFERRED). The
operational cost is that CACHE-10 lists every build-id prefix on each edit.

### 5.6 Issue #1250 (cold-container STALE)

**Mechanism (VERIFIED, NX 16.3.8).** `IncrementalCache.get` asks `SharedCacheControls.get(key,
route)` (NX `server/lib/incremental-cache/index.js:439`). That map is filled only by `set()` in
the container that rendered the page; the prerender manifest has no entry for a runtime path of
a `generateStaticParams() => []` route (NX `shared-cache-controls.external.js:38-64`, "A new
runtime pathname has no initial lifetime"). Result `undefined` → `calculateRevalidate` falls
back to **1 second** (`index.js:157-159`) → every entry older than 1 s is STALE in every
container that did not render it.

**Today (3.1.3):** STALE → `s-maxage=2, stale-while-revalidate=300` (VERIFIED code + live
observation) → CloudFront stores 2 s, serves stale up to 300 s while it refetches; refetches land
on random containers until one answers HIT, which pins `s-maxage=31536000` (INFERRED from
CloudFront SWR semantics; report 02 observed the STALE → HIT flip live). Every STALE also enqueues SQS. The HEADs can no
longer re-render (no `x-prerender-revalidate` since `6038706`), so they are pure cost.

**After 4.x without a fix:** cold STALE has **no** `Cache-Control` → CloudFront stores nothing
→ every edge MISS that lands on a "wrong" container goes to origin again and enqueues again
(INFERRED-high). Origin traffic and SQS volume are likely to **rise**, not fall. This is the
biggest negative second-order effect of the upgrade (§ 7.1 N2).

**Fix available:** upstream PR #1302 (OPEN, updated 2026-10-09, VERIFIED `gh`) seeds the map
from the stored `revalidate` on read. Its read-side hunk is about 15–20 lines in `adapters/cache.js`
(`seedCacheControl(key, cacheData.revalidate, cacheData.expire)` before `getTagsFromValue`).
4.x already stores `revalidate` (S2), so the read side alone is enough for amodx. With
`revalidate: false` seeded, Next computes `revalidateAfter = false` (never stale) and emits
`s-maxage=31536000` (NX app-page-runtime.js:1096-1116). The PR author did not run it on Lambda.

Consequence of fixing it: #1250 is today the only *accidental* refresher of a listing whose
CACHE-10 purge failed. After the fix, such a listing stays stale until the next successful purge
of that tenant (its next edit) or the nightly flush; the bulk `/*` alone refills the edge from
the same stale S3 copy. CACHE-10 already returns 500 on any S3 failure and the backend
logs it.

Decision `OPENNEXT1-1250`. Measurement plan in § 8.4.

### 5.7 The swr=300 patch

Sites of `2592000` in N10 `core/routing/util.js` (identical to N): `:260` `fixSWRCacheHeader`
(bare SWR only; Next never emits one for `revalidate=false`), `:346` HIT recompute (fires only
when `s-maxage !== 31536000`), `:355` STALE branch (reached only when `s-maxage` is present,
`:330-332`). For amodx on 4.x, `:346` and `:355` are **unreachable** today: HIT is always
31536000, cold STALE has no `s-maxage`, and a tag-revalidated entry is a MISS (INFERRED-high
from the code paths in § 3.D/F). They become reachable if a route ever gets a numeric
`revalidate` or a `revalidateTag` profile with a stale window.

Decision `OPENNEXT1-SWR-PATCH`. Recommended: keep the re-cut (§ 6.4). It costs nothing extra
when the patch file exists anyway for the #1250 hunk, and it keeps the guard rows meaningful.

---

## 6. Build, infra and config changes

### 6.1 `renderer/open-next.config.ts` (exact)

```ts
import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

// Every override below is today's resolved default, written out because the serving contract
// depends on each one (buffered Lambda, Function-URL payload, S3 ISR, original-mode tag cache,
// SQS). An upstream default change must show up as a reviewed diff, not silently.
const config = {
    default: {
        override: {
            wrapper: "aws-lambda",
            converter: "aws-apigw-v2",
            incrementalCache: "s3",
            tagCache: "dynamodb",       // OPENNEXT1-TAGMODE
            queue: "sqs",
        },
    },
    imageOptimization: {
        install: {
            packages: ["sharp@0.35.5"], // 4.x default is 0.35.4 (< GHSA-wq5f-xc86-pv6w fix)
            os: "linux",
            libc: "glibc",
            additionalArgs: "--cpu=arm64", // npm honours --cpu; --arch is ignored by npm 10, rejected by npm 12 (#1307)
        },
    },
    buildCommand: "npm run build",
} satisfies OpenNextConfig;

export default config;
```

Deviation from report 03's VERIFIED build B: `arch: "arm64"` is **omitted** (it emits
`--arch=arm64`, N `build/installDeps.js:17-19`, which npm 12 rejects and npm 10 ignores). The
install block is used verbatim (J5), so no default `arch` or `nodeVersion` is added. This is
INFERRED to produce the same artefact; the artefact assertion in § 6.3 settles it.
The no-op `default.architecture` is dropped (K1). `dangerous`, `middleware`, `functions`,
`edgeExternals` stay unset. **Never** set `dangerous.disableTagCache` — it disables the tag
revalidation this upgrade exists for.

### 6.2 `renderer/package.json`

- devDependency `"open-next": "^3.1.3"` (line 36) → `"@opennextjs/aws": "4.1.10"` (exact).
- `build:open` (line 12) → `"open-next build"`. Rationale (local detail, decided): npm scripts
  resolve `node_modules/.bin` first, and without `npx` a missing package fails loudly instead of
  downloading legacy `open-next@3.1.3` (J8). The `SHARP_VERSION` and `npm_config_*` env prefix
  is dropped; the config `install` block replaces it (report 03 build B produced
  `@img/sharp-linux-arm64` + `sharp@0.35.5` with all four env vars unset — VERIFIED by report 03;
  that build also passed `arch`, see § 6.1).
- Ripple: `.claude/settings.local.json:24` allowlists `Bash(npx open-next:*)`; update if the
  operator invokes the CLI by hand.

### 6.3 sharp policy

- **Pin:** `sharp@0.35.5` in the config (above). **Arch:** linux / glibc / `--cpu=arm64`,
  independent of the build host (a CI x64 runner would otherwise package linux-x64, report 03).
- **Install-failure detection (new, mandatory):** 4.x swallows install errors (J4). After the
  build, assert `.open-next/image-optimization-function/node_modules/@img/sharp-linux-arm64/`
  exists and `.../node_modules/sharp/package.json` has `"version": "0.35.5"`. Also assert
  `openNextVersion` in `server-functions/default/renderer/index.mjs` equals the pinned
  `@opennextjs/aws` version (catches a stale `.open-next`).
  **Where (naming rule):** these checks are not about the patch, so they do not go into
  `scripts/verify-opennext-patch.mjs` under its current name. They are bundle-harness rows
  B-SHARP and B-VERSION (§ 8.1; the harness is mandatory), so no script is renamed.
- Note (OBSERVED in the 4.1.9 scratch build): the image function also receives
  `@img/sharp-wasm32` and `@img/sharp-libvips-linux-arm64`. Harmless; recorded so nobody "fixes" it.

### 6.4 Patch re-cut: `patches/@opennextjs+aws+4.1.10.patch`

- Delete `patches/open-next+3.1.3.patch`.
- Generate with `npx patch-package @opennextjs/aws` after editing
  `node_modules/@opennextjs/aws/dist/core/routing/util.js` (and, if `OPENNEXT1-1250` = seed,
  `dist/adapters/cache.js`). patch-package names scoped packages `@scope+name+version.patch`.
- **Hunk 1–2 (swr=300)**, generated against the pristine 4.1.9 tarball and VERIFIED by report 03
  to make `scripts/verify-opennext-patch.mjs` pass unchanged (`util.js` is byte-identical in
  4.1.10, so the hunks apply as-is):

```diff
--- a/node_modules/@opennextjs/aws/dist/core/routing/util.js
+++ b/node_modules/@opennextjs/aws/dist/core/routing/util.js
@@ -343,7 +343,7 @@
             const age = Math.round((Date.now() - _lastModified) / 1000);
             const remainingTtl = Math.max(sMaxAge - age, 1);
             headers[CACHE_CONTROL_HEADER] =
-                `s-maxage=${remainingTtl}, stale-while-revalidate=2592000`;
+                `s-maxage=${remainingTtl}, stale-while-revalidate=300`;
         }
     }
     if (headers[NEXTJS_CACHE_HEADER] !== "STALE")
@@ -352,7 +352,7 @@
     // In order for CloudFront SWR to work, we set the stale-while-revalidate value to 2 seconds
     // This will cause CloudFront to cache the stale data for a short period of time while we revalidate in the background
     // Once the revalidation is complete, CloudFront will serve the fresh data
-    headers[CACHE_CONTROL_HEADER] = "s-maxage=2, stale-while-revalidate=2592000";
+    headers[CACHE_CONTROL_HEADER] = "s-maxage=2, stale-while-revalidate=300";
 }
```

- **Hunk 3 (only if `OPENNEXT1-1250` = seed)**: in `dist/adapters/cache.js`, inside
  `getIncrementalCache` immediately after `const cacheData = cachedEntry.value;` (N
  `adapters/cache.js:83`), insert the read-side of PR #1302:

```js
            // opennext-1: backport of opennextjs-aws PR #1302 (read side only), fixes #1250.
            // Seeds Next's per-process cache-control map from the stored `revalidate`, so a cold
            // container does not treat a `revalidate = false` page as 1 s old. Remove when the
            // pinned release contains #1302.
            if (cacheData.revalidate !== undefined) {
                try {
                    const cc = require("next/dist/server/lib/incremental-cache/shared-cache-controls.external.js")
                        .SharedCacheControls.cacheControls;
                    if (!cc.has(key)) cc.set(key, { revalidate: cacheData.revalidate, expire: undefined });
                } catch (e) { debug("opennext-1: failed to seed cache control", key, e); }
            }
```

  The dist source is ESM, but OpenNext bundles the cache adapter into `cache.cjs` (CommonJS,
  report 03 § 5), so `require` resolves in the shipped form; `debug` is already imported
  (N `adapters/cache.js:6`). The implementation slice cuts the exact text and proves the bundled
  outcome (harness B-STALE, staging E1/E17) instead of assuming it. The PR guards on
  `useRouteCacheKeys(nextVersion)`; amodx is on 16.3.8, so the guard is constant-true, and the
  hunk comment must say so.
- **Patch application must be loud.** patch-package exits 0 locally on a failed patch and 1 on
  CI (VERIFIED, `node_modules/patch-package/dist/index.js:89-94`). CI uses `npm ci`, which runs
  `postinstall`, so CI fails loudly. Locally, LAYER 1 `(c2)` and LAYER 2 catch it.

### 6.5 Guard script and contract row `(c2)`

- `renderer/test/serving-contract/contract.test.mjs:368-388`: `require.resolve("open-next/core/routing/util.js")`
  → `require.resolve("@opennextjs/aws/core/routing/util.js")`; comment lines 319-366 re-point the
  patch file name and the util.js line numbers (`:346`, `:355`). The row name stays true (it
  still asserts the patched window), so it keeps its name.
- `scripts/verify-opennext-patch.mjs`: logic unchanged (VERIFIED by report 03 against 4.1.9);
  update comments/messages naming `open-next+3.1.3.patch` and 3.1.3 line numbers. If
  `OPENNEXT1-1250` = seed, also assert the seeding marker string (`opennext-1: backport of
  opennextjs-aws PR #1302`) is in the server bundle — that is a patch property, so it belongs
  here. The sharp/version artefact checks go where § 6.3 says, not here.
- Harness row B-STALE (§ 8.1, mandatory) executes the emission; the grep stays as a secondary
  check.

### 6.6 CDK changes (`infra/lib/renderer-hosting.ts`)

| Change | Line | In which slice | CFN delta |
|---|---|---|---|
| none required for the adapter swap itself | — | `opennext-1b` | **0** |
| comment citations of `open-next 3.1.3 dist/cache/tag/dynamodb.js` and `middleware.js:27` → N10 paths | 141-148, 444-459 | `opennext-1b` | 0 |
| warmer env `FUNCTION_NAME`/`CONCURRENCY` → `WARM_PARAMS: cdk.Stack.of(this).toJsonString([{ function: this.serverFunction.functionName, concurrency: 1 }])` | 266-269 | `opennext-1c` (if `OPENNEXT1-WARMER` = fix) | 0 (property) |
| delete warmer Lambda + rule (if `OPENNEXT1-WARMER` = remove) | 256-281 | `opennext-1c` | about −4 to −5 (function, role, policy, rule, permission) |
| image `BUCKET_KEY_PREFIX` | 202 | not in this track (image stays parked) | 0 |
| S3 lifecycle on `_cache/` (if `OPENNEXT1-ORPHANS` = lifecycle) | bucket at 118-122 | `opennext-1d` | 0 (bucket property) |
| ORP `x-isr`/`x-prerender-revalidate` | 444-459 | not changed (recommended `OPENNEXT1-XISR`) | 0 |

Current headroom: `AmodxStack` 446/500 resources, staging 446 (VERIFIED by report 03,
`list-stack-resources`). The optional `dynamodb-provider` custom resource (+5–9) is not needed:
the 4.x seed file has 8 rows, all for `_global-error`/`_not-found` (report 03).

### 6.7 CI

- `.github/workflows/ci.yml` runs on `ubuntu-latest` x64. The `infra-synth` job builds the
  renderer through the CDK constructor (RH:107-115), so it runs `open-next build` on x64.
- **Lockfile:** after `npm install -D @opennextjs/aws@4.1.10 -w renderer` on macOS, add/verify
  the Linux entries for `@ast-grep/napi-linux-x64-gnu` and `@esbuild/linux-x64@0.28.2` (npm/cli
  #4828; the CI comment at ci.yml:44-54 names the same failure class). Verify `next` is still a
  single 16.3.8 and React's layout is unchanged (`npm ls next react react-dom`).
- **x64 runner vs arm64 artefacts:** with `--cpu=arm64` in the config, CI packages linux-arm64
  sharp too. The synth assertions do not inspect binaries; no YAML change is required.
- `security-audit.yml` installs with `--ignore-scripts` (no patch) and only audits. The 4.x tree
  adds 3 high findings via `@node-minify/core → glob@10.3.3`, build-time only;
  `scripts/audit-gate.mjs` uses `--omit=dev` (report 03, INFERRED for the workspace devDep).
  The implementation slice must run `npm audit` and explain every high (repo Definition of Done).

---

## 7. Second-order effects catalogue

Each entry: what happens (plain language), likelihood, blast radius, detection signal,
mitigation. Likelihood: H/M/L. Blast radius: one page / one tenant / all tenants / platform.

### 7.1 Negative or risky

| # | Effect | Likelihood | Blast radius | Detection | Mitigation |
|---|---|---|---|---|---|
| **N1** | **Cache key or tag loses the host (upstream #1242 class).** If 4.x + Next 16.3.8 built the cache key from the visible URL, tenant A's `/about` could be served for tenant B — a tenant-isolation breach — or rewritten pages could never be cached. Code says the key and the tag come from route params matched on `invokePath`, so the host stays (B4). | L (code traced) | **all tenants** | bundle row B-ISO; staging E12 (two tenants, same slug, distinct bodies; S3 keys contain host; `x-next-cache-tags` contains `_N_T_/<host>/<slug>`); prod E12-PROD (root path only, § 8.6) | **No-go gate** for every deploy of this track |
| **N2** | **#1250 gets worse at the edge.** Cold-container STALE responses lose their `Cache-Control`, so CloudFront stops storing them. More requests reach Lambda; SQS volume stays or rises. | H if not fixed | all tenants (cost, latency) | `x-cache: Miss` ratio; server invocations/day; SQS `NumberOfMessagesSent` | decision `OPENNEXT1-1250` (seed backport) |
| N3 | **The 30-day stale window returns** if the patch is lost. | L (guards) | all tenants | `(c2)` red in CI; LAYER 2 red at deploy; harness B-STALE | § 6.4/6.5 |
| N4 | **A missing or failed sharp install ships silently.** | M (npm 12 future) | images only (parked) | § 6.3 artefact assertion | assertion |
| N5 | **DynamoDB writes start.** ~5–6 rows (~10 WRU incl. GSI) per new path per build; typical 2k–20k WRU/day, spike days ~235k WRU. | H (by design) | cost: +$0.05 to +$0.46/month typical, +$0.18 per spike day (§ 7.3) | tag table `ConsumedWriteCapacityUnits`, item count | none needed; a healthy upgrade shows growth (0 items today is the failure signature) |
| N6 | **Tag table grows without bound** (no TTL; rows orphaned per deploy). ~200k rows per build life (~30–40 MB) at today's junk rate. | H | storage: +≈ $0.01/month per build life (≈ 40 MB at $0.25/GB-month, INFERRED price) | item count | follow-up: prune old build ids, or nextMode (§ 12) |
| N7 | **MISS renders get slower by DynamoDB round trips** (GSI query + BatchWrite awaited before return). | H | per MISS, tens of ms | Lambda Duration p50/p99 on MISS | accept; HITs unaffected except one GSI query (~0.5 RRU, deduped per request) |
| N8 | **A failed CACHE-10 purge stays stale longer** once #1250 is fixed (no accidental refresh). | L | one tenant | backend `[Revalidate] Path failed` logs; RV 500 | already loud; nightly backstop |
| N9 | **Junk-URL revalidation flood stays** unless #1250 is fixed. If the cache-7 headers were re-forwarded, junk HEADs would *succeed* (#1121) and become real re-renders. | H / M | cost | SQS sent; renderer invocations | `OPENNEXT1-1250` + `OPENNEXT1-XISR` (keep removed) |
| N10 | **Cold cutover.** New build id: every S3 lookup misses; the deploy's BucketDeployment also invalidates CloudFront `/*` (CDK default `distributionPaths` = all files, `node_modules/aws-cdk-lib/aws-s3-deployment/lib/bucket-deployment.d.ts:93`; INFERRED-high that it runs every deploy because the asset hash changes). About **111 real routes** (prod `ROUTE#` count: amodx 20, bijup-root 54, blog-bijup-com 37, 0 products; report 02 DynamoDB COUNT) re-render on first request. | H | all tenants, first visit only | Lambda invocations spike after deploy | same as every deploy today; trivial load |
| N11 | **Header changes the edge stores.** 500/404 now carry no-store (positive). `x-middleware-rewrite`/`x-middleware-next` disappear from stored responses. `Location` may become relative. None of these headers is in the cache key. | H | none functional | header diff (E22) | none |
| N12 | **Set-Cookie on cacheable HTML.** 4.x appends middleware cookies to Next's (N `http/openNextResponse.js:147-151`). MW sets a cookie only on `/_site/` rewrites (to the no-store twin). | L | one tenant | row a3 through the bundle | bundle row a3 |
| N13 | **Preview `_site`, test `/tenant`.** `req.url` becomes the visible path (B4/B5). Previews and test mode render on the twin from route params; `_dyn` canonical links should stop leaking. | L (negative) | previews | E19 | none |
| N14 | **Route handlers (`sitemap.xml`, `robots.txt`, `llms.txt`, `openai-feed`)** are `SITE_ROUTE_HANDLERS` rewritten to `/<host>/<file>` (MW:118, 154, 266-268 via `isSiteRouteHandler`). Their own `Cache-Control` passes through; a thrown handler 500 is now forced no-store. | L | per tenant | bundle rows for each handler | add rows |
| N15 | **next-auth.** Session cookies are set by `/api/auth/*` (route handler), chunked into several `Set-Cookie`. Both converters move `set-cookie` into `cookies[]`. Cookie decoding fixes (#889) land. | L | sign-in | E18 (sign in, session survives, chunked cookie) | probe |
| N16 | **404 / `?nf=1` handoff.** Unchanged shape; Next-rendered 404 now forced no-store (double safety). Issue #1232 (`ENOENT … _not-found.segments` log noise when `_not-found` prerender goes stale) exists in both versions. | L | logs | log line | accept |
| N17 | **Mixed-case hosts.** 4.x `isExternal` is strict URL-host equality (N `core/routing/util.js:16-33` vs O substring `:12-20`). A non-lowercase `x-forwarded-host` would make the rewrite look external and proxy the request back out through CloudFront. Prod hosts are unreachable (`isWiredTenantHost` is case-sensitive and 404s first); reachable only on `/tenant/` and the host gate's fail-open path. | L | one request | E20 | probe; lowercase XFH in the CloudFront Function if it ever fires |
| N18 | **#1255** (OPEN): `If-None-Match` → 200 with empty body on non-streaming wrappers. Pre-existing, unchanged. With cold STALE no longer stored, fewer conditional refetches happen. | L | one page, blank | E15 | probe before/after |
| N19 | **Monitoring baselines shift.** `RevalidationQueueDepthAlarm` (>100 visible, RH:710) and `RevalidationLambdaErrorsAlarm` (RH:737) keep their meaning; "Failed to revalidate" lines drop to near 0 if #1250 is fixed. Silence must be read with the SQS-sent metric, not as health by itself. `ServerLambdaErrorsAlarm` (RH:723): #816/#938 change which failures become 500s. | H | operator view | dashboards | re-baseline after 7 days |
| N20 | **Docs and runbooks become wrong** (§ 7.5). | certain | contributors and agents | grep | ripple list in the implementation slice |
| N21 | **Workspace write-outside hazard** (#1260): the build could touch root `node_modules/next`. | L | build reproducibility | `git status` clean + `npm ls next` after build | check in the implementation slice |
| N22 | **Upstream regression in a fresh patch release** (4.1.6 → #1266 "time-based ISR never regenerates", fixed in 4.1.8). 4.1.10 is hours old. | M | all tenants | harness + staging probes | exact pin; harness; staging soak |

### 7.2 Positive

| # | Effect | Evidence |
|---|---|---|
| P1 | Edited pages go live through `revalidatePath` (tag rows for `APP_PAGE`) | F1, F3 |
| P2 | Middleware bypass needs a secret; encoded-path bypass closed; CVE-2025-29927-class bypass (#810) fixed | C1, C2, changelog 3.5.4 |
| P3 | Error responses never cacheable from the server path | 3.D |
| P4 | Internal rewrite targets no longer leak in response headers | C3 |
| P5 | Routing exceptions no longer render the unrewritten path (a cacheable-307 shape) | B2 |
| P6 | Server bundle 3× smaller (17.1 MB → 5.6 MB zipped); prod `CodeSize` today 19,992,604 B (VERIFIED `list-functions`). Init time drop INFERRED 0–100 ms (avg Init 753 ms, max 1,155 ms over 500 cold starts/24 h, report 03) | J2 |
| P7 | Upstream support: Next security floors within hours to ~1 day | § 2.3 |
| P8 | `cache-4b` (tag revalidation) becomes technically possible again (it was blocked on 3.1.3) | F1 |
| P9 | Frozen esbuild finding cleared | J3 |

### 7.3 Cost: baseline and deltas

**Cost rule (applies to every cost statement in this document).** A cost statement is a *delta*
with a sign, its components and their basis. A component that has not been measured is shown as
**unbounded** and no net total is stated across it. Usage numbers are VERIFIED (CloudWatch,
report 03 14-day window ending 2026-10-13); prices are eu-central-1 on-demand list prices and are
INFERRED (not read from a bill).

**Baseline today, per month (only the components the upgrade can move):** server Lambda ≈ $0.91
($0.80 compute + $0.11 requests), revalidation Lambda ≈ $0.13, SQS FIFO ≈ $0.20, CloudWatch logs
≈ $1.10, tag table ≈ $0. Sum ≈ **$2.34/month**. Excluded: CloudFront, S3 storage/requests, the
main DynamoDB table, every other stack.

| Component | Delta with the #1250 seed (`OPENNEXT1-1250` = A) | Delta without it (= B) | Basis |
|---|---|---|---|
| Tag-table writes | +$0.05 to +$0.46/month typical (2k–20k WRU/day); +$0.18 per scanner-spike day (≈235k WRU) | same | F1 rows × new paths/day (report 03, from S3 object dates); $0.76/M WRU |
| Tag-table reads | +$0.02 to +$0.05/month (5k–10k RRU/day) | same | one GSI query per cache read |
| SQS FIFO | −$0.20 (to ≈ 0) | **unbounded increase** (cold STALE no longer edge-stored, § 5.6) | 52,059 messages/7 days today |
| Revalidation Lambda | −$0.13 (to ≈ 0) | **unbounded increase** | 4,180 invocations/day today |
| Server Lambda | −$0.04 (requests) to −$0.29 (if HEADs cost as much compute as page requests) | **unbounded increase** | ≈ 32% of invocations are revalidation HEADs (report 02) |
| CloudWatch logs | −$0.05 (revalidation log) to −$0.38 (if server log volume falls with the HEAD share) | **unbounded increase** | 2.7 MB/day revalidation, 54.5 MB/day server |
| Warmer fix (`OPENNEXT1-WARMER` = A) | ≈ $0 (+288 cheap invocations/day, −864 failing ones, −0.7 MB/day logs) | same | report 03 |
| **Net** | **between about −$0.93 and +$0.10/month**, plus +$0.18 per spike day | **not stated: unbounded until E1/E7 measure the rise** | sum of the rows |

Reading: with the seed fix, cost moves by under a dollar a month in either direction. Without it,
the direction is probably up and the size is unknown. Cost is not the reason for this upgrade;
freshness and the security barrier are.

### 7.4 Pre-existing finding surfaced by this research (not caused by the upgrade)

**Cross-tenant content reflection through a dotted first path segment.** MW:159 passes any path
containing a `.` through without the tenant rewrite. A request to
`https://<tenantA>/<tenantB-domain>/<slug>` therefore renders `[siteId] = <tenantB-domain>`,
i.e. tenant B's public page under tenant A's host (and under the distribution's
`*.cloudfront.net` name). The S3 entry is B's own (read-only reuse); the CloudFront key differs
(XFH = A), so B's own URL is not poisoned. Basis: code read + the cache-8 serving-harness
evidence that `GET /<host>/<published-slug>` returns `200 HIT` on the same ISR key
(`docs/caching-architecture.md` § Root-cause Q3 item 4). Cross-host reach is INFERRED; probe
E13. The upgrade does not change it. It matters here because **the revalidation HEAD depends
on this same pass-through** (§ 5.4): closing it later would break background revalidation
unless the `x-isr` bypass is restored. Disposition: decision `OPENNEXT1-REFLECTION`.

### 7.5 Docs and runbooks that become wrong (to update in the implementation slice)

Basis: grep `open-next|3\.1\.3|fixISRHeaders|cacheInterceptor|util\.js` (report 04, 247 hits),
re-checked for the files below.

- `renderer/package.json:12, 36`; `renderer/open-next.config.ts`; `patches/open-next+3.1.3.patch`.
- `scripts/verify-opennext-patch.mjs` (comments/messages lines 7–138).
- `renderer/test/serving-contract/contract.test.mjs:319-388`; `renderer/test/serving-contract/README.md`.
- `renderer/middleware.ts:75-111` (cache-8 note: `open-next/dist/core/routing/util.js:281-282`,
  `revalidate.js:35-37`, patch name).
- `renderer/src/app/api/revalidate/route.ts:8-46` (header comment: "Under open-next@3.1.3 …").
- `infra/lib/renderer-hosting.ts:141-148, 444-459`; `infra/test/amodx-stack.test.ts:29-33, 483-489`.
- `infra/ARCHITECTURE.md:151`; `renderer/ARCHITECTURE.md:247, 434`; `renderer/README.md:76`.
- `docs/runbooks/deploy-track-cache.md:22-35` (gate names the 3.1.3 patch) and probes 7, 7b
  (7b names the pre-16.3.8 key shape `_cache/<buildId>/$H/<path>.cache`), 11/11b (image, parked).
- `docs/caching-architecture.md`: § Serving contract version note, § D3, § `open-next@3.1.3` vs
  Next 16, § cache-8 (whole), § 5 revalidatePath, § Known Gaps.
- `docs/TECH-DEBT.md`: `opennext-1 PARKED` (lines 929-948), cache-8 ledger (1064-1121), the
  2026-10-13 entries (1219-1255), the sharp/`SHARP_VERSION` note (22-31).
- `docs/slices/cache-4b-tag-revalidation.md:4-9` (block reason disappears; status stays WITHDRAWN
  unless re-opened), `docs/slices/cache-8-revalidation-flood.md`.
- `docs/security-remediation-status.md:378, 387`; `CURRENT_SLICE.md:10, 24`; `docs/ROADMAP.md:188`
  (dep-1 names `open-next`/`esbuild`) and `:236` (PERF row: "see opennext-1 note"). ROADMAP has no
  `opennext-1` row of its own (VERIFIED, grep); the implementation slice adds one.
- `.claude/settings.local.json:24`.
- Historical slice docs under `docs/shipped/slices/` are records: append, do not edit.

---

## 8. Verification plan

### 8.1 (a) Built-bundle harness — `renderer/test/serving-bundle/`

Refines the design of report 01 § 7; the design is restated here in full, so this section does
not depend on that file. Purpose: run the serving contract against the
**real Lambda artefact**, so the upgrade becomes a reviewed list of row changes instead of a
deploy-and-probe exercise. One switch `SERVING_TARGET=next|bundle` drives the existing
`harness.mjs` helpers against either target.

**Abstraction one-liner:** *bundle target for the serving suite* — users: the 33 existing rows
plus the B-rows; axis of variation: the serving adapter (`next start` vs the OpenNext Lambda
bundle, a demonstrated volatile mechanism — it changed behaviour in every area of § 3); dispatch:
two concrete targets behind the same request helpers; simpler alternative rejected: grep of the
bundle (LAYER 2) — it proves a string exists, not that a state emits it, and it cannot see N1.

Build and host:

1. `rm -rf renderer/.open-next && npm run build:open` under the same `NODE_OPTIONS=--require
   no-dotenv.cjs` journal (extends iso3 to the `open-next build` tree).
2. Assert `openNextVersion` in the bundle equals the pinned version (B-VERSION).
3. `lambda-host.mjs` (cwd `.open-next/server-functions/default`) imports `./index.mjs`, keeps
   one child per suite (module state = a warm container), `restart()` for cold-container rows.
   Each HTTP request becomes a Function URL payload v2.0 event:
   `{ version: "2.0", routeKey: "$default", rawPath, rawQueryString` (both exactly as received,
   still encoded)`, cookies: <Cookie header split on "; ">, headers: <lowercased; multi-values
   comma-joined; host = "abc.lambda-url.eu-central-1.on.aws">, requestContext: { http: { method,
   path: rawPath, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent }, domainName: <same
   fake host>, requestId, timeEpoch }, isBase64Encoded: <true when a body exists>, body: <body
   as base64> }`. The handler's result maps back to HTTP: `statusCode`, `headers`, each
   `cookies[i]` as its own `Set-Cookie`, and the body base64-decoded when `isBase64Encoded`.
4. In-process stubs with journals: DynamoDB (existing `ddb-stub.mjs` + tag-table shapes; unknown
   shapes stay loud), S3 (GET/PUT/HEAD/DELETE/List; `*.localhost` DNS shim for virtual-host
   addressing on Linux CI), SQS (`AmazonSQS.SendMessage`).
5. Headers sent = what the CloudFront Function sets (`x-forwarded-host`, `x-origin-verify`,
   `x-has-session`) plus only the ORP allowlist (RH:410-459). Phase 1 hard-codes that list and
   an infra test cross-checks it against the synthesized ORP; full CloudFront emulation (edge
   cache model, CF function extracted from the synth template) is **phase 2**, only if a row
   needs it.
6. Constructed environment (iso1 rules): fake AWS keys, `TABLE_NAME`, `CACHE_*`,
   `REVALIDATION_QUEUE_*`, `ORIGIN_VERIFY_SECRET` (exercised, not blank), `REVALIDATION_SECRET`.

Rows (each with a version-explicit expectation, so the same file characterizes 3.1.3 first):

| Row | Assertion | 3.1.3 expectation | 4.1.10 expectation |
|---|---|---|---|
| all 23 named rows | as § 4.1 | as today | as § 4.1 (e1: header ∈ {absent, no-store} AND no S3 PUT; d3: S3 journal has the 307, no 404) |
| **B-ISO** | tenants `a.test` and `b.test` both publish `/about` with different text → two S3 keys, each containing its host; each host gets its own body; `x-next-cache-tags` contains `_N_T_/a.test/about` | pass | **pass (no-go if not)** |
| **B-TAG** | **purge neutralized:** the S3 stub answers `ListObjectsV2` with no keys for this row (the adapter never lists; only the CACHE-10 purge does), so any freshness must come from the tag path. GET `/about` (MISS, tag rows journaled) → change the DDB stub content → POST `/api/revalidate {domain, slug}` → DDB journal has `{tag:_N_T_/a.test/about, expire}` → GET returns the new text with `x-nextjs-cache: MISS` | **fails** (no rows; characterizes today's defect) | pass |
| **B-LISTING** | edit post P → POST `/api/revalidate` → GET listing `/`. Variant 1, purge active: the listing shows P's new title. Variant 2, purge neutralized (as B-TAG): the listing still shows the old title — the executable form of "`revalidatePath('/<host>','layout')` is a no-op" (E3) | v1 pass, v2 old title | v1 pass, v2 old title |
| **B-STALE** | `restart()` (cold container) → GET a page rendered before restart | `STALE`, `s-maxage=2, stale-while-revalidate=300`, 1 SQS message | without seed: `STALE`, **no Cache-Control**, 1 SQS message; with seed: `HIT`, `s-maxage=31536000`, 0 SQS |
| **B-NO30D** | across every row, no response carries `2592000` | pass | pass |
| **B-XISR** | viewer `x-isr: 1` (+ junk `x-prerender-revalidate`) on `/published` (cold) and on `/_site/x/` from a prod host → identical to no header (`/_site` → 403) | **fails on 3.1.3** (characterizes the hole; prod is protected only by the ORP) | pass |
| **B-LEAK** | no `x-middleware-rewrite`/`x-middleware-next` in responses | fails (characterizes) | pass |
| **B-RSC** | `RSC: 1` → `text/x-component`, `Vary` has `rsc`; `?_rsc=x` without header → html HIT | pass | pass |
| **B-PREVIEW** | `/_site/<id>/p` from a `*.cloudfront.net` XFH → 200 no-store + `Set-Cookie amodx_preview_base`; record the flight canonical URL | record | record (expect no `_dyn`) |
| **B-WARM** | `{type:"warmer"}` returns `{type:"warmer"}`, no DDB call | pass | pass |
| **B-ROUTEERR** | make the middleware throw by a test-only means that changes no product code (slice 1a chooses it; `lib/tenant-directory.ts` catches its own lookup errors and fails open, so a failing DynamoDB call alone does NOT throw — the means must be verified, not assumed; if none exists, record NOT RUN) | renders the unrewritten path (characterize) | `/500`, no-store |
| **B-CASE** | mixed-case XFH on `/tenant/<id>` → no outbound HTTPS request | characterize | pass |
| **B-REFLECT** | XFH `a.test`, path `/b.test/about` → record status/body | characterize (known defect § 7.4) | same |
| **B-REVAL** | feed the SQS journal message to `.open-next/revalidation-function` (HTTPS shim → lambda-host) | record | record; junk 307 counted success iff `REVALIDATED` (E6) |
| **B-SHARP / B-VERSION** | § 6.3 artefact checks | n/a | pass |

Placement: the build costs ~60–90 s. Run at the deploy gate (alongside or replacing
`verify-opennext-patch.mjs`) and optionally in a nightly CI job. The ~9 s `next start` suite
stays in PR CI.

**The harness and every row above are mandatory.** Gates in § 9.4, the cold-container fallback of
E1/E6/E17, the fallbacks of E16/E21, the attribution in E2/E3, E9, and the § 6.3 artefact checks
all use these rows. Decision `OPENNEXT1-HARNESS` decides only *when* the harness is built (its
own slice 1a before the upgrade, or inside 1b), never *whether*.

### 8.2 (b) Staging experiments

All on **staging only** (`AmodxStack-staging`). Record the gates before running. Use the
smallest input that shows the contract.

**Experiment rule (applies to E1–E22).** Every experiment is runnable from its own block. It
states:
- **Setup:** exact inputs and state preparation;
- **Steps:** with explicit wait conditions;
- **Measure:** what is recorded, and where;
- **Pass:** the pass criterion;
- **Cleanup:** what is restored or removed, run even when the experiment aborts. For an
  experiment that belongs to a combined group, it runs at that group's cleanup point (§ 9.1
  step 3), not when the experiment itself ends.

It uses only the operator procedures `OP-*` defined below, never a research file. If a wait
condition times out, the experiment is recorded **NOT RUN** with the reason, never as pass or fail.

**No-disturbance rule (applies to every `OP-*` procedure, Setup and Cleanup).** A request to a
path under test appears **only** as a numbered, recorded Step, and that includes warm-up requests.
Setup, Cleanup and the `OP-*` procedures send no such request; they check their own result only
through read-only control-plane calls (waiters, `get-*`, `head-object`, logs). The **first
measured request** is the only check of a precondition that needs a request. For example, after
OP-COLD-EDGE the first measured GET must show an `x-cache` other than `Hit from cloudfront`; if it
shows `Hit`, the experiment is **NOT RUN** (the edge was not cold), and no extra request is sent
to find out why. A log check must hold for the measured invocation itself, not for some
invocation that happens to fall in the same time window.

**Evidence-scope rule (applies to every check cited as proof).** A check proves a property of an
object only if it examines **that** object. For example, a log line proves something about the
measured invocation only when it is correlated to that invocation's request ID. When a check
cannot examine the object, its result is recorded as **INFERRED** for that property. A gate that
needs the property then rests on a named direct observation instead; each experiment that uses a
gate names its direct observation. **A result labelled INFERRED or NOT OBSERVED never
satisfies a gate.**

**Probe request rule (applies to every probe in § 8.2–8.6 and § 9).** A probe that asserts
anything about a served page uses **GET** and records the status, all response headers and the
body, e.g. `curl -sS -D <id>.headers -o <id>.body -w '%{http_code}\n' <url>`. A body assertion
compares a **unique token** placed in the page for that probe, never only a status code. A check
that needs only headers says so and is labelled **HEAD** (`curl -sS -I`). No HEAD result may be
used as evidence about a body. (A HEAD response carries no body, so a passing HEAD status cannot
show which page a cache stored.)

#### Operator procedures (shared by the experiments)

All AWS commands run with `AWS_REGION=eu-central-1`. Evidence files go to
`/private/tmp/OPENNEXT-1-<EID>-<ts>/` (deleted at the end of the run, after the numbers are
copied into the slice report).

- **OP-RESOLVE** — resolve the staging names once per run. Physical names change per deploy, so
  never hard-code them:
  - `FN=$(aws lambda list-functions --query "Functions[?starts_with(FunctionName,'AmodxStack-staging-RendererHostingRendererServer')].FunctionName" --output text)`
  - `RFN=$(aws lambda list-functions --query "Functions[?starts_with(FunctionName,'AmodxStack-staging-RendererHostingRevalidation')].FunctionName" --output text)`
  - `UFN=$(aws lambda list-functions --query "Functions[?starts_with(FunctionName,'AmodxStack-staging')&&contains(FunctionName,'UpdateContentFunc')].FunctionName" --output text)`
  - `BUCKET=$(aws lambda get-function-configuration --function-name $FN --query Environment.Variables.CACHE_BUCKET_NAME --output text)` (reads one non-secret variable)
  - `BUILD=$(aws s3 cp s3://$BUCKET/BUILD_ID -)`
  - `TAGT=AmodxStack-staging-tag-cache`
  - `Q=AmodxStack-staging-revalidation.fifo`
  - `DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?contains(Aliases.Items || \`[]\`, '$H')].Id" --output text)`
  - `$H` = the staging tenant host chosen for the run; record it.
- **OP-PAGE(slug, token)** — publish a page on `$H` in the staging admin (Content → new page, the
  slug, body text containing the token, status Published). Do not request it before the
  experiment says so. **Cleanup:** delete the page in the admin, then OP-COLD-EDGE(slug).
- **OP-COLD-EDGE(path)** — remove one path from the edge and wait:
  1. `I=$(aws cloudfront create-invalidation --distribution-id $DIST --paths "<path>" --query Invalidation.Id --output text)`
  2. `aws cloudfront wait invalidation-completed --distribution-id $DIST --id $I`
  3. Wait condition: the waiter returns 0 (default timeout 20 min, otherwise NOT RUN).

  No GET follows: a confirmation GET would refill the edge for a published page, or store a new
  cacheable 307 for a deleted one. The cold-edge precondition is checked by the first measured GET
  (no-disturbance rule).
- **OP-COLD-FLEET** — force every server container to be new:
  1. `aws lambda update-function-configuration --function-name $FN --memory-size 1025`
  2. `aws lambda wait function-updated --function-name $FN`

  Any configuration update makes Lambda start new execution environments for later invocations
  (INFERRED from Lambda behaviour; OP-POST-UPDATE-CHECK checks it per measured request where it can).
  This touches only one numeric field, so no secret-bearing environment map is read or rewritten.
  **Cleanup (mandatory, also on abort):**
  1. `aws lambda update-function-configuration --function-name $FN --memory-size 1024`
  2. `aws lambda wait function-updated --function-name $FN`
  3. Verify: `aws lambda get-function-configuration --function-name $FN --query MemorySize` = `1024`.

  The CDK value is 1024 (RH:221), so the restore removes the drift.
- **OP-POST-UPDATE-CHECK(measured responses)** — checks, per measured request, whether that
  invocation ran in an execution environment created after OP-COLD-FLEET. For each measured
  response:
  1. Read the `x-amzn-requestid` response header. It is INFERRED that the Lambda Function URL adds
     this header with the invocation's request ID and that CloudFront passes it to the viewer on a
     MISS; this step checks both at run time.
  2. Poll every 15 s, for up to 5 min:
     `aws logs filter-log-events --log-group-name /aws/lambda/$FN --start-time <t_before ms> --filter-pattern '"REPORT RequestId: <id>"'`
     Wait condition: exactly one line is returned.
  3. Result:
     - **VERIFIED post-update** if that line says `Memory Size: 1025 MB`.
     - **VERIFIED pre-update** if it says `1024 MB`: the experiment is NOT RUN; repeat from
       OP-COLD-FLEET.
     - **NOT OBSERVED** if the header is missing, or no line arrives within 5 min. The
       property is then INFERRED for that request (evidence-scope rule). The experiment reports
       this and uses its named direct observation for the cold-container gate.

  A line found under the exact request ID can only describe that invocation, and a missing or
  mismatched ID yields NOT OBSERVED, never a pass. So this check cannot pass on another
  invocation's line.

  Why "post-update" matters, INFERRED from Lambda behaviour and from NX
  `shared-cache-controls.external.js:38-64`:
  - An environment created after the update starts with an empty in-memory cache-control map.
  - The page was rendered before the update. Its path is unique to the experiment, and its S3
    entry exists, so no post-update request re-renders it.
  - Hence a post-update invocation has never rendered the page, which is the #1250 condition.
- **OP-TAG(tag)** — read the tag rows (a Query on the partition key, never a Scan):
  `aws dynamodb query --table-name $TAGT --key-condition-expression "#t = :t" --expression-attribute-names '{"#t":"tag"}' --expression-attribute-values "{\":t\":{\"S\":\"$BUILD/<tag>\"}}"`
- **OP-SQS(t0, t1)** — messages sent in a window:
  1. Wait until `t1 + 5 min` (metric latency).
  2. Run `aws cloudwatch get-metric-statistics --namespace AWS/SQS --metric-name NumberOfMessagesSent --dimensions Name=QueueName,Value=$Q --start-time <t0> --end-time <t1> --period 60 --statistics Sum`.
  3. **Baseline:** the same query over the window of equal length just before `t0`, with no probe
     traffic. Report the measured value minus the baseline.
- **OP-S3HEAD(key)** — `aws s3api head-object --bucket $BUCKET --key <key> --query LastModified`
  (read-only; prints the object's last-modified time).

#### E1 — #1250 shape on cold containers (run on 3.1.3 before the upgrade, and on 4.x after)
- **Setup:** OP-RESOLVE; OP-PAGE(`/opn1-e1-<ts>`, `OPN1-E1-<ts>`).
- **Steps:**
  1. GET `https://$H/opn1-e1-<ts>` twice, 5 s apart. Wait condition: the second response has
     `x-cache: Hit from cloudfront`; otherwise repeat once.
  2. OP-COLD-FLEET.
  3. OP-COLD-EDGE(`/opn1-e1-<ts>`).
  4. Note `t0` (= `t_before`). GET the path twice, 5 s apart; note `t_after`. Precondition, from
     the first GET itself: `x-cache` is not `Hit from cloudfront`, otherwise NOT RUN. Note
     `t1` = `t0 + 1 min`.
  5. OP-POST-UPDATE-CHECK(both responses of step 4).
  6. OP-SQS(`t0`, `t1`).
- **Measure:** for both GETs of step 4: `x-nextjs-cache`, `Cache-Control`, `x-cache`, token in
  body. Also the SQS delta.
- **Pass:**
  - 3.1.3: `STALE`, `s-maxage=2, stale-while-revalidate=300`, SQS delta ≥ 1.
  - 4.x without the seed: `STALE`, **no** `Cache-Control`, second GET not `Hit`, SQS delta ≥ 1.
  - 4.x with the seed: `HIT`, `s-maxage=31536000`, second GET `Hit`, SQS delta 0.
  - In every case both bodies contain the token.
- **Cold-container gate (direct observation, per the evidence-scope rule):**
  - **Without the seed** (3.1.3, and 4.x without it): the gate is the first measured response's
    own `x-nextjs-cache: STALE`. Next 16.3.8 reports STALE for a `revalidate = false` entry only
    when its in-memory cache-control map has no entry for the key (NX
    `server/lib/incremental-cache/index.js:157-159` with `shared-cache-controls.external.js:38-64`,
    VERIFIED code). That is, it happens only in a container that did not render the page. The
    response therefore shows the condition directly, whatever OP-POST-UPDATE-CHECK returns.
  - **With the seed:** a `HIT` looks the same from a seeded new container and from the container
    that rendered the page. The staging result counts as cold-container evidence only if
    OP-POST-UPDATE-CHECK is **VERIFIED post-update** for the first measured request. Otherwise it
    is recorded as "consistent; cold premise INFERRED", which is **not** a pass. The binding direct observation is then
    bundle-harness row **B-STALE**, where `restart()` starts a new process and so guarantees an
    empty map (§ 8.1).
- **Cleanup:** OP-COLD-FLEET cleanup; OP-PAGE cleanup.

#### E2 — `revalidatePath` writes rows and is honoured (4.x)
- **Setup:** OP-RESOLVE; OP-PAGE(`/opn1-e2-<ts>`, `OPN1-E2A-<ts>`).
- **Steps:**
  1. GET the page once (the render writes the tag rows).
  2. Wait 10 s; OP-TAG(`_N_T_/$H/opn1-e2-<ts>`).
  3. In the admin, replace the token with `OPN1-E2B-<ts>` and save. Note `t_edit`.
  4. Wait 10 s; OP-TAG again.
  5. GET the page every 2 s for up to 120 s. Wait condition: the body contains `OPN1-E2B-<ts>`.
- **Measure:** the items of steps 2 and 4 (`path`, `revalidatedAt`, `expire`); the time of the
  first fresh body.
- **Pass:**
  - Step 2: exactly 1 item, `revalidatedAt = 1`.
  - Step 4: the same `path`, with `expire` set and `revalidatedAt ≥ t_edit`.
  - Step 5: the new token is served within 120 s.

  The CACHE-10 purge also runs (it reads the same `CACHE_BUCKET_NAME` as the adapter, RV:174), so
  this proves the rows exist in the real table. Attribution of freshness to the tag path is proven
  by harness row B-TAG.
- **Cleanup:** OP-PAGE cleanup.

#### E3 — `revalidatePath('/<host>','layout')` writes nothing (4.x)
- **Setup:** member of group G7, run after E2 step 4 (OP-RESOLVE values reused; § 9.1 step 3).
- **Steps:**
  1. OP-TAG(`_N_T_/$H/layout`).
- **Measure:** item count.
- **Pass:** 0 items. Listing staleness without the purge is proven by B-LISTING variant 2.
- **Cleanup:** none (read-only).

#### E4 — nextMode + tenant tag (only inside a future tenant-tag slice; not run in opennext-1b)
- **Setup:** a staging-only build of a branch that sets `tagCache: "dynamodb-nextMode"` in
  `renderer/open-next.config.ts` and wraps the tenant-config and content reads of
  `renderer/src/lib/dynamo.ts` in `unstable_cache(fn, [<key>], { tags: ["tenant:<tenantId>"] })`.
  Deploy it to staging with the normal deploy. Then OP-RESOLVE; tenant `T` on `$H` with a page `P`
  and a listing `L`.
- **Steps:**
  1. GET `P` and `L` (renders write the S3 entries).
  2. `aws s3api list-objects-v2 --bucket $BUCKET --prefix _cache/$BUILD/route-cache/` and find P's key.
  3. `aws s3 cp s3://$BUCKET/<P's key> -`, then read `meta.headers["x-next-cache-tags"]`.
  4. POST `https://$H/api/revalidate` with header `x-revalidation-token` (staging secret, read by
     the operator from Secrets Manager) and body `{"tag":"tenant:<tenantId>"}`.
  5. Wait 10 s. Query the tag table for `tag = $BUILD/_tag/tenant:<tenantId>`. The nextMode key is
     `<buildId>/_tag/<tag>`, the same value for `path` and `tag` (N `dynamodb-nextMode.js:35-52`).
  6. OP-COLD-EDGE(`/*`).
  7. GET `P` and `L`.
- **Measure:** the tag list of step 3; the item count of step 5; `x-nextjs-cache` of step 7.
- **Pass:** the tag list contains `tenant:<tenantId>`; exactly 1 item; both GETs are `MISS`.
- **Cleanup:** redeploy staging from `main`. Verify with `aws lambda get-function --function-name $FN --query Configuration.CodeSha256`: the value equals the one recorded before the Setup deploy.

#### E5 — no `2592000` is ever emitted (4.x)
- **Setup:** group G9. It reads the responses recorded by E1 (G6), E2 (G7) and E6 (G8), so it is
  scheduled after all three (§ 9.1 step 3). It also reads the build artefact.
- **Steps:**
  1. Collect `Cache-Control` from E1 (both GETs of step 4), E2 (step 1 and the first fresh GET of
     step 5) and E6 (both GETs), and from a warm HIT. For the warm HIT, GET any published page
     twice; record the second response.
  2. In the repo build: `grep -o 'stale-while-revalidate=[0-9]*' renderer/.open-next/server-functions/default/renderer/index.mjs | sort | uniq -c`.
- **Measure:** every recorded `Cache-Control` value; the grep counts.
- **Pass:** no response contains `2592000`. The grep shows `stale-while-revalidate=300` twice
  (the patch) and `stale-while-revalidate=2592000` once (`fixSWRCacheHeader`'s replace target,
  inert for us). This is the same count as the scratch 4.1.9 build (VERIFIED).
- **Cleanup:** none.

#### E6 — a junk 307 entry on a cold container (4.x)
- **Setup:** OP-RESOLVE; junk path `J = /opn1-e6-<ts>.php`. It is not published; the dot skips the
  tenant rewrite (MW:159).
- **Steps:**
  1. GET `https://$H$J`. Wait condition: `307` with `Location` ending `?nf=1`.
  2. OP-COLD-FLEET.
  3. OP-COLD-EDGE(`J`).
  4. Note `t0` (= `t_before`); GET `J` again; note `t_after`. Precondition, from this GET: `x-cache`
     is not `Hit from cloudfront`, otherwise NOT RUN. Then OP-POST-UPDATE-CHECK(this response).
  5. Wait 2 min. Run `aws logs filter-log-events --log-group-name /aws/lambda/$RFN --start-time <t0 ms> --filter-pattern '"opn1-e6-<ts>"'`.
  6. OP-SQS(`t0`, `t0 + 1 min`).
- **Measure:** `x-nextjs-cache` and `Cache-Control` of step 4; the revalidation log lines; the SQS
  delta.
- **Pass (prediction for the recommended decisions):**
  - Without the seed: `STALE`, SQS delta ≥ 1, and a "Failed to revalidate" line for `J`. The HEAD
    cannot re-render because `x-prerender-revalidate` is not forwarded.
  - With the seed: `HIT`, SQS delta 0, no log line.
  - A different outcome is reported as a finding against § 5.4 / § 5.6.
- **Cold-container gate:** as E1. Without the seed, the gate is the response's own `STALE`. With
  the seed, it is OP-POST-UPDATE-CHECK **VERIFIED post-update**; failing that, the result is
  recorded as INFERRED and B-STALE is the binding observation.
- **Cleanup:**
  1. OP-COLD-FLEET cleanup.
  2. `aws s3 rm` the junk object, located by `aws s3 ls s3://$BUCKET/_cache/$BUILD/ --recursive | grep 'opn1-e6-<ts>'`.
  3. OP-COLD-EDGE(`J`).

#### E7 — cutover cost of the upgrade deploy
- **Setup (before the deploy):**
  1. OP-RESOLVE.
  2. For each `_cache/<id>/` prefix, record `aws s3 ls s3://$BUCKET/_cache/<id>/ --recursive --summarize`.
  3. Record server `Invocations`, `Errors` and `Duration` p99 over the 30 min before the deploy
     (`get-metric-statistics`, period 60).
- **Steps:**
  1. Deploy staging (opennext-1b). Note `t0` = the time the stack reaches `UPDATE_COMPLETE`:
     `aws cloudformation wait stack-update-complete --stack-name AmodxStack-staging`, then
     `describe-stacks`.
  2. Re-run OP-RESOLVE (new `BUILD`).
  3. Wait 30 min of normal staging traffic plus the § 8.2 experiments.
  4. Record the same metrics for `[t0, t0 + 30 min]`.
  5. Record `--summarize` for the new build prefix.
- **Measure:** invocations, errors, p99 before and after; object count of the new prefix; whether
  the old prefixes are untouched.
- **Pass:** `Errors` = 0 in the window; the new prefix exists and grows; the old prefixes are
  unchanged (orphaned, not read). Counts are recorded for § 9.2. They have no threshold, because
  staging traffic is not prod traffic.
- **Cleanup:** none.

#### E8 — the tag row exists before `/api/revalidate` answers (4.x)
- **Setup:** OP-RESOLVE; OP-PAGE(`/opn1-e8-<ts>`, `OPN1-E8A-<ts>`).
- **Steps:**
  1. GET the page once (the render writes its tag rows).
  2. In the admin, change the token to `OPN1-E8B-<ts>` and save.
  3. Wait 30 s.
  4. Run `aws logs filter-log-events --log-group-name /aws/lambda/$UFN --filter-pattern '"Path success" "opn1-e8-<ts>"'`
     and take that event's `timestamp` as `t_200`. The line is logged after the response
     arrived: `backend/src/lib/revalidate.ts:98-104`.
  5. OP-TAG(`_N_T_/$H/opn1-e8-<ts>`).
- **Measure:** `t_200` and `revalidatedAt` (both in ms).
- **Pass:** `revalidatedAt ≤ t_200`.
- **Cleanup:** OP-PAGE cleanup.

#### E9 — 1-second `LastModified` MISS loop
- Runs only in the **bundle harness**, not on staging. Through CloudFront the edge stores the
  first MISS, so a loop at the origin is invisible there.
- **Setup:** a harness tenant page.
- **Steps:**
  1. POST `/api/revalidate` for the page.
  2. Send 5 GETs within the same wall-clock second.
- **Measure:** the number of renders in the DynamoDB stub journal.
- **Pass:** at most 2 renders, then HIT.
- **Cleanup:** harness teardown.

#### E10 — edge listing staleness after an edit
- **Setup:** OP-RESOLVE; a staging listing page `L` on `$H` (the tenant's blog index or post grid)
  that shows the title of post `P`.
- **Steps:**
  1. GET `L` twice. Wait condition: the second response is `x-cache: Hit from cloudfront`.
  2. In the admin, change `P`'s title to `OPN1-E10-<ts>` and save. Note `t_edit`.
  3. GET `L` every 60 s for 20 min.
- **Measure:** for each GET: `x-cache`, `age`, and whether the token is in the body; the first
  time the token appears.
- **Pass:** the token appears ≤ 16 min after `t_edit` (the bulk-lane bound). Before that a stale
  body is expected.
- **Cleanup:** restore `P`'s title.

#### E11 — no in-process re-render on a STALE read (4.x)
- **Setup:** member of group G2 (on 3.1.3) or G6 (on 4.x) together with E1, and uses E1's page.
  The exact interleaving is that group's sequence in § 9.1 step 3: E11.1 just before E1.4, then
  E11.2 60 s after E1.4. Before E11.1, find the page's S3 key with
  `aws s3 ls s3://$BUCKET/_cache/$BUILD/ --recursive | grep 'opn1-e1-<ts>'`.
- **Steps:**
  1. OP-S3HEAD(key) just before E1 step 4.
  2. OP-S3HEAD(key) again 60 s after E1 step 4.
- **Measure:** the two `LastModified` values.
- **Pass:** unchanged. The revalidation HEAD cannot re-render (`x-prerender-revalidate` is not
  forwarded), so any change would be Next re-rendering in-process on STALE. That would be a
  double render that #1211/#1267 should prevent.
- **Cleanup:** none of its own; the group's cleanup point runs E1's cleanup.

#### E12 — tenant isolation, two tenants, shared slug (no-go gate)
- **Setup:** OP-RESOLVE; two staging tenants `A` and `B`. Run OP-PAGE on each host with the same
  slug `/opn1-iso-<ts>`: token `OPN1-ISO-A-<ts>` on `A`, `OPN1-ISO-B-<ts>` on `B`. Do not request
  either before step 1.
- **Steps:**
  1. GET `A`'s URL, then `B`'s (both cold).
  2. GET both again. Wait condition: both second responses are `Hit`.
  3. List the current build prefix for `…/$/<hostA>/opn1-iso-<ts>.cache` and `…/$/<hostB>/opn1-iso-<ts>.cache`.
  4. `aws s3 cp` one of them and read `meta.headers["x-next-cache-tags"]`.
- **Measure:** the tokens in all four bodies; the keys; the tag list.
- **Pass:** every `A` body contains `A`'s token and not `B`'s, and the reverse; both keys exist
  and each contains its own host; the tag list contains `_N_T_/<hostA>/opn1-iso-<ts>`.
  **No-go if not.**
- **Cleanup:** OP-PAGE cleanup on both tenants.

#### E13 — cross-tenant reflection (pre-existing, § 7.4)
- **Setup:** member of group G12, run after E12 step 4. It uses E12's page and `B`'s token.
- **Steps:**
  1. GET `https://<hostA>/<hostB>/opn1-iso-<ts>`.
- **Measure:** status; whether the body contains `B`'s token.
- **Pass:** this is a characterization. The § 7.4 finding is **confirmed** if the body contains
  `B`'s token under `A`'s host. Either result is recorded in TECH-DEBT for `OPENNEXT1-REFLECTION`.
- **Cleanup:** OP-COLD-EDGE(`/<hostB>/opn1-iso-<ts>`).

#### E14 — `x-isr` attack stays closed
- Defined in full in § 8.5, which carries its own Setup, Steps, Pass and Cleanup.

#### E15 — If-None-Match (#1255), before and after the deploy
- **Setup:** OP-RESOLVE; OP-PAGE(`/opn1-e15-<ts>`, `OPN1-E15-<ts>`).
- **Steps:**
  1. GET the page twice. Wait condition: the second response is `Hit`.
  2. Read `ETag` from the second response.
  3. GET with `-H 'If-None-Match: "<etag>"'`, recording headers and body.
- **Measure:** status; body length; token present.
- **Pass:** `304` with no body, or `200` whose body contains the token. **Never** `200` with an
  empty body.
- **Cleanup:** OP-PAGE cleanup.

#### E16 — the 404 contract
- **Setup:** OP-RESOLVE; path `M = /opn1-e16-missing-<ts>` (never published).
- **Steps:**
  1. GET `M`. Wait condition: `307` with `Location` `M?nf=1`.
  2. GET the `Location`.
  3. Repeat steps 1–2.
- **Measure:** status, `Cache-Control`, `x-cache` of all four responses.
- **Pass:**
  - The 307 carries `s-maxage=31536000`.
  - The `?nf=1` response is `404` with `private, no-cache, no-store…` and is never `Hit`.
  - The second 307 may be `Hit`.
  - No redirect loop.

  Note: amodx never calls `notFound()` on the ISR route, so there is no Next-rendered ISR 404 to
  probe. Harness row d2 covers the forced header.
- **Cleanup:** OP-COLD-EDGE(`M`); `aws s3 rm` the 307 object for `M`, found as in E6.

#### E17 — seed verification across a cold fleet (only if `OPENNEXT1-1250` = A)
- **Setup:** OP-RESOLVE; 10 published pages on `$H`, listed with their tokens.
- **Steps:**
  1. GET all 10 (warms S3).
  2. OP-COLD-FLEET.
  3. OP-COLD-EDGE(`/*`).
  4. Note `t0` (= `t_before`); GET all 10 once; note `t_after`. Precondition, from these GETs: none
     is `Hit from cloudfront`, otherwise NOT RUN. Then OP-POST-UPDATE-CHECK(all 10 responses).
  5. OP-SQS(`t0`, `t0 + 2 min`).
- **Measure:** `x-nextjs-cache` of the 10 responses; the SQS delta.
- **Pass:** 10/10 `HIT` (no `STALE`), each body with its token, SQS delta 0.
- **Cold-container gate:** a response counts as seeded-cold evidence only if
  OP-POST-UPDATE-CHECK is **VERIFIED post-update** for it. The report states how many of the 10
  were VERIFIED. If none were, E17 is recorded as "consistent; cold premise INFERRED", which is
  **not** a pass, and B-STALE is the binding observation.
- **Cleanup:** OP-COLD-FLEET cleanup.

#### E18 — next-auth sign-in
- **Setup:** a staging tenant with sign-in configured and an access-gated page `G` (the operator
  names both). Use a browser profile with no cookies for `$H`.
- **Steps:**
  1. Sign in.
  2. Reload `G`.
  3. In the browser devtools, record the `Set-Cookie` names on the sign-in response, and the
     response headers of `G`.
- **Measure:** cookie names; `G`'s `Cache-Control`; `G`'s body.
- **Pass:** `next-auth.session-token` (or its `.0`/`.1` chunks) is set; `G` shows the gated
  content with `private, no-cache, no-store…` (the twin).
- **Cleanup:** sign out; delete the browser profile.

#### E19 — preview canonical URL
- **Setup:** OP-RESOLVE; OP-PAGE(`/opn1-e19-<ts>`, `OPN1-E19-<ts>`) plus a second page linked from
  it; the distribution domain `D` (the `RendererUrl` output of the staging stack).
- **Steps:**
  1. Open `https://D/_site/<tenantId>/opn1-e19-<ts>` in a browser.
  2. Click the link (a client-side navigation).
  3. Record the address bar.
- **Measure:** the address-bar URL after the navigation.
- **Pass:** it starts with `/_site/<tenantId>/`, never `/<tenantId>/_dyn/`.
- **Cleanup:** OP-PAGE cleanup for both pages.

#### E20 — mixed-case host
- **Setup:** member of group G14, run after E15's after-deploy half. It uses E15's page and token.
- **Steps:**
  1. GET `https://$H/<page>` with `-H 'Host: <$H with some letters upper-case>'`, recording
     headers and body. Note the time.
  2. `aws logs filter-log-events --log-group-name /aws/lambda/$FN --start-time <t ms> --filter-pattern '"<page slug>"'`.
- **Measure:** status; token in body; the number of server invocations logged for the path in
  that second.
- **Pass:** status `404`, or `200` with the token; no second (proxied) invocation for the same
  path.
- **Cleanup:** none of its own; the group's cleanup point runs E15's cleanup.

#### E21 — a 500 at the edge
- **Setup:** only if the implementation slice names a staging-safe way to make one page's render
  throw. None is known today. Changing IAM or table config on shared staging is not acceptable.
- **Steps:** GET the page twice within 10 s.
- **Measure:** status, `Cache-Control`, `x-cache` of both responses.
- **Pass:** the second request reaches the origin again (not served from the edge).
- **Cleanup:** undo the named trigger.
- If no safe trigger exists, record **NOT RUN**. Harness row e1 still proves that the origin sends
  `no-store`.

#### E22 — served-response diff, before and after the deploy
- **Setup:** OP-RESOLVE. The URL list:
  - a warm page; a cold page (a new OP-PAGE);
  - the twin (`?page=2`);
  - an unknown host;
  - `/opn1-e22-missing-<ts>` and its `?nf=1` landing;
  - `/_site/<tenantId>/` on `D`;
  - `/<tenantId>/_dyn/a`;
  - `sitemap.xml`, `robots.txt`, `/api/posts`.

  Record the expected token or marker of each body before the deploy.
- **Steps:**
  1. GET every URL before the deploy and after it, recording headers and body.
  2. Diff the header sets.
- **Measure:** header differences; status; token or marker per body.
- **Pass:**
  - Only the header changes listed in § 3.C/3.D appear: no `x-middleware-rewrite` or
    `x-middleware-next`; 404/500 no-store; possibly a relative `Location`.
  - No new `Set-Cookie` on a cacheable response.
  - Every body is the expected one for its URL.
- **Cleanup:** OP-PAGE cleanup for the cold page; OP-COLD-EDGE for the missing path.

### 8.3 (c) The edit-goes-live probe (page AND warm listing)

The experiment rule of § 8.2 applies to this section and to § 8.4–8.6. Today this probe is a
manual staging step: no automated spec matches "goes live" under `tests/` (VERIFIED by grep). The
implementation either adds it to the staging suite (`tests/e2e/`, run by the existing
`staging-e2e.yml` workflow) or keeps it as a runbook step with recorded output.

- **Setup:**
  - Staging: OP-RESOLVE; OP-PAGE(`/opn1-live-<ts>`, `OPN1-LIVE-A-<ts>`); a listing page `L` on
    `$H` that shows that page's title. Use a blog post if the listing lists posts.
  - Prod run (§ 9.1 step 5): the operator names one existing page `P` and one listing `L` that
    shows `P`'s title. Before starting, the operator records `P`'s current title so it can be
    restored.
- **Steps:**
  1. GET the page and `L` twice each. Wait condition: both second responses are
     `x-cache: Hit from cloudfront`.
  2. Change the page's title to `OPN1-LIVE-B-<ts>` in the admin and save. Note `t_edit`.
  3. GET the page every 2 s for up to 120 s. Wait condition: the token is in the body.
  4. GET `L` every 60 s for up to 20 min. Wait condition: the token is in the body.
- **Measure:** the time from `t_edit` to the first body with the token, for the page and for `L`.
  For every poll, record `x-cache` and `age`.
- **Pass:** the page shows the token within 120 s, and `L` within 16 min of `t_edit` (the
  bulk-lane bound). A 200 without the token is not a pass.
- **Cleanup:**
  - Staging: OP-PAGE cleanup.
  - Prod: restore `P`'s title. That edit goes live through the same lanes.

Run before the upgrade and after. The baseline before the upgrade is page ~2.4 s via CACHE-10 and
listing ~946 s; the CACHE-10 commit message records these staging numbers.

### 8.4 (d) #1250 before/after measurement (prod)

- **Setup:** none (read-only metrics).
  - `QP=AmodxStack-revalidation.fifo`.
  - `FNP` and `RFNP` = the prod server and revalidation function names, resolved as in
    OP-RESOLVE with the prefix `AmodxStack-RendererHosting…`.
- **Steps:**
  1. Baseline window: the 7 days before the prod deploy. After window: the 7 days starting 24 h
     after the deploy.
  2. For each window, run `aws cloudwatch get-metric-statistics` with `--period 86400 --statistics Sum` for:
     - `AWS/SQS NumberOfMessagesSent` (`QueueName=$QP`);
     - `AWS/Lambda Invocations` for `$FNP` and for `$RFNP`.
  3. Count "Failed to revalidate" lines in `/aws/lambda/$RFNP` per window with
     `aws logs filter-log-events --filter-pattern '"Failed to revalidate"'`. Page through
     `nextToken` until it is empty.
- **Measure:** the daily values of the three metrics and the failure count, for both windows.
- **Baseline already measured (VERIFIED 2026-10-13, prod):**
  - SQS sent per day over the last 7 days: 5,986 / 3,356 / 5,564 / 5,655 / 10,934 / 3,943 /
    16,621 (sum 52,059).
  - Server invocations per day: 9,212–55,196.
- **Pass:**
  - If the seed is adopted: SQS sent drops by ≥ 95%; server invocations drop by at least the
    revalidation function's invocations × 5 (batch size, RH:181); no rise in the CloudFront miss
    ratio.
  - If it is not adopted: record the rise and re-open `OPENNEXT1-1250`.
- **Cleanup:** none.

### 8.5 (e) Security probe — the `x-isr` attack must stay closed (E14)

**What the attack does.** On 3.1.3, a request carrying `x-isr` skipped the tenant middleware.
On an edge MISS, the raw path rendered as `[siteId] = <first segment>`, which is "tenant not
found", and the answer was a one-year cacheable `307 → ?nf=1`. CloudFront stored that 307 under
the real page's key, so every later visitor got the redirect instead of the page. The probe must
therefore check the **body that later visitors receive**, not a status line.

- **Setup (staging only):** OP-RESOLVE; OP-PAGE(`/opn1-xisr-a-<ts>`, `OPN1-XISR-A-<ts>`) and
  OP-PAGE(`/opn1-xisr-b-<ts>`, `OPN1-XISR-B-<ts>`). Do not request either before step 1, so that
  the first request is an edge MISS (a new path has no edge entry).
- **Steps:**
  1. Attack A, header only: `curl -sS -D a1.headers -o a1.body -H 'x-isr: 1' https://$H/opn1-xisr-a-<ts>`
  2. Victim A, a second client with no extra header: `curl -sS -D a2.headers -o a2.body https://$H/opn1-xisr-a-<ts>`
  3. Attack B, header plus a forged secret: `curl -sS -D b1.headers -o b1.body -H 'x-isr: 1' -H 'x-prerender-revalidate: deadbeef' https://$H/opn1-xisr-b-<ts>`
  4. Victim B: as step 2 for path B → `b2.headers`, `b2.body`.
- **Measure:** status, `Location`, `x-cache`, and token presence for the four responses.
- **Pass:** all four are `200`, none carries a `Location` header, and each body contains its
  page's token. This applies in particular to the victim bodies `a2.body` and `b2.body`: the edge
  stored the page, not a redirect. **Fail:** any `307`, any `Location: …?nf=1`, or any body without
  its token.
- **Cleanup:** OP-PAGE cleanup for both pages. It includes OP-COLD-EDGE, which removes anything
  the attack stored.

This probe tests the CloudFront layer (the ORP deletes the header before the origin). Harness row
B-XISR tests the adapter layer with the header actually delivered. Both layers must hold
independently.

### 8.6 Production checks (named separately from the staging experiments)

A staging experiment needs inputs that prod cannot safely supply: disposable pages, a second
tenant with a shared slug, an attack request. The prod checks below have their own names and say
what they do **not** prove. They never count as the staging experiment they resemble.

#### E12-PROD — tenant isolation on prod, root path
- **Setup (before the prod deploy):**
  - Choose two live tenants, `A` and `B`; for example `amodx.net` and `bijup.com`, the live tenants
    in the prod `ROUTE#` counts of report 02.
  - Resolve the prod names as in OP-RESOLVE, without `-staging`: `DISTP`, `BUCKETP`.
- **Steps:**
  0. Before the deploy: GET each home page `/`, recording headers and body, and record its
     `<title>` text as markers `M-A` and `M-B`.
  1. Deploy prod.
  2. Wait condition: the deploy's own CloudFront invalidation has completed.
     `aws cloudfront list-invalidations --distribution-id $DISTP --query 'InvalidationList.Items[0].Status'`
     must be `Completed`; poll every 30 s, for up to 20 min.
  3. GET home `A`, then home `B`.
  4. If either response is `x-cache: Hit from cloudfront`, it was not cold. Then run
     `aws cloudfront create-invalidation --distribution-id $DISTP --paths "/"`, wait with
     `aws cloudfront wait invalidation-completed`, and repeat step 3.
  5. GET both again.
  6. `BUILDP=$(aws s3 cp s3://$BUCKETP/BUILD_ID -)`, then list
     `_cache/$BUILDP/route-cache/APP_PAGE/` for `…/$/<hostA>.cache` and `…/$/<hostB>.cache`.
- **Measure:** the marker in each of the four bodies; the two keys.
- **Pass:** every `A` body contains `M-A` and not `M-B`, and the reverse; both keys exist and
  differ by host.
- **Cleanup:** none. GETs and listing only; an invalidation of `/` is what every deploy does
  anyway.
- **Does not prove:** isolation of nested paths (`/<slug>`). Only B-ISO and E12 prove that. If the
  implementation slice finds, by a read-only lookup, a slug that two prod tenants share, it adds
  that slug to this check.

#### E14-PROD-CONFIG — the `x-isr` headers are not forwarded on prod
No attack probe runs on prod: if the barrier had failed, the probe itself would poison a live page
for every visitor.
- **Setup:** after the prod deploy, find the policy id:
  `aws cloudfront list-origin-request-policies --type custom --query "OriginRequestPolicyList.Items[?OriginRequestPolicy.OriginRequestPolicyConfig.Name=='AmodxStack-RendererOriginPolicy'].OriginRequestPolicy.Id" --output text`.
- **Steps:** `aws cloudfront get-origin-request-policy --id <id> --query 'OriginRequestPolicy.OriginRequestPolicyConfig.HeadersConfig.Headers.Items'`.
- **Measure:** the header list.
- **Pass:** it contains neither `x-isr` nor `x-prerender-revalidate`. This is the same property
  that `infra/test/amodx-stack.test.ts:483-489` pins in code.
- **Cleanup:** none (read-only).
- **Does not prove:** adapter behaviour. § 8.5 on staging and B-XISR prove that.


---

## 9. Rollout and rollback

### 9.1 Deploy order

The adapter, the renderer code and the CDK are one stack and deploy together (the CDK
constructor builds `.open-next`, RH:94-115). There is no separate "CDK first" step for the
adapter swap: it needs **no** CDK change (§ 6.6). Order:

1. Pre-deploy gates on the commit: root `npm run build` + `npm run typecheck`; `cd renderer &&
   npm run test:serving` (33/33, c2 re-pointed); bundle harness (every § 8.1 row) green;
   `node scripts/verify-opennext-patch.mjs` → `guard: OK`; artefact checks per § 6.3; `npm audit`
   reviewed; `git status` clean after the build (#1260).
2. `cdk diff` staging: expect Lambda code/asset changes only; no stateful replacement; resource
   count unchanged.
3. Staging, as one run plan. **Run-plan rule:**
   - Groups run strictly one after another. Within a group, the members run in the listed order
     and share the state named in the table.
   - Each group has **one cleanup point**: at its end, the Cleanup fields of its members run once,
     in reverse member order, also on abort. The next group starts only after that.
   - An experiment that reads another experiment's records is scheduled after all of its
     producers.
   - A combined group (more than one member) is executed as **one linear sequence of
     `<experiment>.<step>` IDs**, written in the table. That sequence is the order of execution.
     A step's own text ("just before", "60 s after") must agree with it.
   - The only overlap allowed is E7's passive metrics window (it sends no requests and changes no
     state).
   - E4 (future tenant-tag slice) and E9 (bundle harness) are not part of this run.

   | Group | When | Members, in order | Shared state | Cleanup point (at group end) |
   |---|---|---|---|---|
   | G1 | before the deploy (3.1.3) | E7 setup | none (read-only records) | none |
   | G2 | before | E1.1 → E1.2 → E1.3 → E11.1 → E1.4 (note `t0`) → wait until `t0 + 60 s` → E11.2 → E1.5 → E1.6 | E1's page; OP-COLD-FLEET | E1's cleanup (OP-COLD-FLEET restore, then OP-PAGE cleanup) |
   | G3 | before | E15 (before half: steps 1–3) | E15's page | E15's cleanup |
   | G4 | before | E22 (before half) | E22's cold page | E22's cleanup |
   | G5 | before | § 8.3 (baseline) | § 8.3's page | § 8.3's cleanup |
   | — | deploy staging; E7's window starts at `t0` | — | — | — |
   | G6 | after the deploy (4.x) | same sequence as G2 | as G2 | as G2 |
   | G7 | after | E2.1 → E2.2 → E2.3 → E2.4 → E3.1 → E2.5 | E2's page and tag rows | E2's cleanup (E3 has none) |
   | G8 | after | E6 | junk path `J`; OP-COLD-FLEET | E6's cleanup |
   | G9 | after G6–G8 | E5 | reads the records of G6, G7, G8 | none |
   | G10 | after | E8 | E8's page | E8's cleanup |
   | G11 | after | E10 | the listing and post `P` | E10's cleanup |
   | G12 | after | E12.1 → E12.2 → E12.3 → E12.4 → E13.1 | E12's two pages | E13's cleanup, then E12's cleanup |
   | G13 | after | E14 (§ 8.5) | the two attack pages | § 8.5's cleanup |
   | G14 | after | E15.1 → E15.2 → E15.3 (after half) → E20.1 → E20.2 | E15's page | E15's cleanup (E20 has none) |
   | G15 | after | E16 | the missing path `M` | E16's cleanup |
   | G16 | after (only if the seed is adopted) | E17 | the 10 pages; OP-COLD-FLEET | E17's cleanup |
   | G17 | after | E18 | browser profile | E18's cleanup |
   | G18 | after | E19 | E19's pages | E19's cleanup |
   | G19 | after (only per its block) | E21 | the named trigger | E21's cleanup |
   | G20 | after | E22 (after half) | E22's cold page | E22's cleanup |
   | G21 | after | § 8.3 | § 8.3's page | § 8.3's cleanup |
   | G22 | at or after `t0 + 30 min` | E7 read-out (steps 4–5) | none | none |

   OP-COLD-FLEET is used only in G2, G6, G8 and G16. Because groups never overlap, two
   OP-COLD-FLEET uses never overlap either.
4. Hold staging 24 h; compare § 8.4 signals on staging.
5. Before the prod deploy: record E12-PROD step 0 markers. `cdk diff` prod (small); deploy prod;
   run E12-PROD and E14-PROD-CONFIG (§ 8.6); run § 8.3 on one prod page and one listing that the
   operator chooses (the operator makes and restores the edit); start the 7-day § 8.4 window.

Independent slices (warmer fix, orphan cleanup) deploy separately, before or after, so each has
its own rollback.

### 9.2 Cold-cache cutover load

Measured route count: ~111 `ROUTE#` across the three live tenants (+0 products). Every deploy
already starts a new build-id namespace and invalidates the edge (§ 7.1 N10), so the cutover load is
the same as any deploy: one render per real page on first visit, plus junk on demand.

### 9.3 Rollback

Procedure: `git revert <upgrade commit>` (package.json, lockfile, patch files, config, test/script
re-anchors, docs, all in one commit — keep the upgrade a single revertable commit), then the normal
deploy (staging first if time allows). What persists:

| State | On rollback | Label |
|---|---|---|
| S3 `_cache/<4.x buildId>/…` | orphaned (new build id on rebuild); swept by nightly flush / orphan cleanup | VERIFIED key scheme |
| Tag rows (build-id prefixed) | orphaned, unread by 3.1.3 (its own new build id) | VERIFIED |
| SQS in-flight messages (≤ 1 h retention, RH:158) | compatible body; a 3.1.3 consumer treats 307/404 as failures again | VERIFIED |
| CloudFront | flushed by the deploy's BucketDeployment `/*` | INFERRED-high |
| Lambda code/config | replaced atomically; env names identical in both versions | VERIFIED |
| ORP | **must stay without `x-isr`** — if any slice re-forwarded it on 4.x, the rollback must revert that too, or the 3.1.3 hole reopens | VERIFIED (O middleware.js:27) |
| `patches/open-next+3.1.3.patch` | comes back with the revert; without it 3.1.3 ships the 30-day window | VERIFIED |
| Warmer / lifecycle CDK changes | independent slices; not reverted with the adapter | — |

Functional cost of rolling back: `revalidatePath` is ineffective again (CACHE-10 purge still
covers it), routing-layer security fixes are lost.

### 9.4 Go / no-go

**Gate rule.** Every gate below names its environment and the inputs it needs. A check that
cannot supply those inputs has its own name (§ 8.6) and counts only for what it proves. In
particular, a probe of one tenant never counts as E12.

**Go to prod** only if all hold: B-ISO (bundle) and E12 (staging, two tenants, shared slug) pass;
§ 8.3 page probe passes within 120 s and listing within the bulk bound on staging; § 8.5 passes on
staging; no `2592000` header (E5); tag rows appear on staging (E2); no new 5xx class in staging
logs for 24 h; S3 keys contain the host (E12 step 3).
If `OPENNEXT1-1250` = A (seed): harness row B-STALE passes with its with-seed expectation (`HIT`,
`s-maxage=31536000`, 0 SQS messages after `restart()`). A staging E1/E6/E17 result whose cold
premise is INFERRED never replaces this.
**Keep prod** only if, after the prod deploy, E12-PROD and E14-PROD-CONFIG pass.
**No-go / roll back** on: any cross-tenant body (B-ISO, E12 or E12-PROD), any cacheable 307 for a
real page, a CloudFront 5xx rate or server Lambda `Errors` above the pre-deploy 7-day maximum
(`Errors` was 0 over the last 14 days, report 03), SQS sent rising above 2× baseline for 24 h
without the seed (§ 7.1 N2).

### 9.4a Decision-dependent expectations

**Decision-gate rule.** Every option offered in § 11 must leave every gate in § 8–9 executable.
Where an option changes the *expected value* of a gate, the row below states the new expectation.
An option that would remove the evidence a gate needs is not offered (see `OPENNEXT1-HARNESS`).
The expectations written in § 8 are those of the RECOMMENDED options.

| Decision | Option | Gates affected | Expectation under that option |
|---|---|---|---|
| `OPENNEXT1-PIN` | B, D | patch file name, lockfile, B-VERSION | keyed to the chosen version instead of 4.1.10; all gates otherwise unchanged |
| `OPENNEXT1-PIN` | C (caret) | `(c2)`, LAYER 2, B-VERSION | unchanged; they fail loudly when an installed version does not match the patch, which is the expected cost of C |
| `OPENNEXT1-TAGMODE` | B (nextMode) | OP-TAG, E2, E3, E8, B-TAG | OP-TAG queries key `$BUILD/_tag/<tag>`, where `path` = `tag` (N `overrides/tagCache/dynamodb-nextMode.js:35-52`). E2 step 2: **0** items, because nextMode writes no rows on render (N `adapters/cache.js:439`); step 4: 1 item with `expire`. E3: **1** item may exist, because nextMode writes a row for every revalidated tag even when no page carries it (N `adapters/cache.js:315-334`). The no-op is then proven by B-LISTING variant 2, not by row absence. E8 and B-TAG: the same key change |
| `OPENNEXT1-CACHE10-PURGE` | B (remove) | B-LISTING v1, § 8.3 listing step, E10 | these **fail by design**: listings stay stale until the nightly flush. Choosing B requires the human to replace the ratified ~16 min listing bound (CACHE10-LISTING-EDGE) first |
| `OPENNEXT1-CACHE10-PURGE` | C (tenant tag) | B-LISTING, E4 | needs its own slice; E4 becomes a gate of that slice |
| `OPENNEXT1-XISR` | B (both headers) | E14-PROD-CONFIG, infra test `amodx-stack.test.ts:483-489` | pass becomes "both headers present"; the infra pin is inverted. § 8.5 and B-XISR stay the behaviour gates and must pass. § 9.3: a rollback must revert the ORP too |
| `OPENNEXT1-XISR` | C (`x-prerender-revalidate` only) | E14-PROD-CONFIG, infra test | pass becomes "`x-prerender-revalidate` present, `x-isr` absent"; § 8.5 and B-XISR unchanged |
| `OPENNEXT1-1250` | B (accept) | E1, E6, E17, § 8.4, § 9.4 seed gate | E1/E6 use the "without the seed" expectations; E17 and the § 9.4 seed gate are not run; § 8.4 pass = "record the rise" |
| `OPENNEXT1-1250` | C (no-op queue) | E1, E6, E17, § 8.4 | E1/E6 use the "without the seed" expectations, except SQS delta **0** and no revalidation log line; E17 not run; § 8.4 expects SQS ≈ 0 and records the CloudFront miss ratio |
| `OPENNEXT1-1250` | D (wait) | — | the upgrade waits; no gate changes |
| `OPENNEXT1-WARMER` | B (remove) | slice 1c gates | gate becomes "no `WarmerFunction` in the synthesized template" instead of "warmer `Errors` = 0" |
| `OPENNEXT1-WARMER` | C (leave) | slice 1c | slice 1c is not created; no gate |
| `OPENNEXT1-IMAGE` | B (fix) | slice 1b | runbook probes 11/11b (`docs/runbooks/deploy-track-cache.md`) become 1b gates and must pass |
| `OPENNEXT1-ORPHANS` | A, B, C | slice 1d | A: no slice. B: unit test plus "current build untouched, old prefixes gone" on staging. C: infra assertion on the exact `_cache/` prefix plus the same staging check |
| `OPENNEXT1-HARNESS` | A, B | all harness rows | unchanged. With B, the 3.1.3 column of the § 8.1 rows is not run |
| `OPENNEXT1-SWR-PATCH` | B (drop hunks) | E5, `(c2)`, LAYER 2 | E5's bundle grep expects `stale-while-revalidate=2592000` **3** times and `=300` **0** times; `(c2)` and LAYER 2 are removed; E5's response check (no response carries `2592000`) and B-NO30D become the gate |
| `OPENNEXT1-REFLECTION` | B, C (fix) | E13 | E13 becomes a gate: the response must not contain `B`'s token under `A`'s host (expected: `404`) |

### 9.5 Watch list (first 7 days)

Server `Errors`, `Duration` p50/p99, `Invocations`; CloudFront 5xx rate and cache-hit ratio;
SQS `NumberOfMessagesSent` / `ApproximateNumberOfMessagesVisible`; revalidation `Invocations` and
"Failed to revalidate" count; tag table `ItemCount`, consumed WCU/RCU, throttles; S3 PUT count on
the cache bucket; warmer `Errors` (if fixed: 0); cold-start count (`Init Duration` in REPORT lines);
log lines `Failed to revalidate tag`, `Failed to get revalidated tags`, `Failed to batch write
dynamo item`, `ENOENT … _not-found.segments`.

---

## 10. Slice decomposition

Small, converging slices. Each has its own gates, deploy and rollback. Ordering assumes the
recommended decision options; § 11 states where an option changes the plan.

| Slice | Scope | Gates | Output surface | Depends |
|---|---|---|---|---|
| **opennext-1a — bundle harness, baseline on 3.1.3** | `renderer/test/serving-bundle/` (lambda host, S3/SQS/DDB stubs, B-rows with version-explicit expectations); a `test:serving-bundle` script; infra cross-check of the ORP list | all 33 rows + B-rows green on 3.1.3 with the 3.1.3 expectations (B-TAG/B-XISR/B-LEAK characterized as known defects) | test code + docs/testing-strategy.md | only if `OPENNEXT1-HARNESS` = A (with B, the same harness is built inside 1b) |
| **opennext-1b — the upgrade** | § 6.1–6.5, § 6.7; patch re-cut (+ seed hunk per `OPENNEXT1-1250`); docs ripple § 7.5; flip harness expectations to 4.x | § 9.1 step 1; staging § 8.2/8.3/8.5; prod § 9.4 | renderer, patches, scripts, tests, docs | 1a if `OPENNEXT1-HARNESS` = A; with B, 1b first builds the full § 8.1 harness and its gates run only after that; `OPENNEXT1-PIN`, `-TAGMODE`, `-1250`, `-SWR-PATCH` |
| **opennext-1c — warmer** | RH:266-269 `WARM_PARAMS` (fix) or remove the construct; infra assertion `WarmerFunction` has `WARM_PARAMS` | infra tests; staging warmer `Errors` = 0 for 1 h; prod 7-day cold-start count before/after | infra | `OPENNEXT1-WARMER`; independent of 1b (works on 3.1.3, same env contract) |
| **opennext-1d — orphan cleanup** | per `OPENNEXT1-ORPHANS` (lifecycle rule on `_cache/` or nightly non-current-build delete) | infra/unit tests; staging object count drops; current build untouched | infra or backend | independent |
| **opennext-1e — dormant revalidation infra (conditional)** | if 14 days after 1b show SQS ≈ 0: decide whether to remove SQS queue + RevalidationFunction + 2 alarms (≈ −6 to −8 CFN resources) or keep them dormant | — | infra | 1b + soak; not ratified here (§ 12) |

Deferred / separate tracks (not part of OPENNEXT-1): image optimizer un-park; tenant tag
(`cache-4b` successor); cross-tenant reflection fix (`OPENNEXT1-REFLECTION`); CI integration
tests writing into the prod table.

---

## 11. Decisions

Each block states the problem first, then each option as reward vs risk. § 9.4a states, for every
option, how it changes the expected value of any gate (decision-gate rule). Evidence references
point into this document.

DECISION_REQUIRED:
- ID: OPENNEXT1-PIN
  QUESTION: Which adapter version do we install, and how do we keep it current?
  PROBLEM: The adapter decides how every tenant page is cached. Patch releases have regressed
    before (4.1.6 broke time-based ISR until 4.1.8). The newest release, 4.1.10, appeared today,
    after the research; it changes one runtime file, on a code path amodx's middleware never
    takes (§ 2.2).
  OPTIONS:
  - A) Exact pin 4.1.10. REWARD: latest fixes; one inert, verified diff from the researched
    4.1.9; patch hunks unchanged. RISK: hours-old release; a hidden regression would show only in
    the harness/staging (the change is in middleware header handling, which we exercise).
  - B) Exact pin 4.1.9. REWARD: the version every build and code read used. RISK: one release
    behind on day one; the next upgrade must take 4.1.10 anyway.
  - C) Caret range ^4.1.9. REWARD: automatic fixes. RISK: the patch silently applies (with a
    warning) or fails on a moved file; unreviewed adapter changes reach prod. Not acceptable for
    a security barrier.
  - D) "Latest 4.1.x at implementation time" with a mandatory dist-diff review against 4.1.10
    (as in § 2.2). REWARD: freshest. RISK: the review must be redone; spec evidence may drift.
  RECOMMENDED: A, with the § 2.3 maintenance rule (Next patches under the pin; adapter bumps as
    reviewed diffs; Next minors as their own slice).
  EVIDENCE: § 2.1–2.3; `diff -rq` 4.1.9 vs 4.1.10; patch-package version-mismatch behaviour
    (`applyPatches.js:170-186`).
  BLOCKING_REASON: The patch file name, the lockfile and the harness expectations are all keyed to
    the exact version.

DECISION_REQUIRED:
- ID: OPENNEXT1-TAGMODE
  QUESTION: Which DynamoDB tag-cache mode does the adapter use?
  PROBLEM: 4.x will write tag rows for every cached page. Two modes exist. Freshness for an
    edited page is the same in both; they differ in cost, failure behaviour and maturity (§ 5.1).
  OPTIONS:
  - A) Original mode (`dynamodb`, the default). REWARD: the most used path on Lambda; our GSI
    fix was made for it; on a DynamoDB error it keeps serving cached pages. RISK: 5–6 rows per
    cached path per build, including scanner junk; table grows without bound (+$0.05 to +$0.46/month in writes, § 7.3); a broad
    tenant-wide tag would cost one row per path.
  - B) nextMode (`dynamodb-nextMode`). REWARD: no writes on render; one row per invalidated tag;
    cheap broad tags if a tenant tag is adopted later. RISK: less used on Lambda (opt-in, uses
    `aws4fetch` with env credentials); on a DynamoDB error every request becomes a render
    (more load during an outage); the existing GSI becomes unused.
  RECOMMENDED: A. Re-evaluate B only together with a tenant-tag slice (§ 12), which is the one
    requirement that would earn it.
  EVIDENCE: § 3.F (F1, F5, F7), § 5.1; N `overrides/tagCache/dynamodb.js`, `dynamodb-nextMode.js`.
  BLOCKING_REASON: It is a config line in opennext-1b and decides the tag-table data shape.

DECISION_REQUIRED:
- ID: OPENNEXT1-CACHE10-PURGE
  QUESTION: What happens to CACHE-10's tenant-wide S3 purge after the upgrade?
  PROBLEM: After the upgrade `revalidatePath` refreshes the edited page by itself. But listings
    (home, blog grid, nav) are separate cached pages with no tag linking them to the edit, and
    `revalidatePath('/<host>', 'layout')` matches nothing in any version (§ 5.2 step 4, VERIFIED).
    Today the purge is the only thing that refreshes a listing's S3 copy; the bulk `/*` only
    clears the edge, which then refills from S3.
  OPTIONS:
  - A) Keep the purge unchanged. REWARD: listings stay fresh within the ratified ~16 min; no
    code change; key layout unchanged in 4.x. RISK: purge latency grows with the tenant's junk
    objects, and a purge slower than the backend's 10 s abort lets the fast lane run before the
    deletes finish — the refill race CACHE-10's ordering exists to prevent (pre-existing; bounded
    by `OPENNEXT1-ORPHANS`); whole-tenant re-render after each edit (~20–54 pages per tenant
    today).
  - B) Remove the purge; rely on `revalidatePath` + bulk lane + nightly flush. REWARD: less code.
    RISK: **listings stay stale until the nightly flush** (contradicts the ratified
    CACHE10-LISTING-EDGE ruling); after the #1250 fix nothing refreshes them accidentally either.
  - C) Replace it with a tenant tag (`unstable_cache` tags + `revalidateTag`). REWARD: precise,
    no S3 listing. RISK: renderer data-layer change, FETCH cache entries, interaction with the
    "failed reads throw" rule; needs its own slice and probably nextMode.
  RECOMMENDED: A now; C as a later slice if purge latency or re-render volume becomes a problem.
    Correct the TECH-DEBT line "Remove the S3 purge when opennext-1 …" (true for pages only).
  EVIDENCE: § 5.2, § 5.3; RV:90-129, 166-169; NX `implicit-tags.js`.
  BLOCKING_REASON: Option B would break a ratified freshness bound; the implementation must know
    whether to touch RV.

DECISION_REQUIRED:
- ID: OPENNEXT1-XISR
  QUESTION: Do we re-forward `x-isr` and/or `x-prerender-revalidate` through CloudFront after the
    upgrade?
  PROBLEM: These headers were removed today to close a cache-poisoning hole in 3.1.3. 4.x checks a
    per-build secret before it skips the middleware, so forwarding would be safe on 4.x (§ 5.4).
    But forwarding only matters if background re-renders are useful, and for amodx (no
    time-based ISR) they are not.
  OPTIONS:
  - A) Keep both removed. REWARD: no attack surface; rollback to 3.1.3 stays safe; the infra test
    pin stays. RISK: background revalidation stays dormant; harmless if #1250 is fixed, wasteful
    if it is not (HEADs that cannot re-render).
  - B) Re-forward both. REWARD: restores OpenNext's design as published. RISK: junk 307 HEADs now
    "succeed" and become real re-renders (#1121); a rollback to 3.1.3 without reverting the ORP
    reopens the hole; uses 2 of the 10 ORP header slots again.
  - C) Forward only `x-prerender-revalidate`. REWARD: enough for amodx (dotted path skips the
    rewrite); a viewer value without the secret is ignored by Next. RISK: depends on the dotted
    pass-through, which is itself a defect we may close (§ 7.4); undocumented coupling.
  RECOMMENDED: A.
  EVIDENCE: § 5.4; N `core/routing/middleware.js:28-31`; previewModeId absent from public assets
    (both builds); `infra/test/amodx-stack.test.ts:483-489`.
  BLOCKING_REASON: Decides whether opennext-1b touches the ORP and the infra test.

DECISION_REQUIRED:
- ID: OPENNEXT1-1250
  QUESTION: How do we handle upstream #1250 (pages look stale 1 s after a cold container reads
    them)?
  PROBLEM: Today #1250 creates ~5–16k useless SQS messages a day and about a third of renderer
    invocations. After the upgrade the stale responses lose their cache header, so CloudFront
    stops storing them and origin traffic likely rises (§ 5.6, § 7.1 N2). The upstream fix (PR
    #1302) is open and untested on Lambda.
  OPTIONS:
  - A) Backport the read side of PR #1302 as a hunk in our patch file. REWARD: removes the false
    staleness at its cause; SQS and revalidation go quiet; cold containers answer HIT with the
    one-year header. RISK: we maintain about 15–20 lines of patch until upstream releases it; it uses a
    Next internal (`SharedCacheControls.cacheControls`); it is untested on Lambda (our harness
    B-STALE and staging E1/E17 test it); the accidental listing refresh disappears (§ 7.1 N8).
  - B) Accept #1250 as it is. REWARD: no extra patch. RISK: likely higher origin load and no
    edge storage for cold reads; the flood continues.
  - C) No-op queue override (custom `queue` that drops sends). REWARD: stops SQS/HEAD cost. RISK:
    edge still does not store cold STALE (B's main risk stays); adds custom override code.
  - D) Wait for an upstream release with #1302 before upgrading. REWARD: no local patch. RISK:
    unknown wait; the upgrade's freshness and security gains are delayed.
  RECOMMENDED: A, removed again when the pinned release contains #1302. Measure per § 8.4.
  EVIDENCE: § 5.6; NX `incremental-cache/index.js:157-159, 439`, `shared-cache-controls.external.js:38-64`;
    PR #1302 diff (`gh pr diff 1302`); 7-day SQS metrics.
  BLOCKING_REASON: Decides the content of the patch file and the B-STALE expectation.

DECISION_REQUIRED:
- ID: OPENNEXT1-WARMER
  QUESTION: Fix the warmer or remove it?
  PROBLEM: The warmer has failed on every run since it was deployed (864/864 in 24 h, VERIFIED)
    because CDK passes the wrong env names. The upgrade does not change that. A fixed warmer
    keeps one server container warm every 5 minutes; prod sees ~500 cold starts a day with an
    average 753 ms init (report 03).
  OPTIONS:
  - A) Fix: set `WARM_PARAMS` (2-line CDK property change, 0 new resources), add an infra
    assertion, measure cold starts for 7 days. REWARD: fewer slow first requests at quiet hours;
    stops 864 failing invocations/day. RISK: benefit unproven at concurrency 1; +288 cheap
    invocations/day.
  - B) Remove the warmer (Lambda, rule, permissions; about −4 to −5 CFN resources). REWARD: less
    infra, no noise. RISK: loses a possible latency gain without having measured it.
  - C) Leave as is. REWARD: none. RISK: permanent failing invocations and a misleading component.
  RECOMMENDED: A as independent slice opennext-1c (can ship before the upgrade); remove (B) if the
    7-day cold-start count does not drop.
  EVIDENCE: § 3.H; RH:256-281; CloudWatch 2026-10-13.
  BLOCKING_REASON: It decides whether slice 1c exists and which CDK change it carries.

DECISION_REQUIRED:
- ID: OPENNEXT1-IMAGE
  QUESTION: Do we un-park the image optimizer as part of the upgrade?
  PROBLEM: Image optimization was parked by human ruling (unused, pre-existing bug). 4.x fixes
    the first bug (call signature), but two more wait behind it: a wrong S3 key prefix
    (`_assets`, RH:202) and no `images.remotePatterns`. Prod invocations in 14 days: 0.
  OPTIONS:
  - A) Stay parked; record the second and third defects in TECH-DEBT; keep runbook probes 11/11b
    marked "expected to fail (parked)". REWARD: the upgrade stays focused on caching and
    security. RISK: none new.
  - B) Fix during the upgrade (prefix + remotePatterns + probes). REWARD: images could work.
    RISK: widens a security-sensitive slice; `remotePatterns` choices are a product decision
    (which tenant asset hosts are allowed).
  RECOMMENDED: A.
  EVIDENCE: § 3.I; TECH-DEBT `opennext-1 PARKED`.
  BLOCKING_REASON: Changes the scope and the CDK diff of opennext-1b.

DECISION_REQUIRED:
- ID: OPENNEXT1-ORPHANS
  QUESTION: How do we remove old-build and junk S3 cache objects?
  PROBLEM: The nightly flush only runs after an edit. Prod had no edit since 2026-09-16, so 41,631
    orphan objects (792 MB) sit in an old build prefix, and junk keys outside any tenant are never
    removed by CACHE-10. Removing them saves about $0.02/month in storage (INFERRED price); the real cost is that CACHE-10 lists
    every build prefix on each edit and the bucket keeps scanner junk indefinitely.
  OPTIONS:
  - A) Leave it. REWARD: no change. RISK: unbounded growth; CACHE-10 purge time grows with junk.
  - B) Nightly flush also deletes every `_cache/<buildId>/` prefix that is not the current build,
    every night, regardless of the change gate. The current build id is readable from the
    `BUILD_ID` object the deploy puts at the bucket root (VERIFIED). REWARD: precise; keeps the
    current build's cache. RISK: new code + IAM `s3:GetObject` on the flush role; junk inside the
    current build stays.
  - C) S3 lifecycle rule: expire objects under prefix `_cache/` after N days (e.g. 30). REWARD: no
    code; also removes junk in the current build; 0 new CFN resources. RISK: a wrong prefix filter
    would delete site assets (assets live at the bucket root) — must be pinned by an infra test;
    each live page re-renders once per N days (harmless).
  RECOMMENDED: C with an exact `_cache/` prefix and an infra assertion, as independent slice 1d.
  EVIDENCE: § 5.5; `nightly-cache-flush.ts:64-75, 112-139`; read-only S3 listing 2026-10-13.
  BLOCKING_REASON: Decides whether slice 1d is CDK or backend work.

DECISION_REQUIRED:
- ID: OPENNEXT1-HARNESS
  QUESTION: When is the bundle harness (§ 8.1, all rows) built: as its own slice before the
    upgrade, or inside the upgrade slice?
  PROBLEM: Our serving-contract suite runs `next start` and never executes OpenNext, so it cannot
    see any change in § 3. Cache-8 (REVISE 3, 2026-08-16) explicitly decided NOT to build a
    Lambda-invoke harness and to grep the bundle instead. This spec asks to revisit that ruling,
    because the upgrade changes behaviour that a grep cannot prove, including a possible
    tenant-isolation failure (§ 7.1 N1).
  OPTIONS:
  - A) Harness first (slice 1a on 3.1.3), then the upgrade. REWARD: 3.1.3 behaviour becomes an
    executable baseline; the upgrade becomes a reviewed list of row changes; tenant isolation is
    asserted through the real artefact on every deploy. RISK: one more slice before the upgrade;
    ~60–90 s build at the deploy gate; stubs to maintain.
  - B) The same full harness (every § 8.1 row), built inside the upgrade slice 1b before its
    gates run. REWARD: one slice fewer. RISK: no 3.1.3 baseline run, so a row that differs after
    the upgrade cannot be told apart from a row that was already wrong on 3.1.3; 1b gets larger.
  - **No option without the harness is offered.** The tenant-isolation gate B-ISO (§ 9.4), the
    binding cold-container observation B-STALE (E1/E6/E17), harness rows e1 and d2 (E21, E16), E9
    and B-TAG/B-LISTING (the attribution in E2/E3) exist only in the harness. A no-harness
    choice would leave those gates without evidence; tenant isolation is absolute (VISION
    guarantee 1). If the harness is rejected altogether, this spec's gates must first be
    re-specified, which reopens the spec.
  RECOMMENDED: A.
  EVIDENCE: report 01 § 7 harness design, adopted and refined in § 8.1; cache-8 slice Revision 5
    (REVISE 3) text in `docs/slices/cache-8-revalidation-flood.md`; § 7.1 N1.
  BLOCKING_REASON: Reverses a ratified cache-8 decision (both options build the harness) and
    decides the slice order.

DECISION_REQUIRED:
- ID: OPENNEXT1-SWR-PATCH
  QUESTION: Keep the `stale-while-revalidate=300` patch on 4.x, or drop it?
  PROBLEM: 4.x still hard-codes a 30-day edge stale window in two places. For amodx's current
    routes both places are unreachable on 4.x (§ 5.7), so the patch protects only against a future
    route with a numeric `revalidate` or a tag profile with a stale window.
  OPTIONS:
  - A) Keep the re-cut hunks (§ 6.4). REWARD: defence in depth; guards `(c2)` and LAYER 2 stay
    meaningful; no extra cost if the patch file exists for the #1250 hunk. RISK: re-cut work on
    every adapter bump that moves `util.js`.
  - B) Drop the hunks; replace the guards with harness row B-NO30D plus a written rule "no numeric
    revalidate on tenant routes". REWARD: smaller patch. RISK: the rule is prose until a check
    enforces it; relies on harness row B-NO30D (the harness is mandatory, § 8.1).
  RECOMMENDED: A.
  EVIDENCE: § 5.7; N10 `core/routing/util.js:260, 330-332, 346, 355`.
  BLOCKING_REASON: Decides the patch content and whether `(c2)` survives.

DECISION_REQUIRED:
- ID: OPENNEXT1-REFLECTION
  QUESTION: What do we do with the pre-existing cross-tenant reflection (§ 7.4)?
  PROBLEM: Any request to `https://<tenantA>/<tenantB-domain>/<slug>` appears to render tenant B's
    public page under tenant A's address, because the middleware skips the tenant rewrite for any
    path with a dot. Content is public, so no private data leaks, but one tenant's domain can be
    made to show another tenant's site. The background-revalidation HEAD relies on the same
    pass-through. Not caused by the upgrade.
  OPTIONS:
  - A) Record it in TECH-DEBT now; probe it (E13); fix in its own security slice after the
    upgrade. REWARD: keeps OPENNEXT-1 focused. RISK: the reflection stays live until then.
  - B) Fix inside opennext-1b (e.g. reject a dotted first segment that is not the request host).
    REWARD: closes it sooner. RISK: widens the upgrade; changes routing for scanner paths and the
    revalidation HEAD in the same release, which makes regressions hard to attribute.
  - C) Fix it before the upgrade as its own slice on 3.1.3. REWARD: closes it soonest and in
    isolation. RISK: must keep revalidation HEADs working or accept them failing (they cannot
    re-render today anyway).
  RECOMMENDED: C if E13 confirms it on staging; otherwise A.
  EVIDENCE: MW:154-165; `docs/caching-architecture.md` § Root-cause Q3 item 4.
  BLOCKING_REASON: Security-class finding outside the slice scope; needs a human disposition.

---

## 12. Out of scope / deferred

| Item | Why deferred | Revisit trigger |
|---|---|---|
| Next 16.4 | adapter support not released (PR #1285 open) | an `@opennextjs/aws` release declaring 16.4 |
| Image optimizer | parked by human ruling; 0 invocations | a real need for resizing, or `OPENNEXT1-IMAGE` = B |
| Tenant-wide tag (successor of `cache-4b`) and nextMode | needs a renderer data-layer change | CACHE-10 purge latency or re-render volume becomes a measured problem |
| Removing the SQS queue / revalidation function (opennext-1e) | only after #1250 is fixed and measured | 14 days of SQS ≈ 0 after 1b |
| Tag-table pruning / TTL | storage ≈ $0.01/month per build life (§ 7.1 N6) | table > 1 M items or a cost alert |
| `dynamodb-provider` seeding | seed holds only 8 error-page rows | never, unless build-time prerendering is adopted |
| `reportBatchItemFailures` / DLQ on the revalidation queue | nothing should be enqueued after the #1250 fix | if `OPENNEXT1-1250` = B |
| Per-tenant CloudFront distributions (true tenant-scoped edge purge) | Workstream 3 | per TECH-DEBT |
| Cross-tenant reflection fix | separate security slice (`OPENNEXT1-REFLECTION`) | human disposition |
| CI integration tests writing `TENANT#test-*` into the PROD table | unrelated; recorded in TECH-DEBT | its own slice |
| `OPEN_NEXT_REQUEST_ID_HEADER`, log-level tuning | nice-to-have observability | an incident that needs request correlation |
| #1255 fix (If-None-Match) | upstream PR #1256 open | E15 shows a blank page |

---

## Required slice fields (cross-reference to `docs/documentation.md`)

- **Purpose / risk retired:** an unsupported adapter that silently breaks cache freshness and
  carries two security-class bypasses (§ 1).
- **Scope / Non-scope:** § 10 per slice; § 12.
- **Architectural boundaries:** tenant isolation (no-go gates B-ISO, E12 and, on prod, E12-PROD); no DynamoDB scans (all
  tag-table checks in § 8 use `Query` on `tag`); the renderer stays non-authoritative for private
  data (no change); the adapter is a volatile delivery mechanism behind the serving contract
  (VISION guarantee 3) — the bundle harness is the executable form of that boundary.
- **Migration / deployment notes:** § 9. No data migration. No schema change. Build-id
  namespacing makes forward and back deploys clean.
- **Definition of Done (per implementation slice):** gates in § 10; root build + typecheck;
  serving suite; patch guard; bundle harness (every § 8.1 row); staging § 8; docs ripple § 7.5; TECH-DEBT
  updated; MCP server checked for references (none expected: `tools/mcp-server` does not import
  the adapter — to be re-verified in the slice).
- **Evidence required:** § 8.3 page + listing token in served HTML (EXECUTED), § 8.5 (EXECUTED),
  E12 and E12-PROD (EXECUTED), E14-PROD-CONFIG (EXECUTED, read-only), § 8.4 7-day numbers
  (OBSERVED).
- **References:** `docs/caching-architecture.md`; `docs/TECH-DEBT.md` (opennext-1 PARKED, cache-8,
  CACHE-10); `docs/slices/cache-8-revalidation-flood.md`; `docs/slices/cache-4b-tag-revalidation.md`;
  `docs/runbooks/deploy-track-cache.md`; upstream issues #1209, #1242, #1250, #1255, #1260, #1270,
  #1285, #1307 and PR #1302.


## Ratification (human, 2026-10-15) — governs where the body differs

Decision review: reviewer gpt-6-sol challenged all 11 blocks, builder claude-opus-5-5 answered one round;
packet `.agent-manager/slices/OPENNEXT-1-SPEC/ratification-packet.md` (local trail). The human ratified
every decision **as recommended after the review**, i.e. including the two cells the builder conceded:

| ID | Ruling | Where the body must be read as amended |
|---|---|---|
| OPENNEXT1-PIN | **B — exact pin `@opennextjs/aws` 4.1.9** (the version every build and code read used). 4.1.10 is a later reviewed adapter bump under § 2.3 rule 3: packed and diffed against 4.1.9, `cmp` on `core/routing/util.js` + `adapters/cache.js`, green harness incl. B-XISR/B-ISO. | § 0.3 target row; § 2.1–2.2 (swap recommended/fallback); § 6.2 devDependency `"4.1.9"`; § 6.4 patch file `patches/@opennextjs+aws+4.1.9.patch`; § 9.4a PIN row; harness B-VERSION asserts 4.1.9 |
| OPENNEXT1-TAGMODE | A (original `dynamodb` mode). Added risk line: tag-write failures are logged, not thrown (4.1.9 `overrides/tagCache/dynamodb.js:189-212`), so a 200 from `/api/revalidate` never proves freshness; E2 step 5 / § 8.3 prove it with the served token. | § 11 TAGMODE option A RISK |
| OPENNEXT1-CACHE10-PURGE | A (keep the purge). | — |
| OPENNEXT1-XISR | A (keep both headers removed). | — |
| OPENNEXT1-1250 | A (backport the read side of PR #1302 as a patch hunk). **Fallback rule (human 2026-10-15):** if the staging check (B-STALE, E1/E17) fails, opennext-1b ships WITHOUT the hunk and accepts the flood; the hunk never holds the upgrade. | § 9.4 go/no-go; § 10 opennext-1b |
| OPENNEXT1-WARMER | **B — remove `WarmerFunction`, `WarmerSchedule` and their permission/role** (independent slice opennext-1c, may ship before 1b; gate: synthesized template has no `WarmerFunction`). Revisit trigger (§ 12): a measured cold-start latency problem. | § 3.H H1 effect; § 6.6 warmer rows; § 7.3 warmer cost row (−864 invocations/day, ≈ −0.7 MB logs/day); § 9.5 drop "warmer Errors"; § 10 opennext-1c scope |
| OPENNEXT1-IMAGE | A (stay parked; record the `_assets` prefix and missing `remotePatterns` defects). | — |
| OPENNEXT1-ORPHANS | C (S3 lifecycle rule on the exact `_cache/` prefix, infra assertion, independent slice opennext-1d). **Human 2026-10-15: 1c and 1d ship as ONE CDK deploy.** | § 10 |
| OPENNEXT1-HARNESS | A (harness first, opennext-1a on 3.1.3). Reverses cache-8 REVISE 3. | — |
| OPENNEXT1-SWR-PATCH | A (keep the re-cut hunks), with the builder's accepted wording: the hunks cover every 30-day site a Next-emitted `Cache-Control` can reach (`util.js:346, 355`); the third site (`fixSWRCacheHeader`, `util.js:260`) fires only on a hand-written bare `stale-while-revalidate`, none exists today, and the guard counts it as the known residual. **Plus (human 2026-10-15): the guard script also forbids a bare `stale-while-revalidate` in `renderer/src`** (one grep line). | § 5.7; § 11 option A REWARD ("complete protection" wording withdrawn); § 6.5 guard |
| OPENNEXT1-REFLECTION | C (fix first, own slice on 3.1.3) → slice **SITEID-BINDING-1**, `docs/slices/siteid-binding-1.md`. E13 confirmed it on staging 2026-10-14 (C1) and 2026-10-15 (C2–C5). | § 7.4; § 12 |

**Additional human rulings (2026-10-15), bound to the slices:**
1. Preview URLs of tenants without a custom domain (`/_site/<id>/…`, placeholder domain `<id>.localhost`)
   get a permanent safety net BEFORE any middleware change: two serving-contract rows (200/no-store/cookie
   from an allowed host; 403 from a tenant host) and one Playwright test on staging (open the preview,
   body marker, one client-side navigation stays under `/_site/<id>/`). Lands in SITEID-BINDING-1 as its
   first proof; opennext-1a's B-PREVIEW and E19 inherit the expectations.
2. Order of work: SITEID-BINDING-1 → opennext-1c+1d (one CDK deploy) → opennext-1a → opennext-1b.
3. Reframing recorded for prioritisation: with CACHE-10 live, the upgrade does not change what editors
   or visitors see on an edit; its product reward is the two routing-bypass fixes (#810, #1199), a
   maintained adapter for future Next security patches, and the #1250 cost/consistency fix.

**Findings surfaced during ratification, not part of OPENNEXT-1:** a MISS-rendered not-found 307 carries a
doubled `Location` (`/x?nf=1,/x?nf=1`; staging 2026-10-15; origin-side; the local suite cannot see it) →
TECH-DEBT + a characterize row in opennext-1a. 417 `e2e-render-*` leftover tenants on staging → cleanup item.

**Correction (2026-10-15, SITEID-BINDING-1):** § 4 row `(h1)` identity is now 'a tenant's dotted slug renders on ITS OWN host'; rows `(h1b)(h1c)(p1)(p2)(t1)(t2)` exist; opennext-1a's harness inherits these expectations.

**Correction (2026-10-15, OPENNEXT-1A-1, operator rulings at review):** § 8.1 row **B-NO30D** reads "no response carries
`2592000`"; its scope is cache-directive headers — `Set-Cookie` is excluded, because the referral cookie's `Max-Age=2592000`
(`renderer/src/app/api/ref/route.ts:88`) is a product lifetime, not a cache lifetime. Increment 1 exercises no STALE response,
so the live-handler SWR window is proven by **B-STALE** (increment 2), not by B-NO30D alone. Under the bundle target the six
`(g4)` rows characterize the renderer BEHIND the edge (the host strips `Origin`/`Sec-Fetch-Site` as the ORP does, so
`origin-guard.ts` is inert and an empty-body cross-site POST answers 500 — pinned, and recorded as a finding: 400 belongs
there); the edge 403 remains proven by infra test `(i)`. Full CloudFront-Function emulation stays phase 2 (not triggered).
