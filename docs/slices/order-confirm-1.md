# ORDER-CONFIRM-1 — no visitor is charged a total they did not see (implementation record)

Status: **IMPLEMENTED** (2026-11-15, builder, iteration 1 after review-0 and the operator's ruling OC1-TEXT = A),
uncommitted, awaiting review. Start: `main` at `c52fdf1`, tree clean. All oracles of packet § 4 pass (§ 7). Maturity
target: **PROTOTYPE** until the operator places one order on staging after a price change.

## 1. Human direction (quoted)

The question: a price changes after the visitor filled the cart; the cart shows the old price and the server charges
the new one. Option B: "the server compares its total with the total the visitor saw, and on a difference refuses the
order and shows the new prices", the visitor confirms.

> "I don't make shop policy - if you recommend B then do B and document that"

Ratified behaviour (packet § 1; the code comments cite these items as "§ 1 item N"). The invariant: an order is
created only with a total the visitor saw.

1. The order request carries `expectedTotal`, the total on the Place Order screen rounded to cents (optional, finite,
   ≥ 0). A claim to compare with, never a price to charge.
2. After its own total and before any write, the server compares the two in whole cents. Different → 409, no write,
   answer `code: "price-changed"`, English `error`, `total`, `subtotal`, `shippingCost`, `couponDiscount`, and per
   request item in request order `productId`, `selectedVariant`, `quantity`, `unitPrice`, `totalPrice`. Only figures of
   the request's own items; nothing else of the product or the tenant. **Amended by ruling OC1-TEXT = A (operator,
   2026-11-15):** the answer also holds ONE field `message`, the tenant's text of the commerce key `pricesChanged` (its
   override, else the language pack of its locale; a blank override gives the pack text) — a public label the tenant's
   own site shows. `error` stays English; `code` stays the machine value.
3. No `expectedTotal` → handled as before, no comparison.
4. On `price-changed` the checkout does not navigate, shows one text from the tenant locale table (the answer's
   `message`; an answer without a usable `message` → its `error`, as the other refusals) and the server's figures; the next press sends that total. A cart change drops the shown figures. The cart items take the server's
   unit prices.
5. The admin Labels page lists the new key; this slice's locale coverage file allocates it.
6. No change when the totals agree; the checkout's first render stays byte-identical for every captured row (stands
   as written: no key is added to the checkout's `strings` prop).

## 2. The behaviour, as a shop owner reads it

**An order is created only with a total the visitor saw.** The checkout tells the server the total on its screen. When
the server's total is different — a price, a volume tier, an added cost, the delivery settings or a coupon changed
after the visitor filled the cart — no order is created and nothing is stored. The checkout shows the new figures
(each line, subtotal, shipping, discount, total) and a notice, keeps the cart, and stays on the page. The notice is
the shop's own text of the label "Prices have changed" (Admin > Labels > "Checkout - Payment & Submit"); without one,
the default of the shop's language (English "Prices have changed. Check the new total, then place the order again.",
Romanian "Prețurile s-au schimbat. Verifică noul total, apoi plasează din nou comanda."). The order server reads that
text from the shop's settings and sends it with the new figures. The visitor checks
the new total and presses Place Order again; that order is created when nothing changed again. A lower total also asks
for confirmation. The cart page then shows the new line prices too. A page loaded before this change (no total sent) is
handled as before. The shop never honours an old price: the server stays the only source of prices.

## 3. Root cause

Packet § 0 items 1-3 confirmed on `c52fdf1` (OBSERVED): the cart (`CartContext.tsx`, localStorage) and the cached
checkout (`flatShippingCost`, `freeDeliveryThreshold` props; `coupon.discount`) hold figures from the time they were
made; `orders/create.ts` recomputes everything from stored data (`linePrice`, the shipping block, the coupon block,
`const total`); nothing compared the two, and the handler answered `{ orderId, orderNumber, couponDiscount }`.

**Regression or never worked: never worked.** EXECUTED `git log -S expectedTotal --oneline` → no output (no commit
ever had such a field). `git log --follow -- backend/src/orders/create.ts` shows server-side repricing since `c4aaf3c`
and the shared rule since `3f75f18` (`order-price-1`, finding F-6 there named this gap); no commit compared totals.

## 4. What changed

| File:line | Change | Serves |
|---|---|---|
| `packages/shared/src/index.ts:945` | `CommerceStringsSchema.pricesChanged` (last key) | § 1 items 4-5 (OC1-TEXT = A) |
| `packages/shared/src/language-packs/en.ts:214`, `ro.ts:208` | the EN text (packet wording) and the RO text (proposed, pending approval like the other RO texts) | § 1 item 4 |
| `packages/shared/src/index.ts:1817` | `OrderInputSchema.expectedTotal: z.number().min(0).optional()` (zod 4 refuses NaN, ±Infinity, text) | § 1 items 1, 3 |
| `packages/shared/src/index.ts:1822`, `:1841` | types `PriceChangedLine`, `PriceChangedAnswer` (the 409 DTO; users: handler, checkout, cart); `message: string` at `:1849`; the `error` comment states its real use (shown only when `message` is absent or blank) | § 1 item 2 (amended), § 2 |
| `packages/shared/src/index.ts:1951` | `sameAmountInCents(a, b)` = `roundToCents(a) === roundToCents(b)` | § 1 item 2, § 2 |
| `backend/src/orders/create.ts:8`, `:318-348` | after `const total`, before the `COUNTER#ORDER` update: `expectedTotal` present and not the same cents → 409 `PriceChangedAnswer`, `console.warn`, return. `:329-333`: `message` = the tenant's `pricesChanged` (`resolveLocaleStrings(tenantConfig)`, the tenant item already read at `:70`), trimmed; blank → the language default — the blank rule of `catalogServerTexts`, written inline because that function lives in `locale-strings.ts` (outside the allocation) and covers catalog keys only. No other line of the handler changed | § 1 items 2-3, 6 |
| `renderer/src/context/CartContext.tsx:72-79` | `priceChangedLineOf(item, lines)`: the answer line with the same product, variant and quantity | § 1 item 4 |
| `renderer/src/context/CartContext.tsx:143-158`, `:54`, `:170` | `takeServerUnitPrices(lines)` in the context: matched items get `priceInputs = { price: unitPrice.toFixed(2) }` and `unitPrice` | § 1 item 4 (cart) |
| `renderer/src/components/CheckoutPageView.tsx:192-199`, `:265-267` | state `priceChanged { answer, cartKey }`; `shown` while `cartKey` (items' product, variant, quantity) is unchanged; discount, subtotal, shipping, total from `shown` | § 1 item 4 |
| `renderer/src/components/CheckoutPageView.tsx:342-344` | request body + `expectedTotal: roundToCents(total)` | § 1 item 1 |
| `renderer/src/components/CheckoutPageView.tsx:381-389` | 409 + `code: "price-changed"` → store the answer, `takeServerUnitPrices`, return (no navigation, cart kept); other refusals unchanged | § 1 item 4 |
| `renderer/src/components/CheckoutPageView.tsx:632`, `:651`, `:675-681` | line totals and subtotal from `shown`; notice (`role="status"`, theme colours): `shown.message` when it is a non-blank string, else `shown.error` | § 1 item 4 |
| `admin/src/pages/Labels.tsx:879` | the `pricesChanged` row in "Checkout - Payment & Submit" | § 1 item 5 |
| `renderer/test/serving-contract/locale-1/order-confirm-1/coverage.json` | allocates `commerce.pricesChanged` to 5 checks (the checkout showing `message`; the handler's default, `ro`, override, blank rows) | § 1 item 5 |
| `packages/shared/test/locale-strings.test.ts:106-112`, `:124-129`, `:170-177`; `admin/src/pages/Labels.test.ts:121-125` | the key counts and key lists + `pricesChanged` (179 → 180 commerce keys; Labels commerce section 150 → 151); the three shared test titles now name the key | key-count preservation |
| `docs/commerce.md` | § "Price confirmation", the POST body field, § "Total Confirmation", the cart API row | § 1 (document the shop rule) |
| `packages/shared/`, `backend/`, `renderer/ARCHITECTURE.md` | one entry each | Definition of Done |
| 3 new test files | § 5 | taxonomy |

`renderer/src/components/CartPageView.tsx` and `SitePage.tsx`: not changed. The cart page reads every line through
`cartLineTotal`, which reads the new `priceInputs`; `SitePage` builds the checkout's `strings` prop, which does not get
the new key (§ 1 item 6). `packages/shared/src/locale-strings.ts`: not changed (used as is).

How a cart item takes the server's price (packet § 1 item 4, "say how"): the smallest change is to replace the item's
`priceInputs` by `{ price: "<server unit price>" }` and set `unitPrice` to the same number. The server's unit price
already holds the added costs, so the new `priceInputs` has no `addedCosts`; `cartLineTotal` takes the `priceInputs` path,
so an item saved before `order-price-1` never again uses its old `unitPrice` and does not add its personalization costs a
second time. Cost: the item's volume tiers are gone (the answer has none). After a later quantity change across a tier,
the cart shows the flat price and the next order gets one more `price-changed` answer — the invariant holds; the visitor
confirms once more.

Abstractions (one line each):
- `sameAmountInCents` — the cents comparison; users: `create.ts` (and its tests); axis: none, packet § 2 asks for one
  pure function; rejected: an inline `roundToCents(a) !== roundToCents(b)` (would leave the shared test nothing to bind).
- `PriceChangedAnswer` / `PriceChangedLine` — the 409 DTO; users: `create.ts`, `CheckoutPageView.tsx`, `CartContext.tsx`;
  axis: a boundary DTO (Lambda → browser), packet § 2; rejected: an untyped JSON object on each side.
- `priceChangedLineOf` — the item ↔ answer-line match; users: `takeServerUnitPrices`, the checkout summary; axis: none —
  it removes a duplicate rule that must be the same on both sides (else the summary shows one line and the cart reprices
  another); rejected: the same `find` written twice.
- `takeServerUnitPrices` — a cart context action; user: the checkout; required by § 1 item 4 (the context exposes no
  item setter); rejected: none simpler (the checkout cannot write the cart's state otherwise).

## 5. Evidence taxonomy — each row and the test that binds it

S = `packages/shared/test/order-confirm-1.test.ts`, B = `backend/test/unit/order-confirm-1.test.ts`,
R = `renderer/test/unit/order-confirm-1.test.ts`. All EXECUTED, pass.

| Case | Expected | Test |
|---|---|---|
| `expectedTotal` equal to the server total | 201, order written as today | B "expectedTotal equal to the server total → 201, order written as without the field (same order, same answer)" |
| equal after rounding (`75`, `75.004`, float noise) | 201 | B "equal after rounding: 75 / 75.004 / float noise …"; S "equal after rounding" |
| product price raised | 409 `price-changed`, the server figures, no `UpdateCommand`, no `TransactWriteCommand` | B "product price raised …" (exact body, two items, a variant and an added cost; only `GetCommand`s; no mail) |
| product price lowered | 409 | B "product price lowered …" |
| delivery config changed (shipping cost; free-delivery threshold) | 409 with the server's `shippingCost` | B "delivery config changed (shipping cost 5 → 10)", "(free-delivery threshold now 50)" |
| coupon no longer valid / discount changed | 409 with the server's `couponDiscount` | B "coupon no longer valid …", "coupon discount changed (10% → 20%) …" (then 201, coupon use counted) |
| no `expectedTotal` | 201 as today, no comparison | B "no expectedTotal …"; S "no expectedTotal → accepted" |
| `expectedTotal` negative, not a number, a text | 400 input refusal | B "expectedTotal negative / a text / not a number …" (nothing read or written); S "expectedTotal … → refused" (also Infinity, null) |
| checkout: 409 `price-changed` | locale text; server's line totals, subtotal, shipping, discount, total; no navigation; cart not cleared | R "the server's line totals, subtotal, shipping, discount and total are shown; the answer's message (the tenant's pricesChanged text) is shown; …" (the `ro` pack text) |
| (OC1-TEXT) `message` = the tenant's text | default / `ro` pack / override / blank override → pack | B "message: no locale, no override → the default …", "message: tenant locale ro-RO → the ro pack text …", "message: a tenant override …", "message: a blank override …" |
| (OC1-TEXT) nothing else of the tenant | the answer's keys are exactly the figures + `message` | B "the answer holds only the figures and the one text: exactly these keys" |
| (OC1-TEXT) `price-changed` without a usable `message` | the answer's `error` is shown | R "message absent → …", "message blank → …" |
| checkout: second press after the 409 | the request carries the server's total | R "second press after the 409 …"; B "second press with the 409's total → 201" |
| checkout: cart changed after the 409 | override gone; figures from the cart | R "cart changed after the 409 (a quantity)", "(an item removed)" |
| checkout: another refusal (400, 403, 500) | today's error path | R "400/403/500 with an error text …", "409 without code price-changed …"; `order-checkout-1.test.ts` unchanged and passing |
| cart item saved before `order-price-1` with an old price | 409, then the item shows the server's price | R "an old price → 409, then the item shows the server's price …" |
| the cart page shows the same figures | `cartLineTotal` gives the server's line totals | R "the cart items take the server's unit prices …" |
| checkout first render | byte-identical | serving suite, row `(cm1-identity-commerce) same /checkout` (§ 6) |

## 6. Byte-identity statement (§ 1 item 6)

The checkout's first render is unchanged: the new state starts `null`, `shown` is `null`, and every figure takes its
old expression; no prop was added. EXECUTED `npm run test:serving` → 115 / 115, the log line
`(cm1-identity-commerce) same /checkout baseline … candidate …` and `(cm1-identity-content) same /checkout`; `git status
--porcelain -uall` after the run lists no path under `renderer/test/serving-contract/`. With the totals equal, the
request differs only by `expectedTotal` (R first row; `order-checkout-1` passes unchanged) and the handler stores the
same order and answers the same keys (B first row). The new key `pricesChanged` is not in the checkout's `strings`
prop (`SitePage.tsx` unchanged); `git status` after the serving run lists one new path under
`renderer/test/serving-contract/` — this slice's `coverage.json` — and no changed one.

## 7. Gates (packet § 4) — each run bare, exit code from `echo $?`, on the final tree (iteration 1)

| # | Command | Expected | Result | Label |
|---|---|---|---|---|
| 1 | `npm run build` (root) | 0 | 0 (iteration 0, first run 2: `TS7005` — the evolving `validatedItems` array read inside a `map` callback; fixed by mapping over `validatedItems`) | EXECUTED |
| 2 | `npm run typecheck` (root) | 0 | 0 | EXECUTED |
| 3 | `cd packages/shared && npm test` | 0 | 0 — 22 files, 385 tests | EXECUTED |
| 4 | `cd packages/plugins && npm test` | 0 | 0 — 7 files, 208 tests | EXECUTED |
| 5 | `cd backend && npm run test:unit` | 0 | 0 — 55 passed + 1 skipped files; 1414 passed, 1 skipped | EXECUTED |
| 6 | `cd renderer && npm test` | 0 | 0 — 41 files, 578 tests (incl. `locale-coverage`: row "slice order-confirm-1: every allocated key …" passes) | EXECUTED |
| 7 | `cd renderer && npm run test:serving` | 0, no capture changed | 0 — 115 / 115; log rows `(cm1-identity-commerce) same /checkout`, `(cm1-identity-content) same /checkout`; `git status` under `renderer/test/serving-contract/`: only the NEW `locale-1/order-confirm-1/coverage.json` | EXECUTED |
| 8 | `cd admin && npm run test:unit` | 0 | 0 — 13 files, 291 tests | EXECUTED |
| 9 | `cd tools/mcp-server && npm test` | 0 | 0 — 17 / 17 (no route added or changed) | EXECUTED |
| 10 | `git diff --check` | 0 | 0; new files: no trailing space | EXECUTED |
| 11 | `git status --porcelain -uall` | only allocated paths | 14 modified + 5 new (3 tests, the coverage file, this record), all inside the allocation | EXECUTED |

NOT RUN: `cd backend && npm test` (by rule: live table). No staging order (operator's step). No browser end-to-end run of
the checkout against the real handler: the checkout rows run in jsdom against a mocked `fetch`, the handler rows with
a mocked DynamoDB client.

## 8. Findings

- **F-1 (pre-existing, non-scope).** `DeliveryConfigSchema` (`packages/shared/src/index.ts`, `// --- DELIVERY CONFIG`)
  declares `flatShippingCost` and `freeDeliveryThreshold` as strings; the admin (`DeliverySettings.tsx`, `parseFloat`)
  and `delivery/update.ts` (stores the body as sent) write numbers, and `orders/create.ts` adds `shippingCost` to the
  total as a number. A stored string would make `total` a text join. INFERRED from the code; the live data was not read.
- **F-2 (limitation, decided).** After `takeServerUnitPrices`, the item loses its volume tiers (§ 4). Safe (one more
  confirmation), not exact.
- **F-3 (limitation).** The cart page computes shipping and the coupon discount from its own cached figures; after a
  `price-changed` caused by the delivery settings or the coupon, the cart page still shows the old shipping or discount.
  The checkout shows the server's figures; the packet allocates only the unit prices to the cart.
- **F-4 (limitation).** A cart personalization keeps its stored `(+cost)` label; when the server's added cost changed,
  the label is old while the line total is the server's.
- **F-5 (edge, decided).** A cart line whose stored price data does not parse gives NaN; `expectedTotal` is then sent as
  `null` (JSON) and the server answers 400 `Invalid input`. `AddToCartButton` never stores such an item (it refuses
  `invalid-price` at add time), so only a hand-edited or damaged localStorage reaches this. Chosen over "omit
  `expectedTotal`", which would create an order with a total the visitor did not see.
- **F-6 (edge).** A unit price with more than two decimals: the answer's `unitPrice` is rounded, and the cart's
  `unitPrice × quantity` can differ by one cent from the server's `totalPrice`; the shown override holds the server's
  figure, and a later change gives one more confirmation.
- **F-8 (decided).** The handler uses an override trimmed (`"  Text "` → `"Text"`), as `catalogServerTexts` does for
  the backend's other locale texts; the ruling says only "a blank override gives the pack text".
- **F-9 (to approve).** The RO text "Prețurile s-au schimbat. Verifică noul total, apoi plasează din nou comanda." is
  the builder's proposal (informal second person, like the other RO checkout texts); the `ro` pack header marks its
  texts as pending the operator's approval.
- **F-7 (pre-existing).** The stored order `total` is not rounded (`subtotal + shippingCost - couponDiscount`); the
  answer's `total` is rounded. The comparison is in cents, so float noise does not refuse an order.

## 9. Decision `OC1-TEXT` — resolved: A (operator ruling 2026-11-15, after review-0)

The problem (iteration 0): the checkout gets its texts only through the `strings` prop, which is in the first-render
payload (the committed baseline `cm1-byte-identity/baseline/commerce/checkout.body` holds it, OBSERVED); a new key there
breaks item 6, and the other channel — the 409 answer — was limited by item 2. Options were A (the handler sends the
tenant text as `message`), B (the key in the prop; re-capture), C (the pack default by locale; overrides ignored),
D (English `error`). The operator chose **A** and amended item 2 (§ 1). Applied as ruled: one field `message`; `error`
English; `code` unchanged; blank or absent `message` → the checkout shows `error`; no key in the `strings` prop.

## 9a. What could not be determined

- Whether live delivery configs hold numbers or strings (F-1): no read of the live table in this run.

## Operator closeout

**Review.** Two builds, two reviews: escalate (OC1-TEXT: a new key in the checkout's `strings` prop would change
every shop's checkout bytes), approved. Operator ruling OC1-TEXT = A: the handler resolves the tenant's own
`pricesChanged` text and the 409 answer carries it as `message`. Builder `claude-opus-5-5`; reviewer
`claude-sonnet-5-5` (fallback; the Codex reviewer was out). Same provider family; not cross-vendor independence.

**Authority.** The human delegated the choice (2026-11-15: "I don't make shop policy - if you recommend B then do B
and document that"). The shop rule is in `docs/commerce.md`.

**Operator gates (2026-11-15, on the approved tree).** Build, typecheck, shared, plugins, renderer, serving, admin
unit, backend unit, MCP, `git diff --check`: each exit 0. Protected paths, captures, trailing whitespace: no line.
The allocation check of the operator's script first named `admin/src/pages/Labels.test.ts`; the packet allows
"`Labels.tsx` and its test", the script's pattern was wrong (`.tsx` only). Corrected script: no line.

**Staging (deployed 2026-11-15; diff read first, the usual shape).** Direct `POST /public/orders` on `cm1-commerce`.

| Request | Answer |
|---|---|
| `expectedTotal` −1, a text, `null` | 400 "Invalid input", `expectedTotal` named |
| `expectedTotal: 75` | passes the input check (stops at "Verification required") |
| no `expectedTotal` | passes the input check, as before |

**Not checked on staging:** the comparison, the 409 answer and the checkout's display of it. They run after
reCAPTCHA, and no order request can pass it on staging. Proof: the handler and checkout unit tests. The Labels row
was not opened in a browser.

Prod deploy: the human's.
