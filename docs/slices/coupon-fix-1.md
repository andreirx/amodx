# COUPON-FIX-1 — the coupon limits are enforced when the order is written

Status: **SHIPPED 2026-11-21 (staging)** — prod deploy pending (human). Drafted 2026-11-20; human 2026-11-21: "continue in the proposed order". Track: commerce. Depends: none. Prerequisite of
`voucher-1`. Defect fixes on existing code; no new feature.

## The defects

Schema: `CouponSchema`, `packages/shared/src/index.ts:2041-2059`.

1. **Per-customer limit.** `perCustomerLimit` is stored and read nowhere (search of `backend/src` and
   `renderer/src`, 2026-11-20). A "once per customer" coupon works without limit.
2. **Product and category limits.** `applicableProducts` and `applicableCategories` are checked only in the
   pre-check the cart calls (`backend/src/coupons/public-validate.ts:119-140`). The order handler does not check
   them (`orders/create.ts:279-305`), so a direct order request applies a course-A coupon to any cart.
3. **Usage limit under load.** The count is raised inside the order transaction without a condition
   (`orders/create.ts:462-473`). Two orders at the same moment both pass `usageCount < usageLimit`
   (`:285`) and a limit of 1 is used twice. (INFERRED from the code; the slice proves it with a test first.)

## Scope

1. One pure function in shared code, "is this coupon valid for this cart and this customer, and what is the
   discount", used by the pre-check and by the order handler. The discount applies to the lines the coupon
   covers, not to the whole cart, when a product or category limit is set.
2. Usage count: the update in the order transaction gets the condition `usageLimit = 0 OR usageCount <
   usageLimit`; a failed condition cancels the order write and answers the coupon refusal.
3. Per-customer limit: a counter item per coupon and normalized email, raised in the same transaction with its
   own condition.
4. The refusal texts go through the tenant's locale table.

## Evidence taxonomy

| Case | Expected |
|---|---|
| coupon limited to product A, cart with A and B | discount on A's lines only; equal in pre-check and order |
| coupon limited to product A, cart with B only | refused in both |
| `usageLimit: 1`, two orders at once | one order written, one refused, `usageCount` = 1 |
| `perCustomerLimit: 1`, same email twice | second refused; another email accepted |
| a coupon with no limits | totals byte-equal to today's (the existing order tests pass unchanged) |

## Deployment notes

Order totals of existing shops change only for coupons that carry a product or category limit; today no live
commerce tenant exists. Records the rule in `docs/commerce.md`. `order-confirm-1` already makes the checkout
show the server's total when it differs.

## Exit criterion

The three rows above that fail today pass, and no other order test changes.

## Build record (2026-11-21, builder; on `main` `d4d7af0`, uncommitted)

Executed under the operator packet of 2026-11-21 (it completes this draft and wins where they differ). Evidence
labels: EXECUTED / OBSERVED / INFERRED / NOT RUN.

### What changed

| Path | Serves |
|---|---|
| `packages/shared/src/coupon.ts` (new) | Packet rules 1-2: `evaluateCoupon(coupon, lines, now)` → `{ applies: true, discountCents, coveredLineIndexes }` or `{ applies: false, reason }`; `amountInCents` |
| `packages/shared/src/index.ts` | Export of the above only |
| `backend/src/orders/create.ts` | A (rule 3: lines from the server's prices and STORED `categoryIds`), C (rule 5 condition), B (rule 6 counter item), rule 7 (second pass) |
| `packages/shared/test/coupon-fix-1.test.ts`, `backend/test/unit/coupon-fix-1.test.ts` (new) | Evidence taxonomy rows |
| `docs/commerce.md`, `backend/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md` | The coupon rule as shop behaviour; key table; test shape |

Abstraction line: what = the coupon rule `evaluateCoupon`; current users = `orders/create.ts` (the pre-check
`coupons/public-validate.ts` waits for `CF1-PRECHECK-LINES`, below); axis = none (it removes duplicated non-trivial
logic; dispatch on `type` is a closed sum with an exhaustive `switch`); rejected = keeping two copies.

### Decisions recorded by the builder

- **Integer cents vs "byte-equal".** The discount is computed in whole cents (percentage rounded half up after the
  `roundToCents` float guard). Without limits the figures equal the old ones except when a percentage result is
  exactly half a cent: the old float arithmetic rounded some of these down (50 % of 0.29 → old 0.14, now 0.15). Grid
  0.01…200.00 × {5, 10, 12.5, 15, 20, 25, 33, 50} %: 1,320 of 160,000 cases differ by one cent (EXECUTED, throwaway
  script). The existing order tests pass unchanged (EXECUTED). Shared test row "50% of 0.29" pins it.
- **Unknown coupon `type`.** The exhaustive `switch` throws for a type outside the schema enum (`coupons/create` and
  `coupons/update` parse with `CouponSchema`, OBSERVED). Before, such an item gave discount 0 and still counted a use;
  now the order answers 500. Reachable only by a hand-edited item (INFERRED).
- **The pre-check's English `reason`** is shown to the visitor as it comes: `renderer/src/components/CartPageView.tsx:59`
  `setCouponError(data.reason || strings.invalidCoupon)` (OBSERVED). Finding per packet rule 9; not changed.

### What a cancelled first attempt leaves behind (rule 7)

The order number is taken by a separate `UpdateCommand` on `COUNTER#ORDER` BEFORE the transaction (OBSERVED,
`orders/create.ts`). A cancelled transaction applies none of its items (DynamoDB transaction semantics): no `ORDER#`,
`CUSTORDER#`, `CUSTOMER#` change, no `usageCount` raise, no `COUPONUSE#` raise. The handler writes no stock (no stock
attribute is read or written by `orders/create.ts`, OBSERVED by search). The second pass keeps the same `orderId` and
order number, so the counter is raised once. When the second pass answers 409 (the visitor's total included the
discount), that order number stays unused: a gap in the `PPB-` sequence. Each per-customer reuse attempt whose cart
showed the discount produces such a gap (the cart cannot know the customer).

### Stop: the pre-check (packet rule 8) — not changed

The cart sends `{ code, subtotal: String(subtotal), items: items.map(i => ({ productId: i.productId })), recaptchaToken }`
(`renderer/src/components/CartPageView.tsx:53`, OBSERVED): no quantity, no line total, no category. With that input the
pre-check cannot compute the covered-lines discount that rule 8 requires, and the renderer is outside the allocation.
`coupons/public-validate.ts` is unchanged; see decision `CF1-PRECHECK-LINES` in the builder report. Consequences
today: (1) for a product-limited coupon the cart shows the whole-subtotal discount, and the checkout then gets the 409
with the server's lower discount; (2) a category-limited coupon is refused by the pre-check (no `categoryIds` arrive),
so the cart never stores it and the checkout never sends it — category coupons cannot be used from the shop's UI
(OBSERVED from the code; pre-existing).

### Findings (not changed)

1. Category-limited coupons cannot be applied from the cart (above).
2. A date-only `validUntil` (the admin field is `type="date"`, `admin/src/pages/CouponEditor.tsx:171`) ends the coupon at
   the start of that day, because `"2026-11-21T…Z" > "2026-11-21"` as text. Kept as before (both handlers compared this way).
3. Coupon money texts (`value`, `minimumOrderAmount`, `maximumDiscount`) are read with `parseFloat`, not with the
   tenant's locale (`parseMoney`); `value` is not validated as a number at write. Kept as before.
4. `coupons/delete.ts` deletes `COUPON#` and `COUPONCODE#` only; `COUPONUSE#` items stay (OBSERVED).
5. A coupon deleted between the order's read and its write: the `usageCount` update (no `attribute_exists(PK)`) creates a
   stub `COUPON#` item. Before this slice too.

### Evidence

| Row | Test | Result |
|---|---|---|
| C before the fix | backend "C regression" on `d4d7af0` | EXECUTED: red, `ConditionExpression` undefined |
| Same file on `d4d7af0` (temp worktree, removed) | all 18 backend rows | EXECUTED: 12 red; the 6 green are the rows that keep today's behaviour (2 goldens, the cap row, `perCustomerLimit: 0`, two rethrow rows) |
| without limits, percentage / fixed | shared goldens + backend goldens; existing order suites | EXECUTED: pass |
| product A, cart A + B | shared + backend | EXECUTED: pass (order handler only; pre-check NOT RUN — stop) |
| category by the server's record; false request category | backend (2 rows) | EXECUTED: pass |
| product A, cart B only: no discount / 409 | shared + backend (2 rows) | EXECUTED: pass (order handler) |
| fixed over covered; percentage cap; minimum on whole cart | shared + backend | EXECUTED: pass |
| C race: second pass, 201 without discount / 409; `usageCount` not raised; one order number | backend (3 rows) | EXECUTED: pass |
| B: same email twice (capitals, spaces), other email | backend | EXECUTED: pass |
| B: `perCustomerLimit: 0` → no `COUPONUSE#` | backend | EXECUTED: pass |
| other cancellation → rethrown | backend (2 rows) | EXECUTED: pass (500 `Internal error`) |
| rule function: each reason, boundary dates, `usageCount == usageLimit` | shared | EXECUTED: pass |
| staging checks | — | NOT RUN (operator's) |

## Build record — revision 1 (2026-11-21, builder; after review-0 and the operator rulings of packet § 6)

### Correction to the first build record

The first record says that, without limits, only a percentage result of exactly half a cent changes. That is
incomplete. Under ruling CF1-MONEY-PRESERVATION = B (cents win) the money rule is: every coupon money text (`value` of
a fixed coupon, `maximumDiscount`, `minimumOrderAmount`) is converted to whole cents, rounded half up, when it is
read; a percentage discount is the percent of the covered sum in cents, rounded half up; comparisons are in cents.
Four classes of outcome change compared with the float arithmetic before this slice, one witness each (shared tests
"money rule CF1-MONEY-PRESERVATION = B", EXECUTED):

| Class | Witness | Before | Now |
|---|---|---|---|
| percentage tie | 50 % of 0.29 | 0.14 | 0.15 |
| fixed value with a third decimal | `"0.145"` | 0.14 | 0.15 |
| cap with a third decimal | `maximumDiscount` `"0.145"` | 0.14 | 0.15 |
| minimum with a third decimal | subtotal 1.00, minimum `"1.004"` | does not apply | applies |

Grid measured earlier (percentage ties only): 1,320 of 160,000 cases differ by one cent. The code did not change for
this ruling (it already converted at read); the rule is now stated in `coupon.ts`, `docs/commerce.md` and
`packages/shared/ARCHITECTURE.md`.

### What changed in this revision

| Path | Serves |
|---|---|
| `packages/shared/src/coupon.ts` | Finding 1: `customer-limit` in the union, checked only when the caller passes `customerUseCount`. Unknown type: `isCouponType` (a `Record` over the enum, so a new enum type fails to compile). CF1-PRECHECK-LINES = B: `CouponPrecheckItemSchema`, `COUPON_PRECHECK_MAX_LINES` (shared-first type of the request line) |
| `packages/shared/src/index.ts` | Export line extended only |
| `backend/src/orders/create.ts` | Finding 1: consistent read of `COUPONUSE#…` before the totals when `perCustomerLimit` > 0; the key is computed once and reused by the transaction. Unknown type → not applied, one `console.warn` with the coupon id |
| `backend/src/coupons/public-validate.ts` | Rule 8: the shared rule on the cart's lines; categories from one tenant-scoped `BatchGet`; > 50 lines → 400; old body → one line of the subtotal; reason union mapped to the existing texts; unknown type → `valid: false` "Coupon cannot be used" + `console.warn` |
| `renderer/src/components/CartPageView.tsx` | Named exception (ruling CF1-PRECHECK-LINES = B): the pre-check request body only — per line `productId`, `quantity`, `lineTotal: cartLineTotal(i)` |
| `renderer/test/unit/coupon-fix-1-cart.test.ts` (new) | The cart's request body |
| `packages/shared/test/coupon-fix-1.test.ts`, `backend/test/unit/coupon-fix-1.test.ts` | Rows below |
| `docs/commerce.md`, `backend/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md` | Money rule, per-customer read, pre-check request and behaviour |

Abstraction lines: `isCouponType` — users `orders/create.ts`, `coupons/public-validate.ts`; axis none (one guard
instead of two enum copies); rejected = catching the rule's throw. `CouponPrecheckItemSchema` — users
`coupons/public-validate.ts` (parse), `CartPageView.tsx` (type); axis none (Critical Rule 4, shared-first type of a
request crossing the browser/API boundary); rejected = a local backend schema the renderer cannot check against.

### Finding 1 — what happens to the order number

With the counter read before the totals, a request whose `expectedTotal` included the discount of a used-up
per-customer coupon gets 409 BEFORE the `COUNTER#ORDER` update: no order number is taken (test "finding 1
regression": only reads). The confirming request (the returned total) takes one number and is written without the
discount. A number stays unused only in the race case (another order of the same customer between the read and the
transaction) when the second pass answers 409 — as recorded in the first build record.

### The per-customer counter key (rule 6; missing from the first record)

`COUPONUSE#<couponId>#<sha256 hex of normalizeEmail(email)>` on `PK = TENANT#<tenantId>` of the main table. The hash
keeps a plain email address out of a NEW key of the main table (the existing `CUSTOMER#<email>` / `CUSTORDER#<email>`
keys are unchanged). Track B (commerce-private, `cmrc-*`) decides the item's final table.

### Unknown coupon type

Both handlers test `isCouponType` before the rule: such a record is a coupon that does not apply, never a 500 (the
first build record's 500 is replaced). `evaluateCoupon` keeps its exhaustive `switch` and still throws for direct
callers that skip the guard.

### Evidence (revision 1)

| Row | Test | Result |
|---|---|---|
| finding 1: used-up per-customer coupon, discounted total → 409 without discount, no number; returned total → 201 without discount | backend "finding 1 regression" | EXECUTED: pass. Red on the iteration-0 handler: INFERRED (no copy kept; the review-0 reproduction shows the number taken and a 409 with the discount) |
| B: same email twice (capitals, spaces) → refused at the consistent read; other email applied | backend | EXECUTED: pass |
| B race: stale read → cancelled on `COUPONUSE#` → second pass | backend | EXECUTED: pass |
| A + B cart: same discount in the pre-check and the order handler (7.5) | backend | EXECUTED: pass |
| category-limited coupon accepted from the cart body; false request `categoryIds` ignored | backend (2 rows) | EXECUTED: pass |
| old cart body: unlimited → answer as before; limited → "does not apply" | backend (2 rows) | EXECUTED: pass |
| > 50 lines → 400; invalid line → 400; `UnprocessedKeys` retry / exhaustion → 500 | backend (3 rows) | EXECUTED: pass |
| reason texts per union value; unknown type (pre-check and order handler) | backend (8 rows) | EXECUTED: pass |
| the cart's request body | renderer `coupon-fix-1-cart.test.ts` | EXECUTED: pass; on `d4d7af0` + new shared: fails (old body) |
| all backend rows on `d4d7af0` + new shared (temp worktree, removed) | — | EXECUTED: 24 failed, 15 passed; the 15 are preservation rows (unchanged texts, old body without limits, goldens, cap, `perCustomerLimit: 0`, rethrows) |
| money witnesses (4 classes) | shared | EXECUTED: pass |
| gates `r1-*` | see builder report | EXECUTED: all exit 0 |
| staging checks | — | NOT RUN (operator's) |

### Findings (recorded, not changed)

Findings 2–5 of the first record stand. Finding 1 of the first record (category coupons cannot be used from the cart)
is fixed by this revision. Added:

6. The MCP tools `list_coupons` / `create_coupon` (`tools/mcp-server/src/index.ts:1380-1412`) use `type` `percent` /
   `fixed` and an `active` flag; the schema has `percentage` / `fixed_amount` and `status`. `coupons/create` parses with
   `CouponSchema`, so `create_coupon` cannot create a coupon (OBSERVED from the code; not run).
7. A cart line whose `cartLineTotal` is NaN (an old item with an unreadable price text) is sent as `lineTotal: null`;
   the pre-check answers 400 `Invalid items` and the cart shows its generic invalid-coupon text (INFERRED from the
   code). The order handler refuses such a cart anyway.

## Build record — revision 2 (2026-11-21, builder; after review-1, finding CF1-SIDE-EFFECT-CLAIMS)

**Class of defect:** a side-effect guarantee stated without the condition it holds under. The 409 of `order-confirm-1`
was documented as "before the first write, nothing written"; since rule 7 the same comparison also runs in a second
pass, after the `COUNTER#ORDER` update and a cancelled transaction.

**Rule applied to every statement of that guarantee in the allocation:** a statement of what a 409 writes names the
pass. First pass (an initial total mismatch): before any write, nothing written. Second pass (the coupon lost a race):
the order number taken in the first pass stays unused; the cancelled transaction applied none of its items; no mail.
Search basis: `grep -n -i "no write|nothing is written|writes nothing|nothing written|before the first write|before
any write|no counter update|nothing read|only reads|no order number"` over the allocated docs, handler and tests.
(This command is wrong as written — no `-E`, so `|` is a literal character. Corrected in revision 3 below.)

| Place | Change |
|---|---|
| `docs/commerce.md` § Total Confirmation | Split into first pass / second pass |
| `backend/ARCHITECTURE.md` (ORDER-CONFIRM-1 bullet) | Same qualification |
| `backend/src/orders/create.ts` (comment above the comparison) | Same qualification; no code change |
| `backend/test/unit/coupon-fix-1.test.ts` | Test title "nothing read" → "no product BatchGet" (what it asserts); new row: per-customer race with the discounted `expectedTotal` → 409 without discount, one `COUNTER#ORDER` update, one cancelled transaction, no counts raised, no mail |

The other matches were checked and are accurate as written: the first-pass 409 test "… nothing written" asserts
only reads; the finding-1 statements ("no order number is taken") describe the refusal at the counter read, before
any write. No behaviour change in this revision.

## Build record — revision 3 (2026-11-21, builder; after review-2, finding CF1-SEARCH-RECORD)

**Correction.** The search command recorded in revision 2 has no `-E`. A basic-regex `grep` such as `/usr/bin/grep`
reads `|` as a literal character, so that command finds nothing (review-2: exit 1, no matches). In the builder's
shell, `grep` is a shell function, not `/usr/bin/grep`; the revision-2 account was not produced by the command as
written. The corrected command, run in revision 3 (EXECUTED):

```
/usr/bin/grep -n -E -i "no write|nothing is written|writes nothing|nothing written|before the first write|before any write|no counter update|nothing read|only reads|no order number" \
  docs/commerce.md backend/ARCHITECTURE.md packages/shared/ARCHITECTURE.md backend/src/orders/create.ts \
  backend/test/unit/coupon-fix-1.test.ts docs/slices/coupon-fix-1.md
```

Result, run before this entry and the note above were added: exit 0, 28 matching lines (saved as `.agent-manager/slices/COUPON-FIX-1/r3-search.log`, the relay's
operational directory). `rg -n -i` with the same pattern and files: 28 lines. With this entry added, the same command returns more lines; the
extra ones are this entry's own text. Classification:

| Matches | Assessment |
|---|---|
| `docs/commerce.md:335, 346, 354-355`; `backend/ARCHITECTURE.md:491`; `backend/src/orders/create.ts:353` | The 409 / no-write statements of this slice: each names its pass or its condition (revision 2 rule) |
| `backend/ARCHITECTURE.md:518` | ORDER-PRICE-1 refusals (variant, price text) happen in the product loop, before both passes: accurate |
| `backend/test/unit/coupon-fix-1.test.ts:209, 325, 331` | First-pass 409 asserting only reads; the finding-1 refusal at the counter read: accurate |
| `docs/slices/coupon-fix-1.md` (record text) | Descriptions of the rule and of this search |
| `backend/ARCHITECTURE.md:80, 104, 177, 247, 263, 297, 367, 479`; `docs/commerce.md:630` | Other handlers and features, not the order handler's 409: out of this class |

Limitation (unchanged): this is a search for these wordings. It finds only statements written with them; it is not
proof that no other statement of the guarantee exists. No behaviour, test or other doc change in revision 3.

## Operator closeout (2026-11-21)

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, four cycles. Review-0 escalated (a repeated 409 for a used
per-customer coupon; the pre-check not changed; rounding changed more widely than recorded); reviews 1 and 2 asked
for corrections; review-3 approved, with the main cases reproduced by the reviewer.

**Operator rulings (shop rules by recommendation, human directive 2026-11-15; production has demo shops only).**
CF1-PRECHECK-LINES = B: the cart sends quantity and line total per line; the pre-check reads categories from the
tenant's product records; it stays advisory. CF1-MONEY-PRESERVATION = B: one coupon money rule in whole cents,
rounded half up (the packet had asked for both integer cents and unchanged bytes; cents win). A coupon record with
an unknown `type` does not apply and is logged. The customer's counter is read before the totals.

**Gates (operator run on the approved tree).** build 0, typecheck 0, shared 0, plugins 0, renderer 0, serving 0,
admin unit 0, backend unit 0, mcp 0, `git diff --check` 0. Oracles: no change under `infra/`, any `package.json`,
the lockfile or the serving-contract suite; every changed path in the allocation.

**Staging.** `cdk diff`: 51 functions change by code only (they bundle the shared package), plus the renderer and
admin assets; no resource added or removed; no permission change. Deployed to `AmodxStack-staging`.
The 51 CM1 reference URLs against the capture taken after `next-patch-1`: status, headers, `lang` and words equal
on 51 of 51. `POST /public/coupons/validate` and `POST /public/orders` answer 400 to an empty body (the handlers
load). `/_site/cm1-commerce/cart` and `/checkout` answer 200.

**Not proven on staging.** The coupon rules end to end: both routes need a reCAPTCHA answer that the staging
address cannot give. They rest on the unit tests (shared 411, backend 1528) and on the reviewer's reproductions.
The first real coupon order on a shop is the live check.

**Findings left open (recorded above, not changed).** A date-only `validUntil` ends the coupon at the start of that
day; coupon money texts are not validated at write and not read by the site's locale; deleting a coupon leaves
its `COUPONUSE#` items; the cart shows the pre-check's English refusal text; the MCP coupon tools use type and
status names that differ from the schema. `COUPONUSE#` is a new item family keyed by a hash of the customer's
email: Track B decides its table.
