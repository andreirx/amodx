# Security Remediation Implementation Status

Updated: 2026-03-23

## Summary

**Phases 1-4 COMPLETE.** All security hardening and caching infrastructure deployed.
- Fixed jsdom ESM crash in Lambda (replaced isomorphic-dompurify with sanitize-html)
- RENDERER key infrastructure deployed
- Revalidation endpoint secured
- **Full OpenNext caching infrastructure deployed** (tag cache, SQS queue, warmer, image opt)
- CloudFront caching enabled with multi-tenant isolation

**Phase 5 (operational security) COMPLETE** - CI audit, Dependabot, CloudWatch alarms deployed.

**Phase 6 (request provenance) IN PROGRESS** - 6.1-6.3 deployed, 6.4-6.5 optional hardening. See corrections below.

**Phase 7 (security audit remediation) IN PROGRESS** - see below.

---

## Phase 1: Backend Hardening - COMPLETE

| Task | Status | File |
|------|--------|------|
| 1.1 Zod validation for orders | ✅ | `packages/shared/src/index.ts` (OrderInputSchema), `backend/src/orders/create.ts` |
| 1.2 Customer profile protection | ✅ | `backend/src/orders/create.ts` (if_not_exists) |
| 1.3 reCAPTCHA on checkout | ✅ | `backend/src/orders/create.ts` — deployment-level mandatory via `resolveRecaptchaConfig()` |
| 1.4 Email rate limiting | ✅ | `backend/src/orders/create.ts` |
| 1.5 reCAPTCHA on coupon validation | ✅ | `backend/src/coupons/public-validate.ts` — deployment-level mandatory via `resolveRecaptchaConfig()` |
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
| 3.3 Remove sensitive SSR reads | ⚠️ | `page.tsx` comment says removed, but still imports/uses `getOrderForCustomer`. See Finding 5 (deferred). |
| 3.4 Tenant verification from origin | ⚠️ → ✅ | **Fixed 2026-03-23**: GSI query used `domain` (lowercase) but GSI PK is `Domain` (uppercase). Fixed in `tenant-verify.ts`. Also extended to contact, leads, forms, consent handlers. |
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
| 6.3 Enforce strict tenant-verify.ts | ⚠️ → ✅ | **Fixed 2026-03-23**: Was only applied to orders/create + coupons/public-validate. Now applied to all 6 public mutation handlers. |
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

## Phase 7: Security Audit Remediation (2026-03-23)

Static code review identified 5 findings. 4 fixed, 1 deferred. Post-review identified 4 regressions in the initial fixes, all corrected.

| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| 7.1 Master key logged in CloudWatch | HIGH | ✅ | `logKeyMismatch()` deleted from `authorizer.ts`. Replaced with safe log (lengths + IP only). |
| 7.2 GSI attribute name bug in tenant-verify | HIGH | ✅ | `tenant-verify.ts` queried `domain` (lowercase) but GSI PK is `Domain` (uppercase). Fixed. |
| 7.3 Public customer profile mutation | CRITICAL | ✅ | `POST /public/customers/profile` removed `noAuth`. Handler enforces `requireRole(["GLOBAL_ADMIN", "RENDERER"])`. Renderer proxy uses `getRendererKey()` + `API_URL` (matching deployed env vars). |
| 7.4 Tenant verification incomplete | HIGH | ✅ | Added `verifyTenantFromOrigin()` to contact, leads, forms, consent. Upgraded consent Lambda to `grantReadWriteData`. |
| 7.5 Tenant secrets readable by EDITOR | CRITICAL | ✅ | `GET /settings` strips secrets via `redactSecrets()`. `PUT /settings` deep-merges `integrations` and `recaptcha` to preserve secret fields absent from redacted body. New `GET /settings/secrets` endpoint for TENANT_ADMIN/GLOBAL_ADMIN only. Admin UI loads secrets in a separate effect (fixes auth race condition). |
| 7.6 Renderer excessive DynamoDB access | MEDIUM | ⏳ | Deferred. Renderer Lambda has table-wide read. SSR page still imports `getOrderForCustomer`. Planned: commerce-private table + backend-proxied self-service reads. See `docs/plan-commerce-private-table.md`. |

**Post-review regression fixes (same session):**
1. `secretsLoaded` declared-but-never-read: moved secrets fetch to separate `useEffect` that uses `secretsLoaded` as guard, fixing the TS6133 build error and the auth race condition in one change.
2. Secret deletion on save: `PUT /settings` shallow merge `{ ...current, ...body }` replaced nested objects wholesale, deleting secrets absent from the redacted body. Added deep-merge for `integrations` (including `google` sub-object) and `recaptcha`.
3. Missing role enforcement: `public-update.ts` handler changed from untyped `APIGatewayProxyHandlerV2` to typed `APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>`, added `requireRole(auth, ["GLOBAL_ADMIN", "RENDERER"])` call, blocking direct Cognito user access.
4. Renderer proxy env var mismatch: `route.ts` used `NEXT_PUBLIC_API_URL` and `MASTER_API_KEY`, but deployed Lambda has `API_URL` and `AMODX_API_KEY_SECRET`. Fixed to use `process.env.API_URL` and `getRendererKey()` from `api-client.ts`.

**Second review fixes:**
5. Profile GET path broken: renderer proxy GET called `GET /public/customers/profile?email=...` but no backend GET route exists (only POST). Replaced with direct DynamoDB read via `getCustomerProfile()` — renderer has table read access and the session is validated before the read.
6. Renderer key privilege model documentation: `api-client.ts` and `authorizer.ts` comments still stated the renderer key was restricted to comments only. Updated to reflect the profile endpoint addition (Phase 7.3).

**Third review fix:**
7. `getCustomerProfile()` ProjectionExpression omitted `birthday`. UI reads/displays it, backend writes it, but the DynamoDB projection didn't return it. Added to projection.

**Deployment safety — proxy trust model (strict mode):**
8. Renderer proxies (contact, leads, consent) made server-to-server calls without Origin header. In strict mode, `verifyTenantFromOrigin` blocked them. Fixed with a two-part change:
   - **Authorizer reorder**: API key checks now run BEFORE the public route bypass. When the renderer sends its key, the authorizer returns `role: RENDERER` instead of `sub: anonymous`. The anonymous fallback only applies when no valid key is present.
   - **Trusted caller model in tenant-verify**: `verifyTenantFromOrigin` accepts an optional `callerRole`. For RENDERER/GLOBAL_ADMIN, Origin verification is skipped — the authenticated service identity is the trust anchor. For anonymous callers (direct browser), Origin remains the trust anchor.
   - **Renderer proxies derive tenant from host**: All three proxies now call `getTenantConfig(host)` instead of reading client-supplied `x-tenant-id`. They authenticate with `getRendererKey()`. Dummy headers (`x-api-key: 'web-client'`, `Authorization: 'Bearer public'`) removed.
   - **Leads proxy bug fix**: original built `backendPayload` with referral enrichment but sent raw `body` instead. Now sends `backendPayload`.

**Files changed:**
- `backend/src/auth/authorizer.ts` — removed `logKeyMismatch()`, reordered key checks before public route bypass
- `backend/src/lib/tenant-verify.ts` — fixed GSI attribute name, added `callerRole` parameter for trusted service bypass
- `backend/src/tenant/settings.ts` — added `redactSecrets()` to GET handler, deep-merge in PUT handler
- `backend/src/tenant/settings-secrets.ts` — new privileged endpoint
- `backend/src/customers/public-update.ts` — typed handler, `requireRole(["GLOBAL_ADMIN", "RENDERER"])` enforcement
- `backend/src/contact/send.ts` — `verifyTenantFromOrigin()` with callerRole
- `backend/src/leads/create.ts` — `verifyTenantFromOrigin()` with callerRole
- `backend/src/forms/public-submit.ts` — `verifyTenantFromOrigin()` (browser-direct, no callerRole needed)
- `backend/src/consent/create.ts` — `verifyTenantFromOrigin()` with callerRole
- `infra/lib/api-commerce.ts` — removed `noAuth` from `PublicUpdateCustomer`
- `infra/lib/api.ts` — added `GetSettingsSecretsFunc` Lambda + route, upgraded consent IAM to `grantReadWriteData`
- `renderer/src/app/api/contact/route.ts` — derives tenant from host, authenticates with renderer key
- `renderer/src/app/api/leads/route.ts` — derives tenant from host, authenticates with renderer key, sends backendPayload
- `renderer/src/app/api/consent/route.ts` — derives tenant from host, authenticates with renderer key
- `renderer/src/app/api/profile/route.ts` — GET reads DynamoDB directly, POST uses correct env vars
- `renderer/src/lib/api-client.ts` — updated privilege documentation for RENDERER key
- `renderer/src/lib/dynamo.ts` — added `birthday` to `getCustomerProfile` projection
- `admin/src/pages/Settings.tsx` — `useAuth` for role check, separate secrets effect, admin-gated secret cards

---

## Files Changed

### Backend
- `backend/src/auth/authorizer.ts` - RENDERER key support
- `backend/src/comments/create.ts` - RENDERER role allowed
- `backend/src/comments/moderate.ts` - RENDERER role allowed
- `backend/src/coupons/public-validate.ts` - reCAPTCHA (deployment-level mandatory) + tenant verification
- `backend/src/orders/create.ts` - Zod, reCAPTCHA (deployment-level mandatory), rate limiting, tenant verification
- `backend/src/contact/send.ts` - reCAPTCHA (deployment-level mandatory)
- `backend/src/leads/create.ts` - reCAPTCHA (deployment-level mandatory)
- `backend/src/forms/public-submit.ts` - reCAPTCHA (deployment-level mandatory)
- `backend/src/lib/recaptcha.ts` - resolveRecaptchaConfig() two-tier resolution (tenant keys > deployment env vars)
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
- `infra/lib/renderer-hosting.ts` - Full Phase 4 caching infrastructure + RECAPTCHA_SITE_KEY env var
- `infra/lib/amodx-stack.ts` - `enableCaching: true`, revalidation secrets, SSM reCAPTCHA key lookups
- `infra/lib/api.ts` - Revalidation secret + renderer URL + RECAPTCHA_SECRET_KEY env vars
- `infra/lib/api-commerce.ts` - RECAPTCHA_SECRET_KEY on createOrderFunc + validateCouponFunc
- `infra/lib/api-engagement.ts` - RECAPTCHA_SECRET_KEY on publicSubmitFormFunc
- `scripts/setup-recaptcha.sh` - NEW: stores deployment-level reCAPTCHA keys in SSM

### Config
- `.github/workflows/security-audit.yml` - npm audit on push
- `.github/workflows/playwright.yml` - Fixed cross-platform optional deps
- `.github/dependabot.yml` - Weekly grouped updates, majors ignored

---

## Phase 8: npm Audit Remediation (2026-03-30)

Resolved 5 of 8 vulnerabilities (including the only CRITICAL and both HIGHs) via `npm audit fix`. Remaining 5 moderate-severity findings are all inside frozen packages (aws-cdk-lib bundled deps, open-next/esbuild) — deferred until infra guardrails are in place.

| Package | Before | After | Severity | Notes |
|---------|--------|-------|----------|-------|
| handlebars | 4.7.8 | 4.7.9 | **CRITICAL** → fixed | 5 CVEs (proto pollution, JS injection, AST confusion). Transitive of ts-jest (dev only). |
| path-to-regexp | 8.3.0 | 8.4.0 | **HIGH** → fixed | ReDoS via sequential optional groups + multiple wildcards. Transitive of sinon/nise + express/router. |
| picomatch | 2.3.1 / 4.0.3 | 2.3.2 / 4.0.4 | **HIGH** → fixed | Method injection + ReDoS. Transitive of jest, vite, vitest, tinyglobby. |
| brace-expansion | 1.1.12 / 2.0.2 | 1.1.13 / 2.0.3 | moderate → fixed | Zero-step sequence hang. Transitive of eslint, minimatch, @node-minify. |
| aws-cdk-lib | 2.241.0 | **frozen** | moderate (yaml + brace) | Pinned to exact version. Upgrade blocked on infra guardrails. |
| esbuild (open-next) | 0.19.2 | **frozen** | moderate | Dev server vuln. Build-time only, not exploitable. Blocked on upstream. |

**aws-cdk-lib pinned**: Changed `infra/package.json` from `"^2.241.0"` to `"2.241.0"` to prevent accidental upgrades before infra tests exist.

**CI impact**: `security-audit.yml` uses `--audit-level=high`. All high/critical findings are now resolved, so CI will pass. The 5 remaining moderate findings won't trigger failure.

---

## Next Steps

1. **Test checkout flow** - Verify orders still work with strict tenant verification
2. **Monitor CloudFront cache hit ratio** - Target > 80% for popular pages
3. **(Optional) Phase 6.4 API Gateway resource policy** - CloudFront IPs only
4. **(Optional) Phase 6.5 Request signing** - Server-generated checkout tokens

## Completed Deployments

- **2026-03-07**: Phase 1-4 deployed (caching infrastructure)
- **2026-03-08**: Phase 6.1-6.3 deployed (request provenance, preview security)
