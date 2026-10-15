# Built-bundle serving harness (`SERVING_TARGET=bundle`)

Slice `opennext-1a` (`docs/slices/opennext-1a.md`; design: `docs/slices/opennext-1-upgrade.md`
§ 8.1). It runs the serving contract against the **real Lambda artefact** — the
`renderer/.open-next/server-functions/default` directory CDK uploads as the RendererServer
function — instead of `next start`. That executes the OpenNext adapter, which the `next`
target never runs: event conversion, routing, middleware, the S3 incremental cache, the
DynamoDB tag cache, the SQS revalidation queue and the response-header rewriting
(`fixISRHeaders`, the cache-8 `swr=300` patch). Built first on open-next 3.1.3, it was the
baseline the `@opennextjs/aws` 4.x upgrade was diffed against. **Since `opennext-1b`
(2026-10-15) the bundle is `@opennextjs/aws` 4.1.9 and every row runs its `"4"` entry**; the
`"3"` entries stay as the 3.1.3 record. The 3.1.3 → 4.1.9 side-by-side table is in
`docs/slices/opennext-1b.md` § Row table.

```bash
cd renderer && npm run test:serving-bundle
```

Needs the same built workspaces as `npm run test:serving`. No AWS, no credentials. It
**replaces `renderer/.open-next`** (`rm -rf` + `npm run build:open`, exactly as the CDK synth
does) and rebuilds `.next` through `open-next build`. CDK rebuilds `.open-next` itself on every
deploy, so a test build is never what ships.

Measured (2026-10-15, operator Mac, Node 22.21.1): build 13.1 s with no `.next` at all,
5.9–6.8 s with `.next/cache` warm from an earlier build; ≈1 s for the 40 contract rows,
≈4.7 s for the 18 B-rows (3 s of it is B-CASE's bounded wait); whole run 11.5 s. (The spec estimated 60–90 s; the `npm install sharp` step was served
from the local npm cache in these runs — a cold npm cache adds a registry download.) Placement: **deploy gate** (`docs/runbooks/
deploy-track-cache.md` § Preconditions), next to `scripts/verify-opennext-patch.mjs`. PR CI keeps
the `next` target only.

## Why one entry file

`test:serving-bundle` runs `node --test test/serving-bundle/bundle.test.mjs`, and that file
first imports `../serving-contract/contract.test.mjs`. One process therefore runs the contract
describe (build once, 39 rows + `(journals)`) and then the B-rows describe, in that order.
Listing both files on the command line does not work: `node --test` **sorts** its file list
(OBSERVED on Node 22.21.1: `a/a.test.mjs` ran before `z.test.mjs` given first), and
`serving-bundle/` sorts before `serving-contract/`, so the B-rows would run first, in another
process, against a stale `.open-next`, with no contract responses for B-NO30D.

## Abstractions (one line each)

- *serving target* (`harness.mjs` § SERVING TARGET) — users: the 39 contract rows and the
  B-rows; axis: the serving adapter (`next start` vs the Lambda bundle, a demonstrated
  volatile mechanism); dispatch: two concrete targets behind the same helpers
  (`startStubs`, `buildRenderer`, `startRenderer`; `request()` unchanged); rejected: a grep
  of the bundle (proves a string, not a state).
- *stored-entries reader* (`contract.test.mjs` `storedIsrEntries`) — users: rows `d3`, `e1`,
  `h1c`, `p1`; axis: where the adapter persists (filesystem vs S3); rejected: duplicating
  those rows per target.
- *versioned expectation* (`harness.mjs` `versionedExpectation`) — users: the contract rows
  and the B-rows; axis: the open-next major the bundle was built with (3 now, 4 in
  `opennext-1b`); rejected: per-row `if (version === …)` branches (an upgrade would pass every
  row nobody remembered to edit).

## The Lambda host (`lambda-host.mjs`)

One child Node process, cwd = the function directory, imports `./index.mjs` and calls
`handler` — as Lambda does from `/var/task`. Module state lives as long as the child (= one
warm container); `restart()` respawns it (= a cold container). The child prints
`LAMBDA_HOST_READY {"port":…,"openNextVersion":…}` once listening; `openNextVersion` is the
`globalThis.openNextVersion` the bundle's own banner set.

Two ways in:

1. **HTTP on `port`** — a viewer request through the emulated edge. `harness.request()`
   works against it unchanged.
2. **`invoke(event)` over IPC** — a raw invocation with no edge: the warmer event (B-WARM)
   and direct Function URL calls (B-ORIGINVERIFY).

Increment 1A-2 additions on the handle (each used by named rows):

| Member | What | Rows |
|---|---|---|
| `outbound()` | outbound calls journaled by `outbound-shim.cjs` (below) | B-CASE |
| `requests()` | every viewer request the HTTP port received, headers as SENT (before the edge filter), plus the header names the handler's event got | B-REVAL |
| `forwardViewerHeaders(names)` | the edge ALSO forwards these viewer headers until called with `[]` (a new child resets it). **Not production behaviour** — the real edge strips them | B-XISR only (`x-isr`, `x-prerender-revalidate`) |
| `sync()` | resolves after every IPC message the child sent earlier has arrived; the journals (and `bundleResponses`) travel over IPC and can lag the HTTP response they describe | rows that read a journal |

`runRevalidationFunction({ functionDir, event, redirectTo })` runs the built
**revalidation function** (`.open-next/revalidation-function`, cwd = that directory; it reads
`prerender-manifest.json` from cwd) once on an SQS event, in its own child with an empty
environment (the function has none in infra) and the outbound shim preloaded. With
`redirectTo` = the Lambda host's `http://127.0.0.1:<port>`, the function's `HEAD
https://<host><url>` is delivered to the host's HTTP port with `Host: <host>` — through the
emulated edge, as production sends it through CloudFront. Returns the handler result
(`{ type, batchItemFailures }`), the shim's journal and the log. Row B-REVAL.

### Outbound-call interceptor (`outbound-shim.cjs`)

A `--require` preload in both Lambda children. It patches `https.request`, `https.get`,
`http.request` / `http.get` to a non-loopback host, and `globalThis.fetch` to a non-loopback
host, before the bundle loads (and refreshes the builtin ESM facades, because open-next's
`proxyRequest` uses `import("node:https").then((m) => m.request)`). Each call is journaled
(`{ api, method, url, headers }`, to the parent over IPC) and redirected to
`SERVING_BUNDLE_OUTBOUND_REDIRECT`:

- Lambda host child → `http://127.0.0.1:1`: an outbound call is **refused on this host**
  (hermetic and deterministic; a `.test` DNS answer depends on the operator's resolver, and a
  real `*.cloudfront.net` name would leave the machine);
- revalidation child → the Lambda host's port (B-REVAL);
- unset → journal only (negative control (c)).

Loopback HTTP (the SDK talking to the stubs) is neither journaled nor redirected; HTTPS always
is (no stub speaks TLS). The variable is deleted before the bundle loads. Not seen: direct
`net`/`tls` sockets and HTTP/2 — neither built `index.mjs` uses them (VERIFIED by grep).

Both paths call the bundle's `handler` through ONE function in the child, `callHandler` — the
handler's only call site — which reports every result's headers (with `cookies[]` as
`set-cookie`) to the parent's `onResponse`. Rule: **every path that obtains a handler result
in this suite feeds the same B-NO30D check**, including raw invocations added later; it holds
by construction, not by a list of paths.

### Emulated edge (`edgeRequestHeaders`)

What reaches the Lambda through CloudFront, from `infra/lib/renderer-hosting.ts`:

| Header | Source |
|---|---|
| `x-forwarded-host` = viewer `Host` | `HostRewriteFunction` (a), line 361 |
| `x-origin-verify` = the secret | `HostRewriteFunction` (b) |
| `x-has-session` = `1`/`0` from the cookie jar (prefix match on `next-auth.session-token`, `__secure-next-auth.session-token`), always overwritten | `HostRewriteFunction` (c) |
| `accept`, `accept-language`, `content-type`, `x-forwarded-host`, `x-origin-verify`, `x-tenant-id`, `x-automation-key`, `x-revalidation-token` | `RendererOriginPolicy` allowlist (line 404), pinned by infra test `(h)` — **eight** headers since 2026-10-13 (the test title still says "ten") |
| `rsc`, `next-router-prefetch`, `next-router-state-tree`, `next-router-segment-prefetch`, `x-has-session` | `RendererCachePolicy` allowlist (line 473), pinned by infra test `(a1)`; CloudFront forwards cache-key headers to the origin |
| `user-agent: Amazon CloudFront` | CloudFront replaces a User-Agent it does not forward |
| cookies | `RendererOriginPolicy` `cookieBehavior: all` → the event's `cookies[]` |

Every other header the test sends is dropped. **Not emulated** (spec § 8.1 item 5, phase 2):
`HostRewriteFunction` job (d), the STATIC-EP edge origin guard (pinned by infra test `(i)`);
the edge cache; headers CloudFront and Function URLs add themselves (`via`,
`x-amz-cf-id`, `x-forwarded-for`, `x-forwarded-proto`, `x-amzn-trace-id`).

### Event conversion (`toFunctionUrlEvent`, `toHttpResponse`)

| Event field | Value |
|---|---|
| `version` / `routeKey` | `"2.0"` / `"$default"` |
| `rawPath`, `rawQueryString` | split at the first `?`, exactly as received (still encoded) |
| `cookies` | the `Cookie` header split on `"; "`; omitted when there is none |
| `headers` | the edge headers, lowercased, multi-values comma-joined; `cookie` removed; `host` = `abc.lambda-url.eu-central-1.on.aws`; `content-length` when a body exists |
| `requestContext.http` | `{ method, path: rawPath, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent }` |
| `requestContext.domainName` / `requestId` / `timeEpoch` | the fake host / a UUID / `Date.now()` |
| `isBase64Encoded`, `body` | `true` + base64 when a body exists; else `false`, no `body` |

Result → HTTP: `statusCode`, `headers`, each `cookies[i]` as its own `Set-Cookie`, body
base64-decoded when `isBase64Encoded`. A thrown handler answers `502` (what a Function URL does).

## The stubs

All in-process, ephemeral ports, journals readable by the rows. **An operation a stub does not
model is answered with a loud error and listed in `unhandled()`**; row `(journals)` fails on
any. The adapter swallows S3/SQS/tag-table errors (a failed get is a MISS, a failed put a log
line), so without this rule a broken cache would leave every other row green — negative
control (a) in the build report shows exactly that.

| Stub | Answers | Journal |
|---|---|---|
| `s3-stub.mjs` | `PutObject`, `GetObject` (404 `NoSuchKey` when absent), `HeadObject`, `DeleteObject`, `ListObjectsV2` (prefix, and `delimiter` → `CommonPrefixes`), `DeleteObjects` (the CACHE-10 purge), on the one bucket `CACHE_BUCKET_NAME`. Path-style and virtual-host style both decoded; `aws-chunked` bodies decoded. **Purge switch** `listReturnsNothing(bool)`: every ListObjectsV2 answers no keys — only the purge lists (the adapter never does), so this neutralizes the purge and nothing else (B-TAG, B-LISTING) | `{ op, bucket, key, addressing, status, storedStatus? }` per request (+ `prefix`, `delimiter`, `emptied` on lists, `deleted` on DeleteObjects); `objects()` = current state |
| `sqs-stub.mjs` | `AmazonSQS.SendMessage` (JSON protocol), real `MD5OfMessageBody` | `{ op, queue, body, deduplicationId, groupId }` |
| `../serving-contract/ddb-stub.mjs` | the renderer table (a per-stub copy of the fixtures; `putItem(item)` = an admin edit, B-TAG / B-LISTING) **and** the tag table: `Query` by `path` on index `revalidate` (plain, and `AND revalidatedAt > :lm`), `Query` by `tag`, `BatchWriteItem` puts; dispatch on `TableName` | `{ table, op, index }` per request; `tagItems()`; tag calls counted in `tagCache`, not `render` |

**S3 addressing: path-style, VERIFIED on every run** — the endpoint is `http://127.0.0.1:<port>`
and the SDK falls back to path-style for an IP host; row `(journals)` asserts every S3 request
was path-style. No `*.localhost` DNS shim is needed.

Increment 1A-2 added what the CACHE-10 purge (`src/app/api/revalidate/route.ts`) emits:
`ListObjectsV2` with `delimiter` (`CommonPrefixes`) and `DeleteObjects`.

## Environment (`harness.mjs` `bundleEnv`)

Constructed, never inherited: `rendererEnv()` (the `next` target's environment) plus:

| Variable | Value | Source |
|---|---|---|
| `NODE_ENV` | `production` | `renderer-hosting.ts:245` |
| `TABLE_NAME` | the fixture table (from `rendererEnv`) | `:246` |
| `API_URL` | `http://127.0.0.1:1` (nothing listens) | `:247` |
| `CACHE_BUCKET_NAME` | `serving-bundle-cache` | `:248` |
| `CACHE_BUCKET_KEY_PREFIX` | `_cache` | `:249` |
| `CACHE_BUCKET_REGION` | `eu-central-1` | `:250` |
| `AMODX_API_KEY_SECRET` | `serving-bundle-unreached-secret` | `:252` |
| `REVALIDATION_SECRET` | `serving-bundle-revalidation-secret` | `:254` |
| `NEXTAUTH_SECRET` | from `rendererEnv` | `:256` |
| `NEXTAUTH_URL` | `https://localhost` (the infra fallback without domain names) | `:257` |
| `REVALIDATION_QUEUE_URL` | `<sqs stub>/000000000000/serving-bundle-revalidation.fifo` | `:259` |
| `REVALIDATION_QUEUE_REGION` | `eu-central-1` | `:260` |
| `CACHE_DYNAMO_TABLE` | `serving-bundle-tag-cache` | `:261` |
| `ORIGIN_VERIFY_SECRET` | `serving-bundle-origin-verify` — **armed** (the `next` target blanks it) | `:263` |
| `RECAPTCHA_SITE_KEY` | `""` from `rendererEnv` (= not configured) | `:265` (optional) |
| `AWS_ENDPOINT_URL_S3`, `_SQS` | the stubs (`_DYNAMODB` comes from `rendererEnv`) | hermetic |
| `AWS_ENDPOINT_URL` | `http://127.0.0.1:1` — every AWS service without a stub (Secrets Manager via `lib/api-client.ts`) fails locally | hermetic |
| `AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE` | a path that does not exist — the operator's `~/.aws/config` could set `ignore_configured_endpoint_urls` and void every endpoint above | hermetic |

The build (`npm run build:open`) runs under `rendererEnv()` with the same `NODE_OPTIONS=--require
no-dotenv.cjs` journal; `(iso3)` asserts the npm root, `open-next build`, `next build`, a
`next build` worker and the Lambda host child all loaded it. `open-next build` runs `npm install
--os=linux --libc=glibc --cpu=arm64 sharp@0.35.5` in a temp directory for the image function
(4.1.9 `build/installDeps.js`, from `imageOptimization.install` in `renderer/open-next.config.ts`;
open-next 3.1.3 used `build.js:287-301` and the `SHARP_VERSION` env) — registry or npm cache; that
is the deploy build itself. 4.x swallows an install failure, so B-SHARP asserts the artefact.

## Version-explicit expectations

Each row resolves its expectation for the bundle's open-next MAJOR from a table
(`BUNDLE_EXPECTATIONS` in `contract.test.mjs`, `EXPECTATIONS` in `bundle.test.mjs`). Keys are
`"3"`, `"4"` or `"3,4"` (identical on both). No key for the built major → the row fails with
`(<row>) no expectation for version N`. `opennext-1b` added the missing `"4"` keys (`c2` —
`"4"` only, its code now resolves `@opennextjs/aws`; `d1`, `h1b`, `h1c`, `h2` — `SAME`, the
4.1.9 bundle emits ONE `Location`), selected B-STALE's with-seed entry by naming it `"4"`
(OPENNEXT1-1250 = A; `4-noseed` stays inert for the ratified fallback), and pinned every 4.x
`record` entry to its OBSERVED 4.1.9 value. Two rows were pinned as deviations from the
pre-filled entry (B-ROUTEERR, B-CASE) and accepted by the operator's review-0 rulings (slice doc § 6a).

## Rows

- The 39 contract rows run unchanged where their entry is `SAME`; the restatements are
  documented at each row and in `docs/slices/opennext-1a.md` § Row inventory.
- `(journals)` — contract file, bundle only: no unhandled stub operation; S3 path-style.
- `bundle.test.mjs`, increment 1: `B-WARM`, `B-ORIGINVERIFY`, `B-VERSION`, `B-SHARP`, `B-NO30D`.
- `bundle.test.mjs`, increment 1A-2 (one Lambda host, file order; dependencies stated at each
  row; fixtures: two isolation tenants `a.serving-contract.test` / `b.serving-contract.test` in
  `../serving-contract/fixtures.mjs`). Results (EXECUTED 2026-10-15; 3.1.3 by `opennext-1a`,
  4.1.9 by `opennext-1b`):

| Row | What | 3.1.3 (`"3"`) | 4.1.9 (`"4"`, OBSERVED) |
|---|---|---|---|
| B-ISO | A and B both publish `/about` | own body per host; one S3 key each, `…/$/<host>/about.cache`; tag `_N_T_/<host>/about` (from the stored `meta.headers` — not sent to the client) | same — keys `_cache/<buildId>/route-cache/APP_PAGE/<sha256>/$/<host>/about.cache` |
| B-REFLECT | host A, path `/<host B>/about` | 307 `?nf=1` (A's handoff), no B text, nothing new under B's key | same (single `Location`) |
| B-TAG | edit A's `/about`, POST `/api/revalidate`, purge neutralized | **characterized**: no tag row, next GET `HIT` with the old text; control (a) purge active → `MISS`, new text | **pass**: 1 tag row `<buildId>/_N_T_/<host>/about`, next GET `MISS`, new text (pre-filled entry) |
| B-LISTING | edit post P, revalidate P, GET A's home (postGrid) | neutralized: 200, ORIGINAL title shown, edit absent; purge active: 200, new title, original gone | same |
| B-XISR | `x-isr` + junk `x-prerender-revalidate` forwarded **for this row only**; no-header requests sent first | **characterized**: `/published` → 307 `MISS` `s-maxage=31536000` stored under key `published`; `/_site/<id>` → same shape (403 skipped) stored under `_site/<id>` | **pass**: identical to the no-header request on both paths (`/published` 200 HIT; `/_site/<id>` 403); nothing stored (pre-filled entry) |
| B-RSC | navigation request (router state tree + Next-computed `_rsc`) | `text/x-component`, `Vary` has `rsc`; `?_rsc=x` without header → HTML `HIT`; bare `RSC: 1` → 307 to `/<host>/published?_rsc` (observed, finding) | navigation as 3; bare `RSC: 1` → 307 to the PUBLIC path `/published?_rsc` (pinned) |
| B-PREVIEW | `/_site/<id>` from `d111wtnnjzzsb1.cloudfront.net` | 200, no-store, `amodx_preview_base`; flight canonical `["","<id>","_dyn"]` | 200, no-store, `amodx_preview_base`; flight canonical `["","_site","<id>"]` — no `_dyn` (pinned; a `_dyn` here is a STOP) |
| B-ROUTEERR | routing throws: (1) XFH with a space; (2) raw invocation with a line feed in `accept-language` | (1) 500 text/plain "Internal Server Error", no `Cache-Control`, nothing stored (Next also fails on that host); (2) the unrewritten path renders: 307 `MISS` cacheable, stored under `routeerr-probe` (spec B2) | **ruled OPENNEXT1B-ROUTEERR-500** (pinned; guarantee: not stored in the ISR cache (edge handling of the 502 not modelled), nothing stored): (1) 502, the handler threw (`Error in routingHandler TypeError: Invalid URL`), nothing stored; (2) 500 `text/plain` "Internal Server Error", Cache-Control containing `no-store`, nothing stored — not Next's `/500` page (spec predicted the `/500` page) |
| B-CASE | mixed-case XFH | packet request (`/tenant/<id>`) → 403, no outbound; reach variant (mixed-case preview host) → **characterized**: one `https.request` to the lowercased host (`isExternal` is case-sensitive), no answer | **ruled OPENNEXT1B-CASE-N17** (pinned): packet request 403, no outbound; reach variant still makes ONE `https.request` to the lowercased host AND gets no answer within 3 s (`REQUEST_TIMEOUT`) — both asserted; live gate E20 (4.1.9 `isExternal` compares the lower-cased URL host with the raw XFH — spec § 7.1 N17; spec § 8.1 predicted no outbound) |
| D3-LOCATION | MISS-rendered not-found | the handler result already holds `/x?nf=1,/x?nf=1` as ONE string; one line on the wire; HIT single | ONE value `/no-such-page?nf=1` at the handler and on the wire; HIT single (pinned) |
| B-STALE | cold container (`restart()`) | `STALE`, `s-maxage=2, stale-while-revalidate=300`, 1 SQS message; control (b): warm → `HIT` | **with seed: cold `HIT`, `s-maxage=31536000`, 0 SQS messages** (pass). Without the seed (negative control): `STALE`, no `Cache-Control`, 1 message |
| B-REVAL | B-STALE's message (fixture `REVALIDATION_MESSAGE_3_1_3` when B-STALE's entry queues none) → revalidation function | HEAD `/<host>/published` with `x-prerender-revalidate` = previewModeId; edge strips it; 307 `MISS`; rule "200 + REVALIDATED" asserted → one batch-item failure | source: fixture (seed branch); HEAD `/<host>/published`, edge strips both headers; host 307 `MISS` → one batch-item failure under the 4.x rule (pinned) |
| B-LEAK | middleware headers in any response | **characterized**: `x-middleware-rewrite` (every rewritten response), `x-middleware-set-cookie` (preview) | **pass**: none in 77 responses (pre-filled entry) |

**Reduced guarantee for `(g4)` (ruling OPENNEXT1A-G4): the bundle suite proves the renderer
behind the edge; the edge security rule is proven by infra (i).** `Origin` / `Sec-Fetch-Site`
are stripped at the edge, so the renderer guard is inert (as in production), and all six `(g4)`
rows pin the status the route then returns to the test's body-less POST: `500` (`Unexpected end
of JSON input`) — a characterized defect (500 where 400 belongs), recorded as a finding in the
slice doc, not fixed here.

**`B-NO30D` claim and its limit (ruling OPENNEXT1A-NO30D):** no cache-directive header of any
suite response carries `2592000`; `Set-Cookie` excluded (the referral cookie's
`Max-Age=2592000`, `src/app/api/ref/route.ts:88`, is a product value, not a cache lifetime).
"Any suite response" = every handler result of the run, edge HTTP and raw IPC invocations
alike (measured: 46 = 42 edge + 4 invoke); the row asserts both kinds are present.
Since increment 1A-2 the record includes B-STALE's STALE response where B-STALE's expectation is
STALE (3.1.3; 4.x `4-noseed`), and the row then asserts a STALE response is in the record, so it
cannot pass on MISS/HIT alone. The 4.x seed branch (`opennext-1b`) has no STALE response; no 4.1.9 STALE emission
of the 300-second window was observed (the `4-noseed` negative control's STALE response carries no
`Cache-Control` at all, so it cannot prove the window); what is proven: `(c2)` checks the installed
source and the guard checks the bundle literals.

**Operation inventory:** printed after each describe (`harness.mjs` `operationInventory`): the
contract rows' stubs and the B-rows' stubs, plus the B-rows host's outbound calls and viewer
requests by method. The B-rows' inventory contains the SQS `SendMessage` (B-STALE), the purge's
`ListObjectsV2` / `DeleteObjects`, and the revalidation HEAD.
