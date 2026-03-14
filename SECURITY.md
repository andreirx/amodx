# Security & Architecture Concerns (Mitigation Log)

This document tracks accepted architectural trade-offs and security mitigations for the AMODX platform.

## 1. CORS Strategy (Admin Panel)

**Observation:** `infra/lib/api.ts` configures CORS origins.
**Risk:** Permissive CORS (`*`) allows any site to query the API.
**Mitigation:**
1.  **Dynamic Configuration:** The infrastructure code accepts the Agency Domain at deploy time.
2.  **Strict Allowlist:**
    *   `https://admin.your-agency.com` (Production Admin)
    *   `http://localhost:3000` & `5173` (Local Development)
    *   All tenant domains (explicitly listed via `props.tenantDomains`)
3.  **Fallback:** `*` is only used if no Root Domain is configured in `amodx.config.json` (during initial bootstrap).

## 2. Public Content Access (Header Manipulation)

**Observation:** `renderer/src/app/api/posts/route.ts` uses `x-tenant-id` from the request header to query DynamoDB.
**Risk:** A user could manually send `curl -H "x-tenant-id: target-tenant"` to read content from a different site.
**Mitigation:**
1.  **Public is Public:** The endpoint explicitly filters for `FilterExpression: "#s = :published"`. It only returns content intended for public viewing.
2.  **No Private Data:** It explicitly does NOT return Drafts, Archived content, or internal notes.
3.  **Verdict:** This behavior is acceptable for a CMS. It is equivalent to scraping the target site.

## 3. PII in Comments

**Observation:** The Database stores `authorEmail` for comments.
**Risk:** Leaking email addresses to public visitors.
**Mitigation:**
1.  **Sanitization:** `backend/src/comments/list.ts` explicitly maps the database object to a sanitized response object.
2.  **Logic:** `authorEmail` is only included if the requestor has an authenticated Admin/Editor role. Public/Robot requests receive a stripped object.

## 4. Tenant Isolation (Backend)

**Observation:** Single Table Design puts all tenants in one DB.
**Risk:** Code bug could leak data between tenants.
**Mitigation:**
1.  **Policy Engine:** All Backend Handlers use `requireRole(auth, ..., tenantId)` which strictly compares the Token's `custom:tenantId` claim against the requested header.
2.  **No Defaults:** Removed the `|| "DEMO"` fallback from production handlers. Missing headers result in `400 Bad Request`.

## 5. Bot Protection (reCAPTCHA v3)

**Observation:** Five public endpoints accept unauthenticated POST requests: contact form, lead capture, dynamic form submission, order creation, and coupon validation.
**Risk:** Bots can spam forms, create fake orders, exhaust resources, or enumerate coupon codes.
**Mitigation:**
1.  **Deployment-level mandatory protection.** reCAPTCHA v3 keys are stored in AWS SSM Parameter Store and injected into all 5 Lambda handlers as `RECAPTCHA_SECRET_KEY` env vars at deploy time. This is not optional — `cdk deploy` requires the SSM params to exist.
2.  **Invisible verification.** reCAPTCHA v3 scores every request 0.0 (bot) to 1.0 (human) without user interaction. Score below threshold = 403 Forbidden.
3.  **Two-tier resolution.** `resolveRecaptchaConfig()` in `backend/src/lib/recaptcha.ts`: if a tenant provides their own keys (Admin > Settings), those take precedence. Otherwise, deployment keys apply. Tenants cannot disable protection.
4.  **Per-tenant threshold.** Each tenant can adjust the score threshold (default 0.5) via Admin > Settings to balance false positive rate vs. security strictness.
5.  **Domain scoping.** Google validates that the reCAPTCHA token was generated from a registered domain. Each tenant domain must be added to the reCAPTCHA project in the Google console.

**Protected endpoints:**
| Endpoint | File | Attack Vector |
|----------|------|---------------|
| `POST /contact` | `backend/src/contact/send.ts` | Spam submissions |
| `POST /leads` | `backend/src/leads/create.ts` | Fake lead injection |
| `POST /public/forms/{slug}/submit` | `backend/src/forms/public-submit.ts` | Form spam |
| `POST /public/orders` | `backend/src/orders/create.ts` | Fake orders |
| `POST /coupons/validate` | `backend/src/coupons/public-validate.ts` | Code enumeration |

**Key storage:** SSM Parameter Store (`/amodx/recaptcha/site-key` and `/amodx/recaptcha/secret-key`, both as String). String type is required because CloudFormation blocks SecureString in Lambda environment variables. Created by `npm run setup` or `scripts/setup-recaptcha.sh`.

**Supplementary controls on public endpoints:**
- Tenant origin verification (`verifyTenantFromOrigin` on orders + coupons)
- Zod schema validation on all inputs
- Email rate limiting (orders/create — max 5 emails/address/hour)
- Server-side price recalculation (orders/create — never trust client prices)

## 6. Secret Key Storage

**Observation:** Multiple secrets are required for operation.
**Inventory:**

| Secret | Storage | Access |
|--------|---------|--------|
| Master API Key | Secrets Manager | Lambda authorizer at runtime |
| Renderer API Key | Secrets Manager | Renderer Lambda at runtime |
| NextAuth Secret | Secrets Manager | Renderer Lambda env var (deploy time) |
| Revalidation Secret | Secrets Manager | Renderer + backend Lambdas (deploy time) |
| Origin Verify Secret | Secrets Manager | CloudFront Function + Renderer Lambda |
| reCAPTCHA Site Key | SSM Parameter Store (String) | Renderer Lambda env var (public, in HTML) |
| reCAPTCHA Secret Key | SSM Parameter Store (String) | 5 backend Lambdas env var (deploy time) |
| Cognito credentials | Cognito (managed) | Admin SPA via Amplify |
| Google OAuth per-tenant | DynamoDB (TenantConfig) | Renderer NextAuth at runtime |

**Mitigation:** Secrets Manager secrets use auto-generated values. reCAPTCHA keys use SSM String type (CloudFormation blocks SecureString in Lambda env vars; reCAPTCHA keys are not credential-grade — they're POST'd in plaintext to Google on every verification). No secrets are hardcoded in source. Tenant-specific API keys (Google, Brave, etc.) are stored in DynamoDB TenantConfig, accessed only by the owning tenant's handlers.
