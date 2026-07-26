# AMODX Caching Architecture

Two-layer cache with debounced on-demand invalidation. No time-based ISR.

---

## Architecture Overview

```
                         LAYER 1                    LAYER 2
User Request ──> CloudFront Edge Cache ──> OpenNext ISR Cache (S3) ──> Server Lambda (SSR)
                      (global PoPs)            (origin region)         (DynamoDB reads)
```

**Layer 1 — CloudFront**: Edge cache at 400+ global points of presence. Cache key includes `X-Forwarded-Host` (tenant isolation) + query strings. Serves HTML with sub-50ms latency on hit.

**Layer 2 — OpenNext ISR**: S3-backed cache in the origin region. When CloudFront misses, the request hits the Lambda Function URL. OpenNext checks S3 first. If cached, it returns the S3 object without running React SSR. If not cached, it renders from DynamoDB and writes the result to S3.

**Both layers must be invalidated for content to refresh.** CloudFront invalidation alone is insufficient — OpenNext would still serve stale S3 objects. S3 flush alone is insufficient — CloudFront would still serve stale edge copies.

---

## Serving contract

The invariant the serving layer must satisfy for either cache layer to hold HTML. Stated in
terms of the behaviour measured on `next@16.2.9` (see **Measured serving behaviour** below),
not in terms of the Next.js documentation.

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
route under `renderer/src/app/api/`, verified by reading all eight
(`account/orders`, `comments`, `consent`, `contact`, `leads`, `posts`, `profile`,
`revalidate`; `auth/[...nextauth]` is NextAuth's own handler). Seven already returned
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

One hazard remains open (**H1**, the `RSC` cache key) and gates the deploy — see
**Open hazards activated by cache-1** below.

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
Productising this into a runnable suite is ROADMAP slice `test-2`, not `cache-1`.

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

### The `RSC` request header changes the response body — and is not in the cache key

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

The problem is downstream: `RendererCachePolicy`
(`infra/lib/renderer-hosting.ts:265`) allowlists **only `X-Forwarded-Host`** as a cache-key
header, and CloudFront does not key on origin `Vary`. See **Open hazards** below.

Next's own client never hits this, because `fetch-server-response.js` always calls
`setCacheBustingSearchParam()`, appending `?_rsc=<hash>` to every prefetch and client
navigation (`node_modules/next/dist/client/components/router-reducer/`). Since the cache
policy keys on all query strings, real RSC traffic gets its own cache entry. Note also that
Next strips `_rsc` before middleware sees the URL, so `request.nextUrl.search` is empty for
those requests and they land on the **ISR** route, not the dynamic twin — verified: an
`?_rsc=…` request returns `x-nextjs-cache: HIT`.

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

Both were invisible before `cache-1`, because nothing was cached. Both became live
behaviours of the serving layer the moment it started caching.

- **H1 is OPEN and gates the deploy.** Its fix is outside the renderer, in CloudFront policy
  (`cache-3`).
- **H2 is CLOSED inside `cache-1`** (middleware host gate + `?nf=1` handoff). It is kept
  here, with its before/after measurements, because the "before" row is what the code
  actually did in production until this slice.

Read both before deploying.

### H1 — the `RSC` header is not in the CloudFront cache key (severity: high)

`RendererCachePolicy` keys on path + all query strings + `X-Forwarded-Host`. The `RSC`
request header is not in the key, but it changes the response body from an HTML document to
a React flight payload (measured above). CloudFront stores whichever variant it saw first
under the bare URL and serves it to everyone.

Normal traffic does not trigger it (Next's client always adds `?_rsc=<hash>`, which *is* in
the key). But **any client can send `RSC: 1` with no query string** — one `curl` — and pin a
`text/x-component` payload at the edge under the page's own URL. Every subsequent visitor
gets raw flight text instead of the page, until the next invalidation (≤15 min via the
debounce marker if some mutation happens, ≤24 h via the nightly flush, otherwise 1 year).

This is availability/defacement, per tenant, not a data-disclosure vector: the flight payload
is the same public content, and no per-visitor state reaches a cacheable render (session
requests go to the dynamic twin).

Fix (`cache-3`, one line): add `RSC`, `Next-Router-Prefetch`, `Next-Router-State-Tree`,
`Next-Router-Segment-Prefetch` to `RendererCachePolicy`'s header allowlist, matching the
origin's own `Vary`.

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

Still not exercised here: the SQS revalidation queue, the DynamoDB tag cache, and behaviour
against real S3 latency/consistency. Those are `cache-2` territory.

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

**File**: `backend/src/lib/revalidate.ts`

Calls the renderer's `/api/revalidate` endpoint with a secret token. This triggers Next.js `revalidatePath()` or `revalidateTag()`, which deletes the specific S3 cache entry.

Currently used by 5 handlers:

| Handler | What it invalidates |
|---------|-------------------|
| `content/update.ts` | Page slug (+ old slug if changed) |
| `products/update.ts` | Product page (+ old slug if changed) |
| `products/delete.ts` | Product page |
| `categories/update.ts` | Category page (+ old slug if changed) |
| `categories/delete.ts` | Category page |

**Limitation**: Uses hardcoded default URL prefixes (`/product`, `/category`). Tenants with custom URL prefixes (e.g., `/produs`) won't get precise ISR invalidation. The nightly flush covers this gap.

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
- ISR cache entries orphaned by mutations that only invalidate CloudFront (Layer 1)
- Edge cases where `revalidatePath()` silently fails
- Tenants with custom URL prefixes that bypass path-based ISR revalidation
- Any cache corruption or drift

On days with zero content changes, the nightly flush skips entirely and cached pages remain warm.

---

## CloudFront Distribution Layout

```
CloudFront Distribution
├── Default Behavior → Lambda Function URL (RendererCachePolicy)
│   └── Cache Key: X-Forwarded-Host + all query strings (tenant isolation)
│
├── api/* → Lambda Function URL (CACHING_DISABLED)
│   └── Comments, account, revalidation — never cached
│
├── _next/image* → Image Optimization Lambda (cached)
├── _next/static/* → S3 (immutable, long-lived cache)
├── assets/* → S3 (immutable, long-lived cache)
└── favicon.ico → S3 (cached)
```

### Cache Policy (Default Behavior)

```typescript
const rendererCachePolicy = new cloudfront.CachePolicy(this, 'RendererCachePolicy', {
    defaultTtl: cdk.Duration.seconds(0),     // Respect origin Cache-Control (s-maxage)
    maxTtl: cdk.Duration.days(365),
    minTtl: cdk.Duration.seconds(0),
    headerBehavior: cloudfront.CacheHeaderBehavior.allowList('X-Forwarded-Host'),
    queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
    cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    enableAcceptEncodingGzip: true,
    enableAcceptEncodingBrotli: true,
});
```

`defaultTtl: 0` means CloudFront defers entirely to the origin's `Cache-Control` header. With `revalidate = false`, OpenNext sends `s-maxage=31536000`, so CloudFront caches for up to 1 year.

### /api/* Behavior

Explicit `CACHING_DISABLED` policy. Without this, API routes (comments POST, account actions, revalidation endpoint) would fall through to the default behavior and get cached — returning stale JSON to authenticated users.

### Multi-Tenant Isolation

A CloudFront Function on viewer request copies the incoming `Host` header to `X-Forwarded-Host`. The cache policy includes `X-Forwarded-Host` in the cache key. Result: `shop-a.example.com/about` and `shop-b.example.com/about` are separate cache entries, even though they share the same CloudFront distribution.

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

This follows the principle of least privilege — CloudFront access is limited to 3 specialized Lambdas instead of 70.

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
> distribution. Note that client-side navigations and `<Link>` prefetches carry `?_rsc=<hash>`
> and so occupy their own cache entries — they are cached, but they roughly double the number
> of distinct entries per page.

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

2. **Custom URL prefix ISR revalidation**: `revalidatePath()` uses hardcoded default prefixes (`/product`, `/category`). Tenants with custom prefixes miss precise ISR invalidation. Fix: fetch tenant config before calling `revalidatePath()`, or switch entirely to tag-based revalidation.

3. **Blast radius of `/*` invalidation**: Each debounced flush invalidates ALL tenants on the shared distribution. Fix: per-tenant path invalidation (`/tenantId/*`) or Workstream 3 (dedicated distribution per high-volume tenant).

4. **`content/create.ts` missing ISR revalidation**: New pages don't call `revalidatePath()`. **Corrected 2026-07-26 — the old reasoning ("no stale S3 entry can exist for a URL that didn't exist before") is false since `cache-1`.** Any request for a not-yet-existing URL now stores a **307 → `<path>?nf=1`** in the S3 ISR cache (measured; the redirect is a cacheable outcome — see § *Which render outcomes are cacheable*). So a URL that is probed before it is published *does* leave an entry behind, created by the miss itself. The consequence is mild by construction: the stored 307 points at the same path, and the twin that serves `?nf=1` re-reads, so the visitor gets the freshly published page — at `…?nf=1`, uncached, until the debounced CloudFront invalidation and the nightly S3 flush clear the redirect. A `revalidatePath()` in `content/create.ts` would drop that tail; `cache-2` owns it.

5. **Tag-based revalidation underutilized**: The infrastructure exists (tag cache DynamoDB table, `/api/revalidate` supports tags, `revalidateTag()` helper exists) but very few handlers use it. This would enable surgical cache invalidation (e.g., invalidate all pages showing a specific product) without the `/*` sledgehammer.

6. **Debounce is global, not per-tenant**: The `SYSTEM#CDN_PENDING` marker is a single row. All tenants share the same debounce timer. A mutation by Tenant A delays Tenant B's pending changes by resetting the timer. Acceptable for shared distribution. Would need per-tenant markers for per-tenant distributions (Workstream 3).

7. **The invalidation machinery became reachable with `cache-1`.** Before it, every mechanism above — debounce, nightly flush, `revalidatePath()`, the admin banner — invalidated caches that held no HTML. It now has real cache entries to clear, which means its known gaps (items 1–6 above) start to have observable consequences. `cache-2` covers the invalidation work.

8. **`renderer/open-next.config.ts` is a defaults-relying stub.** It sets only `default.architecture: 'arm64'` and `buildCommand: 'npm run build'`. The incremental cache, tag cache, and revalidation queue implementations are whatever the installed OpenNext version defaults to — they are not pinned here. (The earlier claim that `open-next` is "not present in `node_modules`" was wrong: it is installed at `node_modules/open-next@3.1.3` and pinned by `package-lock.json`. What is unpinned is the *configuration*, not the version. Defaults observed in the 2026-07-26 build: `incrementalCache: s3`, `tagCache: dynamodb`, `queue: sqs`.)

9. **Content has no delete path at all** (open question, found 2026-07-26). `backend/src/content/` contains `create, get, history, list, restore, update` — there is no `delete.ts`, and `infra/lib/api.ts` registers no `DELETE /content/{id}` route. The earlier note that "`content/delete.ts` is not wrapped by `withInvalidation`" was based on a file that does not exist. Whether content deletion is intentionally absent (soft-delete via status, retention policy) or a genuine gap needs an owner decision; if a delete handler is added later it must be wrapped.

10. **Query-string traffic bypasses the cache entirely** (`cache-1` design consequence, ratified). Every request with a query string goes to the `%5Fdyn` twin and renders per request — including campaign links (`?utm_*`, `?ref`) and the referral-cookie path. This is deliberate: it is what lets the cacheable route hold zero dynamic APIs. `cache-3`'s query-string allowlist is the fix; until then, a tenant whose traffic is mostly campaign links gets little benefit from `cache-1`.

11. **`new Date().getFullYear()` in the footer is frozen into cached HTML** (`renderer/src/app/[siteId]/layout.tsx`). Not a dynamic API, so it does not break caching — but with `revalidate = false` the copyright year in a cached page only updates on the next invalidation. Harmless in practice (the nightly flush runs on any change), noted so it is not mistaken for a bug later.

12. **Next 16.2.9 emits a duplicated `Location` header for any redirect rendered on an ISR-mode route** (observed 2026-07-26). Both values are identical, and clients and the OpenNext Lambda handle it correctly (`curl -L` follows it; the APIGW response carries `"/x,/x"`). It is not specific to `cache-1`'s `?nf=1` handoff — the pre-existing content-redirect path (`permanentRedirect()` on an `IsRedirect` route) produces the same doubling. Noted so it is not mis-diagnosed as a handoff bug; a strict intermediary that rejects duplicate `Location` would affect both paths equally.

13. **404 traffic is no longer absorbed at the edge** (`cache-1` D3 consequence, ratified). Every not-found costs a cached 307 plus a dynamic render on the twin, so scanner and dead-link traffic now reaches the SSR path and DynamoDB on every request instead of being served a cached 404. This is the deliberate price of never pinning a 404 for a URL that is published later. If 404 volume becomes a cost problem, the fix is a CloudFront-level answer for known-bad paths, not re-caching the 404.
