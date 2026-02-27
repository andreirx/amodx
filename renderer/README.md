# Renderer

Next.js 16 multi-tenant public site engine. Deployed to Lambda via OpenNext 3. Serves all tenant websites from a single deployment.

## Stack

- **Next.js 16** (React 19) + **OpenNext 3** (AWS Lambda adapter)
- **Tailwind CSS v4** with PostCSS plugin
- **NextAuth.js 4** — per-tenant Google OAuth
- **DOMPurify** — HTML sanitization
- **Direct DynamoDB reads** — no API calls, server-side only
- **`@amodx/plugins/render`** — 19 block render components

## Multi-Tenant Routing

Middleware (`src/middleware.ts`) rewrites requests based on hostname:

| Mode | Input | Rewrite |
|------|-------|---------|
| Production | `client.com/about` | `/{domain}/about` (via `X-Forwarded-Host`) |
| Test | `/tenant/{id}/about` | `/{id}/about` |
| Preview | `/_site/{id}/about` | `/{id}/about` (admin domains only) |

CloudFront Function preserves `X-Forwarded-Host` header for production routing.

Commerce routes matched by `matchCommercePrefix()` against tenant URL prefixes (`/product/*`, `/category/*`, `/cart`, `/checkout`, `/shop`, `/account`, `/search`).

## Data Fetching

Server components query DynamoDB directly via `@aws-sdk/lib-dynamodb` (no API roundtrip). Key functions in `src/lib/dynamo.ts`:

- `getTenantConfig(siteId)` — reads tenant from `SYSTEM / TENANT#<id>` or `GSI_Domain`
- `getContentBySlug(tenantId, slug)` — reads `ROUTE#<slug>` then `CONTENT#<id>#LATEST`
- `getProductBySlug(tenantId, slug)` — reads `GSI_Slug` with `<tenantId>#<slug>`
- `getProductsByCategory(tenantId, catId)` — queries `CATPROD#<catId>#*`
- `getActiveProducts(tenantId)` — queries `PRODUCT#*` with availability filter

## Caching

- **ISR**: `revalidate = 3600` (1 hour). On-demand revalidation via `/api/revalidate`
- **S3 warm cache**: ISR pages cached in S3 (`_cache/` prefix) for instant cold starts
- **CloudFront**: Disabled for dynamic routes (Lambda). Cached for `_next/static/*` and `assets/*`

## Auth (NextAuth.js)

Dynamic per-tenant provider. Route: `src/app/api/auth/[...nextauth]/route.ts`.

1. User clicks "Sign In" → handler reads tenant config from DynamoDB
2. Initializes Google OAuth with tenant-specific client ID/secret
3. Session scoped to domain, includes `tenantId`

## SEO Engine

Auto-generated per tenant:
- `robots.txt` — based on `TenantConfig.status` (draft sites blocked)
- `sitemap.xml` — published pages from `GET /content`
- `llms.txt` — markdown summary for AI crawlers
- `openai-feed` — JSON product feed for AI agents

## Theme System

`ThemeInjector` component writes CSS custom properties (`--primary`, `--background`, etc.) from tenant theme config. All components use `bg-primary`, `text-muted-foreground` etc.

## Layout

- **Sticky header**: TopBar (announcement) + CommerceBar (phone, social, cart, CTA) + Navbar
- **Footer**: Company details + footer links + legal links (labels from country pack)
- **Full-bleed blocks**: `RenderBlocks` wraps each block individually. `FULL_BLEED_DEFAULTS` (cta, testimonials, carousel) get no wrapper. Others wrapped in `contentPageMaxWidth`
- **Width settings**: `contentMaxWidth` (site shell, default max-w-7xl) vs `contentPageMaxWidth` (prose blocks, default max-w-4xl)

## Commands

```bash
npm run dev          # Next.js dev server (port 3000)
npm run build        # Next.js build
npm run build:open   # OpenNext build → .open-next/
```
