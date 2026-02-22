# Authentication Architecture

AMODX has **four authentication mechanisms** serving different audiences. Two Cognito pools are provisioned per deployment (not per tenant), plus NextAuth.js for customer accounts and a master API key for system-to-system calls.

## Overview

| Mechanism | Pool / Provider | Status | Audience | Sign-up |
|-----------|----------------|--------|----------|---------|
| Admin Cognito Pool | `AmodxAdminPool` | **Active** | Agency owners, editors | Invite-only |
| Public Cognito Pool | `AmodxPublicPool` | **Provisioned, not wired** | Tenant visitors | Self-signup |
| NextAuth + Google OAuth | Per-tenant Google credentials | **Active** | Site customers | Google sign-in |
| Master API Key | Secrets Manager | **Active** | Renderer SSR, MCP tools | N/A |

## 1. Admin Pool (Active)

**CDK:** `infra/lib/auth.ts` → `AmodxAdminPool`

**Custom attributes:**
- `custom:role` — `GLOBAL_ADMIN`, `TENANT_ADMIN`, `EDITOR`
- `custom:tenantId` — specific tenant ID or `"GLOBAL"` / `"ALL"`

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

3. **Backend user management** (`backend/src/users/*.ts`): Invite, list, update, toggle-status — all operate against this pool via Cognito admin SDK.

**All authenticated API routes use this pool.** Public routes (`/public/*`, `/leads`, `/contact`, `/consent`) bypass auth entirely.

## 2. Public Pool (Provisioned but Dormant)

**CDK:** `infra/lib/auth.ts` → `AmodxPublicPool`

**Custom attributes:**
- `custom:tenant_id` (note: underscore, unlike admin pool's camelCase)

**Configuration:**
- `selfSignUpEnabled: true`
- Sign-in aliases: email + username
- Password: min 6 chars (lower bar than admin)
- No custom invite email

**Current status:**
- Pool IDs exported as CloudFormation outputs (`PublicPoolId`, `PublicClientId`)
- Written to `renderer/.env.local` by `scripts/post-deploy.ts` as `NEXT_PUBLIC_USER_POOL_ID` and `NEXT_PUBLIC_USER_POOL_CLIENT_ID`
- **Never imported or referenced** in any renderer source code
- No API routes use it for authorization

**Design intent:**
- `TenantMemberSchema` in `packages/shared/src/index.ts` has `id` field commented as "Cognito SUB from the End User Pool"
- `TenantMemberRole` enum: `["Member", "Subscriber", "VIP"]` — distinct from admin roles
- The pool client comment says "NextAuth runs client-side/edge compatible"
- Likely intended as a user store behind NextAuth, but the implementation went a different direction

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
- `renderer/src/components/Providers.tsx` — wraps site in `<SessionProvider>`
- `renderer/src/components/Navbar.tsx` — shows "Sign In" or user account link
- `renderer/src/components/AccountPageView.tsx` — customer profile + order history

**CDK env vars** (in `infra/lib/renderer-hosting.ts`):
- `NEXTAUTH_SECRET` — from dedicated Secrets Manager secret
- `NEXTAUTH_URL` — base domain, overridden per-request

**Google OAuth credentials** — per-tenant in `TenantConfig.integrations.google`:
```typescript
google: z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
}).optional()
```

**Important:** NextAuth sessions are completely independent of both Cognito pools. Customer data lives in DynamoDB (`CUSTOMER#email` records), not Cognito.

## 4. Master API Key (Active)

**CDK:** `infra/lib/amodx-stack.ts` — Secrets Manager secret

**How it works:**
- Backend authorizer (`backend/src/auth/authorizer.ts`) checks `x-api-key` header
- If matched: returns `sub: "system-robot"`, `role: "GLOBAL_ADMIN"`, `tenantId: "ALL"`
- Used by renderer's server-side API client (`renderer/src/lib/api-client.ts`)
- Used by MCP tools for automation

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway                               │
│                    (Lambda Authorizer)                            │
│          Validates: Admin Cognito JWT OR Master API Key           │
└──────────┬────────────────────────────────────┬─────────────────┘
           │                                    │
    Authenticated Routes                  Public Routes
    (Content, Products,                   (/public/*, /leads,
     Orders, Users, etc.)                  /contact, /consent)
           │                                    │
           ▼                                    ▼
    ┌─────────────┐                    No auth required
    │ Admin Pool  │
    │ (Cognito)   │
    └─────────────┘
           ▲
           │ Amplify Auth
    ┌─────────────┐
    │  Admin SPA  │
    │  (React)    │
    └─────────────┘


┌─────────────────────────────────────────────────────────────────┐
│                     Renderer (Next.js)                           │
├──────────────────┬──────────────────────────────────────────────┤
│  SSR API calls   │  Customer Auth                                │
│  (Master API Key)│  (NextAuth + Google OAuth)                    │
│                  │  Per-tenant credentials from DynamoDB          │
│                  │  Sessions = signed cookies                     │
└──────────────────┴──────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Public Pool (Cognito)                           │
│                   *** NOT CURRENTLY USED ***                      │
│   Provisioned in CDK, env vars written, but never imported       │
└─────────────────────────────────────────────────────────────────┘
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
2. Server-side `page.tsx` reads the `next-auth.session-token` cookie
3. Decodes JWT with `NEXTAUTH_SECRET` to extract `email`
4. Queries DynamoDB: `getCustomerOrders(tenantId, email)` → `CUSTORDER#email#*` adjacency
5. Queries DynamoDB: `getCustomerProfile(tenantId, email)` → `CUSTOMER#email` record
6. Renders order history + profile info

**Identity linking is purely email-based.** If a customer checks out as `john@example.com` without signing in, then later signs in with Google as `john@example.com`, they will see all their previous orders. No Cognito SUB or user pool involved.

**What each mechanism provides:**

| Feature | Auth Required? | Mechanism |
|---------|---------------|-----------|
| Browse products | No | Public routes |
| Place an order | No | `POST /public/orders` (unauthenticated) |
| Track a specific order | No | `GET /public/orders/{id}?email=` (email verification) |
| View account + all orders | Google sign-in | NextAuth session → email → DynamoDB lookup |
| Manage orders (admin) | Admin Cognito JWT | API Gateway authorizer |

## Key Facts

- **Pools are per-deployment, not per-tenant.** One admin pool serves all tenants. Tenant isolation is via `custom:tenantId` attribute + backend authorization checks.
- **The public pool exists but does nothing.** It was created as forward-looking infrastructure. Customer authentication bypasses it entirely via NextAuth.
- **Google OAuth credentials are per-tenant.** Each tenant can have its own Google OAuth app, allowing customers to sign in with Google on each tenant site independently.
- **Three credential stores:** Cognito (admin users), DynamoDB (customer records), Secrets Manager (API key + NextAuth secret).

## Decision: Public Pool Future

The public Cognito pool could serve these future purposes:
- **Email/password customer auth** — if tenants want non-Google sign-in options
- **Federated identity** — Cognito as identity broker for multiple social providers per tenant
- **Customer API access** — if customers need authenticated API calls (wishlist, saved addresses)

Currently, the NextAuth approach is simpler and sufficient for Google-only sign-in with cookie-based sessions.
