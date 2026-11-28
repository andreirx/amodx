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
- Email normalization is `NFKC → trim → lowercase` *(amended 2026-07-28: NFKC human-ratified
  — trigger: next-auth homoglyph-bypass CVE, closed while zero keys are persisted; the
  NFKC-before-trim order operator-ratified under the slice's idempotence requirement — the
  reverse order is non-idempotent for 50 code points whose compatibility decomposition
  begins with a space, EXECUTED sweep in fnd-1 § Ordering deviation; confusable detection
  explicitly REJECTED at the key layer)*, implemented once as `normalizeEmail()` in
  `packages/shared` (`src/normalizeEmail.ts`), and it MUST be used identically by checkout,
  auth (register / confirm / sign-in / forgot / reset), customer profile, and appointments.
  Divergent normalization silently forks `CUSTOMER#email` records.
  **Any email-format validation runs on the NORMALIZED form, never on raw input** — the two
  verdicts differ (a fullwidth `＠` address fails `z.string().email()` raw and passes after
  NFKC), so validating raw and persisting normalized would store a value never validated in
  the form it was stored in.
  *Conformance status — this paragraph states the rule, not the estate* (`OBSERVED` 2026-07-28,
  `git grep -n normalizeEmail -- '*.ts' '*.tsx'`): **nothing conforms yet.** `fnd-1` shipped the
  primitive and migrated **zero** call sites by design, so the one tracked reference today is
  the shared package's own export line; every live email key is still built by an inline
  `.toLowerCase()` or by no normalization at all, and no call site validates after normalizing.
  Conforming the call sites is `fnd-2` — 14 lines across 7 files, enumerated in
  `docs/shipped/slices/fnd-1-normalize-email.md` § *Call-site inventory* — and it is a key migration
  (expand-before-contract), not a find-and-replace.
- Within a tenant, `<tenantId>#<sha256hex(email)>` is unique (deterministic hash of the
  normalized email), so Cognito enforces one account per (tenant, email). Across tenants
  the tenant prefix differs, so the same email yields independent accounts.
- The Cognito username MUST be `<= 128` characters (Cognito `SignUp.Username` limit).
  The hashed scheme bounds it at `len(tenantId) + 65`, so **tenant IDs used with customer
  auth MUST be `<= 63` characters**. Tenant ids are not currently length-bounded
  (`id: z.string()`, slug-or-supplied). Enforce `<= 63` in `TenantConfigSchema` / tenant
  creation, or guard in the username helper + the customer-auth enable path so an
  over-length tenant cannot enable email/password auth.

### Amendment record — normalization rule (RATIFIED 2026-07-28)

The bullet above IS the ratified rule. History: NFKC substance human-ratified 2026-07-28;
the intended file edit was missed in commit `bb7e1d2` (changed only the fnd-1 slice doc —
caught by the fnd-1 build's `git show --stat` verification); the NFKC-before-trim order
was surfaced by the fnd-1 builder's idempotence sweep and operator-ratified same day.
Blast radius note stands: `normalizeEmail()` output is a DynamoDB sort key and the Cognito
username hash pre-image — changing it after `fnd-2` migrates call sites is a key migration
across every tenant, not a code change.

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

### Booking-token variant (amendment 2026-11-21, SCHED-1)

Ratified by the human on 2026-11-21 (SCHED-PD-AMENDMENT = accept; text of `docs/slices/sched-1.md` § 16.3).

For scheduling the customer has no session. The chain stays two hops: the browser talks only to the renderer; the
renderer calls the backend with the `RENDERER` key. The tenant is derived from the URL the renderer serves — the
host for a tenant with a domain, the `/_site/<tenantId>` path on a preview host for a tenant without one — never
from the request body or a browser-set header. Four access classes, and nothing else:

1. **Public derived reads** (offer, free times, runs): no token; they return no customer data.
2. **The initial hold**: no token; verified by reCAPTCHA and limited per email (and per client address when
   built); it creates a held booking and mails its first link.
3. **Token-authorized booking actions** (view, confirm, cancel, move): the renderer forwards a link token the
   browser received by mail; the backend accepts it only as the lookup `TENANT#<tenantId>` +
   `TOKEN#<sha256(token)>`, which reaches exactly one booking of that tenant.
4. **Calendar feed**: a per-resource secret in the feed URL, compared by hash; it returns the resource's schedule
   without customer names, emails or phones.

Choosing a tenant by URL grants nothing private: private data needs a token issued under that tenant. No backend
route becomes anonymous; the `CUSTOMER` branch stays dormant (PD-003).

### Order-page lookup exception (amendment 2026-11-28, CMRC-1L)

Operator ruling of 2026-11-28 under the human's standing rule of 2026-11-27; not yet confirmed by the human; the human may overrule.

This is an **exception** to the invariant "the browser never supplies … customer email as an authority". It is not
a variant that conforms, and no document may claim PD-002 conformance for this read. Decision record:
`docs/slices/cmrc-1.md` § 8 CMRC-ORDER-LOOKUP-AUTHORITY (answer A) and its Appendix R; build record
`docs/slices/cmrc-1l.md`.

**Why it exists.** A buyer needs no account. After checkout the browser opens the order confirmation page with the
order id and the email in the page address; the order tracking page works the same way. Before CMRC-1L the renderer
read the order from the main table itself and showed it when the stored email equalled the given one. CMRC-1L keeps
that proof and moves the read behind the backend, so that the order can leave the table the renderer can read.

**What is excepted — one read, and nothing else:**

- A **read-only order view**, authorized by **possession of the order id and an email equal to the stored normalized
  email** (`stored customerEmail === normalizeEmail(email)`; only the request side is normalized).
- Through the **renderer**, with the **`RENDERER` key**: route `POST /customer/order-lookup`. The backend refuses
  every other role (except `GLOBAL_ADMIN`, which `requireRole` always admits). The browser cannot call the route.
  The tenant is host-derived by the renderer, as everywhere in PD-002.
- The answer holds **17 fields** of the order and no other: `id`, `orderNumber`, `createdAt`, `currency`,
  `customerName`, `customerPhone`, `discount`, `estimatedDeliveryDate`, `items`, `paymentMethod`, `shippingAddress`,
  `shippingCost`, `status`, `statusHistory`, `subtotal`, `total`, `trackingNumber` (`ORDER_VIEW_FIELDS` in
  `packages/shared/src/orders-and-customers.ts`). A field added to that list is a change of this exception.
- "No such order", "an order of another tenant" and "the email is not equal" get one answer (404 `notFound`).

**What is NOT excepted:**

- Any write.
- Any other read: the account order history and the profile keep the session rule (the email of the validated
  NextAuth session).
- The anonymous `GET /public/orders/{id}?email=`. It uses the same possession proof, with no renderer and no key,
  and it answers more than the 17 fields. It is not covered by this text; it is judged in `cmrc-5`
  (finding F-CMRC1-PUBLIC-ORDER-GET).

**Residual risk, in plain words.** Whoever holds the link sees the buyer's name, phone and address, and what was
bought. The link is not secret by design: the email travels in page addresses and in the browser history, and it
can reach logs and a `Referer` header (finding F-CMRC1-EMAIL-IN-PAGE-URL stays open). The order id is a random
UUID, so a link cannot be guessed; it can be forwarded, read over a shoulder, or left on a shared computer. This
exception records the risk. It does not repair it.

**The stronger design that would retire it.** Option C of the decision: token links. Each order gets an
unguessable token, stored as a hash (the scheduling `TOKEN#` pattern above); the confirmation and tracking
addresses carry the token instead of the email; the lookup becomes a token lookup. That design removes the email
from page addresses and makes this exception unnecessary. It is separate later work, not started.

### Applies to

- commerce account / profile / order self-service (the order confirmation and tracking pages of a guest: under the
  *Order-page lookup exception* above, amendment 2026-11-28 — an exception, not conformance)
- scheduling (appointments and group seats): availability reads, booking, view, confirm, cancel and move, under
  the *Booking-token variant* above (amendment 2026-11-21; replaces "appointment booking / list / cancel in Phase 1")

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
