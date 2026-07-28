# FND-1: Shared normalizeEmail() (platform identity primitive)

- **Status:** PLANNED
- **Track:** Foundation
- **Depends:** PD-001 as amended 2026-07-28 (NFKC + validate-after-normalize)
- **Source:** `docs/platform-decisions.md` PD-001; `docs/plan-public-pool-customer-auth.md`
- **Maturity target:** MATURE (identity primitive; breaking change = key migration)

## Purpose / risk retired

One canonical email normalizer in `@amodx/shared`, used by every future consumer of
email-as-identity (commerce CUSTOMER# keys, Cognito usernames, auth flows,
appointments). Retires: scattered inline lowercasing; the duplicate-identity class
(same visual email, different Unicode encodings → different keys).

## Scope

1. `packages/shared/src/normalizeEmail.ts` (exported from the package index per
   shared-first rule): `normalizeEmail(raw: string): string` = trim → NFKC
   (`String.prototype.normalize('NFKC')`) → toLowerCase. Pure, deterministic,
   zero deps.
2. Ordering rule as CODE SHAPE: any validation helper in shared that checks email
   format must accept the NORMALIZED form (document in the module header; if a shared
   email validator exists, verify its call order at its call sites — report findings,
   do NOT refactor callers in this slice).
3. Unit tests (shared suite, test-3 harness): ASCII passthrough, trim, case, NFKC
   pairs (composed vs decomposed é — both → identical output; fullwidth chars;
   ligature ﬁ), idempotence (normalize(normalize(x)) === normalize(x)), and a
   documented Turkish-İ expectation.
4. MIGRATION NOTE in the module header: existing inline `.toLowerCase()` call sites
   (~7, per plan-public-pool-customer-auth.md:512) are NOT migrated here — that is a
   separate ripple slice (fnd-2) per the roadmap; list the sites you find in the
   build report as its input.

## Non-scope

- No call-site migration (fnd-2). No confusable detection (rejected). No Cognito/
  commerce code. No validator refactors.

## Definition of Done

1. Function + tests green; exported; typecheck green; idempotence pinned.
2. Call-site inventory (OBSERVED, file:line) in the build report for fnd-2.
3. Reconciliation per docs/documentation.md (slice doc, ROADMAP, strategy doc,
   TECH-DEBT if residuals).

## Evidence

- `EXECUTED`: shared test transcript incl. NFKC pairs; root typecheck.
- `OBSERVED`: call-site inventory.
