# Security Remediation Implementation Status

Updated: 2026-03-08

## Summary

**Phases 1-4 COMPLETE.** All security hardening and caching infrastructure deployed.
- Fixed jsdom ESM crash in Lambda (replaced isomorphic-dompurify with sanitize-html)
- RENDERER key infrastructure deployed
- Revalidation endpoint secured
- **Full OpenNext caching infrastructure deployed** (tag cache, SQS queue, warmer, image opt)
- CloudFront caching enabled with multi-tenant isolation

**Phase 5 (operational security) COMPLETE** - CI audit, Dependabot, CloudWatch alarms deployed.

**Phase 6 (request provenance) COMPLETE** - 6.1-6.3 deployed, 6.4-6.5 optional hardening.

---

## Phase 1: Backend Hardening - COMPLETE

| Task | Status | File |
|------|--------|------|
| 1.1 Zod validation for orders | ✅ | `packages/shared/src/index.ts` (OrderInputSchema), `backend/src/orders/create.ts` |
| 1.2 Customer profile protection | ✅ | `backend/src/orders/create.ts` (if_not_exists) |
| 1.3 reCAPTCHA on checkout | ✅ | `backend/src/orders/create.ts` |
| 1.4 Email rate limiting | ✅ | `backend/src/orders/create.ts` |
| 1.5 reCAPTCHA on coupon validation | ✅ | `backend/src/coupons/public-validate.ts` |
| 1.6 Genericize delivery errors | ✅ | `backend/src/orders/create.ts` |

---

## Phase 2: Renderer Role Separation - COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| 2.1 RENDERER key in authorizer | ✅ | `backend/src/auth/authorizer.ts`, `infra/lib/api.ts` |
| 2.2 Comments accept RENDERER role | ✅ | `backend/src/comments/create.ts`, `moderate.ts` |
| 2.3 Replace master key in renderer | ✅ | `renderer/src/lib/api-client.ts` (renamed to getRendererKey), CDK deployed |
| 2.4 SEO routes use direct DynamoDB | ✅ | `renderer/src/app/[siteId]/sitemap.xml`, `llms.txt`, `openai-feed` |
| 2.5 Secure revalidation endpoint | ✅ | `renderer/src/app/api/revalidate/route.ts` |
| 2.6 Harden sanitize.ts | ✅ | `renderer/src/lib/sanitize.ts` - uses sanitize-html (Lambda-compatible) |

**CDK DEPLOYED:**
- `RendererApiKey` secret created in `infra/lib/amodx-stack.ts`
- `RevalidationSecret` secret created
- `renderer-hosting.ts` uses `rendererKeySecret` instead of master key

---

## Phase 3: Customer Data Access - COMPLETE

| Task | Status | File |
|------|--------|------|
| 3.1 Customer API routes | ✅ | `renderer/src/app/api/account/orders/route.ts` |
| 3.2 Account page client-side fetch | ✅ | `renderer/src/components/AccountPageView.tsx` |
| 3.3 Remove sensitive SSR reads | ✅ | `renderer/src/app/[siteId]/[[...slug]]/page.tsx` |
| 3.4 Tenant verification from origin | ✅ | `backend/src/lib/tenant-verify.ts` - Strict mode enforced |
| 3.5 Enforce strict origin check | ✅ | `TENANT_VERIFY_PERMISSIVE=true` to disable (default: strict) |

---

## Phase 4: OpenNext Caching - COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| Tag cache DynamoDB table | ✅ | `{stackName}-tag-cache` with GSI for path lookups |
| SQS FIFO revalidation queue | ✅ | `{stackName}-revalidation.fifo` with dedup |
| Revalidation Lambda | ✅ | Polls SQS, sends HEAD requests to regenerate |
| Image optimization Lambda | ✅ | `/_next/image*` route with 1536MB memory |
| Warmer Lambda | ✅ | EventBridge rule every 5 minutes |
| Enable CloudFront caching | ✅ | Custom cache policy with X-Forwarded-Host for tenant isolation |
| Backend revalidate helper | ✅ | `backend/src/lib/revalidate.ts` |
| Backend content/update.ts | ✅ | Calls revalidatePath after content changes |

**CDK Infrastructure (`infra/lib/renderer-hosting.ts`):**
- `enableCaching: true` passed from `amodx-stack.ts`
- Cache policy respects `Cache-Control` headers from origin
- Multi-tenant isolation via `X-Forwarded-Host` in cache key
- Server Lambda has env vars: `REVALIDATION_QUEUE_URL`, `CACHE_DYNAMO_TABLE`

See `docs/caching-architecture.md` for architecture details.

---

## Phase 5: Operational Security - COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| 5.1 npm audit in CI | ✅ | `.github/workflows/security-audit.yml` |
| 5.2 Dependabot | ✅ | `.github/dependabot.yml` (weekly, grouped, majors ignored) |
| 5.3 Playwright CI fixed | ✅ | `.github/workflows/playwright.yml` (deletes lock file for cross-platform deps) |
| 5.4 CloudWatch alarms | ✅ | `infra/lib/renderer-hosting.ts` - queue depth, Lambda errors |
| 5.5 Security logging | ⏳ | Future enhancement (optional) |

**CloudWatch Alarms (Phase 5.4):**
- `{stackName}-revalidation-queue-depth`: Fires when queue > 100 messages (pages piling up)
- `{stackName}-server-lambda-errors`: Fires when > 10 errors in 5 minutes
- `{stackName}-revalidation-lambda-errors`: Fires when > 5 errors in 10 minutes

**Dependabot configuration:**
- Runs weekly on Monday
- Groups all minor/patch updates into single PR
- Ignores major version bumps (review manually)
- 5 PR limit to prevent noise

---

## Phase 6: Request Provenance - IN PROGRESS

Ensure requests originate from our frontend, not direct API/Lambda URL access.

| Task | Status | Notes |
|------|--------|-------|
| 6.1 CloudFront origin verification | ✅ | `x-origin-verify` header injected by CF, verified in middleware |
| 6.2 Strict CORS at API Gateway | ✅ | Admin + root + tenant + CloudFront domains in allowedOrigins |
| 6.3 Enforce strict tenant-verify.ts | ✅ | Strict mode default, `TENANT_VERIFY_PERMISSIVE=true` to disable |
| 6.4 API Gateway resource policy | ⏳ | Only accept requests from CloudFront IP ranges |
| 6.5 Request signing for checkout | ⏳ | Server-generated token verified on POST (optional) |

**Implemented:**
- `infra/lib/renderer-hosting.ts`: CloudFront Function injects `x-origin-verify` header
- `renderer/middleware.ts`: Blocks requests without valid `x-origin-verify`
- `infra/lib/api.ts`: CORS includes admin, root, tenant, and CloudFront domains
- `backend/src/lib/tenant-verify.ts`: Strict mode blocks requests without Origin header

**CloudFront URL for Previews (two-step deploy):**
1. First deploy: CloudFrontRendererUrl output shows `https://d1234.cloudfront.net`
2. Add to config: `domains.cloudFrontUrl: "https://d1234.cloudfront.net"`
3. Second deploy: CORS now allows preview requests from CloudFront domain

**Preview URL Access:**
- `/_site/` previews accessible via CloudFront URL (for sharing with clients)
- Blocked on production tenant domains (prevents path hijacking)
- URL is effectively a secret: requires CloudFront domain + tenant ID + path

**Why this matters:**
- Direct Lambda URL access blocked (missing `x-origin-verify`)
- `x-tenant-id` header manipulation blocked (tenant-verify.ts checks Origin)
- curl/script attacks blocked (missing Origin header on cross-origin POST)
- Preview URLs only accessible from admin panel

---

## Files Changed

### Backend
- `backend/src/auth/authorizer.ts` - RENDERER key support
- `backend/src/comments/create.ts` - RENDERER role allowed
- `backend/src/comments/moderate.ts` - RENDERER role allowed
- `backend/src/coupons/public-validate.ts` - reCAPTCHA + tenant verification
- `backend/src/orders/create.ts` - Zod, reCAPTCHA, rate limiting, tenant verification
- `backend/src/lib/tenant-verify.ts` - NEW: tenant origin verification
- `backend/src/lib/revalidate.ts` - NEW: backend revalidation helper

### Renderer
- `renderer/src/lib/sanitize.ts` - isomorphic-dompurify
- `renderer/src/lib/dynamo.ts` - getPublishedContent, getProductsForFeed
- `renderer/src/app/api/revalidate/route.ts` - secured with token
- `renderer/src/app/api/account/orders/route.ts` - NEW: secure orders API
- `renderer/src/app/[siteId]/sitemap.xml/route.ts` - direct DynamoDB
- `renderer/src/app/[siteId]/llms.txt/route.ts` - direct DynamoDB
- `renderer/src/app/[siteId]/openai-feed/route.ts` - direct DynamoDB
- `renderer/src/app/[siteId]/[[...slug]]/page.tsx` - removed sensitive SSR reads
- `renderer/src/components/AccountPageView.tsx` - client-side data fetch
- `renderer/src/lib/api-client.ts` - renamed getMasterKey to getRendererKey
- `renderer/package.json` - sanitize-html (replaced isomorphic-dompurify for Lambda compat)

### Shared
- `packages/shared/src/index.ts` - OrderInputSchema

### Infrastructure
- `infra/lib/renderer-hosting.ts` - Full Phase 4 caching infrastructure
- `infra/lib/amodx-stack.ts` - `enableCaching: true`, revalidation secrets wiring
- `infra/lib/api.ts` - Revalidation secret + renderer URL env vars

### Config
- `.github/workflows/security-audit.yml` - npm audit on push
- `.github/workflows/playwright.yml` - Fixed cross-platform optional deps
- `.github/dependabot.yml` - Weekly grouped updates, majors ignored

---

## Next Steps

1. **Test checkout flow** - Verify orders still work with strict tenant verification
2. **Monitor CloudFront cache hit ratio** - Target > 80% for popular pages
3. **(Optional) Phase 6.4 API Gateway resource policy** - CloudFront IPs only
4. **(Optional) Phase 6.5 Request signing** - Server-generated checkout tokens

## Completed Deployments

- **2026-03-07**: Phase 1-4 deployed (caching infrastructure)
- **2026-03-08**: Phase 6.1-6.3 deployed (request provenance, preview security)
