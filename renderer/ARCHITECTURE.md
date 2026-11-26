# renderer — ARCHITECTURE.md

## Role in the System

The public-facing multi-tenant website engine. A single Next.js 16 deployment serves all tenant sites. Uses edge middleware to map incoming domains to tenant IDs, then renders content from DynamoDB using the plugin render components. Deployed to AWS Lambda via OpenNext.

**Depends on:** packages/shared (types), packages/plugins/render (block render components), backend (HTTP API for some routes)

## Internal Structure

```
middleware.ts                                  # Package root (NOT src/) — edge: domain → tenant routing, ISR/twin split, unknown-host 404
src/
├── app/
│   ├── globals.css                            # Imported by [siteId]/layout.tsx and not-found.tsx (no top-level layout since locale-1e)
│   ├── not-found.tsx                          # ROOT 404 boundary (locale-1e): writes its own <html lang="en"><body> + Next's built-in 404
│   ├── [siteId]/
│   │   ├── layout.tsx                         # ROOT layout (locale-1e): <html lang>/<body>, config fetch, ThemeInjector, Navbar, Footer
│   │   ├── [[...slug]]/page.tsx               # CACHEABLE catch-all — thin shell over SitePage
│   │   ├── products/[productId]/page.tsx      # CACHEABLE legacy by-ID product — shell over ProductByIdPage
│   │   ├── %5Fdyn/[[...slug]]/page.tsx        # force-dynamic twin of the catch-all (URL segment `_dyn`)
│   │   ├── %5Fdyn/products/[productId]/page.tsx  # force-dynamic twin of the by-ID product route
│   │   ├── robots.txt/route.ts                # Dynamic robots.txt (blocks if not LIVE)
│   │   ├── sitemap.xml/route.ts               # Dynamic sitemap from published content
│   │   ├── llms.txt/route.ts                  # AI agent discovery (Markdown format)
│   │   └── openai-feed/route.ts               # Product JSON feed (OpenAI format, 15min cache)
│   ├── %5Fbook/[siteId]/                      # sched-1g2: SECOND root layout — the hosted booking pages (URL segment `_book`,
│   │   │                                      #   reached only by the middleware rewrite of `/_booking…`; see "Hosted booking pages")
│   │   ├── layout.tsx                         # <html lang>/<body> + BookingTheme; NO site scripts or chrome
│   │   ├── page.tsx                           # book page (`/_booking`; ?frame=1 ?lang= ?service=); 404 when scheduling is off
│   │   ├── manage/page.tsx                    # manage page (`/_booking/manage#t=<token>`); 404 when scheduling is off
│   │   ├── api/[op]/route.ts                  # proxy: one op → one backend visitor route (lib/booking-proxy.ts)
│   │   ├── feed/[resourceId]/[file]/route.ts  # calendar feed proxy (`<secret>.ics`)
│   │   ├── [...rest]/page.tsx                 # not-found of the tree (force-dynamic 404)
│   │   └── _components/                       # BookFlow, ManageView, Pickers, operation.ts (browser); PageShell, BookingTheme (server); api.ts
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
│   ├── Navbar.tsx                             # Responsive header with logo, title, nav links (HEADER-COLOURS-1: optional `colorStyle` on the <nav>; SHOP-LOOK-1A: optional `tagline`, `categoryBar` second row)
│   ├── CommentsSection.tsx                    # Comment list + form (requires NextAuth session)
│   ├── SocialShare.tsx                        # Twitter, LinkedIn, Facebook, Email, Copy link — canonical URL prop from SitePage (hydration-1)
│   ├── Analytics.tsx                          # Consent-gated: GA4, Umami, Plausible, or custom
│   ├── FBPixel.tsx                            # Server; mounts FBPixelLoader via a dynamic import() (chunk-set reason: pixel-consent-1)
│   ├── FBPixelLoader.tsx                      # Client; renders the pixel loader only when useConsent().marketing === true (pixel-consent-1)
│   ├── CookieConsent.tsx                      # GDPR banner with accept/necessary/deny (texts = resolved site keys, from the layout)
│   ├── QuoteRequest.tsx                       # CAT-QUOTE-1: "Request a quote" button + native <dialog> (showModal) with Call / WhatsApp / E-mail
│   │                                          #   from contactChannels; message = catalog key quoteMessage with the product title, the presenter's option
│   │                                          #   (read on open, followed on every change of the radio group while open) and the absolute URL. Mounted by
│   │                                          #   SitePage's catalog slot above the presenter when a channel has a value (docs/slices/cat-quote-1-impl.md).
│   │                                          #   InterestShortlist.tsx `InterestToggle`: variants "card" (listings) and "link" (product page, the
│   │                                          #   low-key text form); the bordered "page" form was deleted with its last caller.
│   │                                          #   [siteId]/layout.tsx: Top Bar phone/e-mail, Commerce Bar phone/WhatsApp and the Quick contact value fall
│   │                                          #   back to contactChannels only when their own value is empty (`ownOrChannel`); lib/dynamo.ts mapTenant copies it
│   ├── PaddleLoader.tsx                       # Lazy Paddle.js script loader for payments
│   ├── ReferralCapture.tsx                    # Constant inline <script>: beacons ?ref/?utm_source to /api/ref (cache-3)
│   └── Providers.tsx                          # NextAuth SessionProvider wrapper
└── lib/
    ├── dynamo.ts                              # Direct DynamoDB access: getTenantConfig, getContentBySlug, getProductById, getPosts, getCatalogListing
    ├── tenant-directory.ts                    # EDGE runtime: the host verdict for middleware — unknown / unwired / wired + languages (own client — see file header)
    ├── site-segment.ts                        # LANG-1B: the internal segment `<host>~<lang>` — write, parse, wire refusal of `~`, the layout's page language, the resolver input
    ├── not-found-handoff.ts                   # notFoundOrHandoff() — keeps 404s off the cacheable route
    ├── document-shell.ts                      # BODY_CLASS_NAME — the one <body> class of [siteId]/layout.tsx and not-found.tsx (locale-1e)
    ├── widths.ts                              # WIDTH_CLASSES (cat-theme-1): max-w-[1440px] / [1600px] / [1920px] written literally so Tailwind 4 compiles them; read by no runtime code
    ├── sanitize.ts                            # sanitizeHtml / sanitizeCssColor (injection-safety filter, also applied to the new colours) / sanitizeFontFamily / sanitizeCssLength
    ├── api-client.ts                          # getMasterKey() from env or Secrets Manager (cached)
    ├── routing.ts                             # useTenantUrl() client hook for preview-mode URLs; pathname first, cookie fallback after mount (hydration-1)
    └── routing-server.ts                      # getPreviewBase() — reads amodx_preview_base cookie (dynamic twin only)
test/
└── serving-contract/                          # `npm run test:serving` — see README.md there
    ├── contract.test.mjs                      # the contract rows + 4 harness isolation self-checks (101 tests on `next` since cat-theme-1; README.md there)
    ├── ddb-stub.mjs                           # DynamoDB JSON-1.0 responder; failContentReads() fault injection; failHostGate(), staleTenantRecord() (lang-1b); pageQueries() (lang-1c)
    ├── lang-1c-sitemap-before.json            # /sitemap.xml of every fixture tenant at d940fc1 (row lang1c-sitemap-identity)
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
3. **Preview** — `/_site/<id>/about` → `/<id>/about`

Booking addresses (slice `sched-1g2`, branch `A3`, placed before the three modes): `/_booking…` on a tenant host →
`/_book/<host>…`, and `/_site/<id>/_booking…` on a preview host → `/_book/<id>…`; a wire request to `/_book…` in any
spelling → `404`. Every other path is unchanged. See "Hosted booking pages" below.

Modes 2 and 3 address a tenant by id, so both are restricted to preview hosts
(`isPreviewHost`: the `Host` contains `localhost`, `cloudfront.net` or `staging`); any other host
gets `403`. Test mode had no such gate before slice `siteid-binding-1`.

The `[siteId]` segment is bound **only** by these rewrites, never by the request path. Only the
`/_next`, `/api` and `/static` prefixes pass through unrewritten; there is no "path contains a
dot" pass-through (removed by `siteid-binding-1` — it let `/<other-tenant>/page.html` choose the
tenant from the wire). A dotted path is an ordinary path on the request host's tenant.

Local development note: mode 1 now 404s unless the request's `Host` matches a real tenant
record (see the gate below), so `npm run dev` against a real table should be driven through
`/tenant/<id>/…` or `/_site/<id>/…`.

Unknown-host gate (production mode only) — `lib/tenant-directory.ts` `hostVerdict` answers "does a tenant
record exist for this host, and which extra languages does it list?" (`HostVerdict`: `unknown` / `unwired` /
`wired` + `languages`) from a 60-second in-memory cache over a `GSI_Domain` query that projects `SK` and
`languages` (a `Select: COUNT` query before `lang-1b`), and middleware answers `404` + `private, no-store` when the
verdict is `unwired`. This
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
   its own `getTenantConfig()` returns `null` it renders `{children}` bare (only inside
   `<html lang="en"><body>`, which it must emit as the root layout since `locale-1e`) and lets the page
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
5. **Block preparation (`prepareBlocks`):** server-side, in place, before `RenderBlocks`: `postGrid` posts, `categoryShowcase`
   products (+ the catalog-mode reduction, the URL prefixes; the card options' data, SHOP-LOOK-1D), `reviewsCarousel`
   reviews, `categoryGrid` categories (SHOP-LOOK-1C), the `form` block's custom form (SHOP-LOOK-1E) (avoids client fetches). One
   function, two users: the content page and the category page (CATEGORY-CONTENT-1)
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

- **Purge endpoint:** POST `/api/revalidate` with `{domain, slug}` calls `revalidatePath()` (a
  no-op for App Router pages on open-next 3.1.3; since `opennext-1b` on `@opennextjs/aws` 4.1.9 it
  writes the tag rows and makes the edited page a MISS, but refreshes no listing) and (CACHE-10)
  deletes every S3 ISR object of `domain` — the S3 key layout is known only here. See
  `docs/caching-architecture.md` § 5.
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
now allowlists only `page`, `q`, `availability`, `id`, `email`, `preview`, `nf` — and, since
`cat-facets-1`, `f` (catalog storefront filters) — so a campaign or tracking parameter on a
warm URL is answered from that URL's entry without reaching the origin.

**Both of middleware's rendering-mode signals have an edge counterpart, and they must stay
paired.** Middleware only executes on a CloudFront miss, so each signal it discriminates on
has to be in the cache key or the corresponding request never reaches it:

| Middleware signal | Cache-key counterpart |
|---|---|
| query string → twin | the 8-parameter query allowlist |
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
  - `mapTenant` maps `recaptcha: { siteKey }` ONLY when the stored record has both `siteKey` and `secretKey` (sched-1g2,
    `docs/slices/sched-1.md` § 9.1, finding G8): the condition under which the backend verifies with the tenant's secret,
    so every page's site key pairs with the secret the backend uses. The secret and the threshold are never mapped.
- `getContentBySlug(tenantId, slug)` — route lookup → content fetch, handles redirects
- `getProductById(tenantId, productId)` — direct get
- `getPosts(tenantId, tag?, limit)` — query all published LATEST content, filter/sort in-memory
- `getProductReviews(tenantId, productId)` — approved reviews for one SKU (`REVIEW#<productId>#`)
- `getSiteReviews(tenantId)` — approved SITE-scope reviews (`SITEREVIEW#`), business-level "about us"

  Both review reads (`getProductReviews`, `getSiteReviews`) project the raw rows (incl. the
  `images` metadata array) and keep the `#src` alias on the
  reserved word `source` (prod hotfix `fed5924` — an un-aliased `source` invalidates the whole
  projection and 500s the page). They resolve nothing themselves; photo resolution is § *Review
  images* below.
- `getCatalogListing(tenantId, categoryId?)` — a CATALOG site's whole shop or category listing from the
  tenant's `PRODUCT#` items (§ *Catalog listings and filters* below)

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

## Category page content (CATEGORY-CONTENT-1, PROTOTYPE)

A category's own `blocks` (`Category.blocks`, the content page's block type) render on its page, every site kind:
after the title block (title, description, product count) and before the filters and the product list, on every
page (`?page=`) and filter state (`?f=`). `SitePage` runs `prepareBlocks(category.blocks, config)` (no read without
blocks); `CategoryPageView` draws them with `RenderBlocks` and the tenant's `blockStrings(resolved, { catalogMode })`,
inside `<div class="mb-8" data-category-content>`.
- **Width:** no `contentMaxWidth` / `siteMaxWidth` is passed, so `RenderBlocks` adds no per-block wrapper: each block
  takes the width of the category page's own container (`<main>`, `header.contentMaxWidth`, default `max-w-6xl`,
  `px-6`), aligned with the title and the grid. A "full" block (hero, CTA, …) cannot break out of that container.
- **No blocks = byte identity:** absent, `[]` or not an array → `pageContent` is `undefined` and the title block stays
  the same single element (`{pageContent ? <>{titleBlock}{pageContent}</> : titleBlock}`). A `{cond && …}` child would
  put a `false`/`undefined` entry into the RSC payload of every category page (control EXECUTED: rows
  `cm1-identity-*`, `loc1-diff-cdl-2` fail).
- **Refresh:** the admin save is `PUT /categories/{id}` → `revalidateTenantPaths(tenantId, "category", …)`, the same
  purge as a description change.
- Tests: `test/unit/category-content-1.test.ts`; serving rows `cc1-category-content`, `cc1-category-no-content`
  (fixtures `CC1`).

## Catalog listings and filters (`@amodx/shared` `facets.ts`, `catalog-listing.ts`) — slices `cat-facets-1`, `cat-import-profile-1b` (PROTOTYPE)

Spec: `docs/slices/cat-facets-1.md` (rulings § 12, amendment § 13 "CF1-FACET-SET-2"); impl record
`docs/slices/cat-facets-1-impl.md`. Filter modes and the move to `packages/shared`: design
`docs/slices/cat-import-profile-1.md` § 2.6, § 5.2 (rulings CIP1-PREVIEW = A, CIP1-FILTER-PRECEDENCE = S-A with N2),
record `docs/slices/cat-import-profile-1b.md`. Maturity: **PROTOTYPE** until the staging evidence of spec § 8.4 (and
of the 1b design § 7.5) is recorded.

**Where the rules live.** The filter rules (`buildFacetListing` …) and the listing rule (`catalogListing`,
`isProductAvailable(p, today)`, `catalogListingPath`) are pure modules of `packages/shared`, imported from
`@amodx/shared`, because the admin's import preview (slice `cat-import-profile-1c`) must build the same base sets and
the same panel as the site. The renderer keeps the I/O (`getCatalogListing`) and the layout (`SitePage.tsx`).

**Which sites.** Only `isCatalogMode(config)`. On every other site the shop and category pages call
`getActiveProducts` / `getProductsByCategory` exactly as before (byte identity: rows `cm1-identity-*`).

**Data path (ruling CF1-DATA-PATH = B).** A catalog shop or category page calls `getCatalogListing`: one `PRODUCT#`
query of the tenant (every page followed), projection = the shop card fields + `status`, `brand`, `attributes`,
`variants`, `facetModes` (1b). It then applies the shared `catalogListing(items, categoryId, utcDay(new Date()))`.
Membership is the old one: shop `status === "active"`; category `!status || status === "active"` and
`categoryIds` contains the category id (the field the `CATPROD#` cards are derived from). Then
`isProductAvailable` (UTC day), then `sortOrder`, ties by `id` (= DynamoDB's SK order of both item families). The
page path passed to the panel is `catalogListingPath(prefixes, slug | undefined)` with `basePath` prepended. Every
other availability check of `dynamo.ts` calls the same shared `isProductAvailable` bound to today's UTC day. Cost: the
whole tenant per UNCACHED render — what the shop page of every tenant already reads; a bare page is still ISR + edge
cached.

**Filter rules (`packages/shared/src/facets.ts`, pure, no I/O).** `buildFacetListing(base, f, path, labels)` returns the
filtered items, the shown facets with counts, and every href the panel may emit (`labels` = the tenant's two fixed
facet headings, `catalog.facetProducer` / `facetVariantDefault`, locale-1b; the URL keys never change):
- facet set, rebuilt per base set (§ 13): the producer (`brand`, URL key `producator`), the variant option values
  (URL key `varianta`; `#<digits>` labels excluded), then every `attributes` key with ≥ 2 holders, a most frequent
  value on ≥ 2 products and ≤ 40 distinct values — ordered by holders, ties by the value order; label = the key as
  stored;
- URL identity (operator ruling 2 on review-0): the inner key is `producator` for the producer, `varianta` for the
  variant values, and `a.<key>` for EVERY attribute key — so attributes literally named `producator` / `varianta`
  are facets of their own (`a.producator`, `a.varianta`); any other inner key is not a facet id and is dropped;
- a facet is shown iff it has a selection or some value is held by some but not all products of the base set;
  OR within a facet, AND across facets; counts are disjunctive (a facet's own selection does not reduce its counts);
- URL state: ONE query parameter `f` holding the form-encoded selection (`?f=producator%3DBOEN`); the parse is total
  (never throws); canonical form = producer, variant, then attribute ids by the value order; values by the value order;
- selection lifetime (operator ruling 1 on review-0): a selected attribute key is applied and shown — chip and facet,
  removable — whether or not it passes the repeat rule on the current base set, and even when no product holds it;
  the repeat rule decides only which keys are OFFERED (a selected key that is not offered lists its selected values
  only);
- URL budget: no emitted href exceeds 6,144 UTF-8 bytes, measured on the final string; an add-link exists only when its
  selection fits with 16 bytes left for `&page=`; an incoming selection that does not fit is not applied (notice);
- filter modes (1b, design § 2.6, N2): a product may carry `facetModes` (importer-owned, a copy of its producer's
  import profile). A product that marks a facet `never` (attribute key, or `variant: "never"`) is a SILENT holder:
  its values do not count toward the offer and are not listed, but they still MATCH a selection and still COUNT in
  the listed values' counts. An attribute key is offered when a non-silent holder marks it `always` (whatever the
  repeat rule gives) or when it passes the repeat rule over the non-silent holders. Visibility runs over the listed
  values. The modes change nothing else: the facet order (by EVERY holder), labels, matching and counts are computed
  over every product as before. A mode value this code does not know, or a malformed
  `facetModes`, is automatic (design § 3.3 item 6); for a key listed twice the first entry decides. Inert while no
  product carries the field (1b golden).

**Product page attributes (1b, design § 2.5).** `ProductAttributes` shows a key stored more than once as ONE row at
the place of its first entry, its values in stored order joined by ", ". A product with distinct keys renders as
before.

**Product page gallery on a catalog site (slice `cat-variant-gallery-1`).** `ProductImageGallery` (client) takes three
optional props, passed only by the catalog branch of `ProductPageView` (`catalogGalleryProps`): `pinnedTop` (a CSS
length; from `md` up the gallery is `sticky self-start`, so it stays in view under the site header while the info
column scrolls), and the first option group's radio name and options (`firstOptionGroup`, the group
`CatalogVariantPresenter` renders). The sticky `top` has two stages. (1) Server HTML, before hydration and without
JavaScript: `pinnedTop` = `pinnedGalleryTop(config)`, derived from the configuration that sizes the sticky header —
`calc(<rem>rem + <px>px)` = Top Bar 2rem (when `topBar.show`, ONE line) + the taller of `header.navHeight` /
`header.navHeightScrolled` (`h-<n>` = n × 0.25rem; an unreadable value counts as `h-36`) + a 1rem gap, plus the Navbar's
1px border and the editorial 3px top border (the Commerce Bar is never in a catalog header, CM-D11). (2) After
hydration: the gallery measures the real header (`SITE_HEADER_SELECTOR` = the layout's `sticky top-0 z-50` wrapper,
`getBoundingClientRect`) and follows it with a `ResizeObserver`: `top` = its height + 1rem. Stage 2 covers what no
configuration can know — a Top Bar with line breaks or text that wraps at the window's width, the visitor's font size,
the Navbar's current state. When an option has an `imageLink`, the variant tiles are the only picker: the whole-gallery
thumbnails are not shown, the preview starts on the product `imageLink`, and checking a tile (the radio's `change`
event, read as `InterestToggle` reads it) shows that option's pictures — thumbnails, arrows and counter only when the
option has more than one. An option without a picture leaves the preview as it is. Without those props (commerce) the
gallery's markup is the one before the slice (unit row `[cvg1-server]`, byte-identical to the 27fa7ca capture) and
nothing is measured. Tests: `test/unit/cat-variant-gallery-1-client.test.ts` (picker; the measurement mechanism),
`…-server-render.test.ts`, `…-header-clearance.test.ts` (stage 1 for every admin header choice, measured from the real
layout and Navbar; the selector bound to the real header), `test/interest-e2e/cvg1-pinned.spec.mjs` (stage 2 in
Chromium: a three-line Top Bar, and an announcement that wraps at 800px and not at 1600px; fixtures `CVG1`); serving set
`test/serving-contract/locale-1/variant-gallery-1/`.

**Hidden products (slice `cat-image-gate-1`).** A product page whose product is not `active` takes the missing-product
path (the not-found handoff) on every site; the dynamic twin's `?preview=` flag (not authenticated) is an exception
only on a NON-catalog site (unchanged). On a catalog site a glam import writes products `draft` until their image
copies, so `?preview=` does not open them, and `buildSitePageMetadata` gives such a product the missing-product
metadata (no title). Non-catalog renders are unchanged (`cm1-*`). Tests: `test/unit/catalog-product-status.test.ts`,
serving rows `cig1-catalog-hidden`, `cig1-commerce-hidden`. Not covered: `/products/<id>` (`ProductByIdPage.tsx`) keeps
the `?preview=` exception on catalog sites too (finding in `docs/slices/cat-image-gate-1.md` § 7).

**Rendering (`SitePage.tsx`).** `FacetedListing` + `FacetPanel` are server components with no JavaScript: every value
is a plain `<a rel="nofollow">` (never prefetched — `cf1-prefetch`), every facet a native `<details>`; on small screens
the panel is one collapsed block (CSS-only checkbox toggle), on `lg` a left column. The grid slot and `Pagination`'s
base URL are the only existing slots the catalog branch fills, so a non-catalog render is unchanged. `Pagination` takes
an optional `maxHrefBytes` (catalog only). Copy is fixed Romanian (spec § 6).

**Caching.** `f` is in the CloudFront cache-key allowlist (`infra/lib/renderer-hosting.ts`) for CORRECTNESS: a
filtered URL reaches the origin and the `no-store` twin; filtered views are never stored at the edge or in ISR
(`docs/caching-architecture.md` § the query-string allowlist; rows `cf1-not-stored`, `cf1-bare-intact`).

Tests: `packages/shared/test/facets.test.ts` (the rules, the URL form, the budget, with the 147 measured collection
names — moved from `test/unit/` by 1b), `packages/shared/test/facet-modes.test.ts` (§ 2.6 rows),
`packages/shared/test/catalog-listing.test.ts`, the 1b golden (`packages/shared/test/cat-import-profile-1b-golden.test.ts`
and `test/unit/catalog-listing.test.ts`, which replays the golden through `getCatalogListing` over the in-memory store
`test/unit/memory-dynamo.ts` and pins the `facetModes` projection); serving-contract rows `cf1-*` (fixtures block
`CF1`) and `cip1b-*` (fixtures block `CIP1B`, a tenant of its own) in `test/serving-contract/contract.test.mjs`;
`test/interest-e2e/facets.spec.mjs` (`cf1-prefetch`).

## Tenant locale table in the renderer — slices `locale-1a`, `locale-1b`, `locale-1d`, `locale-1c`, `locale-reviews-date-1`, `locale-1e` (PROTOTYPE)

Design `docs/slices/locale-1.md` (§ 16 rulings win); records `docs/slices/locale-1a.md`, `docs/slices/locale-1b.md`,
`docs/slices/locale-1d.md`, `docs/slices/locale-1c.md`, `docs/slices/locale-reviews-date-1.md`, `docs/slices/locale-1e.md`.

- `mapTenant` (`lib/dynamo.ts`) copies `catalogStrings`, `siteStrings` (and, `sched-labels-1`, `bookingStrings` when
  present) and `locale` — NORMALISED (`normalizeLocale`), so
  every reader of `config.locale` (also the commerce dates of `SitePage` this slice does not touch) gets a value no
  formatter throws on; absent/malformed → `en-US`. `countryCode` is copied since `cmrc-counties-1` (below). A
  tenant without a name gets `site.untitledSiteName` of its language. `test/unit/locale-1a-map-tenant.test.ts` lists
  the part fields from the schema and fails when one is dropped.
- Server components resolve once per request (`resolveLocaleStrings(config)`) and pass each client component only
  its keys as a plain `strings` prop (`Navbar`, `CommentsSection`, `SocialShare`, `QuickContact`; `CookieConsent`
  keeps its `config` object shape). `layout.tsx`: cookie texts, footer lines/headings, legal labels, copyright, meta
  description fallback. `SitePage.tsx`: restricted page, pagination, breadcrumb Home, comments, sharing.
- **en-US tenants do not change** (§ 16.2 item 4), with ONE ruled exception since `locale-reviews-date-1`: the
  reviews-carousel date (ledger row L-ALL-2, below). Every EN value is today's literal; `CommentsSection` gets
  `dateLocale` only for a non-en-US tenant (a spread — an `undefined` prop would be serialised into the RSC payload);
  the footer copyright is split by a local `interpolate` into the same children as before, so its HTML/RSC bytes and
  the CM1-A1 footer-year canonicalisation are unchanged.
- `locale-1b` — shared product surfaces and the catalog: `SitePage.tsx` product, category, shop and search views and
  their metadata read `strings.commerce` (the product page caller and the search page no longer call
  `getCommerceStrings`; `getSearchLabels` is gone); the facet panel and `buildFacetListing` read `strings.catalog`;
  `ProductByIdPage.tsx` reads `buyNow` / `preOrder` / `outOfStock`. `SearchBar` gets `labels` resolved on the server
  under the § 5.2 F rule (`override || language default`) and a required `placeholder` (`searchBar.placeholder ||
  searchPlaceholder`). `InterestToggle` (fresh `strings` object per card) and `InterestListPage` get their catalog texts
  as props. Counts use `selectPluralText` (Romanian `few`/`other`: "2 produse" / "20 de produse"). The header widget
  `InterestWidget` gets its four texts (`InterestWidgetStrings`, incl. the count key `interestWidgetLabel`) from
  `app/[siteId]/layout.tsx` through `Navbar.tsx`'s `interest` prop, catalog tenants only (ruling LOCALE1B-WIDGET = A).
- `locale-1d` — commerce-only pages (§ 6.2): `SitePage.tsx` passes the cart, checkout and account views and the
  add-to-cart control only their keys (`cartPageStrings`, `checkoutPageStrings`, `accountPageStrings`,
  `addToCartStrings`; the Pick types `CartPageStrings`, `CheckoutPageStrings`, `AccountPageStrings`, `AddToCartStrings`
  live in the component files), with the § 5.2 F rule applied there (`withFallback`; pattern D = `pick`); the views have
  no English fallback any more (their `strings` prop is required). The four commerce titles, the order confirmation and
  the tracking page (step and history labels by key; a status without a key renders as stored) read `strings.commerce`;
  a sentence that wraps a value in markup or renders it as its own text node goes through the local `interpolateNodes`,
  so an en-US page's bytes stay identical. `layout.tsx` gives `CommerceBar` its `labels` (`signIn`, `accountLabel` F;
  `cartWidgetTotal` → `CartWidget`'s `total`) and `Navbar` its `commerceStrings` (commerce sites only, a spread).
  `formatLocale` reaches `AccountPageView` (order dates, birthday, loyalty points) and `CheckoutPageView` (calendar
  month) only for a non-en-US tenant; an en-US tenant keeps today's formatter arguments. The old English-defaults
  helper is gone (command `L1D-NO-READER` of § 10.1 finds no reader). Texts follow the language, never the country.
- `locale-1c` — block chrome (§ 6.1, § 5.3): `SitePage.tsx`'s content branch gives `RenderBlocks` a required `strings`
  prop, `blockStrings(resolved, { catalogMode: isCatalogMode(config) })` (shared); `RenderBlocks` passes it to every
  block (plugin or core) and down its `RenderChildren` recursion, so a block nested in a list or a quote gets it too.
  It is the only `RenderBlocks` caller (`git grep '<RenderBlocks'`). On an en-US page the only byte change is that one
  prop in the RSC payload (category 2).
- `locale-reviews-date-1` — review dates (human ruling 2026-11-01, finding F-LOCALE-REVIEWS-DATE closed): the reviews
  carousel (`packages/plugins`) uses a block `locale` attribute that is a non-empty string, raw; otherwise the tenant's
  normalised locale (`strings.dateLocale`, or `"en-US"` for an en-US tenant). No renderer source change; on an en-US page
  the only change is the carousel's date in the server HTML (`31 octombrie 2026` → `October 31, 2026`, row L-ALL-2,
  category 3). Romanian scope: on a RO tenant a carousel without the attribute (the fixtures; every editor-made block — the
  block schema has no `locale` field) keeps its date, but a `""` or non-string attribute now also takes the tenant's
  locale (before: the raw date string, or the runtime default).
- `locale-1e` — `<html lang>` per tenant (operator rulings LOC1E-404-DOCUMENT = B, LOC1E-STRUCTURE-CATEGORY = A;
  `docs/slices/locale-1e.md`): `app/[siteId]/layout.tsx` is the ROOT layout (`app/layout.tsx` deleted; its
  `globals.css` import and `<body>` class moved unchanged; the class lives in `lib/document-shell.ts`) and writes
  `<html lang={localeLanguageSubtag(config.locale)}>` — the language subtag of the tenant's normalised locale (`ro-RO` →
  `ro`, `de-DE` → `de`, absent/malformed → `en`), not the resolver's pack language. The missing-tenant branch writes
  `<html lang="en"><body>` around `children`. The layout reads only `params` and the tenant record (no request API);
  the build's route table is unchanged. Next's default 404 boundary belongs to the top `app/` segment, which has no
  layout now, so it would replace the subtree that holds `<html>`; `app/not-found.tsx` is that root boundary and writes
  the document itself — `<html lang="en">`, the body class, the stylesheet, Next's built-in 404 UI — so every 404 page
  renders as before (English, `lang="en"`, on every tenant). A 404 landing is a `__next_error__` shell whose document
  the browser builds from the payload (also before this slice). Rows `loc1e-html-lang`, `loc1e-404-document`
  (`locale-1/1e/before-404/`), `loc1e-category-controls`, `loc1e-cache-headers` (`locale-1/1e/before-headers.json`);
  unit `test/unit/locale-1e-html-lang.test.ts`.
- `DynamicForm.tsx` moved to the plugin `form` block (`packages/plugins/src/form/DynamicForm.tsx`, SHOP-LOOK-1E); its
  1a texts are proven by jsdom through the block (`test/unit/locale-1a-client.test.ts`, test titles unchanged).
- Proof: `test/serving-contract/locale-1/` — `proof.mjs` (byte-difference check incl. the 1b changed-prop form
  `beforeValue`, `renderItem` incl. the 1d `segment` form, the request rules incl. `orderRequests`), `extract.mjs` (the
  visible-text extraction, re-exported by `proof.mjs`; importable under jsdom), per slice `<slice>/before/` (immutable
  start capture; since 1d also the RO copies), `expected-diff.json`, `ro-expected.json`, `coverage.json` (1b also
  `text-expected.json`: the L-EN-CAT changes); the rows read the CURRENT slice's set (`1e`, from `d9999d2`; the
  `1a`/`1b`/`1c`/`1d`/`reviews-date-1` files are their records): `loc1-subjects`, `loc1-text-<subject>` (equal except the
  listed category-3 ledger texts; `1e` lists none), `loc1-text-mutation`, `loc1-diff-1e` (category 4 = the `1e`
  root-layout move, a forward transform of the before tree that validates every value; refusals in
  `loc1e-category-controls`), `loc1-facet-hrefs`,
  `loc1-flight-controls`, `loc1-ro-content`, `loc1-ro-commerce`, `loc1-ro-catalog` (each RO copy against its own start
  capture), `loc1-order-pages`. Client-only commerce states: `test/unit/locale-1d-client.test.ts` (en-US markup equal to a
  92adbba capture; `CheckoutPageView`'s `DeliveryDatePicker` is exported for it only, a test seam); headless renders: `test/unit/locale-1d-server-render.test.ts`.
  Block states (`1c`): `test/unit/locale-1c-blocks-client.test.ts` (jsdom; the eleven block renderers through
  `@amodx/plugins/render`; en-US markup equal to a 0c0dbc8 capture except the declared L-ALL-2 review dates of
  `locale-reviews-date-1` (`L_ALL_2`); the reviews-carousel date cases of that ruling; the § 5.2 preservation cases; `swiper/react` mocked —
  it is bound to the monorepo root's React copy). Since `1c` the `cm1-content` home holds the block-chrome blocks. The byte rows compare CM1-A1 plus the ruled resolved-tree payload comparison
  (`resolveFlight`, LOCALE1B-ROW-CUT = A; it replaced the 1a row renumbering, LOCALE1A-ROW-IDS = A): every outlined row
  (plain `$<id>`, or the encoder's element outline `$L<id>` to an element tuple) is resolved into its place on both sides, so
  row labels, their render-to-render order (F-LOCALE-ROW-IDS) and the size-based row cuts are ignored; every other typed
  reference stays a typed leaf; an unknown form fails closed; no URL is excluded. Since `next-patch-1` (CM1-A3,
  `docs/slices/catalog-mode-1.md` § 8.21) the framework chunk names inside Turbopack's `<script id="_R_">` bootstrap are
  masked (that element only; their count stays compared), and rows `np1-bootstrap-mask-controls` / `np1-bootstrap-chunks`
  prove the mask is that narrow and that every listed chunk exists in `.next/static` and answers 200; category 4's
  after-head root-layout script is named by the build's manifests (`readRootNotFoundScript`), and `loc1e-cache-headers`
  allows exactly `Accept-Encoding` added to `Vary` on the four `[siteId]` route handlers on next ≥ 16.4.6.
  The en-US subjects are, by rule, every `fixtures.mjs` tenant without `locale` (`proof.mjs` `EN_US_REQUESTS`), so a new
  locale-less fixture joins the gate; fixtures `LOC1` are the RO copies of the CM1 commerce/content/catalog tenants. The strict `cm1-byte-identity/baseline/` was advanced from
  the 1a, 1b, cmrc-counties-1, 1d, 1c, reviews-date-1 and 1e trees (history in its README); `cm1-control` reads the preserved `control-de4ad52/`. Unit:
  `locale-1a-{server-render,client}.test.ts`, `locale-1b-{server-render,client}.test.ts`; the coverage checker
  `locale-coverage.test.ts` (named `locale-1a-coverage.test.ts` until 1b) checks every slice, and each plural category
  of each count key, per language.

## Cart line price — slice `order-price-1`

Record `docs/slices/order-price-1.md`. One price rule for every line: the shared `linePrice` (`@amodx/shared`), the
rule `backend/src/orders/create.ts` charges. `AddToCartButton.tsx` shows its line total and stores its inputs in the cart
item as `priceInputs` (`LinePriceInputs`: `price`, `salePrice`, `volumePricing`, the chosen first-group option's
`priceOverride`, the chosen personalizations' `addedCost` texts); cart personalizations now carry the product's `id`.
`context/CartContext.tsx` `cartLineTotal(item)` is the ONE browser line function — the cart `subtotal` (rounded to
cents), `CartPageView` and `CheckoutPageView` (summary and the request's `totalPrice`) read it — so a line follows its
CURRENT quantity across volume tiers (also after a merge in `addItem`). An item saved before the slice (no
`priceInputs`) keeps `(unitPrice + Σ addedCost) × quantity`. Price data that does not parse gives NaN in the browser
(as before) and a 400 from the server, shown through the checkout's existing error path; no visitor text was added.
Tests: `test/unit/order-price-1.test.ts`; the mocks of `cmrc-counties-1-checkout` and `locale-1d-client` re-export the
real `cartLineTotal` (their items have no `priceInputs`, so their captured markup stays the oracle).

**Total confirmation (slice `order-confirm-1`, record `docs/slices/order-confirm-1.md`).** `CheckoutPageView` sends
`expectedTotal` = the shown total rounded to cents. On a 409 with `code: "price-changed"` (shared `PriceChangedAnswer`)
it does not navigate and keeps the cart: it stores the answer with `cartKey` (the items' product, variant and quantity)
and shows the answer's line totals (`priceChangedLineOf`), subtotal, shipping, discount and total while `cartKey` is
unchanged — so the next press sends the server's total. A cart change drops them. `CartContext.takeServerUnitPrices`
sets each matched item's `priceInputs` to `{ price: <server unit price> }` and `unitPrice` to that number, so
`cartLineTotal` (the cart page) gives the server's line total; an item saved before `order-price-1` also gets
`priceInputs`. Any other refusal takes the existing error path. The notice shows the answer's `message` (the tenant's
`pricesChanged` text, resolved by the order handler — ruling OC1-TEXT = A); an answer without a non-blank `message` →
its `error`. The key is NOT in the checkout's `strings` prop, so the first render is unchanged. Tests:
`test/unit/order-confirm-1.test.ts`; coverage `test/serving-contract/locale-1/order-confirm-1/coverage.json`.

**Price texts by locale (slice `price-locale-1`, record `docs/slices/price-locale-1.md`).** A price text is read by the
shared `parseMoney` / `linePrice` with the tenant's locale (a `ro-RO` tenant's `12,50` = 12.5).
- Product page: `SitePage` passes `AddToCartButton` a `priceLocale` prop — the normalised locale — ONLY when
  `localeUsesDecimalComma` is true; every decimal-point locale reads exactly like en-US, so those tenants' props and
  flight payload do not change. The button reads with it the shown line total, the cart personalization's `addedCost`
  number and the `(+cost)` label condition (was `parseFloat`).
- Cart (ruling PL1-CART-WIRING = N): the cart takes no locale. At add time the button stores the cart item's
  `priceInputs` in MACHINE FORM (`toMachineFormPriceInputs`: only the texts `linePrice` can select, each with a decimal
  point — `12,50` → `12.50`; a point text is trimmed, otherwise kept). The stored object can hold fewer texts than
  today's (an override hides the rest; a `salePrice` hides `price`); the shown total, the line at every quantity and the
  order request are the same. If one of those texts does not parse — also an unused tier — the item is not added, for
  every tenant (the button keeps its display: NaN when the broken text is the selected price). `cartLineTotal(item)` calls `linePrice(…, undefined)` (machine form
  only). An item stored earlier with a raw comma text keeps the named failure (NaN); no migration.
- Showcase (ruling PL1-SHOWCASE = C narrowed): `prepareBlocks` gives a prefetched showcase product `_priceRange`
  (`withCommaPriceRange`) only for a decimal-comma tenant and a product with tiers whose `price` or a tier price holds a
  comma; the card prints it (`packages/plugins/ARCHITECTURE.md`). Other tenants and products: attrs unchanged.
Tests: `test/unit/price-locale-1.test.ts` (real provider, button, cart page, checkout),
`test/unit/price-locale-1-server-render.test.ts` (the props `SitePage` passes), `test/unit/price-locale-1-showcase.test.ts`
(the showcase server pass).

## Order read by email — slice `order-email-1`

Record `docs/slices/order-email-1.md`. `getOrderForCustomer(tenant, orderId, email)` (`lib/dynamo.ts`) reads
`ORDER#<orderId>` and returns it (without `internalNotes`) only when the stored `customerEmail` equals
`normalizeEmail(email)` (`@amodx/shared`). The order handler stores `normalizeEmail(typed)`; the confirmation address
(`CheckoutPageView`) and the account page's tracking link carry the email as typed or as the session gives it, so the
read normalizes the request side. Only the request side: a stored value that is not in normalized form matches no
request (the current writer makes none; only an order of 2026-02-15..03-07 can hold one; the backend `orders/public-get.ts` normalizes both sides).
Tests: `test/unit/order-email-1.test.ts`.

## Checkout region list — slice `cmrc-counties-1`

Record `docs/slices/cmrc-counties-1.md`. `mapTenant` copies `countryCode` (absent stays absent). The checkout branch of
`SitePage.tsx` passes `defaultRegions` = the regions of `getCountryPack(config.countryCode || "EN")` (RO: the 42 counties;
EN: none) — the tenant's real country, no Romanian fallback. `CheckoutPageView.tsx` uses the delivery config's
`availableCounties` when non-empty, else `defaultRegions`; when that list is empty, the shipping and billing county
fields are a required free-text `<input>` (same label `strings.county`, same form fields `county` / `billingCounty`),
else today's `<select>`. The form renders only on the client with a cart (the server HTML shows "Your cart is empty").
Tests: `test/unit/cmrc-counties-1-{checkout,site-page}.test.ts` (959f288 markup oracle
`test/unit/cmrc-counties-1-before.json`), serving row `cmrc-counties-1` (the props per country; since `locale-1d` the
checkout `strings` are the language's table) and, until `locale-1d` retired it, `cmrc-counties-diff` (the byte change
against the `959f288` capture `test/serving-contract/cmrc-counties-1/before/`, CM1-A1 exactly, kept as that slice's
record; its successor `loc1-diff-1d` compares under CM1-A1 plus the ruled resolved-tree payload comparison of locale-1b,
and the CM1-A1-exact comparison of those URLs continues in `cm1-identity-*`).

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

## Language segment — slice `lang-1b` (PROTOTYPE)

Specification: `docs/slices/lang-1.md` § 7, § 8.1, § 8.2, § 9.2; the serving rows are in `docs/caching-architecture.md`
§ *Language segment*. A tenant may list extra languages (`languages`); a page whose address starts with `/<l>` (`<l>`
listed) is in language `<l>`. The root layout `app/[siteId]/layout.tsx` cannot see the address, so the middleware writes
the language into the internal first segment: `/<host>~<l><path>` (`lib/site-segment.ts` `siteSegmentFor`).

- **Middleware.** After the booking branch: a host or by-id id carrying `~` (literal or percent-encoded in any depth,
  `carriesSiteSegmentSeparator`) → `404`. Every language decision reads the first segment as the page body receives
  it (`firstPageSegmentOf`: decoded once, an encoded slash kept encoded — OBSERVED Next behaviour). The production
  branch switches on `hostVerdict`: `wired` → `pageLanguageOf` (the shared address rule) on that segment over the
  verdict's list → `<host>~<l>` or `<host>`; `unknown` → a language-shaped first segment goes to the twin with
  `<host>~<first>` (never stored). Route handlers need no exemption: they live at the site root and their names are
  never language-shaped; `isSiteRouteHandler` is a suffix match used only for its older jobs. By-id paths
  (`byIdTarget`) get the twin with `<id>~<first>` for a language-shaped first segment, without a tenant read; other
  by-id paths keep today's target. A leaked `/<id>~<l>/_dyn/…` redirects to `/_site/<id>/…`.
- **Layout.** `parseSiteSegment(siteId)` → the tenant is read by the host; `segmentLanguage` keeps the segment's
  language only when this read's `config.languages` lists it. `<html lang>` = `languageTagOf(language, localeLanguageSubtag(locale))`;
  the texts = `resolveLocaleStrings(localeInputFor(config, language))` — an extra language gets its pack without the
  tenant's overrides (LANG1-OVERRIDES = A). The menu and footer lists: `lang-1c` (next section).
- **Pages.** Both catch-all pages pass the host to `SitePage` / `buildSitePageMetadata`. `SitePage`'s page chrome
  derives the language from its own address (`pageLanguageOf(slugPath, config.languages)`), the § 5 rule; it equals
  the layout's choice whenever the middleware's verdict and the page's tenant read agree.
- **`mapTenant`** adds `readLanguageSettings(item)` (`languages`, `navLinksByLang`, `footerLinksByLang`; `[]`/`{}` when
  absent) — the same read rule the gate applies to its projected AttributeValues.
- **Purge.** `api/revalidate/route.ts` deletes the `<domain>~…` S3 objects too, revalidates the `~<first>` path for a
  language-shaped slug, and refuses a `domain` with `~`.
- **One-language tenants** get no suffix: the same rewrite, key, tenant read, `lang` and texts.
- Finding F-LANG-SITEID-NAME: the parameter `[siteId]` holds a host, a tenant id, or `<host>~<lang>`; a rename would
  change the RSC payload of every tenant (`"n":"siteId"`), so it is not proposed; `parseSiteSegment` states the contract.

## Languages in the page — slice `lang-1c` (PROTOTYPE)

Specification: `docs/slices/lang-1.md` § 6.2, § 8.3–§ 8.6, § 9.3; rows `lang1c-*` (`test/serving-contract/contract.test.mjs`),
`test/unit/lang-1c-{membership,switch-client}.test.ts`. Every new read and element runs only when `config.languages` is
not empty (and, for the head, when the page holds a set key), so a one-language tenant renders and reads as before.

- **The membership rule** (`lib/dynamo.ts`, one implementation for the head and the sitemap). Page `<n>` is a member of
  set `K` when the item `TRANSLATION#K#<n>` exists, `CONTENT#<n>#LATEST` is `Published` with a string `slug`, and that
  LATEST holds `K` now (`parseTranslationSk`, `passesMembership`). `listedAlternates` (pure) gives each member its
  `hreflang` (`languageTagOf(pageLanguageOf(slug, languages), localeLanguageSubtag(locale))`), leaves out every value
  two members hold, and answers `null` below two listed members; the order is the default language, then `languages`;
  `x-default` = the listed default-language member; the path is `/` only for a default-language member whose slug is
  `homePageSlug`. A stale item (page missing, Draft, Archived, or holding another key or none) is skipped — never
  written (debt entry in `docs/TECH-DEBT.md`).
- **Reads (no scan).** Head: `getTranslationSetMembers` — one paginated `Query begins_with(SK, "TRANSLATION#<K>#")` + one
  `GetItem` per item (`slug, status, translationKey`). Sitemap: `getTranslationItems` — one paginated
  `Query begins_with(SK, "TRANSLATION#")`, joined in memory (`sitemapAlternates`) with `getPublishedContent`, which now
  also returns `nodeId` (from the SK) and `translationKey` (one more projected attribute; same query).
  Added reads per request: one-language tenant 0 (page and sitemap); two-language tenant — a content page that holds a
  set key: 1 Query per 1 MB page of the set's membership items + one GetItem per PARSEABLE item, stale items included
  (Draft, Archived, a missing page, a page holding another key or none); so `k` items cost `k` GetItem even when fewer
  pages are listed, and a page alone in its set still pays 1 Query + 1 GetItem though it gets no alternates (row
  `lang1c-hreflang-member-invalid`: 2 listed, 6 GetItem in the unit test). A page in no set: 0. The sitemap: 1 Query per
  1 MB page of the tenant's items (stale items add to its volume), no GetItem.
- **Head** (`components/SitePage.tsx` `buildSitePageMetadata`, content pages only): `alternates.languages` = one
  `https://<domain><path>` per listed member + `x-default`. Next writes them as `<link rel="alternate" hrefLang>`, and
  writes the URL of `/` as its origin (`https://<domain>`, as today's canonical of `/`). Below two listed members the
  object is exactly today's `{ canonical }`. A page that holds the key without being listed (a same-language pair, a
  missing item, a preview of a Draft) still carries the set's listed alternates — § 8.4 takes "the page's set".
- **Sitemap** (`app/[siteId]/sitemap.xml/route.ts`): each listed member's `<url>` gets `<xhtml:link>` lines (href
  XML-escaped); `<urlset>` declares `xmlns:xhtml` only when at least one link is written; `<loc>` is unchanged.
- **Menu and footer** (`app/[siteId]/layout.tsx` `linksFor`): an extra-language page uses `navLinksByLang[l]` /
  `footerLinksByLang[l]` when the read rule kept that key (an empty list included), else `navLinks` / `footerLinks`; the
  default language passes the same values as before.
- **Switch** (`languageSwitchOf` in the layout → `Navbar` prop `languageSwitch`, a conditional spread): default language
  first, then `languages`; label = `Intl.DisplayNames([l]).of(l)`; `href` = the language home; `aria-current="true"` on
  the page language. Rendered twice (desktop bar, mobile bar) as plain `<a>` (a language change loads the document). On
  the client the Navbar reads the head's `<link rel="alternate" hreflang>` paths and uses them in place of the homes; a
  `MutationObserver` on `<head>` reads them again when Next replaces the metadata (a client navigation). Every `href`
  goes through `getUrl` (the preview prefix, as the menu links) and loses a trailing slash (`/_site/<id>`, as `<Link>`).
- **Keep `Navbar.tsx` small (finding F-LANG1C-CHUNK-SPLIT, OBSERVED on Next 16.4.6 / Turbopack).** The root layout's own
  client chunk (`Navbar` and the other layout client components) is split by Turbopack at a size threshold measured
  BEFORE minification (comments count): crossing it moves a 250-byte async loader into its own chunk, which adds one
  `<script src>` to every page of every tenant — a byte difference the identity rows (`cm1-identity-*`, `loc1-*`, `cq1-*`,
  `ct1-*`, `sched1g-preserve`) report, with no visible change. HEAD `d940fc1` had 1 500–2 000 characters of room; after
  `lang-1c` 400–800 remain. So this slice's explanations live here and in the layout (server code, not in the chunk),
  not in `Navbar.tsx`; a two-argument `new URL(…)` is avoided there for the same reason (it also crossed the threshold).
  Any later client growth of the layout's components can cross it; the ruled comparators then fail without a defect.

## Hosted booking pages — slice `sched-1g2` (PROTOTYPE)

Specification: `docs/slices/sched-1.md` § 8, § 9, § 10.1, § 12, § 16.3 (PD-002 booking-token variant). The booking
screens for appointments (a slot with a practitioner; the group shape was removed by `sched-groups-remove-1`, its
code is on branch `archive/group-scheduling-2026-11`), on the tenant's own domain or — for a tenant
without one — on the preview host. The browser talks only to the renderer; the renderer calls the scheduling visitor
routes of the backend with the `RENDERER` key (`backend/src/scheduling/visitor/*.ts`, deployed by `sched-1d2`/`1g1`).

**Routing.** `middleware.ts` branch `A3` (`lib/booking-path.ts` `bookingRoute`, pure): `/_booking[/rest]` on a host whose
`hostVerdict` is not `unwired` (its language list is not read; `lang-1b`) → rewrite to `/_book/<host>[/rest]`; `/_site/<id>/_booking[/rest]` on a preview host →
`/_book/<id>[/rest]`; first path segment `_book` in any spelling (`%5Fbook`, `%255Fbook`, mixed case; `//_book` is first
answered 308 by Next itself) → `404` + `private, no-store`. No `%5Fdyn` twin, no `amodx_preview_base` cookie, no
session-cookie test. `/_booking/manage` also gets `Referrer-Policy: no-referrer`; the book page and the manage page get
`X-Robots-Tag: noindex, nofollow` (`sched-1g3`, both in `bookingRewrite`). The `[siteId]` of the tree is therefore
always chosen by the middleware, never by the wire.

**Second root layout** (`app/%5Fbook/[siteId]/layout.tsx`, SCHED-PAGE-LAYOUT = A): `<html lang>` (tenant locale),
`<body>`, the tenant theme (`_components/BookingTheme.tsx`, server-rendered CSS variables + the theme's two Google
fonts). It renders no Analytics, Paddle, Facebook pixel, cookie banner, popups, referral beacon, navbar, footer or
cart providers. The book page adds reCAPTCHA v3 as a plain `<script async>` (tenant key when the tenant stored both
keys, `mapTenant` § 9.1, else `RECAPTCHA_SITE_KEY`); the manage page adds no third-party script. Everything in the tree is
`force-dynamic`: pages answer Next's `private, no-cache, no-store, max-age=0, must-revalidate`, handlers
`private, no-store`, the feed `private, max-age=300` on 200.

**Scheduling switch and indexing (slice `sched-1g3`).** The book page, the manage page and the feed exist only when the
tenant record exists AND its `schedulingEnabled` is exactly `true` (`lib/booking-tenant.ts` `getBookingTenant`;
`mapTenant` maps the attribute only when it is `true`, so the mapped record of a tenant without scheduling is
unchanged). Otherwise the pages call `notFound()` (the tree's force-dynamic 404, never stored) and the feed answers its
one URL-holder 404 `linkNotValid` without a backend call. The check is in the tree because each of these already read
the tenant record: no new read, and the middleware reads no switch, so no other path pays for it. The API ops are not
gated here: the backend answers its own 403 `notAvailable` and the proxy passes it through. Both pages carry
`<meta name="robots" content="noindex, nofollow">`; `sitemap.xml` lists content pages, categories and products only, so
no booking address. Both pages also answer `X-Robots-Tag: noindex, nofollow` (ruling SCHED-1G3-XROBOTS = A): an App
Router page cannot set a response header, so `middleware.ts` `bookingRewrite` sets it for `rest` = `""` (book) and
`/manage`, next to `Referrer-Policy`; the API ops, the feed and every non-booking response do not get it.

**Rule of the tree (measured in `sched-1g2`).** No module that runs in the browser may import a client module of the
site tree (`ThemeInjector`, `RecaptchaProvider`, …) or `@amodx/shared` at runtime (type imports are fine): a client
module shared by both trees makes Turbopack regroup the client chunks of every existing tenant page (+2 or +3 chunk
references per page, measured on `cm1-content /about`), which breaks the byte identity of existing pages. Hence
`BookingTheme` instead of `ThemeInjector`, the plain reCAPTCHA `<script>`, and `lib/booking-ui.ts` (browser-safe,
with `fillText`, a copy of `fillTemplate`) apart from `lib/booking-text.ts` (server: language and texts from the
packs). `test/unit/sched-1g-pure.test.ts` checks the rule on the sources.

**Pages.** Book (`_components/BookFlow.tsx`): offer → service (free starts week by week up to `lastBookableDate`,
`Pickers.tsx` `SlotWeek`) → name, email, phone → hold (one intent id per chosen time, kept across retries and
the resend) → "check your email". Manage (`_components/ManageView.tsx`): reads `#t=<token>`, removes the fragment
(`history.replaceState`), keeps the token in memory, `POST view`; Confirm (only the button sends `POST confirm`), Cancel
(asked once more), Move (slot: the free starts of the booking's OWN service — the slot view carries its stored
`serviceId`, ruling SCHED-1G2-SLOT-MOVE-ID = A; a service that no longer exists → "cannot be changed here, please contact
us"). Every refusal code maps to a visitor text (`lib/booking-ui.ts`
`REFUSAL_TEXT`, unknown → `errGeneric`) and, where the visitor must act, to an action of the page (`refusalRecovery`):
a token-free "new booking" link or button (expired, used or closed form), or "show the current booking" with the
token kept in memory (stale); no text asks the visitor to reload the page. Writes (hold, resend, confirm, cancel, move,
refresh) follow ONE lifetime rule (`_components/operation.ts` `useOperation`): one at a time, every control (pickers
included) disabled meanwhile, an answer applied only to the screen it was started for. `?service=` starts
the flow on that service when the offer lists it (unknown → the offer); `?course=` is not read. Texts: the `booking`
part of the language packs (`packages/shared/src/language-packs/`, EN + RO complete), selected by `?lang=` (a language
with a pack) else the tenant locale; `sched-labels-1`: over them the site's own texts (`bookingStrings`, admin Labels
"Booking"), ONLY on a page in the tenant's own language — the language of its page without `?lang=` (ruling
LANG1-OVERRIDES = A); `lib/booking-text.ts` `bookingTexts(language, config)`, used by both pages and their metadata.
Texts are rendered as React text (escaped). Times in the tenant's zone with the zone named. `?frame=1`: no
header, transparent background (the frame chrome is `sched-frame-1`).

**Proxy** (`lib/booking-proxy.ts`, users: `api/[op]/route.ts`, `feed/…/route.ts`): op table `BOOKING_OPS` (offer, slots:
GET; hold, view, confirm, cancel, move: POST) → exactly one backend route each; method (405 + `Allow`), body
≤ 8 KB (413), JSON (400), input check with the backend route's OWN schema, imported from `@amodx/shared` (`HoldRequestSchema`, `MoveBodySchema`,
`KeyPart`, `LocalDateSchema`; moved there from the backend handlers by ruling SCHED-1G2-ZOD-DEP = C; the renderer
imports no `zod` itself) — 400 in the backend's issue form; a malformed or absent link token → 404 `linkNotValid`, the
backend's one answer; tenant record of `[siteId]` (absent → 403 `notAvailable`), then the call with exactly `x-api-key` (renderer key),
`x-tenant-id` = the record's id and, for a POST, `content-type` — no header of the browser's request is forwarded; a body that passed the strict schema is forwarded as received; the backend status, JSON body and
`Retry-After` pass through. No `API_URL` / no key / a failed call → 503 `unavailable`. Feed: `<secret>.ics` (43-character
base64url) → POST `/scheduling/visitor/feed` `{ resourceId, secret }`; every URL-holder failure → one 404 body.

**Client address (§ 9.2) — none, by ruling SCHED-ADDR-INFRA = A (human, 2026-11-22).** The staging witness G13 showed
that the renderer receives one `X-Forwarded-For` value that the caller controls and no `CloudFront-Viewer-Address` (the
renderer distribution's origin request policy is full at CloudFront's ten headers). So the proxy sends NO
`x-viewer-address`, permanently in this version; the backend then applies no per-address limit and sends no
`remoteip` to reCAPTCHA. What protects the anonymous hold: reCAPTCHA (a token minted on the tenant's page), at most
five holds per email per hour and at most two open holds per email (both per tenant, § 9), and hold expiry (an
unconfirmed hold ends after the tenant's `holdMinutes`). The witness (`offer?witness=`, its log line) is removed
(`sched-1g3`): `offer` takes no parameter. The pure `packages/shared/src/client-address.ts` and the backend's handling of
an absent header are unchanged.

**Known limits.** `<html lang>` stays the tenant's when `?lang=` selects another language (the wrapper `<div lang>`
carries the texts' language). Every page's RSC payload now lists `%5Fbook` among the static siblings of `[siteId]`
(`"s":["%5Fbook","api"]`; nothing in the HTML outside the payload or in headers); the byte-identity rows accept exactly
that one item (ruling SCHED-1G2-ROOT-SIBLING = A, `cm1-byte-identity.mjs` `rootSiblingAllowance`, controls row
`sched1g-root-sibling-controls`).

**Tests.** Serving rows `sched1g-*`, `sched1g3-*` and `schedlabels1-override` (`test/serving-contract/contract.test.mjs`;
fixtures `SCHED1G`, `SCHEDLABELS1`); unit `test/unit/sched-labels-1.test.ts` (the override layer and its language rule,
`mapTenant`);
`test/unit/sched-1g-pure.test.ts` (path, texts, `mapTenant` reCAPTCHA pair and scheduling switch, structural rules,
coverage of the booking keys),
`sched-1g-proxy.test.ts` (forwarding, no address and no browser header forwarded, the feed and its scheduling
switch, no direct zod import, the input inventory: every proxy input absent / valid / malformed), `sched-1g-pages.test.ts` (jsdom: flows, G7, every refusal text, the lifetime
rule, the selectors, recovery). Locale coverage file: `test/serving-contract/locale-1/sched-1g/coverage.json`.

## Authentication

Per-tenant Google OAuth via NextAuth.js:
- Handler dynamically fetches tenant config to get `clientId` / `clientSecret`
- Sets `NEXTAUTH_URL` to tenant domain at runtime (handles multi-domain redirect URIs)
- Session includes `tenantId` and user `id`
- Used by CommentsSection for authenticated posting

## Theme System

**LANDING-1 (PROTOTYPE; `docs/slices/landing-1.md`).** The existing chrome roots carry reserved marker classes:
TopBar's outer `div` = `site-top-bar`, CommerceBar's outer `div` = `site-commerce-bar`, Navbar's outer `nav` =
`site-navbar`, and the layout's `footer` = `site-footer` (both theme shapes). No wrapper or component prop is added.
`SitePage` emits an unlayered `display: none !important` rule for the first three classes when `hideNav` is true,
and for the footer class when `hideFooter` is true. No element selector is used. The Navbar's desktop dropdown,
mobile toggle/menu and category bar are descendants of its marked root. CommerceBar remains desktop-only as before.
CookieConsent, PopupManager and QuickContact are outside the four roots; their mounting rules do not change.
This is presentation only: hidden chrome and links remain in HTML. Both switches off adds only the marker classes.
Headless rows A1–A5: `test/unit/landing-1.test.ts`; serving expected-data derivation and exact historical capture-line
inventory: `test/serving-contract/landing-1-expected.mjs`, `landing-1-capture-lines.json`. These transform EXPECTED
data only, after HYDRATION-1 derivation; stored captures, candidates and comparison masks stay unchanged.

`ThemeInjector.tsx` injects CSS custom properties into `:root`:
- Colors: `--primary`, `--primary-foreground`, `--secondary`, `--background`, `--foreground`, etc.
- Typography: `--font-heading`, `--font-body`
- Layout: `--radius`
- Loads Google Fonts non-blocking (preload as print, swap to all on load)
- Sets `window.AMODX_TENANT_ID` for client-side block components

**CAT-THEME-1 (docs/slices/cat-theme-1-impl.md).** Eight optional theme fields and `footer.contentMaxWidth`. Absent →
byte-identical output (every new output is a conditional segment that is `""` / a conditional spread when absent):
- `ThemeInjector`: `--muted-foreground` = `mutedColor` (default `#64748b`), `--border`/`--input` = `borderColor` (default
  `#e2e8f0`); `fontNav` → a third Google family + `--font-nav`; the request weights = `400;700` ∪ `fontWeights`, ascending,
  for every family; `headingWeight` → one `h1…h6 { font-weight }` rule; `shape: "editorial"` → `--section-gap: 6rem`, the
  no-shadow rule (`--tw-shadow` forced to a transparent zero shadow — rings keep `--tw-ring-shadow`; `--tw-drop-shadow` reset to
  `initial`, so the hero / video-hero `drop-shadow-*` filters lose only the shadow — row `ct1-no-shadows`) and the arrow rule
  (`[data-theme-arrow]::after, [data-quote-request]::after { content: " ↗" }`). The `<style>` is unlayered, so it wins over
  Tailwind's layered utilities.
- `layout.tsx`: `editorial` → header wrapper `border-t-[3px] border-primary`, footer `bg-muted` (surface) instead of
  `bg-muted/30`; footer width = `footer.contentMaxWidth || header.contentMaxWidth || "max-w-7xl"`; Navbar gets `navFont` /
  `linkArrows`, CommerceBar `ctaArrow` — only when set (conditional spread). `mapTenant` copies `footer`.
- `SitePage.tsx`: `editorial` → the content-page and listing `<main>`s use `py-[var(--section-gap)]`, the spec table is
  `grid-cols-2` with 1 px row hairlines; `cardImage: "landscape"` → card image `h-[245px]`; `cardCategoryLine` → the first
  category's name under the card title (sharing the title's child slot — a new child slot would change the payload of
  every card), the category and search routes read the categories only when the line is on.
- Tailwind 4 compiles only class names written in the files it scans — which is every file under `renderer/`, test
  fixtures and captured `.body` files included (EXECUTED with `@tailwindcss/oxide`'s Scanner, cat-theme-1 record § 4).

**BULK-PURGE-FOOTER-1 (docs/slices/bulk-purge-footer-1.md).** `footer.backgroundColor` / `footer.textColor` (one value for
light and dark): `layout.tsx#footerColorStyle` puts `background-color` and the re-declared `--color-foreground` /
`--color-muted-foreground` (the variables the footer's `text-*` utilities read; `--foreground` would not reach them —
`@theme` resolves it on `:root`) in the `<footer>`'s `style`, added by a conditional spread only when a valid colour
(`isCssColor`) is set — absent → today's bytes (an RSC payload would encode `style: undefined` as `"$undefined"`).
Rows `bpf1-*`.

**HEADER-COLOURS-1 (docs/slices/header-colours-1.md).** `header.backgroundColor` / `header.textColor` (one value for
light and dark): `layout.tsx#headerColorStyle` re-declares `--color-background` (read by the navbar's `bg-background/80`
and by the `bg-background` of its desktop dropdown and mobile panels — the bar keeps its translucency and blur, the
panels follow it) and the footer's two text variables. The style reaches the client `Navbar` as the `colorStyle` prop,
passed by a conditional spread only when a valid colour (`isCssColor`) is set — absent → no prop, no `style`, today's
bytes. Link hover (`--color-primary`) and the contact button keep the theme. The Top Bar and the Commerce Bar (siblings
of the `<nav>` in the sticky wrapper) and the Search Bar (rendered by `SitePage`) are not inside the `<nav>`: unchanged.
Rows `hc1-*`; unit `test/unit/header-colours-1.test.ts`.

**SHOP-LOOK-1A (docs/slices/shop-look-1a.md; design docs/slices/shop-look-1.md § 4-6, ruling SHOPLOOK-CATBAR = C).**
Three header and footer pieces, each drawn only when set (absent, blank or an empty list = today's bytes):
- `header.tagline` → the `Navbar` prop `tagline` (trimmed; conditional spread): a `<span>` after the title inside the logo
  link, `hidden sm:inline`, small uppercase, `text-muted-foreground`.
- `header.categoryBarIds` → the layout calls `lib/dynamo.ts#getActiveCategoriesByIds(tenantId, ids)` (one `GetCommand` per id
  on `TENANT#<id>` / `CATEGORY#<id>`, projection `id, #n, slug, description, imageLink, #s`; a category whose `status` is
  not `active`, or a missing one, is skipped; no request without ids) and passes `categoryBar = { label, links }` only when
  at least one category resolved. `label` = site key `navCategoryBarLabel` (inside this prop, not in the shared
  `strings`); `href` = `urlPrefixesOf(urlPrefixes).category + "/" + slug`, then `getUrl` in the Navbar. Drawn as a
  second row: `<nav aria-label>` inside the header `<nav>`, after row 1, one horizontally scrolling line. Read cost: at
  most 12 `GetCommand`s per uncached render, only for a tenant that stores ids. The extra `await` changes the order of
  the RSC row ids for such a tenant (content equal; rows `sl1a-*` compare the payload resolved).
- `footer.brandText` / `footer.columns` → one slot of the footer: with either, a grid `grid-cols-1 sm:grid-cols-2
  lg:grid-cols-N` (N = every column drawn, literal classes 1-8 in `FOOTER_LG_COLUMNS`) replaces today's grid element
  whole: brand text (`whitespace-pre-line`), the named columns (raw `href`, as `footerLinks`), then today's three columns
  (`companyColumn`, `linksColumn`, `legalColumn`, the same elements as before). Without either: today's grid element.
Rows `sl1a-header-footer`, `sl1a-blank-as-absent`; unit `test/unit/shop-look-1a-layout.test.ts`,
`test/unit/shop-look-1a-read.test.ts`.

**SHOP-LOOK-1B (docs/slices/shop-look-1b.md; design docs/slices/shop-look-1.md § 4.2, § 6.5).** No renderer source
change: the hero options live in the plugin (`packages/plugins` ARCHITECTURE § *The `hero` block's options*) and reach the
page as stored block attributes through `RenderBlocks` (the second button's link through the injected `_getUrl`). Rows
`sl1b-hero-options` (a cover hero and a split inverse hero with every option: the HTML equals the twin's after removing
the new elements and undoing the § 6.5 class swaps; the payload differs by the stored attributes only; the built
stylesheet holds every new class, e.g. `.bg-foreground`, `.text-background`) and `sl1b-blank-as-absent` (`null` and
blank options: the twin's HTML byte for byte).

**SHOP-LOOK-1C (docs/slices/shop-look-1c.md; design docs/slices/shop-look-1.md § 4.2, § 6.3, § 6.4).** `prepareBlocks`
gains one branch, for `categoryGrid` blocks only: the stored `categoryIds` (non-blank strings, the first 12; a stored
13th id is not read) → one `getActiveCategoriesByIds(tenantId, ids)` call per block (one `GetCommand` per id; no call
without ids) → `attrs._categories` = the resolved categories in the picked order, each built field by field `{ id, name,
description?, imageLink?, path }` (`path` = `urlPrefixesOf(urlPrefixes).category + "/" + slug`; the tile link then goes
through `_getUrl`). No other block's attrs change; a page without the block makes no new read and keeps its bytes (every
existing row unchanged). The block is drawn on content, commerce and catalog sites alike (no kind gate in the renderer;
the admin offers it on commerce and catalog). Rows `sl1c-grid` (the set page = its blank twin + the block's `<section>`,
byte for byte; the payload differs by the block's attributes only; the built stylesheet holds every class) and
`sl1c-blank-draws-nothing`; unit `test/unit/shop-look-1c-grid.test.ts`.

**SHOP-LOOK-1D (docs/slices/shop-look-1d.md; design docs/slices/shop-look-1.md § 6.3, § 6.4, § 7).** In the
`categoryShowcase` branch, after the products are read and only on a non-catalog tenant (SL-D10),
`withShowcaseCardData(attrs, items, config)` adds the data of the card options that are ON (stored exactly `true`); with
all three off it returns the same array and reads nothing. Per block: `showCategoryLabel` → one `getAllCategories` call
(paginating Query, active only) → `_categoryName` = the name of `categoryIds[0]` (hidden or missing → no key);
`showDescription` → one `getProductById` per product → `_descriptionText` = `cardShortText(description)` (sanitize-html
with no allowed tag, block tags and literal `\n` → a space, its three escapes undone, white space collapsed, at most 400
code points; plain text, never HTML); `showRating` → one `getProductReviews` per product (paginating Query, approved only)
→ `_rating` = `{ average, count, text }` with `text` = the tenant's `reviewsSummary` filled as on the product page (no
approved review → no key). Only the first 12 products are read (`SHOWCASE_CARD_READ_LIMIT`). A product with no new data is
the same object; otherwise a copy with only the new keys. `badgeTags` and `eyebrow` need no read. The post grid's options
need no read; its branch is unchanged. Rows `sl1d-options` (the set page = the plain twin + the new elements, HTML byte
for byte; the payload = the twin's + the stored options and the added product keys; the built stylesheet holds every
new class), `sl1d-blank-as-absent` (null, blank and off options: the twin's HTML; no server key) and
`sl1d-catalog-no-effect` (catalog: the twin's HTML with every card option on); unit
`test/unit/shop-look-1d-showcase.test.ts` (calls and DynamoDB requests per option; the two-page cases of
`getAllCategories` and `getProductReviews`).

**SHOP-LOOK-1E (docs/slices/shop-look-1e.md).** `prepareBlocks` gains one branch, for `form` blocks only: the stored
`formSlug` trimmed; blank or not a string → no read; else one `getFormBySlug(tenantId, slug)` per block (two keyed
`GetCommand`s under `TENANT#<this tenant>`: `FORMSLUG#<slug>`, then `FORM#<id>`; active forms only) → `attrs._form` =
`formForBlock(form, slug, site texts)`, built field by field: `{ slug, name, fields, submitButtonText, successMessage,
strings }` — `fields` the stored entries that pass `FormFieldSchema`, the first of each label (the submit handler's rule);
`strings` the four form texts of the tenant's locale table. Never the stored item (it holds the owner's notify address,
the keys, status and dates). No form, a disabled form → no `_form` → the block draws nothing. No other block's attrs
change; a page without the block makes no new read (every existing row unchanged). The browser submits to
`<NEXT_PUBLIC_API_URL>/public/forms/{slug}/submit` with `x-tenant-id` (the block's `tenantId` prop); the value of
`NEXT_PUBLIC_API_URL` is inlined into the block's chunk by `next build` (OBSERVED: the serving build's chunk holds
`apiUrl:""`). Freshness: the forms create / update / delete handlers already purge the tenant's stored pages
(`withInvalidation(…, purgeStoredPagesOfRequestTenant)`). Rows `sl1e-form` (the set page = its blank-slug twin + the
block's `<section>`, byte for byte; the payload differs by the block's attributes and `_form` only; no notify address;
the stylesheet holds every class) and `sl1e-draws-nothing` (a disabled form and a slug of no form: two empty wrappers);
unit `test/unit/shop-look-1e-form.test.ts` (calls and requests; the DTO; the field rule; locale texts) and
`test/unit/shop-look-1e-form-client.test.ts` (jsdom: the request, reCAPTCHA token, success, failure).

## Path settings — slice `cdl-2`

Design `docs/slices/catalog-data-labels-1.md` § 7, § 14; record `docs/slices/cdl-2.md`.

- `mapTenant` (`lib/dynamo.ts`) sets `urlPrefixes = urlPrefixesOf(stored)` (shared): per key the saved path, else the
  English default. A stored object with one key (what Settings saves on a tenant that stored none) or a cleared `""`
  field no longer leaves the other keys `undefined`, so product, category, shop, cart and checkout route again
  (F-CDL-PARTIAL-PREFIXES; row `cdl2-partial-prefixes`). Every reader of `config.urlPrefixes` gets a complete object.
- The interest list's default address is `/my-list` (`URL_PREFIX_DEFAULTS.interest`). Only the header `InterestWidget`
  (desktop and mobile copies, `Navbar` prop `interest.listPrefix`) links to it.
- `SitePage.tsx` `matchCommercePrefix`: the order confirmation is `checkout + checkoutConfirmation` (default
  `/checkout/confirmation`; was the fixed `/confirmare`); every other segment under `checkout` is a tracking address,
  so `/checkout/confirmare` now answers as tracking for the order id "confirmare". `CheckoutPageView` gets
  `confirmPrefix` from the same two keys. Every view in `SitePage.tsx` that reads a prefix falls back to
  `URL_PREFIX_DEFAULTS` of the same key; the Romanian literals (`/magazin`, `/produs`, `/comanda`, `/cos`) are gone.
  Their input is `mapTenant`'s complete object, so no fallback is reached and the served bytes did not change
  (serving contract: no listed difference on any commerce or content page from these lines).
- The backend slug check (`backend/src/lib/slug-guard.ts`) holds a copy of this route precedence to name the page
  in its refusal; `test/unit/cdl-2-site-page.test.ts` › "CDL2-R2 overlaps" runs the same rows through `SitePage`.
- Serving contract: current set `test/serving-contract/locale-1/cdl-2/` (7bd3d51), rows `cdl2-*`.

## Block Rendering (`RenderBlocks.tsx`)

Merges core block types (paragraph, heading, lists, blockquote, horizontal rule) with the plugin
render components. **perf-1:** the plugins are loaded lazily — `RenderBlocks` builds a stable
per-block-type map of `next/dynamic(loader, { ssr: true })` wrappers over `RENDER_LOADERS` from
`@amodx/plugins/render`, so a page ships only the render chunks for the block types it actually
renders (was: a static `RENDER_MAP` that co-bundled all ~20 plugins into one ~1.2 MB client chunk on
every content page). `ssr: true` keeps each block in the server-rendered/ISR HTML unchanged. Handles
Tiptap marks (bold, italic, link) and auto-rewrites internal links for preview mode via `useTenantUrl()`.

## Build & Deploy

- Dev: `npm run dev` (next dev)
- Build: `npm run build` (next build)
- AWS build: `npm run build:open` (next build + `open-next build` for Lambda; the adapter is
  `@opennextjs/aws` 4.1.9, exact pin, configured in `open-next.config.ts`, patched by
  `patches/@opennextjs+aws+4.1.9.patch` — SWR window 300 s and the #1250 seed; guarded by
  `scripts/verify-opennext-patch.mjs` and the bundle suite `npm run test:serving-bundle`)
- Lint: `npm run lint` (ESLint with next config)
- Tailwind v4 via `@tailwindcss/postcss`

## Hydration contract (hydration-1)

`SitePage` uses its local `normalizePageAddressOrKeepRaw` function for metadata and JSON-LD/share data.
For parseable inputs it matches Next's WHATWG normalization and root-origin rule, including JSON-LD.
If parsing fails, it preserves the pre-existing raw value without throwing in SitePage; it does not validate malformed tenant configuration.
`SocialShare` receives that address string; all links and copy use it, including on preview URLs.
Its block is in server HTML. `useTenantUrl` reads its cookie fallback after mount; pathname routing stays immediate and bypasses the cookie read/decoder entirely.
Headless SSR/hydration bindings and the render-read audit: `docs/slices/hydration-1.md`.
Serving expected data is forward-derived from recorded share props and canonicals, not re-captured by the builder;
no candidate output is masked. The local-server/browser/staging proofs remain operator gates.

## Facebook consent gate (pixel-consent-1)

The site layout still mounts `FBPixel` only when `integrations.fbPixelId` is set (layout unchanged).
`FBPixel` stays a server component; it only does `await import("./FBPixelLoader")` and renders
`<FBPixelLoader pixelId>`. `FBPixelLoader` is the client component: its existing `useConsent` hook
starts at `null` on the server and the first client render; only its effect reads
`window.AMODX_CONSENT`. It returns `null` unless `marketing === true`. The script text, id and
`afterInteractive` strategy are unchanged. There is no `noscript` image: a visitor
without JavaScript cannot choose consent, so this route must not report a PageView.

Why the dynamic import (measured, serving rows `cm1-identity-*`): a static import of a new client
module from the layout graph, a second export in `Analytics.tsx`, or a `fbPixelId` prop on
`Analytics` each made Turbopack's chunk optimiser move an existing 250-byte async-loader stub
(the `@amodx/effects/render` import of `PageEffectWrapper`) out of the shared layout chunk, so
every compared HTML page of the tenants without a pixel id referenced it too (+2 or +3
`/_next/static` references per URL against that URL's baseline). With the dynamic import, every
`cm1-identity` URL compares equal to its baseline under the existing canonicalisation, with equal
`assetPath` per URL. The partition is Turbopack's
decision; it was observed, not derived. Re-run `npm --prefix renderer run test:serving` after any
change to the layout's client modules.

The banner writes the global and dispatches `amodx-consent-updated` in its choice
handler; the hook's listener updates React state on the current page. No reload, new
store or server-side cookie read is needed. This also keeps consent out of cached HTML.
`trackFBEvent` sends only if `window.fbq` exists: the loader installs a queue before the
SDK arrives. Earlier events are dropped, not replayed. Its callers remain
`AddToCartButton`, `CheckoutPageView` and `FBPurchaseEvent` (mounted by `SitePage`).
This slice does not unload an already installed SDK, implement consent revocation or
retry a purchase event after later acceptance.

Headless SSR/hydration and inline-loader bindings: `test/unit/pixel-consent-1.test.ts`.
The tests stub the Next Script boundary (the external CJS module resolves a second
React copy here); they execute the supplied loader text in jsdom with external
resources disabled. They are not browser network or deployed Next proofs. Serving
row `sched1g-g6` now requires no loader/image on the pixel-configured home, and (control)
the `FBPixelLoader` client reference with the tenant's pixel id. Test rows, capture delta and gates:
`docs/slices/pixel-consent-1.md`.
