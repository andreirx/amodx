# FND-1: Shared normalizeEmail() (platform identity primitive)

- **Status:** IMPLEMENTED 2026-07-28 — review pending (§ Build run; latest cycle
  § *Reconciliation run*). No open ratification:
  the shipped operation order **NFKC → trim → lowercase** was ratified 2026-07-28 and is now
  the text of both `docs/platform-decisions.md` PD-001 § Invariants and this document's
  § Scope. § *Ordering deviation* is retained as the executed evidence for that order.
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
   shared-first rule): `normalizeEmail(raw: string): string` = NFKC
   (`String.prototype.normalize('NFKC')`) → trim → toLowerCase (order ratified 2026-07-28: idempotent; see PD-001 amendment record). Pure, deterministic,
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

---

## Architectural boundaries

- `@amodx/shared` is the innermost package; it depends on nothing but `zod` and is imported
  by every other workspace, browser bundles included. `normalizeEmail` therefore may not
  reach for Node `crypto`, `process.env`, a locale, or any I/O. It does not.
- It is the counterpart to `cognitoUsername()`, which is deliberately renderer-server-only
  for exactly that reason (`docs/plan-public-pool-customer-auth.md` § Helper placement).
  This slice does not create that helper.
- Clean-architecture posture: this is core policy (an identity rule), pure and testable
  off-target — `docs/VISION.md` guarantee 3. No abstraction is introduced: one exported
  function, no interface, no registry, no config seam. There is one concrete behaviour and
  no demonstrated axis of variation, so there is nothing to make variable.

## Migration / deployment notes

**Nothing to deploy and nothing to migrate — by construction.** The slice adds a new export
and changes zero call sites, so no key that exists today is computed differently tomorrow.
`packages/shared/dist` is rebuilt, which is why the four dependent workspaces were rebuilt
and typechecked, but no Lambda behaviour changes.

The migration is `fnd-2`, and it is a **key migration, not a refactor**: an already-persisted
`CUSTOMER#<email>` whose stored form differs from `normalizeEmail(email)` becomes unreachable
the moment its readers switch. `fnd-2` must plan expand-before-contract (dual-read → backfill
→ contract) per `docs/VISION.md`.

## Ordering deviation — `NFKC → trim → lowercase` (RATIFIED 2026-07-28)

*(Section name kept: `docs/platform-decisions.md` PD-001 § Invariants cites it by this name.)*

As first written, § Scope named `trim → NFKC → toLowerCase`. **That order cannot satisfy
§ Definition of Done item 1** ("idempotence pinned"), so the function was built as
`NFKC → trim → lowercase` and the deviation was raised rather than applied silently. It was
ratified 2026-07-28; § Scope, PD-001 § Invariants and this section now all name that order,
and what follows is the executed evidence the ratification rests on.

Why: the Unicode compatibility decomposition of a *spacing diacritic* is SPACE + combining
mark — `NFKC("¨")` is `U+0020 U+0308`. NFKC can therefore **introduce** leading
whitespace that a preceding `trim()` has already run past. Under the documented order,
`"¨a@example.com"` normalizes to `" ̈a@example.com"` (leading space) and a *second*
pass returns `"̈a@example.com"` — a different string. That is not cosmetic: an identity
key that changes when re-normalized can be written under one value and read under another,
and the read returns nothing, which reads as "no such customer" rather than as an error.

`EXECUTED` 2026-07-28 (node, repo root):

- **50 code points** fail idempotence under `trim → NFKC → lowercase` when they lead the
  string (U+00A8, U+00AF, U+00B4, U+00B8, U+02D8, U+02D9, U+02DA, U+02DB, U+02DC, U+02DD,
  U+037A, U+0384, …).
- **0 failures** under `NFKC → trim → lowercase`, sweeping every code point U+0000–U+2FFFF
  (surrogates excluded) in three positions — leading, trailing, and interior — of an
  otherwise-valid address.
- A leading `trim()` **before** NFKC would be dead code, not extra safety: over the same
  sweep, NFKC never converts a JS-`WhiteSpace` code point into a non-whitespace one, so
  `trim → NFKC → trim → lowercase` returns a byte-identical result to the shipped order for
  all **583,680** inputs tested (194,560 non-surrogate code points × 3 positions). The
  pre-trim is therefore omitted rather than kept "just in
  case" — a redundant operation in an identity primitive is a second thing a future reader
  has to prove irrelevant.

The deviation was *within* the originally ratified intent (same three operations, same NFKC
decision, same canonical outputs for every input that is actually an email address); only the
internal order changed, and only where the previously documented order was self-contradictory.
It was raised rather than applied silently because PD-001's normalization rule is a binding
invariant — that is why it went to ratification instead of into a commit message.

**Falsification evidence** (`EXECUTED`): with the implementation temporarily flipped to the
previously documented order, this slice's own suite fails 2 of 30 —
`is idempotent for leading spacing diacritic` and `pins the leading-diaeresis case
concretely`. The source file was restored byte-identical afterwards (verified with `diff`).
The order is load-bearing and the suite proves it, rather than asserting it.

## Call-site inventory (input to `fnd-2`)

`OBSERVED` 2026-07-28. **Basis for the completeness claim:** this is not an
embeddings/heuristic result. `grep -rn "toLowerCase()"` over `backend/src` + `renderer/src`
returns **45** hits in total; all 45 were read and classified by hand, and every hit not
listed below is a slug builder, a search filter, a MIME/colour/country-name comparison or a
tag match — nothing else touches a customer email. Raw-key sites were found by a second
independent sweep for `CUSTOMER#` / `CUSTORDER#` / `EMAILLIMIT#`. Both are deterministic text
searches over the working tree, so the risk is a site that reaches an email through a variable
named nothing like one *and* builds no email-shaped key — none was found, but that residual is
why `fnd-2` should re-run both sweeps rather than trust this table.

### A. Inline `.toLowerCase()` on a customer email — 11 lines, 5 files

| # | File:line | What it feeds | Consequence today |
|---|-----------|---------------|-------------------|
| 1 | `backend/src/orders/create.ts:322` | `SK: CUSTORDER#<email>#<orderId>` | identity key, no trim/NFKC |
| 2 | `backend/src/orders/create.ts:337` | `SK: CUSTOMER#<email>` | identity key, no trim/NFKC |
| 3 | `backend/src/orders/create.ts:393` | `SK: EMAILLIMIT#<email>` (rate limit) | limit is bypassable by an encoding variant |
| 4 | `backend/src/orders/create.ts:293` | persisted `customerEmail` attribute | stored form ≠ future canonical form |
| 5 | `backend/src/orders/create.ts:452` | persisted `customerEmail` (2nd write path) | same |
| 6 | `backend/src/orders/create.ts:477` | SES `ToAddresses` | delivery only, not a key |
| 7 | `backend/src/orders/public-get.ts:23` | order-lookup authorization compare (2 calls on the line) | **authorization** compare, not a key |
| 8 | `backend/src/customers/public-update.ts:62` | `emailLower` → `CUSTOMER#` at `:68` and `:102` | identity key, no trim/NFKC |
| 9 | `backend/src/resources/presign.ts:35` | `emailLower` → `CUSTORDER#` at `:41` | **entitlement** check for signed asset URLs |
| 10 | `renderer/src/lib/dynamo.ts:488` | `SK: CUSTORDER#<email>#` (account order history) | identity key, no trim/NFKC |
| 11 | `renderer/src/lib/dynamo.ts:515` | `SK: CUSTOMER#<email>` (profile read) | identity key, no trim/NFKC |

### B. Email-keyed reads with NO normalization at all — 3 lines, 2 files

| # | File:line | What it feeds |
|---|-----------|---------------|
| 12 | `backend/src/customers/get.ts:24` | `SK: CUSTOMER#<email>` — raw path parameter |
| 13 | `backend/src/customers/get.ts:35` | `SK: CUSTORDER#<email>#` — raw path parameter |
| 14 | `backend/src/customers/update.ts:31` | `SK: CUSTOMER#<email>` — raw path parameter |

These are worse than inconsistent: an admin reading `Customer@x.com` from the admin UI misses
the record that checkout wrote as `customer@x.com`. **`fnd-2` should treat B as the priority.**

### C. Deliberately OUT of `fnd-2` scope — 2 lines

`backend/src/orders/list.ts:64` and `admin/src/pages/Customers.tsx:39` lowercase an email for a
**substring search filter**, not for identity. Routing them through `normalizeEmail` would be
wrong (NFKC-folding a search needle changes what the operator asked for). Leave them.

### D. Validation-order finding (§ Scope item 2 — reported, not refactored)

The shared "email validator" is the `z.string().email()` field on `OrderInputSchema`,
`OrderSchema`, `CustomerSchema`, `LeadSchema` and `CommentSchema.authorEmail`. `OBSERVED`:
`backend/src/orders/create.ts:30` runs `OrderInputSchema.safeParse` on the **raw** request
body and lowercases at `:293` — i.e. validate-then-normalize, the wrong way round under the
amended PD-001. The verdicts genuinely differ (a fullwidth `＠` address fails `.email()` raw
and passes after NFKC), so the value actually persisted was never validated in the form it
was persisted in. Pinned as a *rule* by test in this slice; **correcting the call sites is
`fnd-2`.**

## Exit criterion

`fnd-2` (call-site migration + backfill) and Track C `auth-1` can proceed: there is now one
canonical normalizer to migrate *to*, its contract is executable, and the sites to migrate
are enumerated above.

## Build run — 2026-07-28

| # | Check | Command | Result |
|---|-------|---------|--------|
| 1 | shared suite | `npm test -w packages/shared` | `EXECUTED` — **70 passed** (2 files: 40 schema + 30 `normalizeEmail`) |
| 2 | fnd-1 transcript | `cd packages/shared && npx vitest run test/normalizeEmail.test.ts --reporter=verbose` | `EXECUTED` — **30/30**, incl. the NFKC pairs |
| 3 | order falsification | flip impl to `trim → NFKC → lowercase`, re-run #2, restore | `EXECUTED` — **2 failed / 28 passed**; source restored byte-identical (`diff`) |
| 4 | full build | `npm run build` (root, dependency order) | `EXECUTED` — green through infra |
| 5 | typecheck | `npm run typecheck` (8 workspaces) | `EXECUTED` — green, 8/8 |
| 6 | built export surface | `node -e 'import("./packages/shared/dist/index.js")…'` | `OBSERVED` — `typeof normalizeEmail === "function"`; `dist/index.d.ts:2` re-exports it |
| 7 | backend units | `cd backend && npm run test:unit` | `EXECUTED` — 51 passed |
| 8 | plugins | `npm test -w packages/plugins` | `EXECUTED` — 172 passed |
| 9 | renderer units | `cd renderer && npm test` | `EXECUTED` — 29 passed |
| 10 | serving contract | `cd renderer && npm run test:serving` | `EXECUTED` — 20/20, 11.0 s |
| 11 | infra synth | `cd infra && npm test` | `EXECUTED` — 15 passed |
| 12 | staging integration | `cd backend && npm test` | `NOT RUN` — requires real staging DynamoDB credentials; the relay must not touch the operator's live environment |
| 13 | packages added | — | `OBSERVED` — none; `package-lock.json` untouched |
| 14 | MCP sync | `grep -rn "@amodx/shared" tools/mcp-server/src` | `OBSERVED` — **not owed**; the MCP server does not import the shared package at all |

**Zero call-site changes**, per § Non-scope: the only non-doc files touched are
`packages/shared/src/normalizeEmail.ts` (new), one export line in
`packages/shared/src/index.ts`, and `packages/shared/test/normalizeEmail.test.ts` (new).

### Test-file convention worth keeping

`test/normalizeEmail.test.ts` is **pure ASCII by rule** — every non-ASCII character is a
`\uXXXX` escape, verified with `LC_ALL=C grep -n '[^ -~\t]'` (0 hits). Composed and decomposed
`é` are indistinguishable on screen and a BOM is invisible, so literals here would be a test
nobody can review — and any editor that normalizes on save would silently delete the exact
distinction under test.

### Finding (RESOLVED 2026-07-28): PD-001's amended text had not reached the file

`OBSERVED` during the build run: commit **`bb7e1d2`**, titled *"docs: PD-001 amended (NFKC +
validate-after-normalize, human-ratified) + fnd-1 slice doc"*, changed exactly one file — this
slice document (`git show --stat bb7e1d2`). `docs/platform-decisions.md` was untouched and
PD-001 § Invariants still read *"Email normalization is `lowercase + trim`"*, i.e. a live
contradiction inside the binding-invariants file. The ratification was real; the file edit had
been dropped. The builder recorded the divergence and the exact replacement text but did not
rewrite the invariant bullet, on the ground that minting invariant text is a human's call.

**Resolution** (`OBSERVED` 2026-07-28, working tree): the operator applied the amendment.
PD-001 § Invariants now reads `NFKC → trim → lowercase` with validate-after-normalize, and
PD-001 § *Amendment record — normalization rule (RATIFIED 2026-07-28)* carries both
ratifications and this history. No contradiction remains and no decision is outstanding.

Worth keeping as a process datum: the defect was found only because the slice verified a cited
commit with `git show --stat` instead of trusting its message. A commit message is a claim
about a file, not the file.

### Finalize run — 2026-07-28 (cycle 2: PD-001 contradiction closed)

Cycle 2 changed **no behaviour**: the only non-doc edit is three comment lines in
`normalizeEmail.ts` whose text had gone stale ("the order named in the fnd-1 slice text" —
the slice text now names the shipped order). `OBSERVED`: the function body is still
`return raw.normalize("NFKC").trim().toLowerCase();`. Everything was re-run anyway, against
a fresh build, because a doc-only claim is still a claim.

| # | Check | Command | Result |
|---|-------|---------|--------|
| 1 | full build | `npm run build` | `EXECUTED` — green through `infra` |
| 2 | typecheck | `npm run typecheck` | `EXECUTED` — green, 8/8 workspaces |
| 3 | fnd-1 transcript | `cd packages/shared && npx vitest run test/normalizeEmail.test.ts --reporter=verbose` | `EXECUTED` — **30/30** |
| 4 | shared suite | `npm test -w packages/shared` | `EXECUTED` — 70 passed (2 files) |
| 5 | plugins | `npm test -w packages/plugins` | `EXECUTED` — 172 passed |
| 6 | backend units | `cd backend && npm run test:unit` | `EXECUTED` — 51 passed |
| 7 | renderer units | `cd renderer && npm test` | `EXECUTED` — 29 passed |
| 8 | serving contract | `cd renderer && npm run test:serving` | `EXECUTED` — 20/20, 9.3 s |
| 9 | infra synth | `cd infra && npm test` | `EXECUTED` — 15 passed, 50.0 s |
| 10 | built export surface | `node -e 'import("./packages/shared/dist/index.js")…'` | `OBSERVED` — `typeof normalizeEmail === "function"`; composed/decomposed `é` collapse to one output; diaeresis case idempotent; `dist/index.d.ts:2` re-exports it |
| 11 | test file still pure ASCII | `LC_ALL=C grep -c '[^ -~\t]' packages/shared/test/normalizeEmail.test.ts` | `OBSERVED` — `0` |
| 12 | staging integration | `cd backend && npm test` | `NOT RUN` — needs real staging DynamoDB credentials; the relay must not touch the operator's live environment |

**Docs reconciled this cycle** (every stale ratification warning the cycle-1 builder added is
now removed, and the one reconciliation it had missed is done):

- this doc — § Status, § Ordering deviation heading + framing, § Finding (now RESOLVED);
- `docs/ROADMAP.md` § Foundation — "one ratification outstanding" removed;
- `CURRENT_SLICE.md` — "must not start before a human ratifies" removed; `fnd-2` is unblocked
  but still expand-before-contract;
- `docs/TECH-DEBT.md` — the "PD-001's amended text is missing" residual deleted (it was added
  in the same uncommitted change and is no longer true; the remaining `fnd-1` residuals, all
  of which are `fnd-2` call-site work, stand);
- `docs/plan-public-pool-customer-auth.md` — **missed in cycle 1** despite § Definition of Done
  item 3 naming the strategy doc. It still specified `lowercase + trim` in two places, one of
  them a literal function body (`input.trim().toLowerCase()`) that no longer matched the
  shipped code. Both now carry the ratified `NFKC → trim → lowercase`, the File Summary row A3
  is marked DONE with the real filename, and its § Dependencies bullet now points at the
  14-site inventory instead of implying checkout is the only site.

`normalizeEmail.ts`'s § Ordering-rule header is unchanged and still correct: validation must
run on the normalized form, and no call site does that yet — that is `fnd-2`.

### Reconciliation run — 2026-07-28 (cycle 3: required-behaviour vs current-state separation)

**Zero code edits this cycle** — `git diff --stat packages/shared/src` is unchanged from
cycle 2 and `packages/shared/test/` is untouched. Review found a documentation defect of a
specific kind worth naming, because it is the failure mode of propagating a ratified rule
into strategy docs: the rule was written in the **present indicative**, so the invariant
("must be normalized this way") and the current state ("nothing is, yet") became the same
sentence. `docs/platform-decisions.md` PD-001 read *"…and used identically by checkout, auth
…, customer profile, and appointments"* — a false statement about the working tree inside the
binding-invariants file, one line below a correct rule. A reader auditing whether the estate
conforms would have concluded it already does.

`OBSERVED` 2026-07-28 — the deterministic basis for "zero consumers", not an index or an
embeddings search: `git grep -n "normalizeEmail" -- '*.ts' '*.tsx'` over tracked sources
returns exactly **one** line, `packages/shared/src/index.ts:5` (the export itself). The
implementation and its test are still untracked-new, and no other tracked TypeScript file
mentions the identifier.

| File | Reconciliation |
|---|---|
| `docs/platform-decisions.md` PD-001 § Invariants | `and used identically by` → **`and it MUST be used identically by`**, and a *"Conformance status — this paragraph states the rule, not the estate"* clause appended **after** both rule sentences (so the normalization rule and the validate-after-normalize rule stay adjacent, with the status note not wedged between them): zero consumers, the `git grep` that establishes it, and `fnd-2` + the 14-site inventory as the conforming work. No rule text changed in substance — this separates *requirement* from *status* inside one bullet. |
| `docs/plan-public-pool-customer-auth.md:140` | Same fix at the strategy-doc mirror of the rule (`and used by` → `and it MUST be used by` + "That is the required end state, not today's"). Its `:517` and `:554` bullets were already correct about checkout still lowercasing inline — the two statements no longer contradict each other. |
| `docs/plan-commerce-private-table.md:90` | Stale **order**, not a stale tense: still specified the shared utility as `trim + lowercase`. Now `NFKC → trim → lowercase` with the PD-001 amendment pointer. This was the last surviving pre-amendment statement of the rule outside clearly-labelled history. (Its `:561` bullet was already correct.) |
| `docs/ROADMAP.md` § Foundation | `fnd-1` scope cell: `used by commerce CUSTOMER# keys (B) and all of customer auth (C)` → `the normalizer that … will be migrated onto by fnd-2; it has no consumers yet`. The status cell already said "zero call-site changes"; the scope cell contradicted it. |
| `docs/testing-strategy.md` §*Test taxonomy* 1 | `test-3`'s status paragraph still read *"Still outstanding by design: `normalizeEmail` does not exist until `fnd-1`"* — true when written, false now. Closed by appending an `fnd-1` status paragraph in the file's existing per-slice convention (rather than rewriting `test-3`'s record), noting why the unit layer is the *only* possible layer here (no call sites ⇒ no wire to drive) and the two conventions this suite establishes: pure-ASCII test source, and idempotence pinned as its own assertion. |

Historical quotations of the removed `lowercase + trim` text — in `CURRENT_SLICE.md:167` and
§ *Finding* above — are left as written. They are dated evidence of a specific falsification,
labelled as history, and rewriting them would destroy the audit trail the finding rests on.

Re-run in full against a fresh build anyway, because a doc-only cycle is still a claim:

| # | Check | Command | Result |
|---|-------|---------|--------|
| 1 | consumer sweep | `git grep -n "normalizeEmail" -- '*.ts' '*.tsx'` | `OBSERVED` — **1** hit, the export line in `packages/shared/src/index.ts:5` |
| 2 | no code change this cycle | `git diff --stat -- packages/shared/src packages/shared/test` | `OBSERVED` — `index.ts | 4 ++++`, nothing else tracked |
| 3 | stale-order sweep | `grep -rn "lowercase + trim\|trim + lowercase" docs/ CURRENT_SLICE.md` | `OBSERVED` — remaining hits are labelled history only |
| 4 | full build | `npm run build` | `EXECUTED` — green through `mcp-server` + `infra` |
| 5 | typecheck | `npm run typecheck` | `EXECUTED` — green, 8/8 workspaces |
| 6 | fnd-1 transcript | `cd packages/shared && npx vitest run test/normalizeEmail.test.ts --reporter=verbose` | `EXECUTED` — **30/30**, 215 ms |
| 7 | shared suite | `npm test -w packages/shared` | `EXECUTED` — 70 passed (2 files) |
| 8 | plugins | `npm test -w packages/plugins` | `EXECUTED` — 172 passed (3 files) |
| 9 | backend units | `cd backend && npm run test:unit` | `EXECUTED` — 51 passed (3 files) |
| 10 | renderer units | `cd renderer && npm test` | `EXECUTED` — 29 passed (2 files) |
| 11 | serving contract | `cd renderer && npm run test:serving` | `EXECUTED` — 20/20, 9.4 s |
| 12 | infra synth | `cd infra && npm test` | `EXECUTED` — 15 passed, 53.0 s (incl. the 3 credential-free isolation assertions) |
| 13 | built export surface | `node -e 'import("./packages/shared/dist/index.js")…'` | `OBSERVED` — `typeof normalizeEmail === "function"`; `"  José@Example.COM "` and `"josé@example.com"` → one output `"josé@example.com"`; diaeresis case idempotent; fullwidth `ａ＠b.com` → `a@b.com`; `dist/index.d.ts:2` re-exports it |
| 14 | test file still pure ASCII | `LC_ALL=C grep -c '[^ -~\t]' packages/shared/test/normalizeEmail.test.ts` | `OBSERVED` — `0` |
| 15 | packages added | `git status --short package-lock.json` | `OBSERVED` — empty; lockfile untouched |
| 16 | staging integration | `cd backend && npm test` | `NOT RUN` — needs real staging DynamoDB credentials; the relay must not touch the operator's live environment |

## References

- `docs/platform-decisions.md` PD-001 (canonical identity key; normalization invariant),
  PD-003 (Cognito as login substrate).
- `docs/plan-public-pool-customer-auth.md` § *Helper placement* (why `normalizeEmail` is
  shared and `cognitoUsername` is renderer-server-only) and its File Summary row A3.
- `docs/slices/sec-1-audit-remediation-2026-07.md:15` — the `next-auth` homoglyph advisory
  that made the NFKC question a PD-001 amendment input before `fnd-1`.
- `docs/ROADMAP.md` § Foundation; `docs/testing-strategy.md` §7 (pure unit layer, `test-3`).
- Next: `fnd-2` (call-site migration + backfill), Track C `auth-1`.
