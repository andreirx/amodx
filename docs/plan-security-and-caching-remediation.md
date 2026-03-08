# Security & Caching Remediation Plan

Comprehensive plan to address issues identified in the architecture analysis.

For detailed caching implementation, see: `docs/caching-architecture.md`

---

## Implementation Status

| Phase | Status | Completed |
|-------|--------|-----------|
| Phase 1: Backend Hardening | ✅ COMPLETE | All 1.1-1.6 tasks done |
| Phase 2: Renderer Role Separation | ✅ COMPLETE | All 2.1-2.6 tasks done |
| Phase 3: Customer Data Access | ✅ COMPLETE | All 3.1-3.5 tasks done |
| Phase 4: OpenNext Caching | ✅ COMPLETE | Full infrastructure deployed 2026-03-07 |
| Phase 5: Operational Security | ✅ COMPLETE | CI/Dependabot/CloudWatch alarms done |
| Phase 6: Request Provenance | ✅ COMPLETE | 6.1-6.3 deployed, 6.4-6.5 optional hardening |

See `docs/security-remediation-status.md` for detailed task-by-task status.

---

## The Core Problem: Renderer Monolith

The renderer Lambda is a monolith that does too many things with too much access:

```
Current Renderer Lambda
├── Direct DynamoDB read (ALL data, ALL tenants)
│   ├── Public content (CONTENT#, PRODUCT#, CATEGORY#, etc.) ✓ Needed
│   └── Sensitive data (ORDER#, CUSTOMER#, COUPON#, AUDIT#) ✗ Should NOT access
│
├── Master API key (GLOBAL_ADMIN access)
│   ├── Comments CRUD → Needs write access, but NOT GLOBAL_ADMIN
│   └── SEO feeds (llms.txt, sitemap.xml) → Could be direct DynamoDB read
│
└── Account pages → Reads CUSTORDER#, CUSTOMER# directly ✗ Wrong approach
```

**The fix is not "remove master key" - it's split the renderer into components with restricted roles.**

---

## What the Renderer Actually Does

### 1. Direct DynamoDB Reads (Public Content) - KEEP

| Function | SK Prefix | Purpose |
|----------|-----------|---------|
| getTenantConfig | SYSTEM/TENANT# | Site configuration |
| getContentBySlug | ROUTE#, CONTENT# | CMS pages |
| getProductBySlug | PRODUCT# (via GSI) | Product pages |
| getCategoryBySlug | CATEGORY# (via GSI) | Category pages |
| getProductsByCategory | CATPROD# | Category listings |
| getAllCategories | CATEGORY# | Navigation |
| getActiveProducts | PRODUCT# | Shop page |
| getDeliveryConfig | DELIVERYCONFIG# | Checkout |
| getProductReviews | REVIEW# | Product reviews |
| getPosts | CONTENT# | Blog listings |
| getFormBySlug | FORM#, FORMSLUG# | Dynamic forms |
| hasActivePopups | POPUP# | Popup triggers |

**These are all PUBLIC data. Direct DynamoDB read with scoped IAM is correct.**

### 2. Direct DynamoDB Reads (Sensitive Data) - WRONG

| Function | SK Prefix | Problem |
|----------|-----------|---------|
| getOrderForCustomer | ORDER# | Reads full order, validates email client-side |
| getCustomerOrders | CUSTORDER# | Reads all customer's orders |
| getCustomerProfile | CUSTOMER# | Reads PII |

**These should go through authenticated API routes, not direct DB access.**

### 3. API Calls via Master Key - WRONG

| Route | What it does | Problem |
|-------|--------------|---------|
| /api/comments (POST) | Create comment | Needs write, but GLOBAL_ADMIN is overkill |
| /api/comments (DELETE) | Delete comment | Same |
| /[siteId]/llms.txt | Fetch content | Already has direct DB access, why use API? |
| /[siteId]/openai-feed | Fetch content | Same |
| /[siteId]/sitemap.xml | Fetch content | Same |

### 4. Revalidation Endpoint - INSECURE

```typescript
// Current: NO AUTH!
export async function POST(req: NextRequest) {
  const { domain, slug } = await req.json();
  revalidatePath(`/${domain}${slug || ''}`);  // Anyone can purge cache
}
```

---

## Solution: Role-Based Renderer Components

### Component A: SSR Lambda (Public Content)

**What:** Main server-side rendering function
**DynamoDB access:** Read-only, scoped to public entity types
**API key:** None needed

```typescript
// CDK: Scoped IAM policy
const publicReadPolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['dynamodb:GetItem', 'dynamodb:Query'],
  resources: [props.table.tableArn, `${props.table.tableArn}/index/*`],
});

// The renderer only needs to read public SK prefixes
// Application code already only queries these - this is defense in depth
```

**What it renders:**
- CMS pages (content blocks)
- Product pages
- Category pages
- Shop page
- Cart page (client-side state)
- Checkout page (client-side, POSTs to public API)
- Forms

### Component B: Account API Routes (Authenticated Reads)

**What:** `/api/account/*` routes for logged-in customers
**Access:** Session-validated, tenant-scoped reads only

**Current problem:** The account page reads CUSTORDER# and CUSTOMER# directly from DynamoDB in the SSR pass. This means the SSR Lambda has read access to sensitive data.

**Fix options:**

**Option 1: API Routes in Renderer (Recommended)**
```typescript
// renderer/src/app/api/account/orders/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = req.headers.get('x-tenant-id');

  // Call backend API with a restricted "customer" token
  const res = await fetch(`${API_URL}/customer/orders`, {
    headers: {
      'x-tenant-id': tenantId,
      'x-customer-email': session.user.email,
      'x-customer-token': await getCustomerToken(session),
    }
  });

  return NextResponse.json(await res.json());
}
```

**Option 2: Move to Backend Lambdas**
Create `/customer/orders` and `/customer/profile` backend endpoints that validate customer identity via:
- NextAuth session token (JWT verified by backend)
- Or: Customer-specific API key issued on login

### Component C: Comments Routes (Restricted Write)

**What:** POST/DELETE comments
**Current:** Uses master API key (GLOBAL_ADMIN)
**Fix:** Create a restricted `RENDERER` role

```typescript
// backend/src/auth/authorizer.ts
const rendererKey = await getRendererKey();
if (rendererKey && apiKey === rendererKey) {
  return {
    isAuthorized: true,
    context: { sub: "renderer", role: "RENDERER", tenantId: "ALL" }
  };
}

// backend/src/comments/create.ts
const allowedRoles = ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR", "RENDERER"];
requireRole(auth, allowedRoles, tenantId);
```

**RENDERER role can only:**
- POST /comments (create)
- DELETE /comments/{id} (delete, with ownership check)

It cannot access /orders, /customers, /tenants, etc.

### Component D: SEO Routes (Direct Read)

**What:** llms.txt, openai-feed, sitemap.xml
**Current:** Calls backend API with master key
**Fix:** Use direct DynamoDB read (already have access)

```typescript
// renderer/src/app/[siteId]/sitemap.xml/route.ts
// BEFORE:
const apiKey = await getMasterKey();
const res = await fetch(`${API_URL}/content?...`, {
  headers: { "x-api-key": apiKey }
});

// AFTER:
import { getPosts, getAllCategories, getActiveProducts } from "@/lib/dynamo";
const [posts, categories, products] = await Promise.all([
  getPosts(siteId, undefined, 1000),
  getAllCategories(siteId),
  getActiveProducts(siteId, 1, 1000),
]);
// Build sitemap from direct data
```

**No API key needed at all.**

### Component E: Revalidation Endpoint (Secured)

```typescript
// renderer/src/app/api/revalidate/route.ts
const REVALIDATION_SECRET = process.env.REVALIDATION_SECRET;

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-revalidation-token');
  if (!REVALIDATION_SECRET || token !== REVALIDATION_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { domain, slug, tag } = await req.json();
  // ... revalidation logic
}
```

---

## Phase 1: Backend Hardening (Week 1)

### 1.1 Add Zod Validation to Order Creation

**File:** `backend/src/orders/create.ts`

```typescript
// In packages/shared/src/index.ts
export const OrderInputSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
    selectedVariant: z.string().optional(),
    personalizations: z.array(z.object({
      id: z.string(),
      label: z.string(),
      value: z.string().max(500)
    })).optional()
  })).min(1).max(50),
  customerEmail: z.string().email().max(254),
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().max(30).optional(),
  customerBirthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  shippingAddress: ShippingAddressSchema.optional(),
  billingDetails: BillingDetailsSchema.optional(),
  paymentMethod: z.enum(["cod", "bank_transfer"]),
  requestedDeliveryDate: z.string().optional(),
  couponCode: z.string().max(50).optional(),
  recaptchaToken: z.string().min(1)
});

// In handler:
const parsed = OrderInputSchema.safeParse(JSON.parse(event.body));
if (!parsed.success) {
  return { statusCode: 400, body: JSON.stringify({ error: "Invalid input" }) };
}
```

**Effort:** 2-3 hours

### 1.2 Protect Customer Profile from Overwrite

**File:** `backend/src/orders/create.ts`

Change customer upsert to only set fields on first creation:

```typescript
UpdateExpression: [
  "SET #n = if_not_exists(#n, :name)",
  "phone = if_not_exists(phone, :phone)",
  "orderCount = if_not_exists(orderCount, :zero) + :one",
  "totalSpent = if_not_exists(totalSpent, :zero) + :total",
  "lastOrderDate = :now",
  "defaultAddress = if_not_exists(defaultAddress, :address)",
  "#t = :type"
].join(", "),
```

**Effort:** 1 hour

### 1.3 Add reCAPTCHA to Checkout

**Files:** `backend/src/orders/create.ts`, `renderer/src/components/CheckoutPageView.tsx`

```typescript
// Backend:
import { verifyRecaptcha } from '../lib/recaptcha.js';

const recaptchaResult = await verifyRecaptcha(parsed.data.recaptchaToken, 'checkout');
if (!recaptchaResult.success || recaptchaResult.score < 0.5) {
  return { statusCode: 403, body: JSON.stringify({ error: "Verification failed" }) };
}
```

**Effort:** 3-4 hours

### 1.4 Email Rate Limiting

**Files:** `backend/src/orders/create.ts`, `backend/src/contact/handler.ts`

```typescript
const emailKey = `EMAILLIMIT#${customerEmail.toLowerCase()}`;
const hour = Math.floor(Date.now() / 3600000);

const limit = await db.send(new GetCommand({
  TableName: TABLE_NAME,
  Key: { PK: 'SYSTEM', SK: emailKey }
}));

if (limit.Item?.hour === hour && limit.Item?.count >= 5) {
  console.warn(`Email rate limit: ${customerEmail}`);
  // Still create order, skip email
} else {
  // Send email, update counter with TTL
}
```

**Effort:** 2-3 hours

### 1.5 Add reCAPTCHA to Coupon Validation

**File:** `backend/src/coupons/public-validate.ts`

**Problem:** Attackers can enumerate valid coupon codes via error message differences.

```typescript
const body = JSON.parse(event.body || '{}');
const { code, subtotal, recaptchaToken } = body;

if (!recaptchaToken) {
  return { statusCode: 400, body: JSON.stringify({ error: "Verification required" }) };
}

const recaptchaResult = await verifyRecaptcha(recaptchaToken, 'coupon_validate');
if (!recaptchaResult.success || recaptchaResult.score < 0.5) {
  return { statusCode: 403, body: JSON.stringify({ error: "Verification failed" }) };
}
```

**Client-side:** Add grecaptcha.execute() to coupon validation in CartPageView.

**Effort:** 2 hours

### 1.6 Genericize Delivery Error Messages

**File:** `backend/src/orders/create.ts`

**Problem:** Error messages leak allowed delivery zones.

```typescript
// BEFORE:
message: `We don't deliver to ${shippingAddress.country}. Allowed countries: ${allowedCountries.join(", ")}`

// AFTER:
message: "We don't deliver to this address. Please check our delivery information page."
```

**Effort:** 30 minutes

---

## Phase 2: Renderer Role Separation (Week 2)

### 2.1 Create Restricted RENDERER Key

```typescript
// infra/lib/amodx-stack.ts
const rendererApiKey = new secretsmanager.Secret(this, 'RendererApiKey', {
  secretName: `${id}-renderer-api-key`,
  generateSecretString: { excludePunctuation: true, passwordLength: 64 }
});

// backend/src/auth/authorizer.ts - add after master key check
const rendererKey = await getRendererKey();
if (rendererKey && apiKey === rendererKey) {
  return {
    isAuthorized: true,
    context: { sub: "renderer", role: "RENDERER", tenantId: "ALL" }
  };
}
```

### 2.2 Update Comments Handler to Accept RENDERER Role

```typescript
// backend/src/comments/create.ts
const allowedRoles = ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR", "RENDERER"];
```

### 2.3 Remove Master Key from Renderer

```typescript
// infra/lib/renderer-hosting.ts
// REMOVE:
// AMODX_API_KEY_SECRET: props.masterKeySecret.secretName,
// props.masterKeySecret.grantRead(serverFunction);

// ADD:
RENDERER_API_KEY_SECRET: props.rendererApiKey.secretName,
props.rendererApiKey.grantRead(serverFunction);
```

### 2.4 Convert SEO Routes to Direct DynamoDB

Refactor llms.txt, openai-feed, sitemap.xml to use `@/lib/dynamo` instead of API calls.

### 2.5 Secure Revalidation Endpoint

```typescript
// infra/lib/amodx-stack.ts
const revalidationSecret = new secretsmanager.Secret(this, 'RevalidationSecret', {
  secretName: `${id}-revalidation-secret`,
  generateSecretString: { excludePunctuation: true, passwordLength: 64 }
});

// Pass to renderer environment
serverFunction.addEnvironment('REVALIDATION_SECRET', revalidationSecret.secretValue.unsafeUnwrap());
```

### 2.6 Audit and Harden Content Sanitization

**File:** `renderer/src/lib/sanitize.ts`

**Problem:** SSR injection via html/markdown blocks. If sanitization has a bypass, server-side code execution is possible.

**Actions:**
1. Audit current sanitize.ts implementation
2. Ensure DOMPurify (or equivalent) is used server-side, not just client-side
3. For markdown: use marked with sanitize option or run output through DOMPurify
4. Add CSP headers to responses

```typescript
// Ensure sanitizeHtml is SSR-safe:
import DOMPurify from 'isomorphic-dompurify';

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    ALLOW_DATA_ATTR: false,
  });
}
```

**Effort:** 3-4 hours

---

## Phase 3: Customer Data Access (Week 2-3)

### 3.1 Create Customer API Routes in Backend

```typescript
// backend/src/customers/my-orders.ts
// GET /customer/orders - requires valid customer session

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const customerEmail = event.headers['x-customer-email'];
  const sessionToken = event.headers['x-customer-session'];

  // Verify session token (signed JWT from NextAuth)
  const verified = await verifyCustomerSession(sessionToken, customerEmail);
  if (!verified) {
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
  }

  const tenantId = event.headers['x-tenant-id'];

  // Query CUSTORDER# for this customer only
  const orders = await getCustomerOrders(tenantId, customerEmail);
  return { statusCode: 200, body: JSON.stringify(orders) };
};
```

### 3.2 Update Renderer Account Page

```typescript
// renderer/src/components/AccountPageView.tsx
// Change from direct DynamoDB read to API call

const fetchOrders = async () => {
  const session = await getSession();
  const res = await fetch('/api/account/orders');
  return res.json();
};
```

### 3.3 Remove Sensitive Reads from dynamo.ts

Remove or gate `getOrderForCustomer`, `getCustomerOrders`, `getCustomerProfile` behind session validation.

### 3.4 Derive Tenant ID Server-Side for Public Routes

**Files:** `backend/src/orders/create.ts`, `backend/src/coupons/public-validate.ts`, etc.

**Problem:** Public routes trust the client-provided `x-tenant-id` header. An attacker can submit requests against any tenant.

**Solution:** Verify tenant ID against request origin:

```typescript
// backend/src/lib/tenant-verify.ts
export async function verifyTenantFromOrigin(
  headers: Record<string, string | undefined>,
  tenantId: string
): Promise<boolean> {
  const origin = headers['origin'] || headers['referer'];
  if (!origin) return false;

  try {
    const url = new URL(origin);
    const hostname = url.hostname;

    // Fetch tenant config and verify domain matches
    const tenant = await getTenantByDomain(hostname);
    return tenant?.id === tenantId;
  } catch {
    return false;
  }
}

// In public handlers:
const tenantId = event.headers['x-tenant-id'];
const verified = await verifyTenantFromOrigin(event.headers, tenantId);
if (!verified) {
  return { statusCode: 403, body: JSON.stringify({ error: "Invalid origin" }) };
}
```

**Tradeoff:** Adds a DynamoDB lookup per request. Could cache tenant→domain mappings.

**Alternative:** Sign the tenant ID in a cookie when the page loads, verify signature on API calls.

**Effort:** 4-6 hours

### 3.5 Enforce Strict Origin Verification (Follow-up)

**Current state:** Tenant verification logs a warning but allows requests without `origin`/`referer` headers. This is because SSR requests and some direct API calls don't include these headers.

**TODO after deployment stabilizes:**
1. Verify that all frontend checkout/coupon calls include `origin` header
2. Add `credentials: 'include'` to fetch calls if needed
3. Update CloudFront to forward `Origin` header to Lambda
4. Then change `tenant-verify.ts` to `return false` for missing origin

```typescript
// In tenant-verify.ts - change back to strict mode:
if (!url) {
    console.warn("verifyTenantFromOrigin: No origin header - BLOCKING");
    return false;  // Strict mode
}
```

**Risk if not enforced:** Attacker can submit orders against any tenant by manipulating `x-tenant-id` header from a non-browser client (curl, scripts).

---

## Why NOT WAF

The original plan included WAF for rate limiting. But:

**reCAPTCHA already covers:**
- Order creation (checkout) - the main abuse vector
- Contact forms
- Lead capture forms

**WAF would cover:**
- Coupon code enumeration
- Product catalog scraping
- General DDoS

**But:**
- Coupon enumeration: Add reCAPTCHA to validate endpoint (cheaper)
- Product scraping: Data is public anyway, not a real threat
- DDoS: CloudFront has basic protection built-in

**Cost:** $5/month + $1/million requests vs. ~$0 for reCAPTCHA

**Recommendation:** Skip WAF. Add reCAPTCHA to coupon validation if enumeration becomes a problem.

---

## Phase 4: Full OpenNext Caching ✅ COMPLETE

See `docs/caching-architecture.md` for detailed implementation.

**Deployed 2026-03-07:**
1. ✅ SQS FIFO revalidation queue (`{stackName}-revalidation.fifo`)
2. ✅ Revalidation Lambda (polls SQS, sends HEAD requests)
3. ✅ DynamoDB tag cache table (`{stackName}-tag-cache`)
4. ✅ Image optimization Lambda (`/_next/image*` route)
5. ✅ Warmer Lambda (EventBridge every 5 minutes)
6. ✅ CloudFront caching with `X-Forwarded-Host` cache key for tenant isolation
7. ✅ On-demand revalidation from `content/update.ts`

---

## Phase 5: Operational Security (Ongoing)

### 5.1 Add npm audit to CI

**File:** `.github/workflows/ci.yml` (or equivalent)

```yaml
- name: Security audit
  run: npm audit --audit-level=high
```

### 5.2 Enable Dependabot

**File:** `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
```

### 5.3 CloudWatch Alarms

- Lambda error rate > 1%
- DynamoDB throttled requests > 0
- SES bounce rate > 5%
- CloudFront 5xx rate > 0.1%
- ISR queue depth > 100

### 5.4 Security Logging

Log and alert on:
- Failed reCAPTCHA verifications
- Tenant ID verification failures
- Rate limit hits
- Unusual comment activity

---

## Phase 6: Request Provenance (NEW)

**Problem:** Currently, anyone can call Lambda URLs or API Gateway directly with crafted headers. There's no way to prove a request originated from our frontend vs. a curl command.

**Comparison to traditional Spring Boot:**
- Spring Boot in private subnet: Backend unreachable from internet
- AMODX: Lambda URLs are public, API Gateway is public
- The fix isn't VPC (expensive, adds latency) — it's request verification

### 6.1 CloudFront Origin Verification Header ✅

CloudFront Function injects a secret header. Lambda/API Gateway verifies it.

**CloudFront Function (viewer request):**
```javascript
function handler(event) {
    var request = event.request;
    // Inject secret header - only CloudFront knows this value
    request.headers['x-origin-verify'] = { value: '${ORIGIN_VERIFY_SECRET}' };
    return request;
}
```

**Lambda verification:**
```typescript
// In renderer server or middleware
const ORIGIN_VERIFY_SECRET = process.env.ORIGIN_VERIFY_SECRET;

if (event.headers['x-origin-verify'] !== ORIGIN_VERIFY_SECRET) {
    // Request didn't come through CloudFront
    return { statusCode: 403, body: 'Direct access forbidden' };
}
```

**CDK:**
```typescript
// Generate secret at deploy time
const originVerifySecret = new secretsmanager.Secret(this, 'OriginVerifySecret', {
    generateSecretString: { excludePunctuation: true, passwordLength: 32 },
});

// CloudFront Function with secret injected
const hostRewriteFunction = new cloudfront.Function(this, 'HostRewriteFunction', {
    code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
            var request = event.request;
            request.headers['x-forwarded-host'] = { value: request.headers.host.value };
            request.headers['x-origin-verify'] = { value: '${originVerifySecret.secretValue.unsafeUnwrap()}' };
            return request;
        }
    `),
});
```

**Effort:** 2 hours

### 6.2 Strict CORS at API Gateway ✅

Currently API Gateway allows all origins. Restrict to known tenant domains.

```typescript
// In CDK - api.ts
const allowedOrigins = [
    'https://admin.example.com',
    ...tenantDomains.map(d => `https://${d}`),
];

this.httpApi = new apigw.HttpApi(this, 'HttpApi', {
    corsPreflight: {
        allowOrigins: allowedOrigins,
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PUT, apigw.CorsHttpMethod.DELETE],
        allowHeaders: ['content-type', 'x-tenant-id', 'x-api-key', 'authorization'],
        allowCredentials: true,
    },
});
```

**Dynamic tenant domains:** Fetch from DynamoDB at deploy time or use wildcard patterns carefully.

**Effort:** 1-2 hours

### 6.3 Enforce Strict Tenant Verification ✅

Change `backend/src/lib/tenant-verify.ts` from permissive to strict mode.

```typescript
// BEFORE (permissive):
if (!url) {
    console.warn("verifyTenantFromOrigin: No origin/referer header - allowing (permissive mode)");
    return true;  // Allow through
}

// AFTER (strict):
if (!url) {
    console.warn("verifyTenantFromOrigin: No origin/referer header - BLOCKING");
    return false;  // Reject
}
```

**Prerequisites:**
1. Verify all frontend fetch calls include `credentials: 'include'` or explicit origin
2. Verify CloudFront forwards `Origin` header to Lambda
3. Test checkout flow end-to-end

**Effort:** 30 minutes + testing

### 6.4 API Gateway Resource Policy

Restrict API Gateway to only accept requests from CloudFront IP ranges.

```typescript
// AWS publishes CloudFront IP ranges: https://ip-ranges.amazonaws.com/ip-ranges.json
// Filter for "service": "CLOUDFRONT"

const resourcePolicy = new iam.PolicyDocument({
    statements: [
        new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ['execute-api:Invoke'],
            resources: ['*'],
            conditions: {
                IpAddress: {
                    'aws:SourceIp': cloudFrontIpRanges,
                },
            },
        }),
    ],
});

// Note: HttpApi doesn't support resource policies directly
// Need to use REST API or use Lambda authorizer to check source IP
```

**Alternative:** Check source IP in Lambda authorizer.

**Effort:** 2-3 hours

### 6.5 Request Signing for Checkout (Optional)

Server generates a signed token on page load. Checkout POST includes it.

```typescript
// Page load (server component or API route)
import { SignJWT } from 'jose';

const pageToken = await new SignJWT({ tenantId, nonce: crypto.randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.PAGE_TOKEN_SECRET));

// Pass to client via cookie or props
```

```typescript
// Checkout POST
headers: { 'x-page-token': pageToken }

// Backend verifies
import { jwtVerify } from 'jose';

const { payload } = await jwtVerify(token, new TextEncoder().encode(PAGE_TOKEN_SECRET));
if (payload.tenantId !== requestTenantId) {
    return { statusCode: 403, body: 'Invalid token' };
}
```

**Effort:** 4 hours

---

## Implementation Order

| Week | Tasks | Status |
|------|-------|--------|
| 1 | 1.1-1.6 (Backend hardening) | ✅ COMPLETE |
| 2 | 2.1-2.6 (Renderer role separation) | ✅ COMPLETE |
| 2-3 | 3.1-3.4 (Customer data access + tenant verification) | ✅ COMPLETE |
| 3-4 | Phase 4 (OpenNext caching) | ✅ COMPLETE |
| Ongoing | Phase 5 (Operational security) | ⏳ PARTIAL |
| NOW | Phase 6 (Request provenance) | ⏳ IN PROGRESS |

**Phase 6 Status:**
- ✅ 6.1 CloudFront origin verification - Implemented
- ✅ 6.2 Strict CORS - Implemented
- ✅ 6.3 Strict tenant-verify.ts - Implemented
- ⏳ 6.4 API Gateway resource policy - Optional
- ⏳ 6.5 Request signing - Optional

---

## Security Model After Changes

```
Internet
    │
    ▼
CloudFront (injects x-origin-verify header)
    │
    ├── Renderer Lambda (SSR)
    │   ├── Verifies x-origin-verify header
    │   ├── DynamoDB read access (public entities only)
    │   ├── RENDERER API key (comments only)
    │   └── Revalidation secret
    │
    └── API Gateway
        ├── CORS: only known tenant domains
        ├── Resource policy: CloudFront IPs only (optional)
        │
        ├── Authenticated routes (Cognito JWT)
        │   └── Admin operations
        │
        └── Public routes (checkout, forms)
            ├── Verifies origin header matches tenant
            ├── reCAPTCHA validation
            └── Rate limiting

Direct Lambda URL / API Gateway access → BLOCKED
├── Missing x-origin-verify header
├── Origin header doesn't match tenant
└── Source IP not CloudFront (if resource policy enabled)
```

**Blast radius if renderer is compromised:**
- Can read public content across tenants (same as scraping the sites)
- Can create/delete comments (noisy, detectable, reversible)
- Can purge cache (DoS, but recovers automatically)
- CANNOT read orders, customers, coupons, audit logs
- CANNOT access admin APIs
- CANNOT impersonate users

**With Phase 6 complete:**
- Direct API calls from scripts/curl are rejected
- x-tenant-id header manipulation blocked (origin verification)
- Only requests through CloudFront are accepted
