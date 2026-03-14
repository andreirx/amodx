# AMODX Architecture Schematics

Reference document for software architects done on 2026-03-07.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DNS (Route 53)                                 │
│  *.agency.com → Renderer CF     admin.agency.com → Admin CF                 │
│  api.agency.com → API GW        cdn.agency.com → Uploads CF                 │
│  tenant1.com → Renderer CF      tenant2.com → Renderer CF                   │
└──────┬──────────────┬────────────────┬───────────────────┬──────────────────┘
       │              │                │                   │
       ▼              ▼                ▼                   ▼
┌──────────┐  ┌──────────────┐  ┌───────────┐    ┌──────────────┐
│ Renderer │  │   Admin CF   │  │  API GW   │    │ Uploads CF   │
│CloudFront│  │  CloudFront  │  │  HTTP v2  │    │  CloudFront  │
│          │  │              │  │           │    │              │
│ Cache:   │  │  S3 Origin   │  │ Lambda    │    │  S3 Origins  │
│ ISR-aware│  │ (React SPA)  │  │ Authorizer│    │ ┌──────────┐ │
│          │  └──────────────┘  │           │    │ │ Public   │ │
│ Behaviors│                    │ 3 modes:  │    │ │ (assets) │ │
│ ┌──────┐ │                    │ • Cognito │    │ ├──────────┤ │
│ │deflt │─┼─► Server Lambda    │ • Master  │    │ │ Private  │ │
│ │      │ │   (SSR/ISR)        │ • Renderer│    │ │(presign) │ │
│ ├──────┤ │                    │ • Public  │    │ └──────────┘ │
│ │_next/│ │                    └─────┬─────┘    └──────────────┘
│ │image │─┼─► Image Opt Lambda       │
│ ├──────┤ │                    ┌─────┴──────────────────────────┐
│ │_next/│ │                    │        100+ Lambda Handlers    │
│ │static│─┼─► S3 Bucket        │                                │
│ └──────┘ │   (assets+cache)   │  AmodxApiStack    (~390 res)   │
└──────────┘                    │  CommerceStack    (~234 res)   │
       │                        │  EngagementStack  (~94 res)    │
       │                        └─────┬────────┬────────┬────────┘
       │                              │        │        │
       │                              ▼        ▼        ▼
       │                        ┌─────────┐ ┌─────┐ ┌─────┐
       ├───── DynamoDB read ──► │DynamoDB │ │Event│ │ SES │
       │      (IAM, no API GW)  │(single  │ │Brdge│ │     │
       │                        │ table   │ │     │ │     │
       │                        │ 4 GSIs) │ │Audit│ │Order│
       │                        └─────────┘ │Workr│ │email│
       │                                    └──┬──┘ └─────┘
       │                                       │
       │                                       ▼
       │                                  DLQ (SQS)
       │
       ▼
  ┌──────────────────────────────┐
  │  ISR Caching Infrastructure  │
  │                              │
  │  SQS FIFO ◄── Server Lambda  │
  │  (revalidation queue)        │
  │      │                       │
  │      ▼                       │
  │  Revalidation Lambda         │
  │  (HEAD → Server Lambda)      │
  │                              │
  │  DynamoDB Tag Cache          │
  │  (tag → path mapping)        │
  │                              │
  │  Warmer Lambda               │
  │  (EventBridge 5min schedule) │
  └──────────────────────────────┘
```

**AWS Services Inventory:**

| Service | Count | Purpose |
|---------|-------|---------|
| CloudFront Distributions | 3 | Renderer, Admin, Uploads |
| S3 Buckets | 3 | Public assets, private resources, renderer cache+assets |
| Lambda Functions | ~110 | 100+ API handlers, SSR server, image opt, revalidation, warmer, audit worker |
| DynamoDB Tables | 2 | Main table (4 GSIs) + tag cache (1 GSI) |
| API Gateway | 1 | HTTP v2 with Lambda authorizer |
| Cognito User Pools | 2 | Admin (invite-only) + Public (self-signup, Google OAuth) |
| EventBridge | 1 bus, 2 rules | Audit events + warmer schedule |
| SQS Queues | 2 | ISR revalidation (FIFO) + audit DLQ (standard) |
| SES | 1 | Transactional email |
| Secrets Manager | 4 | Master key, renderer key, revalidation secret, NextAuth secret |
| ACM Certificates | 2 | Regional (API GW) + Global (CloudFront) |

---

## 2. Authentication & Authorization

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Lambda Authorizer (authorizer.ts)                │
│                                                                     │
│  Input: APIGatewayRequestAuthorizerEventV2                          │
│  Output: { isAuthorized, context: { sub, role, tenantId, email } }  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 1. PUBLIC ROUTE CHECK                                       │    │
│  │    POST /leads, POST /contact, POST /consent                │    │
│  │    → { isAuthorized: true, sub: "anonymous" }               │    │
│  └─────────────────────┬───────────────────────────────────────┘    │
│                        │ not public                                 │
│  ┌─────────────────────▼───────────────────────────────────────┐    │
│  │ 2. MASTER KEY CHECK (x-api-key header)                      │    │
│  │    Source: Secrets Manager (cached in Lambda memory)        │    │
│  │    → { sub: "system-robot", role: "GLOBAL_ADMIN",           │    │
│  │        tenantId: "ALL" }                                    │    │
│  │    Used by: MCP server, CLI tools                           │    │
│  └─────────────────────┬───────────────────────────────────────┘    │
│                        │ no match                                   │
│  ┌─────────────────────▼───────────────────────────────────────┐    │
│  │ 3. RENDERER KEY CHECK (x-api-key header)                    │    │
│  │    Source: Separate Secrets Manager secret                  │    │
│  │    → { sub: "renderer", role: "RENDERER", tenantId: "ALL" } │    │
│  │    Can only: POST/DELETE comments                           │    │
│  │    Used by: Renderer Lambda (comment operations)            │    │
│  └─────────────────────┬───────────────────────────────────────┘    │
│                        │ no match                                   │
│  ┌─────────────────────▼───────────────────────────────────────┐    │
│  │ 4. COGNITO JWT CHECK (Authorization: Bearer <token>)        │    │
│  │    Verifier: aws-jwt-verify (id token, specific client)     │    │
│  │    Claims: custom:role, custom:tenantId, email, sub         │    │
│  │    → { sub, email, role, tenantId }                         │    │
│  │    Used by: Admin SPA                                       │    │
│  └─────────────────────┬───────────────────────────────────────┘    │
│                        │ all failed                                 │
│                        ▼                                            │
│                  { isAuthorized: false }                            │
└─────────────────────────────────────────────────────────────────────┘

Per-Handler Enforcement (requireRole):
┌─────────────────────────────────────────────────┐
│  requireRole(auth, allowedRoles, targetTenant)  │
│                                                 │
│  GLOBAL_ADMIN → bypass all checks               │
│  Others:                                        │
│    1. auth.role ∈ allowedRoles?                 │
│    2. auth.tenantId === targetTenantId?         │
│       (strict equality, no fallback)            │
└─────────────────────────────────────────────────┘

Role Hierarchy:
  GLOBAL_ADMIN  →  full access, all tenants (MCP, master key)
  TENANT_ADMIN  →  full access, single tenant
  EDITOR        →  content CRUD, single tenant
  RENDERER      →  comments only, all tenants (restricted key)
  anonymous     →  public routes only
```

**Cognito Pool Design:**

```
Admin Pool (invite-only)                Public Pool (self-signup)
├── selfSignUpEnabled: false            ├── selfSignUpEnabled: true
├── signInAliases: email                ├── signInAliases: email, username
├── customAttributes:                   ├── customAttributes:
│   ├── role: String (mutable)          │   └── tenant_id: String (mutable)
│   └── tenantId: String (mutable)      │
├── tokenValidity:                      ├── authFlows: SRP, custom
│   ├── access: 60 min                  └── Used by: NextAuth (Google OAuth)
│   ├── id: 60 min                          per-tenant client ID/secret
│   └── refresh: 7 days                    in DynamoDB tenant config
├── enableTokenRevocation: true
├── preventUserExistenceErrors: true
└── email: SES verified identity
```

---

## 3. DynamoDB Single-Table Design

```
Table: AmodxTable
Billing: PAY_PER_REQUEST
PITR: enabled
RemovalPolicy: RETAIN

Primary Key: PK (String) + SK (String)
All queries use QueryCommand with PK+SK. Zero scans.

┌────────────────────────────────────────────────────────────────────┐
│  PARTITION: SYSTEM                                                 │
│                                                                    │
│  SK: TENANT#<id>           → tenant config (theme, domain, etc.)   │
│  SK: EMAILLIMIT#<email>    → email rate limit counter (TTL: 2h)    │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  PARTITION: TENANT#<id>     (per-tenant data isolation)            │
│                                                                    │
│  ── Content ──────────────────────────────────────────────────     │
│  SK: CONTENT#<nodeId>#LATEST         current page version          │
│  SK: CONTENT_VERSION#<nodeId>#<ts>   historical snapshots          │
│  SK: ROUTE#<slug>                    slug → nodeId mapping         │
│                                                                    │
│  ── Commerce ─────────────────────────────────────────────────     │
│  SK: PRODUCT#<uuid>                  product record                │
│  SK: CATEGORY#<uuid>                 category record               │
│  SK: CATPROD#<catId>#<prodId>        adjacency (cat→product)       │
│  SK: ORDER#<uuid>                    order with line items         │
│  SK: CUSTORDER#<email>#<orderId>     adjacency (customer→order)    │
│  SK: CUSTOMER#<email>                customer profile              │
│  SK: COUNTER#ORDER                   atomic order number counter   │
│  SK: COUPON#<uuid>                   coupon definition             │
│  SK: COUPONCODE#<code>               O(1) code lookup (dual-write) │
│  SK: REVIEW#<prodId>#<uuid>          product review                │
│  SK: DELIVERYCONFIG#default          delivery zones + rules        │
│                                                                    │
│  ── Engagement ───────────────────────────────────────────────     │
│  SK: FORM#<uuid>                     form definition               │
│  SK: FORMSLUG#<slug>                 O(1) slug lookup (dual-write) │
│  SK: FORMSUB#<formId>#<uuid>         form submission               │
│  SK: POPUP#<uuid>                    marketing popup               │
│  SK: LEAD#<email>                    lead capture                  │
│  SK: COMMENT#<pageId>#<uuid>         page comment                  │
│                                                                    │
│  ── System ───────────────────────────────────────────────────     │
│  SK: AUDIT#<ts>#<uuid>               audit trail (via EventBridge) │
│  SK: SIGNAL#<uuid>                   growth signal                 │
│  SK: CONTEXT#<uuid>                  strategy document (for AI)    │
└────────────────────────────────────────────────────────────────────┘

GSIs:
┌──────────────────────────────────────────────────────────────┐
│  GSI_Domain   PK: Domain (String) → SK: PK                   │
│               tenant routing: domain → tenant config         │
│                                                              │
│  GSI_Type     PK: Type (String) → SK: CreatedAt (String)     │
│               list by content type: "Page", "Order", etc.    │
│                                                              │
│  GSI_Status   PK: Status (String) → SK: ScheduledFor         │
│               work queue: "Draft", "PendingApproval", etc.   │
│                                                              │
│  GSI_Slug     PK: TenantSlug (String) → ALL                  │
│               compound key: "<tenantId>#<slug>"              │
│               O(1) product/category slug resolution          │
└──────────────────────────────────────────────────────────────┘

Dual-Write Patterns (eventual consistency within TransactWrite):
  COUPON#<id> + COUPONCODE#<code>  →  code validation without scanning
  FORM#<id> + FORMSLUG#<slug>      →  slug resolution without GSI
  CONTENT#<nodeId>#LATEST + ROUTE#<slug>  →  slug routing
```

---

## 4. Renderer (SSR/ISR Pipeline)

```
┌────────────────────────────────────────────────────────────────────┐
│                     CloudFront Distribution                        │
│                                                                    │
│  Viewer Request Function (CloudFront Function):                    │
│    Copy Host → X-Forwarded-Host (before CF overwrites Host)        │
│                                                                    │
│  Cache Policy:                                                     │
│    Key = X-Forwarded-Host + path + query strings                   │
│    defaultTtl = 0 (respect origin Cache-Control)                   │
│    maxTtl = 365 days                                               │
│    cookies = none (not part of cache key)                          │
│    compression = gzip + brotli                                     │
│                                                                    │
│  Origin Request Policy:                                            │
│    Forward: Accept, Accept-Language, Content-Type,                 │
│             X-Forwarded-Host, x-tenant-id, x-automation-key        │
│    Query strings: all                                              │
│    Cookies: all (forwarded to origin, not in cache key)            │
│                                                                    │
│  Behaviors:                                                        │
│    default          → Server Lambda (SSR)                          │
│    _next/image*     → Image Optimization Lambda                    │
│    _next/static/*   → S3 (CACHING_OPTIMIZED, immutable)            │
│    assets/*         → S3 (CACHING_OPTIMIZED)                       │
│    favicon.ico      → S3 (CACHING_OPTIMIZED)                       │
└─────────────────┬──────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Server Lambda (OpenNext 3 + Next.js 16)                │
│              Node.js 22, ARM64, 1024MB, 15s timeout                 │
│                                                                     │
│  Environment:                                                       │
│    TABLE_NAME, API_URL, CACHE_BUCKET_NAME, CACHE_BUCKET_KEY_PREFIX  │
│    AMODX_API_KEY_SECRET (renderer key, NOT master),                 │
│    REVALIDATION_SECRET, NEXTAUTH_SECRET, NEXTAUTH_URL,              │
│    REVALIDATION_QUEUE_URL, CACHE_DYNAMO_TABLE                       │
│                                                                     │
│  IAM Grants:                                                        │
│    dynamodb:GetItem, Query (main table) — read only                 │
│    dynamodb:GetItem, PutItem, Query (tag cache table)               │
│    s3:GetObject, PutObject (cache bucket)                           │
│    sqs:SendMessage (revalidation queue)                             │
│    secretsmanager:GetSecretValue (renderer key)                     │
└─────────────────┬───────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Next.js Middleware (middleware.ts)                │
│                                                                     │
│  Routing Modes:                                                     │
│                                                                     │
│  A. Skip: /_next/*, /api/*, /static/*, files with extensions        │
│     → NextResponse.next()                                           │
│                                                                     │
│  B. Test: /tenant/{id}/...                                          │
│     → rewrite to /{id}/...                                          │
│                                                                     │
│  C. Preview: /_site/{id}/... (restricted to localhost/CF/staging)   │
│     → rewrite to /{id}/... + set amodx_preview_base cookie          │
│                                                                     │
│  D. Production: X-Forwarded-Host = cleanHost                        │
│     → rewrite to /{cleanHost}{path}                                 │
│                                                                     │
│  Referral Tracking:                                                 │
│     ?ref= or ?utm_source= → set amodx_ref cookie (30 days)          │
└─────────────────┬───────────────────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────────────────┐
│           Page Resolution ([siteId]/[[...slug]]/page.tsx)          │
│                                                                    │
│  1. getTenantConfig(siteId)                                        │
│     → GSI_Domain query by domain                                   │
│     → fallback: GetCommand PK=SYSTEM, SK=TENANT#{siteId}           │
│                                                                    │
│  2. matchCommercePrefix(slugPath, urlPrefixes)                     │
│     /product/...  → product detail page                            │
│     /category/... → category listing                               │
│     /cart         → client-side cart (localStorage)                │
│     /checkout     → multi-step checkout form                       │
│     /checkout/confirmare → order confirmation                      │
│     /checkout/{id} → order tracking                                │
│     /account      → authenticated account (client-side fetch)      │
│     /search       → product search                                 │
│     /shop         → all products listing                           │
│                                                                    │
│  3. CMS Page Resolution (no commerce prefix match):                │
│     → GetCommand PK=TENANT#{id}, SK=ROUTE#{slug}                   │
│     → Extract TargetNode (NODE#{nodeId})                           │
│     → GetCommand PK=TENANT#{id}, SK=CONTENT#{nodeId}#LATEST        │
│     → RenderBlocks(content.blocks) → 19 plugin components          │
│                                                                    │
│  4. Response: HTML with Cache-Control header                       │
│     export const revalidate = 3600 (ISR stale window)              │
│     OpenNext sets: s-maxage=3600, stale-while-revalidate=2592000   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 5. Caching & Revalidation Architecture

```
REQUEST FLOW (cache hit):

  Browser ──► CloudFront ──► Cache Lookup
                              │
                              ├─ HIT (fresh): return cached HTML
                              │               zero Lambda invocations
                              │
                              ├─ HIT (stale): return cached HTML immediately
                              │               forward to origin for refresh
                              │
                              └─ MISS: forward to Server Lambda
                                       │
                                       ▼
                                  Server Lambda checks S3 cache
                                       │
                                       ├─ S3 HIT (fresh): return from S3
                                       │
                                       ├─ S3 HIT (stale): return from S3
                                       │   + queue revalidation message ──► SQS FIFO
                                       │
                                       └─ S3 MISS: full SSR
                                            → DynamoDB reads
                                            → render HTML
                                            → write to S3 cache
                                            → write tags to DynamoDB tag cache
                                            → return HTML


REVALIDATION FLOW (background):

  SQS FIFO Queue
  (ContentBasedDeduplication: true)
  (VisibilityTimeout: 30s, Retention: 1h)
       │
       │ poll (batch size 5)
       ▼
  Revalidation Lambda (256MB, 30s)
       │
       │ for each message:
       │   HEAD https://{host}{url}
       │     headers:
       │       x-prerender-revalidate: <previewModeId>
       │       x-isr: 1
       ▼
  Server Lambda (SSR pass)
       │
       │ fresh render → write to S3 cache
       │ update tag cache timestamps
       ▼
  Next request → CloudFront cache → fresh content


ON-DEMAND REVALIDATION FLOW (instant):

  Backend Lambda (content/update, products/update, etc.)
       │
       │ POST /api/revalidate
       │   headers: x-revalidation-token: <REVALIDATION_SECRET>
       │   body: { domain, slug } or { tag }
       ▼
  Renderer /api/revalidate/route.ts
       │
       │ verify x-revalidation-token
       │
       ├─ revalidatePath(`/${domain}${slug}`)
       │    → marks S3 cache entry stale
       │    → next request triggers fresh SSR
       │
       └─ revalidateTag(tag)
            → updates revalidatedAt in DynamoDB tag cache
            → all paths with that tag become stale
            → next request for each path triggers fresh SSR


CACHE TAG STRATEGY:

  Content Type     │ Tags Applied
  ─────────────────┼──────────────────────────────────
  CMS Page         │ page-{nodeId}, tenant-{tenantId}
  Product Page     │ product-{productId}, category-{categoryId}, tenant-{tenantId}
  Category Page    │ category-{categoryId}, tenant-{tenantId}
  Shop Page        │ products-all, tenant-{tenantId}
  Homepage         │ homepage, tenant-{tenantId}

  Mutation              │ Invalidation Trigger
  ──────────────────────┼──────────────────────────
  Page published        │ revalidateTag("page-{nodeId}")
  Product price changed │ revalidateTag("product-{productId}")
  Category updated      │ revalidateTag("category-{categoryId}")
  Theme/nav changed     │ revalidateTag("tenant-{tenantId}")  ← all pages


TAG CACHE TABLE:

  Table: {stackName}-tag-cache
  PK: tag (String)     SK: path (String)
  Attributes: revalidatedAt (Number)

  GSI "by-path": PK: path → SK: revalidatedAt
  (which tags does this path have?)

  Example rows:
  ┌─────────────────────┬────────────────────────┬───────────────┐
  │ tag                 │ path                   │ revalidatedAt │
  ├─────────────────────┼────────────────────────┼───────────────┤
  │ product-abc123      │ /shop.com/product/cake │ 1709827200    │
  │ category-baked      │ /shop.com/category/all │ 1709827200    │
  │ tenant-shop1        │ /shop.com/             │ 1709820000    │
  │ tenant-shop1        │ /shop.com/about        │ 1709820000    │
  └─────────────────────┴────────────────────────┴───────────────┘
```

---

## 6. Commerce Transaction Flow

```
CHECKOUT (order creation):

  Browser (CartContext, localStorage)
       │
       │ POST /public/orders
       │ headers: x-tenant-id (client-set)
       │ body: OrderInputSchema (Zod-validated server-side)
       │
       ▼
  API Gateway → Lambda Authorizer
       │ (public route via x-tenant-id, no JWT required)
       ▼
  orders/create.ts
       │
       │ ① Tenant origin verification
       │   verifyTenantFromOrigin(headers, tenantId)
       │   → extract hostname from Origin/Referer header
       │   → GSI_Domain lookup (5-min memory cache)
       │   → compare resolved tenant ID vs x-tenant-id
       │   → permissive mode: allow if no Origin header (TODO: tighten)
       │
       │ ② Zod validation
       │   OrderInputSchema.safeParse(body)
       │   → validates email, UUIDs, quantities, payment method
       │
       │ ③ reCAPTCHA verification (deployment-level mandatory)
       │   → resolveRecaptchaConfig(): tenant keys > deployment env var > null
       │   → POST to google.com/recaptcha/api/siteverify
       │   → score threshold check (per-tenant, default 0.5)
       │
       │ ④ Server-side price validation
       │   for each item:
       │     → GetCommand PRODUCT#{productId}
       │     → recalculate unit price from DB (not client)
       │     → recalculate personalization costs from product definition
       │
       │ ⑤ Delivery zone validation
       │   → GetCommand DELIVERYCONFIG#default
       │   → check country/county against allowlist
       │   → generic error: "We don't deliver to this address"
       │   → calculate shipping cost (free threshold or flat rate)
       │
       │ ⑥ Coupon validation
       │   → GetCommand COUPONCODE#{code} (O(1) lookup)
       │   → GetCommand COUPON#{couponId} (full rules)
       │   → check: active, date range, usage limit, min order, category scope
       │
       │ ⑦ Atomic order number
       │   → UpdateCommand COUNTER#ORDER (atomic increment)
       │   → format: PPB-{paddedNumber}
       │
       │ ⑧ TransactWriteCommand (4-5 items atomically)
       │   ├── Put ORDER#{orderId}           full order record
       │   ├── Put CUSTORDER#{email}#{id}    customer→order adjacency
       │   ├── Update CUSTOMER#{email}       upsert with if_not_exists for PII
       │   │     orderCount += 1, totalSpent += total
       │   │     loyaltyPoints += floor(total)
       │   │     name = if_not_exists(name, :name)  ← protection
       │   └── Update COUPON#{id}            usageCount += 1 (if coupon applied)
       │
       │ ⑨ Email rate check + send
       │   → GetCommand EMAILLIMIT#{email}
       │   → if count < 5 this hour: send via SES
       │   → Update EMAILLIMIT counter (TTL: 2h)
       │   → Template rendering: {{variable}} replacement
       │   → Send to customer + admin/processing addresses
       │
       ▼
  Response: 201 { orderId, orderNumber, couponDiscount }


ORDER STATUS WORKFLOW:

  placed → confirmed → prepared → shipped → delivered
    │                                          │
    └──► cancelled                             └──► annulled

  Each transition:
    → UpdateCommand with statusHistory append
    → SES email from per-status template (configurable in admin)
    → publishAudit() to EventBridge
```

---

## 7. EventBridge & Audit Pipeline

```
  Any Backend Lambda (mutation handlers)
       │
       │ publishAudit({
       │   tenantId, actor: { id, email },
       │   action: "CREATE_PAGE",
       │   target: { id, title },
       │   details: { slug },
       │   ip: sourceIp
       │ })
       │
       ▼
  EventBridge PutEvents
    EventBusName: AmodxSystemBus
    Source: "amodx.system"
    DetailType: "AUDIT_LOG"
    Detail: JSON payload + timestamp
       │
       │ Rule: match source=amodx.system, detailType=AUDIT_LOG
       ▼
  Audit Worker Lambda
    → PutCommand to DynamoDB
    → PK: TENANT#{tenantId}
    → SK: AUDIT#{timestamp}#{uuid}
    → Indexed by Type: "AuditLog"
       │
       │ on failure:
       ▼
  DLQ (SQS, auto-provisioned by CDK)
    → manual intervention required to reprocess
```

---

## 8. Multi-Tenancy Architecture

```
TENANT LIFECYCLE:

  1. Agency owner creates tenant via admin panel or MCP
     → PutCommand PK=SYSTEM, SK=TENANT#{id}
     → Domain, theme, nav, commerce config, integrations

  2. Domain registration
     → scripts/manage-domains.ts
     → ACM certificate request (DNS validation)
     → CloudFront alternate domain name update
     → CDK redeploy for CF distribution update

  3. DNS: tenant points CNAME to CloudFront distribution

  4. Request arrives:
     Browser → CloudFront → CF Function (Host → X-Forwarded-Host)
     → Server Lambda → middleware.ts
     → /{cleanHost}{path} rewrite
     → page.tsx: getTenantConfig(cleanHost)
     → GSI_Domain: domain → tenant config
     → render with tenant's theme, nav, blocks, commerce settings


TENANT DATA ISOLATION:

  ┌────────────────────────────────────────┐
  │              DynamoDB                  │
  │                                        │
  │  PK=TENANT#shop1  │  PK=TENANT#shop2   │
  │  ┌──────────────┐ │  ┌──────────────┐  │
  │  │ CONTENT#...  │ │  │ CONTENT#...  │  │
  │  │ PRODUCT#...  │ │  │ PRODUCT#...  │  │
  │  │ ORDER#...    │ │  │ ORDER#...    │  │
  │  │ CUSTOMER#... │ │  │ CUSTOMER#... │  │
  │  └──────────────┘ │  └──────────────┘  │
  │                   │                    │
  │  Isolation: application-level          │
  │  (requireRole checks tenantId claim    │
  │   against x-tenant-id header)          │
  │                                        │
  │  NOT IAM-level (all Lambdas have       │
  │  read/write to entire table)           │
  └────────────────────────────────────────┘

  CloudFront Cache Isolation:
    Cache key includes X-Forwarded-Host
    → /shop1.com/about ≠ /shop2.com/about
    → separate cache entries per tenant


PUBLIC API TENANT VERIFICATION (orders, coupons):

  1. Extract Origin/Referer header
  2. Parse hostname
  3. GSI_Domain lookup (5-min memory cache)
  4. Compare resolved tenantId vs x-tenant-id header
  5. If no Origin header → allow (permissive mode, logged)
```

---

## 9. Block Plugin Architecture

```
MONOREPO STRUCTURE:

  packages/plugins/
  ├── src/
  │   ├── hero/
  │   │   ├── schema.ts        Zod schema (shared between admin + render)
  │   │   ├── HeroEditor.tsx   Tiptap 3 NodeView (admin only, browser-only)
  │   │   ├── HeroRender.tsx   React component (SSR-safe, no Tiptap deps)
  │   │   └── index.ts         PluginDefinition (connects schema + components)
  │   ├── pricing/
  │   ├── image/
  │   ├── ... (19 plugins total)
  │   │
  │   ├── admin.ts             Entry point: exports Tiptap extensions only
  │   └── render.ts            Entry point: exports React render components only
  │
  └── package.json


BUILD SPLIT:

  admin.ts ──► (bundled into admin SPA)
    Tiptap extensions, NodeView components
    Browser-only, ~200KB+ with Tiptap

  render.ts ──► (bundled into renderer Lambda)
    Pure React components, SSR-safe
    No Tiptap dependency, minimal bundle


CONTENT STORAGE (DynamoDB):

  {
    PK: "TENANT#shop1",
    SK: "CONTENT#abc123#LATEST",
    blocks: [
      { type: "hero", attrs: { headline: "...", style: "center", ... } },
      { type: "pricing", attrs: { plans: [...] } },
      { type: "markdown", attrs: { content: "# Hello\n..." } }
    ]
  }


RENDER PIPELINE:

  RenderBlocks.tsx
    for each block in content.blocks:
      → lookup plugin by block.type
      → render plugin's Render component with block.attrs
      → wrap in blockWidth container (content | full-bleed | custom)
      → sanitize html/markdown blocks through sanitize-html


PLUGIN LIST (19):

  Layout:     hero, cta, features, columns, carousel
  Content:    image, video, markdown, codeBlock, table, rawHtml, faq
  Commerce:   pricing, reviewsCarousel, categoryShowcase
  Engagement: contact, leadMagnet, testimonials
  Navigation: postGrid
```

---

## 10. CDK Stack Decomposition

```
AmodxStack (parent, ~390 resources)
│
├── AmodxDatabase
│   └── DynamoDB table + 4 GSIs
│
├── AmodxAuth
│   ├── Admin Cognito Pool + Client
│   └── Public Cognito Pool + Client
│
├── Secrets Manager
│   ├── MasterKey (MCP/robots)
│   ├── RendererApiKey (comments only)
│   ├── RevalidationSecret (cache purge)
│   └── NextAuthSecret (session signing)
│
├── AmodxUploads
│   ├── Public S3 + CloudFront
│   └── Private S3 + presigned URLs
│
├── AmodxEvents
│   ├── EventBridge bus
│   ├── Audit rule → Audit Worker Lambda
│   └── Audit Worker DLQ
│
├── AmodxApi
│   ├── API Gateway HTTP v2
│   ├── Lambda Authorizer
│   └── ~60 Lambda handlers (content, context, settings,
│       auth, assets, resources, audit, users, webhooks,
│       signals, research, themes, contact, consent, leads,
│       comments, import)
│
├── CommerceStack (nested, ~234 resources)
│   │  Uses L1 CfnRoute/CfnIntegration (keeps resources in nested stack)
│   └── Lambda handlers: categories, products, orders, customers,
│       delivery, coupons, reviews, reports, woo import
│
├── EngagementStack (nested, ~94 resources)
│   └── Lambda handlers: popups, forms
│
├── RendererHosting
│   ├── Server Lambda + Function URL
│   ├── Image Optimization Lambda + Function URL
│   ├── Revalidation Lambda + SQS FIFO source
│   ├── Warmer Lambda + EventBridge 5-min schedule
│   ├── Tag Cache DynamoDB table + GSI
│   ├── SQS FIFO Queue (revalidation)
│   ├── S3 Bucket (assets + ISR cache)
│   └── CloudFront Distribution (multi-tenant cache policy)
│
├── AdminHosting
│   ├── S3 Bucket (Vite build output)
│   └── CloudFront Distribution
│
└── AmodxDomains
    ├── Route 53 Hosted Zone
    ├── Regional ACM Certificate (API Gateway)
    ├── Global ACM Certificate (CloudFront)
    └── DNS records (apex, wildcard, admin, api)


NESTED STACK RATIONALE:
  CloudFormation limit: 500 resources per stack
  Parent stack: ~390 resources
  Commerce stack: ~234 resources (would exceed limit if in parent)
  Engagement stack: ~94 resources

  Nested stacks use L1 CfnRoute/CfnIntegration instead of
  httpApi.addRoutes() to keep resources counted against the
  nested stack, not the parent.
```

---

## 11. MCP Integration

```
Claude Desktop ◄──► MCP Server (stdio transport)
                    │
                    │ tools/mcp-server/src/index.ts (1,881 lines)
                    │
                    │ Auth: Master API key (x-api-key header)
                    │       → GLOBAL_ADMIN role, tenantId: "ALL"
                    │
                    │ Capabilities:
                    │ ├── Tenant CRUD (create, list, update)
                    │ ├── Content CRUD (create, list, get, update, delete)
                    │ ├── Product/Category CRUD
                    │ ├── Order management
                    │ ├── Form/Popup management
                    │ ├── Context documents (strategy docs for AI)
                    │ ├── Brave Search integration
                    │ └── Playwright browser automation
                    │
                    │ Block Schema Definitions:
                    │   Complete schema for all 19 block types
                    │   embedded in the MCP server code so Claude
                    │   knows the exact shape of each block's attrs
                    │
                    ▼
              API Gateway HTTP v2
              (master key → GLOBAL_ADMIN)
                    │
                    ▼
              Backend Lambda handlers
```

---

## 12. Security Boundary Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    TRUST BOUNDARIES                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ZONE 1: Public Internet                             │    │
│  │                                                     │    │
│  │  Visitors → CloudFront → Server Lambda              │    │
│  │  Server Lambda has:                                 │    │
│  │    ✓ DynamoDB read (all tenants, all entity types)  │    │
│  │    ✓ Renderer API key (comments only)               │    │
│  │    ✓ Revalidation secret (cache purge)              │    │
│  │    ✗ Master API key (removed)                       │    │
│  │    ✗ Write access to DynamoDB (removed)             │    │
│  │    ✗ Admin API access (removed)                     │    │
│  │                                                     │    │
│  │  If compromised:                                    │    │
│  │    Can read public content across tenants (= scrape)│    │
│  │    Can read sensitive data (orders, customers) via  │    │
│  │      IAM (gap: application-level restriction only)  │    │
│  │    Can post/delete comments (noisy, reversible)     │    │
│  │    Can purge cache (DoS, auto-recovers)             │    │
│  │    CANNOT write orders, products, tenant configs    │    │
│  │    CANNOT access admin APIs                         │    │
│  │    CANNOT impersonate admin users                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ZONE 2: Admin (Cognito-authenticated)               │    │
│  │                                                     │    │
│  │  Admin SPA → API Gateway → Cognito JWT              │    │
│  │    role: GLOBAL_ADMIN | TENANT_ADMIN | EDITOR       │    │
│  │    tenantId: strict equality check per handler      │    │
│  │                                                     │    │
│  │  If admin account compromised:                      │    │
│  │    TENANT_ADMIN: full access to ONE tenant          │    │
│  │    GLOBAL_ADMIN: full access to ALL tenants         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ZONE 3: System (API key authenticated)              │    │
│  │                                                     │    │
│  │  MCP Server → API Gateway → Master key              │    │
│  │    → GLOBAL_ADMIN, tenantId: "ALL"                  │    │
│  │    Full read/write to everything                    │    │
│  │                                                     │    │
│  │  If master key leaked:                              │    │
│  │    Complete compromise of all tenants               │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```