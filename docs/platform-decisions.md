# Platform Decisions

This file is the single source of truth for cross-cutting platform decisions that
span more than one plan or module. Individual plan docs (`docs/plan-*.md`) MUST
reference the relevant decision here rather than restating it, to prevent drift.

Each decision has a stable ID (`PD-NNN`) and a status. Once `Accepted`, a decision
is binding on all future work until explicitly superseded by a later PD.

| ID | Title | Status |
|----|-------|--------|
| PD-001 | Tenant-local public customer identity | Accepted |
| PD-002 | Renderer-proxy default for customer data actions | Accepted |
| PD-003 | Public Cognito pool is a login substrate, not the Phase-1 backend authorization transport | Accepted |

---

## PD-001 — Tenant-local public customer identity

- Status: Accepted
- Date: 2026-05-31
- Affects: customer auth, commerce, appointments, any future customer-facing route

Customer identities are **tenant-local**. The same email address may create
separate, unrelated customer accounts on separate tenant websites. There is no
shared cross-tenant customer identity.

### Rationale

AMODX tenants are independent businesses (a dentist, a jeweler, a lawyer). A
customer of tenant A has no relationship to tenant B. A shared global identity
would let one tenant enumerate that an email exists in the pool — a privacy leak —
and would not prove membership in a second tenant.

### Canonical customer identity key

```
tenantId + normalizedEmail
```

This already matches the existing DynamoDB record shape:

```
PK = TENANT#<tenantId>
SK = CUSTOMER#<email>
```

### Cognito public-pool username

```
<tenantId>#<sha256hex(normalizedEmail)>
```

The email is hashed for length-safety and determinism, not secrecy. Cognito's
`SignUp.Username` max is 128 chars; `<tenantId>` + `#` + a 64-hex-char SHA-256 stays
under that as long as the tenant id is `<= 63` chars (see invariant below); a 36-char
UUID → 36 + 1 + 64 = 101. The hash is reconstructable server-side from the normalized
email, so every flow derives the username without storing it. The plaintext email
remains in the Cognito `email` attribute for verification/reset delivery. Derivation
lives in one canonical helper per active implementation: in Phase 1 it is renderer
server-only (`renderer/src/lib/server/customer-auth.ts`, Node `crypto`), NOT a
shared-package export. A future backend direct-JWT path must reuse a build-verified
portable helper or maintain test-parity with the renderer helper.

### Invariants

- The Cognito username is ALWAYS derived server-side from the host-derived tenant
  and the normalized email. It is NEVER accepted from browser input. This is the
  anti-spoof boundary: a client cannot target another tenant's account namespace.
- `email` is a Cognito user attribute, NOT a pool-wide sign-in alias. Email-as-alias
  enforces pool-global email uniqueness, which contradicts tenant-local identity.
- Email normalization is `lowercase + trim`, implemented once as a shared utility in
  `packages/shared`, and used identically by checkout, auth (register / confirm /
  sign-in / forgot / reset), customer profile, and appointments. Divergent
  normalization silently forks `CUSTOMER#email` records.
- Within a tenant, `<tenantId>#<sha256hex(email)>` is unique (deterministic hash of the
  normalized email), so Cognito enforces one account per (tenant, email). Across tenants
  the tenant prefix differs, so the same email yields independent accounts.
- The Cognito username MUST be `<= 128` characters (Cognito `SignUp.Username` limit).
  The hashed scheme bounds it at `len(tenantId) + 65`, so **tenant IDs used with customer
  auth MUST be `<= 63` characters**. Tenant ids are not currently length-bounded
  (`id: z.string()`, slug-or-supplied). Enforce `<= 63` in `TenantConfigSchema` / tenant
  creation, or guard in the username helper + the customer-auth enable path so an
  over-length tenant cannot enable email/password auth.

---

## PD-002 — Renderer-proxy default for customer data actions

- Status: Accepted
- Date: 2026-05-31
- Affects: commerce account/profile/order self-service, appointments (Phase 1)

Customer browser data actions use the **renderer proxy** by default.

### Flow

```
Browser
  -> Renderer validates the NextAuth session
  -> Renderer derives tenant from Host
  -> Backend receives RENDERER key + session-derived customer identity (email/sub)
  -> Backend performs a tenant-scoped private-table operation
```

### Invariants

- Backend customer self-service routes accept the `RENDERER` role in Phase 1. They
  do NOT accept `anonymous` or `CUSTOMER` directly.
- The browser never supplies `tenantId` or customer email as an authority. Tenant is
  host-derived by the renderer; email is session-derived by the renderer. The backend
  trusts these because they arrive over a RENDERER-key-authenticated call, not from
  the browser. This is a two-hop trust chain (browser→renderer, then
  renderer→backend) and must stay that way — do not "optimize" by letting the browser
  pass identity straight to the backend.

### Trust cost (accepted)

A compromised renderer can call renderer-only customer endpoints and assert an
identity. This is the same trust boundary already in place for current account/profile
reads. The mitigation is to keep renderer routes narrow (self-service only) and to
move private data out of renderer IAM reach (see `plan-commerce-private-table.md`),
not to pretend the renderer is untrusted.

### Applies to

- commerce account / profile / order self-service
- appointment booking / list / cancel in Phase 1

Direct Public Cognito JWT verification is reserved for future high-sensitivity flows
(money movement, stored payment instruments, identity documents, irreversible PII
export/delete). See PD-003.

---

## PD-003 — Public Cognito pool is a login substrate, not the Phase-1 backend authorization transport

- Status: Accepted
- Date: 2026-05-31
- Affects: customer auth, appointments, backend authorizer

Email/password login uses Cognito through the renderer's NextAuth
`CredentialsProvider`. That is the only Phase-1 role of the Public Cognito pool.

Customer **data** authorization in Phase 1 uses the renderer proxy (PD-002), NOT
browser-held Cognito bearer tokens.

### Invariants

- The backend authorizer's `CUSTOMER` branch (verifies Public-pool JWTs, returns role
  `CUSTOMER`) remains in place but DORMANT in Phase 1 — no customer JWT reaches the
  backend under the renderer-proxy model.
- `custom:tenant_id` continues to be populated at sign-up so a future direct-JWT path
  can derive tenant from either `custom:tenant_id` or `cognito:username`.
- Do not delete the `CUSTOMER` authorizer branch.
- Phase-1 Cognito calls use a **confidential app client** (`generateSecret: true`); the
  renderer sends `SECRET_HASH` server-side so browsers cannot call Cognito directly. A
  public (secretless) client is added only if a future direct browser JWT path is built.

### Login vs data (do not conflate)

- Login transport: renderer's NextAuth `CredentialsProvider` calls Cognito
  `InitiateAuth`. This is how a credential becomes a session.
- Data transport: renderer proxy calls the backend with the RENDERER key (PD-002).
  This is how an authenticated session reads/writes tenant data.
