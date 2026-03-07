# AMODX Caching Architecture

Deep dive into ISR, OpenNext, CloudFront, and on-demand revalidation.

---

## Current State Analysis

### What AMODX Deploys Today

```
CloudFront Distribution
├── Default Behavior → Lambda Function URL (CACHING_DISABLED)
├── _next/static/* → S3 (cached)
├── assets/* → S3 (cached)
└── favicon.ico → S3 (cached)

Lambda (Server Function)
├── Direct DynamoDB reads (IAM)
├── S3 cache bucket (read/write)
└── Master API key (Secrets Manager)
```

**Problems:**
1. `CachePolicy.CACHING_DISABLED` - every request hits Lambda
2. No SQS revalidation queue - ISR only works inline (stale-while-revalidate in same request)
3. No DynamoDB tag cache - `revalidateTag()` doesn't work
4. No revalidation worker Lambda
5. No image optimization Lambda
6. No warmer Lambda
7. `/api/revalidate` endpoint has NO authentication

### What OpenNext 3.1.3 Provides (But We Don't Deploy)

From `.open-next/open-next.output.json`:

```json
{
  "origins": {
    "default": {
      "queue": "sqs",
      "incrementalCache": "s3",
      "tagCache": "dynamodb"
    }
  },
  "additionalProps": {
    "warmer": { "bundle": ".open-next/warmer-function" },
    "initializationFunction": { "bundle": ".open-next/dynamodb-provider" },
    "revalidationFunction": { "bundle": ".open-next/revalidation-function" }
  }
}
```

OpenNext builds 5 Lambda functions:
1. **server-functions/default** - Main SSR handler (deployed)
2. **revalidation-function** - Processes SQS queue, sends HEAD requests to regenerate stale pages (NOT deployed)
3. **image-optimization-function** - Handles `/_next/image` requests (NOT deployed)
4. **warmer-function** - Keeps Lambdas warm via scheduled invocations (NOT deployed)
5. **dynamodb-provider** - Custom resource that initializes the tag cache table (NOT deployed)

---

## Target Architecture

```
                                    CloudFront Distribution
                                    ├── Default Behavior → Lambda Function URL
                                    │   └── Cache Policy: Respect Cache-Control headers
                                    │       └── Cache Key: Host header + query strings
                                    ├── _next/image* → Image Optimization Lambda
                                    ├── _next/static/* → S3 (immutable cache)
                                    └── assets/* → S3 (immutable cache)
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
            Server Lambda            Image Opt Lambda           Warmer Lambda
            (main SSR)               (resize on-demand)         (scheduled)
                    │                                                   │
                    │ ISR: queue stale paths                           │
                    ▼                                                   ▼
              SQS FIFO Queue ◄──────────────────────────────── Invoke server
              (revalidation)                                   to keep warm
                    │
                    │ Poll messages
                    ▼
            Revalidation Lambda
            (HEAD requests to server)
                    │
                    │ Check tags
                    ▼
        ┌───────────────────────────┐
        │   DynamoDB Tag Cache      │
        │   (separate from main DB) │
        │                           │
        │   PK: tag                 │
        │   path: cached page path  │
        │   revalidatedAt: timestamp│
        └───────────────────────────┘
                    │
                    │ Read/write cache
                    ▼
              S3 Cache Bucket
              ├── _assets/ (static files)
              └── _cache/ (ISR pages)
```

---

## Component Deep Dive

### 1. Server Lambda (SSR Handler)

**Current behavior:** Every request runs full SSR, writes to S3 cache bucket, returns HTML with `revalidate = 3600` in response.

**With full OpenNext:**
- Checks S3 cache first
- If cached and fresh → return cached response (no SSR)
- If cached but stale → return cached response AND queue revalidation message to SQS
- If not cached → run SSR, write to S3 + DynamoDB tags, return response

**Environment variables needed:**
```
CACHE_BUCKET_NAME=<s3-bucket>
CACHE_BUCKET_KEY_PREFIX=_cache
CACHE_BUCKET_REGION=eu-central-1
REVALIDATION_QUEUE_URL=<sqs-queue-url>
REVALIDATION_QUEUE_REGION=eu-central-1
CACHE_DYNAMO_TABLE=<tag-cache-table>
NEXT_BUILD_ID=<build-id>
```

### 2. SQS FIFO Queue

**Purpose:** Decouples stale detection from regeneration. When the server detects a stale page, it queues a message instead of blocking the response.

**Message format:**
```json
{
  "host": "tenant-domain.com",
  "url": "/about"
}
```

**Why FIFO:** Ensures each path is revalidated once, not multiple times if many concurrent requests hit a stale page.

**Configuration:**
- ContentBasedDeduplication: true (prevents duplicate revalidations)
- VisibilityTimeout: 30 seconds
- MessageRetentionPeriod: 1 hour (stale pages older than that are re-rendered on next request anyway)

### 3. Revalidation Lambda

**Purpose:** Polls SQS queue, sends HEAD requests to the server Lambda with special headers to trigger regeneration.

**How it works:**
```javascript
// From .open-next/revalidation-function/index.mjs (deobfuscated)
for (const record of event.records) {
  const { host, url } = record;

  await fetch(`https://${host}${url}`, {
    method: 'HEAD',
    headers: {
      'x-prerender-revalidate': prerenderManifest.preview.previewModeId,
      'x-isr': '1'
    }
  });
}
```

The `x-prerender-revalidate` header tells the server to regenerate the page even if it's cached. The `x-isr: 1` header indicates this is a background revalidation, not a user request.

**IAM permissions:**
- SQS: ReceiveMessage, DeleteMessage, GetQueueAttributes
- No DynamoDB access needed
- No S3 access needed

### 4. DynamoDB Tag Cache

**Purpose:** Enables `revalidateTag()` functionality. Maps cache tags to page paths.

**Schema:**
```
Table: amodx-tag-cache
PK: tag (String)
Attributes:
  - path (String) - the cached page path
  - revalidatedAt (Number) - timestamp when tag was invalidated

GSI: revalidate
  PK: path
  SK: revalidatedAt
```

**How `revalidateTag()` works:**
1. Backend calls renderer's `/api/revalidate` with `{ tag: "product-123" }`
2. Renderer calls `revalidateTag("product-123")`
3. Next.js updates `revalidatedAt` for all paths associated with that tag
4. On next request, server checks DynamoDB, sees tag was invalidated, regenerates page

**Initialization:**
The `dynamodb-provider` Lambda is a CloudFormation custom resource that populates the initial tag mappings from `dynamodb-cache.json` (built during `npx open-next build`).

### 5. Image Optimization Lambda

**Purpose:** Handles `/_next/image` requests, resizes images on-demand.

**Behavior:**
- Receives request with `url`, `w`, `q` query params
- Fetches original image from S3 or remote URL
- Resizes/optimizes using Sharp
- Returns optimized image with cache headers
- CloudFront caches the optimized version

**Why separate Lambda:** Image processing is CPU-intensive with different memory/timeout requirements than SSR.

### 6. Warmer Lambda

**Purpose:** Prevents cold starts by periodically invoking the server Lambda.

**How it works:**
- Scheduled via EventBridge (every 5 minutes)
- Sends a special "warmer" event to the server Lambda
- Server recognizes the event type, returns immediately without doing SSR
- Keeps the Lambda container warm

**Configuration:**
```typescript
new events.Rule(this, 'WarmerSchedule', {
  schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
  targets: [new targets.LambdaFunction(warmerFunction)]
});
```

### 7. CloudFront Cache Policy

**Current:** `CACHING_DISABLED` - every request hits Lambda.

**Target:** Custom policy that respects `Cache-Control` headers and includes `Host` in cache key.

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

**Critical: Multi-tenant cache isolation**

The cache key MUST include the host header. Without it:
- Request to `tenant-a.com/about` caches page
- Request to `tenant-b.com/about` returns tenant-a's cached page

Our CloudFront Function already copies `Host` to `X-Forwarded-Host`. The cache policy includes `X-Forwarded-Host` in the cache key → tenant isolation maintained.

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

### Flow 3: On-Demand Revalidation (Content Publish)

```
Admin edits page → Backend content/update.ts
                        │
                        ├── Write to DynamoDB (content)
                        │
                        └── POST /api/revalidate
                             │
                             ├── x-revalidation-token header (auth)
                             │
                             └── Renderer API route
                                  │
                                  ├── revalidatePath(`/${tenantId}/${slug}`)
                                  │   └── Updates S3 cache metadata
                                  │
                                  ├── revalidateTag(`tenant-${tenantId}`)
                                  │   └── Updates DynamoDB tag timestamps
                                  │
                                  └── (Optional) CloudFront invalidation
                                       └── CreateInvalidation API call
```

### Flow 4: Tag-Based Revalidation

```
Admin updates product price → Backend products/update.ts
                                   │
                                   └── POST /api/revalidate
                                        { tag: "product-123" }
                                             │
                                             └── revalidateTag("product-123")

Next request to ANY page tagged with "product-123":
                                             │
User → CloudFront → Lambda
                      │
                      ├── Check S3 cache: found
                      ├── Check DynamoDB tag cache: "product-123" revalidatedAt > cache time
                      │   └── Tag was invalidated! Treat as stale.
                      │
                      ├── Return stale HTML
                      └── Queue regeneration
```

---

## Implementation Plan

### Phase 1: Deploy Full OpenNext Infrastructure

**CDK Changes to `renderer-hosting.ts`:**

```typescript
// 1. Tag Cache DynamoDB Table (separate from main table)
const tagCacheTable = new dynamodb.Table(this, 'TagCacheTable', {
  tableName: `${cdk.Stack.of(this).stackName}-tag-cache`,
  partitionKey: { name: 'tag', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'path', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// GSI for path-based lookups
tagCacheTable.addGlobalSecondaryIndex({
  indexName: 'revalidate',
  partitionKey: { name: 'path', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'revalidatedAt', type: dynamodb.AttributeType.NUMBER },
});

// 2. SQS FIFO Queue
const revalidationQueue = new sqs.Queue(this, 'RevalidationQueue', {
  queueName: `${cdk.Stack.of(this).stackName}-revalidation.fifo`,
  fifo: true,
  contentBasedDeduplication: true,
  visibilityTimeout: cdk.Duration.seconds(30),
  retentionPeriod: cdk.Duration.hours(1),
});

// 3. Revalidation Lambda
const revalidationFunc = new lambda.Function(this, 'RevalidationFunction', {
  runtime: lambda.Runtime.NODEJS_22_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(openNextPath, 'revalidation-function')),
  architecture: lambda.Architecture.ARM_64,
  memorySize: 256,
  timeout: cdk.Duration.seconds(30),
});
revalidationQueue.grantConsumeMessages(revalidationFunc);
revalidationFunc.addEventSource(new SqsEventSource(revalidationQueue, {
  batchSize: 10,
  maxBatchingWindow: cdk.Duration.seconds(1),
}));

// 4. Image Optimization Lambda
const imageOptFunc = new lambda.Function(this, 'ImageOptFunction', {
  runtime: lambda.Runtime.NODEJS_22_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(openNextPath, 'image-optimization-function')),
  architecture: lambda.Architecture.ARM_64,
  memorySize: 1536,  // Image processing needs more memory
  timeout: cdk.Duration.seconds(25),
  environment: {
    BUCKET_NAME: assetBucket.bucketName,
  },
});
assetBucket.grantRead(imageOptFunc);
const imageOptUrl = imageOptFunc.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
});

// 5. Warmer Lambda
const warmerFunc = new lambda.Function(this, 'WarmerFunction', {
  runtime: lambda.Runtime.NODEJS_22_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(openNextPath, 'warmer-function')),
  architecture: lambda.Architecture.ARM_64,
  memorySize: 128,
  timeout: cdk.Duration.seconds(15),
  environment: {
    FUNCTION_NAME: serverFunction.functionName,
    CONCURRENCY: '1',
  },
});
serverFunction.grantInvoke(warmerFunc);

// Schedule warmer every 5 minutes
new events.Rule(this, 'WarmerSchedule', {
  schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
  targets: [new targets.LambdaFunction(warmerFunc)],
});

// 6. Update Server Lambda environment
serverFunction.addEnvironment('REVALIDATION_QUEUE_URL', revalidationQueue.queueUrl);
serverFunction.addEnvironment('REVALIDATION_QUEUE_REGION', cdk.Stack.of(this).region);
serverFunction.addEnvironment('CACHE_DYNAMO_TABLE', tagCacheTable.tableName);
revalidationQueue.grantSendMessages(serverFunction);
tagCacheTable.grantReadWriteData(serverFunction);

// 7. Tag Cache Initialization (Custom Resource)
const initFunc = new lambda.Function(this, 'TagCacheInitFunction', {
  runtime: lambda.Runtime.NODEJS_22_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(openNextPath, 'dynamodb-provider')),
  architecture: lambda.Architecture.ARM_64,
  memorySize: 256,
  timeout: cdk.Duration.minutes(5),
  environment: {
    CACHE_DYNAMO_TABLE: tagCacheTable.tableName,
    CACHE_BUCKET_REGION: cdk.Stack.of(this).region,
  },
});
tagCacheTable.grantWriteData(initFunc);

const provider = new cr.Provider(this, 'TagCacheProvider', {
  onEventHandler: initFunc,
});
new cdk.CustomResource(this, 'TagCacheInit', {
  serviceToken: provider.serviceToken,
  properties: {
    requestType: 'create',
  },
});
```

### Phase 2: Enable CloudFront Caching

```typescript
// Custom cache policy
const rendererCachePolicy = new cloudfront.CachePolicy(this, 'RendererCachePolicy', {
  cachePolicyName: `${cdk.Stack.of(this).stackName}-RendererCache`,
  defaultTtl: cdk.Duration.seconds(0),
  maxTtl: cdk.Duration.days(365),
  minTtl: cdk.Duration.seconds(0),
  headerBehavior: cloudfront.CacheHeaderBehavior.allowList('X-Forwarded-Host'),
  queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
  cookieBehavior: cloudfront.CacheCookieBehavior.none(),
  enableAcceptEncodingGzip: true,
  enableAcceptEncodingBrotli: true,
});

// Update distribution
this.distribution = new cloudfront.Distribution(this, 'RendererDistribution', {
  defaultBehavior: {
    origin: new origins.HttpOrigin(cdk.Fn.parseDomainName(fnUrl.url)),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    cachePolicy: rendererCachePolicy,  // Changed from CACHING_DISABLED
    originRequestPolicy: originRequestPolicy,
    functionAssociations: [{
      function: hostRewriteFunction,
      eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
    }],
  },
  // Add image optimization behavior
  additionalBehaviors: {
    '_next/image*': {
      origin: new origins.HttpOrigin(cdk.Fn.parseDomainName(imageOptUrl.url)),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    },
    // ... existing S3 behaviors
  },
});
```

### Phase 3: Secure Revalidation Endpoint

**Create revalidation secret:**
```typescript
// In amodx-stack.ts
const revalidationSecret = new secretsmanager.Secret(this, 'RevalidationSecret', {
  secretName: `${id}-revalidation-secret`,
  generateSecretString: {
    excludePunctuation: true,
    passwordLength: 64,
  },
});
```

**Update renderer environment:**
```typescript
serverFunction.addEnvironment('REVALIDATION_SECRET', revalidationSecret.secretValue.unsafeUnwrap());
```

**Secure the endpoint:**
```typescript
// renderer/src/app/api/revalidate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

const REVALIDATION_SECRET = process.env.REVALIDATION_SECRET;

export async function POST(req: NextRequest) {
  // Verify token
  const token = req.headers.get('x-revalidation-token');
  if (!REVALIDATION_SECRET || token !== REVALIDATION_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { domain, slug, tag } = await req.json();

    if (tag) {
      // Tag-based revalidation (e.g., product price change affects multiple pages)
      revalidateTag(tag);
      return NextResponse.json({ revalidated: true, tag, now: Date.now() });
    }

    if (domain) {
      // Path-based revalidation
      const path = `/${domain}${slug || ''}`;
      revalidatePath(path);
      revalidatePath(`/${domain}`, 'layout');
      return NextResponse.json({ revalidated: true, path, now: Date.now() });
    }

    return NextResponse.json({ error: 'Missing domain or tag' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

### Phase 4: Backend Integration

**Add revalidation calls to content handlers:**

```typescript
// backend/src/lib/revalidate.ts
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let cachedSecret: string | null = null;
const secretName = process.env.REVALIDATION_SECRET_NAME;
const rendererUrl = process.env.RENDERER_URL;  // e.g., https://example.com

async function getRevalidationSecret() {
  if (cachedSecret) return cachedSecret;
  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
  cachedSecret = res.SecretString?.trim() || '';
  return cachedSecret;
}

export async function revalidatePath(tenantDomain: string, slug: string) {
  if (!rendererUrl || !secretName) return;

  try {
    const secret = await getRevalidationSecret();
    await fetch(`${rendererUrl}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidation-token': secret,
      },
      body: JSON.stringify({ domain: tenantDomain, slug }),
    });
  } catch (e) {
    console.error('Revalidation failed:', e);
    // Don't fail the request - revalidation is best-effort
  }
}

export async function revalidateTag(tag: string) {
  if (!rendererUrl || !secretName) return;

  try {
    const secret = await getRevalidationSecret();
    await fetch(`${rendererUrl}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidation-token': secret,
      },
      body: JSON.stringify({ tag }),
    });
  } catch (e) {
    console.error('Revalidation failed:', e);
  }
}
```

**Use in handlers:**

```typescript
// content/update.ts
import { revalidatePath } from "../lib/revalidate.js";

// After successful DB write:
const tenant = await getTenantConfig(tenantId);
if (tenant?.domain) {
  await revalidatePath(tenant.domain, `/${slug}`);
}

// products/update.ts
import { revalidateTag } from "../lib/revalidate.js";

// After price change:
await revalidateTag(`product-${productId}`);
```

---

## Cache Tag Strategy

### What Gets Tagged

| Content Type | Tags |
|--------------|------|
| CMS Page | `page-{nodeId}`, `tenant-{tenantId}` |
| Product Page | `product-{productId}`, `category-{categoryId}`, `tenant-{tenantId}` |
| Category Page | `category-{categoryId}`, `tenant-{tenantId}` |
| Shop Page | `products-all`, `tenant-{tenantId}` |
| Homepage | `homepage`, `tenant-{tenantId}` |

### When to Invalidate

| Event | Invalidate |
|-------|------------|
| Page published | `page-{nodeId}` |
| Product price changed | `product-{productId}` |
| Product added to category | `category-{categoryId}`, `product-{productId}` |
| Category updated | `category-{categoryId}` |
| Theme changed | `tenant-{tenantId}` (all pages) |
| Nav links changed | `tenant-{tenantId}` (all pages) |

---

## Cost Analysis

### Current (No Caching)
- Every page view = 1 Lambda invocation
- 100K page views/month = 100K Lambda invocations
- At $0.0000166667 per GB-second (1GB, 1s avg): ~$1.67/month
- Plus DynamoDB reads: ~$0.25/month

### With Full Caching
- 10% cache miss rate = 10K Lambda invocations
- $0.17/month Lambda (90% reduction)
- Plus:
  - SQS: $0.40/million requests (~$0.04/month)
  - DynamoDB tag cache: ~$0.05/month
  - S3 cache storage: ~$0.02/month
  - CloudFront: $0.085/GB (varies by traffic)

**Net savings:** Significant Lambda cost reduction, especially at scale.

### CloudFront Invalidation Costs
- First 1,000/month: Free
- After: $0.005 per path
- Estimate: 50 content updates/day = 1,500/month = $2.50/month

---

## Monitoring

### CloudWatch Metrics to Track

1. **Cache Hit Ratio** - CloudFront metric, target > 80%
2. **ISR Queue Depth** - SQS ApproximateNumberOfMessagesVisible
3. **Revalidation Latency** - Custom metric from revalidation Lambda
4. **Cold Start Rate** - Lambda ColdStart metric (should decrease with warmer)
5. **Tag Cache Size** - DynamoDB ItemCount

### Alarms

```typescript
new cloudwatch.Alarm(this, 'RevalidationQueueBacklog', {
  metric: revalidationQueue.metricApproximateNumberOfMessagesVisible(),
  threshold: 100,
  evaluationPeriods: 3,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
});
```

---

## Migration Path

1. **Deploy infrastructure** - SQS, tag cache table, additional Lambdas
2. **Keep CloudFront caching disabled** - Verify everything works
3. **Enable CloudFront caching** - Monitor cache hit ratio
4. **Add on-demand revalidation** - Wire up backend handlers
5. **Add cache tags** - Implement tag strategy in page components
6. **Remove warmer** (optional) - If cold starts are acceptable
