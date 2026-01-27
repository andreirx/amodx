# renderer — MAP.md

## Role in the System

The public-facing multi-tenant website engine. A single Next.js 16 deployment serves all tenant sites. Uses edge middleware to map incoming domains to tenant IDs, then renders content from DynamoDB using the plugin render components. Deployed to AWS Lambda via OpenNext.

**Depends on:** packages/shared (types), packages/plugins/render (block render components), backend (HTTP API for some routes)

## Internal Structure

```
src/
├── middleware.ts                              # Edge: domain → tenant routing, referral cookie
├── app/
│   ├── layout.tsx                             # Root HTML wrapper
│   ├── [siteId]/
│   │   ├── layout.tsx                         # Site layout: config fetch, ThemeInjector, Navbar, Footer
│   │   ├── [[...slug]]/page.tsx               # Dynamic catch-all page renderer
│   │   ├── products/[productId]/page.tsx      # Product detail page
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
    ├── api-client.ts                          # getMasterKey() from env or Secrets Manager (cached)
    └── routing.ts                             # useTenantUrl() hook for preview-mode URL generation
```

## Multi-Tenancy Routing

`middleware.ts` runs at the edge with three modes:

1. **Production** — extracts hostname, rewrites `/about` → `/[domain]/about`
2. **Test** — `/tenant/<id>/about` → `/<id>/about`
3. **Preview** — `/_site/<id>/about` → `/<id>/about` (restricted to localhost/staging/CloudFront)

Also sets `amodx_ref` cookie from `?ref` or `?utm_source` query params (30-day, httpOnly).

## Page Rendering Pipeline

`[[...slug]]/page.tsx` handles all content pages:

1. Fetches tenant config via `getTenantConfig(siteId)` (tries GSI_Domain first, falls back to PK)
2. Fetches content via `getContentBySlug(tenantId, slug)` (follows redirects if route has `IsRedirect`)
3. **Access gating:** checks `accessPolicy.type` — Public pages use ISR, LoginRequired verifies NextAuth JWT
4. **SEO metadata:** generates OpenGraph, canonical URL, JSON-LD (Article, Organization, SoftwareApplication, etc.)
5. **Post grid prefetch:** server-side fetches posts for any `postGrid` blocks (avoids client "window is undefined")
6. **Theme merge:** applies page-level `themeOverride` on top of site theme
7. Renders blocks via `<RenderBlocks>` + comments section + social share buttons
8. Shows draft watermark banner for unpublished content

## ISR & Caching

- **Default revalidation:** 3600 seconds (1 hour) on layouts and pages
- **Manual purge:** POST `/api/revalidate` with `{domain, slug}` calls `revalidatePath()`
- **SEO routes:** sitemap.xml cached 1 hour (`s-maxage=3600`), openai-feed cached 15 min
- **Public vs protected:** only public pages are ISR-cached; auth-gated pages check per-request

## Direct DynamoDB Access (`lib/dynamo.ts`)

The renderer reads directly from DynamoDB for performance (bypasses backend API):
- `getTenantConfig(identifier)` — by domain (GSI) or tenant ID (PK)
- `getContentBySlug(tenantId, slug)` — route lookup → content fetch, handles redirects
- `getProductById(tenantId, productId)` — direct get
- `getPosts(tenantId, tag?, limit)` — query all published LATEST content, filter/sort in-memory

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
