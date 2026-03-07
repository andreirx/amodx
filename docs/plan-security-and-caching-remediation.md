# Security & Caching Remediation Plan

Comprehensive plan to address issues identified in the architecture analysis.

For detailed caching implementation, see: `docs/caching-architecture.md`

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

## Phase 4: Full OpenNext Caching (Week 3-4)

See `docs/caching-architecture.md` for detailed implementation.

Summary:
1. Deploy SQS FIFO revalidation queue
2. Deploy revalidation Lambda
3. Deploy DynamoDB tag cache table
4. Deploy image optimization Lambda
5. Deploy warmer Lambda
6. Enable CloudFront caching with multi-tenant cache key
7. Wire on-demand revalidation from backend handlers

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

## Implementation Order

| Week | Tasks | Effort |
|------|-------|--------|
| 1 | 1.1-1.6 (Backend hardening) | 10-12h |
| 2 | 2.1-2.6 (Renderer role separation) | 12-15h |
| 2-3 | 3.1-3.4 (Customer data access + tenant verification) | 12-15h |
| 3-4 | Phase 4 (OpenNext caching) | 15-20h |
| Ongoing | Phase 5 (Operational security) | 4-6h setup |

**Total estimated effort:** 55-70 hours

---

## Security Model After Changes

```
Renderer Lambda (SSR)
├── DynamoDB read access (public entities only via application code)
├── RENDERER API key (can only POST/DELETE comments)
└── Revalidation secret (can trigger cache purge)

Customer API Routes
├── Session-validated reads
├── Tenant-scoped
└── Only returns own data

Backend Lambdas
├── Master key (MCP, system integrations)
├── Cognito JWT (admin users)
└── Public routes (checkout, forms)
```

**Blast radius if renderer is compromised:**
- Can read public content across tenants (same as scraping the sites)
- Can create/delete comments (noisy, detectable, reversible)
- Can purge cache (DoS, but recovers automatically)
- CANNOT read orders, customers, coupons, audit logs
- CANNOT access admin APIs
- CANNOT impersonate users
