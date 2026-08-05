# AMODX Caching Architecture

Two-layer cache with debounced on-demand invalidation. No time-based ISR.

---

## Architecture Overview

```
                         LAYER 1                    LAYER 2
User Request ──> CloudFront Edge Cache ──> OpenNext ISR Cache (S3) ──> Server Lambda (SSR)
                      (global PoPs)            (origin region)         (DynamoDB reads)
```

**Layer 1 — CloudFront**: Edge cache at 400+ global points of presence. Cache key is
`X-Forwarded-Host` (tenant isolation) + the RSC content-negotiation header family +
`x-has-session` (one bit, derived from the cookie jar at the edge — anonymous and
authenticated requests must not share an entry) + an **allowlist** of seven query
parameters — see § *Cache Policy (Default Behavior)* for the list and the per-parameter
justification. Serves HTML with sub-50ms latency on hit.

**Layer 2 — OpenNext ISR**: S3-backed cache in the origin region. When CloudFront misses, the request hits the Lambda Function URL. OpenNext checks S3 first. If cached, it returns the S3 object without running React SSR. If not cached, it renders from DynamoDB and writes the result to S3.

**Both layers must be invalidated for content to refresh.** CloudFront invalidation alone is insufficient — OpenNext would still serve stale S3 objects. S3 flush alone is insufficient — CloudFront would still serve stale edge copies.

---

## Serving contract

The invariant the serving layer must satisfy for either cache layer to hold HTML. Stated in
terms of the behaviour measured on `next@16.2.9` (see **Measured serving behaviour** below),
not in terms of the Next.js documentation.

> **This section has an executable form: `renderer/test/serving-contract/`
> (`cd renderer && npm run test:serving`, ROADMAP slice `test-2`).** Every assertion there
> pins one row of this document and cites the section by name. Changing serving behaviour
> means changing both, in the same slice. **Re-measured on `next@16.2.12` (2026-07-28, the
> version `sec-1` bumped to): every row below is unchanged from the 16.2.9 measurements** —
> `s-maxage=31536000` + `x-nextjs-cache: MISS→HIT` on the ISR route,
> `private, no-cache, no-store, max-age=0, must-revalidate` on the twin, `private, no-store`
> on the middleware 404s, no `Cache-Control` header at all on a thrown render, and
> `RSC: 1` still flipping the body to `text/x-component`. The version bump introduced no
> contract drift.

> **A route serves cacheable HTML if and only if BOTH hold:**
> 1. it exports `generateStaticParams()` (returning `[]` is enough — it opts the route into
>    the full-route cache without prerendering anything at build time); **and**
> 2. **no code path reachable in that route** — page body, `generateMetadata`, or any
>    server component it renders, including the shared `[siteId]/layout.tsx` — invokes a
>    Next.js dynamic API (`cookies()`, `headers()`, `await searchParams`, `connection()`,
>    `unstable_noStore`).
>
> Condition 2 is *route-wide, not branch-local*. A dynamic API call in a rarely-taken branch
> does not make that one request dynamic — it returns **HTTP 500** for that request while the
> rest of the route stays cached.

A cacheable route carries a third obligation, because *what* it renders is stored, not just
whether it renders:

> **A cacheable route must never answer "not found" and must never answer a failed read.**
> Both are indistinguishable from a successful render as far as the cache is concerned: a
> `notFound()` is stored with the page's own `s-maxage` (measured), and a swallowed
> DynamoDB error that returns `null` is stored as whatever shell the caller renders for it.
> A not-found must be handed to a non-cacheable route (`lib/not-found-handoff.ts`), and a
> failed read must be allowed to **throw** — a thrown render error is the one outcome ISR
> mode never caches.

Views that genuinely need per-request input (pagination `page`, search `q`, filters,
`checkout-confirm ?id&email`, `checkout-track ?email`, and the `cookies()`-based access
gate for non-`Public` pages) therefore **cannot share a route** with cacheable pages. They
must either live on a separate `force-dynamic` route or read their input client-side.

**Status: satisfied for HTML as of slice `cache-1`.** Two routes render the same body and
`renderer/middleware.ts` picks between them per request:

| | ISR route | dynamic twin |
|---|---|---|
| path | `/<siteId>/<path>` | `/<siteId>/_dyn/<path>` |
| file | `app/[siteId]/[[...slug]]/page.tsx` | `app/[siteId]/%5Fdyn/[[...slug]]/page.tsx` |
| mode | `generateStaticParams() => []`, `revalidate = false` | `dynamic = "force-dynamic"` |
| response | `Cache-Control: s-maxage=31536000` | `private, no-cache, no-store, …` |
| gets | plain published page views | query string **or** NextAuth session cookie **or** `/_site/` preview **or** `/tenant/` test mode |

The same split exists for the legacy by-ID product route (`products/[productId]` +
`%5Fdyn/products/[productId]`). The render body lives once, in
`renderer/src/components/SitePage.tsx` and `ProductByIdPage.tsx`; the four route files are
thin shells that pass `{ preview, basePath, sessionToken, query, cacheable }` as plain
props. The cacheable shells pass `false / "" / null / {} / true`.

`/_dyn` is an internal rewrite target: middleware answers a `/_dyn…` URL arriving from the
wire with `404` + `private, no-store`, so there is no second public URL serving the same
tenant content uncached.

### How a 404 stays out of the cache

Two paths, because they are answerable at different points (ratified 2026-07-26, `cache-1`
§Ratified resolutions D3 — "accept cached genuine 404s" was explicitly rejected).

| Case | Answered by | Client sees |
|---|---|---|
| host with no tenant record | `middleware.ts` + `lib/tenant-directory.ts`, before any render | `404` + `private, no-store` |
| known tenant, missing page / unpublished / disabled commerce | ISR route redirects to its own URL + `?nf=1`; middleware routes any query string to the twin, which renders the 404 | `307` (cacheable) → `404` + `private, no-store` |
| host gate says "wired", tenant record already gone (the TTL transition) | falls into row 2: `layout.tsx` renders `children` bare, and the page's own lookup drives the handoff | `307` (cacheable) → `404` + `private, no-store` |

Row 3 is why `app/[siteId]/layout.tsx` may not answer the 404 itself. A layout is shared by
the ISR route and the twin and receives only `{ siteId }` — it knows neither the rendering
mode nor the requested path, so it can pick neither mechanism nor build the handoff's
`Location`. It renders `children` bare and lets `SitePage` / `ProductByIdPage`, which repeat
the same `getTenantConfig()` lookup and know both facts, decide. (It must actually render
`children`: a layout that returns early never invokes the page function at all — that is how
the old HTTP-200 "Site Not Found" shell suppressed the page's own `notFound()`.)

- **The host gate** repeats the `GSI_Domain` lookup `getTenantConfig()` already performs,
  as a `Select: COUNT` query, behind a 60-second per-instance in-memory cache of the
  verdict (positive and negative), bounded at 512 hosts because `Host` is
  attacker-controlled. It **fails open**: a lookup error or a missing table renders as
  before rather than 404-ing every tenant at once. Measured: 1 DynamoDB call on the first
  request for a host, 0 for the rest of the TTL — the ISR-hit path stays at **zero**
  DynamoDB reads.
- **The `?nf=1` handoff** needs no middleware rule of its own: "any query string goes to
  the twin" already existed. It costs a cached 307 plus a dynamic render for every 404, so
  scanner traffic is no longer absorbed at the edge — the accepted price of never pinning
  a 404 for a URL that gets published later. It also re-reads, which turns a swallowed
  DynamoDB error on a real page from a year-long cached 404 into a retry.

### Failed reads throw — enforced repo-wide in the renderer

Ratified 2026-07-26 (human decision **CACHE-1-D4**), after review found the rule was
implemented for `getTenantConfig()` only.

**Every read helper in `renderer/src/lib/dynamo.ts` lets AWS/SDK errors propagate, and so
does `app/api/posts/route.ts`.** A `null` or empty return from any of them means one thing:
the record genuinely is not there. Not one of them catches an operational failure. This is
not a `getTenantConfig()` rule, not a "`lib/dynamo.ts` only" rule and not a "cacheable routes
only" rule — dual read semantics were explicitly rejected, so there is no render-mode
parameter and no strict/lenient variant to pick between.

**A missing `TABLE_NAME` counts as an operational failure**, not as an empty site. Every
helper resolves the table through one function, `requireTableName()`, which throws; there is
no per-helper guard, no `NEXT_PUBLIC_TABLE_NAME` fallback and no `"amodx-table"` default
(`hasActivePopups()` had both). The earlier version of this section argued the opposite — that
it is "a configuration predicate evaluated before any I/O, not a read failure" — and review
rejected the distinction: a renderer that cannot name its table cannot answer *does this
record exist?*, so it must not answer *no*. The cause being non-transient makes it worse, not
exempt: one unset environment variable would have rendered, and then pinned for a year, a
not-found shell for all 99 tenants. Config is validated **before** any legitimate empty-input
short-circuit (e.g. `searchProducts()`'s blank-query early return), so a misconfiguration can
never hide behind an empty-looking result. Measured, § *Probe: a missing `TABLE_NAME`, and
`/api/posts`*.

Why it had to widen: a failure *after* tenant resolution is the dangerous one, because the
tenant lookup succeeds and the render then proceeds with fabricated absence. Measured, on
the pre-D4 build, with the tenant lookup healthy and every downstream read failing:

| Request | Pre-D4 (swallowing) | Post-D4 (propagating) |
|---|---|---|
| existing page `/d4-page` | `307 → ?nf=1`, `s-maxage=31536000`, **stored** | `500`, no `Cache-Control`, **not stored** |
| existing legacy product | `307 → ?nf=1`, `s-maxage=31536000`, **stored** | `500`, no `Cache-Control`, **not stored** |
| `sitemap.xml` | `200` + `s-maxage=3600` listing **zero pages** | `500`, no `Cache-Control` |
| `openai-feed` | `200` + `s-maxage=900` with **zero products** | `500`, no `Cache-Control` |
| same page once reads recover | still `307`, served `x-nextjs-cache: HIT` | `200` `MISS` → `HIT`, caches normally |

The last row is the one that matters. Pre-D4 the blip did not merely degrade the request in
flight — the artefact it produced **outlived the blip**. A page that exists and is published
kept answering a redirect from cache after DynamoDB was healthy again, and a search engine
kept being told the site had no pages, until someone ran an invalidation. The `?nf=1`
handoff's self-healing property does not rescue this case: it heals the *visitor* who
follows the redirect, but the canonical URL stays pinned to the 307.

**Accepted consequence (ratified):** during an active AWS failure the dynamic twin and the
`/api/*` routes answer HTTP 500 rather than rendering a silently-empty section. Availability
is traded for not writing durable incorrect content. An uncached 500 self-heals on the next
request; a cached wrong page does not.

The claim that **`/api/*` answers 5xx rather than fabricating absence** is now true of every
route under `renderer/src/app/api/`, verified by reading all nine
(`account/orders`, `comments`, `consent`, `contact`, `leads`, `posts`, `profile`,
`ref`, `revalidate`; `auth/[...nextauth]` is NextAuth's own handler). `ref` is the
attribution beacon added by `cache-3`; it is a write, not a read, has no absence to
fabricate, and answers `204` unconditionally. Of the eight read/proxy routes, seven already returned
`{ error }` + 4xx/5xx. `posts` was the exception — a DynamoDB failure or a missing
`TABLE_NAME` returned HTTP `200 {"items": []}`, which the `postGrid` block renders as *this
site has no posts*. It now answers `500`; a missing `x-tenant-id` header answers `400`.
`{"items": []}` is reserved for a query that succeeded and matched nothing.
`PostGridRender.tsx` already renders an error state for a non-2xx response, so the failure is
visible instead of silently plausible. The earlier text here exempted this route because
`/api/*` is never cached; review rejected that too — D4 is a repo-wide rule about not
inventing absence, and the cache is its motivation, not its boundary.

Two read paths outside `lib/dynamo.ts` keep different internals on purpose:

- **`lib/tenant-directory.ts`** (middleware host gate) fails **open**. It runs before the
  render, and a blip there must degrade to "render it", not to "404 every tenant at once".
  The render then repeats the same lookup and throws, so the failure still surfaces — one
  layer later, as an uncached 500. Its own missing-`TABLE_NAME` branch returns `null` for the
  same reason: null means *unknown*, and the caller's documented response to unknown is to
  let the request through to the render, which then fails loudly.
- **`lib/api-client.ts`** (Secrets Manager) returns `""` on failure. Its callers forward the
  empty key to the backend, the backend rejects the request, and the route returns that
  non-2xx status (`{ error: "Backend Failed" }, { status: res.status }`) or 500 from its
  catch — so a Secrets Manager failure still never produces a 200 carrying empty data, which
  is the property D4 is about. It is reached only from `/api/*` handlers; basis for that
  claim: grep over `renderer/src` for `getRendererKey|getMasterKey` returns callers in
  `app/api/{comments,consent,contact,leads,profile}/route.ts` only — none under
  `app/[siteId]/` or `components/`. Making the empty-key case fail earlier and more loudly is
  a candidate cleanup, not a cache correctness issue.

The hazard that gated the deploy (**H1**, the `RSC` cache key) is closed in `cache-3` — see
**Open hazards activated by cache-1** below for the before/after. Nothing in the track is
deployed yet; deploy order is `cache-3` → `cache-1` + `cache-2`.

---

## Cache Lifecycle

### Page Generation (Cold)

```
User ──> CloudFront (MISS) ──> Lambda Function URL
                                   │
                                   ├── OpenNext checks S3 cache (MISS)
                                   ├── React SSR: reads DynamoDB, renders HTML
                                   ├── Writes HTML to S3 (_cache/ prefix)
                                   ├── Returns response with Cache-Control headers
                                   │
CloudFront stores response <────────┘
User receives HTML
```

### Page Serving (Warm)

```
User ──> CloudFront (HIT) ──> Return cached HTML (< 50ms, no Lambda invocation)
```

### Content Mutation (Admin Edit)

```
Admin saves page ──> Backend Lambda (content/update.ts)
                         │
                         ├── Write to DynamoDB
                         │
                         ├── revalidatePath() ──> POST /api/revalidate
                         │                            │
                         │                            └── Next.js revalidatePath()
                         │                                └── Invalidates S3 ISR cache (Layer 2)
                         │
                         └── withInvalidation() HOF
                              └── DynamoDB PutItem: SYSTEM#CDN_PENDING marker
                                   └── Debounce flush Lambda picks it up after 15 min
                                        └── CloudFront /* invalidation (Layer 1)
```

### Debounced Invalidation Flow

```
Mutation 1 (10:00) ──> Writes SYSTEM#CDN_PENDING { updatedAt: 10:00 }
Mutation 2 (10:03) ──> Overwrites marker { updatedAt: 10:03 }    ← timer resets
Mutation 3 (10:08) ──> Overwrites marker { updatedAt: 10:08 }    ← timer resets
                       ... admin stops editing ...
10:23 ──> Debounce Lambda reads marker, 10:08 + 15min = 10:23 → EXPIRED
          ├── CloudFront /* invalidation submitted
          └── Marker deleted (conditional on updatedAt match)
```

### Admin "GO LIVE NOW"

```
Admin clicks button ──> POST /system/invalidation
                             │
                             ├── CloudFront /* invalidation (immediate)
                             └── Delete SYSTEM#CDN_PENDING marker
                                  └── Banner disappears
```

---

## ISR Configuration

```typescript
// renderer/src/app/[siteId]/layout.tsx
export const revalidate = false;

// renderer/src/app/[siteId]/[[...slug]]/page.tsx
// renderer/src/app/[siteId]/products/[productId]/page.tsx
export const revalidate = false;
export function generateStaticParams() { return []; }   // opts into the full-route cache

// renderer/src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx
// renderer/src/app/[siteId]/%5Fdyn/products/[productId]/page.tsx
export const dynamic = "force-dynamic";                  // never cached, by design
```

`revalidate = false` tells Next.js/OpenNext: cache forever, never revalidate on a timer. Pages are only regenerated when explicitly invalidated via `revalidatePath()` or `revalidateTag()`.

When a route is *eligible* for the full-route cache, Next emits `Cache-Control: s-maxage=31536000` and CloudFront's cache policy (`defaultTtl: 0`) respects the origin's `s-maxage` — effectively caching for 1 year or until invalidated.

> ⚠️ **`revalidate = false` is necessary but NOT sufficient.** It only takes effect on a
> route already in ISR mode. Before slice `cache-1` no HTML route was, so every HTML response
> was `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` and both cache
> layers were inert. `generateStaticParams()` is what puts the route in ISR mode; keep both.
> The section below is the reproducible evidence and the actual rule Next.js enforces.

---

## Measured serving behaviour (Next 16.2.9)

Everything in this section was measured against this repo's `next@16.2.9` / React 19 build by
running `npx next build` + `npx next start` and reading the response headers. **Do not reason
about this from the Next.js docs — the docs describe a graceful dynamic bail-out that this
version does not perform.**

How to reproduce without touching staging: the renderer talks to DynamoDB through the AWS SDK
v3, which honours `AWS_ENDPOINT_URL_DYNAMODB`. Point it at a local stub that answers the
`GetItem`/`Query` shapes in `renderer/src/lib/dynamo.ts` (a tenant record on `GSI_Domain`, a
`ROUTE#/` item, a `CONTENT#…#LATEST` item), then:

```bash
cd renderer && npx next build
TABLE_NAME=probe-table AWS_REGION=eu-central-1 \
AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8123 \
ORIGIN_VERIFY_SECRET= NEXT_PUBLIC_API_URL= npx next start -p 3111
curl -sD- -o /dev/null -H 'Host: <fixture-domain>' http://127.0.0.1:3111/   # twice
```

`ORIGIN_VERIFY_SECRET=` disables the middleware origin check locally; `NEXT_PUBLIC_API_URL=`
keeps `hasActivePopups()` from firing. Read `Cache-Control` and `x-nextjs-cache`. The stub and
probe scripts used for the `cache-1` runs are kept with that slice's build report
(`.agent-manager/slices/CACHE-1/probe-harness/`, port 8123): a DynamoDB stub whose control
plane can delete the tenant record mid-run, fail every call, or fail only the reads that
happen *after* tenant resolution (`/__ctl/fail-content-on` — the D4 case); an S3 stub for the
OpenNext incremental cache; the header matrix (`probe.sh`); the host-verdict-transition probe
(`probe-transition.sh`); the failed-read probe (`probe-failed-read.sh`); the
missing-`TABLE_NAME` / `/api/posts` probe (`probe-config-and-api.sh`, which starts and stops
its own server on port 3112); and an API-Gateway-v2 driver for the built Lambda
(`opennext-drive.mjs`).

**This recipe is now committed as a suite** — ROADMAP slice `test-2`,
`renderer/test/serving-contract/` (`cd renderer && npm run test:serving`). It rebuilds the
renderer, boots `next start` on an ephemeral port against an in-process DynamoDB stub, and
asserts 16 of the rows below (plus four harness self-checks), each test named after the row it
pins. The stub offers the same *fault injection* as the `cache-1` harness above — a read
failure that spares tenant resolution — but as a plain method, `failContentReads(true)`, not
over HTTP: the stub and the assertions share one process there, so the `/__ctl/…` plane has
no caller. Credential-free, ≈9 s, and a CI job (`ci.yml` → `serving-contract`).
**A failing test there is a contract change, not a flaky test**: update
this document and the suite in the same slice (`docs/testing-strategy.md` § Invariants).
What it does *not* cover, deliberately: anything at the edge (the cache key, `RSC`,
`x-has-session` — those are `cdk synth` assertions, slice `test-4`) and the OpenNext Lambda
bundle (`cache-1` re-measured every row through it; a committed harness is a separate slice).
The one-off probe scripts above remain the record of how the rows were first measured.

One difference from the ad-hoc recipe above, and it matters if you copy either: the committed
suite gives its child processes a **constructed** environment rather than an inherited one,
and hides `renderer/.env*` from them. The ad-hoc `npx next start` line inherits the shell and
lets Next merge `.env.local` — measured 2026-07-28, that pulled the operator's real
`AMODX_API_KEY` and `API_URL` into the process. Harmless when you are probing by hand and
know it; not acceptable in a committed gate, where it would mean the suite could pass because
of a credential a fork's CI does not have.

The hiding mechanism travels in **`NODE_OPTIONS`**, because `next build` is a process *tree*:
it forks build/export workers that call `@next/env#loadEnvConfig` themselves, and
`next/dist/lib/worker.js` gives jest-worker an explicit `forkOptions.execArgv`, which drops
the parent's argv flags while still inheriting the environment. Measured 2026-07-28 on this
repo, a real build covers **14 processes**; with the hook removed the build announces
`- Environments: .env.local` in its own output. Assertions `(iso1)`–`(iso4)` in
`renderer/test/serving-contract/contract.test.mjs` keep all of that honest — `(iso3)` reads
the hook's per-process journal back out of the real build/boot and also asserts Next's own
first-party `- Environments:` report is absent. Details and the measured matrices:
`renderer/test/serving-contract/README.md` § *Credential-free* and `no-dotenv.cjs` § DELIVERY.

The OpenNext driver needs a **local** S3 endpoint. Without one the bundle's incremental cache
talks to real AWS S3 (observed once during the `cache-1` run: `InvalidAccessKeyId`, HTTP 403,
nothing written). Set `AWS_ENDPOINT_URL_S3` to a stub before driving the handler; macOS
resolves `*.localhost`, so a virtual-host-style endpoint such as `http://s3.localhost:8124`
works without path-style configuration.

The middleware host gate needs the same stub plus explicit credentials in the environment —
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are what `lib/tenant-directory.ts` hands to its
client, because the edge runtime has no default credential provider chain (measured: without
them every SDK call in middleware fails with `Error: Credential is missing`; `process.env`
itself *is* fully readable there — 143 keys under `next start`).

### The rule Next.js actually enforces

A route is in exactly one of two rendering modes, decided at build time. There is no
per-request middle ground.

| | **ISR / full-route cache mode** | **Dynamic mode** |
|---|---|---|
| Entered when | the route exports `generateStaticParams()` (even returning `[]`), or has no dynamic segments at all | any route with a dynamic segment and no `generateStaticParams()` |
| `Cache-Control` | `s-maxage=31536000` | `private, no-cache, no-store, max-age=0, must-revalidate` |
| `x-nextjs-cache` | `MISS` on first render, `HIT` after | header absent |
| Dynamic API (`await searchParams`, `cookies()`, `headers()`) anywhere in the render | **HTTP 500** — `DynamicServerError` is *not* caught and converted to a dynamic render | fine |
| Stored by OpenNext S3 (Layer 2) / CloudFront (Layer 1) | yes | no |

### Measured probe matrix

| Probe route | Build marker | Response |
|---|---|---|
| `/probe-plain` (no dynamic segment) | `○` | `s-maxage=31536000`, `x-nextjs-cache: HIT` |
| `/[id]` + `generateStaticParams()` → `[{id:"known"}]`, request `/known` | `●` | `s-maxage=31536000`, `HIT` |
| `/[id]` + `generateStaticParams()` → `[{id:"known"}]`, request `/UNKNOWN` | `●` | `s-maxage=31536000`, `MISS` then `HIT` (on-demand ISR) |
| `[siteId]/[[...slug]]` + `generateStaticParams()` → `[]` | `●` (zero children prerendered) | `s-maxage=31536000`, `MISS` then `HIT`; per-param cache entries are distinct |
| `/[id]`, **no** `generateStaticParams()`, zero dynamic APIs | `ƒ` | `no-store` — **never cached** |
| `/[id]`, **no** `generateStaticParams()`, `await searchParams` | `ƒ` | `no-store` |
| `[siteId]/[[...slug]]` + `generateStaticParams()` → `[]`, branch does `await searchParams` | `●` | **HTTP 500** on that branch; the static branches still serve `s-maxage` |
| `[siteId]/[[...slug]]` + `generateStaticParams()` → `[]`, branch calls `cookies()` | `●` | **HTTP 500** on that branch |
| `/[id]` + `generateStaticParams()` → `[]` + `dynamic = "force-static"` + `await searchParams` | `○` | `s-maxage=31536000`, but `searchParams` is silently `{}` |

The 500's message, recovered by catching and re-throwing inside the probe:

```
Dynamic server usage: Route /static/probe-mixed/[siteId]/[[...slug]] couldn't be rendered
statically because it used ``await searchParams`, `searchParams.then`, or similar`.
```

### Which render outcomes are cacheable (measured 2026-07-26, `cache-1` build run)

Probe route in ISR mode (`generateStaticParams() => []`, `revalidate = false`), one branch
per outcome, served by `next build` + `next start`:

| Render outcome | Status | `Cache-Control` | `x-nextjs-cache` | Stored? |
|---|---|---|---|---|
| normal render | 200 | `s-maxage=31536000` | MISS → HIT | yes |
| `notFound()` | 404 | `s-maxage=31536000` | MISS → HIT | **yes** |
| `redirect()` | 307 | `s-maxage=31536000` | MISS → HIT | **yes** |
| `throw new Error(...)` | 500 | *header absent* | absent | no |

**A route in ISR mode has exactly one non-cacheable outcome: a thrown render error.** There
is no API for "render this one response with `no-store`" — the dynamic APIs that would
normally force that are themselves a hard 500 in this mode. Any requirement of the form
"make outcome X non-cacheable" therefore has to be met by routing X to a different route, by
CloudFront/CDN policy, or not at all.

### The `RSC` request header changes the response body — and was not in the cache key

Measured against the real `[siteId]/[[...slug]]` route, same URL, same tenant:

| Request | `Content-Type` | Body | `Cache-Control` |
|---|---|---|---|
| plain | `text/html` | HTML document | `s-maxage=31536000` |
| `RSC: 1` | `text/x-component` | React flight payload | `s-maxage=31536000` |
| `Next-Router-Prefetch: 1` | `text/html` | HTML document | `s-maxage=31536000` |
| `Next-Router-State-Tree: …` | `text/html` | HTML document | `s-maxage=31536000` |
| `Accept: text/x-component` | `text/html` | HTML document | `s-maxage=31536000` |

Only the `RSC` header flips the body (case-insensitively). The origin is behaving correctly —
Next stores both variants under one ISR entry and content-negotiates on the way out, and it
advertises `Vary: rsc, next-router-state-tree, next-router-prefetch,
next-router-segment-prefetch, Accept-Encoding`.

The problem was downstream: until `cache-3`, `RendererCachePolicy`
(`infra/lib/renderer-hosting.ts`) allowlisted **only `X-Forwarded-Host`** as a cache-key
header, and CloudFront does not key on origin `Vary`. **Closed in `cache-3`** — the four
`Vary` headers are now in the key. See **Open hazards** below for the full H1 write-up.

Next's own client never hit this, because `fetch-server-response.js` always calls
`setCacheBustingSearchParam()`, appending `?_rsc=<hash>` to every prefetch and client
navigation (`node_modules/next/dist/client/components/router-reducer/`). Under the old
`queryStringBehavior: all()` that gave real RSC traffic its own cache entry. Note also that
Next strips `_rsc` before middleware sees the URL, so `request.nextUrl.search` is empty for
those requests and they land on the **ISR** route, not the dynamic twin — verified: an
`?_rsc=…` request returns `x-nextjs-cache: HIT`.

`cache-3` inverts which of the two mechanisms carries the discrimination: the header is in
the key and `_rsc` is not, so prefetches for one URL share one entry instead of one per
hash. Measured that this is body-safe — `?_rsc=<hash>` alone returns `text/html`, and only
the `RSC` header returns `text/x-component`. See § *Cache Policy (Default Behavior)*.

### Three consequences that constrain any future cache work

1. **The `ƒ` build marker is not a defect signal.** A route with an un-enumerated dynamic
   segment is marked `ƒ (Dynamic)` whether or not it touches a dynamic API. `ƒ` vs `●`
   tells you the *mode*, not whether the code is clean. The only trustworthy check is the
   `Cache-Control` / `x-nextjs-cache` headers of a served response.

2. **"Push the dynamic reads down into the branches that need them" does not work.** Once
   a route is in ISR mode, a dynamic API call in *any* branch is a hard 500 for that
   branch, not a per-request downgrade. Mixed static/dynamic behaviour on one route
   requires Next 16's `cacheComponents` (the renamed `dynamicIO`/PPR — present in the
   16.2.9 config schema) with `<Suspense>` boundaries, which `open-next@3.1.3` does not
   support. Otherwise the dynamic views must live on a *separate route*.

3. **`notFound()` responses are cached too.** In ISR mode a `notFound()` render returns
   HTTP 404 with `s-maxage=31536000`. A cacheable route therefore may not call
   `notFound()` at all — it has to route the outcome to a route that can answer
   `no-store`. See § *How a 404 stays out of the cache* for the two mechanisms
   (`cache-1` closed this; H2 below records the before/after).

---

## Open hazards activated by cache-1

All three were invisible before `cache-1`, because nothing was cached. All three became live
behaviours of the serving layer the moment it started caching.

- **H1 is CLOSED in `cache-3`** (CloudFront cache-policy header allowlist). It gated the
  whole track's deploy: `cache-1` was not deployable while it was open.
- **H2 is CLOSED inside `cache-1`** (middleware host gate + `?nf=1` handoff). It is kept
  here, with its before/after measurements, because the "before" row is what the code
  actually did in production until this slice.
- **H3 is CLOSED in `cache-3` revision 3** (`x-has-session` in the cache key). Found in
  review of `cache-3` revision 2, not in the original audit — the cache key was blind to the
  session cookie, so a warm anonymous entry was served to logged-in visitors.

All three are kept with their measurements. **No fix is deployed yet** — the whole CACHE
track is uncommitted-to-production as of 2026-07-27; see `CURRENT_SLICE.md` for deploy order.

**Two further defects, D1 and D2, are recorded in the NEXT section, not this one.** They were
found by live probing in `cache-6` and they are a different class: neither was activated by
`cache-1`, neither is a cache-key defect, and both were already broken in production before
this track began. Keeping this section's title honest is why they are not filed as "H4/H5"
here — see § *Transport defects — CloudFront deletes a required request field*.

### H1 — the `RSC` header was not in the CloudFront cache key — CLOSED in `cache-3` (was: high)

**State before the fix:** `RendererCachePolicy` keyed on path + all query strings +
`X-Forwarded-Host`. The `RSC` request header was not in the key, but it changes the response
body from an HTML document to a React flight payload (measured above). CloudFront stores
whichever variant it saw first under the bare URL and serves it to everyone.

Normal traffic did not trigger it (Next's client always adds `?_rsc=<hash>`, which *was* in
the key). But **any client can send `RSC: 1` with no query string** — one `curl` — and pin a
`text/x-component` payload at the edge under the page's own URL. Every subsequent visitor
gets raw flight text instead of the page, until the next invalidation (≤15 min via the
debounce marker if some mutation happens, ≤24 h via the nightly flush, otherwise 1 year).

This is availability/defacement, per tenant, not a data-disclosure vector: the flight payload
is the same public content, and no per-visitor state reaches a cacheable render — the
cacheable route passes `sessionToken: null` literally, so there is no per-visitor state for
it to store. (Do **not** restate this as "session requests go to the dynamic twin". That is
a middleware property and middleware only runs on a miss; the reason it is *also* true at
the edge is H3's `x-has-session`, below.)

**State after the fix (`cache-3`):** `RSC`, `Next-Router-Prefetch`, `Next-Router-State-Tree`
and `Next-Router-Segment-Prefetch` are in `RendererCachePolicy`'s header allowlist, matching
the origin's own `Vary`, so the HTML and flight variants occupy separate cache entries and
neither can displace the other. Re-measured on the `cache-3` build that the premise still
holds on this Next version — `RSC: 1` flips the content type at the same URL, the other
three do not — see the probe table in § *Cache Policy (Default Behavior)*.

`cache-3` also removed `_rsc` from the query-string key, so the header is now the *only*
discriminator rather than one of two. That is what makes the fix load-bearing instead of
belt-and-braces, and it is why the post-deploy RSC probe is mandatory, not optional:

```bash
# Both must be run against a WARM url. Expect text/html, then text/x-component,
# then text/html again — the third request proves the flight payload did not displace
# the HTML entry, which is the exact H1 failure.
curl -sI https://<tenant-domain>/<page> | grep -i 'content-type\|x-cache'
curl -sI -H 'RSC: 1' https://<tenant-domain>/<page> | grep -i 'content-type\|x-cache'
curl -sI https://<tenant-domain>/<page> | grep -i 'content-type\|x-cache'
```

### H2 — not-found responses are cacheable — CLOSED in `cache-1` (was: medium)

**State before the fix**, measured on the real routes:

| Request | Response | Cached? |
|---|---|---|
| known tenant, missing page | `404` + `s-maxage=31536000` | yes, MISS → HIT |
| **unknown tenant / not-yet-wired host** | **`200`** + `s-maxage=31536000`, "Site Not Found" shell | yes, MISS → HIT |

The second row was also a correctness defect independent of caching: `app/[siteId]/layout.tsx`
returned the "Site Not Found" body **with HTTP 200** and without rendering `children` — which
is why the page's own `notFound()` never ran (an unrendered child element is never evaluated).
An indexable soft 404, cacheable by any intermediary.

**State after the fix** (ratified 2026-07-26; mechanism and cost in § *How a 404 stays out of
the cache*), measured `next build` + `next start` **and** re-measured against the built
OpenNext Lambda bundle:

| Request | Response | Cached? |
|---|---|---|
| known tenant, missing page | `307` → `/path?nf=1`, then `404` + `private, no-cache, no-store` | the 307 is; the 404 is not |
| unknown tenant / not-yet-wired host | `404` + `private, no-store`, from middleware, no render | no |
| `/tenant/<bad-id>`, `/_site/<bad-id>` | `404` + `private, no-cache, no-store` | no |
| DynamoDB unreachable on an uncached page | `500`, **no `Cache-Control` header at all** | no |

**The host-verdict transition** (positive verdict still warm, tenant record already gone) is
the one path that reaches the render with no tenant. It is handled, not accepted:
`app/[siteId]/layout.tsx` renders `children` bare instead of answering the 404 itself, and
the page below (`SitePage` / `ProductByIdPage`) repeats the lookup and routes the `null`
through `notFoundOrHandoff()`. So the transition takes the same `307 → ?nf=1 → twin → 404 +
no-store` path as any other missing page. Measured — see § *Probe: the host-verdict
transition*.

> Why the layout may not just call `notFound()`: it is shared by the ISR route and the twin
> and receives only `{ siteId }`, so it knows neither the rendering mode nor the requested
> path — it can pick neither the right mechanism nor the handoff's `Location`. On the ISR
> route a bare `notFound()` there is stored with the page's own `s-maxage`. **That storage is
> not bounded by the host gate's 60-second TTL**: the TTL bounds how long the *gate* keeps
> letting requests through, while a single 404 that reaches the ISR cache lives there until
> an invalidation — up to the nightly flush, or a year absent any mutation. An earlier
> version of this section claimed the TTL bounded it. That was wrong; the two are unrelated
> clocks.

Historical note on the exposure that made this urgent: `withInvalidation()` wraps
`tenant/create` and `tenant/settings` (verified by grep over `backend/src`), so wiring a
domain fires a debounced CloudFront `/*` invalidation (≤15 min) and sets `CDN_LAST_CHANGE`,
un-gating the nightly S3 flush (≤24 h). The "pinned for a year" case needed a domain to start
resolving with no tenant mutation at all — realistic exposure ≤24 h. Not zero, and the fix
does not depend on invalidation timing at all.

#### Probe: the host-verdict transition (EXECUTED 2026-07-26)

The one sequence that reaches a render with no tenant, measured end to end. Setup: an
in-memory DynamoDB stub whose control plane can delete the `TENANT#` record mid-run, and a
counter that distinguishes the middleware host gate's `Select: COUNT` query from the
renderer's own reads.

| Step | Observation |
|---|---|
| warm the host verdict, then delete the `TENANT#` record | — |
| request a fresh, uncached path on the ISR route | `307` → `/<path>?nf=1`, `x-nextjs-cache: MISS`, `s-maxage=31536000` |
| host-gate DynamoDB queries during that request | **0** — the verdict was still warm, i.e. this really is the transition case and not the gate re-reading |
| follow the redirect | `404` + `private, no-cache, no-store, max-age=0, must-revalidate` |
| every ISR entry on disk for that host afterwards | `published → 200`, `transition-probe → 307`, `transition-warmup → 307`; **grep for a stored `404`: none** |
| an already-cached page during the same window | still `200` + `x-nextjs-cache: HIT`, **0 DynamoDB calls** — a vanished tenant does not invalidate what is already cached |
| restore the record, re-request | the stored `307` still fires, the twin re-reads, and a path that exists now answers `200` — the cached artefact is **self-healing** |
| DynamoDB unreachable, uncached page | `500` with **no `Cache-Control` header at all**, and no ISR entry written |

Re-measured through the built OpenNext Lambda (synthetic API Gateway v2 events, local S3
stub): identical statuses and headers, and the S3 access log shows the transition path stored
as `{"status":307, "location":"/<path>?nf=1"}` under
`_cache/<buildId>/<host>/<path>.cache` — with **no S3 access at all** for any twin request
(`?page=2`, `?preview=true`, session cookie, `?nf=1`, `/_dyn`, unknown host).

#### Probe: a read that fails AFTER tenant resolution (EXECUTED 2026-07-26, D4)

The transition probe's last row fails the *first* lookup, so `getTenantConfig()` throws and
no other helper ever runs. This probe is the complement: the tenant lookup stays healthy and
every downstream read fails (`/__ctl/fail-content-on`). It is the case the D4 decision
exists for, and it was measured **twice — once against the pre-D4 build and once against the
current one** — so the "what this fixes" claim is observed, not argued. Script:
`probe-harness/probe-failed-read.sh`; results in the table under § *Failed reads throw*.

| Step | Pre-D4 build | Current build |
|---|---|---|
| control: healthy read, fresh path | `200`, `MISS`, `s-maxage=31536000`, entry stored | identical |
| existing page, read fails | `307` + `s-maxage=31536000`, ISR entry stored with `status=307` | `500`, **no `Cache-Control`**, **no ISR entry** |
| `sitemap.xml`, read fails | `200` + `s-maxage=3600`, zero URLs | `500`, no `Cache-Control` |
| `openai-feed`, read fails | `200` + `s-maxage=900`, zero products | `500`, no `Cache-Control` |
| already-cached page during the failure | `200` + `HIT` (untouched) | `200` + `HIT` (untouched) |
| reads recover, same path | still `307`, `x-nextjs-cache: **HIT**` — pinned | `200` `MISS` → `HIT`, caches normally |
| grep the ISR cache for a stored `500` | n/a | none |

Re-measured through the built OpenNext Lambda: failed read → `500` with no `Cache-Control`,
and the S3 access log for that key shows a `GET → MISS` and **no `PUT`**; after recovery the
same key shows `GET → MISS` followed by `PUT`. So the "never stored" property holds through
the real deployment artefact, not just `next start`.

#### Probe: a missing `TABLE_NAME`, and `/api/posts` (EXECUTED 2026-07-26, review-1)

Script: `probe-harness/probe-config-and-api.sh`. It starts its own `next start` three times,
because `TABLE_NAME` is process-level env. The "unset" case is probed by passing an **empty**
value: `next start` loads `.env.local` and Next only fills keys that are `undefined`, so an
empty string is the only way to guarantee the guard sees a falsy value regardless of the
local env file. `requireTableName()` treats `""` and unset identically (`if (!table)`).

| Step | Pre-fix behaviour | Measured now |
|---|---|---|
| `/api/posts`, healthy | `200` + items | `200` + items (unchanged) |
| `/api/posts`, post-tenant read fails | `200` `{"items":[]}` | `500` `{"error":"Posts are unavailable"}` |
| `/api/posts`, no `x-tenant-id` | `200` `{"items":[]}` | `400` `{"error":"x-tenant-id header is required"}` |
| `/api/posts`, no `TABLE_NAME` | `200` `{"items":[]}` | `500` |
| existing published page, no `TABLE_NAME` | renderable, **storable** answer | `500`, no `Cache-Control`, **no ISR entry** |
| non-existent page, no `TABLE_NAME` | not-found handoff (a config error dressed as a 404) | `500` — config error, not a 404 |
| `sitemap.xml`, no `TABLE_NAME` | `200` + `s-maxage=3600`, zero URLs | `500`, no `Cache-Control` |
| whole ISR directory for the host after that phase | — | does not exist: nothing was written |
| `TABLE_NAME` restored, same page | — | `200` `MISS` → `HIT`, `s-maxage=31536000` |
| render with popups enabled, `TABLE_NAME` set | could address `"amodx-table"` | `200`; stub reports the **only** `TableName` addressed is `probe-table` |
| render with popups enabled, no `TABLE_NAME` | queried the guessed table | `500`, **zero** DynamoDB calls, nothing stored |

The last two rows exist because `hasActivePopups()` is the one changed helper no other probe
reaches: `layout.tsx` calls it only when `NEXT_PUBLIC_API_URL` is set
(`const showPopups = apiUrl ? await hasActivePopups(config.id) : false`), and the standard
probe recipe blanks that variable. Phase 4 of the script sets it. The stub records every
`TableName` it is sent, which is how "no guessed table is ever addressed" is measured rather
than argued.

Through the built OpenNext Lambda (`opennext-drive.mjs`, with `TABLE_NAME` deleted from
`process.env` — `requireTableName()` reads it per call, so this reaches the handler exactly as
an unset Lambda env var would): page `500`, `sitemap.xml` `500`, `/api/posts` `500`, and the
S3 incremental-cache log for that key shows `GET → MISS` with **no `PUT`**. After restoring
it, the same key shows `GET → MISS`, `GET → MISS`, `PUT` and the response carries
`s-maxage=31536000`.

### H3 — the cache key was blind to the session cookie — CLOSED in `cache-3` rev 3 (was: high)

**Found in review**, not in the original audit — `cache-3` revisions 1 and 2 shipped the
`RSC` and query-string fixes with this still open, and the reviewer blocked the deploy on it.

**State before the fix:** `RendererCachePolicy` used `cookieBehavior: none()` and no
session-derived header, so an authenticated request and an anonymous one produced the
**identical cache key**. `renderer/middleware.ts` routes session requests to the `no-store`
dynamic twin — but middleware runs at the origin, and a warm entry is answered at the edge
before the origin is consulted. On any access-gated page whose anonymous entry was warm, a
logged-in visitor would have been served the *"Restricted Access"* shell that the cacheable
route renders for `sessionToken: null` (`components/SitePage.tsx` ACCESS GATEKEEPER),
`s-maxage=31536000`, for up to a year.

This is a **functionality** failure, not a disclosure one, and the asymmetry is worth being
precise about: the cacheable route never receives a session token, so it cannot render, and
therefore cannot store, one visitor's private content for another. The thing that broke is
authenticated access itself — which `cache-1` and `renderer/ARCHITECTURE.md` both state
works.

Note that no existing probe could see it. Every `cache-3` probe drives the origin directly,
and at the origin middleware *does* run and *does* route correctly. The failure only exists
in the gap between the edge and the origin, which is precisely the gap the cache key covers.

**State after the fix (`cache-3` revision 3, human decision `CACHE3-SESSION-KEY` option B):**
the viewer-request CloudFront Function derives `x-has-session: 0|1` from the cookie jar and
the cache policy keys on it, so an authenticated request can never match a warm anonymous
entry — it misses, reaches the origin, and middleware routes it to the twin as designed.
Cookies stay out of the key. Revision 4 narrowed the cookie-name predicate on both layers
from a substring test to a **prefix** match over two base names. Full rationale, the forgery
and chunked-cookie edge cases and the two-detector agreement argument: § *`x-has-session` —
why one derived bit, and why it is not a cookie*.

Closing H3 does **not** by itself make a *chunked* session work end to end — it makes such a
request miss the edge and render on the twin, where the token is still not reassembled. See
the caveat in that section and `docs/TECH-DEBT.md`.

Post-deploy this needs a **warm-edge** probe, not an origin probe — see the `cache-3` slice
doc § *Deployment*, probe 6. A `curl` against the origin cannot fail this way.

---

## Transport defects — CloudFront deletes a required request field (D1–D2 `cache-6`, D3 `cache-7`)

D1–D2 were found on 2026-07-28 by probing the **deployed** staging distribution, one of them
re-observed on production `amodx.net`; both **shipped to production with `cache-6` on
2026-07-28** (`CURRENT_SLICE.md` § *Shipped 2026-07-28*, Tracks CACHE 1,2,3,6 — "deployed ISR
purging working for the first time" is D1). D3 was found on 2026-08-05 from a live prod incident
(the RevalidationFunction logging "Failed to revalidate" for every host); it is CLOSED in code by
`cache-7` but **not deployed yet**. All three are filed apart from H1–H3 on purpose: those are
**cache-key**
defects that `cache-1` activated, whereas these three are **transport** defects — CloudFront
deleting request data before the origin ever sees it — that were already broken in production
and are independent of whether anything is cached at all.

The shared shape is worth naming once, because it is the class of bug the CDK makes easy to
write. A CloudFront behavior forwards to its origin exactly (cache-policy keys ∪
origin-request-policy allowlist). Anything else is **deleted, not merely unkeyed**. So an
omission from either list is not a caching subtlety; it is a request field that does not
reach the application. All three fixes are in `infra/lib/renderer-hosting.ts` and each is
pinned by a named assertion in `infra/test/amodx-stack.test.ts`: D1 and D3 by `(h)` (the
`RendererOriginPolicy` header allowlist — a header omission), D2 by `(g)` (the `_next/image*`
behavior's query-string key — a parameter omission). In every case the reason the defect
shipped is that **nothing asserted the list**.

### D1 — `x-revalidation-token` was stripped, so every deployed ISR purge 401'd (was: high)

**State before the fix.** `RendererOriginPolicy`'s header allowlist named seven headers and
`x-revalidation-token` was not one of them. `backend/src/lib/revalidate.ts` sends that header
(lines 87 and 125) and `renderer/src/app/api/revalidate/route.ts` answers **401** whenever it
does not equal `REVALIDATION_SECRET`. Backend callers reach the renderer through the
distribution, so CloudFront deleted the credential in flight and the endpoint compared `null`
against the secret. **Every deployed Layer-2 purge has always failed**, for the whole life of
the endpoint.

`OBSERVED` 2026-07-28 on staging: the token in the Lambda's environment and the value in
Secrets Manager have matching sha digests (so the secret was never the problem), `POST
/api/revalidate` through the distribution returns 401, and
`aws cloudfront get-origin-request-policy` shows the seven-header list.

**This is not a duplicate of `cache-2`, and fixing one without the other fixes nothing.**
`cache-2` corrected *which path* the purge names (domain-keyed, not tenantId-keyed); D1
corrects *whether the request is authorised at all*. A correctly addressed purge that 401s is
still a no-op, and a 200 purge of a path that cannot exist is also a no-op. Both land in the
same deploy.

**State after the fix (`cache-6`).** `'x-revalidation-token'` is the eighth entry in the
origin-request policy. It is deliberately **not** in either cache key: a credential must never
become a cache-key partition, and the behavior that serves `/api/*` is `CACHING_DISABLED`
anyway.

Post-deploy check (`NOT RUN`, operator): `POST /api/revalidate` through the distribution
returns 200 **and** the corresponding `_cache/<buildId>/<host>/<path>.cache` object is gone
from the asset bucket. The 200 alone is not sufficient evidence — it only proves the header
arrived.

### D2 — `_next/image*` had its query string deleted, so image optimization 500'd (was: high)

**State before the fix.** The behavior used the AWS-managed `CACHING_OPTIMIZED` policy, which
keys on the path and nothing else, and it had **no origin-request policy**. Keys ∪ allowlist
was therefore empty: CloudFront deleted `?url&w&q` on the way to the image Lambda.
`next/dist/server/image-optimizer.js` does `const { url, w, q } = query` and throws
`"url" parameter is required` (`OBSERVED` in the built bundle), which the OpenNext adapter
turns into a 500. **Image optimization was broken for every tenant**, `OBSERVED` identically
on staging and on production `amodx.net`.

**State after the fix (`cache-6`).** A dedicated `ImageCachePolicy` whose query-string key is
exactly `url,w,q`, headers `none`, cookies `none`, gzip+brotli on, `defaultTtl` 1 day,
`maxTtl` 365 d, `minTtl` 0.

Three things about that shape are load-bearing rather than tuning:

- **One policy, not policy + ORP.** Keyed values are always forwarded, so keying the three
  parameters forwards them as a consequence. The alternative — keep the managed policy and add
  an origin-request policy — forwards them *without* keying them, which converts the 500 into a
  subtler bug: the first requested width is stored under the bare path and served to every
  other width.
- **Exactly three query parameters, no more.** Any fourth is one the optimizer does not read,
  so keying it mints a distinct entry and a distinct 1.5 GB Lambda invocation per
  `?url=…&cachebust=<n>` — the junk-parameter fragmentation `cache-3` removed from the default
  behavior. State the claim precisely: `url,w,q` is the optimizer's **required query-string
  input set**, not its entire input — the output format is negotiated on the `Accept` *header*,
  which is deliberately out of this key (see **Known residual** below, and Known Gap 16).
- **`defaultTtl` is a floor, not the policy.** The adapter always emits its own directive —
  `public,max-age=<maxAge>,immutable` on success, `public,max-age=60` on failure — so the
  origin governs and the 1-day default only applies to a response carrying no directive.

**Known residual, unchanged by this fix:** the adapter emits `Vary: Accept` and CloudFront does
not honour origin `Vary`; `Accept` is neither keyed nor forwarded, so webp/avif content
negotiation does not happen at the edge and the optimizer sees no `Accept`. That was equally
true under `CACHING_OPTIMIZED`, so this is a pre-existing gap being *recorded* rather than
introduced — `docs/TECH-DEBT.md`.

Post-deploy check (`NOT RUN`, operator): `curl -sI '<domain>/_next/image?url=%2F_assets%2F…&w=640&q=75'`
returns 200 with an `image/*` content type, and a second request with `w=1080` returns
different bytes rather than the 640 variant.

### D3 — `x-prerender-revalidate` + `x-isr` stripped, so background ISR regeneration is a no-op (`cache-7`, was: high)

**State before the fix.** `RendererOriginPolicy` named eight headers; neither
`x-prerender-revalidate` nor `x-isr` was among them. open-next's RevalidationFunction — the
SQS consumer in `.open-next/revalidation-function`, wired at
`infra/lib/renderer-hosting.ts` §4.3 — sends **both** on the HEAD request it makes to
re-render a stale page. `OBSERVED` in the installed open-next@3.1.3 bundle,
`node_modules/open-next/dist/adapters/revalidate.js:22-27`:

```js
https.request(`https://${host}${url}`, {
  method: "HEAD",
  headers: { "x-prerender-revalidate": prerenderManifest.preview.previewModeId, "x-isr": "1" },
}, ...)
```

`host` is the public tenant domain the server recorded (`internalEvent.headers.host`,
`dist/core/routing/util.js:413`, enqueued at util.js:313), so the HEAD traverses **this**
distribution and **this** policy — exactly the D1 geometry. CloudFront deleted both, so:

- `x-prerender-revalidate` — the credential Next checks to run a *blocking* re-render, and the
  signal open-next's `cacheInterceptor` uses to skip its own cache lookup
  (`dist/core/routing/cacheInterceptor.js:103`) — never arrived. The HEAD got a cached body,
  not `x-nextjs-cache: REVALIDATED`, so revalidate.js:35-37 pushed the record onto
  `failedRecords` and logged **"Failed to revalidate"**. `OBSERVED` in prod CloudWatch, every
  host, 2026-08-05.
- `x-isr: "1"` — the marker open-next turns into `isISRRevalidation`
  (`dist/core/requestHandler.js:79`), which its patched static-generation store uses to force
  `isOnDemandRevalidate = false` (`dist/build/patch/patchedAsyncStorage.js:9-11`) so the
  re-render is **written back to the S3 incremental cache** instead of treated as a throwaway
  on-demand render; it also bypasses tenant middleware for the internal request
  (`dist/core/routing/middleware.js:27`) — never arrived either. This is why forwarding only
  the credential would have been a *trap*: the log would go quiet (a `REVALIDATED` response is
  produced) while the S3 entry silently stayed stale. Both, or neither.

**Why this surfaced as "a new article never joins the listing pages" — and the `s-maxage=2`
question (slice §4).** Nothing here is time-based ISR. The freshness model, `OBSERVED` in code
and in the installed open-next@3.1.3 source, is:

- Every cacheable route is `export const revalidate = false`
  (`renderer/src/app/[siteId]/[[...slug]]/page.tsx:22`, `[siteId]/layout.tsx:19`,
  `[siteId]/products/[productId]/page.tsx:9`). open-next maps `revalidate === false` to a
  **one-year** directive — `s-maxage=31536000, stale-while-revalidate=2592000` — measured in the
  *`open-next@3.1.3` vs Next 16* table above (rows: published page, legacy product). That is the
  header on a **fresh** read.
- **The `s-maxage=2` is not a route config and not folklore — it is a runtime rewrite keyed on
  the response's cache STATE, not on the route.** open-next's `fixISRHeaders()`
  (`node_modules/open-next/dist/core/routing/util.js:364`) runs on the way out of every response
  and branches on the `x-nextjs-cache` header the incremental-cache read produced:
  - `x-nextjs-cache: STALE` → it **overwrites** Cache-Control with
    `s-maxage=2, stale-while-revalidate=2592000` (`util.js:389-396`; the inline comment there:
    "In order for CloudFront SWR to work, we set the stale-while-revalidate value to 2 seconds …
    CloudFront will cache the stale data for a short period while we revalidate in the
    background"). This is exactly the header the incident OBSERVED on the listing pages — it is
    genuine, and the earlier claim that it was folklore (a repo-source grep found no literal
    `s-maxage=2`) was checking the wrong layer: the value is injected at runtime by open-next,
    so it can never appear in renderer/plugins/infra source.
  - `x-nextjs-cache: HIT` at the SSG default → **left untouched**: the HIT branch recomputes a
    remaining TTL only when the extracted `s-maxage` is set *and* `!== 31536000`
    (`util.js:372-388`), so a fresh one-year page keeps `s-maxage=31536000`.
  - `x-nextjs-cache: REVALIDATED` (the response to a successful re-render) → rewritten to
    `private, no-cache, no-store` (`util.js:365-368`).

  So a listing page and a plain page carry **different** Cache-Control not because they are
  different routes — they are the same catch-all route — but because at the moment of the
  incident the listing page's incremental entry was in **STALE** state and the article page's
  was **HIT/fresh**. The header difference is a state difference, and `fixISRHeaders()` is the
  mechanism.
- Staleness is driven **on demand, not by the clock**. On publish, the backend calls the
  renderer's `/api/revalidate`, which runs `revalidatePath()` / `revalidateTag()`
  (`renderer/src/app/api/revalidate/route.ts:23,35-38`). That flips the affected incremental
  entries to STALE *without* changing the route's `revalidate = false`. The next visitor to such
  a page is served the still-cached body, but the read returns `x-nextjs-cache: STALE`, which
  simultaneously (a) makes `fixISRHeaders()` emit the `s-maxage=2` SWR header above and (b) is
  the *only* condition under which open-next enqueues an SQS revalidation message
  (`revalidateIfRequired`, `util.js:281-282`). So the SQS RevalidationFunction fires on this
  stack for the on-demand path — and every one of those firings hit D3 and failed, leaving the
  page STALE indefinitely. Because STALE re-emits `s-maxage=2` on every read, CloudFront keeps
  serving from the 30-day `stale-while-revalidate` window until the nightly `/*` flush. That is
  the reported symptom end to end, and the slice's production evidence stands.

**State after the fix (`cache-7`).** `'x-prerender-revalidate'` and `'x-isr'` are the ninth and
tenth entries of `RendererOriginPolicy`. Like `x-revalidation-token`, they are in **no** cache
key: both are markers/credentials that must not partition entries, and the revalidation HEAD
only reaches the origin on the stale-revalidation fetch anyway. Pinned by assertion `(h)` in
`infra/test/amodx-stack.test.ts` (now ten headers, order-exact).

Post-deploy check (`NOT RUN`, operator): publish/update a post, then watch the
RevalidationFunction logs go quiet (no "Failed to revalidate"); a listing/tag page that read
`x-nextjs-cache: STALE` returns to a fresh render within seconds instead of at the nightly
flush.

---

### `open-next@3.1.3` vs Next 16 — VERIFIED (2026-07-26)

> Corrects a false claim in the first version of this section: it stated `open-next` was
> "not installed in `node_modules`" and that its behaviour "could not be exercised". Both
> were wrong. `open-next@3.1.3` is installed (hoisted to the workspace root
> `node_modules/open-next`, with `node_modules/.bin/open-next` and a `package-lock.json`
> entry), and the check was simply not run.

`npx open-next build` completes against this Next 16.2.9 / Turbopack build, and the built
Lambda bundle was invoked directly with synthetic API Gateway v2 events (the same shape
CloudFront → Lambda produces). Results, EXECUTED:

| Request | Status | `Cache-Control` | S3 incremental cache |
|---|---|---|---|
| published page | 200 | `s-maxage=31536000` | GET (miss) then **PUT** |
| legacy `/products/<id>` | 200 | `s-maxage=31536000` | GET then **PUT** |
| `?page=2` (twin) | 200 | `private, no-cache, no-store, …` | **no S3 access** |
| missing page | 307 → `?nf=1` | `s-maxage=31536000` | GET then PUT |
| `?nf=1` landing (twin) | 404 | `private, no-cache, no-store, …` | **no S3 access** |
| unknown tenant host | 404 | `private, no-store` | **no S3 access** |

So Layer 2 is live and honours `revalidate = false`. Confirmed in the adapter's own code as
well as by execution: OpenNext's cache-control computation maps `revalidate === false` to
one year (`s-maxage=31536000, stale-while-revalidate=2592000` when served *from* its cache),
and `prerender-manifest.json` lists both `[siteId]/[[...slug]]` and
`[siteId]/products/[productId]` under `dynamicRoutes`, which is what makes OpenNext consult
and populate the S3 cache for them.

Two further facts this exercise established, both load-bearing:

- **OpenNext bundles the middleware, and the middleware's DynamoDB client works inside it.**
  `.open-next/server-functions/default/renderer/middleware.mjs` contains the host gate
  (`GSI_Domain`, the `tenant-directory` log string), and the unknown-host probe above
  returned the middleware's own `404` + `private, no-store` when driven through the Lambda
  handler. The bundle is plain ESM loaded in Node, so `process.env` is the real Lambda
  environment.
- **The S3 cache key includes the host** (`_cache/<buildId>/<host>/<path>.cache`), so
  Layer-2 tenant isolation matches Layer 1's `X-Forwarded-Host` cache key.

Reproduction: `cd renderer && npx open-next build`, then drive
`.open-next/server-functions/default/index.mjs`'s `handler` with an APIGW-v2 event while
pointing `AWS_ENDPOINT_URL_DYNAMODB` / `AWS_ENDPOINT_URL_S3` at local stubs (the `cache-1`
build report carries the driver script).

Still not exercised: the SQS revalidation queue, the DynamoDB tag cache, and behaviour
against real S3 latency/consistency. **`cache-2` did not exercise them either** — it fixed the
*keying* of the purge (`/<domain>/<path>`, § *Invalidation Mechanisms 5*) with a pure unit
test, and left the live round-trip to its post-deploy operator gate. The tag cache stays
unexercised until tag-based revalidation is adopted (Known Gap 5, `cache-4`).

---

## Invalidation Mechanisms

### 1. withInvalidation() HOF — Debounced CloudFront Invalidation

**File**: `backend/src/lib/invalidate-cdn.ts`

Higher-order function wrapping the cache-relevant mutation handlers — **26 wrapped handler
exports across 25 files** (`themes/manage.ts` wraps two: `createHandler` and
`deleteHandler`). Verified 2026-07-26 by `grep -rn "withInvalidation(" backend/src`; the
previously documented "51 handlers total" was wrong. Note `backend/src/scheduled/nightly-cache-flush.ts`
mentions `withInvalidation()` in a comment only — it is not wrapped, and must not be.

After a successful 2xx response the HOF writes **two** DynamoDB markers in a single
`Promise.all`, both under `PK: SYSTEM`:

- `SK: CDN_PENDING` — the debounce marker, consumed and deleted by `debounce-flush`.
- `SK: CDN_LAST_CHANGE` — a persistent high-water mark, never deleted, read by
  `nightly-cache-flush` so it can skip quiet days.

This is a ~5ms pair of DDB PutItems — no CloudFront call in the handler.

```typescript
import { withInvalidation } from "../lib/invalidate-cdn.js";

const _handler: Handler = async (event) => { /* ... */ };
export const handler = withInvalidation(_handler);
```

Properties:
- **DDB write, not CloudFront call**: ~5ms overhead (down from ~100ms). No CloudFront IAM needed on mutation Lambdas.
- **Two markers per mutation**: `CDN_PENDING` (debounce) + `CDN_LAST_CHANGE` (nightly-flush gate).
- **Debounced**: Multiple rapid mutations (e.g., bulk import) produce one invalidation, not hundreds.
- **Best-effort**: Marker write errors are logged but don't fail the response.
- **Unconditional overwrite**: PutItem always wins. Latest mutation timestamp is the source of truth.

#### Wrapped Handlers (cache-relevant only)

Only handlers that change what visitors see on cached pages are wrapped. Transactional mutations (orders, leads, contact submissions, customer profile updates, admin user management, signals, coupons, delivery config, assets, resources) are NOT wrapped — they do not affect cached page content.

| Domain | Files |
|--------|-------|
| Content | create, update, restore |
| Products | create, update, delete, bulk-price |
| Categories | create, update, delete |
| Reviews | create, update, delete |
| Popups | create, update, delete |
| Forms | create, update, delete |
| Themes | manage (createHandler, deleteHandler) |
| Tenant | create, settings (updateHandler) |
| Import | woocommerce, wordpress, media |

#### Not Wrapped (transactional / non-cache-visible)

These handlers do NOT trigger CloudFront invalidation, the admin "changes pending" banner, or the nightly backstop:

| Domain | Files | Reason |
|--------|-------|--------|
| Orders | create, update, update-status | Transaction data, not page content |
| Customers | update, public-update | Profile data, fetched at runtime |
| Contact | send | Form submission |
| Leads | create, delete | CRM data |
| Coupons | create, update, delete | Validated via API, not in cached pages |
| Delivery | update | Config fetched at runtime by date picker |
| Comments | create, moderate | Loaded client-side via API |
| Context | create, update, delete | Admin-only strategy docs |
| Signals | create, update | Growth engine, admin-only |
| Users | invite, update, delete, toggle-status | Admin user management |
| Assets | create | Upload; pages change when content is updated |
| Resources | presign | Presigned URL generation |
| Webhooks | paddle | Payment fulfillment email |

### 2. Debounce Flush Lambda

**File**: `backend/src/scheduled/debounce-flush.ts`

Triggered by EventBridge every 1 minute. Internally loops 6 times with 10-second sleeps, giving effective 10-second polling resolution on the 15-minute debounce window.

```
EventBridge (every 1 min) ──> Debounce Lambda
                                  │
                                  ├── Read SYSTEM#CDN_PENDING from DDB
                                  │   └── Not found? Return immediately (~5ms)
                                  │
                                  ├── Found, updatedAt < 15 min ago?
                                  │   └── Sleep 10s, loop again (up to 6x)
                                  │
                                  └── Found, updatedAt >= 15 min ago?
                                      ├── CloudFront /* invalidation
                                      └── Delete marker (conditional on updatedAt)
```

**Race condition safety**: The delete uses `ConditionExpression: updatedAt = :original`. If a new mutation arrived between read and delete, the condition fails. The marker survives and the next cycle picks it up.

**Cost**: ~43,200 invocations/month (1/min). When idle (no pending changes), each invocation does 1 DDB read and returns in ~5ms. When changes are pending, loops for up to 60s. Total cost: under $0.10/month.

**Warm Lambda**: Invoked every minute, never cold-starts. Consistent ~5ms latency on the DDB read.

### 3. System API — Status + Manual Flush

**File**: `backend/src/system/invalidation.ts`

**GET /system/invalidation** — Returns pending status for the admin UI banner. Allows
`GLOBAL_ADMIN`, `TENANT_ADMIN`, **and `EDITOR`** (`invalidation.ts:43`) — editors need to
see the banner for their own pending changes. The file's own header comment still claims
"Both require GLOBAL_ADMIN or TENANT_ADMIN"; that comment is stale for the GET.

```json
{ "pending": false }
// or
{ "pending": true, "lastChangeAt": "2026-03-13T18:30:00.000Z", "goLiveAt": "2026-03-13T18:45:00.000Z" }
```

**POST /system/invalidation** — "GO LIVE NOW" button. Fires immediate CloudFront `/*` invalidation and deletes the DDB marker. Requires GLOBAL_ADMIN or TENANT_ADMIN role (`invalidation.ts:89`).

### 4. Admin UI Banner

**File**: `admin/src/components/InvalidationBanner.tsx`

Persistent banner in `AdminLayout.tsx`, above page content. Polls `GET /system/invalidation` every 15 seconds. When changes are pending, shows countdown with "GO LIVE NOW" button.

```
┌──────────────────────────────────────────────────────────────┐
│  * Changes pending — going live in 7:42    [GO LIVE NOW]    │
└──────────────────────────────────────────────────────────────┘
```

Countdown ticks client-side every second (cosmetic). Server timestamp is source of truth, corrected on each 15-second poll.

### 5. revalidatePath() / revalidateTag() — ISR Layer

**Files**: `backend/src/lib/revalidate.ts` (transport + tenant lookup),
`backend/src/lib/revalidate-paths.ts` (pure path construction, unit-tested).

Calls the renderer's `/api/revalidate` endpoint with a secret token. The renderer does
`revalidatePath("/" + domain + slug)`, which deletes that S3 ISR entry. **The renderer's
contract is `{ domain, slug }` or `{ tag }` and is unchanged by `cache-2`** — it purges
exactly the path it is told.

> **Read this before debugging a purge that "does nothing" against a deployed stack.** Until
> `cache-6`, CloudFront **stripped the `x-revalidation-token` header** and this endpoint
> answered 401 to every caller that arrived through the distribution — which is every backend
> caller. The transport, not the path and not the secret, was the reason nothing was ever
> purged in a deployed environment. Fixed in `cache-6` (§ *Transport defects — CloudFront
> deletes a required request field*, D1) and **deployed to production 2026-07-28**, so purges
> now reach this endpoint; a stack synthesised or deployed from a pre-`cache-6` revision still
> exhibits the 401.

#### The key is the domain, not the tenant id (fixed in `cache-2`)

An ISR entry is keyed by the path **middleware rewrote the request to**, and the S3 object
key carries the host: `_cache/<buildId>/<host>/<path>.cache` (measured, `cache-1`). For
production traffic that host is the tenant's domain:

```
Host: shop.example.com  GET /about
   → middleware rewrite   /shop.example.com/about
   → S3 key               _cache/<buildId>/shop.example.com/about.cache
```

Before `cache-2` every backend purge named `/<tenantId>/<path>`, which addresses no entry
that can exist in production — **all 8 calls were no-ops**. The backend now resolves the
tenant's `domain` (one projected `GetItem` on `PK: SYSTEM / SK: TENANT#<id>`) and purges
domain-keyed paths. Tenant → domain resolution stays in the backend because the backend owns
`TenantConfig`; the renderer stays dumb (ratified design D2, `cache-2`).

**No tenantId-keyed purge is emitted, deliberately.** `/tenant/<id>/…` (test mode) and
`/_site/<id>/…` (preview) are rewritten by `renderer/middleware.ts` to the `force-dynamic`
twin `/<id>/_dyn/…`, so they are never stored by either cache layer — there is nothing under
a tenantId key to purge. Verified in-slice; see the `cache-2` slice doc § Findings.

**One domain per tenant.** `TenantConfigSchema.domain` is a single `z.string()`, mirrored to
the `Domain` attribute that is `GSI_Domain`'s partition key, and `lib/tenant-directory.ts`
admits a host only on an exact match — so exactly one host can produce ISR entries for a
tenant. If aliases (apex + www, migration domains) are ever added, the fan-out point is
`TenantRouting.domain` in `revalidate-paths.ts`.

#### Handlers that purge (6)

| Handler | Kind | What it purges |
|---------|------|----------------|
| `content/create.ts` | `page` | New page slug — clears the cacheable `307 → ?nf=1` a pre-publication probe may have stored (see Known Gaps 4). Added in `cache-2` together with its IAM grant (`revalidationSecret.grantRead(createContentFunc)`); code and grant must deploy together. |
| `content/update.ts` | `page` | Page slug (+ old slug on rename) |
| `products/update.ts` | `product` | Product page (+ old slug on rename) |
| `products/delete.ts` | `product` | Product page |
| `categories/update.ts` | `category` | Category page (+ old slug on rename) |
| `categories/delete.ts` | `category` | Category page |

Commerce paths are built from the tenant's own `urlPrefixes.product` / `urlPrefixes.category`
(the same values `SitePage.tsx#matchCommercePrefix` routes on), falling back to
`URL_PREFIX_DEFAULTS`. The tenant config is already in hand from the domain lookup, so this
costs nothing and closes Known Gap 2 for these two entity kinds.

#### When revalidation is switched off

`RENDERER_URL` is empty on any deployment without a configured root domain
(`amodx-stack.ts` → `rootDomain ? https://<rootDomain> : undefined`, passed as
`props.rendererUrl || ''`). ISR revalidation is then disabled entirely. Since `cache-2` this
logs a `console.warn` naming the missing variable **and the paths that went unpurged**,
instead of the previous context-free `console.log("Skipping")`. Consequence when it fires:
Layer 2 only clears on the nightly flush, so an edit can stay stale for up to 24h even after
CloudFront is invalidated. **A deployment that wants working ISR purges must set
`RENDERER_URL`, which today means configuring a root domain.**

### 6. Nightly Safety Net — Both Layers (change-gated)

**File**: `backend/src/scheduled/nightly-cache-flush.ts`

Scheduled Lambda triggered by EventBridge cron at **02:00 UTC daily**. Skips entirely if no cache-relevant mutations happened since the last successful nightly flush.

**Decision logic** (two DynamoDB markers):

| Marker | Written by | Deleted by |
|--------|-----------|------------|
| `SYSTEM#CDN_LAST_CHANGE` | `markCdnPending()` in `withInvalidation()` on each cache-relevant mutation | Never (persistent high-water mark) |
| `SYSTEM#CDN_LAST_NIGHTLY_FLUSH` | This Lambda, after both flush steps succeed | Never (persistent high-water mark) |

At invocation:
1. Read both markers
2. If `CDN_LAST_CHANGE` does not exist → no mutations ever → skip
3. If `CDN_LAST_NIGHTLY_FLUSH.flushedAt >= CDN_LAST_CHANGE.updatedAt` → no changes since last flush → skip
4. Otherwise → proceed with flush
5. If marker read fails → proceed with flush as safety fallback

When it does run, flushes both cache layers:

1. **CloudFront**: Submits `/*` invalidation (clears all edge caches globally)
2. **S3 ISR cache**: Paginated deletion of all objects under `_cache/` prefix (1000 per batch)

**Success-gated marker write**: `CDN_LAST_NIGHTLY_FLUSH` is only written if both CloudFront invalidation and S3 purge succeed. A failed flush does not suppress the next nightly run.

After the nightly flush, the first visitor to any page triggers a fresh SSR from DynamoDB. Cache refills organically as visitors arrive.

This covers:
- ISR cache entries orphaned by mutations that only invalidate CloudFront (Layer 1) — Known Gap 1
- Edge cases where `revalidatePath()` silently fails, including a deployment with no
  `RENDERER_URL` (§ *Invalidation Mechanisms 5*, "When revalidation is switched off")
- Pages a targeted purge does not name: listings/landing pages that show a changed entity
  (Known Gap 5). *Custom URL prefixes are no longer in this list for product and category
  pages — `cache-2` builds those paths from the tenant's own prefixes.*
- Any cache corruption or drift

On days with zero content changes, the nightly flush skips entirely and cached pages remain warm.

---

## CloudFront Distribution Layout

```
CloudFront Distribution
├── Default Behavior → Lambda Function URL (RendererCachePolicy)
│   └── Cache Key: X-Forwarded-Host (tenant isolation) + RSC header family
│                  + x-has-session (0|1, derived from cookies by the viewer-request Function)
│                  + query allowlist (page, q, availability, id, email, preview, nf)
│      Cookies themselves are NOT in the key — only that one derived bit.
│
├── api/* → Lambda Function URL (CACHING_DISABLED)
│   └── Comments, account, revalidation — never cached
│
├── _next/image* → Image Optimization Lambda (ImageCachePolicy)
│   └── Cache Key: url, w, q — and NO other query parameter. Those three are the
│                  optimizer's REQUIRED QUERY-STRING inputs (not its entire input:
│                  it negotiates format on the Accept header too, which is neither
│                  keyed nor forwarded — Known Gap 16), and keying them is also
│                  what FORWARDS them
│                  (slice cache-6 D2; no origin request policy on this behavior)
│
├── _next/static/* → S3 (immutable, long-lived cache)
├── assets/* → S3 (immutable, long-lived cache)
└── favicon.ico → S3 (cached)
```

Both Lambda-backed behaviors (default and `api/*`) also carry `RendererOriginPolicy` — the
**transport** list, see § *Origin Request Policy* below. The three S3 behaviors and
`_next/image*` carry none, so for them the cache key alone decides what the origin receives.

### Cache Policy (Default Behavior)

Source of truth: `infra/lib/renderer-hosting.ts`, `RendererCachePolicy`. Current shape
(slice `cache-3`):

```typescript
const rendererCachePolicy = new cloudfront.CachePolicy(this, 'RendererCachePolicy', {
    defaultTtl: cdk.Duration.seconds(0),     // Respect origin Cache-Control (s-maxage)
    maxTtl: cdk.Duration.days(365),
    minTtl: cdk.Duration.seconds(0),         // 0 => an origin `no-store` is not stored
    headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
        'X-Forwarded-Host',
        'RSC', 'Next-Router-Prefetch', 'Next-Router-State-Tree', 'Next-Router-Segment-Prefetch',
        'x-has-session',                     // derived at the edge, never viewer-supplied
    ),
    queryStringBehavior: cloudfront.CacheQueryStringBehavior.allowList(
        'page', 'q', 'availability', 'id', 'email', 'preview', 'nf',
    ),
    cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    enableAcceptEncodingGzip: true,
    enableAcceptEncodingBrotli: true,
});
```

…paired with the viewer-request CloudFront Function in the same file, which is what
produces the two derived headers the key relies on:

```javascript
function handler(event) {
    var request = event.request;
    var host = request.headers.host ? request.headers.host.value : '';
    request.headers['x-forwarded-host'] = { value: host };          // tenant isolation (keyed)
    request.headers['x-origin-verify']  = { value: '<secret>' };    // origin trust (not keyed)

    // session bit (keyed). PREFIX match: name === base, or name starts with base + '.'
    // (NextAuth's chunk separator). Lowercase literals => case-insensitive comparison.
    var SESSION_COOKIE_BASES = ['next-auth.session-token', '__secure-next-auth.session-token'];
    var hasSession = '0';
    var jar = request.cookies || {};
    for (var name in jar) {
        var lower = name.toLowerCase();
        for (var i = 0; i < SESSION_COOKIE_BASES.length; i++) {
            var base = SESSION_COOKIE_BASES[i];
            if (lower === base || lower.indexOf(base + '.') === 0) {
                hasSession = '1';
                break;
            }
        }
        if (hasSession === '1') {
            break;
        }
    }
    request.headers['x-has-session'] = { value: hasSession };

    return request;
}
```

`defaultTtl: 0` means CloudFront defers entirely to the origin's `Cache-Control` header. With `revalidate = false`, OpenNext sends `s-maxage=31536000`, so CloudFront caches for up to 1 year.

**The cache key decides whether the origin runs at all.** A header or parameter left out of
the key collapses the request onto the bare key; if that entry is warm, CloudFront answers
from it and the origin — and therefore middleware and the render — never runs.

`RendererOriginPolicy` still forwards the full query string and all cookies to the Lambda,
so on an edge **miss** an omitted parameter does reach the render. That is a cache-miss
property only. It is *not* what makes an omission safe — see § *Why this list is the right
list* for the actual argument (keyed for representation-changing parameters, code
inspection for the rest).

#### Why the header allowlist has six entries

`X-Forwarded-Host` is tenant isolation (§ *Multi-Tenant Isolation*). `x-has-session` is
visitor-class isolation (next subsection). The other four mirror the origin's own `Vary`,
which CloudFront does not honour:

```
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
```

Measured (`cache-3` build run, table below): only `RSC` actually flips the response body
today — from `text/html` to a `text/x-component` flight payload, **at the same URL, both
with `s-maxage=31536000`**. That is hazard H1: before this slice, one `curl -H 'RSC: 1'`
pinned a flight payload at the edge under a page's HTML URL for every later visitor. The
other three are keyed even though they do not flip the body today, because they are in the
origin's `Vary` — a future Next version that starts negotiating on them must not silently
reintroduce H1.

Cost, stated honestly: more keyed headers means more distinct entries. These four appear
essentially only on client navigations and `<Link>` prefetches, which previously fragmented
anyway via `?_rsc=<hash>` (see below), so this is roughly entry-count neutral rather than
free.

#### `x-has-session` — why one derived bit, and why it is not a cookie

This is the fix for **H3** (§ *Open hazards*), added in `cache-3` revision 3 under human
decision `CACHE3-SESSION-KEY` (option B). The failure it prevents:

> `cookieBehavior: none()` means a logged-in visitor's request has **the same cache key** as
> an anonymous one. Once the anonymous entry for an access-gated page is warm, CloudFront
> answers at the edge; the origin never runs; `renderer/middleware.ts` never gets to route
> the request to the `no-store` dynamic twin. The visitor is served the *"Restricted Access"*
> shell that the cacheable route renders for `sessionToken: null`
> (`renderer/src/components/SitePage.tsx`, ACCESS GATEKEEPER).

Note the direction: the leak is anonymous content served to an authenticated visitor, not
the reverse. Authenticated renders are `no-store` and `minTtl: 0` refuses to store them, so
no visitor can ever receive another visitor's *content*. What breaks is authenticated access
itself, which the cache-1 design and `renderer/ARCHITECTURE.md` both promise works.

Three design points, each of which is load-bearing:

1. **A derived bit, not the cookie.** Adding `next-auth.session-token` to the cache key would
   key on the token *value* — a per-visitor string. Every logged-in visitor would get a
   private set of entries (unbounded fragmentation) and a credential would end up in a cache
   key. One bit adds at most one partition. In practice it adds **zero stored entries**:
   every `x-has-session: 1` request is routed to the force-dynamic twin, whose `no-store`
   response `minTtl: 0` declines to store.
2. **Written on every request, both values.** The header is in the cache key and headers are
   viewer-supplied. If the function only wrote it on a match, `x-has-session: <random>` from
   a client would survive into the key and mint an entry per value — reintroducing exactly
   the fragmentation vector the query allowlist removes. Overwriting unconditionally bounds
   the key to `0` and `1`. (Measured: `probe-cache3-cffunc.mjs` §B2.)
3. **Prefix match over two base names, not a substring test and not an exact-name list.**
   The predicate is `name === base || name.startsWith(base + '.')`, applied
   case-insensitively to `next-auth.session-token` and `__secure-next-auth.session-token`.
   `.` is NextAuth's chunk separator, so the prefix form covers `.0`, `.1`, … without
   enumerating them. A plain substring test was rejected in `cache-3` revision 4: it also
   matches unrelated names that merely embed the literal (`x-next-auth.session-token-decoy`,
   `next-auth.session-tokenX`), needlessly widening the set of requests a viewer can push
   past the edge cache. An exact-name list was rejected because it misses the chunks.

**Which names NextAuth actually emits here** (evidence, not assumption):

| Name | Status | Evidence |
|---|---|---|
| `next-auth.session-token` | **emitted today** | `renderer/src/app/api/auth/[...nextauth]/route.ts:36-46` sets `cookies.sessionToken.name` explicitly |
| `next-auth.session-token.0`, `.1`, … | **emitted today**, when the JWT exceeds 4096 bytes | `next-auth/core/lib/cookie.js:152` names chunks `` `${cookie.name}.${i}` `` — from the *configured* name |
| `__Secure-next-auth.session-token` (+ chunks) | **compatibility/legacy coverage only** | `next-auth/core/init.js:59-61` spreads `authOptions.cookies` over `defaultCookies(secure)` at the **top level**, so the configured `sessionToken` entry *replaces* the default and the `__Secure-` prefix does not apply while that config stands |

The `__Secure-` family is matched anyway, deliberately: it is what next-auth would emit if
the explicit `cookies` block were ever removed, and what a cookie issued before that block
existed still carries in a visitor's jar. Matching it costs nothing; missing a real session
cookie is the expensive direction. Do **not** read the code comments as a claim that it is
in use today — installed next-auth is 4.24.14 and the merge above is what it does.

**Shared source of truth for the cookie name:** that NextAuth cookie configuration. Two
detectors derive from it — the CloudFront Function (`x-has-session`) and
`renderer/middleware.ts` (`SESSION_COOKIE_BASES` / `hasSessionCookie`) — and they must
classify **every** cookie name identically. They cannot import a common constant (`infra/`
is a deploy-time CDK package and does not depend on the renderer; adding that edge to share
one string was rejected), so the agreement is enforced by test instead of by structure:
`probe-cache3-cffunc.mjs` §C extracts both `SESSION_COOKIE_BASES` arrays — one from the
*synthesized template*, one from `middleware.ts` — asserts they are equal and are the two
ratified names, pins the middleware predicate's source shape, and runs a 31-name cookie
corpus (emitted, legacy, non-session, decoy, case-variant, malformed) through both looking
for a disagreement.

The direction of a mismatch matters. If the CF function under-matched relative to middleware,
an authenticated request would key as anonymous, hit the warm entry, and H3 would be open
again. If it over-matched, the request would merely miss the cache and render correctly. The
test pins equality, so neither happens; over-matching is the safe side if it ever drifts.

**Chunked sessions: routing is fixed, authentication is not.** Before `cache-3` revision 3,
`middleware.ts` matched two exact cookie names, so a *chunked* session (`…session-token.0` /
`.1`) was not detected and was routed to the cacheable route. That routing is now correct on
both layers — a chunked-session request keys as `x-has-session: 1` at the edge and renders on
the `no-store` twin (`probe-cache3.sh` §F3/§F3b) — so it can neither hit nor populate an
anonymous entry. It does **not** follow that a chunked session authenticates: the twin's
`readSessionToken()`
(`renderer/src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:35-36`) reads two exact, unchunked
names and does not reassemble chunks, so `SitePage` still receives `sessionToken: null` and
gated content is still denied. Twin routes are out of `cache-3`'s scope; this is recorded as
deferred debt in `docs/TECH-DEBT.md` (*Chunked NextAuth session cookies are not reassembled*)
and slice-doc F12.

#### The query-string allowlist, parameter by parameter

`all()` was the largest remaining "Lambda fires more than intended" vector after `cache-1`:
any `?utm_*`, `?fbclid`, or attacker-chosen junk minted its own entry — a guaranteed miss.

| Param | Read by | Why it must be in the key |
|---|---|---|
| `page` | `SitePage.tsx` `query.page` (category, shop, search) | `/shop?page=2` must not be served the page-1 entry |
| `q` | `SitePage.tsx` `query.q`, and `buildSitePageMetadata` | search term selects the result set |
| `availability` | `SitePage.tsx` `query.availability` | shop in-stock filter |
| `id` | `SitePage.tsx` `query.id` (checkout-confirm) | order lookup, paired with `email` |
| `email` | `SitePage.tsx` `query.id`/`query.email` (checkout-confirm, checkout-track) | order lookup |
| `preview` | `%5Fdyn/[[...slug]]` + `%5Fdyn/products/[productId]` `query.preview` | an editor previewing a draft must bypass the published entry |
| `nf` | `lib/not-found-handoff.ts` (`NOT_FOUND_PARAM`) | **mandatory, not an optimisation** — see below |

**`nf` is load-bearing.** The not-found handoff redirects `/p` → `/p?nf=1`, and that 307 is
itself cacheable (measured: `307`, `s-maxage=31536000`, `x-nextjs-cache: MISS`). Drop `nf`
from the key and `/p?nf=1` collapses onto the `/p` entry, hits the stored 307, and is
redirected to itself — an infinite client redirect loop on **every** 404. Anyone editing
this allowlist must keep `nf` and `NOT_FOUND_PARAM` in sync.

**Not in the allowlist, deliberately:** `ref`, `utm_*`, `fbclid`, `gclid`, `_rsc`, and
everything else.

#### Why this list is the right list (the safety argument, in two halves)

The worry is that stripping a parameter makes CloudFront serve a stored response that does
not match what the origin would have rendered. The argument has two halves and they are not
symmetric — one is about what is *in* the list, the other about what is *out*.

**(a) A parameter that changes the representation must be in the list.** Being in the cache
key is what forces an edge miss and gets the request to the origin at all. Nothing
downstream can rescue a parameter stripped here, because on a warm entry **CloudFront
answers before middleware runs** — the origin never sees the request. Concretely: drop
`page` from the key, warm `/shop`, and `/shop?page=2` is answered with the stored page 1.
The seven parameters above are listed precisely because each one selects a different
representation (and `nf` because of the redirect loop below).

**(b) A parameter that is *not* in the list is safe only because nothing reads it.** This
is a code-inspection claim, not a header claim, so here is its basis. The complete set of
`query.*` reads reachable from a rendered page (deterministic `grep -rn "query\.\|query\["`
over `renderer/src`, then read in place — a literal-text scan, not an index or call graph):

| Read site | Parameters |
|---|---|
| `components/SitePage.tsx` | `q`, `page`, `availability`, `id`, `email` |
| `app/[siteId]/%5Fdyn/[[...slug]]/page.tsx`, `…/%5Fdyn/products/[productId]/page.tsx` | `preview` |
| `lib/not-found-handoff.ts` | `nf` (`NOT_FOUND_PARAM`) |

That set **is** the allowlist. Every other parameter — `ref`, `utm_*`, `fbclid`, `gclid`,
attacker-chosen junk — is read by no code on either route, so the representation the origin
would produce for it is byte-identical to the bare-path one it now collapses onto.

The strongest form of (b) applies to the cacheable route specifically: it passes
`query={{}}` **literally** (`app/[siteId]/[[...slug]]/page.tsx`) because in ISR mode it
cannot `await searchParams` at all. So the representation that ends up *stored* is a pure
function of host + path + the RSC headers, and no query parameter can vary it. `_rsc` is the
one non-listed parameter that reaches that route (Next appends `?_rsc=<hash>` to prefetches
and strips it before middleware, so those requests land on the ISR route). Measured, not
inferred: `?_rsc=<hash>` **without** the `RSC` header returns `text/html`; **with** it
returns `text/x-component`; two different `_rsc` values with identical headers return the
same content type. The *header* is the discriminator; the parameter is only a cache-buster
for CDNs that do not key on the header — which is precisely what this policy now does.
Dropping `_rsc` collapses the per-prefetch entry explosion noted under § *Cost Analysis*.

**What the `cache-1` middleware property does and does not contribute.** `middleware.ts`
routes every request carrying a query string to the `%5Fdyn` twin, which answers
`private, no-cache, no-store, max-age=0, must-revalidate` (measured for `?fbclid=`, `?ref=`,
`?utm_source=`, `?page=`, `?q=`, `?preview=`, `?nf=` — table below). This is **not** the
safety argument, because it only applies to requests that reach the origin, and a warm
bare-path entry is served without ever getting there. What it does buy is narrower and still
worth stating: a query-string request can never *populate* an entry, so a junk parameter
cannot warm a bogus one, and a listed parameter always renders fresh rather than from a
stale per-parameter variant.

**Consequence for verification.** Because a junk-param request cannot populate anything, the
junk-param probe must warm the *bare* URL first, or the second request is a miss for a
legitimate reason. Once `/p` is warm, `/p?fbclid=<anything>` resolves to the `/p` key and is
answered at the edge with no origin request at all — which is the whole point.

#### Measured: the origin behaviour this key depends on (EXECUTED 2026-07-26, `cache-3`)

`next build` + `next start -p 3111` against the `cache-1` DynamoDB stub. Script:
`.agent-manager/slices/CACHE-1/probe-harness/probe-cache3.sh`.

| Request (same URL `/published` unless noted) | Status | `Content-Type` | `Cache-Control` | Cacheable? |
|---|---|---|---|---|
| bare, 1st then 2nd | 200 | `text/html` | `s-maxage=31536000` | yes, MISS → HIT |
| `?fbclid=junk123` | 200 | `text/html` | `private, …, no-store` | **no** |
| `?ref=partner-a` | 200 | `text/html` | `private, …, no-store` | **no** |
| `?utm_source=newsletter` | 200 | `text/html` | `private, …, no-store` | **no** |
| `?page=2` / `?q=ring` / `?preview=true` / `?nf=1` | 200 | `text/html` | `private, …, no-store` | **no** |
| `/no-such-page-c3` (bare) | 307 → `?nf=1` | — | `s-maxage=31536000` | **yes** — why `nf` must be keyed |
| header `RSC: 1` | 200 | **`text/x-component`** | `s-maxage=31536000` | yes — **H1** |
| header `Next-Router-Prefetch: 1` | 200 | `text/html` | `s-maxage=31536000` | yes |
| header `Next-Router-State-Tree: …` | 200 | `text/html` | `s-maxage=31536000` | yes |
| `?_rsc=abc123`, no `RSC` header | 200 | `text/html` | `s-maxage=31536000` | yes |
| `?_rsc=abc123` + `RSC: 1` | 200 | `text/x-component` | `s-maxage=31536000` | yes |
| `?_rsc=zzz999`, no `RSC` header | 200 | `text/html` | `s-maxage=31536000` | yes |
| cookie `next-auth.session-token` | 200 | `text/html` | `private, …, no-store` | **no** — twin |
| cookie `__Secure-next-auth.session-token` (legacy name) | 200 | `text/html` | `private, …, no-store` | **no** — twin |
| cookies `next-auth.session-token.0` + `.1` (chunked, emitted name) | 200 | `text/html` | `private, …, no-store` | **no** — twin |
| cookies `__Secure-next-auth.session-token.0` + `.1` (chunked, legacy) | 200 | `text/html` | `private, …, no-store` | **no** — twin |
| cookies `__Host-next-auth.csrf-token` + `…callback-url` | 200 | `text/html` | `s-maxage=31536000` | yes — no over-match |
| cookies `amodx_ref` + `_ga` | 200 | `text/html` | `s-maxage=31536000` | yes — no over-match |
| cookies `x-next-auth.session-token-decoy` + `next-auth.session-tokenX` | 200 | `text/html` | `s-maxage=31536000` | yes — prefix, not substring |

Body inspection confirms the content types are not mislabelled: the `RSC: 1` response
begins `1:"$Sreact.fragment"`, the `?_rsc=` response begins `<!DOCTYPE html>`.

The last seven rows (`probe-cache3.sh` §F, added in revision 3, extended in revision 4) are
the **origin** half of H3: middleware routes every session-cookie shape to the `no-store`
twin and nothing else. The two chunked rows show routing only — see the caveat in
§ *`x-has-session`*: a chunked session reaches the twin but is still not *authenticated*
there. The decoy row is the prefix contract's negative half. The **edge** half
(`x-has-session`) cannot be exercised locally; it is covered by `probe-cache3-cffunc.mjs`
against the synthesized template, and by the operator's warm-edge session probe post-deploy.

#### Measured: the CloudFront Function's session bit (EXECUTED 2026-07-27, revision 4)

`node .agent-manager/slices/CACHE-1/probe-harness/probe-cache3-cffunc.mjs` — **39/39 PASS**.
It reads the function body out of `infra/cdk.out/AmodxStack-staging.template.json` (so
what runs is what would deploy, not the `.ts` source) and executes it against synthetic
viewer-request events. Otherwise this code is exercised by nothing: it is inline ES5 inside a
CDK template literal, invisible to `tsc`, to lint and to the `infra` jest suite.

| Group | Asserts |
|---|---|
| B | the emitted names (`next-auth.session-token`, `.0`, `.1`) and the legacy `__Secure-` family → `1`; `__Host-next-auth.csrf-token`, `…callback-url`, `next-auth.pkce.code_verifier`, `amodx_ref`, `_ga`, `session`, `sessiontoken`, `next-auth` → `0`; empty jar and absent `cookies` key → `0`; five embedding decoys (`x-next-auth.session-token-decoy`, `next-auth.session-tokenX`, `next-auth.session-token-0`, `evil__secure-…`, `anext-auth.session-token`) → `0` |
| B2 | a viewer-supplied `x-has-session` (`1`, or a long junk value) is **overwritten** — the key can only hold `0`/`1` |
| B3 | `x-forwarded-host` is still derived from `Host` and a viewer-supplied one is overwritten; `x-origin-verify` still set |
| C | both `SESSION_COOKIE_BASES` arrays (one extracted from the synthesized template, one from `middleware.ts`) are equal and are the two ratified names; `middleware.ts` uses the prefix predicate over **all** cookie names and no longer substring-matches; zero disagreements across a 31-name corpus |

The bottom three rows are the evidence for dropping `_rsc`. Without them the claim would be
an inference from the origin's `Vary` header; with them it is measured on this build.

### Origin Request Policy (`RendererOriginPolicy`)

Source of truth: `infra/lib/renderer-hosting.ts`. Attached to the **default** and **`api/*`**
behaviors only.

This is the **transport** list and it answers a different question from the cache policy above.
The cache policy decides *which stored response a viewer gets, and whether the origin is
consulted at all*. This one decides *which request headers the origin is permitted to see* —
on hits and on misses alike. A header in neither list is **deleted by CloudFront**, so an
omission here is not a caching subtlety: the header does not exist as far as the renderer
Lambda is concerned.

| Header | Why it is forwarded |
|---|---|
| `Accept`, `Accept-Language`, `Content-Type` | ordinary content negotiation / request bodies |
| `X-Forwarded-Host` | how the origin resolves the tenant at all (§ *Multi-Tenant Isolation*) |
| `x-origin-verify` | origin trust — the renderer rejects requests without it (Phase 6.1) |
| `x-tenant-id`, `x-automation-key` | admin/automation calls proxied through the renderer |
| `x-revalidation-token` | **added by `cache-6`.** The ISR purge credential. Its absence 401'd every deployed purge — § *Transport defects — CloudFront deletes a required request field*, D1 |
| `x-prerender-revalidate` + `x-isr` | **added by `cache-7`.** open-next's background-ISR revalidation protocol (blocking re-render credential + write-back marker). Their absence made every SQS revalidation a no-op — § *Transport defects — CloudFront deletes a required request field*, D3 |

Cookies and query strings are forwarded in full (`all()`), which is why the render sees the
real cookie jar on a miss even though cookies are absent from the cache key.

Pinned by assertion `(h)` in `infra/test/amodx-stack.test.ts`. It asserts the list **exactly
and in order**, because the D1 defect existed precisely for as long as nothing asserted it.

### /api/* Behavior

Explicit `CACHING_DISABLED` policy. Without this, API routes (comments POST, account actions, revalidation endpoint) would fall through to the default behavior and get cached — returning stale JSON to authenticated users.

It is also the only behavior on which `x-revalidation-token` can be *acted* on, since
`/api/revalidate` lives here. The header is forwarded on the default behavior too (one shared
origin request policy) but nothing there reads it.

### Multi-Tenant Isolation

A CloudFront Function on viewer request copies the incoming `Host` header to `X-Forwarded-Host`. The cache policy includes `X-Forwarded-Host` in the cache key. Result: `shop-a.example.com/about` and `shop-b.example.com/about` are separate cache entries, even though they share the same CloudFront distribution.

The same function derives `x-has-session` from the cookie jar, which is the *visitor-class*
partition of the same key (§ *`x-has-session`*). Both headers are **overwritten** on every
request rather than passed through, so neither is viewer-forgeable: a client cannot mint a
key partition, nor read another tenant's entry by sending its own `X-Forwarded-Host`.

---

## CDK Wiring

### Debounce Infrastructure (amodx-stack.ts section 4b)

```typescript
// Debounce flush Lambda — polls DDB marker, fires CloudFront invalidation
const debounceFlushFunc = new nodejs.NodejsFunction(this, 'DebounceFlushFunc', {
    runtime: lambda.Runtime.NODEJS_22_X,
    entry: path.join(__dirname, '../../backend/src/scheduled/debounce-flush.ts'),
    handler: 'handler',
    memorySize: 256,
    timeout: cdk.Duration.minutes(2),
    environment: {
        TABLE_NAME: db.table.tableName,
        RENDERER_DISTRIBUTION_ID: distId,
        DEBOUNCE_WINDOW_MS: '900000',  // 15 minutes
    },
});
db.table.grantReadWriteData(debounceFlushFunc);
debounceFlushFunc.addToRolePolicy(new iam.PolicyStatement({
    actions: ['cloudfront:CreateInvalidation'],
    resources: [distArn],
}));

// Schedule: every 1 minute
new events.Rule(this, 'DebounceFlushSchedule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
    targets: [new eventTargets.LambdaFunction(debounceFlushFunc)],
});
```

### System API Routes (amodx-stack.ts section 4b-2)

System routes are registered directly in `amodx-stack.ts` (not `api.ts`) because they need the renderer distribution ID, which isn't available until after the renderer construct is created.

- `GET /system/invalidation` — DDB read only (invalidationStatusFunc)
- `POST /system/invalidation` — DDB read/write + CloudFront invalidation (invalidationFlushFunc)

### Key Architectural Decision: No CloudFront IAM on Mutation Lambdas

Previous design granted `cloudfront:CreateInvalidation` to ALL ~70 Lambdas via a post-construction loop. The debounce design eliminates this:

- **Mutation Lambdas**: Only need DDB write (already have it). The `withInvalidation()` HOF writes a DDB marker. No CloudFront permissions.
- **Debounce Lambda**: Has CloudFront IAM + DDB read/write. Only Lambda that calls CloudFront on a schedule.
- **Flush Lambda**: Has CloudFront IAM + DDB read/write. Only called by admin "GO LIVE NOW" button.
- **Nightly Flush Lambda**: Has CloudFront IAM + S3 read/delete. Independent safety net.

This follows the principle of least privilege — on the request path, CloudFront access is limited to those 3 specialized Lambdas instead of 70.

**The synthesized template grants `cloudfront:CreateInvalidation` to 4 roles, not 3.** The fourth is CDK's own `CustomCDKBucketDeployment…ServiceRole`: `renderer-hosting.ts` passes `distribution: this.distribution` to `s3deploy.BucketDeployment`, so the custom resource can invalidate the static assets it has just uploaded. It is **deploy-time tooling** — it holds the permission only while `cdk deploy` runs, never in response to visitor or admin traffic — so the least-privilege property above is unaffected. It is named here because it is a real grant, and a doc that omits it makes a reader treat the fourth grant as an intrusion.

`infra/test/amodx-stack.test.ts` assertion `(d)` pins this contract in both categories: the 3 request-path roles by name, the 1 deploy-time role by name, and it fails on any fifth grant or on a known role acquiring the action twice. *(Contract corrected 2026-07-28 from "3 Lambdas" — operator decision `test4-invalidation-role-contract`, `docs/shipped/slices/test-4-infra-truth.md` § Finding 2. The template always had 4; the doc was wrong, not the infra.)*

### Nightly Flush Lambda

```typescript
const nightlyFlushFunc = new nodejs.NodejsFunction(this, 'NightlyCacheFlushFunc', {
    // ... same as before
});
```

IAM grants: `cloudfront:CreateInvalidation` + S3 read/delete on the asset bucket. Triggered by EventBridge cron `cron(0 2 * * ? *)`.

---

## Infrastructure Resources

| Resource | Purpose |
|----------|---------|
| CloudFront Distribution | Edge cache (Layer 1), TLS termination, domain routing |
| S3 Asset Bucket (`_cache/` prefix) | ISR cache (Layer 2), static assets |
| Tag Cache DynamoDB Table | Maps cache tags to page paths (for tag-based revalidation) |
| SQS FIFO Revalidation Queue | Background page regeneration (OpenNext internal) |
| Warmer Lambda | Scheduled every 5 min, prevents cold starts |
| Image Optimization Lambda | On-demand image resizing, cached by CloudFront |
| Debounce Flush Lambda | Every 1 min (10s internal), fires CloudFront invalidation after 15-min debounce |
| Nightly Cache Flush Lambda | 02:00 UTC daily, clears both cache layers |
| Invalidation Status Lambda | GET /system/invalidation — admin UI polling |
| Invalidation Flush Lambda | POST /system/invalidation — "GO LIVE NOW" |
| DynamoDB Marker | SYSTEM#CDN_PENDING — single-row debounce state |
| EventBridge Rules (x2) | Triggers debounce (1/min) + nightly flush (02:00 UTC) |

---

## Cost Analysis

### Steady State (Per 100K Page Views)

> These figures assume the cache is working. Before `cache-1` it was not — the Lambda line
> was **100% miss, not ~5%**. `cache-1` makes the target reachable; the figures below become
> real only once the operator confirms the post-deploy CloudFront check on the staging
> distribution. Two `cache-3` corrections to the entry-count arithmetic: client-side
> navigations and `<Link>` prefetches carry `?_rsc=<hash>`, which is **no longer in the cache
> key**, so they no longer mint one entry per hash — they collapse onto two entries per URL
> (HTML and flight), discriminated by the `RSC` header. And campaign / tracking parameters
> (`?utm_*`, `?fbclid`, `?ref`) no longer mint entries at all; once a URL is warm they are
> answered from its entry with no origin request.

| Component | Cost |
|-----------|------|
| CloudFront transfer | ~$0.085/GB |
| Lambda (cache miss ~5%) | ~$0.08/month |
| S3 cache storage | ~$0.02/month |
| Tag cache DynamoDB | ~$0.05/month |
| SQS revalidation | ~$0.02/month |

### CloudFront Invalidation (Debounced)

| Source | Volume | Cost |
|--------|--------|------|
| Debounce flush | ~4-8/day (one per editing session) | Free |
| Manual "GO LIVE NOW" | ~2-5/day | Free |
| Nightly flush | 1/day | Free |
| **Total** | ~200-400/month | Free (well within 1,000/month free tier) |

Previous design: 50-200 invalidations/day = 1,500-6,000/month. Debounce reduces this by ~10-20x.

### Debounce Lambda

| Item | Value |
|------|-------|
| Invocations | 43,200/month (1/min) |
| Idle duration | ~5ms (1 DDB read) |
| Active duration | up to 60s (when pending) |
| Estimated cost | < $0.10/month |

---

## Deployment Impact on Existing Tenants

### What Happens During `cdk deploy`

1. **Renderer Lambda updated** (`revalidate = false`): Next.js build runs during synth. New code deployed. Existing CloudFront cache still has pages from old build. No disruption — old cached pages continue serving until invalidated.

2. **CloudFront Distribution updated** (new `/api/*` behavior): In-place UPDATE, not REPLACE. No distribution ID change, no downtime. New behavior added alongside existing ones.

3. **New Lambdas created**: DebounceFlushFunc, InvalidationStatusFunc, InvalidationFlushFunc. No impact on existing resources.

4. **New EventBridge Rule created**: DebounceFlushSchedule. Starts polling immediately after deploy. No impact until first mutation writes a marker.

5. **CloudFront IAM removed from mutation Lambdas**: The post-construction grant loop is deleted. Mutation Lambdas lose `RENDERER_DISTRIBUTION_ID` env var and `cloudfront:CreateInvalidation` IAM. Since the HOF no longer calls CloudFront (it writes DDB instead), this is safe.

6. **First mutation after deploy**: Writes `SYSTEM#CDN_PENDING` marker to DDB. Debounce Lambda picks it up within 10 seconds. CloudFront invalidation fires 15 minutes later. Existing cached pages remain unchanged until the invalidation propagates (~30 seconds).

### No Breaking Changes

- Existing pages continue serving from CloudFront cache
- No cache flush on deploy (pages stay warm)
- Admin UI gains the banner (non-blocking — disappears when no pending changes)
- Nightly safety net ensures all stale content is cleared within 24 hours regardless

---

## Monitoring

### Key Metrics

1. **CloudFront Cache Hit Ratio** — Target > 95%. It was structurally ~0% for HTML before `cache-1` (the origin sent `no-store`). After `cache-1` this metric becomes meaningful and is the primary signal that the serving layer is healthy: if it stays near 0%, the origin is still emitting `no-store` and something reintroduced a dynamic API into a cacheable route.
2. **Debounce Lambda Duration** — CloudWatch Logs for `DebounceFlushFunc`. Idle invocations should be < 100ms. Active loops up to 60s.
3. **SYSTEM#CDN_PENDING marker age** — If the marker persists beyond 20 minutes, the debounce Lambda may be failing. Check CloudWatch Logs.
4. **Invalidation Count** — CloudFront console. Should be dramatically lower than before (single digits per day vs. hundreds).

### Deployed Alarms

- Queue depth > 100 messages (3 evaluation periods)
- Lambda error count > 10 per 5 minutes
- Revalidation endpoint error rate

---

## Known Gaps and Tech Debt

1. **ISR cache staleness for non-content mutations**: Reviews, coupons, popups, themes, delivery config, settings — these mutations trigger CloudFront invalidation (Layer 1) via the debounce system, but NOT the S3 ISR cache (Layer 2). The nightly flush covers this. Fix: add `revalidatePath()` or `revalidateTag()` calls to these handlers.

2. **Custom URL prefix ISR revalidation — CLOSED in `cache-2`** for products and categories. The purge now reads the tenant's `urlPrefixes` from the same `GetItem` that resolves the domain and builds `/<domain>/<tenant prefix>/<slug>`. *Still open elsewhere:* nothing purges the `shop`, `cart`, `checkout`, `account` or `search` landing pages, and a product change does not purge the category/shop listings that display it — that is Known Gap 5 (tag-based revalidation), owned by `cache-4`.

3. **Blast radius of `/*` invalidation**: Each debounced flush invalidates ALL tenants on the shared distribution. Fix: per-tenant path invalidation (`/tenantId/*`) or Workstream 3 (dedicated distribution per high-volume tenant).

4. **`content/create.ts` missing ISR revalidation — CLOSED in `cache-2` (code + IAM); takes effect when the track deploys.** Background: the old reasoning ("no stale S3 entry can exist for a URL that didn't exist before") became false with `cache-1` — any request for a not-yet-existing URL stores a **307 → `<path>?nf=1`** in the S3 ISR cache (measured; a redirect is a cacheable outcome — see § *Which render outcomes are cacheable*). So a URL probed before publication *does* leave an entry behind, created by the miss itself. `content/create.ts` now calls `revalidateTenantPaths(tenantId, "page", [slug])` to drop that tail, and `infra/lib/api.ts` grants `CreateContentFunc` the `revalidationSecret.grantRead` it previously lacked (it was the one revalidating handler without it). Both halves are required — code without the grant logs `[Revalidate] No secret available` and purges nothing — so they must ship in the same deploy. Nothing in Track CACHE is deployed yet: the whole track is gated on `cache-3` (H1). Until it deploys, the exposure is the pre-`cache-2` one and is mild: the stored 307 points at the same path and the `?nf=1` twin re-reads, so the visitor still gets the freshly published page (at `…?nf=1`, uncached) until the debounced CloudFront invalidation and the nightly S3 flush clear the redirect.

5. **Tag-based revalidation underutilized**: The infrastructure exists (tag cache DynamoDB table, `/api/revalidate` supports tags, `revalidateTag()` helper exists) but very few handlers use it. This would enable surgical cache invalidation (e.g., invalidate all pages showing a specific product) without the `/*` sledgehammer.

6. **Debounce is global, not per-tenant**: The `SYSTEM#CDN_PENDING` marker is a single row. All tenants share the same debounce timer. A mutation by Tenant A delays Tenant B's pending changes by resetting the timer. Acceptable for shared distribution. Would need per-tenant markers for per-tenant distributions (Workstream 3).

7. **The invalidation machinery became reachable with `cache-1`.** Before it, every mechanism above — debounce, nightly flush, `revalidatePath()`, the admin banner — invalidated caches that held no HTML. It now has real cache entries to clear, which means its known gaps start to have observable consequences. `cache-2` closed gaps 2 and 4 and fixed the ISR purge *key* (domain, not tenant id). Gaps 1, 3, 5 and 6 — non-content mutations, `/*` blast radius, tag-based revalidation, global debounce — remain open and are `cache-4`'s scope.

8. **`renderer/open-next.config.ts` is a defaults-relying stub.** It sets only `default.architecture: 'arm64'` and `buildCommand: 'npm run build'`. The incremental cache, tag cache, and revalidation queue implementations are whatever the installed OpenNext version defaults to — they are not pinned here. (The earlier claim that `open-next` is "not present in `node_modules`" was wrong: it is installed at `node_modules/open-next@3.1.3` and pinned by `package-lock.json`. What is unpinned is the *configuration*, not the version. Defaults observed in the 2026-07-26 build: `incrementalCache: s3`, `tagCache: dynamodb`, `queue: sqs`.)

9. **Content has no delete path at all** (open question, found 2026-07-26). `backend/src/content/` contains `create, get, history, list, restore, update` — there is no `delete.ts`, and `infra/lib/api.ts` registers no `DELETE /content/{id}` route. The earlier note that "`content/delete.ts` is not wrapped by `withInvalidation`" was based on a file that does not exist. Whether content deletion is intentionally absent (soft-delete via status, retention policy) or a genuine gap needs an owner decision; if a delete handler is added later it must be wrapped.

10. **Query-string traffic bypasses the cache at the ORIGIN — narrowed, not closed, by `cache-3`.** `renderer/middleware.ts` still sends every request carrying a query string to the `%5Fdyn` twin, which renders per request. That is deliberate and load-bearing: it is what lets the cacheable route hold zero dynamic APIs. Note what it is *not*: it is not the reason the `cache-3` allowlist is safe. A warm bare-path entry is served at the edge before middleware runs, so the twin's `no-store` never applies to a stripped parameter on a warm URL — the allowlist is safe because of code inspection (nothing reads the non-listed parameters; the cacheable route passes `query={{}}` literally). See § *Why this list is the right list*. What the twin property does buy is that a query-string request can never *populate* an entry. What `cache-3` changed is the *edge*: a non-allowlisted parameter now resolves to the bare-path cache key, so `?utm_*` / `?fbclid` / `?ref` traffic to a **warm** URL is answered at the edge and never reaches the origin at all. Residual: a non-allowlisted parameter arriving at a **cold** URL still costs one twin render and still does not populate the entry. Deliberately not fixed by teaching middleware the same allowlist — that would put the list in two places (CDK + middleware) with nothing keeping them in sync, and the middleware copy failing open is a correctness bug while the CDK copy failing open is only a cache miss.

11. **`new Date().getFullYear()` in the footer is frozen into cached HTML** (`renderer/src/app/[siteId]/layout.tsx`). Not a dynamic API, so it does not break caching — but with `revalidate = false` the copyright year in a cached page only updates on the next invalidation. Harmless in practice (the nightly flush runs on any change), noted so it is not mistaken for a bug later.

12. **Next 16.2.9 emits a duplicated `Location` header for any redirect rendered on an ISR-mode route** (observed 2026-07-26). Both values are identical, and clients and the OpenNext Lambda handle it correctly (`curl -L` follows it; the APIGW response carries `"/x,/x"`). It is not specific to `cache-1`'s `?nf=1` handoff — the pre-existing content-redirect path (`permanentRedirect()` on an `IsRedirect` route) produces the same doubling. Noted so it is not mis-diagnosed as a handoff bug; a strict intermediary that rejects duplicate `Location` would affect both paths equally.

13. **404 traffic is no longer absorbed at the edge** (`cache-1` D3 consequence, ratified). Every not-found costs a cached 307 plus a dynamic render on the twin, so scanner and dead-link traffic now reaches the SSR path and DynamoDB on every request instead of being served a cached 404. This is the deliberate price of never pinning a 404 for a URL that is published later. If 404 volume becomes a cost problem, the fix is a CloudFront-level answer for known-bad paths, not re-caching the 404.

14. **Referral attribution is triggered client-side, and is not consent-gated** (`cache-3`). `components/ReferralCapture.tsx` is a constant inline script in the public site layout; it POSTs the resolved `?ref` / `?utm_source` value to `app/api/ref/route.ts`, which sets the cookie. It replaced a middleware `Set-Cookie` that could not survive the cache-key change (a warm campaign landing is answered at the edge, so the origin never sees the page request). The cookie's own attributes are **unchanged** — `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 30 days — because the write stayed server-side; that is also the migration path, since a `document.cookie` write cannot overwrite the pre-deploy `HttpOnly` cookie (RFC 6265 §5.3 step 11) and would have frozen returning visitors' attribution for up to 30 days. Two known positions remain: capture is **not gated on the `CookieConsent` banner** (it was not gated before either), and the beacon is **fire-and-forget**, so a blocked or failed request silently loses attribution for that visit — the alternative that cannot fail cannot run on a cache HIT at all. If consent gating is wanted, it is a new slice and it applies to the pre-existing behaviour, not to this move.

15. **The session-cookie predicate is deliberately duplicated across CDK and middleware** (`cache-3` revision 3). Gap 10 rejects duplicating the *query* allowlist into middleware, so the asymmetry needs stating: that duplication is avoidable (middleware does not need the list to be correct), this one is not. CloudFront must decide *before* the origin runs — that is the entire point of `x-has-session` — and middleware must decide the rendering mode, which CloudFront cannot do. Neither layer can delegate to the other, so both must implement "does this request carry a session cookie". What gap 10 warns about — *nothing keeping them in sync* — is answered here rather than dismissed: `probe-cache3-cffunc.mjs` §C extracts both predicates (the edge one from the synthesized template) and fails if their classifications diverge on any name in its corpus. **Rejected alternative:** having middleware read the `x-has-session` header instead of the cookie jar. It would remove the duplication, but it makes an origin routing decision depend on a header that is only trustworthy because *another* mechanism (`x-origin-verify`) says the request came through CloudFront, and it breaks outright in local `next start` and any direct-Lambda path where no CloudFront Function ran. A cookie read that works everywhere is worth one tested duplicate.

16. **`_next/image*` does not honour the optimizer's own `Vary: Accept`** (found in `cache-6`, **pre-existing**, not introduced by it). The OpenNext image adapter returns `Vary: Accept` and Next's optimizer picks webp/avif from the request's `Accept` header — but CloudFront does not honour origin `Vary`, and `Accept` is in neither the `ImageCachePolicy` key nor any origin request policy on that behavior, so the optimizer always sees no `Accept` and falls back to the source format. This was equally true under the previous managed `CACHING_OPTIMIZED` policy: `cache-6` changed which query parameters are keyed, not which headers are. **Do not "fix" it by adding `Accept` to the cache key** — raw `Accept` strings are high-cardinality and would fragment every image across browser versions. The real fix, if the bandwidth is worth a slice, is a normalized one-bit-per-format header derived in a viewer-request CloudFront Function, exactly as `x-has-session` is derived (§ *`x-has-session`*). Not scoped; surfaced.

17. **The two CloudFront allowlists have no cross-check against the code that depends on them** (found in `cache-6`). `cache-6`'s two defects — a stripped `x-revalidation-token` and a stripped `?url&w&q` — were both "a header/parameter the application requires is absent from the CDK list", and both survived in production because the only thing pinning either list was the list itself. Assertions `(g)` and `(h)` now pin them, which stops a *regression*; nothing detects the *next* such omission, because nothing derives the required set from the consumers (`revalidate/route.ts`'s header read, the optimizer's `{ url, w, q }` destructure). The `cache-3` `probe-cache3-cffunc.mjs` §C pattern — extract both sides, fail on divergence — is the shape that would; it is not applied here. Deliberately deferred: the consumer side is a Next-internal destructure, so the extraction is fragile in a way the cookie-name comparison is not.
