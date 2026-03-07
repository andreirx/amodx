# Security Remediation Implementation Status

Updated: 2026-03-07

## Summary

**Phases 1-4 COMPLETE.** All security hardening and caching infrastructure deployed.
- Fixed jsdom ESM crash in Lambda (replaced isomorphic-dompurify with sanitize-html)
- RENDERER key infrastructure deployed
- Revalidation endpoint secured
- **Full OpenNext caching infrastructure deployed** (tag cache, SQS queue, warmer, image opt)
- CloudFront caching enabled with multi-tenant isolation

**Phase 5 (operational security) PARTIAL** - CI audit workflow active, Dependabot configured, CloudWatch alarms pending.

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
| 3.4 Tenant verification from origin | ⚠️ | `backend/src/lib/tenant-verify.ts` - Currently permissive (logs warning, allows through). See 3.5 |
| 3.5 Enforce strict origin check | ⏳ | After verifying frontend sends origin headers correctly |

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

## Phase 5: Operational Security - PARTIAL

| Task | Status | Notes |
|------|--------|-------|
| 5.1 npm audit in CI | ✅ | `.github/workflows/security-audit.yml` |
| 5.2 Dependabot | ✅ | `.github/dependabot.yml` (weekly, grouped, majors ignored) |
| 5.3 Playwright CI fixed | ✅ | `.github/workflows/playwright.yml` (deletes lock file for cross-platform deps) |
| 5.4 CloudWatch alarms | ⏳ | CDK required |
| 5.5 Security logging | ⏳ | Future enhancement |

**Dependabot configuration:**
- Runs weekly on Monday
- Groups all minor/patch updates into single PR
- Ignores major version bumps (review manually)
- 5 PR limit to prevent noise

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

1. **Monitor CloudFront cache hit ratio** - Target > 80% for popular pages
2. **Add CloudWatch alarms** (Phase 5.4):
   - Revalidation queue depth > 100
   - Lambda errors spike
   - Cache hit ratio drops below threshold
3. **Enforce strict origin check** (Phase 3.5) - Currently permissive, logs warning
4. **Review Dependabot PRs weekly** - Grouped minor/patch updates

## Completed Deployment

All Phase 1-4 changes are deployed and working:
- `npx cdk deploy` on 2026-03-07 deployed full caching infrastructure
- Tenant sites confirmed working with caching enabled
- CI pipeline fixed for cross-platform builds
