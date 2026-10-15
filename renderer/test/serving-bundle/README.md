# Built-bundle serving harness (`SERVING_TARGET=bundle`)

Slice `opennext-1a` (`docs/slices/opennext-1a.md`; design: `docs/slices/opennext-1-upgrade.md`
§ 8.1). It runs the serving contract against the **real Lambda artefact** — the
`renderer/.open-next/server-functions/default` directory CDK uploads as the RendererServer
function — instead of `next start`. That executes the OpenNext adapter, which the `next`
target never runs: event conversion, routing, middleware, the S3 incremental cache, the
DynamoDB tag cache, the SQS revalidation queue and the response-header rewriting
(`fixISRHeaders`, the cache-8 `swr=300` patch). Built first on open-next 3.1.3, it is the
baseline the `@opennextjs/aws` 4.x upgrade (`opennext-1b`) is diffed against.

```bash
cd renderer && npm run test:serving-bundle
```

Needs the same built workspaces as `npm run test:serving`. No AWS, no credentials. It
**replaces `renderer/.open-next`** (`rm -rf` + `npm run build:open`, exactly as the CDK synth
does) and rebuilds `.next` through `open-next build`. CDK rebuilds `.open-next` itself on every
deploy, so a test build is never what ships.

Measured (2026-10-15, operator Mac, Node 22.21.1): build 13.1 s with no `.next` at all,
5.9–6.8 s with `.next/cache` warm from an earlier build; ≈1 s for the 40 contract rows,
< 1 s for the B-rows. (The spec estimated 60–90 s; the `npm install sharp` step was served
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
| `s3-stub.mjs` | `PutObject`, `GetObject` (404 `NoSuchKey` when absent), `HeadObject`, `DeleteObject`, `ListObjectsV2` (prefix only), on the one bucket `CACHE_BUCKET_NAME`. Path-style and virtual-host style both decoded; `aws-chunked` bodies decoded | `{ op, bucket, key, addressing, status, storedStatus? }` per request; `objects()` = current state |
| `sqs-stub.mjs` | `AmazonSQS.SendMessage` (JSON protocol), real `MD5OfMessageBody` | `{ op, queue, body, deduplicationId, groupId }` |
| `../serving-contract/ddb-stub.mjs` | the renderer table (unchanged) **and** the tag table: `Query` by `path` on index `revalidate` (plain, and `AND revalidatedAt > :lm`), `Query` by `tag`, `BatchWriteItem` puts; dispatch on `TableName` | `{ table, op, index }` per request; `tagItems()`; tag calls counted in `tagCache`, not `render` |

**S3 addressing: path-style, VERIFIED on every run** — the endpoint is `http://127.0.0.1:<port>`
and the SDK falls back to path-style for an IP host; row `(journals)` asserts every S3 request
was path-style. No `*.localhost` DNS shim is needed.

Increment 1A-2 needs, for the CACHE-10 purge (`src/app/api/revalidate/route.ts`):
`ListObjectsV2` with `delimiter` (`CommonPrefixes`) and `DeleteObjects` — both unhandled today.

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
sharp@0.35.5` for the image function (open-next 3.1.3 `build.js:287-301`) — registry or npm
cache; that is the deploy build itself.

## Version-explicit expectations

Each row resolves its expectation for the bundle's open-next MAJOR from a table
(`BUNDLE_EXPECTATIONS` in `contract.test.mjs`, `EXPECTATIONS` in `bundle.test.mjs`). Keys are
`"3"`, `"4"` or `"3,4"` (identical on both). No key for the built major → the row fails with
`(<row>) no expectation for version N`. `opennext-1b` adds the `"4"` keys that are missing
today (`c2`, `d1`, `h1b`, `h1c`, `h2`).

## Rows

- The 39 contract rows run unchanged where their entry is `SAME`; the restatements are
  documented at each row and in `docs/slices/opennext-1a.md` § Row inventory.
- `(journals)` — contract file, bundle only: no unhandled stub operation; S3 path-style.
- `bundle.test.mjs`: `B-WARM`, `B-ORIGINVERIFY`, `B-VERSION`, `B-SHARP`, `B-NO30D`.

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
Increment 1A-1 exercises no STALE response, so the live-handler SWR patch window is NOT yet
proven by this row; B-STALE (1A-2) proves it. The builder's `restart()` probe already observed
`s-maxage=2, stale-while-revalidate=300` on a cold container (slice doc § 5).

**Operation inventory scope:** the increment-1 run makes NO SQS call and has no STALE row; SQS
and `fixISRHeaders` STALE behaviour are increment 1A-2's.
