# CACHE-1: Restore static/ISR rendering for public pages

- **Status:** SHIPPED 2026-07-28 — deployed to production by the human, verified live (staging probe suite + prod probes: bijup.com s-maxage/Hit/age, session bypass, nf no-loop)
  missing `TABLE_NAME` and `/api/posts` now fail loudly too, measured under `next start` and
  through the built OpenNext Lambda. Deploy still gated on `cache-3` — H1.)*

## Ratified resolutions (human, 2026-07-26)

- **H1 → widen `cache-3`, gate deploy.** `cache-3` scope now includes adding the `RSC`,
  `Next-Router-Prefetch`, `Next-Router-State-Tree`, `Next-Router-Segment-Prefetch`
  request headers to the CloudFront cache key. **cache-1 must not deploy before cache-3**
  (or in the same deploy). No middleware stopgap.
- **D3 → not-found responses MUST reach a dynamic, non-cacheable path** (the stricter
  option; "accept cached genuine 404s" was explicitly rejected). Mechanism constraints:
  - **Unknown tenant host** (also fixes the soft-200): middleware holds a short-TTL
    in-memory cache of wired tenant domains (same host→config lookup the renderer
    already performs; ≤99 tenants) and returns `404` + `no-store` directly for unknown
    hosts. TTL is a builder-recorded local choice (~60s order).
  - **Known tenant, missing page**: smallest mechanism that keeps the ISR-hit path at
    **zero DynamoDB reads** (the measured property this slice exists to deliver). If
    measurement shows a non-cacheable known-tenant 404 cannot be had without adding
    reads to the ISR-hit path, STOP and report the measured options — do not silently
    trade away either property.
- **D4 → operational read failures THROW, everywhere (ratified 2026-07-26).** All
  renderer data-read helpers propagate AWS/operational errors; `null`/empty return
  values mean **genuine absence only**. No render-mode parameter, no dual semantics
  (option 2 rejected): a 500 is the one outcome ISR never caches, so a transient
  failure can never pin an empty catalog/reviews/post-grid 200 (or a year-lived 307)
  at the edge. Applies to every helper reachable from a render — `dynamo.ts` lookups
  and lists, reviews, post grids — not just `getTenantConfig()`. Evidence: a probe
  failing a read AFTER tenant resolution must yield 500 with no Cache-Control and
  nothing stored.
- Live-tenant rule (operator directive 2026-07-26): this slice must ship with explicit
  deploy order, staging header-probe verification, and a rollback note (previous-build
  redeploy + `/*` and `_cache/` flush) in its deployment section.
- **Track:** CACHE — serving-layer remediation
- **Depends:** none
- **Blocks deploy on:** `cache-3` adding the `RSC` header family to the CloudFront cache key
- **Source:** `docs/caching-architecture.md` (intended design); code audit 2026-07-26 (defect)
- **Maturity target:** MATURE (serving contract, verified against deployed distribution)

## Revise run 2026-07-26 (D3 + OpenNext verification) — outcome

The D2 run below stands; this run adds the two D3 mechanisms, the OpenNext check that was
skipped, and the doc corrections. Everything is measured with response headers, twice — once
via `next build` + `next start`, once by driving the built OpenNext Lambda bundle with
synthetic API Gateway v2 events.

| Probe | Result |
|---|---|
| unknown tenant host | `404` + `private, no-store`, answered by middleware, no render — **soft-200 gone** |
| unknown tenant host, 2nd request | 0 DynamoDB calls (60 s verdict cache); 1 call on the first |
| published page, 2 consecutive cached views | **0 DynamoDB calls** — the host gate does not cost the ISR-hit path a read |
| known tenant, missing page | `307` → `/path?nf=1` (cacheable) → twin → `404` + `private, no-cache, no-store` |
| `/tenant/<bad-id>`, `/_site/<bad-id>` | `404` + `no-store` (was a 200 shell) |
| DynamoDB unreachable, uncached page | `500`, **no `Cache-Control` header** → nothing stored; recovers on the next request |
| OpenNext Lambda: published page | `200`, `s-maxage=31536000`, S3 GET (miss) then **PUT** |
| OpenNext Lambda: twin (`?page=2`, `?nf=1`) | `no-store`, **no S3 access** |
| OpenNext Lambda: unknown host | `404` + `private, no-store` — the middleware gate runs inside OpenNext |

- **D3(a)**, unknown host: `renderer/src/lib/tenant-directory.ts` + one gate in
  `middleware.ts`. 60 s per-instance verdict cache (builder's choice, recorded), 512-entry
  bound because `Host` is attacker-controlled, **fails open** on any lookup error.
- **D3(b)**, known tenant / missing page: `renderer/src/lib/not-found-handoff.ts`. The
  cacheable route redirects to its own URL + `?nf=1`; the existing "any query string goes to
  the twin" rule does the rest, so no new middleware rule. Cost, accepted: 404s are no longer
  absorbed at the edge (a cached 307 plus a dynamic render each), and the visitor's URL bar
  shows `?nf=1` on a 404.
- **Found while implementing D3, and fixed:** `getTenantConfig()` caught AWS errors and
  returned `null`, which is the same value as "no such tenant". With `cache-1` making that
  answer cacheable, one transient DynamoDB error would have pinned a "Site Not Found" page at
  the edge for a live tenant. It now lets the error throw — a 500 is the only outcome ISR mode
  never caches. Flagged rather than silently landed: this is one line outside the ratified
  text, but leaving it would have made the ratified change actively worse.
- **OpenNext**: `open-next@3.1.3` **is** installed (root `node_modules`, in the lockfile) —
  the previous run's claim that it was absent was false. `npx open-next build` completes on
  this Next 16.2.9 / Turbopack build, honours `revalidate = false`, writes ISR entries to the
  S3 cache keyed by host, and bundles the middleware including its DynamoDB client. Details:
  `docs/caching-architecture.md` § *`open-next@3.1.3` vs Next 16 — VERIFIED*.
- **D2 item 6 — AMENDED** (operator decision 2026-07-26): admin preview links that use the
  tenant's real domain with `?preview=true` are acceptable and the admin pages are unchanged.
  Any query string routes the request to the dynamic twin, so the flag never reaches a
  cacheable render — probe: `?preview=true` returns `200` + `private, no-cache, no-store` and
  renders drafts (row 5 of the D2 table below).

## Revise run 4 — 2026-07-26 (D4 has no carve-outs) — outcome

Review 1 accepted the 19-helper change but rejected both exemptions the previous run had
*surfaced rather than fixed*. Both are now closed, and the two claims that were wider than the
code are now true rather than trimmed.

| Reviewer item | Resolution |
|---|---|
| 1. missing `TABLE_NAME` still produced absence-shaped values in 18 helpers; `hasActivePopups()` fell back to `NEXT_PUBLIC_TABLE_NAME` or the literal `"amodx-table"` | One `requireTableName()` in `lib/dynamo.ts` throws; all 19 helpers call it, the fallback chain is deleted, and config is validated **before** legitimate empty-input short-circuits (`searchProducts()`'s blank query) |
| 2. `/api/posts` turned a DynamoDB failure into `200 {items: []}` | `500` on a read failure or missing `TABLE_NAME`, `400` on a missing `x-tenant-id`; `{items: []}` now means *the query matched nothing* |
| 3. docs claimed more than the code did | `docs/caching-architecture.md` § *Failed reads throw* rewritten (carve-out paragraph replaced by the rule and its reasoning); `renderer/ARCHITECTURE.md` § *Direct DynamoDB Access* updated; `docs/security-remediation-status.md` note extended |
| 4. rerun build + probes with the new coverage | EXECUTED — see below and `docs/caching-architecture.md` § *Probe: a missing `TABLE_NAME`, and `/api/posts`* |

**Why the configuration/read distinction did not survive.** The previous run argued a missing
`TABLE_NAME` is a predicate evaluated before any I/O, so not a read failure. True, and
irrelevant: the *artefact* is identical — a renderable, storable page asserting absence — and
the cause being permanent rather than transient makes it worse. One unset environment variable
would have pinned a not-found shell for all 99 tenants until someone invalidated. A renderer
that cannot name its table cannot answer *does this record exist?*, so it must not answer *no*.

**Why `/api/*` being uncached did not exempt `/api/posts`.** D4 as ratified is a rule about
not inventing absence; the cache is why it was noticed, not the boundary of where it applies.
`PostGridRender.tsx` already renders an error state for a non-2xx response, so the only thing
the old `200 {items: []}` bought was a failure that looked like an empty blog. All eight routes
under `app/api/` were read: the other seven already answered 4xx/5xx, so the doc's blanket
`/api/*` claim is now accurate by verification, not by narrowing.

**Evidence** (`probe-harness/probe-config-and-api.sh`, new; starts and stops its own server
on port 3112 because `TABLE_NAME` is process-level env). With `TABLE_NAME` blank: an existing
published page → `500`, no `Cache-Control`, no ISR entry, and no ISR directory for the host at
all; `sitemap.xml` → `500`; `/api/posts` → `500`. Restored → the same page is `200` `MISS` then
`HIT` with `s-maxage=31536000`. Phase 4 covers `hasActivePopups()`, the one changed helper the
other probes never reach (`layout.tsx` calls it only when `NEXT_PUBLIC_API_URL` is set): with
the variable set, the render is `200` and the stub reports the only `TableName` ever addressed
is `probe-table` — `"amodx-table"` never appears; with `TABLE_NAME` blank the same request is a
`500` with **zero** DynamoDB calls. Reproduced through the built OpenNext Lambda: `500`s, S3
`GET → MISS` with **no `PUT`**, then `GET → MISS` + `PUT` once the variable is restored.

**Abstraction accounting.** One added: `requireTableName()`, a private 8-line function in
`lib/dynamo.ts`. Concrete current users: all 19 exported read helpers in that file. Axis of
variation: none — it exists to make one decision (unconfigured ⇒ throw) unrepeatable rather
than to vary. Simpler alternative rejected: `throw` inlined at each of the 19 sites, which is
the same behaviour in 19 places that must not drift, and which is exactly how the pre-existing
`hasActivePopups()` fallback managed to differ from its 18 siblings unnoticed. Not extracted to
a module or injected: it has one file's worth of callers and no second implementation.

## Revise run 3 — 2026-07-26 (D4: failed reads throw, repo-wide) — outcome

The only open item from review 1. Ratified as option 1: **all** renderer read helpers
propagate operational failures; `null`/`[]` means genuine absence only; no render-mode
parameter and no dual semantics.

**Scope, verified end to end rather than taken from the reviewer's list.** Every function in
`renderer/src/lib/dynamo.ts` was checked, not only the six the review named. Counted from the
pre-slice baseline (`git show HEAD:renderer/src/lib/dynamo.ts | grep -c "^    } catch"` → 19):
**19** helpers swallowed AWS errors; `getTenantConfig()` was fixed in the D2 run, and this run
fixed the remaining **18**. The review's line ranges covered 10 of them; the other **8** were
found by reading the file end to end and are `getDeliveryConfig`, `getOrderForCustomer`,
`getCustomerOrders`, `getCustomerProfile`, `getPublishedContent`, `getProductsForFeed`,
`getFormBySlug`, `hasActivePopups`.
`grep -n catch src/lib/dynamo.ts` now returns three hits — the file-header
rule, a comment, and the one surviving `catch`, which is `mapTenant()`'s `JSON.parse(theme)`
fallback for a legacy persisted shape. That one stays: the record was already retrieved
successfully, so it is data-shape tolerance, not a read failure.

Two of those unlisted ones matter on their own. `hasActivePopups()` is called from
`layout.tsx`, i.e. on the cacheable path: swallowing there pinned a year-long render with the
tenant's popups silently switched off. `getPublishedContent()` / `getProductsForFeed()` back
`sitemap.xml` and `openai-feed`, which set their own `s-maxage` — swallowing there served
search engines a cached, well-formed, **empty** sitemap for an hour (measured below).

Completeness basis for "these are all the render-reachable reads" (deterministic greps over
`renderer/src`, not an index or an embedding search):

| Check | Result |
|---|---|
| `grep -rln "DynamoDBClient\|S3Client\|SecretsManagerClient" src/` | `lib/dynamo.ts`, `lib/tenant-directory.ts`, `lib/api-client.ts`, `app/api/posts/route.ts` |
| `grep -rn "lib/dynamo" src/` | 4 site route handlers, 6 `/api/*` handlers, `layout.tsx`, `SitePage.tsx`, `ProductByIdPage.tsx` |
| every file under `components/` doing `await fetch(` | all 7 carry `"use client"` — browser fetches, never part of a cached server render |

Three read surfaces were examined and deliberately left alone, each for a stated reason:

- `lib/tenant-directory.ts` — middleware host gate, **fails open by design** (D3). A blip
  there must degrade to "render it", not "404 every tenant". The render repeats the lookup
  and now throws, so the failure still surfaces one layer later, uncached.
- `lib/api-client.ts` — Secrets Manager, reached only from `/api/*` POST handlers, which sit
  behind `CACHING_DISABLED` and are never stored.
- `app/api/posts/route.ts` — returns `{items: []}` with HTTP 200 on error. Same defect
  *shape*, but it is an `/api/*` route under `CACHING_DISABLED`, so nothing it emits is ever
  stored and D4's cache-pinning rationale does not reach it. **Surfaced, not silently fixed:**
  changing it to a 500 alters client-component behaviour (`PostGrid`) with no cache benefit.
  Recorded in the build report as a candidate for a separate slice.
  → **SUPERSEDED by revise run 4:** review rejected the carve-out; the route now answers
  `500` / `400`. See below.

Also flagged, not changed: the `if (!process.env.TABLE_NAME) return null` guards. Those are a
configuration predicate evaluated before any I/O, and CDK always sets `TABLE_NAME`
(`infra/lib/renderer-hosting.ts`). Reasoning in `docs/caching-architecture.md` § *Failed reads
throw*.
→ **SUPERSEDED by revise run 4:** review rejected the configuration/read distinction; the
guards are gone and a missing `TABLE_NAME` throws. See below.

**Evidence — measured twice, against the pre-D4 build and the current one.** The probe
(`probe-harness/probe-failed-read.sh`, new stub control `/__ctl/fail-content-on`) keeps the
tenant lookup healthy and fails everything downstream, which is the case the earlier
"DynamoDB down" probe could not reach. Full table in `docs/caching-architecture.md`
§ *Probe: a read that fails AFTER tenant resolution*. The decisive row: pre-D4, a transient
failure on a page that **exists** stored a `307 → ?nf=1` with `s-maxage=31536000`, and after
the read recovered that URL still answered `307` with `x-nextjs-cache: HIT` — the blip
outlived itself. Post-D4 the same request is a `500` with no `Cache-Control`, nothing is
written to the ISR cache, and the next request renders `200` and caches. Reproduced through
the built OpenNext Lambda: `GET → MISS` and **no `PUT`** during the failure, `GET → MISS` then
`PUT` after recovery.

No new abstraction was introduced by this run — the change is the removal of 18 `try/catch`
wrappers plus comments. Nothing to account for.

## Revise run 2 — 2026-07-26 (reviewer items 1–5) — outcome

| Reviewer item | Resolution |
|---|---|
| 1. cacheable 404 still reachable from `layout.tsx:78` | **Fixed in code, no stop report needed.** The layout no longer decides the outcome — see below. |
| 2. probe the host-verdict transition | **EXECUTED**, both via `next start` and through the built OpenNext Lambda. Table in `docs/caching-architecture.md` § *Probe: the host-verdict transition*. |
| 3. four documentation ripples | All four corrected (H1/H2 status intro, the false "TTL bounds the cached 404" claim, known gap 4's create-after-miss, the stale `getTenantConfig()` comment in `not-found-handoff.ts`). |
| 4. lint evidence was wrong | Re-measured against a HEAD baseline; corrected numbers below. |
| 5. abstraction accounting | Recorded below. |

**Item 1 — the fix.** `app/[siteId]/layout.tsx` is shared by the ISR route and the `%5Fdyn`
twin and receives only `{ siteId }`. It therefore knows neither the rendering mode nor the
requested path, so it can pick neither `notFound()` nor the `?nf=1` handoff, and cannot build
the handoff's `Location`. It now renders `{children}` bare when `getTenantConfig()` returns
`null` and lets the page below — which repeats the same lookup and knows both facts — answer
through `notFoundOrHandoff()`. Rendering `children` is load-bearing: a layout that returns
early never invokes the page function, which is exactly how the original HTTP-200 "Site Not
Found" shell suppressed the page's own `notFound()`.

Measured for that path (EXECUTED, `next build` + `next start`, host-gate queries counted
separately from renderer reads so the transition is provably the warm-verdict case):
`307 → /<path>?nf=1` (stored) → twin → `404` + `private, no-cache, no-store`. Zero stored
404s on disk; an already-cached page keeps serving `200` + `HIT` with **0** DynamoDB calls;
with the tenant restored the stored 307 is self-healing. Reproduced identically through the
OpenNext Lambda bundle against a local S3 stub.

**Item 4 — lint, corrected.** The previous report's "0 problems" was wrong.

```
cd renderer && npx eslint --no-warn-ignored middleware.ts \
  'src/app/[siteId]/layout.tsx' 'src/app/[siteId]/[[...slug]]/page.tsx' \
  'src/app/[siteId]/products/[productId]/page.tsx' \
  'src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx' \
  'src/app/[siteId]/%5Fdyn/products/[productId]/page.tsx' \
  src/components/SitePage.tsx src/components/ProductByIdPage.tsx \
  src/lib/not-found-handoff.ts src/lib/tenant-directory.ts src/lib/dynamo.ts
→ 120 problems (110 errors, 10 warnings)
```

Baseline, same rules, the pre-slice (`HEAD`) versions of the same code linted in a temp
directory: **110 errors, 10 warnings**, with an identical per-file and per-rule split
(old catch-all page 58 E / 4 W → `SitePage.tsx` 58 E / 4 W; `dynamo.ts` 51 E / 3 W unchanged;
`layout.tsx` 1 E; old product page 0 E / 3 W → `ProductByIdPage.tsx` 0 E / 3 W;
`middleware.ts` 0). **Delta introduced by this slice: zero.** All 120 are pre-existing
`no-explicit-any` / `no-unused-vars` / `no-img-element` violations that moved verbatim with
the extracted render bodies. The four genuinely new files (`not-found-handoff.ts`,
`tenant-directory.ts`, and both `%5Fdyn` shells) report **no problems at all**. Renderer-wide
`npx eslint` is red independently of this slice: 601 errors / 13 962 warnings.

**Item 5 — abstraction accounting.** One line each, per the repo's standing rule.

- `components/SitePage.tsx` (+ `SitePageInput` DTO, `toSiteQuery`) — extracted page-render
  body. Current users: `[siteId]/[[...slug]]/page.tsx` and `[siteId]/%5Fdyn/[[...slug]]/page.tsx`
  (two concrete callers, both existing today). Axis of variation: **rendering mode** —
  Next decides it per route at build time, so the two callers cannot be one file. Rejected
  simpler alternative: duplicating the ~600-line body into both routes (real duplication of
  non-trivial logic, and the two copies would drift silently).
- `components/ProductByIdPage.tsx` (+ `ProductByIdInput`) — same abstraction, same two-caller
  justification, for the legacy by-ID product route. Rejected: folding it into `SitePage`,
  which would couple two unrelated URL schemes to make one fewer file.
- `lib/tenant-directory.ts` (`isWiredTenantHost`) — host→"tenant exists?" lookup. Current
  user: `middleware.ts`, one caller. Axis of variation: **runtime**, not policy — the edge
  runtime has no default AWS credential provider chain (measured: `Error: Credential is
  missing`), so this cannot be `lib/dynamo.ts`. Rejected simpler alternative: calling
  `getTenantConfig()` from middleware — it does not work there, and it would drag the whole
  data layer plus `@amodx/shared` into the edge bundle for a `Select: COUNT` query.
- `lib/not-found-handoff.ts` (`notFoundOrHandoff`) — one function, two branches. Current
  users: `SitePage` (7 call sites) and `ProductByIdPage` (3). Axis of variation: **cacheable
  vs. not**, which is a property of the caller's route, not of the failure. Rejected simpler
  alternative: an inline `if (cacheable) redirect(...) else notFound()` at each of the 10
  sites — same logic, ten places to get the `?nf=1` separator and the public-path rule wrong.
- Route segment `app/[siteId]/%5Fdyn/**` — not an abstraction but a second route; it exists
  because Next 16.2.9 has no per-request escape from ISR mode (a dynamic API there is a hard
  500, measured). Rejected: `cacheComponents`/PPR on one route — unsupported by
  `open-next@3.1.3`.

## Build run 2026-07-26 (D2) — outcome

Implemented: DoD 1, 2, 3, 5, 6 and the doc truth-ups. **DoD 4 is partially met** — the docs
are corrected, but the ratified sub-requirement "`notFound()` must not produce a cacheable
404" was measured to be unachievable inside a route in ISR mode and is carried as
`CACHE-1-D3`.

Measured with `next build` + `next start` against the real routes, using a local DynamoDB
stub (no staging access) — headers, not route-table markers:

| Probe | Result |
|---|---|
| published page, no query, no session | `200`, `s-maxage=31536000`, `x-nextjs-cache: MISS` → `HIT` |
| same page, second hit | **zero DynamoDB calls** at the origin |
| `?page=2` | `200`, `private, no-cache, no-store, …` (dynamic twin) |
| `Cookie: next-auth.session-token=…` | `200`, `private, no-cache, no-store, …` (dynamic twin) |
| `?preview=true` on the real domain | `200`, no-store, renders — admin preview links keep working |
| `/_site/<id>` preview | `200`, no-store, `Set-Cookie: amodx_preview_base` still set |
| `/_site/<id>` from a production host | `403` — the host restriction is unchanged |
| `/tenant/<id>` test mode | `200`, no-store |
| `/_dyn…` from the wire | `404` + `private, no-store` — twin is not publicly reachable |
| legacy `/products/<id>` | `200`, `s-maxage=31536000`, `MISS` → `HIT` |
| known tenant, missing page | `404` + `s-maxage=31536000`, `MISS` → `HIT` — **H2, closed by the D3 run above** |
| unknown tenant host | **`200`** + `s-maxage=31536000`, `MISS` → `HIT` — **H2, closed by the D3 run above** |

Two hazards this slice activated are written up in `docs/caching-architecture.md`
§ *Open hazards activated by cache-1*. H2 is now closed in-slice; **H1 remains open and
gates the deploy**:

- **H1 (high, blocks deploy):** the `RSC` request header changes the response body
  (HTML ↔ flight payload) but is not in `RendererCachePolicy`'s cache key, so any client
  can pin a flight payload at the edge under a page's own URL. Fix is four header names in
  the CloudFront allowlist — `cache-3`, whose scope must be widened to include it.
- **H2 (medium, `CACHE-1-D3`) — CLOSED 2026-07-26.** Not-found responses were cacheable, and
  the unknown-tenant path was additionally a soft 404 (HTTP 200). D2's assumption — that a
  route could emit a non-cacheable 404 — was wrong; the fix moves both cases off the
  cacheable route instead (middleware gate + `?nf=1` handoff). See the revise-run table
  above.

## Superseded blocking finding (build run 2026-07-26, D1) — resolved by the D2 ratification below

**Shipped in this run:** DoD 4, DoD 5, and the `renderer/ARCHITECTURE.md` truth-up.
**Blocked:** DoD 1, 2, 3, 6 — the code change. No renderer code was modified.

The audit that produced this slice was correct that the catch-all invokes dynamic APIs
unconditionally. It was wrong about the remedy. Two facts were measured on this repo's
`next@16.2.9` build (throwaway probe routes, `next build` + `next start`, response headers
read; probes deleted afterwards — full matrix in `docs/caching-architecture.md`
§ *Measured serving behaviour*):

1. **Removing the dynamic-API calls is not sufficient.** A route with an un-enumerated
   dynamic segment (`[siteId]`) and no `generateStaticParams()` is rendered dynamically and
   returns `no-store` *even with zero dynamic APIs and `revalidate = false`*. A probe route
   whose entire body was `await params` still returned
   `Cache-Control: private, no-cache, no-store`. Adding `generateStaticParams() { return [] }`
   flips it to `s-maxage=31536000` with `x-nextjs-cache: MISS → HIT` and prerenders nothing
   at build time. This contradicts this slice's **Non-scope** line "No `generateStaticParams`
   / build-time prerender", which as written forbids the only available enabler.

2. **Design step 2 — "push remaining `searchParams` reads down into the specific view
   branches that need them ... so only those renders go dynamic" — does not work.** Once a
   route is in ISR mode, a dynamic API call in any branch returns **HTTP 500** for that
   request. Next 16.2.9 does not convert the `DynamicServerError` into a per-request dynamic
   render. Measured on the exact `[siteId]/[[...slug]]` shape: the static branches served
   `s-maxage=31536000`, the `await searchParams` branch 500'd, the `cookies()` branch 500'd.

Consequence: the parameterized carve-outs (`shop`/`search`/`category` pagination,
`checkout-confirm ?id&email`, `checkout-track ?email`, `generateMetadata`'s `?q`) **and** the
`cookies()`-based access gate for non-`Public` pages cannot remain on a cacheable route.
They must move to a separate dynamic route or read their input client-side. Because the
commerce prefixes are tenant-configurable at runtime (`config.urlPrefixes`), they cannot be
distinguished by a static route segment — so the split needs a new discriminator, which is a
design decision beyond this slice's ratified scope.

Also found, and load-bearing for whatever is ratified next: in ISR mode a `notFound()`
render returns **HTTP 404 with `s-maxage=31536000`**. A request for a not-yet-wired tenant
domain would pin a 404 at the edge for a year. Any move to ISR must make the
tenant-not-found path non-cacheable.

Two corrections to this slice's own text, for whoever re-plans it:

- The Evidence gate "route table shows the public catch-all as `●`/`○`, NOT `ƒ`" is not a
  valid check. A route with an un-enumerated dynamic segment prints `ƒ` regardless of
  whether it touches a dynamic API — `ƒ` reports the *mode*, not code cleanliness. The
  trustworthy gate is the response `Cache-Control` / `x-nextjs-cache` headers.
- The design's route path `renderer/src/app/_preview/...` is **not routable**. Next.js
  treats a leading-underscore folder as a private folder excluded from routing (measured:
  `app/_probe2/[id]` did not appear in the route table; `app/%5Fprobe3/[id]` appeared as
  `/_probe3/[id]`). A literal `_preview` URL segment requires the directory `%5Fpreview`.

See the build report for the decision matrix (`CACHE-1-D2`).

## Defect being fixed

The entire two-layer cache described in `docs/caching-architecture.md` is inert for HTML.
Every public page view runs full React SSR + DynamoDB reads, because the catch-all route
unconditionally invokes Next.js dynamic APIs, which forces per-request dynamic rendering
and a `no-store` Cache-Control — so neither OpenNext ISR (S3) nor CloudFront caches
anything:

- `renderer/src/app/[siteId]/[[...slug]]/page.tsx:154` — `await searchParams` (preview flag)
- `page.tsx:161` — `getPreviewBase()` → `cookies()` unconditionally (`renderer/src/lib/routing-server.ts`)
- `page.tsx` `generateMetadata` (~line 114) — `await searchParams`
- `renderer/src/app/[siteId]/products/[productId]/page.tsx:31` — same pattern

`export const revalidate = false` is present but has no effect on a dynamic render.

## Serving contract (the invariant this slice establishes)

**A public, published, non-parameterized page render must not invoke any Next.js dynamic
API** (`cookies()`, `headers()`, `await searchParams`, `unstable_noStore`). Such renders
must produce `Cache-Control: s-maxage=31536000, stale-while-revalidate` (via
`revalidate = false`) so both OpenNext ISR and CloudFront cache them.

Accepted carve-outs (stay per-request dynamic, by design):

- **Preview / test-mode traffic** (`/_site/`, `/tenant/` prefixes).
- **Parameterized commerce/list views** that genuinely read query params
  (pagination `page`, search, filters — the `sp` reads at page.tsx:213–322).
- Draft/unpublished content checks that require auth context.

## Design D2 (ratified 2026-07-26, superseding D1 after its refutation-by-measurement)

Two routes, discriminated in middleware — option (A) of `CACHE-1-D2`:

1. **ISR route** = the existing catch-all `[siteId]/[[...slug]]` (and
   `products/[productId]`): add `export function generateStaticParams() { return [] }`
   (opts the route into the full-route cache; prerenders nothing, no build-time data
   access) and make it contain **zero dynamic-API calls on any reachable path** —
   including `generateMetadata` and the shared `[siteId]/layout.tsx`. `preview` is
   always false; the access gate receives `sessionToken: null` as a prop.
2. **Dynamic twin route**: a `force-dynamic` route serving the same shared render
   component. Constraint: a leading-underscore directory is NOT routable (measured);
   use a routable internal segment (e.g. directory `%5Fdyn` for a literal `_dyn` URL
   segment, or another collision-safe name — builder's local choice, recorded in the
   build report). Preview (`/_site/`), test mode (`/tenant/`), and all
   per-request-input views route here.
3. **Middleware discriminates**: rewrite to the dynamic twin when the request has a
   query string OR a NextAuth session cookie (both readable in middleware without DB
   calls); otherwise rewrite to the ISR route as today. Preview/test prefixes always go
   dynamic. The access gate for non-Public pages takes the session as a prop (dynamic
   route passes it; ISR route passes null) — this also removes the latent
   cache-poisoning hazard of `cookies()` inside a cacheable render.
4. **`notFound()` must not produce a cacheable 404** on the ISR route (measured hazard:
   404 pinned at the edge for a year for a not-yet-wired domain). In-scope: make the
   tenant-not-found / page-not-found path non-cacheable (e.g. serve it via the dynamic
   twin or an explicit no-store response) and prove it with a header probe.
5. Shared render body: ONE component both routes call with plain props
   `{ preview, basePath, sessionToken }`. No duplicated render logic.
6. `?preview=` query support on the public route is removed (query-string requests go
   dynamic anyway, but the flag must not leak into cacheable renders). Admin preview
   links go through `/_site/` (verify `admin/src/pages/{Categories,ContentList,Products}.tsx`).

Accepted consequences (ratified): `?utm_*`/`?ref` traffic bypasses cache until cache-3's
allowlist lands; logged-in visitors always get SSR (session cookie → dynamic twin).
Future track (not this slice): Next 16 `cacheComponents`/PPR after an open-next upgrade —
option (C) — would restore mixed static/dynamic on one route.

## Non-scope

- No change to invalidation machinery (debounce, nightly, revalidatePath) — `cache-2`.
- No CloudFront policy changes (query-string allowlist, cookies) — `cache-3`.
- No build-time prerendering of real pages (`generateStaticParams()` returning `[]` is
  ratified and required; enumerating real params is not).
- No open-next upgrade / PPR adoption (future track).
- No fix to `hasActivePopups()` per-render DDB read in layout — it becomes amortized by
  ISR automatically once this slice lands.

## Architectural boundaries

- Tenant isolation unaffected: cache keying by `X-Forwarded-Host` (CloudFront) and
  rewritten path (ISR) is unchanged.
- No backend or infra changes.
- Preview security check (allowed hosts for `/_site/`) stays in middleware, unchanged.

## Risks / open questions to resolve in-slice

- **open-next@3.1.3 vs next@^16 compatibility — RESOLVED, compatible.** `npx open-next build`
  completes on this Next 16.2.9 / Turbopack build; the built Lambda honours
  `revalidate = false` (`s-maxage=31536000`), writes ISR entries to the S3 cache keyed by
  host, leaves the dynamic twin untouched, and bundles the middleware including its DynamoDB
  client. Measured by invoking the built handler — see `docs/caching-architecture.md`
  § *`open-next@3.1.3` vs Next 16 — VERIFIED*. No upgrade needed for this slice; PPR /
  `cacheComponents` still is not available on 3.1.3.
- Client components that read the `amodx_preview_base` cookie (it is `httpOnly: false`
  for client reads) must keep working in preview; the cookie is still set by middleware.

## Definition of Done

1. Public route + product route contain zero unconditional dynamic-API calls. **MET** — and
   the stronger D2 condition holds: zero dynamic APIs on *any* reachable path. `next/headers`
   now appears in the renderer only in `%5Fdyn/[[...slug]]/page.tsx`, `lib/routing-server.ts`
   (called only from that twin), and `api/leads/route.ts` (re-verified 2026-07-26 by
   `grep -rln "next/headers" src/ middleware.ts`). `searchParams` is awaited only in the two
   `%5Fdyn` shells.
2. Preview works via the dynamic twin; admin preview links verified. **MET** — `/_site/…`
   and `?preview=true` on the real domain both render, both `no-store`. The literal
   `/_preview` segment named in D1 was dropped: D2 replaced it with `%5Fdyn`, and a
   leading-underscore directory is not routable in Next.js.
3. Parameterized list views still work (pagination, search) — dynamic per-request. **MET** —
   every query-string request is rewritten to the twin, which passes the real `query` DTO
   into the same `SitePage` body.
4. `docs/caching-architecture.md` corrected: add the serving contract above; fix known
   doc drift (26 wrapped handlers not 51; `withInvalidation` writes CDN_PENDING **and**
   CDN_LAST_CHANGE; status endpoint also allows EDITOR; `open-next.config.ts` is a
   defaults-relying stub; `content/delete.ts` is not wrapped — flag as open question).
   **MET** — the doc work is done and extended (serving contract now describes the two-route
   split and the not-found rule; render-outcome cacheability matrix; RSC finding;
   open-hazards section; OpenNext verification replacing the false "not installed" claim).
   The *code* half, "`notFound()` must not produce a cacheable 404", is met by the two D3
   mechanisms and proved by header probe — a route in ISR mode still cannot emit a
   non-cacheable 404, so neither mechanism tries to: both move the outcome off that route.
   Completed in revise run 2 by removing the last bare `notFound()` reachable from the
   cacheable route (`[siteId]/layout.tsx`), and verified by walking the whole cacheable
   subtree: `grep -rn "notFound()" renderer/src` returns call sites only inside
   `lib/not-found-handoff.ts`.
5. `docs/security-remediation-status.md` Phase 4 note appended: serving layer was
   inert until this slice; "COMPLETE" claim corrected. **MET.**
6. **Interactive functionality holds on cached pages** (operator condition, ratified
   2026-07-26): cookie consent (`CookieConsent.tsx` — `"use client"` + localStorage),
   comments (`CommentsSection.tsx` — `"use client"` fetching uncached `/api/comments`),
   and NextAuth session UI must remain client-side hydrated — the cached HTML must
   contain no per-visitor state. Evidence: cite the `"use client"` boundary + data path
   for each; if any such surface is found to render per-visitor state on the server,
   STOP and surface it instead of quietly keeping it dynamic. **MET** — every one of
   `Providers.tsx` (NextAuth `SessionProvider`), `CookieConsent.tsx`, `CommentsSection.tsx`,
   `Navbar.tsx`, `CartWidget.tsx` and `AccountPageView.tsx` starts with `"use client"`;
   `getServerSession` appears only in `/api/profile` and `/api/account/orders` Route
   Handlers, which are on the `CACHING_DISABLED` CloudFront behaviour. The cached HTML
   captured in the probe contains zero occurrences of `next-auth`, `csrf`, `sessionToken`,
   `amodx_ref`, `amodx_preview_base`, `Set-Cookie` or `Restricted Access`.

## Evidence required

- `EXECUTED`: full workspace rebuild (shared → effects → plugins → backend → admin →
  renderer → tools/mcp-server → infra).
- `EXECUTED`: header probe against `npx next build && npx next start` (the route-table
  `ƒ`/`●` markers are NOT a valid gate — measured 2026-07-26): a public published page
  returns `Cache-Control: s-maxage=...` with `x-nextjs-cache: MISS` then `HIT`; a
  query-string request and a session-cookie request return non-cacheable headers via the
  dynamic twin. Reproduction recipe: `docs/caching-architecture.md` § *Measured serving
  behaviour*. The not-found clause now passes too: a missing page hands off to the twin and
  the client's 404 carries `no-store`; an unknown host is answered `404` + `no-store` by
  middleware without rendering.
- `EXECUTED` (D4): a read that fails **after** tenant resolution yields `500` with no
  `Cache-Control` and writes nothing to the ISR cache; with the read healthy again the same
  path renders `200` and caches (`MISS` → `HIT`). Measured against both the pre-D4 and the
  current build so the regression it closes is observed, not asserted, and re-measured
  through the built OpenNext Lambda (`GET → MISS`, **no `PUT`**, during the failure).
  Recipe and results: `docs/caching-architecture.md` § *Probe: a read that fails AFTER
  tenant resolution*.
- `NOT RUN` (operator gate, post-deploy): against the staging distribution —
  first `curl -sI https://<staging-host>/` shows `x-cache: Miss from cloudfront`,
  second shows `x-cache: Hit from cloudfront`; CloudWatch shows renderer Lambda
  invocations drop for repeated page hits. **This slice is not SHIPPED until the
  operator records this.** Do not run it until H1 is closed — deploying with the current
  cache key exposes every tenant to edge poisoning via a single `RSC: 1` request.

## Migration / deployment notes

Live non-commerce tenants are served by this distribution today, and this slice changes what
the edge is allowed to keep. Mandatory (operator directive 2026-07-26).

**Deploy order — not negotiable.**

1. `cache-3` first, or in the same `cdk deploy` as `cache-1`. It adds `RSC`,
   `Next-Router-Prefetch`, `Next-Router-State-Tree`, `Next-Router-Segment-Prefetch` to
   `RendererCachePolicy`. Deploying `cache-1` alone means one `curl -H 'RSC: 1'` can pin a
   flight payload at the edge under any page's URL, for every tenant (**H1**).
2. Then the renderer (`npm run build:open` + `cdk deploy`). No backend or schema change is
   part of this slice, so there is no expand/contract step and no data migration.
3. Invalidate CloudFront `/*` and clear the S3 `_cache/` prefix once after the deploy: the
   build ID changes, but the old distribution's cached `no-store` responses and any stale
   objects should not be reasoned about at the same time as a new caching behaviour.

**Staging verification before touching production** — header probes, not the route table:

```bash
# 1. a published public page: MISS then HIT, cacheable
curl -sI https://<staging-host>/<published-path> | grep -iE 'cache-control|x-cache|x-nextjs-cache'
curl -sI https://<staging-host>/<published-path> | grep -i x-cache      # → Hit from cloudfront

# 2. per-request paths must NOT be cacheable
curl -sI 'https://<staging-host>/<published-path>?page=2'  | grep -i cache-control   # → no-store
curl -sI https://<staging-host>/definitely-missing         | grep -iE 'HTTP|location|cache-control'
curl -sIL https://<staging-host>/definitely-missing        | grep -iE 'HTTP|cache-control'  # → 404 + no-store
curl -sI -H 'Host: not-a-tenant.example' https://<staging-host>/ | grep -iE 'HTTP|cache-control'  # → 404 + no-store

# 3. H1 regression check (proves cache-3 landed)
curl -sI -H 'RSC: 1' https://<staging-host>/<published-path> | grep -i content-type   # → text/x-component
curl -sI            https://<staging-host>/<published-path> | grep -i content-type   # → text/html, NOT x-component
```

Then confirm in CloudWatch that renderer Lambda invocations drop for repeated hits on the
same page. That check is the slice's `NOT RUN` operator gate and is what moves it to SHIPPED.

**Rollback.** No data is migrated, so rollback is a redeploy plus a flush:

1. Redeploy the previous renderer build (previous `.open-next` artefact / previous commit).
2. Invalidate CloudFront `/*` and delete the S3 `_cache/` prefix. **Both are required** —
   the old build serves `no-store`, so it will not overwrite entries the new build left
   behind; without the flush, year-long `s-maxage` HTML keeps being served from the edge.
3. If only `cache-1` is rolled back and `cache-3` stays, nothing breaks: the wider cache key
   is harmless on its own.

## Exit criterion

Repeated views of a published public page serve from CloudFront (no Lambda invocation);
a CloudFront miss serves from the OpenNext S3 ISR cache without React SSR. The SSR path
runs only on first render after invalidation and on carve-out views.

## References

- `docs/caching-architecture.md` — serving contract, measured behaviour, open hazards.
- `renderer/ARCHITECTURE.md` — route structure, updated for the two-route split.
- Code audit (2026-07-26): dynamic-API findings, open-next/Next 16 version concern.

## Files changed by the D2 build run

| File | Change |
|---|---|
| `renderer/src/components/SitePage.tsx` | **new** — the page render body, extracted from the catch-all; `SitePageInput` DTO |
| `renderer/src/components/ProductByIdPage.tsx` | **new** — same, for the legacy by-ID product route |
| `renderer/src/app/[siteId]/[[...slug]]/page.tsx` | reduced to a cacheable shell; `generateStaticParams() => []` |
| `renderer/src/app/[siteId]/products/[productId]/page.tsx` | same |
| `renderer/src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx` | **new** — `force-dynamic` twin |
| `renderer/src/app/[siteId]/%5Fdyn/products/[productId]/page.tsx` | **new** — `force-dynamic` twin |
| `renderer/middleware.ts` | rendering-mode discriminator; `/_dyn` wire guard |
| `docs/caching-architecture.md` | serving contract, outcome matrix, RSC finding, open hazards |
| `docs/security-remediation-status.md` | Phase 4 correction |
| `renderer/ARCHITECTURE.md` | route structure + ISR section |

## Files changed by the D3 revise run

| File | Change |
|---|---|
| `renderer/src/lib/tenant-directory.ts` | **new** — edge-runtime host→tenant existence check with a 60 s bounded verdict cache |
| `renderer/src/lib/not-found-handoff.ts` | **new** — `notFoundOrHandoff()`: 404 on the twin, `?nf=1` redirect on the cacheable route |
| `renderer/middleware.ts` | unknown-host gate (404 + `no-store`) in the production branch; shared `notFoundResponse()` |
| `renderer/src/components/SitePage.tsx` | `cacheable` prop; all seven `notFound()` calls go through the handoff |
| `renderer/src/components/ProductByIdPage.tsx` | same |
| `renderer/src/app/[siteId]/{[[...slug]],products/[productId]}/page.tsx` | pass `cacheable={true}` |
| `renderer/src/app/[siteId]/%5Fdyn/**/page.tsx` | pass `cacheable={false}` |
| `renderer/src/app/[siteId]/layout.tsx` | missing tenant → render `{children}` bare and let the page's `notFoundOrHandoff()` decide, instead of a 200 "Site Not Found" body (which also blocked the page's own not-found from ever running). *Revised 2026-07-26: an intermediate version called bare `notFound()` here, which was itself a cacheable 404 on the ISR route — see revise run 2, item 1.* |
| `renderer/src/lib/dynamo.ts` | `getTenantConfig()` no longer swallows AWS errors |
| `docs/caching-architecture.md` | not-found rule in the serving contract; H2 closed; OpenNext section corrected to VERIFIED |
| `renderer/ARCHITECTURE.md` | host gate, handoff, Route-Handler `Cache-Control` inconsistency fixed |

## Files changed by the D4 revise run

| File | Change |
|---|---|
| `renderer/src/lib/dynamo.ts` | the 18 remaining read helpers no longer swallow AWS errors; file-header comment states the rule, its two deliberate exceptions, and the one `catch` that legitimately stays (`mapTenant`'s legacy `JSON.parse`) |
| `renderer/src/lib/not-found-handoff.ts` | comment ripple: the stale "`getTenantConfig()` … now throws" note generalised to all helpers, plus the measured limit of the handoff's self-healing property (the canonical URL stays pinned to the 307) |
| `docs/caching-architecture.md` | new § *Failed reads throw — enforced repo-wide in the renderer* under the serving contract; new § *Probe: a read that fails AFTER tenant resolution*; harness inventory updated; corrected the DynamoDB stub port in the reproduction recipe (`4599` → `8123`, the port the stub actually binds) |
| `docs/shipped/slices/cache-1-restore-static-rendering.md` | this section, the revise-run-3 outcome, status line |

Not code, but part of the evidence: `probe-harness/ddb-stub.mjs` gained
`/__ctl/fail-content-{on,off}` and a second published fixture page;
`probe-harness/probe-failed-read.sh` is new; `probe-harness/opennext-drive.mjs` gained the
D4 block. The harness lives under `.agent-manager/` and is gitignored — productising it is
ROADMAP slice `test-2`.
