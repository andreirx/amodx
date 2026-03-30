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
export const revalidate = false;
```

`revalidate = false` tells Next.js/OpenNext: cache forever, never revalidate on a timer. Pages are only regenerated when explicitly invalidated via `revalidatePath()` or `revalidateTag()`.

OpenNext translates this into `Cache-Control: public, s-maxage=31536000, stale-while-revalidate=31536000`. CloudFront's cache policy has `defaultTtl: 0` which means it respects the origin's `s-maxage` — effectively caching for 1 year or until invalidated.

---

## Invalidation Mechanisms

### 1. withInvalidation() HOF — Debounced CloudFront Invalidation

**File**: `backend/src/lib/invalidate-cdn.ts`

Higher-order function wrapping every mutation handler (51 handlers total). After a successful 2xx response, it writes a DynamoDB marker (`SYSTEM#CDN_PENDING` with `updatedAt` timestamp). This is a ~5ms DDB PutItem — no CloudFront call in the handler.

```typescript
import { withInvalidation } from "../lib/invalidate-cdn.js";

const _handler: Handler = async (event) => { /* ... */ };
export const handler = withInvalidation(_handler);
```

Properties:
- **DDB write, not CloudFront call**: ~5ms overhead (down from ~100ms). No CloudFront IAM needed on mutation Lambdas.
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

**GET /system/invalidation** — Returns pending status for the admin UI banner.

```json
{ "pending": false }
// or
{ "pending": true, "lastChangeAt": "2026-03-13T18:30:00.000Z", "goLiveAt": "2026-03-13T18:45:00.000Z" }
```

**POST /system/invalidation** — "GO LIVE NOW" button. Fires immediate CloudFront `/*` invalidation and deletes the DDB marker. Requires GLOBAL_ADMIN or TENANT_ADMIN role.

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

1. **CloudFront Cache Hit Ratio** — Target > 95%. With debounced invalidation, ratio should be higher than before.
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

4. **`content/create.ts` missing ISR revalidation**: New pages don't call `revalidatePath()`. Not a problem in practice because there's no stale S3 cache entry for a URL that didn't exist before. The debounced CloudFront invalidation clears any cached 404.

5. **Tag-based revalidation underutilized**: The infrastructure exists (tag cache DynamoDB table, `/api/revalidate` supports tags, `revalidateTag()` helper exists) but very few handlers use it. This would enable surgical cache invalidation (e.g., invalidate all pages showing a specific product) without the `/*` sledgehammer.

6. **Debounce is global, not per-tenant**: The `SYSTEM#CDN_PENDING` marker is a single row. All tenants share the same debounce timer. A mutation by Tenant A delays Tenant B's pending changes by resetting the timer. Acceptable for shared distribution. Would need per-tenant markers for per-tenant distributions (Workstream 3).
