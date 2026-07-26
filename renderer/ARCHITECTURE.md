# renderer — ARCHITECTURE.md

## Role in the System

The public-facing multi-tenant website engine. A single Next.js 16 deployment serves all tenant sites. Uses edge middleware to map incoming domains to tenant IDs, then renders content from DynamoDB using the plugin render components. Deployed to AWS Lambda via OpenNext.

**Depends on:** packages/shared (types), packages/plugins/render (block render components), backend (HTTP API for some routes)

## Internal Structure

```
middleware.ts                                  # Package root (NOT src/) — edge: domain → tenant routing, referral cookie
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
│   └── api/
│       ├── auth/[...nextauth]/route.ts        # Per-tenant Google OAuth via NextAuth
│       ├── comments/route.ts                  # GET (public) / POST (auth required) → backend proxy
│       ├── consent/route.ts                   # GDPR consent logging → backend proxy
│       ├── contact/route.ts                   # Contact form → backend proxy
│       ├── leads/route.ts                     # Lead capture with referral cookie injection → backend
│       ├── posts/route.ts                     # Blog post listing (direct DynamoDB, tag filter)
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
│   └── Providers.tsx                          # NextAuth SessionProvider wrapper
└── lib/
    ├── dynamo.ts                              # Direct DynamoDB access: getTenantConfig, getContentBySlug, getProductById, getPosts
    ├── tenant-directory.ts                    # EDGE runtime: "is this host a wired tenant?" for middleware (own client — see file header)
    ├── not-found-handoff.ts                   # notFoundOrHandoff() — keeps 404s off the cacheable route
    ├── api-client.ts                          # getMasterKey() from env or Secrets Manager (cached)
    ├── routing.ts                             # useTenantUrl() client hook for preview-mode URL generation
    └── routing-server.ts                      # getPreviewBase() — reads amodx_preview_base cookie (dynamic twin only)
```

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
- it carries a NextAuth session cookie (`next-auth.session-token` /
  `__Secure-next-auth.session-token`)
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

Also sets `amodx_ref` cookie from `?ref` or `?utm_source` query params (30-day, httpOnly).
Both triggers are query params, so those requests are already on the dynamic twin — a
`Set-Cookie` can never land on a cacheable response.

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

One open hazard this slice surfaced and did **not** close — read
`docs/caching-architecture.md` § *Open hazards activated by cache-1* before deploying: the
`RSC` request header changes the response body without being in the CloudFront cache key
(**H1**, fixed by `cache-3`, which must ship first or together). The second hazard,
cacheable not-found responses (**H2**), was closed inside `cache-1`.

## Direct DynamoDB Access (`lib/dynamo.ts`)

The renderer reads directly from DynamoDB for performance (bypasses backend API):
- `getTenantConfig(identifier)` — by domain (GSI) or tenant ID (PK)
- `getContentBySlug(tenantId, slug)` — route lookup → content fetch, handles redirects
- `getProductById(tenantId, productId)` — direct get
- `getPosts(tenantId, tag?, limit)` — query all published LATEST content, filter/sort in-memory

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
