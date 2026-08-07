# FND-2: Migrate inline email normalization to normalizeEmail()

- **Status:** IMPLEMENTED (2026-08-07 — code complete, all credential-free suites green; production deploy + staging-integration run pending human review)
- **Track:** Foundation (implementation wave slice 1, human-ordered 2026-08-07)
- **Depends:** fnd-1 (SHIPPED)
- **Source:** fnd-1 build report §call-site inventory; PD-001 as amended

## Scope

Replace every inline email `.toLowerCase()`/trim at the call sites inventoried in the
fnd-1 build report (~7, backend + renderer) with `normalizeEmail()` from
`@amodx/shared`. RE-VERIFY the inventory first (grep; treat the report as a subset).
Behavior note per site: for sites where the stored/compared value could differ under
NFKC (non-ASCII), record the delta; existing PERSISTED values are NOT migrated (no
data change — record any implication for lookups as findings).

## Non-scope

No schema changes; no persisted-data migration. **No new validation work** *except* the one
reorder amended PD-001 requires: at each migrated site that already performs email-format
validation, normalization runs **before** that validation (or the normalized value is
re-validated) — whichever is the smaller diff. See § REVISE cycle for the two affected sites
(`orders/create.ts`, `customers/public-update.ts`) and the acceptance-behavior delta.

> **Historical note.** The original cycle-1 wording of this line was a flat "no new validation."
> The operator declared it DEFECTIVE (it contradicted ratified PD-001, "validation runs on the
> NORMALIZED form") and amended it to the boundary above. The amended boundary supersedes the
> original text; the original is retained here only as historical context, not as a live constraint.

## DoD / evidence

Each call site diffed + unit-covered where a pure seam exists; root build + typecheck
+ unit suites green; serving-contract suite green if any renderer site is touched.

## Build run — 2026-08-07

### Inventory re-verification (fnd-1 report treated as a subset, per Scope)

Both sweeps from the fnd-1 report were re-run independently against the working tree
(`git grep`, deterministic — not an index/embeddings result):

- `.toLowerCase()` on an email → matched exactly the fnd-1 group-A lines **plus** the two
  group-C search filters, nothing else.
- `CUSTOMER#` / `CUSTORDER#` / `EMAILLIMIT#` key builds → matched group-A + group-B,
  nothing else.

**Line numbers had drifted +1..+6 from the fnd-1 table** (e.g. site 1 `create.ts:322`→`:323`,
site 4 `:293`→`:294`) *as observed at the inventory-grep step, before any edit*, confirming the
report was a subset/approximate snapshot, exactly as its own note warned. No site beyond the 14
(+2 out-of-scope) was found. Basis: deterministic text search over tracked sources; residual risk
= an email reaching a key through a variable named nothing like one that also builds no
email-shaped key — none found, unchanged from fnd-1.

> **Post-edit line reconciliation (revision iteration 1, re-verified by `grep -n` on the current
> working tree 2026-08-07).** The per-site table below is labelled `(post-edit)` and its `create.ts`
> rows now read 312/341/356/412/476/501 (not the 294/329/344/400/464/489 first recorded). The larger
> shift versus the inventory-grep snapshot above is expected: the revise-cycle V1 block
> (`create.ts:37–41`, normalize-before-validate) was inserted *after* inventory verification, pushing
> every key site in that file down. Sites 10–14 (`dynamo.ts:488,515`, `get.ts:30,41`, `update.ts:36`)
> were already accurate and are unchanged.

### Per-site before/after (14 sites migrated; group C left as-is by design)

| # | File:line (post-edit) | Before | After | Role |
|---|-----------------------|--------|-------|------|
| 1 | `backend/src/orders/create.ts:341` | `CUSTORDER#${customerEmail.toLowerCase()}#…` | `CUSTORDER#${normalizedEmail}#…` | identity key |
| 2 | `backend/src/orders/create.ts:356` | `CUSTOMER#${customerEmail.toLowerCase()}` | `CUSTOMER#${normalizedEmail}` | identity key |
| 3 | `backend/src/orders/create.ts:412` | `EMAILLIMIT#${customerEmail.toLowerCase()}` | `EMAILLIMIT#${normalizedEmail}` | rate-limit key |
| 4 | `backend/src/orders/create.ts:312` | `customerEmail: customerEmail.toLowerCase()` | `customerEmail: normalizedEmail` | persisted attr |
| 5 | `backend/src/orders/create.ts:476` | `customerEmail: customerEmail.toLowerCase()` (email vars) | `customerEmail: normalizedEmail` | persisted/template |
| 6 | `backend/src/orders/create.ts:501` | `ToAddresses: [customerEmail.toLowerCase()]` | `ToAddresses: [normalizedEmail]` | SES delivery |
| 7 | `backend/src/orders/public-get.ts:26` | `…customerEmail.toLowerCase() !== email.toLowerCase()` | `normalizeEmail(…) !== normalizeEmail(email)` | **authz compare** |
| 8 | `backend/src/customers/public-update.ts:56` (deriv), `:75`, `:109` (keys) | `emailLower = email.toLowerCase()` → key | `normalizedEmail = normalizeEmail(email)` → key (var renamed) | identity key |
| 9 | `backend/src/resources/presign.ts:38` (deriv), `:44` (key) | `emailLower = userEmail.toLowerCase()` → `CUSTORDER#` | `normalizedEmail = normalizeEmail(userEmail)` → key (var renamed) | **entitlement** |
| 10 | `renderer/src/lib/dynamo.ts:488` | `CUSTORDER#${email.toLowerCase()}#` | `CUSTORDER#${normalizeEmail(email)}#` | identity key |
| 11 | `renderer/src/lib/dynamo.ts:515` | `CUSTOMER#${email.toLowerCase()}` | `CUSTOMER#${normalizeEmail(email)}` | identity key |
| 12 | `backend/src/customers/get.ts:30` | `CUSTOMER#${email}` (**raw**) | `CUSTOMER#${normalizedEmail}` | identity key |
| 13 | `backend/src/customers/get.ts:41` | `CUSTORDER#${email}#` (**raw**) | `CUSTORDER#${normalizedEmail}#` | identity key |
| 14 | `backend/src/customers/update.ts:36` | `CUSTOMER#${email}` (**raw**) | `CUSTOMER#${normalizedEmail}` | identity key |

**Group C — deliberately NOT migrated** (fnd-1 § C): `backend/src/orders/list.ts:64` and
`admin/src/pages/Customers.tsx:39` lowercase an email for a substring **search filter**;
NFKC-folding a search needle changes what the operator typed. Left as `.toLowerCase()`.

**Local rename for truthfulness** (autonomy: local + provably safe): `emailLower` →
`normalizedEmail` in `public-update.ts` and `presign.ts`. The old name asserted lowercase-only
and would mislead the next reader now that trim + NFKC also apply.

### Suites (all EXECUTED against a fresh build; credential-free estate)

| Suite | Command | Result |
|-------|---------|--------|
| Full build | `npm run build` | green (renderer needed one `.next` clear for a stale-artifact `ENOTEMPTY` cleanup race — not source-related) |
| Typecheck | `npm run typecheck` | green, 8/8 |
| Backend units | `cd backend && npm run test:unit` | 79 passed (5 files; incl. new `email-key-normalization.test.ts` 11/11 — 5 identity-key convergence + 6 `fnd-2 revise` validate∘normalize cases) |
| Shared | `npm test -w packages/shared` | 70 passed |
| Plugins | `npm test -w packages/plugins` | 172 passed |
| Renderer units | `npm test -w renderer` | 29 passed |
| Serving contract | `cd renderer && npm run test:serving` | 20/20 (renderer site touched → required) |
| Infra synth | `cd infra && npm test` | 17 passed |
| Staging integration | `cd backend && npm test` | **NOT RUN** — needs live staging DynamoDB; packet forbids staging tests + isolation rule |

## Findings (Scope: "record any implication for lookups as findings")

- **F-FND2-1 (persisted-key backfill deferred — expand-before-contract NOT done).** This
  slice is a call-site refactor; existing PERSISTED keys are unchanged (slice Non-scope).
  For the common ASCII-no-whitespace address the derived key is **byte-identical** to the old
  `.toLowerCase()` form, so those records stay reachable. The residual is narrow but real:
  a pre-fnd-2 `CUSTOMER#`/`CUSTORDER#` key written under a **non-ASCII (non-NFKC) or
  whitespace-bearing** form becomes unreachable now that its readers normalize. The fnd-1
  module doc anticipated this ("fnd-2 … IS A KEY MIGRATION … plan expand-before-contract");
  the fnd-2 slice author scoped the data migration OUT and asked for it as a finding. A
  backfill (enumerate non-canonical keys → dual-write → contract) is deferred to a future
  data slice, gated behind Track B (`cmrc-1`, commerce-private table) and the no-scan rule.
- **F-FND2-2 (group-B raw reads were already broken → now FIXED, net improvement).**
  `customers/get.ts` and `customers/update.ts` were fully raw, so an admin opening
  `Customer@x.com` missed the record checkout wrote lowercased as `customer@x.com`. Post-fnd-2
  these reads normalize and land on the write-path key. This is a **correction**, not a
  regression, for every mixed-case ASCII address (the overwhelming majority).
- **F-FND2-3 (validation-order finding D) — RESOLVED in the revise cycle below (2026-08-07).**
  fnd-1 § D flagged that `orders/create.ts` validates the RAW body (`OrderInputSchema.safeParse`)
  then normalizes, i.e. validate-then-normalize, against amended PD-001. The cycle-1 Non-scope
  line "no new validation" was operator-declared DEFECTIVE — it contradicted ratified PD-001
  ("validation runs on the NORMALIZED form"). The minimal conforming fix is now IN scope and
  applied. See the revise cycle.

## REVISE cycle — 2026-08-07 (F-FND2-3 resolved by operator)

**Amendment:** at each migrated site that performs email-*format* validation, normalize
BEFORE the email field is validated (or re-validate the normalized value — whichever is the
smaller diff). No other validation work. Cycle-1's 14 key/attribute migrations (7 files) stand
unchanged.

### Sibling sweep — which migrated sites validate email format

Re-verified by reading all 7 cycle-1 files. Only **two** run email-format validation; the
other five gate on presence (`!email`) or a path/session-derived value and never format-check,
so they had no validate-then-normalize defect:

| Site | Format-validates? | Action |
|------|-------------------|--------|
| `orders/create.ts` | YES — `OrderInputSchema` (`z.string().email()` on `customerEmail`) | **fixed** |
| `customers/public-update.ts` | YES — local regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` | **fixed** |
| `orders/public-get.ts` | no — authz compare, both sides normalized | none |
| `customers/get.ts` | no — presence only, path param | none |
| `customers/update.ts` | no — presence only, path param | none |
| `resources/presign.ts` | no — presence only, session-derived email | none |
| `renderer/src/lib/dynamo.ts` | no — read paths, no format check | none |

### Per-site validation before/after + acceptance-behavior delta

| # | File | Before (validate → normalize) | After (normalize → validate) | Acceptance delta |
|---|------|-------------------------------|------------------------------|------------------|
| V1 | `backend/src/orders/create.ts` | `OrderInputSchema.safeParse(JSON.parse(body))` on RAW `customerEmail`, then `normalizeEmail` at derivation | `JSON.parse` → normalize `customerEmail` field → `OrderInputSchema.safeParse` on the normalized body | A fullwidth-`＠` / NFKC / whitespace-padded address that previously **failed** `.email()` → HTTP 400 "Invalid input" now folds to canonical ASCII, **passes**, and the order is placed. Genuinely invalid addresses (no `@`) still rejected — normalization is not repair. |
| V2 | `backend/src/customers/public-update.ts` | `emailRegex.test(email)` on RAW, then `normalizeEmail` | `normalizeEmail(email)` → `emailRegex.test(normalizedEmail)` | Same delta: fullwidth-`＠` previously **400 "Invalid email format"** now normalizes and passes to the existence check. At-less strings still rejected. |

Both sites' `normalizeEmail` derivation is idempotent, so the `CUSTOMER#` / `CUSTORDER#` /
`EMAILLIMIT#` keys built downstream are byte-identical to cycle-1 — this cycle changes only
which inputs are *accepted*, not any key value.

### Unit coverage (pure seam = the `validate ∘ normalize` composition)

`backend/test/unit/email-key-normalization.test.ts` gains a `fnd-2 revise` describe block that
mirrors both compositions: `OrderInputSchema.safeParse(order(...))` for V1 and
`emailRegex.test(normalizeEmail(...))` for V2 — pinning that raw fullwidth is rejected, the
normalized form is accepted, and normalization does not rescue an at-less string.

### Ripple — PD-001 conformance note (NOT edited here; flagged for the reviewer)

`docs/platform-decisions.md` PD-001's dated "Conformance status" clause (`OBSERVED 2026-07-28`)
states "nothing conforms yet … no call site validates after normalizing." After this cycle that
is stale. It is a **dated observation snapshot inside a binding-decisions file** and NOT in this
slice's writable surface (call-site files + tests + reconciliation docs), so it was left
untouched. Recommend the operator refresh it when fnd-2 ships, consistent with fnd-1's practice
of not silently rewriting dated status entries. Flagged, not silently changed.

## FINALIZE — 2026-08-07 (handler-integration coverage exception, operator-resolved `fnd2-handler-coverage`)

**Decision (operator, ratified):** ACCEPT the contract-level unit evidence as the documented
coverage exception for this narrowly-scoped refactor. The changed handler surface
(`orders/create.ts` and the other six migrated files) is pinned by the contract-level units in
`backend/test/unit/email-key-normalization.test.ts` and `packages/shared/test/normalizeEmail.test.ts`
— the `CUSTOMER#`/`CUSTORDER#`/`EMAILLIMIT#` key convergence, the authz-compare symmetry, and the
`validate ∘ normalize` composition for V1/V2 — NOT by an end-to-end handler-integration test.
This is recorded here as the accepted exception, not a silent gap.

**Rationale:**

- **(a) The staging-integration prohibition binds RELAYS.** Operator-run staging integration is
  the documented carve-out; the OPERATOR runs the staging suite before commit as a broad
  regression check. A relay builder cannot run it (no credentials, isolation rule, packet's
  no-staging-tests constraint).
- **(b) The staging suite would not cover the changed surface anyway.** It contains no
  `orders`-handler test, so a staging run over these files adds no targeted coverage of the
  fnd-2 diff — the contract units are the tighter evidence for what changed.
- **(c) The local handler-integration harness is already a named deferred item** in
  `docs/testing-strategy.md`. It stays deferred there; standing it up is explicitly out of
  fnd-2's scope. Building it inside this slice would be unearned adjacent infrastructure.

**Net:** fnd-2 is finalized on contract-level unit evidence (all credential-free suites green,
transcripts below/in the build run). Deploy + the operator's pre-commit staging regression run
remain the two human-gated steps before ship; neither is a relay action. No further code changes
in this slice.

## Green suite transcripts — revision iteration 1 (re-EXECUTED 2026-08-07)

Reviewer review-0 required raw transcripts (exact command + exit status + relevant output), not
summary tables. Every suite below was re-run against a fresh `npm run build`; each block is the
verbatim summary line(s) plus the captured shell exit status. Credential-free estate only; the
staging-integration suite stays `NOT RUN` under the operator-accepted coverage exception (FINALIZE
above). Exit status was captured with `echo "EXIT=$?"` immediately after each command.

```text
# 1. Full build
$ npm run build
… shared → plugins → backend → admin → renderer (Next.js route table printed) → mcp-server (tsc) → infra (tsc)
BUILD_EXIT=0

# 2. Typecheck (tsc --noEmit across all 8 workspaces: shared, effects, plugins, backend, admin, renderer, mcp-server, infra)
$ npm run typecheck
> @amodx/shared@1.0.0 typecheck  → tsc --noEmit
> @amodx/effects@1.0.0 typecheck → tsc --noEmit
> @amodx/plugins@1.0.0 typecheck → tsc --noEmit
> @amodx/backend@1.0.0 typecheck → tsc --noEmit
> admin  → tsc -b --noEmit --force
> renderer → tsc --noEmit
> @amodx/mcp-server@1.0.0 typecheck → tsc --noEmit
> infra → tsc --noEmit
(no diagnostics emitted)
TYPECHECK_EXIT=0

# 3. Backend units (includes the new email-key-normalization.test.ts)
$ cd backend && npm run test:unit
 RUN  v4.1.8 /Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend
 Test Files  5 passed (5)
      Tests  79 passed (79)
BACKEND_UNIT_EXIT=0

# 4. Shared
$ npm test -w packages/shared
 Test Files  2 passed (2)
      Tests  70 passed (70)
SHARED_EXIT=0

# 5. Plugins
$ npm test -w packages/plugins
 Test Files  3 passed (3)
      Tests  172 passed (172)
PLUGINS_EXIT=0

# 6. Renderer units
$ npm test -w renderer
 Test Files  2 passed (2)
      Tests  29 passed (29)
RENDERER_EXIT=0

# 7. Serving contract (required: renderer/src/lib/dynamo.ts was touched)
$ cd renderer && npm run test:serving
ok 20 - (g3) the referral Set-Cookie lives on an uncacheable /api response (cache-3 F8)
# serving-contract suite wall time: 9.2s
# tests 20
# pass 20
# fail 0
SERVING_EXIT=0

# 8. Infra synth (Jest; CDK synth, credential-free)
$ cd infra && npm test
Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
INFRA_EXIT=0

# 9. Staging integration — NOT RUN (operator-accepted exception; needs live staging DynamoDB;
#    packet forbids staging tests + isolation rule). No orders-handler test exists in this suite,
#    so it would not cover the fnd-2 diff regardless. Operator runs it pre-commit as broad regression.
$ cd backend && npm test   # NOT RUN
```

**Reconciliation of the two numeric discrepancies review-0 flagged:**
- Backend units are **79 passed (5 files)** — the earlier "73 passed" in the § *Suites* table was
  stale (pre-revise-cycle count) and is now corrected there.
- The new `email-key-normalization.test.ts` holds **11** `it(...)` cases (5 identity-key convergence +
  6 `fnd-2 revise` validate∘normalize) — the earlier "5/5" is corrected to **11/11**. Verified by
  `grep -cE '^\s*it\(' backend/test/unit/email-key-normalization.test.ts` → 11.
