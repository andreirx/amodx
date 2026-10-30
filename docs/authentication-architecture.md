# Authentication Architecture

AMODX has **six authentication mechanisms** serving different audiences. Two Cognito pools are provisioned per deployment (not per tenant), plus NextAuth.js for customer accounts, a master API key for system-to-system calls, a restricted renderer API key for renderer proxy routes, and tenant-bound service keys for external integrations.

## Overview

| Mechanism | Pool / Provider | Status | Audience | Sign-up |
|-----------|----------------|--------|----------|---------|
| Admin Cognito Pool | `AmodxAdminPool` | **Active** | Agency owners, editors | Invite-only |
| Public Cognito Pool | `AmodxPublicPool` | **Wired, no consumer routes** | Tenant visitors | Self-signup |
| NextAuth + Google OAuth | Per-tenant Google credentials | **Active** | Site customers | Google sign-in |
| Master API Key | Secrets Manager | **Active** | MCP tools, system robots | N/A |
| Renderer API Key | Secrets Manager | **Active** | Renderer Lambda proxy routes | N/A |
| Service keys (`amx_sk_…`) | DynamoDB (hash only) | **Built, not deployed** (SERVICE-ACCOUNT-1) | External systems for ONE tenant (glamCRM) | Created by a TENANT_ADMIN in Settings → Integration keys |

## 1. Admin Pool (Active)

**CDK:** `infra/lib/auth.ts` -> `AmodxAdminPool`

**Custom attributes:**
- `custom:role` -- `GLOBAL_ADMIN`, `TENANT_ADMIN`, `EDITOR`
- `custom:tenantId` -- specific tenant ID or `"GLOBAL"` / `"ALL"`

**Configuration:**
- `selfSignUpEnabled: false` (invite-only via `AdminCreateUser`)
- Sign-in alias: email
- Password: min 8 chars
- Token validity: access 60min, id 60min, refresh 7 days
- Custom invite email via SES
- `preventUserExistenceErrors: true`

**Where it connects:**

1. **API Gateway authorizer** (`infra/lib/api.ts`): Lambda authorizer verifies Cognito JWTs using `aws-jwt-verify`. Receives `USER_POOL_ID` + `USER_POOL_CLIENT_ID` from the admin pool.

2. **Admin SPA** (`admin/src/main.tsx`): AWS Amplify configured with `VITE_USER_POOL_ID` and `VITE_USER_POOL_CLIENT_ID`. Injected by `ConfigGenerator` in `infra/lib/admin-hosting.ts`.

3. **Backend user management** (`backend/src/users/*.ts`): Invite, list, update, toggle-status -- all operate against this pool via Cognito admin SDK.

**This pool is the staff JWT mechanism** (agency owners and editors; `custom:role` + `custom:tenantId`). It is not the only identity source on authenticated routes: the authorizer also resolves the master key, the renderer key and service keys (sections 4, 4b, 4c) and public-pool JWTs (section 2). Anonymous access exists in two forms. (1) Routes configured `authorizationType: NONE` (`noAuth: true` in the CommerceApi / EngagementApi `addRoute` helper — the 11 staging route keys of the public catalog (products, categories), review, order, coupon, delivery-date, popup and form-submit routes under `/public/`) run no authorizer at all. The `/public/` prefix alone does not mean anonymous: `POST /public/customers/profile` runs the authorizer, and its handler admits RENDERER (the renderer proxy) or GLOBAL_ADMIN (`requireRole(auth, ["GLOBAL_ADMIN", "RENDERER"])`, `backend/src/customers/public-update.ts:38`); a service key is refused there by the authorizer allowlist (section 4c). (2) `POST /leads`, `POST /contact`, `POST /consent` run the authorizer, which checks API keys first -- if the renderer key is present, the request is authenticated as `RENDERER` role before the anonymous fallback runs. See section 4b.

## 2. Public Pool (Wired, No Consumer Routes Yet)

**CDK:** `infra/lib/auth.ts` -> `AmodxPublicPool`

**Custom attributes:**
- `custom:tenant_id` (note: underscore, unlike admin pool's camelCase)

**Configuration:**
- `selfSignUpEnabled: true`
- Sign-in aliases: email + username
- Password: min 8 chars
- No custom invite email

**Current status:**
- Pool IDs exported as CloudFormation outputs (`PublicPoolId`, `PublicClientId`)
- Written to `renderer/.env.local` by `scripts/post-deploy.ts` as `NEXT_PUBLIC_USER_POOL_ID` and `NEXT_PUBLIC_USER_POOL_CLIENT_ID`
- **Authorizer wired:** `PUBLIC_POOL_ID` and `PUBLIC_POOL_CLIENT_ID` passed to the Lambda authorizer. Public pool JWTs are verified as a fallback after admin pool verification fails.
- **No consumer routes exist yet.** All existing `requireRole()` calls use admin-only role lists. A valid CUSTOMER token will authenticate successfully but be rejected at the handler level by every current route.

**Authorizer behavior for public pool tokens:**
- Role is ALWAYS the literal `"CUSTOMER"` -- never read from token claims, never defaultable
- `tenantId` is extracted from `custom:tenant_id` -- if missing or empty, the token is rejected
- If `PUBLIC_POOL_ID` is set but `PUBLIC_POOL_CLIENT_ID` is missing (or vice versa), the public pool branch is disabled entirely and a CRITICAL error is logged

**Security constraints for future consumer routes:**
- Do NOT add customer routes under the anonymous-bypass paths (`POST /leads`, `POST /contact`, `POST /consent`). Those resolve before JWT verification in the authorizer cascade, which means a bearer token sent to those routes is silently ignored.
- Do NOT treat `custom:tenant_id` alone as sufficient proof of tenant access. Public users are lower-trust identities. Consumer routes must still perform host/tenant consistency checks or server-controlled membership verification so a token for tenant A cannot be replayed against tenant B routes.

**Design intent:**
- `TenantMemberSchema` in `packages/shared/src/index.ts` has `id` field commented as "Cognito SUB from the End User Pool"
- `TenantMemberRole` enum: `["Member", "Subscriber", "VIP"]` -- distinct from admin roles
- Future use: commerce customer accounts (subscribers, member tiers), appointments/scheduling

## 3. NextAuth + Google OAuth (Active)

**Route handler:** `renderer/src/app/api/auth/[...nextauth]/route.ts`

**How it works:**
1. On each request, determines tenant from `host` header
2. Fetches tenant config from DynamoDB via `getTenantConfig(host)`
3. Reads `config.integrations.google.clientId` + `clientSecret` (stored per-tenant in DB)
4. Creates `GoogleProvider` with those credentials
5. Signs session cookies with `NEXTAUTH_SECRET` (from Secrets Manager)
6. `NEXTAUTH_URL` is set dynamically per-request to `{protocol}://{host}`

**Session consumers:**
- `renderer/src/components/Providers.tsx` -- wraps site in `<SessionProvider>`
- `renderer/src/components/Navbar.tsx` -- shows "Sign In" or user account link
- `renderer/src/components/AccountPageView.tsx` -- customer profile + order history

**CDK env vars** (in `infra/lib/renderer-hosting.ts`):
- `NEXTAUTH_SECRET` -- from dedicated Secrets Manager secret
- `NEXTAUTH_URL` -- base domain, overridden per-request

**Google OAuth credentials** -- per-tenant in `TenantConfig.integrations.google`:
```typescript
google: z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
}).optional()
```

**Important:** NextAuth sessions are completely independent of both Cognito pools. Customer data lives in DynamoDB (`CUSTOMER#email` records), not Cognito.

## 4. Master API Key (Active)

**CDK:** `infra/lib/amodx-stack.ts` -- Secrets Manager secret

**How it works:**
- Backend authorizer (`backend/src/auth/authorizer.ts`) checks `x-api-key` header
- If matched: returns `sub: "system-robot"`, `role: "GLOBAL_ADMIN"`, `tenantId: "ALL"`
- Used by MCP tools for automation
- Full access to all API routes regardless of role checks

## 4b. Renderer API Key (Active)

**CDK:** `infra/lib/amodx-stack.ts` -> `RendererApiKey` secret

**How it works:**
- Separate secret from the master key, with a restricted scope
- Backend authorizer checks `x-api-key` -- if it matches the renderer key, returns `sub: "renderer"`, `role: "RENDERER"`, `tenantId: "ALL"`
- Fetched at runtime from Secrets Manager by `renderer/src/lib/api-client.ts` via `getRendererKey()`
- Local dev fallback: `AMODX_API_KEY` env var (set by `post-deploy.ts`)

**Scope -- routes that accept RENDERER role:**
- `POST /comments`, `DELETE /comments` -- comment moderation
- `POST /public/customers/profile` -- customer profile update (via session-validated proxy)
- `POST /contact`, `POST /leads`, `POST /consent` -- public form proxies (tenant derived from host)

**Authorizer order:**
1. API key checks run first (master key, then renderer key, then service key — section 4c)
2. If a valid key is found, the request is authenticated with the corresponding role
3. Only if no valid key is present do public routes fall through to anonymous bypass (a presented service key never does)

This means renderer proxy calls to `POST /contact`, `POST /leads`, and `POST /consent` authenticate as `RENDERER` rather than `anonymous`. The backend distinguishes trusted proxy calls from direct browser calls.

**Tenant verification trust model** (`backend/src/lib/tenant-verify.ts`):

| Caller | Trust anchor | Origin check |
|--------|-------------|--------------|
| Renderer proxy (RENDERER) | Authenticated service identity + host-derived tenant | Skipped |
| Direct browser (anonymous) | Browser-enforced Origin header matched against GSI_Domain | Required |
| System robot (GLOBAL_ADMIN) | Master key with explicit tenant targeting | Skipped |

The renderer proxies derive the tenant ID server-side from the host header via `getTenantConfig(host)`, not from client-supplied `x-tenant-id`.

## 4c. Service keys (SERVICE-ACCOUNT-1 — built, not deployed)

A tenant-bound credential for an external server (first consumer: glamCRM). A TENANT_ADMIN creates it in
Settings → Integration keys (or the MCP tool `service_key_create`); the secret `amx_sk_` + 43 base64url chars is
shown once and only `sha256(secret)` is stored (`backend/src/lib/service-keys.ts`).

**Call shape (all three headers required):** `x-api-key: amx_sk_…`, `Authorization: Bearer service` (a placeholder
— the API's `identitySource` needs both headers; the branch never reads it), `x-tenant-id: <the key's tenant>`.

**Authorizer branch** (after the renderer key, before the anonymous bypass):
1. One strongly consistent `GetItem` on `SVCKEYHASH#<sha256(secret)>`. Absent = unknown or revoked → deny (API
   Gateway answers 403). No secret comparison exists: the hash is the read key.
2. Route allowlist `SERVICE_ROUTE_SCOPES` in `backend/src/auth/policy.ts` — `GET /products` → `catalog:read`,
   `GET /leads` → `leads:read`, `POST /import/glam-pricelist` → `catalog:write` (CAT-IMPORT-1), `POST /import/glam-pricelist/images` → `catalog:write` (CAT-IMAGES-1). Route not in the table, scope not held, or `x-tenant-id` absent or ≠ the key's
   tenant → deny. This holds for every route behind the API's Lambda authorizer, whether or not its handler
   calls `requireRole`. Only routes configured `authorizationType: NONE` (`noAuth: true` in the nested stacks'
   `addRoute`) skip the authorizer; a key there is not evaluated and confers nothing over anonymous. The `/public/`
   prefix is not the rule: `POST /public/customers/profile` runs the authorizer, so a key is refused there.
3. Context `{ sub: "service:<keyId>", role: "SERVICE", tenantId, scopes: "a,b", keyId }` (role is a literal;
   tenant and scopes come from the stored record).
4. First use per UTC day: `lastUsedAt` + audit `SERVICE_KEY_USED` (best effort; a failure still authorises).

**Handler side (defence in depth):** the three handlers also declare the scope — `requireRole(auth, roles, tenantId,
"catalog:read" | "leads:read" | "catalog:write")`. Each layer checks only its own declaration: a route absent from the table is
denied by the authorizer; a handler with no declaration is denied by `requireRole`. Nothing compares the two
declarations at runtime — keeping them equal is a maintenance requirement, pinned by the unit tests
(`service-key-policy.test.ts` pins the table; `service-key-routes.test.ts` and, for the import,
`glam-import-handler.test.ts` show each handler admits a key holding
only its table scope).

**Revocation:** `POST /service-keys/{id}/revoke` deletes the lookup item; with `resultsCacheTtl` 0 the next request
is refused. The key record stays, listed as revoked.

## Architecture Diagram

```
                        API Gateway
                    (Lambda Authorizer)
   Check order: API keys -> anonymous bypass -> Admin JWT -> Public JWT
   (API keys = master, renderer, then service key; a service key reaches only
    the SERVICE_ROUTE_SCOPES routes of its own tenant — section 4c)

       |              |              |                    |
  Master Key     Renderer Key   Anonymous bypass     Cognito JWT
  (GLOBAL_ADMIN)  (RENDERER)    (leads/contact/      (two pools)
       |              |          consent)                 |
       v              v              v              ┌─────┴─────┐
  All routes     Scoped routes   Public routes   Admin pool   Public pool
               (comments,       (no auth)       (EDITOR/      (CUSTOMER)
                profile, etc.)                   TENANT_ADMIN)

  Admin pool: custom:role + custom:tenantId (camelCase)
  Public pool: role hardcoded to "CUSTOMER" + custom:tenant_id (underscore)

  WARNING: Anonymous bypass runs BEFORE JWT verification.
  Do NOT add customer routes under POST /leads, /contact, /consent.


                     Renderer (Next.js)
  ---------------------------------------------------------
  Proxy routes         |  Customer Auth
  (Renderer Key)       |  (NextAuth + Google OAuth)
  Derives tenant       |  Per-tenant credentials from DynamoDB
  from host            |  Sessions = signed cookies


                   Public Pool (Cognito)
                   *** WIRED — NO CONSUMER ROUTES YET ***
   Authorizer verifies public pool JWTs as fallback after admin pool.
   Returns role: "CUSTOMER", tenantId from custom:tenant_id.
   No existing route accepts CUSTOMER in its allowedRoles.
```

## 5. Commerce Customer Flow (How Orders Are Tracked)

Customer accounts in the commerce module do **not** use either Cognito pool. The system is email-based:

**Checkout (no login required):**
1. Customer fills in name, email, phone, address on the checkout form
2. `POST /public/orders` is unauthenticated (public route, no auth)
3. Backend creates order + upserts `CUSTOMER#email` record via `TransactWriteCommand`
4. DynamoDB keys: `ORDER#orderId`, `CUSTORDER#email#orderId` (adjacency), `CUSTOMER#email`

**Account page (requires Google sign-in):**
1. Customer signs in via NextAuth/Google on the tenant site
2. Session-validated API route (`/api/account/orders`) reads orders from DynamoDB
3. Session-validated API route (`/api/profile`) reads/updates customer profile
4. Renderer derives tenant from host, uses session email -- never trusts client-supplied values

**Identity linking is purely email-based.** If a customer checks out as `john@example.com` without signing in, then later signs in with Google as `john@example.com`, they will see all their previous orders. No Cognito SUB or user pool involved.

**What each mechanism provides:**

| Feature | Auth Required? | Mechanism |
|---------|---------------|-----------|
| Browse products | No | Public routes |
| Place an order | No | `POST /public/orders` (reCAPTCHA + Origin verification) |
| Track a specific order | No | `GET /public/orders/{id}?email=` (email verification) |
| View account + all orders | Google sign-in | NextAuth session -> email -> DynamoDB lookup (via `/api/account/orders`) |
| Update profile | Google sign-in | NextAuth session -> email -> backend via renderer proxy (RENDERER key) |
| Manage orders (admin) | Admin Cognito JWT | API Gateway authorizer |

## 5b. reCAPTCHA v3 (Bot Protection on Public Routes)

reCAPTCHA v3 is orthogonal to authentication -- it protects **unauthenticated public routes** from bot abuse. It runs invisibly (no checkbox/puzzle), scoring each request 0.0 (bot) to 1.0 (human).

**Protected endpoints:** `POST /contact`, `POST /leads`, `POST /public/forms/{slug}/submit`, `POST /public/orders`, `POST /coupons/validate`

**Architecture:** Two-tier resolution with mandatory deployment-level baseline:
1. Deployment-level keys stored in SSM Parameter Store, injected as Lambda env vars at deploy time
2. Tenant can override with their own keys via Admin > Settings (for separate analytics/compliance)
3. Tenant can adjust score threshold (always per-tenant, default 0.5)
4. Tenants cannot disable reCAPTCHA -- deployment keys always apply as fallback

**Resolution logic:** `backend/src/lib/recaptcha.ts` -> `resolveRecaptchaConfig(tenantConfig)`:
- Tenant has own `siteKey` + `secretKey` -> use tenant keys
- Otherwise -> use `RECAPTCHA_SECRET_KEY` env var (deployment-level)
- Neither (local dev only) -> skip verification

**Client-side:** `renderer/src/hooks/useRecaptcha.ts` hook calls `grecaptcha.execute(siteKey, { action })` and includes the token in POST body. The site key is injected by `ThemeInjector` (tenant key takes priority, else deployment key from `RECAPTCHA_SITE_KEY` env var).

**Setup:** `./scripts/setup-recaptcha.sh` stores keys in SSM. See `docs/INTEGRATION_MANUAL.md` for the full Google registration walkthrough.

**Tenant onboarding:** When adding a new domain, it must be added to the reCAPTCHA project's domain list in the Google console, in addition to ACM cert and CDK deploy.

## Key Facts

- **Pools are per-deployment, not per-tenant.** One admin pool serves all tenants. Tenant isolation is via `custom:tenantId` attribute + backend authorization checks.
- **The public pool is wired but has no consumer routes.** The authorizer verifies public pool JWTs as a fallback after admin pool, returning `role: "CUSTOMER"`. No existing route accepts CUSTOMER. Commerce customer accounts still use NextAuth + email-based DynamoDB identity.
- **Google OAuth credentials are per-tenant.** Each tenant can have its own Google OAuth app, allowing customers to sign in with Google on each tenant site independently.
- **Four credential stores:** Cognito (admin users), DynamoDB (customer records; service-key hashes), Secrets Manager (master key, renderer key, NextAuth secret, revalidation secret).
- **reCAPTCHA is per-deployment by default.** Deployment keys in SSM provide mandatory bot protection. Tenants can override with own keys but cannot disable. See `docs/INTEGRATION_MANUAL.md`.
- **Tenant secrets are redacted for EDITOR role.** `GET /settings` strips `recaptcha.secretKey`, `integrations.google.clientSecret`, and `integrations.braveApiKey`. Admin users fetch these via `GET /settings/secrets`.

## Decision: Public Pool — Current State and Future

The public Cognito pool authorizer wiring is live as a support module. It authenticates public pool JWTs and returns `role: "CUSTOMER"` with validated `tenantId`. No routes consume this role yet.

**Planned consumers:**
- **Commerce customer accounts** -- subscriber management, member tiers, wishlist, saved addresses
- **Appointments/scheduling** -- authenticated booking requiring Public Cognito sign-in
- **Email/password customer auth** -- if tenants want non-Google sign-in options
- **Federated identity** -- Cognito as identity broker for multiple social providers per tenant

**Security constraints for consumer routes (when added):**
1. Never add customer routes under anonymous-bypass paths (`POST /leads`, `POST /contact`, `POST /consent`) -- those resolve before JWT verification
2. Do not treat `custom:tenant_id` alone as sufficient proof of tenant access -- consumer routes must also check host/tenant consistency or server-controlled membership
3. The `requireRole()` fallback in `policy.ts` line 15 defaults missing roles to `EDITOR` -- the authorizer MUST always set `role: "CUSTOMER"` explicitly for public pool tokens

Currently, the NextAuth approach remains active for Google-only sign-in with cookie-based sessions on commerce sites. The public pool and NextAuth can coexist -- they serve different authentication needs.
