# Plan: Email/Password Customer Auth via Public Cognito Pool

## Problem

Customer authentication currently only supports Google OAuth via NextAuth. Tenants who want email/password registration for their customers have no option. The `AmodxPublicPool` Cognito user pool is already provisioned in CDK (`infra/lib/auth.ts`) with `selfSignUpEnabled: true` but is completely unwired — no code references it at runtime.

## Goal

Allow site visitors to register and sign in with email/password in addition to Google OAuth. Both methods must coexist, and both must link to the same `CUSTOMER#email` DynamoDB records for order history.

## Current State

| Component | Status |
|-----------|--------|
| `AmodxPublicPool` (Cognito) | Provisioned, dormant. `selfSignUpEnabled: true`, `custom:tenant_id` attribute. |
| `AmodxPublicClient` (Cognito app client) | Created, never used. |
| CloudFormation outputs | `PublicPoolId`, `PublicClientId` exported. |
| `scripts/post-deploy.ts` | Writes `NEXT_PUBLIC_USER_POOL_ID` + `NEXT_PUBLIC_USER_POOL_CLIENT_ID` to renderer `.env.local` — but renderer never imports them. |
| NextAuth Google OAuth | Active. Per-tenant Google credentials in `TenantConfig.integrations.google`. |
| `CUSTOMER#email` records | Created on order placement. Used by account page. |
| `TenantMemberSchema` | Defined in shared with `id` (Cognito SUB) + `role` (Member/Subscriber/VIP). Never used. |

## Architecture Decision

**Use the Cognito public pool as a NextAuth `CredentialsProvider`**, not as a standalone Amplify auth. This keeps one unified session mechanism (NextAuth cookies) regardless of whether the user signed up with Google or email/password.

**Why not Amplify in the renderer?** Adding Amplify alongside NextAuth creates two competing session systems. NextAuth already handles multi-provider gracefully — adding a `CredentialsProvider` that validates against Cognito under the hood is cleaner.

**Alternative considered:** Use Cognito Hosted UI as a NextAuth `CognitoProvider`. Rejected because Cognito Hosted UI can't be themed per-tenant and the URL (`xxx.auth.region.amazoncognito.com`) looks unprofessional.

## Implementation Plan

### Phase A: Infrastructure (CDK + Backend)

#### A1. Pass public pool env vars to renderer Lambda

**File:** `infra/lib/renderer-hosting.ts`

Currently the renderer Lambda only gets `NEXTAUTH_SECRET` and `NEXTAUTH_URL`. Add:
```
COGNITO_PUBLIC_POOL_ID: auth.publicPool.userPoolId
COGNITO_PUBLIC_CLIENT_ID: auth.publicClient.userPoolClientId
```

These are needed by the NextAuth CredentialsProvider to call Cognito `InitiateAuth`.

#### A2. Per-tenant toggle for email/password auth

**File:** `packages/shared/src/index.ts` → `IntegrationsSchema`

Add to the integrations schema:
```typescript
customerAuth: z.object({
    enableEmailPassword: z.boolean().default(false),
    enableGoogle: z.boolean().default(true),
}).default({ enableEmailPassword: false, enableGoogle: true }),
```

Tenants opt-in to email/password via admin Settings. Google remains default-on.

#### A3. Cognito multi-tenancy via `custom:tenant_id`

The public pool already has `custom:tenant_id` as a custom attribute. On sign-up, the tenant ID is written to this attribute. On sign-in, the authorizer/session callback reads it to scope the user.

**Important constraint:** Cognito user pools don't enforce uniqueness per custom attribute — the same email can only exist once across all tenants in the pool. This is fine because email is the primary identifier and we want cross-tenant identity: if a user shops on two different tenant sites, they use the same Cognito account but see different `CUSTOMER#email` records per tenant.

### Phase B: NextAuth Integration

#### B1. Add CredentialsProvider to the NextAuth route handler

**File:** `renderer/src/app/api/auth/[...nextauth]/route.ts`

Currently creates only `GoogleProvider`. Change to conditionally include both:

```typescript
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});

// Inside the dynamic handler:
const providers = [];

if (config.integrations?.customerAuth?.enableGoogle !== false && config.integrations?.google?.clientId) {
    providers.push(GoogleProvider({ ... }));
}

if (config.integrations?.customerAuth?.enableEmailPassword) {
    providers.push(CredentialsProvider({
        name: "Email",
        credentials: {
            email: { label: "Email", type: "email" },
            password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
            const result = await cognito.send(new InitiateAuthCommand({
                AuthFlow: "USER_PASSWORD_AUTH",
                ClientId: process.env.COGNITO_PUBLIC_CLIENT_ID!,
                AuthParameters: {
                    USERNAME: credentials.email,
                    PASSWORD: credentials.password,
                },
            }));
            if (!result.AuthenticationResult) return null;
            // Decode id token to get email + sub
            const payload = JSON.parse(
                Buffer.from(result.AuthenticationResult.IdToken!.split('.')[1], 'base64').toString()
            );
            return { id: payload.sub, email: payload.email, name: payload.name || payload.email };
        }
    }));
}
```

**Key detail:** `USER_PASSWORD_AUTH` requires the Cognito app client to have it enabled. The current `AmodxPublicClient` has `USER_SRP_AUTH` + `CUSTOM_AUTH`. Need to add `USER_PASSWORD_AUTH` (or use SRP — but SRP is complex client-side and unnecessary since we're server-side in a Lambda).

#### B2. Update Cognito client auth flows in CDK

**File:** `infra/lib/auth.ts`

Add `ALLOW_USER_PASSWORD_AUTH` to the public client:
```typescript
this.publicClient = this.publicPool.addClient('AmodxPublicClient', {
    authFlows: {
        userSrp: true,
        custom: true,
        userPassword: true,  // <-- ADD THIS
    },
});
```

#### B3. Session callback — unify identity

**File:** `renderer/src/app/api/auth/[...nextauth]/route.ts`

In the NextAuth `callbacks.session`, ensure the session always has `email` regardless of provider:
```typescript
callbacks: {
    session({ session, token }) {
        // token.email is set by both Google and Credentials providers
        session.user.email = token.email;
        return session;
    }
}
```

This means the account page's existing logic (decode cookie → get email → query `CUSTOMER#email`) works identically for both auth methods.

### Phase C: Sign-Up Flow

#### C1. Registration API endpoint

**New file:** `backend/src/customers/register.ts`

Public endpoint `POST /public/customers/register`:
```typescript
// 1. Validate email + password
// 2. cognito.send(new SignUpCommand({
//        ClientId: PUBLIC_CLIENT_ID,
//        Username: email,
//        Password: password,
//        UserAttributes: [
//            { Name: "email", Value: email },
//            { Name: "custom:tenant_id", Value: tenantId },
//        ],
//    }))
// 3. Return { message: "Verification email sent" }
```

Cognito sends the verification email automatically (pool has `autoVerify: { email: true }` + the default verification template).

#### C2. Email verification confirmation

**New file:** `backend/src/customers/confirm.ts`

Public endpoint `POST /public/customers/confirm`:
```typescript
// 1. cognito.send(new ConfirmSignUpCommand({
//        ClientId: PUBLIC_CLIENT_ID,
//        Username: email,
//        ConfirmationCode: code,
//    }))
// 2. Upsert CUSTOMER#email record in DynamoDB (same as checkout does)
// 3. Return { message: "Email verified, you can now sign in" }
```

#### C3. Forgot password flow

Two endpoints:
- `POST /public/customers/forgot-password` → `ForgotPasswordCommand`
- `POST /public/customers/reset-password` → `ConfirmForgotPasswordCommand`

#### C4. CDK registration

**File:** `infra/lib/api-commerce.ts` (or new `api-customer-auth.ts` NestedStack if resource count is a concern)

Register 4 new public Lambdas:
- `POST /public/customers/register`
- `POST /public/customers/confirm`
- `POST /public/customers/forgot-password`
- `POST /public/customers/reset-password`

All need `COGNITO_PUBLIC_POOL_ID` + `COGNITO_PUBLIC_CLIENT_ID` env vars and IAM permissions for the relevant Cognito actions.

### Phase D: Renderer UI

#### D1. Sign-in page

**New file:** `renderer/src/components/SignInPageView.tsx`

Client component with two sections:
- **Google button** (if enabled): calls `signIn("google")`
- **Email/password form** (if enabled): email + password inputs, calls `signIn("credentials", { email, password })`
- Link to registration page
- Link to forgot password page

#### D2. Registration page

**New file:** `renderer/src/components/RegisterPageView.tsx`

Client component:
- Email, password, confirm password inputs
- `POST /public/customers/register` on submit
- Success: show "check your email for verification code" + code input
- `POST /public/customers/confirm` with code
- On success: auto-sign-in via `signIn("credentials", { email, password })`

#### D3. Forgot password page

**New file:** `renderer/src/components/ForgotPasswordView.tsx`

Two-step form:
1. Enter email → `POST /public/customers/forgot-password`
2. Enter code + new password → `POST /public/customers/reset-password`

#### D4. Route handling

**File:** `renderer/src/app/[siteId]/[[...slug]]/page.tsx` + `matchCommercePrefix`

Add URL prefix types: `signin`, `register`, `forgot-password`. Add defaults to `URL_PREFIX_DEFAULTS`:
```typescript
signin: "/signin",
register: "/register",
forgotPassword: "/forgot-password",
```

#### D5. Navbar sign-in link

**File:** `renderer/src/components/Navbar.tsx`

Currently shows "Sign In" linking to `/api/auth/signin` (NextAuth's default). When email/password is enabled, link to the custom sign-in page instead (which shows both options).

#### D6. Admin Settings

**File:** `admin/src/pages/Settings.tsx`

Add a "Customer Authentication" card (gated by `commerceEnabled`) with toggles for:
- Enable Google sign-in (default: on)
- Enable email/password sign-in (default: off)

### Phase E: Edge Cases & Security

#### E1. Rate limiting on auth endpoints
The registration and sign-in endpoints should be rate-limited to prevent brute force. Cognito has built-in throttling, but consider adding API Gateway throttling on the public routes.

#### E2. Email uniqueness across providers
If a customer registers with email/password as `jane@example.com` and later tries to sign in with Google using the same email, NextAuth will see the same `email` in both sessions. The DynamoDB `CUSTOMER#email` record is shared — this is the desired behavior. However, the Cognito pool will have a separate user record from the Google identity. This is fine because we only use Cognito for credential verification, not as the source of truth for customer identity.

#### E3. Cognito email template customization
The public pool's verification and password-reset emails currently use Cognito defaults (like the admin invite email issue we fixed). Add custom templates in CDK:
```typescript
userVerification: {
    emailSubject: 'Verify your email',
    emailBody: '... branded template with {####} code ...',
    emailStyle: cognito.VerificationEmailStyle.CODE,
}
```

#### E4. CUSTOMER# record reconciliation
When a user registers via Cognito and verifies their email, the confirm handler upserts a `CUSTOMER#email` record. If they previously placed an anonymous order, that record already exists — the upsert merges, preserving order history.

## File Summary

| File | Change | Phase |
|------|--------|-------|
| `infra/lib/renderer-hosting.ts` | Pass public pool env vars to renderer | A1 |
| `packages/shared/src/index.ts` | Add `customerAuth` to IntegrationsSchema | A2 |
| `infra/lib/auth.ts` | Add `userPassword: true` to public client auth flows | B2 |
| `renderer/src/app/api/auth/[...nextauth]/route.ts` | Add CredentialsProvider alongside Google | B1, B3 |
| `backend/src/customers/register.ts` | **NEW** — sign-up endpoint | C1 |
| `backend/src/customers/confirm.ts` | **NEW** — email verification | C2 |
| `backend/src/customers/forgot-password.ts` | **NEW** — forgot password | C3 |
| `backend/src/customers/reset-password.ts` | **NEW** — reset password | C3 |
| `infra/lib/api-commerce.ts` | Register 4 new public Lambdas | C4 |
| `renderer/src/components/SignInPageView.tsx` | **NEW** — dual sign-in page | D1 |
| `renderer/src/components/RegisterPageView.tsx` | **NEW** — registration + verification | D2 |
| `renderer/src/components/ForgotPasswordView.tsx` | **NEW** — password reset flow | D3 |
| `renderer/src/app/[siteId]/[[...slug]]/page.tsx` | Route handling for auth pages | D4 |
| `packages/shared/src/index.ts` | URL prefix defaults for auth pages | D4 |
| `renderer/src/components/Navbar.tsx` | Custom sign-in link | D5 |
| `admin/src/pages/Settings.tsx` | Customer auth toggles | D6 |
| `infra/lib/auth.ts` | Custom verification email templates | E3 |

## Dependencies

- Cognito public pool already exists — no migration needed
- NextAuth already installed in renderer
- `CUSTOMER#email` DynamoDB pattern already handles identity linking
- `TenantMemberSchema` exists but may need updating (currently has roles: Member/Subscriber/VIP — may not be needed for initial implementation)

## Estimated Effort

- Phase A (infra): 0.5 day
- Phase B (NextAuth): 0.5 day
- Phase C (sign-up/verify/reset): 1 day
- Phase D (UI): 1-2 days
- Phase E (hardening): 0.5 day
- **Total: 3-5 days**
