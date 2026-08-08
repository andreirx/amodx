# renderer — ARCHITECTURE.md

## Role in the System

The public-facing multi-tenant website engine. A single Next.js 16 deployment serves all tenant sites. Uses edge middleware to map incoming domains to tenant IDs, then renders content from DynamoDB using the plugin render components. Deployed to AWS Lambda via OpenNext.

**Depends on:** packages/shared (types), packages/plugins/render (block render components), backend (HTTP API for some routes)

## Internal Structure

```
middleware.ts                                  # Package root (NOT src/) — edge: domain → tenant routing, ISR/twin split, unknown-host 404
src/
├── app/
│   ├── layout.tsx                             # Root HTML wrapper
│   ├── [siteId]/
│   │   ├── layout.tsx                         # Site layout: config fetch, ThemeInjector, Navbar, Footer
│   │   ├── [[...slug]]/page.tsx               # CACHEABLE catch-all — thin shell over SitePage
│   │   ├── products/[productId]/page.tsx      # CACHEABLE legacy by-ID product — shell over ProductByIdPage
│   │   ├── %5Fdyn/[[...slug]]/page.tsx        # force-dynamic twin of the catch-all (URL segment `_dyn`)
│   │   ├── %5Fdyn/products/[productId]/page.tsx  # force-dynamic twin of the by-ID product route
│   │   ├── robots.txt/route.ts                # Dynamic robots.txt (blocks if not LIVE)
│   │   ├── sitemap.xml/route.ts               # Dynamic sitemap from published content
│   │   ├── llms.txt/route.ts                  # AI agent discovery (Markdown format)
│   │   └── openai-feed/route.ts               # Product JSON feed (OpenAI format, 15min cache)
│   └── api/                                   # 10 routes; all behind the CachingDisabled `api/*` behavior
│       ├── account/orders/route.ts            # Signed-in customer's order history → backend proxy
│       ├── auth/[...nextauth]/route.ts        # Per-tenant Google OAuth via NextAuth
│       ├── comments/route.ts                  # GET (public) / POST (auth required) → backend proxy
│       ├── consent/route.ts                   # GDPR consent logging → backend proxy
│       ├── contact/route.ts                   # Contact form → backend proxy
│       ├── leads/route.ts                     # Lead capture with referral cookie injection → backend
│       ├── posts/route.ts                     # Blog post listing (direct DynamoDB, tag filter)
│       ├── profile/route.ts                   # Signed-in customer's profile → backend proxy
│       ├── ref/route.ts                       # Attribution beacon: sets amodx_ref (cache-3) — 204, no-store
│       └── revalidate/route.ts                # ISR cache purge (called by admin after edits)
├── components/
│   ├── SitePage.tsx                           # THE page render body — both catch-all routes call it
│   ├── ProductByIdPage.tsx                    # THE by-ID product render body — both product routes call it
│   ├── RenderBlocks.tsx                       # Block rendering engine: maps Tiptap JSON → React
│   ├── ThemeInjector.tsx                      # CSS variable injection + Google Fonts loading
│   ├── Navbar.tsx                             # Responsive header with logo, title, nav links
│   ├── CommentsSection.tsx                    # Comment list + form (requires NextAuth session)
│   ├── SocialShare.tsx                        # Twitter, LinkedIn, Facebook, Email, Copy link
│   ├── Analytics.tsx                          # Consent-gated: GA4, Umami, Plausible, or custom
│   ├── CookieConsent.tsx                      # GDPR banner with accept/necessary/deny
│   ├── PaddleLoader.tsx                       # Lazy Paddle.js script loader for payments
│   ├── ReferralCapture.tsx                    # Constant inline <script>: beacons ?ref/?utm_source to /api/ref (cache-3)
│   └── Providers.tsx                          # NextAuth SessionProvider wrapper
└── lib/
    ├── dynamo.ts                              # Direct DynamoDB access: getTenantConfig, getContentBySlug, getProductById, getPosts
    ├── tenant-directory.ts                    # EDGE runtime: "is this host a wired tenant?" for middleware (own client — see file header)
    ├── not-found-handoff.ts                   # notFoundOrHandoff() — keeps 404s off the cacheable route
    ├── api-client.ts                          # getMasterKey() from env or Secrets Manager (cached)
    ├── routing.ts                             # useTenantUrl() client hook for preview-mode URL generation
    └── routing-server.ts                      # getPreviewBase() — reads amodx_preview_base cookie (dynamic twin only)
test/
└── serving-contract/                          # `npm run test:serving` — see README.md there
    ├── contract.test.mjs                      # 16 contract-row assertions + 4 harness isolation self-checks
    ├── ddb-stub.mjs                           # DynamoDB JSON-1.0 responder; failContentReads() fault injection
    ├── harness.mjs                            # next build / next start on an ephemeral port / HTTP helper
    ├── no-dotenv.cjs                          # NODE_OPTIONS preload: hides renderer/.env* from the whole child process tree; journals its own coverage
    └── fixtures.mjs                           # tenant + ROUTE# + CONTENT# items, `.test` TLD hosts
```

`test/` is `.mjs`, outside `tsconfig.json`'s `include`, so neither `tsc --noEmit` nor
`next build` compiles it. It adds no dependency to the package (`node:test` runner).

## Multi-Tenancy Routing

`middleware.ts` runs at the edge. It does three jobs: map the incoming host/prefix to a
tenant, **reject hosts that have no tenant record**, and **choose the rendering mode**
(both from slice `cache-1`).

Tenant mapping, three modes:

1. **Production** — extracts hostname, rewrites `/about` → `/[domain]/about`
2. **Test** — `/tenant/<id>/about` → `/<id>/about`
3. **Preview** — `/_site/<id>/about` → `/<id>/about` (restricted to localhost/staging/CloudFront)

Local development note: mode 1 now 404s unless the request's `Host` matches a real tenant
record (see the gate below), so `npm run dev` against a real table should be driven through
`/tenant/<id>/…` or `/_site/<id>/…`.

Unknown-host gate (production mode only) — `lib/tenant-directory.ts` answers "does a tenant
record exist for this host?" from a 60-second in-memory cache over a `Select: COUNT` query on
`GSI_Domain`, and middleware answers `404` + `private, no-store` when the answer is no. This
is the **only** place a production 404 can be non-cacheable, because a route in ISR mode
cannot emit one (see `docs/caching-architecture.md`). It **fails open** on any lookup error:
a DynamoDB blip must not 404 the whole estate. The client is separate from `lib/dynamo.ts` on
purpose — the edge runtime has no default AWS credential provider chain, so credentials are
passed explicitly; do not "de-duplicate" the two.

Rendering-mode choice — every request lands on exactly one of two routes that render the
same body:

| Target | Route | Response |
|---|---|---|
| cacheable | `/<siteId>/<path>` → `[siteId]/[[...slug]]` | `s-maxage=31536000`, ISR |
| per-request | `/<siteId>/_dyn/<path>` → `[siteId]/%5Fdyn/[[...slug]]` | `private, no-store` |

A request goes to the dynamic twin when **any** of these hold:

- it has a query string (pagination, search, filters, `?preview=`, `?utm_*`/`?ref`,
  `checkout-confirm ?id&email`, `checkout-track ?email`)
- it carries a NextAuth session cookie — matched by **prefix** against
  `SESSION_COOKIE_BASES = ['next-auth.session-token', '__secure-next-auth.session-token']`,
  i.e. `name === base` or `name` starts with `base + '.'` (NextAuth's chunk separator),
  compared case-insensitively. That covers the configured name and the `.0`/`.1` chunks
  NextAuth emits when the JWT exceeds the 4096-byte cookie limit. The `__secure-` entry is
  legacy/compatibility coverage — the explicit `cookies` block in
  `src/app/api/auth/[...nextauth]/route.ts` replaces NextAuth's `__Secure-`-prefixed default,
  so it is not emitted today. Do not turn this back into a list of exact names (the chunked
  variants were missed until `cache-3` revision 3) and do not widen it back to a substring
  test (revision 4 — a substring also matches unrelated names that embed the literal). The
  same predicate has to hold in the CloudFront viewer-request Function (below)
- it is preview (`/_site/`) or test-mode (`/tenant/`) traffic

The four Route Handlers under `[siteId]` (`robots.txt`, `sitemap.xml`, `llms.txt`,
`openai-feed`) are exempt from the twin — listed once as `SITE_ROUTE_HANDLERS` in
`middleware.ts`. They are Route Handlers, not App Router pages: they never enter the
full-route cache regardless of rendering mode, and each decides its own `Cache-Control` (or
sets none — see *ISR & Caching* below for which do which). They also have no twin, so
rewriting one to `/_dyn` would land on the page catch-all and 404.
**Add any new Route Handler under `[siteId]` to that list.**

`/_dyn` is an internal rewrite target only: middleware answers a `/_dyn…` URL arriving from
the wire with `404` + `private, no-store`, so the uncached twin is not reachable as a second
public URL for the same content.

Why the directory is `%5Fdyn` and not `_dyn`: Next.js treats a leading-underscore directory
as a *private folder* and excludes it from routing entirely. `%5F` is the percent-encoding of
`_`, which Next decodes back into a routable literal segment — the build output prints it as
`/[siteId]/_dyn/[[...slug]]`.

**The middleware sets no cookie on a page response** (since `cache-3`). The `amodx_ref`
attribution cookie used to be set here from `?ref` / `?utm_source`. It is now a two-part
mechanism: `components/ReferralCapture.tsx` — a constant inline script rendered from
`app/[siteId]/layout.tsx` — reads the visitor's own URL and POSTs the resolved value to
`app/api/ref/route.ts`, which sets the cookie.

The reason the *trigger* moved into the browser is the CloudFront cache key, not tidiness:
`cache-3` removed `ref`/`utm_source` from it, so `/p?ref=x` resolves to the `/p` entry and a
warm URL is answered at the edge — the origin, and therefore this file, never runs for
exactly the campaign traffic the cookie exists to attribute.

The reason the *write* stayed on the origin is migration. Visitors carrying the pre-deploy
cookie hold it with `HttpOnly`, and RFC 6265 §5.3 step 11 requires the browser to ignore a
`document.cookie` write over an `HttpOnly` cookie — a pure client-side write would have been
a silent no-op for them for up to 30 days. The `Set-Cookie` comes back on an `/api/*` POST,
which is uncacheable three ways over (POST, the `CachingDisabled` behavior, `no-store`), so
it keeps `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and the 30-day window unchanged.
Sole consumer is `app/api/leads/route.ts`, which reads it server-side via `cookies()`.

Failure mode, deliberately accepted: the beacon is fire-and-forget, so a blocked or failed
request loses attribution for that visit. The alternative that cannot fail — capture on the
origin — cannot run at all on a cache HIT.

The one `Set-Cookie` middleware still emits is `amodx_preview_base`, on the `/_site/`
preview branch only — that traffic is rewritten to the force-dynamic twin and is never
stored by either cache layer.

## Page Rendering Pipeline

`components/SitePage.tsx` is the single implementation of the content-page render. Both
catch-all routes are thin shells that call it with plain props
(`{ preview, basePath, sessionToken, query, cacheable }`); the cacheable route passes the
inert values (`false`, `""`, `null`, `{}`) plus `cacheable: true`, the twin passes the real
ones plus `cacheable: false`. `components/ProductByIdPage.tsx` plays the same role for the
legacy `/products/<id>` route. Steps:

0. **Not-found policy:** every "missing" outcome in the render goes through
   `notFoundOrHandoff(cacheable, publicPath)` (`lib/not-found-handoff.ts`), never a bare
   `notFound()`. On the twin it *is* `notFound()`; on the cacheable route it redirects to the
   same URL with `?nf=1`, which middleware routes to the twin — because a `notFound()` on a
   cacheable route is stored with the page's own year-long `s-maxage`.
   **`[siteId]/layout.tsx` must never decide this outcome itself.** It is shared by both
   routes and receives only `{ siteId }`, so it knows neither the rendering mode nor the
   requested path — it can pick neither mechanism nor build the handoff's `Location`. When
   its own `getTenantConfig()` returns `null` it renders `{children}` bare and lets the page
   below, which knows both, answer. (It must actually render `children`: a layout that
   returns early never invokes the page function, which is how the old "Site Not Found"
   HTTP-200 shell suppressed the page's `notFound()`.)
1. Fetches tenant config via `getTenantConfig(siteId)` (tries GSI_Domain first, falls back to PK).
   Like every other helper in `lib/dynamo.ts`, this call deliberately does **not** swallow AWS
   errors — see § *Direct DynamoDB Access* below.
2. Fetches content via `getContentBySlug(tenantId, slug)` (follows redirects if route has `IsRedirect`)
3. **Access gating:** checks `accessPolicy.type`. The session arrives as the `sessionToken`
   prop and is signature-verified with `next-auth/jwt` `decode()`. The cacheable route always
   passes `null`, so a cached render of a non-`Public` page is the "Restricted Access" shell
   and can never hold another visitor's content; a request carrying a session cookie is on the
   dynamic twin and gets the real render.
   **This takes two mechanisms, not one, and only one of them is in this repo's runtime
   code.** Middleware picks the twin — but middleware runs at the origin, and a warm
   CloudFront entry is answered before the origin is consulted. The edge half is
   `x-has-session` in the CloudFront cache key (`infra/lib/renderer-hosting.ts`), which is
   what makes an authenticated request miss the anonymous entry in the first place. Without
   it, a logged-in visitor is served the cached "Restricted Access" shell — hazard **H3**,
   closed in `cache-3` revision 3. Never state this gate as working from the middleware rule
   alone.
4. **SEO metadata:** generates OpenGraph, canonical URL, JSON-LD (Article, Organization, SoftwareApplication, etc.)
5. **Post grid prefetch:** server-side fetches posts for any `postGrid` blocks (avoids client "window is undefined")
6. **Theme merge:** applies page-level `themeOverride` on top of site theme
7. Renders blocks via `<RenderBlocks>` + comments section + social share buttons
8. Shows draft watermark banner for unpublished content

## ISR & Caching

Slice `cache-1` put the public routes back into Next's full-route (ISR) cache. The rule the
renderer must keep satisfying, and the measured evidence behind it, live in
`docs/caching-architecture.md` § *Serving contract* and § *Measured serving behaviour
(Next 16.2.9)*. In short, a route serves cacheable HTML **iff** it exports
`generateStaticParams()` **and** no code path reachable in it calls a Next.js dynamic API.

Both conditions are route-wide, and violating the second is not a graceful degradation — a
`cookies()` / `await searchParams` call anywhere in an ISR-mode render is an **HTTP 500 for
that request**. That is why the per-request work lives on a separate route instead of a
branch.

What this means when editing the renderer:

- `[siteId]/[[...slug]]/page.tsx` and `[siteId]/products/[productId]/page.tsx` export
  `generateStaticParams()` returning `[]` — enough to enter the cache, nothing prerendered at
  build time, no build-time DynamoDB access. Do not remove it.
- Nothing reachable from `SitePage` / `ProductByIdPage` / `[siteId]/layout.tsx` may import
  `next/headers` or await `searchParams`. Per-request input arrives as props. **If you add a
  server component under these routes that reads cookies or headers, the public site starts
  returning 500s.**
- The `%5Fdyn` twins carry `export const dynamic = "force-dynamic"` and are the only place
  `getPreviewBase()` (which calls `cookies()`) may be used.
- Build-output markers are **not** a check for cacheability. `ƒ` vs `●` reports the route's
  mode, not whether the code is clean; and a route can be `●` while every render 500s. Verify
  with response headers (`Cache-Control`, `x-nextjs-cache`) against `next build` +
  `next start`.
- **Run `npm run test:serving` before proposing any change under `app/[siteId]/`,
  `middleware.ts` or `lib/dynamo.ts`.** `test/serving-contract/` is that verification,
  committed: it does the `next build` + `next start` + header check for you against a local
  DynamoDB stub, in ~9 s, with no credentials. It is demonstrably able to catch exactly the
  bullet above — reintroducing one `headers()` call in the ISR page turns 7 of its 16
  contract-row assertions red (slice `test-2` § Build run, DoD 3). A failure there is a **contract
  change**: fix the regression, or update the suite *and*
  `docs/caching-architecture.md` in the same slice.

Other cache surfaces, unchanged by the slice:

- **Manual purge:** POST `/api/revalidate` with `{domain, slug}` calls `revalidatePath()`.
- **SEO routes:** of the four `[siteId]` Route Handlers, only two set `Cache-Control` on the
  `Response` — `sitemap.xml` (`public, s-maxage=3600, stale-while-revalidate=59`) and
  `openai-feed` (`public, s-maxage=900`). `llms.txt` and `robots.txt` set **none** and are
  therefore not cached. None of the four depends on the App Router rendering mode. Those two
  cacheable ones are why the D4 rule has to cover `getPublishedContent()` and
  `getProductsForFeed()` as well: a swallowed error there served a well-formed, **empty**
  sitemap with `s-maxage=3600` (measured).

- Nothing on the cacheable route may answer "not found" (see step 0 of the pipeline above)
  or swallow a failed read. Both get stored. The second half is now enforced in
  `lib/dynamo.ts` itself — see § *Direct DynamoDB Access*.

One hazard `cache-1` surfaced and did **not** close: the `RSC` request header changes the
response body without being in the CloudFront cache key (**H1**). **`cache-3` closed it**
by adding the four `Vary` headers to `RendererCachePolicy`'s allowlist — but nothing in
Track CACHE is deployed yet, and the ordering constraint is hard: `cache-3` first, or all
three together, never `cache-1` alone. The second hazard, cacheable not-found responses
(**H2**), was closed inside `cache-1`. A third (**H3**, the cache key being blind to the
session cookie) was found in review of `cache-3` and closed in its revision 3 — see the
signal-pairing table below. Read `docs/caching-architecture.md` § *Open hazards activated by
cache-1* before deploying.

`cache-3` also narrowed the query-string carve-out at the **edge**: the CloudFront cache key
now allowlists only `page`, `q`, `availability`, `id`, `email`, `preview`, `nf`, so a
campaign or tracking parameter on a warm URL is answered from that URL's entry without
reaching the origin.

**Both of middleware's rendering-mode signals have an edge counterpart, and they must stay
paired.** Middleware only executes on a CloudFront miss, so each signal it discriminates on
has to be in the cache key or the corresponding request never reaches it:

| Middleware signal | Cache-key counterpart |
|---|---|
| query string → twin | the 7-parameter query allowlist |
| session cookie → twin | `x-has-session: 0\|1`, derived from the cookie jar by the viewer-request CloudFront Function |

The session pairing is hazard **H3**, closed in `cache-3` revision 3. The function matches
cookie names with the *same* prefix predicate over the *same* `SESSION_COOKIE_BASES` list
this file declares, and the two are pinned equal by `probe-cache3-cffunc.mjs` (which reads
the edge list out of the synthesized CloudFormation template, not the `.ts` source); if they
ever diverge, an authenticated request classified anonymous at the edge is served the cached
anonymous page. Cookies themselves are **not** in the cache key — only that one derived bit.

**Scope caveat.** Routing a session request to the twin is not the same as authenticating it.
The twin's `readSessionToken()` (`[siteId]/%5Fdyn/[[...slug]]/page.tsx`) reads two exact,
unchunked cookie names and does not reassemble chunks, so a visitor whose JWT was chunked
renders with `sessionToken: null` and is denied gated content — after correctly bypassing the
cache. Deferred debt, tracked in `docs/TECH-DEBT.md`.

What makes that allowlist safe is **not** the middleware rule below. Two separate reasons,
neither of them a middleware property:

- a parameter that changes the representation is safe because it **is keyed** — being in the
  key is what forces an edge miss and gets the request to the origin at all;
- a parameter that is *not* keyed is safe because **code inspection proves nothing reads
  it**, so the origin would render the bare-path representation for it anyway (this route
  passes `query={{}}` literally — it is in ISR mode and cannot await `searchParams`).

The middleware rule below is unchanged — at the origin, *any* query string still goes to the
twin — but that only governs requests that reach the origin. On a warm entry CloudFront
answers before middleware runs, so the twin's `no-store` cannot rescue a stripped parameter.
What the rule does buy is that a query-string request can never **populate** an entry, so
junk cannot warm a bogus one. Full argument: `docs/caching-architecture.md` § *Why this list
is the right list*.

**`nf` must stay in the allowlist**: it is `lib/not-found-handoff.ts`'s `NOT_FOUND_PARAM`,
and without it the cacheable `307 → ?nf=1` becomes a redirect loop.

## Direct DynamoDB Access (`lib/dynamo.ts`)

The renderer reads directly from DynamoDB for performance (bypasses backend API):
- `getTenantConfig(identifier)` — by domain (GSI) or tenant ID (PK)
- `getContentBySlug(tenantId, slug)` — route lookup → content fetch, handles redirects
- `getProductById(tenantId, productId)` — direct get
- `getPosts(tenantId, tag?, limit)` — query all published LATEST content, filter/sort in-memory
- `getProductReviews(tenantId, productId)` — approved reviews for one SKU (`REVIEW#<productId>#`)
- `getSiteReviews(tenantId)` — approved SITE-scope reviews (`SITEREVIEW#`), business-level "about us"

  Both project the raw rows (incl. the `images` metadata array) and keep the `#src` alias on the
  reserved word `source` (prod hotfix `fed5924` — an un-aliased `source` invalidates the whole
  projection and 500s the page). They resolve nothing themselves; photo resolution is § *Review
  images* below.

**Error semantics — one rule, no exceptions inside this file** (human decision CACHE-1-D4,
2026-07-26; widened by review-1 the same day). No helper here catches an AWS/SDK error, and
none of them treats a missing `TABLE_NAME` as an empty result either — every helper resolves
the table through `requireTableName()`, which throws, and it is called *before* any legitimate
empty-input short-circuit such as `searchProducts()`'s blank query. There is no
`NEXT_PUBLIC_TABLE_NAME` fallback and no `"amodx-table"` default (`hasActivePopups()` had
both; a guessed table name either reads a different estate or reports "nothing here" from a
table that does not exist). A `null` or empty return means the record genuinely is not there;
anything else propagates and the render throws.

The reason is the cache, not style. Since `cache-1` a successful render is stored with
`s-maxage=31536000`, and a thrown error is the only outcome ISR mode never stores. A
swallowed error therefore does not degrade one request — it renders a plausible page (empty
catalogue, empty review list, empty sitemap) or a `?nf=1` redirect, and pins it at the edge
for a year. Measured both ways in `docs/caching-architecture.md` § *Probe: a read that fails
AFTER tenant resolution*. Accepted cost: during an AWS failure the dynamic twin and `/api/*`
answer 500 instead of rendering something incomplete.

`app/api/posts/route.ts` is a read path too and obeys the same rule: `{ items: [] }` means the
query matched nothing; a DynamoDB failure or a missing `TABLE_NAME` answers `500` and a
missing `x-tenant-id` answers `400`. It used to answer `200 {"items": []}` for all three,
which the `postGrid` block renders as *this site has no posts*. `/api/*` being uncached is not
a licence to invent absence.

Two read paths outside this file keep different internals on purpose: `lib/tenant-directory.ts`
(middleware host gate) **fails open**, because it runs before the render and must not 404 the
whole estate on a blip — the render repeats the lookup and throws anyway; and
`lib/api-client.ts` (Secrets Manager) returns `""`, which its callers forward to the backend,
which rejects it, so the route still answers a non-2xx rather than a 200 with empty data.

## Review images (`lib/review-images.ts`) — slice `rev-4`

Approved review photos reach visitor markup in two render surfaces: the **product page** review
section (`SitePage.tsx` `ProductPageView`) and the **reviews-carousel block** in a DB scope
(`SitePage.tsx` prefetch branches → `@amodx/plugins` `reviewsCarousel`). `lib/review-images.ts` is
the single support module both share, so they cannot drift on the security-critical rules:

- **`toPublicReviewPhotos(images, cdnBase)`** — the public-boundary filter + key→URL resolver. A
  `ReviewImage` (rev-1) carries a bare S3 **`assetKey`** and a per-image moderation `status`, never
  a URL. This keeps an image ONLY when `status === "approved"` AND its key is non-empty and NOT
  under the private staging prefix (`review-staging/`, a synced duplicate of the backend single
  source — the renderer cannot import backend code), then resolves each to `${cdnBase}/${assetKey}`.
  Pure and base-injected → unit-testable with no AWS. Mirrors `backend/src/reviews/public-list.ts`.
- **`toCarouselReviewItems(reviews, cdnBase)`** — maps DB review rows onto the carousel block's
  item shape (narrowing the System-A `source` enum to the block's `google|facebook|manual` badge
  enum) and calls `toPublicReviewPhotos` per review. Two callers: the `site-reviews` and
  `product-reviews-by-id` prefetch branches in `SitePage`.
- **`reviewAssetCdnBase()`** — reads `UPLOADS_CDN_URL`, returns `""` when unset (deliberate graceful
  degradation: text/stars/author still render, only photos are omitted — a throw would 500 every
  review page until infra wires the var). **Deploy gate:** the renderer server Lambda does not yet
  receive `UPLOADS_CDN_URL` (`infra/lib/renderer-hosting.ts`, outside rev-4's writable surface); until
  wired, photos degrade to absent. Tracked in `docs/TECH-DEBT.md`.

**Boundary, stated precisely.** The `UPLOADS_CDN_URL` env var and the key→URL resolution stay
server-side, but the RESOLVED `${base}/${key}` is a PUBLIC URL that DOES ship to the client inside
the raw `<img src>`/`<a href>` — exactly as a product `imageLink` reaches the client already
resolved. What is protected is the private staging key and the unapproved image, never the public
CDN host. Photos are RAW asset URLs rendered with `<img loading="lazy">`, **never** `next/image`
(opennext-1 parking rule); the block additionally gates photo markup to DB scopes (see the plugins
ARCHITECTURE § *The `reviews-carousel` block's render contract*).

**No dynamic API.** Both surfaces are plain cacheable-route DynamoDB reads (the same pattern as
`getPosts`), so `test/serving-contract/` stays green. Moderation mutations
(`backend/src/reviews/update.ts`) are on the **bulk** CDN-invalidation lane (`withInvalidation` →
debounced `/*` flush / "GO LIVE NOW"), not the fast lane — correct, because a site-scope review can
appear on any page, so there is no bounded set of changed paths to feed the targeted lane.

Tests: `test/unit/review-images.test.ts` (the pure filter/resolver) and
`test/unit/site-page-reviews.test.ts` (the `SitePage` SSR integration of all three surfaces:
site-reviews carousel, product-reviews-by-id carousel, and product-page review photos).

## Authentication

Per-tenant Google OAuth via NextAuth.js:
- Handler dynamically fetches tenant config to get `clientId` / `clientSecret`
- Sets `NEXTAUTH_URL` to tenant domain at runtime (handles multi-domain redirect URIs)
- Session includes `tenantId` and user `id`
- Used by CommentsSection for authenticated posting

## Theme System

`ThemeInjector.tsx` injects CSS custom properties into `:root`:
- Colors: `--primary`, `--primary-foreground`, `--secondary`, `--background`, `--foreground`, etc.
- Typography: `--font-heading`, `--font-body`
- Layout: `--radius`
- Loads Google Fonts non-blocking (preload as print, swap to all on load)
- Sets `window.AMODX_TENANT_ID` for client-side block components

## Block Rendering (`RenderBlocks.tsx`)

Merges core block types (paragraph, heading, lists, blockquote, horizontal rule) with plugin `RENDER_MAP` from `@amodx/plugins/render`. Handles Tiptap marks (bold, italic, link) and auto-rewrites internal links for preview mode via `useTenantUrl()`.

## Build & Deploy

- Dev: `npm run dev` (next dev)
- Build: `npm run build` (next build)
- AWS build: `npm run build:open` (next build + open-next build for Lambda)
- Lint: `npm run lint` (ESLint with next config)
- Tailwind v4 via `@tailwindcss/postcss`
