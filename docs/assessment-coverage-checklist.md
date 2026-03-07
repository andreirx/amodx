# Assessment Coverage Checklist

Cross-reference of all issues from the architecture deep dive against proposed solutions.

---

## BIG Issues (High Severity / High Impact)

### 1. Renderer Holds Master API Key (GLOBAL_ADMIN)
**Assessment:** "The renderer Lambda has direct DynamoDB read access plus the master API key in its environment. If compromised, it could read all tenant data and make authenticated API calls."

| Status | Solution |
|--------|----------|
| COVERED | Phase 2.1-2.3: Create restricted RENDERER key, remove master key, RENDERER role can only POST/DELETE comments |

### 2. Renderer Has Cross-Tenant DynamoDB Read Access
**Assessment:** "The combination of direct DynamoDB read (cross-tenant) plus the master API key. A compromised renderer can exfiltrate all tenant data."

| Status | Solution |
|--------|----------|
| PARTIAL | Application code only queries specific SK prefixes, but IAM allows reading ORDER#, CUSTOMER#, COUPON#, AUDIT# |

**GAP:** Need to either:
- (a) Add IAM deny policy for sensitive SK prefixes (hard - DynamoDB conditions are PK-based)
- (b) Move sensitive reads (getOrderForCustomer, getCustomerOrders, getCustomerProfile) to authenticated API routes
- (c) Accept risk with monitoring

**Current plan:** Option (b) in Phase 3.1-3.3. But should also remove the functions from dynamo.ts entirely.

### 3. Order Creation Missing Zod Validation
**Assessment:** "The handler manually destructures body without parsing through the shared schema. An attacker can inject arbitrary data into the customer record."

| Status | Solution |
|--------|----------|
| COVERED | Phase 1.1: OrderInputSchema with full validation |

### 4. Customer Profile Overwrite via Upsert
**Assessment:** "The order creation upserts a CUSTOMER# item with whatever data the client provides. They can overwrite a real customer's profile."

| Status | Solution |
|--------|----------|
| COVERED | Phase 1.2: Change to if_not_exists() for all PII fields |

### 5. CloudFront Caching Disabled
**Assessment:** "Every single request goes to Lambda. CloudFront is being used purely as an HTTPS terminator."

| Status | Solution |
|--------|----------|
| COVERED | caching-architecture.md: Custom cache policy respecting Cache-Control, multi-tenant cache key |

### 6. No Revalidation Queue/Worker
**Assessment:** "No revalidation queue, no SQS FIFO queue, no revalidation Lambda. ISR only works in the time-based stale-while-revalidate sense."

| Status | Solution |
|--------|----------|
| COVERED | caching-architecture.md: Full OpenNext infrastructure (SQS FIFO, revalidation Lambda, DynamoDB tag cache) |

### 7. No On-Demand Revalidation
**Assessment:** "Content updates take up to an hour to propagate."

| Status | Solution |
|--------|----------|
| COVERED | caching-architecture.md: Backend calls /api/revalidate after mutations, secured with secret |

### 8. Revalidation Endpoint Has No Auth
**Assessment:** (From code review) Anyone can POST to /api/revalidate and purge the cache.

| Status | Solution |
|--------|----------|
| COVERED | Phase 2.5: Add REVALIDATION_SECRET, verify token in endpoint |

---

## MODERATE Issues (Medium Severity)

### 9. Email Bombing (No Rate Limiting)
**Assessment:** "Each order triggers SES emails. No rate limiting means an attacker can flood both the customer and shop owner."

| Status | Solution |
|--------|----------|
| COVERED | Phase 1.4: Per-email rate limit (5/hour), tracked in DynamoDB with TTL |

### 10. Tenant ID Header Manipulation
**Assessment:** "The x-tenant-id header is client-provided on public routes. An attacker can submit orders against any tenant."

| Status | Solution |
|--------|----------|
| NOT COVERED | Need to add |

**GAP:** The checkout POST and other public routes trust x-tenant-id from the client. Should derive from:
- The referer/origin header (verify it matches a known tenant domain)
- Or: Sign the tenant ID in a cookie/token on page load

### 11. Coupon Oracle / Enumeration
**Assessment:** "The checkout validates coupons and returns structured error messages. An attacker can enumerate valid coupon codes."

| Status | Solution |
|--------|----------|
| PARTIAL | Mentioned adding reCAPTCHA to coupon validation, but not detailed |

**GAP:** Add reCAPTCHA to POST /public/coupons/validate endpoint.

### 12. Delivery Zone Enumeration
**Assessment:** "The delivery zone validation returns specific error messages listing allowed countries and counties."

| Status | Solution |
|--------|----------|
| NOT COVERED | Need to add |

**GAP:** Genericize error message to "Delivery not available for this address" without listing allowed zones.

### 13. SSR Injection via Stored Content
**Assessment:** "The html block type accepts arbitrary HTML, and the markdown block runs through marked. If sanitization has a bypass, SSR-time code execution becomes possible."

| Status | Solution |
|--------|----------|
| NOT COVERED | Need to add |

**GAP:** Audit sanitize.ts, ensure DOMPurify or equivalent is used server-side, consider CSP headers.

### 14. Dependency Chain Poisoning
**Assessment:** "A supply-chain attack on any dependency would execute inside the Lambda with its full IAM role."

| Status | Solution |
|--------|----------|
| NOT COVERED | Operational concern |

**GAP:** Add:
- npm audit in CI
- Dependabot/Renovate for automated updates
- Lock file integrity checks
- Consider using npm shrinkwrap

### 15. No Image Optimization Lambda
**Assessment:** OpenNext builds image-optimization-function but we don't deploy it.

| Status | Solution |
|--------|----------|
| COVERED | caching-architecture.md: Deploy image optimization Lambda, add CloudFront behavior |

### 16. No Warmer Lambda
**Assessment:** OpenNext builds warmer-function but we don't deploy it.

| Status | Solution |
|--------|----------|
| COVERED | caching-architecture.md: Deploy warmer Lambda with EventBridge schedule |

### 17. No DynamoDB Tag Cache
**Assessment:** "revalidateTag() doesn't work without the tag cache table."

| Status | Solution |
|--------|----------|
| COVERED | caching-architecture.md: Deploy tag cache table, initialization Lambda |

---

## LOWER Priority Issues

### 18. Single Global Revalidation Interval
**Assessment:** "A more nuanced approach would be per-page or per-content-type revalidation intervals."

| Status | Solution |
|--------|----------|
| ACKNOWLEDGED | With on-demand revalidation, the 1-hour default becomes a fallback. Acceptable. |

### 19. Renderer Reads Sensitive Data Directly (dynamo.ts)
**Assessment:** getOrderForCustomer, getCustomerOrders, getCustomerProfile are in dynamo.ts.

| Status | Solution |
|--------|----------|
| COVERED | Phase 3.1-3.3: Move to authenticated API routes |

**Additional action needed:** Delete these functions from dynamo.ts after moving to API routes.

### 20. SEO Routes Use Master Key Unnecessarily
**Assessment:** llms.txt, sitemap.xml, openai-feed call backend API with master key when they could read DynamoDB directly.

| Status | Solution |
|--------|----------|
| COVERED | Phase 2.4: Convert to direct DynamoDB reads |

### 21. MCP Server Has Master Key
**Assessment:** "The MCP server holds the master API key and has GLOBAL_ADMIN access to everything."

| Status | Solution |
|--------|----------|
| ACKNOWLEDGED | By design - MCP is for agency owner's Claude Desktop only. Document this risk. |

---

## Summary: Gaps to Address

| # | Issue | Priority | Action |
|---|-------|----------|--------|
| 1 | Tenant ID header manipulation | HIGH | Derive tenant from referer/origin, not client header |
| 2 | SSR injection via html/markdown blocks | HIGH | Audit sanitize.ts, add server-side DOMPurify |
| 3 | Coupon enumeration | MEDIUM | Add reCAPTCHA to /public/coupons/validate |
| 4 | Delivery zone enumeration | LOW | Genericize error messages |
| 5 | Dependency chain security | MEDIUM | Add npm audit to CI, Dependabot |
| 6 | Remove sensitive reads from dynamo.ts | MEDIUM | Delete after Phase 3 migration |

---

## Updated Phase Plan

### Phase 1: Backend Hardening (Week 1)
- 1.1 Zod validation on order creation
- 1.2 Customer profile protection (if_not_exists)
- 1.3 reCAPTCHA on checkout
- 1.4 Email rate limiting
- **1.5 (NEW) reCAPTCHA on coupon validation**
- **1.6 (NEW) Genericize delivery error messages**

### Phase 2: Renderer Role Separation (Week 2)
- 2.1 Create RENDERER API key
- 2.2 Update comments handler for RENDERER role
- 2.3 Remove master key, add RENDERER key to renderer
- 2.4 Convert SEO routes to direct DynamoDB
- 2.5 Secure revalidation endpoint
- **2.6 (NEW) Audit and harden sanitize.ts**

### Phase 3: Customer Data Access (Week 2-3)
- 3.1 Create customer API routes in backend
- 3.2 Update account page to use API
- 3.3 Remove sensitive reads from dynamo.ts
- **3.4 (NEW) Derive tenant ID server-side for public routes**

### Phase 4: OpenNext Caching (Week 3-4)
- See caching-architecture.md (fully detailed)

### Phase 5: Operational Security (Ongoing)
- **5.1 (NEW) Add npm audit to CI pipeline**
- **5.2 (NEW) Enable Dependabot/Renovate**
- 5.3 CloudWatch alarms
- 5.4 Audit log dashboard
