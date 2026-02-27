# AMODX — System Design Specification

Serverless multi-tenant CMS and commerce platform on AWS. Single deployment serves up to 99 tenant websites with complete data isolation.

## Architecture Overview

```
Clients ─→ CloudFront (3 distributions)
             ├─ admin.{domain}   → S3 (React SPA)
             ├─ *.{domain}       → Lambda Function URL (Next.js via OpenNext)
             │                      └─ S3 (static assets + ISR warm cache)
             └─ cdn.{domain}     → S3 (uploaded media)
                                    ↓
                              API Gateway HTTP v2
                              (Lambda authorizer)
                                    ↓
                         ┌──────────┼──────────┐
                         │          │          │
                    100+ Lambdas  EventBridge  SES
                    (Node.js 22)    │
                         │         Audit Worker
                         │          │
                      DynamoDB ←────┘
                    (single table, 4 GSIs)
```

## Monorepo Layout

npm workspaces. Build order: `shared → plugins → backend/admin/renderer`.

| Package | Purpose | Tech |
|---------|---------|------|
| `packages/shared` | Zod schemas, TypeScript types, country packs | Zod 4, TypeScript |
| `packages/plugins` | 19 block plugins, split admin/render entry points | Tiptap 3, React 19, highlight.js, marked |
| `backend` | 100+ Lambda handlers across 30 modules | Node.js 22, AWS SDK v3, esbuild |
| `admin` | Control panel SPA (39 pages) | React 19, Vite 7, shadcn/ui, Tailwind v4 |
| `renderer` | Public site engine, multi-tenant SSR | Next.js 16, OpenNext 3, Tailwind v4 |
| `infra` | CDK infrastructure-as-code | CDK 2, 9 constructs, 3 stacks |
| `tools/mcp-server` | Claude Desktop integration | MCP SDK, Playwright |

## AWS Services

| Service | Usage |
|---------|-------|
| **DynamoDB** | Single-table, pay-per-request, PITR enabled. 4 GSIs: Domain, Type, Status, Slug |
| **Lambda** | Node.js 22, ARM64, esbuild bundled. Default 1024MB/29s. Import handlers 3GB/15min |
| **API Gateway v2** | HTTP API with Lambda authorizer. Rate limit 50 req/s, burst 100. Strict CORS |
| **CloudFront** | 3 distributions — admin SPA, renderer (Lambda + S3 static), assets CDN |
| **S3** | 3 buckets — public assets, private resources (presigned URLs), renderer static + ISR cache |
| **Cognito** | 2 pools — admin (invite-only, role/tenantId) + public (self-signup, Google OAuth per tenant) |
| **SES** | Contact forms, order emails, form notifications, Cognito invites |
| **EventBridge** | Custom bus. All mutations → `publishAudit()` → worker Lambda → DynamoDB. DLQ on worker |
| **Secrets Manager** | 2 secrets — master API key, NextAuth signing key |
| **Route 53 + ACM** | DNS for root + wildcard + `admin.*` + `api.*` + tenant domains. Regional + global certs |

## Database Design (Single Table)

**PK** (String) / **SK** (String) — all queries use `QueryCommand` with PK+SK. No scans.

| Entity | PK | SK | Notes |
|--------|----|----|-------|
| Tenant Config | `SYSTEM` | `TENANT#<id>` | Settings, theme, integrations |
| Content | `TENANT#<id>` | `CONTENT#<uuid>#LATEST` | Pages with blocks |
| Content Version | `TENANT#<id>` | `CONTENT_VERSION#<uuid>#<ts>` | Auto-snapshots on update |
| Route | `TENANT#<id>` | `ROUTE#<slug>` | Slug → content mapping |
| Asset | `TENANT#<id>` | `ASSET#<uuid>` | Public images (S3 keys) |
| Resource | `TENANT#<id>` | `RESOURCE#<uuid>` | Private files (presigned) |
| Product | `TENANT#<id>` | `PRODUCT#<uuid>` | Physical or digital |
| Category | `TENANT#<id>` | `CATEGORY#<uuid>` | Product categories |
| CATPROD adjacency | `TENANT#<id>` | `CATPROD#<catId>#<prodId>` | Category→product mapping |
| Order | `TENANT#<id>` | `ORDER#<uuid>` | Orders with status workflow |
| Customer Order | `TENANT#<id>` | `CUSTORDER#<email>#<orderId>` | Customer→order adjacency |
| Customer | `TENANT#<id>` | `CUSTOMER#<email>` | Customer profiles (upserted) |
| Coupon | `TENANT#<id>` | `COUPON#<uuid>` | Discount codes |
| Coupon Code | `TENANT#<id>` | `COUPONCODE#<code>` | O(1) code lookup (dual-write) |
| Review | `TENANT#<id>` | `REVIEW#<prodId>#<uuid>` | Product reviews |
| Form | `TENANT#<id>` | `FORM#<uuid>` | Form definitions |
| Form Slug | `TENANT#<id>` | `FORMSLUG#<slug>` | O(1) slug lookup (dual-write) |
| Form Submission | `TENANT#<id>` | `FORMSUB#<formId>#<uuid>` | Form responses |
| Popup | `TENANT#<id>` | `POPUP#<uuid>` | Marketing popups |
| Lead | `TENANT#<id>` | `LEAD#<email>` | Lead captures |
| Comment | `TENANT#<id>` | `COMMENT#<pageId>#<uuid>` | Page comments |
| Audit | `TENANT#<id>` | `AUDIT#<ts>#<uuid>` | Audit trail (via EventBridge) |
| Signal | `TENANT#<id>` | `SIGNAL#<uuid>` | Growth signals |
| Context | `TENANT#<id>` | `CONTEXT#<uuid>` | Strategy documents |
| Order Counter | `TENANT#<id>` | `COUNTER#ORDER` | Atomic counter for order numbers |

**GSIs:**
- **GSI_Domain**: `Domain` → `PK` — tenant routing by domain
- **GSI_Type**: `Type` → `CreatedAt` — list by content type
- **GSI_Status**: `Status` → `ScheduledFor` — work queue items
- **GSI_Slug**: `TenantSlug` → all — O(1) slug lookups (`<tenantId>#<slug>`)

## Authentication

Three modes handled by a single Lambda authorizer (`auth/authorizer.ts`):

1. **Admin users** — Cognito JWT in `Authorization` header. Custom attributes: `role` (GLOBAL_ADMIN, TENANT_ADMIN, EDITOR), `tenantId`
2. **Robots** (MCP, renderer) — `x-api-key` validated against Secrets Manager
3. **Public** — Whitelisted routes (`/public/*`) use `HttpNoneAuthorizer`

Renderer uses NextAuth.js 4 with per-tenant Google OAuth. Client ID/secret stored in each tenant's DynamoDB config.

## Backend Modules

30 modules, 100+ Lambda handlers:

| Module | Handlers | Purpose |
|--------|----------|---------|
| `content` | create, list, get, update, delete, versions, restore | Page CRUD + versioning |
| `products` | create, list, get, update, delete, bulk-price, public-list, public-get | Product management |
| `categories` | create, list, get, update, delete, catprod, public-list, public-get | Category management |
| `orders` | create, list, get, update, update-status, public-get | Order workflow + email |
| `customers` | list, get, update | Customer profiles |
| `delivery` | get, update, available-dates | Delivery zones + date calc |
| `coupons` | create, list, get, update, delete, public-validate | Discount codes |
| `reviews` | create, list, update, delete, public-list | Product reviews |
| `forms` | create, list, get, update, delete, submissions, public-submit | Dynamic forms + email |
| `popups` | create, list, get, update, delete, public-list | Marketing popups |
| `reports` | summary | Commerce analytics |
| `tenant` | create, list, update | Tenant CRUD |
| `context` | create, list, get, update, delete | Strategy documents |
| `assets` | upload, list | Public file uploads (S3 presigned) |
| `resources` | upload, list, get | Private file downloads (presigned) |
| `contact` | submit | Contact form → SES |
| `consent` | track | GDPR consent logging |
| `leads` | capture | Lead form submissions |
| `comments` | create, list, update, delete | Page comments |
| `users` | list, invite, update, delete | Cognito user management |
| `audit` | worker, graph, list | EventBridge consumer + visualization |
| `signals` | create, list | Growth signal tracking |
| `research` | search | Brave Search integration |
| `themes` | list, get | Theme presets |
| `webhooks` | paddle | Payment webhook handler |
| `import` | woocommerce, wxr-parser | CSV/XML import |
| `auth` | authorizer | JWT/API key validation |

## Block Plugins (19)

Each plugin: `schema.ts` (Zod), `*Editor.tsx` (Tiptap NodeView), `*Render.tsx` (SSR-safe React), `index.ts` (PluginDefinition).

Split entry points: `admin.ts` (Tiptap extensions, browser-only) / `render.ts` (React components, SSR-safe).

| Plugin | Key | Attributes |
|--------|-----|-----------|
| Hero | `hero` | headline, subheadline, ctaText, ctaUrl, style, imageUrl, blockWidth |
| Pricing | `pricing` | headline, plans[] (name, price, features, ctaText, ctaUrl), blockWidth |
| Image | `image` | src, alt, caption, alignment, blockWidth |
| Contact | `contact` | title, subtitle, recipientEmail, blockWidth |
| Video | `video` | url, aspectRatio, blockWidth |
| Lead Magnet | `leadMagnet` | headline, description, resourceId, buttonText, blockWidth |
| CTA | `cta` | headline, description, buttonText, buttonUrl, style, blockWidth |
| Features | `features` | headline, items[] (title, description, icon), columns, blockWidth |
| Testimonials | `testimonials` | headline, items[] (name, role, quote, avatar), blockWidth |
| Columns | `columns` | columns[] (content blocks), blockWidth |
| Table | `table` | headers[], rows[][], blockWidth |
| Raw HTML | `html` | content, blockWidth |
| FAQ | `faq` | headline, items[] (question, answer), blockWidth |
| Post Grid | `postGrid` | headline, tag, limit, columns, blockWidth |
| Carousel | `carousel` | slides[] (imageUrl, caption, link), autoplay, blockWidth |
| Code Block | `codeBlock` | code, language (19 langs), filename, showLineNumbers, blockWidth |
| Reviews Carousel | `reviewsCarousel` | headline, items[] (name, rating, text, source), blockWidth. Commerce-only |
| Category Showcase | `categoryShowcase` | categoryId, limit, columns, showPrice, blockWidth. Commerce-only |
| Markdown | `markdown` | content (raw markdown), blockWidth. Rendered with marked + highlight.js |

## Commerce Architecture

Gated by `TenantConfig.commerceEnabled`. Full specification in [`docs/commerce.md`](docs/commerce.md).

- **Cart**: Client-side localStorage, keyed by tenantId. Supports variants, personalizations (with added costs), volume pricing. CartProvider wraps site layout
- **Checkout**: Multi-step form (contact, shipping, billing, payment, delivery date). Client POST to `/public/orders`. Server re-validates prices, delivery zones, and coupons
- **Order creation**: `TransactWriteCommand` writes 4-5 items atomically — ORDER# + CUSTORDER# + CUSTOMER# upsert + COUPON# usage increment + atomic counter for PPB-XXXX order numbers
- **Order workflow**: placed → confirmed → prepared → shipped → delivered (+ cancelled/annulled). Each transition sends SES email from configurable per-status templates with `{{variable}}` placeholders
- **Delivery dates**: 5-level priority algorithm (unblockedDates > blockedDates > yearlyOffDays > weekday > default). Lead days skip off-days. Visual 2-month calendar editor in admin
- **Coupons**: COUPON# + COUPONCODE# dual-write. Percentage or fixed amount, scope by category/product, usage limits. Client validates → server re-validates at checkout with atomic usage increment
- **Product variants**: Dimension groups (e.g., Size) with per-option price/image/availability overrides
- **Personalizations**: Text/textarea/select/checkbox fields with per-unit added costs, validated server-side
- **Bulk pricing**: Adjust prices by percentage across all products or by category. 4 rounding modes (none, nearest 5, ending-in-9, ending-in-.99). Dry run preview
- **WooCommerce import**: CSV parser with 46 Romanian→English column mappings, two-pass variable→variant strategy, auto-creates categories from "Parent > Child" format, media URL rewriting
- **Customer accounts**: NextAuth Google OAuth, order history, loyalty points (1 per currency unit), profile management
- **Reports**: 7 KPIs + breakdowns by status/payment/month + top 10 products by revenue + coupon usage stats
- **URL prefixes**: Configurable (`/product`, `/category`, `/cart`, `/checkout`, `/shop`), defaults in `URL_PREFIX_DEFAULTS`
- **Product types**: `physical` (cart/checkout) vs `digital` (Paddle). Separate admin pages
- **14 admin pages**: Products, ProductEditor (8 tabs), Categories, CategoryEditor, Orders, OrderDetail, Customers, CustomerDetail, Coupons, CouponEditor, Reviews, DeliverySettings, OrderEmails, Reports

## Country Packs & i18n

3-tier merge: English defaults → country pack → admin overrides.

`getCountryPack(code)` returns localized strings for: currency, locale, address fields, legal labels, GDPR consent, commerce UI (109 strings).

Default fallback is always English (`COUNTRY_PACKS.EN`). Available packs: EN, RO.

## Renderer Routing

Middleware (`middleware.ts`) handles three modes:
1. **Production**: `X-Forwarded-Host` → rewrite to `/{domain}/...`
2. **Test mode**: `/tenant/{id}/...` → `/{id}/...`
3. **Preview**: `/_site/{id}/...` → `/{id}/...` (restricted to admin domains)

Commerce routes matched by `matchCommercePrefix()` against tenant's URL prefixes.

## CDK Stack Structure

Main stack + 2 nested stacks (CloudFormation 500-resource limit):

| Stack | Resources | Contents |
|-------|-----------|----------|
| `AmodxApiStack` (parent) | ~390 | Content, context, settings, auth, assets, audit, users, webhooks, signals, research, themes |
| `CommerceStack` (nested) | ~234 | Categories, products, orders, customers, delivery, coupons, reviews, reports, woo import |
| `EngagementStack` (nested) | ~94 | Popups, forms |

Nested stacks use L1 `CfnRoute`/`CfnIntegration` (not `httpApi.addRoutes()`) to keep resources in the nested stack.

Supporting constructs: `database.ts`, `auth.ts`, `renderer-hosting.ts`, `admin-hosting.ts`, `uploads.ts`, `events.ts`, `domains.ts`, `config-generator.ts`.

## Development

```bash
npm install                    # all workspaces
npm run build                  # full build (shared → plugins → all)
cd admin && npm run dev        # Vite dev (port 5173)
cd renderer && npm run dev     # Next.js dev (port 3000)
cd backend && npm test         # Vitest (real staging DynamoDB)
cd infra && npm run cdk deploy # deploy to AWS
```
