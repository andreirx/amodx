# ORDER-CHECKOUT-1 — a cash-on-delivery order is accepted and the confirmation page gets its order (implementation record)

Status: **BUILT** (2026-11-15, builder), uncommitted, awaiting review. Start: `main` at `3f75f18`, tree clean. All 11
oracles of the packet's § 4 pass (§ 6). No allocation addition. Maturity: **PROTOTYPE** until the operator places one
cash-on-delivery order and one bank-transfer order on a deployed site and sees each confirmation page with its order
number (the staging reCAPTCHA and address limit of `order-price-1` still applies; packet § 6 non-scope).

## 1. Human direction (quoted)

> "no reason not to fix things that can be fixed right now"

The defects: `docs/slices/order-price-1.md`, Operator closeout, F-10 (cash-on-delivery orders are refused) and F-11
(the confirmation address gets no order id).

## 2. Root cause

The packet's § 0 items 1-2 are confirmed on `3f75f18` (OBSERVED in the base tree; sites cited there).

**F-10.** The checkout sends `paymentMethod: "cash_on_delivery"` (its default `CheckoutPageView.tsx:204` and its radio
`:584`). `OrderInputSchema` (`packages/shared/src/index.ts:1786`) accepted only `"cod"` or `"bank_transfer"`. The
handler parses the body with this schema before any other work (`backend/src/orders/create.ts:41-50`) and answers 400
`"Invalid input"`; the checkout shows that text (`CheckoutPageView.tsx:370`). The tenant default is
`enabledPaymentMethods: ["cash_on_delivery"]` (`index.ts:1206`), so a shop with the default setting could take no
online order. EXECUTED before-proof: § 5 row R1 and R2 run against the old schema (the `packages/shared/dist` build of
`3f75f18`, before this slice's build) fail with the only Zod issue on `paymentMethod`: "Invalid option: expected one of
"cod"|"bank_transfer"".

**F-11.** Both success answers of the handler are `{ orderId, orderNumber, couponDiscount }`
(`create.ts:462-464`, `:579-581`). The checkout built the confirmation address from `order.id`
(`CheckoutPageView.tsx:380`), so the address held the text `id=undefined`. The confirmation route
(`renderer/src/components/SitePage.tsx:525-532`) calls `getOrderForCustomer(tenant, "undefined", email)`
(`renderer/src/lib/dynamo.ts:489-502`): a `GetCommand` on `ORDER#undefined` finds no item and returns `null`.
`ConfirmationPageView` with `order = null` (`SitePage.tsx:1657-1667`) shows only the generic panel ("Thank you for
your order!", "Your order has been placed successfully…", "Continue shopping"): no order number, no bank-transfer
details, no item list, no Facebook `Purchase` event, no celebration (all of these are in the `order` branch,
`:1670` on). INFERRED from the code; the address half is EXECUTED in § 5 row R3's before-proof.

**Regression or never worked.**

- F-10: **regression since `c4aaf3c` (2026-03-07).** EXECUTED `git log -S'z.enum(["cod", "bank_transfer"])' --
  packages/shared/src/index.ts` → only `c4aaf3c` ("added Zod validation, reCAPTCHA, rate limiting…"). Before it, the
  handler had no input schema and stored the value as sent: `git show 61957b8:backend/src/orders/create.ts` line 130
  `paymentMethod: paymentMethod || null`, and `git show 61957b8:renderer/src/components/CheckoutPageView.tsx` line 45
  sends `"cash_on_delivery"`. From `61957b8` (2026-02-15) to `c4aaf3c` cash-on-delivery orders were accepted.
- F-11: **never worked.** EXECUTED `git log -S'?id=${order.id}' -- renderer/src/components/CheckoutPageView.tsx` →
  only `61957b8`; `git show 61957b8:backend/src/orders/create.ts` lines 189-190 answer `{ orderId, orderNumber }`. The
  answer and the reader disagreed in the commit that created both.

### 2.1 Search for the value `"cod"` (packet § 0 item 1, extended)

Basis (EXECUTED, deterministic text search over all tracked files; no index or embedding tool used):

- `git grep -nE "[\"'\`]cod[\"'\`]"` (all tracked files except `package-lock.json`): the schema line; the five test
  bodies of the packet (`backend/test/unit/catalog-mode.test.ts:420`, `email-key-normalization.test.ts:107`,
  `order-price-1.test.ts:64`; `packages/shared/test/normalizeEmail.test.ts:219`, `order-price-1.test.ts:137`); three
  docs (`docs/ROADMAP.md:220` and `docs/slices/order-price-1.md:287` describe the defect;
  `docs/plan-security-and-caching-remediation.md:265` is the plan that added it — finding F-5).
- `git grep -niwE "cod"` (whole word, any case, excluding `docs/` and the lock file): only display texts `"COD"` in
  the admin (`Orders.tsx:37`, `OrderDetail.tsx:44`, `Settings.tsx:1219`, `Labels.tsx:870`) and the Romanian word
  "cod" (product code) in the import parser and its CSV fixtures. No sender of a payment value.
- `git grep -nE "paymentMethod|payment_method" -- tools tests scripts infra`: no hit. The MCP server lists
  `POST /public/orders` in `routes.json` but no tool sends an order (`git grep -niE "payment" -- tools/mcp-server/src`
  → only the reports text).
- `git grep -n "public/orders"` (excluding docs and locks): the only sender is `CheckoutPageView.tsx:355`.

Limit: a sender outside this repository (a hand-made request, a tool not in git) is not covered. No caller in the
repository sends `"cod"`; the stop condition of § 1 item 1 did not trigger.

## 3. What changed

| File:line | Change | Serves |
|---|---|---|
| `packages/shared/src/index.ts:1786-1787` | `OrderInputSchema.paymentMethod`: `z.enum(["cash_on_delivery", "bank_transfer"])` (was `"cod"`), with a one-line comment | § 1 item 1 |
| `renderer/src/components/CheckoutPageView.tsx:380-381` | the confirmation address reads `order.orderId` (was `order.id`), with a one-line comment naming the answer shape | § 1 item 2 |
| `docs/commerce.md:237-240` | "Post-Checkout": the real address (`<checkout><checkoutConfirmation>?id=<orderId>&email=<email>`, was `/checkout-confirm/{orderId}`), the answer shape, and the not-found panel | documentation of § 1 item 2 |
| `backend/test/unit/catalog-mode.test.ts:420`, `backend/test/unit/email-key-normalization.test.ts:107`, `backend/test/unit/order-price-1.test.ts:64`, `packages/shared/test/normalizeEmail.test.ts:219`, `packages/shared/test/order-price-1.test.ts:137` | the order body sends `"cash_on_delivery"` (was `"cod"`); no assertion changed | preservation (§ 2 of the packet) |
| `renderer/test/unit/order-price-1.test.ts:170`, `renderer/test/unit/cmrc-counties-1-checkout.test.ts:135` | the mocked order answer is `{ orderId: "o1", … }` (was `{ id: "o1", … }`, the wrong contract of F-11); no assertion reads it | preservation: a fixture states the server's real answer |
| `backend/test/unit/order-checkout-1.test.ts` (new) | 5 rows: the real handler, mocked `db.js`, origin, reCAPTCHA, SES | taxonomy |
| `renderer/test/unit/order-checkout-1.test.ts` (new) | 4 rows: real `CartProvider`, `CheckoutPageView`, shared schema; `router.push` spy | taxonomy |

Test names: no test was named for the old value (search of the test names for `cod`: none), so no rename.

Abstractions: none added. The change is one schema value and one property name.

Choices recorded (decided under the ratified behaviour; none crosses a boundary):

1. **`docs/commerce.md` edited at one line only** (the redirect). Line 190 already names `cash_on_delivery`,
   `bank_transfer`, so the payment text needed no edit. The redirect line described the address this slice repairs,
   in a form the code never used.
2. **The two renderer answer mocks** carried `{ id: "o1" }`. They did not assert the address, so they passed with the
   defect. They now carry the real answer shape, so the fixtures do not restate the defect.
3. **The renderer schema rows fill only visitor-typed texts** (name, street, city, county) before the full
   `OrderInputSchema` parse; `paymentMethod` and the items stay as the checkout sent them. The form's HTML `required`
   does not run under `dispatchEvent`. The before-proof shows that with these fills the only issue the old schema
   reports is `paymentMethod`.

## 4. Ratified behaviour — status

1. `OrderInputSchema.paymentMethod` accepts `"cash_on_delivery"`, `"bank_transfer"`; refuses `"cod"`: done (rows B1-B3).
   The handler stores the value as it arrives (`create.ts:353` unchanged): row B1.
2. The checkout reads `orderId`: done (row R3).
3. Nothing else changes: the mail's payment text (`create.ts:523`), the stored order, the admin — untouched (diff:
   § 3 only).

## 5. Evidence taxonomy — each row and the test that binds it

B = `backend/test/unit/order-checkout-1.test.ts`, R = `renderer/test/unit/order-checkout-1.test.ts`. All EXECUTED,
passed on the final tree (§ 6).

| Input | Expected | Test |
|---|---|---|
| order input with `cash_on_delivery` | accepted; the stored order holds `cash_on_delivery` | B1 `"cash_on_delivery" → 201; the stored order holds "cash_on_delivery"; the answer's orderId is the stored order id` |
| order input with `bank_transfer` | accepted | B1 (same loop) `"bank_transfer" → 201; …` |
| order input with `cod` | refused (400 at the handler) | B2 `"cod" (the old input value) → 400 "Invalid input", the details name paymentMethod, no database call` |
| order input with another text | refused (400) | B2 `another text ("card") → 400 …` |
| order input without the field | refused (400) | B2 `no paymentMethod field → 400 …` |
| the checkout's default payment value, through the real schema | accepted | R1 `the default value (no enabledPaymentMethods given) is sent and accepted` — the value is the checkout's own state, read from the sent request; R2 `each payment radio the checkout renders, when chosen, is sent as its value and accepted` — the values are read from the checkout's rendered radios |
| order answer `{ orderId: "X" }` | the confirmation address holds `id=X` | R3 `order answer { orderId: "o-123", … } → the address holds id=o-123` |
| order answer without `orderId` | today's behaviour, kept | R4 `order answer without orderId → today's behaviour is kept: the address holds the text id=undefined` (finding F-4) |

Extra checks in the rows (not in the packet table): B1 asserts the answer keys are exactly `couponDiscount`,
`orderId`, `orderNumber` and that `orderId` equals the stored order's `id` — the server side of the F-11 contract. B2
asserts no database call (the schema runs before the tenant read, `create.ts:41` before `:69`).

Before-proofs (EXECUTED; each shows the row is bound to the defect):

- R1, R2 against the old schema: run before this slice's build, when `packages/shared/dist` was still the `3f75f18`
  build (the renderer resolves `@amodx/shared` to `dist`; the backend unit config aliases it to `src`, so the backend
  rows cannot be run against the old schema this way). Result: R1, R2 failed, "Invalid option: expected one of
  "cod"|"bank_transfer"" on `paymentMethod` only; R3, R4 passed.
- R3 against the old address line: one shell command swapped `?id=${order.orderId}&` back to `?id=${order.id}&` (a
  literal `node` replace, checked to match once), ran R, and restored the file through a `trap`. Result: R3 failed,
  R1, R2, R4 passed. After the restore: `grep -nF` shows `order.orderId` at `:381`; R 4/4 passed again.

NOT RUN: B rows against the old schema (see the first bullet). `cd backend && npm test` (writes to a live table; by
rule).

## 6. Gates (packet § 4) — each run bare, exit code from `echo $?`

Output went to `/tmp/ORDER-CHECKOUT-1-*.log` (deleted after the run); the counts below were read from them.

| # | Command | Expected | Result | Label |
|---|---|---|---|---|
| 1 | `npm run build; echo $?` (root) | 0 | 0 | EXECUTED |
| 2 | `npm run typecheck; echo $?` (root) | 0 | 0 | EXECUTED |
| 3 | `cd packages/shared && npm test; echo $?` | 0 | 0 — 19 files, 338 tests | EXECUTED |
| 4 | `cd backend && npm run test:unit; echo $?` | 0 | 0 — 52 files passed, 1 skipped; 1376 passed, 1 skipped (was 51 / 1371: + B's 5 rows) | EXECUTED |
| 5 | `cd renderer && npm test; echo $?` | 0 | 0 — 34 files, 496 tests (was 33 / 492: + R's 4 rows) | EXECUTED |
| 6 | `cd renderer && npm run test:serving; echo $?` | 0, no capture changed | 0 — 113 / 113; `git status --porcelain -uall -- renderer/test/serving-contract` empty before and after | EXECUTED |
| 7 | `cd packages/plugins && npm test; echo $?` | 0 | 0 — 6 files, 204 tests | EXECUTED |
| 8 | `cd admin && npm run test:unit; echo $?` | 0 | 0 — 13 files, 283 tests | EXECUTED |
| 9 | `cd tools/mcp-server && npm test; echo $?` | 0 | 0 — 17 / 17 | EXECUTED |
| 10 | `git diff --check; echo $?` | 0 | 0; `grep -n " $"` on the two new test files and this record: no match | EXECUTED |
| 11 | `git status --porcelain -uall` | only allocated paths | 10 modified + 3 new paths, all in the allocation list (§ 3 and this record) | EXECUTED |

The B and R rows were also run by name (`--reporter=verbose`): 5 / 5 and 4 / 4 passed.

## 7. What a visitor sees, before and after

| Case | Before (`3f75f18`) | After |
|---|---|---|
| Cash on delivery chosen (the default for a tenant with the default setting) | "Invalid input" under the form; no order is written; no mail | The order is written with `paymentMethod: "cash_on_delivery"`; the confirmation page shows "Order Confirmed!", the order number, the items |
| Bank transfer chosen | The order is written, but the confirmation page shows only the generic "Thank you for your order!" panel: no order number, **no bank-transfer details (IBAN)** on the page; the Facebook `Purchase` event does not fire | The confirmation page shows the order number and the bank-transfer details; the `Purchase` event fires |
| Any accepted order where the visitor typed the email with a capital letter or a space | Generic panel (by F-11) | Generic panel still — finding F-1 |

INFERRED for the page texts from the code cited in § 2; the request, the stored value and the address are EXECUTED by
B and R.

## 8. Findings

- **F-1 (adjacent defect, not fixed: outside the ratified behaviour).** The confirmation page matches the order email
  as typed: the checkout puts `form.customerEmail` raw in the address (`CheckoutPageView.tsx:381`), the handler
  stores `normalizeEmail(customerEmail)` (NFKC, trim, lower case; `create.ts:39`, `:348`), and
  `getOrderForCustomer` compares with `!==` (`dynamo.ts:498`). A visitor who types `Ana@Example.com` gets the generic
  panel after this fix too. Same for the tracking page (`SitePage.tsx:535-540`) if its email comes from the visitor.
  Proposed follow-up: normalize on the read side (`getOrderForCustomer`), which covers confirmation and tracking.
  That touches `renderer/src/lib/dynamo.ts` (serving suite required) and is a `fnd-2` call-site class.
- **F-2 (packet § 6, report).** `sessionStorage` item `amodx_last_order` is written (`CheckoutPageView.tsx:377`) and has
  no reader: `git grep -n "amodx_last_order"` over all tracked files outside `docs/slices/` finds only that writer and
  `docs/commerce.md:234`, which says it is "for confirmation page" — that text is false. It holds the order answer
  (`orderId`, `orderNumber`, `couponDiscount`) for the tab's life. Proposed: delete the write and the doc line, or
  name a reader.
- **F-3 (non-scope).** The handler does not check `paymentMethod` against the tenant's `enabledPaymentMethods`
  (`git grep enabledPaymentMethods backend/src/orders/create.ts`: no hit). A hand-made request can place a
  bank-transfer order at a cash-on-delivery-only shop, and the reverse.
- **F-4 (row R4, kept).** An order answer without `orderId` gives the address text `id=undefined`, one `GetCommand`
  on `ORDER#undefined`, and the generic panel. Today no answer of the handler lacks `orderId` (both 201 returns carry
  it), so the case needs a server change to occur. The generic panel is a safe outcome (the order was accepted). Not
  wrong enough to change under "keep it"; a later change could leave out `id=` when it is absent.
- **F-5 (documentation outside the allocation).** `docs/plan-security-and-caching-remediation.md:265` shows
  `paymentMethod: z.enum(["cod", "bank_transfer"])` — the plan that introduced the defect. Not edited (a historical
  plan, not in oracle 11's list). Proposed: a note that `order-checkout-1` replaced `"cod"`.
- **F-6 (observation).** `create.ts:353` stores `paymentMethod || null`. The `|| null` can no longer apply (the
  schema requires one of two non-empty texts). Unchanged by rule (§ 1 item 3: the stored order as today).
- **F-7 (bookkeeping, outside the allocation).** `docs/ROADMAP.md:220` lists `order-checkout-1` as "QUEUED"; the
  status change is the operator's at closeout.

## 9. What could not be determined

- Whether any stored order holds `"cod"`. The checkout never sent it (§ 2.1, history), so only a hand-made request
  could have stored it between `c4aaf3c` and now. A read of the live table was not done (no AWS access in this run, and
  no scan is allowed). The admin label maps (`Orders.tsx:37`, `OrderDetail.tsx:44`) would show such a value raw.
- How many cash-on-delivery orders were refused since `c4aaf3c`: the handler answers 400 without a log line for a
  schema refusal (`create.ts:42-50`), so CloudWatch would show only the API status codes.

## Operator closeout

**Review.** One build, one review, verdict approved. Builder `claude-opus-5-5`; reviewer `claude-sonnet-5-5` (the
fallback: the Codex reviewer was out on its usage limit; human directive 2026-11-15). Same provider family for both
roles; not cross-vendor independence.

**Operator gates (2026-11-15, on the reviewed tree).** Build, typecheck, shared, plugins, renderer, serving, admin
unit, backend unit, MCP, `git diff --check`: each exit 0. Protected paths, allocation, captures, trailing whitespace:
no line.

**Staging (deployed 2026-11-15; diff read first, the usual shape: function code and metadata, two bucket
deployments, the admin runtime config, three nested-stack descriptions).** Direct `POST /public/orders` on tenant
`cm1-commerce` with the tenant's origin. The handler checks the origin, then the input schema, then reCAPTCHA.

| Request | Answer | Meaning |
|---|---|---|
| `paymentMethod: "cod"` | 400 "Invalid input", `paymentMethod`: expected `cash_on_delivery` or `bank_transfer` | the old value is refused |
| `paymentMethod: "cash_on_delivery"`, a personalization without `id` | 400 "Verification required" | the input passed the schema (F-10 fixed; also the `order-price-1` schema fix); reCAPTCHA stopped it |

**Not checked on staging:** a placed order (reCAPTCHA is required and a script has no token), so the confirmation
address with `orderId` (F-11) and the server price path of `order-price-1` are proven by unit tests only.

F-7 (the ROADMAP row) is closed by the operator in the same commit. F-1 (the confirmation and tracking pages compare
the email as typed with the stored normalized email) is reported to the human as the next small fix.
