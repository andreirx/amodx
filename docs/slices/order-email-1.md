# ORDER-EMAIL-1 — the confirmation and tracking pages find the order when the email was typed with capitals (implementation record)

Status: **BUILT** (2026-11-15, builder), uncommitted, awaiting review. Start: `main` at `5462373`, tree clean. All
oracles of the packet's § 3 pass (§ 6). No allocation addition. Maturity: **PROTOTYPE** until the operator places one
order on a deployed site with an email typed with a capital letter and sees the confirmation page with its order number.

## 1. Human direction (quoted)

> "3 ok fix to lowercase"

The defect: `docs/slices/order-checkout-1.md`, § 8, finding F-1.

## 2. Root cause

The packet's § 0 is confirmed on `5462373` (OBSERVED in the tree):

- The order handler stores the normalized email: `backend/src/orders/create.ts:39` folds the body's `customerEmail`
  through `normalizeEmail` (NFKC, trim, lower case) before the schema; `:64` `normalizedEmail`; `:348` stores it.
- The checkout puts the email as typed in the confirmation address: `renderer/src/components/CheckoutPageView.tsx:381`
  (`encodeURIComponent(form.customerEmail)`).
- The account page puts the profile email, else the session email, in the tracking link:
  `renderer/src/components/AccountPageView.tsx:330` (`customer?.email || session.user?.email`). The session email comes
  from the sign-in provider and can hold capitals (INFERRED; the provider's form was not checked).
- `getOrderForCustomer` (`renderer/src/lib/dynamo.ts:525` before the slice) compared `result.Item.customerEmail !== email`.
  The confirmation route (`SitePage.tsx:530`) and the tracking route (`:539`) call it.

So `Ana@Example.com` never matched the stored `ana@example.com`, and the visitor saw the generic panel without order
details. EXECUTED before-proof: § 5.

The same file already normalizes for the two customer reads (`dynamo.ts:625` `CUSTORDER#${normalizeEmail(email)}#`,
`:652` `CUSTOMER#${normalizeEmail(email)}`). The backend sibling `backend/src/orders/public-get.ts:26` normalizes both
sides: `normalizeEmail(result.Item.customerEmail) !== normalizeEmail(email)`.

## 3. What changed

| File:line | Change | Serves |
|---|---|---|
| `renderer/src/lib/dynamo.ts:525` | `result.Item.customerEmail !== normalizeEmail(email)` (was `!== email`), with a short trailing comment | § 1 of the packet |
| `renderer/test/unit/order-email-1.test.ts` (new) | 17 rows: the real `dynamo.ts`, the DynamoDB document client replaced by the exact-key `GetCommand` stub of `shop-look-1a-read.test.ts` | the § 1 table |
| `renderer/ARCHITECTURE.md` | new section "Order read by email — slice `order-email-1`" | documentation |
| `docs/slices/order-email-1.md` | this record | the record |

Abstractions: none added. `normalizeEmail` was already imported in `dynamo.ts` (`:50`).

## 4. Ratified behaviour — status

`getOrderForCustomer` compares the stored email with `normalizeEmail(email)`: done. An email of another customer still
gives `null`; `internalNotes` is still removed; the read is still one `GetCommand` on `TENANT#<tenant>` / `ORDER#<id>`.

### 4.1 An order stored before normalization (packet § 1, last row)

Question: can a stored `customerEmail` differ from `normalizeEmail` of itself? From the code history (EXECUTED
`git show <commit>:backend/src/orders/create.ts`, `git log -S`):

| Period | Writer | Stored form | Can it differ from its normalized form? |
|---|---|---|---|
| `61957b8` (2026-02-15) to `c4aaf3c` (2026-03-07) | no input schema; `customerEmail.toLowerCase()` | lower case, not trimmed, not NFKC | **Capitals: no.** Edge whitespace or a non-NFKC character: yes, if a visitor sent one |
| `c4aaf3c` to `41f298d` (fnd-2, 2026-08-07) | `z.string().email()` on the raw value, then `.toLowerCase()` | lower-case ASCII | No: the Zod email check refuses whitespace and non-ASCII (EXECUTED on the current zod 4.6.7: `" ana@example.com"`, `"anä@example.com"`, `"ana＠example.com"` → refused; the version at `c4aaf3c` was `^4.1.13`, so for that period this is INFERRED). NFKC, trim and lower case leave lower-case ASCII unchanged |
| `41f298d` to now | `normalizeEmail` before the schema | normalized | No |

No other writer of `customerEmail` on an `ORDER#` item in this repository: `git grep -n customerEmail -- backend/src`
shows `orders/create.ts` as the only writer (`update.ts` does not touch it; `update-status.ts` reads it). The migration
script `scripts/migrate-commerce-private-table.ts` does not name `customerEmail`. Limit: a record written outside this
repository's code (by hand, by a tool not in git) is not covered. A live-table read was not done (no AWS access; no
scan allowed).

Behaviour for such a record (rows in § 5, group 2):

- **Today (before):** found only by the exact stored text. Example: stored ` ana@example.com ` is found by
  ` ana@example.com `, not by `ana@example.com`.
- **New:** found by no request, because the request side is always normalized and the stored side is not.

Only orders of the first period (three weeks, the first weeks of the commerce module) with edge whitespace or a non-NFKC
character are in this case. Not widened (packet § 1). Finding F-1 below states the option.

## 5. Evidence taxonomy — each row and the test that binds it

All rows: `renderer/test/unit/order-email-1.test.ts`, EXECUTED, 17 / 17 passed on the final tree (§ 6).
Group 1 = "stored ana@example.com (normalized at order time)"; group 2 = "a stored email that is not in normalized form (the current writer makes none)".

| Input (stored `ana@example.com`) | Expected | Test (group 1 unless stated) |
|---|---|---|
| `ana@example.com` | the order, without `internalNotes` | `the same email → the order, without internalNotes` |
| — | one `GetCommand`, key `TENANT#t1` / `ORDER#o1` | `one GetCommand on TENANT#<tenant> / ORDER#<id>` |
| `Ana@Example.com`, `ANA@EXAMPLE.COM`, ` ana@example.com `, `\tAna@Example.com\n` | the order | `capitals or edge whitespace (…) → the order` (4 rows) |
| `ana＠example.com` (fullwidth `＠`), `Ａna@Example.com` (fullwidth `Ａ`) | the order | `a fullwidth form that normalizeEmail folds to the stored value (…) → the order` (2 rows) |
| `other@example.com`, `Other@Example.com`, `""`, `ana@example.co`, `an a@example.com` | `null` | `an email of another customer or no email (…) → null` (5 rows) |
| no such order id | `null` | `no such order id → null` |
| the same order id under another tenant | `null`; the key holds the other tenant | `the same order id under another tenant → null (the key holds the tenant)` |
| stored `Ana@Example.com` (no writer makes it, § 4.1); request the same text / lower case | `null` / `null` | group 2: `stored Ana@Example.com (no writer ever stored capitals): the same text → null (was: the order); the lower-case text → null (as before)` |
| stored ` ana@example.com ` (possible before `c4aaf3c`); request the same text | `null` | group 2: `stored ' ana@example.com ' (lower case, not trimmed): the same text → null (was: the order)` |

Before-proof (EXECUTED): one shell command copied `dynamo.ts` to `/tmp`, replaced the new compare with the old
`!== email` (a literal `node` replace, checked to match exactly once), ran the test file, and restored the file through
a `trap`. Result: 8 failed, 9 passed. Failed: the 6 rows that expect the order for a non-identical input, and the 2
group-2 rows (the old code found those orders by the exact text — this proves the "was" half of § 4.1). Passed: every
`null` row, the exact-match row and the key row. After the restore, `grep -n "customerEmail !== "` shows the new line
at `:525`.

NOT RUN: `cd backend && npm test` (writes to a live table; by rule). No end-to-end run of the confirmation page in a
browser: the serving suite renders the confirmation page with a stored email equal to the address email
(`test/serving-contract/fixtures.mjs:503`), so it covers the unchanged path only. A capital-letter serving row was not
added (the packet's oracle: no capture or expectation changed).

## 6. Gates (packet § 3) — each run bare, exit code from `echo $?`

Output went to `/tmp/ORDER-EMAIL-1-*.log` (deleted after the run); the counts below were read from them.

| # | Command | Expected | Result | Label |
|---|---|---|---|---|
| 1 | `npm run build; echo $?` (root) | 0 | 0 | EXECUTED |
| 2 | `npm run typecheck; echo $?` (root) | 0 | 0 | EXECUTED |
| 3 | `cd renderer && npm test; echo $?` | 0 | 0 — 37 files, 545 tests (17 of them new) | EXECUTED |
| 4 | `cd renderer && npm run test:serving; echo $?` | 0, no capture or expectation changed | 0 — pass 115, fail 0; `git status --porcelain -uall -- renderer/test/serving-contract` empty before and after | EXECUTED |
| 5 | `cd packages/shared && npm test; echo $?` | 0 | 0 — 20 files, 348 tests | EXECUTED |
| 6 | `cd packages/plugins && npm test; echo $?` | 0 | 0 — 6 files, 204 tests | EXECUTED |
| 7 | `cd backend && npm run test:unit; echo $?` | 0 | 0 — 53 files passed, 1 skipped; 1384 passed, 1 skipped | EXECUTED |
| 8 | `cd admin && npm run test:unit; echo $?` | 0 | 0 — 13 files, 291 tests | EXECUTED |
| 9 | `cd tools/mcp-server && npm test; echo $?` | 0 | 0 — pass 17, fail 0 | EXECUTED |
| 10 | `git diff --check; echo $?` | 0 | 0 | EXECUTED |
| 11 | `git status --porcelain -uall` | only allocated paths | 2 modified + 2 new paths, all in the allocation | EXECUTED |

## 7. What a visitor sees, before and after

| Case | Before (`5462373`) | After |
|---|---|---|
| Order placed with the email typed `Ana@Example.com` or with a space at an edge | Confirmation page: the generic "Thank you for your order!" panel, no order number, no bank-transfer details | The order details |
| Tracking link from the account page, session email with a capital | The tracking page without the order | The order |
| Order placed with the email typed in lower case | The order details | The order details (unchanged) |

INFERRED for the page texts (from the code cited in `docs/slices/order-checkout-1.md` § 2); the read result is
EXECUTED by § 5.

## 8. Findings

- **F-1 (decision for the human, not blocking).** Only the request side is normalized (packet § 1). The backend sibling
  `orders/public-get.ts:26` normalizes both sides. The two reads of one order now differ for a stored value that is not
  normalized (§ 4.1: possible only for orders of 2026-02-15 to 2026-03-07 with edge whitespace or a non-NFKC character;
  never for capitals). Options: (a) keep request-side only — such an order is found by no request on the renderer page
  (was: by the exact text); (b) normalize both sides as `public-get.ts` does — such an order is found again, and the
  two reads agree; risk: `normalizeEmail(undefined)` throws, so a stored order without `customerEmail` would need a
  guard (the call site is in a server render). Recommended: (a) until a live-table query shows such an order exists.
- **F-2 (observation, Track B).** `docs/plan-commerce-private-table.md:199`, `:596` plan to remove
  `getOrderForCustomer` from the renderer and read through the backend. When that lands, the read becomes
  `public-get.ts` (both sides normalized), and the § 4.1 difference goes away by itself.
- **F-3 (outside the allocation).** `renderer/src/lib/dynamo_ts_MAP.md:24` places `getOrderForCustomer` at `L426`; it
  is at `:516`. A generated map, stale before this slice. Not edited.

## 9. What could not be determined

- Whether any stored order holds a non-normalized `customerEmail` (needs a live-table read per tenant; no scan allowed).
- The exact form of the session email the sign-in provider gives (`AccountPageView.tsx:330`); the fix covers any form
  that `normalizeEmail` folds to the stored value.

## Operator closeout

**Review.** One build, one review, verdict approved; the decision pass converged. Builder `claude-opus-5-5`; reviewer
`claude-sonnet-5-5` (fallback; the Codex reviewer was out). Same provider family; not cross-vendor independence.

**Operator ruling.** ORDER-EMAIL-1-STORED-SIDE = A: the stored side is not normalized here. The only writer of an
order's `customerEmail` stores the normalized form; an order stored before that rule, if one exists, is not found by
these two pages, as before this slice. Production data cannot be read by the operator; reported to the human.

**Operator gates (2026-11-15).** Build, typecheck, shared, plugins, renderer, serving, admin unit, backend unit, MCP,
`git diff --check`: each exit 0. Protected paths, allocation, captures, trailing whitespace: no line.

**Staging.** Not checked live: the confirmation and tracking pages need a placed order, and staging cannot place one
(reCAPTCHA). Deployed to staging together with `price-locale-1`. Proof: the 17 unit rows on the real read function.
