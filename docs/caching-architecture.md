# AMODX Caching Architecture

ISR, OpenNext, CloudFront, and on-demand revalidation.

---

## Deployed Architecture

```
CloudFront Distribution
├── Default Behavior → Lambda Function URL (Custom Cache Policy)
│   └── Cache Key: X-Forwarded-Host + query strings (tenant isolation)
├── _next/image* → Image Optimization Lambda (cached)
├── _next/static/* → S3 (immutable cache)
├── assets/* → S3 (immutable cache)
└── favicon.ico → S3 (cached)

Server Lambda
├── Direct DynamoDB reads (main table + tag cache)
├── S3 cache bucket (read/write)
├── SQS revalidation queue (send messages)
└── Renderer API key (restricted scope)

Revalidation Lambda
├── Polls SQS FIFO queue
└── Sends HEAD requests to regenerate stale pages

Image Optimization Lambda
├── Resizes images on-demand
└── Cached by CloudFront

Warmer Lambda
├── Scheduled every 5 minutes
└── Prevents cold starts

Tag Cache DynamoDB Table
├── PK: tag, SK: path
├── GSI: by-path (for reverse lookups)
└── Tracks cache invalidation timestamps
```

### Infrastructure Resources

| Resource | Name Pattern | Purpose |
|----------|--------------|---------|
| Tag Cache Table | `{stackName}-tag-cache` | Maps cache tags to page paths |
| Revalidation Queue | `{stackName}-revalidation.fifo` | Background regeneration queue |
| Cache Policy | `{stackName}-RendererCache` | Tenant-isolated caching |

---

## Cache Flow Diagrams

### Flow 1: Fresh Page (Cache Hit)

```
User → CloudFront
         │
         ├── Check cache by key (host + path + query)
         │   └── HIT: return cached HTML (no Lambda invocation)
         │
         └── Response to user (< 50ms)
```

### Flow 2: Stale Page (Background Revalidation)

```
User → CloudFront → Lambda (cache miss or stale)
         │              │
         │              ├── Check S3 cache
         │              │   └── Found, but lastModified + revalidate < now
         │              │
         │              ├── Return stale HTML immediately (user doesn't wait)
         │              │
         │              └── Queue SQS message: { host, url }
         │
         └── Response to user (stale HTML, fast)

         [Background, async]
         SQS Queue → Revalidation Lambda
                          │
                          └── HEAD https://host/url
                                   │
                                   └── Server Lambda regenerates
                                       ├── Fetch fresh data from DynamoDB
                                       ├── Render HTML
                                       ├── Write to S3 cache
                                       └── Update DynamoDB tags
```

### Flow 3: On-Demand Revalidation (Content Edit)

```
Admin edits page → Backend handler (content/update, products/update, etc.)
                        │
                        ├── Write to DynamoDB
                        │
                        └── POST /api/revalidate
                             │
                             ├── x-revalidation-token header (auth)
                             │
                             └── Renderer API route
                                  │
                                  └── revalidatePath(`/${tenantId}/${slug}`)
                                       └── Invalidates S3 cache
```

---

## Component Details

### Server Lambda

- Checks S3 cache first
- If cached and fresh → return cached response (no SSR)
- If cached but stale → return cached + queue revalidation to SQS
- If not cached → SSR, write to S3, return response

**Environment variables:**
```
CACHE_BUCKET_NAME, CACHE_BUCKET_KEY_PREFIX, CACHE_BUCKET_REGION
REVALIDATION_QUEUE_URL, REVALIDATION_QUEUE_REGION
CACHE_DYNAMO_TABLE
```

### SQS FIFO Queue

Decouples stale detection from regeneration. FIFO ensures each path revalidates once even under concurrent requests.

- ContentBasedDeduplication: true
- VisibilityTimeout: 30 seconds
- RetentionPeriod: 1 hour

### CloudFront Cache Policy

```typescript
const rendererCachePolicy = new cloudfront.CachePolicy(this, 'RendererCachePolicy', {
  defaultTtl: cdk.Duration.seconds(0),  // Respect origin Cache-Control
  maxTtl: cdk.Duration.days(365),
  minTtl: cdk.Duration.seconds(0),
  headerBehavior: cloudfront.CacheHeaderBehavior.allowList('X-Forwarded-Host'),
  queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
  cookieBehavior: cloudfront.CacheCookieBehavior.none(),
  enableAcceptEncodingGzip: true,
  enableAcceptEncodingBrotli: true,
});
```

**Multi-tenant isolation:** Cache key includes `X-Forwarded-Host` header. CloudFront Function copies `Host` to `X-Forwarded-Host` on viewer request.

---

## On-Demand Revalidation

### Backend Helper

`backend/src/lib/revalidate.ts` provides:
- `revalidatePath(tenantId, slug)` - Invalidate a specific page
- `revalidateTag(tag)` - Invalidate all pages with a cache tag (not yet implemented in handlers)

### Handlers with Revalidation

| Handler | Invalidates |
|---------|-------------|
| `content/update.ts` | Page slug (+ old slug if changed) |
| `products/update.ts` | Product page (+ old slug if changed) |
| `products/delete.ts` | Product page |
| `categories/update.ts` | Category page (+ old slug if changed) |
| `categories/delete.ts` | Category page |

### Limitation: Custom URL Prefixes

Revalidation uses default URL prefixes (`/product`, `/category`). Tenants with custom prefixes (e.g., `/produs`) won't get automatic cache invalidation. Future fix: fetch tenant config or use tag-based revalidation.

---

## Cache Tag Strategy (Future)

### What Gets Tagged

| Content Type | Tags |
|--------------|------|
| CMS Page | `page-{nodeId}`, `tenant-{tenantId}` |
| Product Page | `product-{productId}`, `category-{categoryId}`, `tenant-{tenantId}` |
| Category Page | `category-{categoryId}`, `tenant-{tenantId}` |
| Shop Page | `products-all`, `tenant-{tenantId}` |

### When to Invalidate

| Event | Invalidate |
|-------|------------|
| Page published | `page-{nodeId}` |
| Product updated | `product-{productId}` |
| Product added/removed from category | `category-{categoryId}` |
| Theme changed | `tenant-{tenantId}` (all pages) |

---

## Cost Analysis

### With Caching (Current)

- ~10% cache miss rate = 10K Lambda invocations per 100K page views
- Lambda: ~$0.17/month (vs $1.67 without caching)
- SQS: ~$0.04/month
- Tag cache DynamoDB: ~$0.05/month
- S3 cache: ~$0.02/month
- CloudFront: $0.085/GB transfer

### CloudFront Invalidation

- First 1,000/month: Free
- After: $0.005 per path
- At 50 edits/day: ~$2.50/month

---

## Monitoring

### CloudWatch Metrics

1. **Cache Hit Ratio** - CloudFront metric, target > 80%
2. **ISR Queue Depth** - SQS ApproximateNumberOfMessagesVisible
3. **Cold Start Rate** - Lambda ColdStart metric (should be low with warmer)

### Recommended Alarms

```typescript
new cloudwatch.Alarm(this, 'RevalidationQueueBacklog', {
  metric: revalidationQueue.metricApproximateNumberOfMessagesVisible(),
  threshold: 100,
  evaluationPeriods: 3,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
});
```

---

## Remaining Work

1. **Tag-based revalidation** - Add `revalidateTag()` calls to handlers, implement cache tags in page components
2. **CloudWatch alarms** - Deploy queue depth and cache hit ratio alarms
3. **Custom URL prefix support** - Fetch tenant config before revalidating, or use tags instead of paths
