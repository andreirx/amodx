# Security Remediation Implementation Status

Updated: 2026-03-07

## Summary

All **code changes** for Phases 1-3 and Phase 5 are complete. Phase 4 (OpenNext caching infrastructure) and certain CDK changes require a deployment phase.

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

## Phase 2: Renderer Role Separation - PARTIAL

| Task | Status | Notes |
|------|--------|-------|
| 2.1 RENDERER key in authorizer | ✅ | `backend/src/auth/authorizer.ts` - code ready, awaiting CDK secret creation |
| 2.2 Comments accept RENDERER role | ✅ | `backend/src/comments/create.ts`, `moderate.ts` |
| 2.3 Replace master key in renderer | ⏳ | Code ready, requires CDK change to create RENDERER key secret |
| 2.4 SEO routes use direct DynamoDB | ✅ | `renderer/src/app/[siteId]/sitemap.xml`, `llms.txt`, `openai-feed` |
| 2.5 Secure revalidation endpoint | ✅ | `renderer/src/app/api/revalidate/route.ts` |
| 2.6 Harden sanitize.ts | ✅ | `renderer/src/lib/sanitize.ts` - now uses isomorphic-dompurify |

**CDK TODO:**
- Create `RendererApiKey` secret
- Create `RevalidationSecret` secret
- Update `renderer-hosting.ts` to use RENDERER key instead of master key

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

## Phase 4: OpenNext Caching - PENDING CDK

| Task | Status | Notes |
|------|--------|-------|
| Tag cache DynamoDB table | ⏳ | CDK required |
| SQS FIFO revalidation queue | ⏳ | CDK required |
| Revalidation Lambda | ⏳ | CDK required |
| Image optimization Lambda | ⏳ | CDK required |
| Warmer Lambda | ⏳ | CDK required |
| Enable CloudFront caching | ⏳ | CDK required |
| Backend revalidate helper | ✅ | `backend/src/lib/revalidate.ts` |

See `docs/caching-architecture.md` for detailed CDK code.

---

## Phase 5: Operational Security - PARTIAL

| Task | Status | Notes |
|------|--------|-------|
| 5.1 npm audit in CI | ✅ | `.github/workflows/security-audit.yml` |
| 5.2 Dependabot | ✅ | `.github/dependabot.yml` |
| 5.3 CloudWatch alarms | ⏳ | CDK required |
| 5.4 Security logging | ⏳ | Future enhancement |

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
- `renderer/package.json` - isomorphic-dompurify

### Shared
- `packages/shared/src/index.ts` - OrderInputSchema

### Config
- `.github/workflows/security-audit.yml` - NEW
- `.github/dependabot.yml` - NEW

---

## Next Steps

1. **Install new dependencies**: `cd renderer && npm install`
2. **Test locally**: Verify all changes work
3. **Deploy CDK changes** (separate PR):
   - Create RENDERER key secret
   - Create REVALIDATION_SECRET
   - Update renderer environment
4. **Full OpenNext caching** (Phase 4 CDK, separate PR):
   - Deploy SQS queue, tag cache table, additional Lambdas
   - Enable CloudFront caching
5. **Monitor**: Watch CloudWatch metrics after deployment
