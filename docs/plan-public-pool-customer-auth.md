# Plan: Email/Password Customer Auth via Public Cognito Pool

## Status

- PLANNED
- Identity model: **tenant-local** — `docs/platform-decisions.md` PD-001
- Customer data transport: **renderer proxy** — `docs/platform-decisions.md` PD-002
- Cognito role: **login substrate only in Phase 1** — `docs/platform-decisions.md` PD-003

> This plan depends on three platform decisions in `docs/platform-decisions.md`
> (PD-001/002/003). Read them first. This doc covers only the **login** consequences
> for customers; it does not cover how authenticated customers read/write data.

## Problem

Customer authentication currently only supports Google OAuth via NextAuth. Tenants who
want email/password registration for their customers have no option. The
`AmodxPublicPool` Cognito user pool is already provisioned in CDK
(`infra/lib/auth.ts`) with `selfSignUpEnabled: true` but is completely unwired — no
code references it at runtime. It is also **misconfigured for tenant-local identity**
(see Phase A4 — Pool Replacement).

## Goal

Allow site visitors to register and sign in with email/password in addition to Google
OAuth, on a per-tenant opt-in basis. Both methods coexist and, **within a single
tenant**, both resolve to the same `CUSTOMER#email` DynamoDB record for order history.

Per PD-001, identity is tenant-local: the same email on two different tenant websites
is two separate accounts.

## Scope boundary: login vs data (PD-003)

This plan covers ONE channel: **login** — verifying an email/password credential and
establishing a NextAuth session.

It does NOT cover how authenticated customer actions read or write data. That is the
**data** channel, which uses the renderer proxy (PD-002) and is specified in
`plan-commerce-private-table.md` (account/profile/orders) and
`plan-appointments-private-table-extension.md` (bookings).

Do not conflate the two:

- Login transport: renderer → Cognito (`InitiateAuth`).
- Data transport: renderer → backend with the RENDERER key.

## Current State

| Component | Status |
|-----------|--------|
| `AmodxPublicPool` (Cognito) | Provisioned, dormant, **MISCONFIGURED for tenant-local identity**. `selfSignUpEnabled: true`, `signInAliases: { email: true, username: true }` (email-as-alias is wrong — see A4), `custom:tenant_id` attribute present. |
| `AmodxPublicClient` (Cognito app client) | Created, never used. `authFlows: { userSrp: true, custom: true }` — **missing `userPassword`**. `preventUserExistenceErrors` **not set**. `generateSecret: false` — **wrong** for the renderer-server topology; A4 recreates it as a confidential client. |
| CloudFormation outputs | `PublicPoolId`, `PublicClientId` exported. |
| `scripts/post-deploy.ts` / `post-deploy-staging.ts` | Writes `NEXT_PUBLIC_USER_POOL_ID` + `NEXT_PUBLIC_USER_POOL_CLIENT_ID` to renderer `.env.local` — renderer never imports them. **Legacy/dormant for this plan**: Phase-1 auth uses server-side `COGNITO_PUBLIC_*` env + the client secret from Secrets Manager, never `NEXT_PUBLIC_*` browser config. |
| NextAuth Google OAuth | Active. Per-tenant Google credentials in `TenantConfig.integrations.google`. |
| `CUSTOMER#email` records | Created on order placement. Used by account page. Tenant-scoped (`PK = TENANT#<tenantId>`). |
| Backend authorizer `CUSTOMER` branch | Present; verifies Public-pool JWTs, returns role `CUSTOMER`. Dormant — no consumer routes. **Keep** per PD-003. |

## Architecture Decision

**Use the Cognito public pool as a NextAuth `CredentialsProvider`**, not as a
standalone Amplify auth. This keeps one unified session mechanism (NextAuth cookies)
regardless of whether the user signed up with Google or email/password.

**Why not Amplify in the renderer?** Adding Amplify alongside NextAuth creates two
competing session systems. NextAuth already handles multi-provider gracefully — adding
a `CredentialsProvider` that validates against Cognito under the hood is cleaner.

**Alternative considered:** Use Cognito Hosted UI as a NextAuth `CognitoProvider`.
Rejected because Cognito Hosted UI can't be themed per-tenant and the URL
(`xxx.auth.region.amazoncognito.com`) looks unprofessional.

**Identity model (PD-001):** tenant-local. Cognito username =
`<tenantId>#<sha256hex(normalizedEmail)>` (length-safe, ≤128 chars; via the renderer
server-only `cognitoUsername()` helper), derived server-side from host-derived tenant +
normalized email. Email is a user attribute, not a sign-in alias.

**Data transport (PD-002/PD-003):** out of scope here. Login establishes the NextAuth
session; data access is renderer-proxied.

**App client (PD-003, Phase 1):** confidential client (`generateSecret: true`). All
Cognito calls are renderer-server-side, so the renderer holds the client secret and sends
`SECRET_HASH`; a browser cannot call Cognito directly. A separate public client is added
only if future direct browser JWT auth (PD-003) is built.

## Implementation Plan

### Phase A: Infrastructure (CDK + Backend)

#### A1. Pass public pool env vars to renderer Lambda

**File:** `infra/lib/renderer-hosting.ts`

Currently the renderer Lambda only gets `NEXTAUTH_SECRET` and `NEXTAUTH_URL`. Add the
pool/client ids as env, and the **confidential client secret** server-side (never
`NEXT_PUBLIC_*`, never a plain CFN output):

```
COGNITO_PUBLIC_POOL_ID: auth.publicPool.userPoolId
COGNITO_PUBLIC_CLIENT_ID: auth.publicClient.userPoolClientId
COGNITO_PUBLIC_CLIENT_SECRET_ARN: <Secrets Manager secret holding the confidential client secret>
```

The renderer reads the secret at runtime (cached per cold start, like the authorizer's
key fetch) to compute `SECRET_HASH` for every Cognito call. Grant the renderer Lambda
`secretsmanager:GetSecretValue` on that secret. (Secrets Manager matches the existing
master/renderer-key pattern; an encrypted Lambda env var is an acceptable simpler
alternative — never expose the secret to the browser.)

#### A2. Per-tenant toggle for email/password auth

**File:** `packages/shared/src/index.ts` → `IntegrationsSchema`

```typescript
customerAuth: z.object({
    enableEmailPassword: z.boolean().default(false),
    enableGoogle: z.boolean().default(true),
}).default({ enableEmailPassword: false, enableGoogle: true }),
```

Tenants opt-in to email/password via admin Settings. Google remains default-on.
Defaults keep email/password OFF for every existing tenant.

#### A3. Tenant-local identity in Cognito (PD-001)

The public pool username is `<tenantId>#<sha256hex(normalizedEmail)>`, produced by the
`cognitoUsername()` helper (renderer server-only lib in Phase 1 — see Email normalization
& username derivation below).

- The user types only their email in the UI.
- The renderer derives the username from the host-derived tenant + the normalized email
  (via the server-only `cognitoUsername()` — Phase 1 has no backend username derivation).
- The username is NEVER accepted from the browser. Anti-spoof: otherwise a client could
  register/sign-in/reset against another tenant's namespace.
- `email` is stored as a user attribute (for verification/reset delivery), NOT as a
  sign-in alias.
- `custom:tenant_id` is still written at sign-up, for the future direct-JWT path
  (PD-003).

**Email normalization** is `lowercase + trim`, implemented once as a shared utility in
`packages/shared` and used by checkout, all auth handlers, and username construction.
See Email normalization & username derivation below. This is load-bearing: divergent normalization
forks `CUSTOMER#email` records and breaks anonymous-order → registered-account linking.

The email is hashed for length-safety and determinism, not secrecy — the plaintext email
is still stored in the Cognito `email` attribute for verification/reset delivery.
Cognito's `SignUp.Username` max is 128 chars; `<tenantId>` + `#` + a 64-hex-char SHA-256
stays under that (36-char UUID → 101). The hash is reconstructable from the normalized
email, so every flow derives the username without storing it.

Within a tenant, `<tenantId>#<sha256hex(email)>` is unique, so Cognito enforces one
account per (tenant, email). Across tenants the tenant prefix differs, so the same email
yields independent accounts — exactly PD-001.

#### A4. Public pool replacement (REQUIRED before customer auth goes live)

The dormant public pool has `signInAliases: { email: true, username: true }`.
Email-as-alias makes email a pool-global sign-in identity, which contradicts
tenant-local identity (PD-001). `signInAliases` is **immutable** on an existing Cognito
pool — changing it forces a CloudFormation **replacement**.

Because the pool is dormant, replacement is safe. Do all required changes in ONE
replacement so you do not pay for three:

1. `signInAliases: { username: true }` (drop the email alias; email stays an attribute)
2. add `userPassword: true` to the client `authFlows` (server-side `USER_PASSWORD_AUTH`
   from the renderer Lambda; SRP is unnecessary and more complex server-side)
3. add `preventUserExistenceErrors: true` to the client (register/forgot otherwise leak
   which emails exist)
4. set `generateSecret: true` (confidential client). All Phase-1 Cognito calls are
   renderer-server-side, so the renderer holds the secret and sends `SECRET_HASH` — a
   public, secretless client id would let anyone call `SignUp`/`ForgotPassword`/
   `InitiateAuth` directly (those ops are unauthenticated, no IAM), bypassing the
   renderer's throttling, reCAPTCHA, feature-flag, and generic-response controls. The old
   `generateSecret: false` rationale ("NextAuth edge-compatible") is obsolete: NextAuth's
   `authorize()` runs server-side in the renderer Node Lambda, not at the edge.

**Pre-flight:**

- Confirm the pool has zero users (it is dormant). If any users exist, export them first.
- Keep `removalPolicy: RETAIN` (the default). On replacement, RETAIN **orphans** the old
  empty pool — it is kept, not deleted. Do NOT make `DESTROY` the default path on a
  production stack. After the deploy, verify: new pool/client IDs propagated; the old
  pool has zero users; no runtime reference to the old pool — then delete the orphan
  manually as a controlled one-off. (Switching to `DESTROY` for the replacement is
  acceptable only as an explicit, zero-user-verified manual step, never the documented
  default.)
- Grep for any hardcoded pool/client ID. The authorizer reads
  `PUBLIC_POOL_ID`/`PUBLIC_POOL_CLIENT_ID` from env and `post-deploy.ts` writes the
  outputs to renderer env, so new IDs propagate automatically — a hardcoded reference
  would break silently.

### Phase B: NextAuth Integration (login transport)

#### B1. Add CredentialsProvider to the NextAuth route handler

**File:** `renderer/src/app/api/auth/[...nextauth]/route.ts`

Conditionally include both providers. The CredentialsProvider derives the Cognito
username server-side (PD-001) — it never trusts a client-supplied username:

```typescript
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { normalizeEmail } from "@amodx/shared";
import { cognitoUsername, secretHashFor } from "@/lib/server/customer-auth"; // renderer server-only (Node crypto)

const cognito = new CognitoIdentityProviderClient({});

// tenantId is derived from Host inside the dynamic handler, NOT from the client.
const providers = [];

if (config.integrations?.customerAuth?.enableGoogle !== false && config.integrations?.google?.clientId) {
    providers.push(GoogleProvider({ /* ... */ }));
}

if (config.integrations?.customerAuth?.enableEmailPassword) {
    providers.push(CredentialsProvider({
        name: "Email",
        credentials: {
            email: { label: "Email", type: "email" },
            password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
            const email = normalizeEmail(credentials.email);
            const username = cognitoUsername(tenantId, email); // <tenantId>#<sha256hex(email)>, server-derived (PD-001)
            const secretHash = await secretHashFor(username);  // base64(HMAC-SHA256(clientSecret, username + clientId))
            const result = await cognito.send(new InitiateAuthCommand({
                AuthFlow: "USER_PASSWORD_AUTH",
                ClientId: process.env.COGNITO_PUBLIC_CLIENT_ID!,
                AuthParameters: { USERNAME: username, PASSWORD: credentials.password, SECRET_HASH: secretHash },
            }));
            if (!result.AuthenticationResult) return null;
            const payload = JSON.parse(
                Buffer.from(result.AuthenticationResult.IdToken!.split('.')[1], 'base64').toString()
            );
            return { id: payload.sub, email, name: payload.name || email };
        }
    }));
}
```

**Key detail:** `USER_PASSWORD_AUTH` requires `userPassword: true` on the client
(added in A4). Because the client is confidential (A4), every Cognito call also includes a secret hash
from `secretHashFor()`: `InitiateAuth` passes it as `AuthParameters.SECRET_HASH` (shown
above), while `SignUp`/`ConfirmSignUp`/`ForgotPassword`/`ConfirmForgotPassword` (C1–C3)
pass it as the **top-level `SecretHash`** parameter. The customer's password transits the
renderer Lambda over TLS to Cognito; it is never stored.

#### B2. Session callback — unify identity

**File:** `renderer/src/app/api/auth/[...nextauth]/route.ts`

```typescript
callbacks: {
    session({ session, token }) {
        // token.email is set by both Google and Credentials providers
        session.user.email = token.email;
        return session;
    }
}
```

The account page's existing logic (session email → `CUSTOMER#email`) then works
identically for both auth methods. Note: this is the LOGIN session. Reads of
`CUSTOMER#email` data go through the renderer proxy per PD-002 — not directly from a
session-bearing browser call to DynamoDB.

#### B3. Provision `CUSTOMER#` on sign-in (session-derived, PD-002)

**File:** `renderer/src/app/api/auth/[...nextauth]/route.ts`

In the NextAuth **`events.signIn`** (a fire-and-forget side effect — NOT the `signIn`
callback, where returning `false` would deny login), after a session is established for
either provider, the renderer calls the backend RENDERER-key `CUSTOMER#` upsert with the
host-derived tenant + session email. This keeps identity strictly session-derived
(PD-002) rather than Cognito-confirmation-derived — the record is created only once a
real session exists.

- The upsert is **idempotent** and runs on every successful sign-in, so it self-heals a
  missing record (recovery for a confirmed-Cognito-user-without-profile state).
- It is **best-effort**: a failure is logged server-side and retried on the next sign-in;
  it MUST NOT block or fail the login (reads already tolerate a missing `CUSTOMER#` — E4).
- It merges with any existing anonymous-order `CUSTOMER#<email>` record, preserving order
  history (requires identical `normalizeEmail()` — see Email normalization & username
  derivation).
- The renderer never writes DynamoDB directly; the upsert is a backend data route. If the
  commerce-private cutover is complete, that route writes through `commerce-db.ts` (see
  `plan-commerce-private-table.md`).
- Applies to both Google and email/password sign-in.

### Phase C: Sign-Up Flow (renderer API routes calling Cognito)

Per PD-003, credential operations are **renderer → Cognito**, not backend public
endpoints. The renderer owns the host-derived tenant and NextAuth. Cognito `SignUp`,
`ConfirmSignUp`, `ForgotPassword`, `ConfirmForgotPassword`, and `InitiateAuth` are not
IAM-authorized; they are gated by a **confidential app client** (`generateSecret: true`,
A4). Each call includes a secret hash from `secretHashFor()` — passed as
`AuthParameters.SECRET_HASH` for `InitiateAuth`, and as the top-level `SecretHash`
parameter for `SignUp`/`ConfirmSignUp`/`ForgotPassword`/`ConfirmForgotPassword` — so a
browser cannot call Cognito directly; all traffic is forced through the renderer routes. The renderer needs the SDK + client id + client secret; it
needs **no IAM grant for the Cognito calls**, only `secretsmanager:GetSecretValue` to read
the secret.

> Divergence from the earlier draft: this plan no longer creates backend public Lambdas
> for register/confirm/forgot/reset. Those would be new anonymous backend auth
> endpoints, which PD-002/PD-003 explicitly avoid. The only backend touchpoint is the
> RENDERER-key `CUSTOMER#` upsert in B3 (a data route, not an auth endpoint).

Every route derives `username = cognitoUsername(tenantId, normalizeEmail(email))`
server-side (= `<tenantId>#<sha256hex(normalizedEmail)>`); tenant from host, never from
the request body (PD-001 anti-spoof).

**Feature-flag enforcement.** Every renderer auth route (C1–C3) and the
CredentialsProvider sign-in path (B1) MUST reject unless
`config.integrations?.customerAuth?.enableEmailPassword === true` for the host-derived
tenant. In B1 the provider is only constructed when the flag is set; the C1–C3 routes
must check it explicitly (they exist regardless of the flag).

#### C1. Registration — renderer route

**New file:** `renderer/src/app/api/customers/register/route.ts`

- derive tenant from host; validate email + password
- `SignUpCommand` with the derived username; attributes `email` (normalized) +
  `custom:tenant_id`
- return "verification email sent" (Cognito auto-sends via `autoVerify: { email: true }`)

#### C2. Confirm — renderer route

**New file:** `renderer/src/app/api/customers/confirm/route.ts`

- `ConfirmSignUpCommand` with the derived username (renderer → Cognito). That is all this
  route does.
- The `CUSTOMER#` record is NOT created here. Provisioning happens on first successful
  sign-in (B3), so identity stays strictly session-derived (PD-002), not
  Cognito-confirmation-derived. There is no backend call from the confirm route.

#### C3. Forgot / reset — renderer routes

- **New file:** `renderer/src/app/api/customers/forgot-password/route.ts` →
  `ForgotPasswordCommand` (derived username)
- **New file:** `renderer/src/app/api/customers/reset-password/route.ts` →
  `ConfirmForgotPasswordCommand` (derived username)

No flow accepts a client-supplied username.

#### C4. Backend involvement

The only backend touchpoint in the login flow is the RENDERER-key `CUSTOMER#` upsert
triggered on first successful sign-in (B3) — a data route (PD-002), not an anonymous auth
endpoint. No new anonymous backend Lambdas are added by this plan. If a future
requirement forces a backend public auth endpoint, it must be justified against
PD-002/PD-003 explicitly.

### Phase D: Renderer UI

#### D1. Sign-in page

**New file:** `renderer/src/components/SignInPageView.tsx`

Client component with two sections:

- **Google button** (if enabled): calls `signIn("google")`
- **Email/password form** (if enabled): email + password inputs, calls
  `signIn("credentials", { email, password })`
- Link to registration page
- Link to forgot password page

#### D2. Registration page

**New file:** `renderer/src/components/RegisterPageView.tsx`

- Email, password, confirm password inputs
- `POST /api/customers/register` (renderer route) on submit
- Success: show "check your email for verification code" + code input
- `POST /api/customers/confirm` (renderer route) with code
- On success: auto-sign-in via `signIn("credentials", { email, password })`

#### D3. Forgot password page

**New file:** `renderer/src/components/ForgotPasswordView.tsx`

Two-step form:

1. Enter email → `POST /api/customers/forgot-password` (renderer route)
2. Enter code + new password → `POST /api/customers/reset-password` (renderer route)

#### D4. Route handling

**File:** `renderer/src/app/[siteId]/[[...slug]]/page.tsx` + `matchCommercePrefix`

Add URL prefix types: `signin`, `register`, `forgot-password`. Add defaults to
`URL_PREFIX_DEFAULTS`:

```typescript
signin: "/signin",
register: "/register",
forgotPassword: "/forgot-password",
```

#### D5. Navbar sign-in link

**File:** `renderer/src/components/Navbar.tsx`

Currently shows "Sign In" linking to `/api/auth/signin` (NextAuth's default). When
email/password is enabled, link to the custom sign-in page instead (which shows both
options).

#### D6. Admin Settings

**File:** `admin/src/pages/Settings.tsx`

Add a "Customer Authentication" card — **independent of `commerceEnabled`** (customer
auth is a platform capability needed by appointments on non-commerce tenants; the
`customerAuth` config flag is standalone) — with toggles for:

- Enable Google sign-in (default: on)
- Enable email/password sign-in (default: off)

### Phase E: Edge Cases & Security

#### E1. Rate limiting on auth endpoints

The registration and sign-in routes are public attack surfaces. They are **renderer**
API routes (behind CloudFront/OpenNext), not API Gateway, so throttling is applied at
the CloudFront/WAF layer and/or in the renderer route handler — not via API Gateway
throttling. Layer the defenses: Cognito's built-in throttling, renderer-route/WAF rate
limiting, reCAPTCHA on register/forgot, and generic (non-enumerating) error messages
(reinforced by `preventUserExistenceErrors` from A4).

#### E2. Tenant-local email behavior (PD-001)

Within a tenant, the `<tenantId>#<sha256hex(email)>` username is unique, so a customer
cannot create two accounts with the same email on one site. Across tenants, the same human
using the same email gets **independent** Cognito users and **independent**
`CUSTOMER#email` records — this is intended (PD-001), not a conflict to resolve.

If a customer signs in with Google on one tenant and email/password on another,
NextAuth sees the same `email` claim, but the `CUSTOMER#email` records are still
per-tenant. Google identity is not federated into Cognito; the two mechanisms only
share the session-level email.

#### E3. Cognito email template customization

The public pool's verification and password-reset emails currently use Cognito
defaults. Add custom branded templates in CDK (folded into the A4 replacement):

```typescript
userVerification: {
    emailSubject: 'Verify your email',
    emailBody: '... branded template with {####} code ...',
    emailStyle: cognito.VerificationEmailStyle.CODE,
}
```

#### E4. CUSTOMER# record provisioning and recovery

The `CUSTOMER#<normalizeEmail(email)>` record is provisioned on first successful sign-in
(B3), not at confirm — keeping identity session-derived (PD-002). The upsert is
idempotent and merges with any pre-existing anonymous-order record, preserving order
history. This only works if checkout and B3 normalize email identically (see Email
normalization & username derivation).

**Recovery:** if a Cognito user is confirmed but the `CUSTOMER#` upsert has never
succeeded (e.g. a backend error on first sign-in), the user still has a valid login.
Because the upsert reruns idempotently on every sign-in, the record self-heals on the
next successful sign-in. Profile/account reads MUST tolerate a missing `CUSTOMER#` record
and fall back to a minimal session-derived profile.

#### E5. Account-enumeration hardening

`preventUserExistenceErrors` (A4) covers the auth flows, but `SignUpCommand` can still
surface existing-user conditions (e.g. `UsernameExistsException`). The renderer
register/forgot/reset routes MUST normalize outward responses to a generic success shape
where possible; detailed Cognito errors are logged server-side only, never returned to
the browser.

## Email normalization & username derivation

**Helper placement (architecture fork resolved — Option B for Phase 1):**

- `normalizeEmail(input: string): string` → `input.trim().toLowerCase()` lives in
  `@amodx/shared`. It is a pure string op, safe for every consumer (backend, renderer,
  admin, plugins, MCP).
- `cognitoUsername(tenantId, normalizedEmail): string` →
  `` `${tenantId}#${sha256hex(normalizedEmail)}` `` lives in a **renderer server-only**
  lib (`renderer/src/lib/server/customer-auth.ts`) and uses Node `crypto`. It is the
  single source of username derivation for all Phase-1 callers (sign-in B1, register /
  confirm / reset C1–C3 — all renderer server-side), so they cannot drift, and it is
  length-safe (≤128, the Cognito `SignUp.Username` limit).
- `secretHashFor(username): string` (same renderer server-only lib) →
  `base64(HMAC-SHA256(clientSecret, username + clientId))`, required because the A4 app
  client is confidential. Passed as `AuthParameters.SECRET_HASH` for `InitiateAuth` and as
  top-level `SecretHash` for the sign-up/confirmation/password flows. Co-locating it with
  `cognitoUsername()` keeps all server-only Cognito derivations in one place.

Rationale: `@amodx/shared` is imported by browser bundles (admin, plugin admin entry).
Putting Node `crypto` in the shared index risks breaking or polluting those builds.
Phase 1 needs username derivation only on the renderer server, so the server-only home
is safe. If a future backend direct-JWT path (PD-003) needs it, promote a build-verified
portable helper to shared then, or duplicate with test-parity.

`normalizeEmail` is the single normalization function. It MUST be used by:

- checkout (`CUSTOMER#email` write at order time)
- register / confirm / sign-in / forgot / reset handlers
- Cognito username construction via `cognitoUsername` (`<tenantId>#<sha256hex(normalizeEmail(email))>`)
- any future customer profile or appointment write keyed by email

**Verified state:** checkout (`backend/src/orders/create.ts`) currently does
`customerEmail.toLowerCase()` — no `.trim()`, no shared util. Before auth implementation,
replace inline lowercasing with `normalizeEmail()` everywhere a customer-email key is
built, or anonymous-order → registered-account linking forks into duplicate
`CUSTOMER#email` records.

## File Summary

| File | Change | Phase |
|------|--------|-------|
| `infra/lib/renderer-hosting.ts` | Pass `COGNITO_PUBLIC_*` env + client-secret ARN to renderer; grant `secretsmanager:GetSecretValue` | A1 |
| `packages/shared/src/index.ts` | Add `customerAuth` to IntegrationsSchema | A2 |
| `packages/shared/src/index.ts` | Add `normalizeEmail` (portable, pure) | A3 |
| `renderer/src/lib/server/customer-auth.ts` | **NEW** — server-only `cognitoUsername()` + `secretHashFor()` (Node `crypto`) | A3, A4 |
| `infra/lib/auth.ts` | **Pool replacement**: `signInAliases: { username: true }`, `userPassword: true`, `preventUserExistenceErrors: true`, `generateSecret: true` (confidential client), branded email templates; keep `RETAIN`, manually delete the orphaned dormant pool after zero-user verification | A4, E3 |
| `renderer/src/app/api/auth/[...nextauth]/route.ts` | CredentialsProvider (server-derived username) + session callback + first-sign-in `CUSTOMER#` upsert | B1–B3 |
| `renderer/src/app/api/customers/register/route.ts` | **NEW** — renderer route → Cognito SignUp | C1 |
| `renderer/src/app/api/customers/confirm/route.ts` | **NEW** — renderer route → Cognito ConfirmSignUp (no backend call) | C2 |
| `renderer/src/app/api/customers/forgot-password/route.ts` | **NEW** — renderer route → Cognito ForgotPassword | C3 |
| `renderer/src/app/api/customers/reset-password/route.ts` | **NEW** — renderer route → Cognito ConfirmForgotPassword | C3 |
| `renderer/package.json` | Add `@aws-sdk/client-cognito-identity-provider` (run vuln audit) | C1–C3 |
| backend customer-data upsert route | PD-002 renderer-key `CUSTOMER#` upsert; idempotent; triggered on first sign-in (B3) | B3 |
| `renderer/src/components/SignInPageView.tsx` | **NEW** — dual sign-in page | D1 |
| `renderer/src/components/RegisterPageView.tsx` | **NEW** — registration + verification | D2 |
| `renderer/src/components/ForgotPasswordView.tsx` | **NEW** — password reset flow | D3 |
| `renderer/src/app/[siteId]/[[...slug]]/page.tsx` | Route handling for auth pages | D4 |
| `packages/shared/src/index.ts` | URL prefix defaults for auth pages | D4 |
| `renderer/src/components/Navbar.tsx` | Custom sign-in link | D5 |
| `admin/src/pages/Settings.tsx` | Customer auth toggles | D6 |

## Dependencies

- Cognito public pool exists but **must be replaced** (A4) before use — not a no-op.
- NextAuth already installed in renderer.
- `CUSTOMER#email` DynamoDB pattern already handles identity linking (tenant-scoped).
- `normalizeEmail` in `@amodx/shared` (portable, pure); `cognitoUsername` in a renderer
  server-only lib (Node `crypto`) — NOT in shared, which browser bundles (admin/plugins)
  import. Checkout currently lowercases inline (`customerEmail.toLowerCase()`, no
  `.trim()`, no shared util) and MUST be migrated to `normalizeEmail()` before this work.
- `@aws-sdk/client-cognito-identity-provider` added to `renderer/package.json` (not
  currently present). Installing triggers the repo rule: audit vulnerabilities and
  explain high-priority findings. The Cognito calls are gated by a confidential client +
  `SECRET_HASH`, not IAM — so no IAM grant for Cognito, but the renderer Lambda needs
  `secretsmanager:GetSecretValue` on the client-secret secret.
- `TenantMemberSchema` exists but is not required for initial implementation.
- Platform decisions PD-001/002/003 (`docs/platform-decisions.md`) must remain authoritative.

## Estimated Effort

- Phase A (infra, incl. pool replacement coordination): 1 day
- Phase B (NextAuth): 0.5 day
- Phase C (sign-up/verify/reset): 1 day
- Phase D (UI): 1-2 days
- Phase E (hardening): 0.5 day
- **Total: 4-5 days**

## Open Items (resolve during implementation)

- Username length: bounded by the hashed scheme at `len(tenantId) + 65`. **Invariant:
  tenant IDs used with customer auth MUST be ≤ 63 chars** (total ≤ 128, the Cognito
  `SignUp.Username` max). Tenant ids are not currently length-bounded (`id: z.string()`,
  slug-or-supplied in `backend/src/tenant/create.ts`). Enforce ≤ 63 in
  `TenantConfigSchema` / tenant creation, or guard in the username helper + the
  customer-auth enable path so over-length tenants cannot enable email/password auth.
- Client-secret storage: Secrets Manager (recommended — matches the authorizer key
  pattern) vs an encrypted Lambda env var. Either works; never `NEXT_PUBLIC_*`, never a
  CFN output. Decide at implementation.
- Username charset: CLOSED. Cognito allows Unicode punctuation; `#` and hex are fine.
- Shared import specifier: RESOLVED → `@amodx/shared` (per `packages/shared/package.json`).
- SHA-256 hex helper: `cognitoUsername()` lives in a renderer server-only lib using Node
  `crypto` — NOT in `@amodx/shared` (browser bundles import shared). All Phase-1 callers
  (B1, C1–C3) are renderer server-side, so one helper keeps them identical. A future
  backend direct-JWT path (PD-003) must reuse a build-verified portable helper or
  duplicate with test-parity.
- Checkout normalization: VERIFIED — `backend/src/orders/create.ts` uses
  `customerEmail.toLowerCase()` (no `.trim()`, no shared util). Migrate to
  `normalizeEmail()` everywhere a customer-email key is built, before auth ships.
