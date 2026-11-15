# ORDER-PRICE-1 — the order charges the price the visitor saw (implementation record)

Status: **BUILT** (2026-11-15, builder), uncommitted, awaiting review. Start: `main` at `51e26e2`, tree clean. All 12
oracles of the packet's § 4 pass (§ 8). No allocation addition (§ 8, oracle 11). Maturity: **PROTOTYPE** until the
operator places one order with a volume tier, one with a priced variant and one with an added cost on staging.

## 1. Human direction (quoted)

> "fix those defects"

The defects, as reported to the human (`docs/slices/shop-look-1.md` § 13, § 17.4):

> "Volume prices are shown but not charged. The product page and the cart apply volume price tiers and variant price
> changes in the browser. The server that creates the order ignores them and charges the plain price."
>
> "Added costs can corrupt the unit price. Prices are stored as text. When a product has an added cost (a
> personalization), the server joins the two texts where it should add them."

Ruling (2026-11-15): commerce is not frozen for this; the only commerce hold is the move to a separate table.

## 2. Root cause

The packet's § 0 items 1-7 are confirmed on `51e26e2` (OBSERVED in the base tree; the sites are cited there and not
repeated). Summary: the price rule had one copy in the browser (`AddToCartButton.tsx`: option override > volume tier >
`salePrice || price`, plus added costs) and a different one in the server (`orders/create.ts`: `salePrice || price`,
added costs joined as text). The order input schema required a personalization `id` the cart never sent, so an order
with a personalization was refused with "Invalid input" — that hid the text-join defect. The cart froze the unit price
at add time, and four browser sites each repeated the line arithmetic.

**Regression or never worked: never worked.** EXECUTED `git log -S volumePricing --oneline -- backend/src/orders/create.ts`
→ no output (no commit ever added or removed `volumePricing` in that file). EXECUTED
`git show 61957b8:backend/src/orders/create.ts` (the commit that created the file, 2026-02-15): line 42
`let unitPrice = product.salePrice || product.price;`, line 62 `const finalUnitPrice = unitPrice + personalizationCost;`.
`git log -S priceOverride` on the same file: no output. The server never applied tiers or option prices.

## 3. What changed

| File:line | Change | Serves |
|---|---|---|
| `packages/shared/src/index.ts:1772` | `OrderItemInputSchema` personalization `id` optional | § 1 item 3 |
| `packages/shared/src/index.ts:1793-1868` (after `OrderInput`) | `LinePriceInputs`, `LinePriceSource`, `LinePriceResult`, `MONEY_TEXT`/`parseMoney` (module-private), `roundToCents`, `linePrice` | § 1 item 1 |
| `backend/src/orders/create.ts:8` | imports `linePrice`, `roundToCents` | § 1 item 2 |
| `backend/src/orders/create.ts:126-189` | the price block: option from the label (`:128-144`), personalization costs from the stored product (`:146-163`), `linePrice` (`:165-175`), stored values (`:177-189`) | § 1 items 2, 5 |
| `renderer/src/context/CartContext.tsx:4-35` | `CartItem.priceInputs?`, personalization `id?`, `cartLineTotal(item)` | § 1 items 3, 4 |
| `renderer/src/context/CartContext.tsx:133` | `subtotal` = Σ `cartLineTotal`, rounded to cents | § 1 item 4 |
| `renderer/src/components/AddToCartButton.tsx:84-97` | the shown price comes from `linePrice` (replaces the inline rule) | § 1 items 1, 4 |
| `renderer/src/components/AddToCartButton.tsx:128-146` | the cart item gets the personalization `id` and `priceInputs` | § 1 items 3, 4 |
| `renderer/src/components/CartPageView.tsx:3`, `:96` | line total = `cartLineTotal(item)` | § 1 item 4 (§ 0 item 6) |
| `renderer/src/components/CheckoutPageView.tsx:3`, `:285-293`, `:611` | request `totalPrice` and summary line = `cartLineTotal(item)`; the request sends the personalization `id` when the item has it | § 1 items 3, 4 |
| `packages/shared/test/order-price-1.test.ts` (new) | 23 rows: the function and the schema | taxonomy |
| `backend/test/unit/order-price-1.test.ts` (new) | 21 rows: the real handler, mocked `db.js`, origin, reCAPTCHA, SES | taxonomy |
| `renderer/test/unit/order-price-1.test.ts` (new) | 10 rows: real `CartProvider`, `AddToCartButton`, `CheckoutPageView` | taxonomy |
| `renderer/test/unit/cmrc-counties-1-checkout.test.ts:20-24`, `renderer/test/unit/locale-1d-client.test.ts:35-40` | their `CartContext` mock re-exports the real `cartLineTotal`; no assertion changed | preservation (oracle 5) |
| `packages/shared/ARCHITECTURE.md`, `backend/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md` | the function row; the order line price bullet and test line; the cart line price section | documentation |

Abstraction lines (each new name):

- `linePrice` (shared, pure) — users: `orders/create.ts`, `AddToCartButton.tsx`, `CartContext.tsx` `cartLineTotal`
  (read by the cart subtotal, `CartPageView`, `CheckoutPageView`); axis: none — it removes a duplicated non-trivial rule
  whose copies diverged; rejected: a second copy of the rule in the server (the cause of the defect). Dispatch: the
  result is a sum type (`priced` | `invalid-price`) with exhaustive `kind` checks at each caller.
- `roundToCents` (shared, pure) — users: `linePrice`, `orders/create.ts` (stored `unitPrice`, `subtotal`),
  `CartContext.tsx` (`subtotal`); axis: none — one rounding for the server's and the browser's subtotal; rejected:
  `toFixed(2)` at each site (it rounds 1.005 to "1.00" and returns text, not a number).
- `cartLineTotal` (renderer `CartContext.tsx`) — users: `CartContext` subtotal, `CartPageView`, `CheckoutPageView` (two
  sites); axis: none — it replaces the four copies of § 0 item 6 and holds the one old-cart fallback; rejected: calling
  `linePrice` at each site and repeating the old-cart fallback four times.
- `CartItem.priceInputs` (a browser-boundary DTO, plain JSON in localStorage, typed `LinePriceInputs`) — the data the
  rule needs; rejected: re-reading the product in the cart (a network call per cart render, and no product API carries
  the tiers to the cart today).

Design choices recorded (decided under the ratified behaviour; none crosses a boundary):

1. **Strict money parse.** "Does not parse to a finite number ≥ 0" is read as: after trimming, digits with one
   optional decimal point (`/^(?:\d+(?:\.\d*)?|\.\d+)$/`). `parseFloat` would read `"12,50"` as 12 and `"12abc"` as 12
   — a silent wrong charge. Such text now fails (server 400; browser NaN, as the old code showed for unparsable text).
2. **Only the selected text is parsed.** A broken base `price` does not refuse a line that a tier prices; a broken tier
   refuses only quantities that select it. This is the browser's selection exactly, with a failure in place of NaN.
3. **Personalization match guard.** The predicate of `create.ts` stays (`p.id === pers.id || p.label === pers.label`),
   with `pers.id !== undefined &&` before the id comparison: the id is optional now, and without the guard an input
   without id would match a stored personalization that also has no id (`undefined === undefined`).
4. **The button counts a personalization when its value is non-blank** (`value.trim()`), the same set the cart line
   carries. Before, the button counted any non-empty value (spaces too) while the cart dropped blank ones. Visible only
   for a value of spaces.
5. **The cart subtotal is rounded to cents**, as the server's. For an old cart item the line keeps the old arithmetic;
   only the sum is rounded.
6. **Merge in `addItem` is unchanged:** the existing item keeps its fields (also `priceInputs`) and only the quantity
   grows, so the tier follows the merged quantity. An old item merged with a new add keeps the old arithmetic.
7. **`console.warn` on each refusal** with the product id and the failure (`source`, `text`, or the match count), so
   the operator can find the product data to fix. The response carries only the named text.

## 4. Evidence taxonomy — each row and the test that binds it

S = `packages/shared/test/order-price-1.test.ts`, B = `backend/test/unit/order-price-1.test.ts`,
R = `renderer/test/unit/order-price-1.test.ts`. All EXECUTED, passed (§ 8).

| Input | Expected | Test |
|---|---|---|
| price only, quantity 2 | unit = price; total = 2 × price | S "price only, quantity 2"; B "price only, quantity 2" |
| `salePrice` set | unit = sale price | S "salePrice set"; S "salePrice \"\" → unit = price" |
| tiers `[{5, "9"}, {10, "8"}]`, quantity 1 / 5 / 9 / 10 / 50 | base / 9 / 9 / 8 / 8 | S "tiers [{5, \"9\"}, {10, \"8\"}]…"; B "volume tiers: quantity 10…"; R "cartLineTotal…" |
| tiers given in any order | the same result | S "tiers given in any order"; S "the caller's tier array is not reordered" |
| tiers and `salePrice`, quantity under the first tier | sale price | S "tiers and salePrice…" |
| chosen option with `priceOverride` (with tiers present) | the override | S "chosen option with priceOverride…"; R "(b) a variant with its own price…" |
| chosen option without `priceOverride` | tier or base rule | S "chosen option without priceOverride"; B "label of an option without override" |
| one added cost `"5"`, unit `"12.50"`, quantity 2 | unit + cost = 17.5; total 35 | S "one added cost \"5\"…"; B "one added cost \"5\"…"; R "(c) an added cost of 5…" |
| added cost `"0"`, `""`, absent | adds 0 | S "added cost \"0\", \"\", absent" |
| `price` `""`, `"abc"`, negative | named failure | S "price \"\", \"abc\", negative, absent"; S "text that parseFloat would half-read…"; B "price \"\" / \"abc\" / negative → 400" |
| a tier price or an override that does not parse | named failure | S "a tier price that does not parse"; S "an override that does not parse"; B "a tier price that does not parse → 400"; B "an added cost that does not parse → 400" |
| totals with float noise (`0.1 + 0.2` class) | rounded to cents | S "totals with float noise…"; B "stored order…" (subtotal 0.3); R "subtotal is rounded to cents" |
| server: label `"Size: L"`, group `Size` with `L` | option `L` | B "label \"Size: L\"…" |
| server: label `"Size: L, Colour: Red"` (two groups) | option `L` of the first group | B "label \"Size: L, Colour: Red\"…" |
| server: label matches no option, or two options, or is absent, and the group has an override | 400, no write | B "label matches no option / is absent / is empty…"; B "label matches two options" |
| server: product without any `priceOverride`, any label | label not needed; order placed | B "product without any priceOverride…" |
| server: personalization without `id`, with `label` | accepted; cost added once | B "personalization without id, with label…"; S "the checkout's payload before this slice…" |
| server: personalization with `id` | matched by id | B "personalization with id…"; S "a personalization with id is accepted…" |
| server: stored order item | `unitPrice` string with two decimals; `totalPrice` number; `subtotal` their sum | B "stored order: unitPrice string with two decimals…" (also the mail lines) |
| cart: item with price inputs, quantity raised across a tier | the line and the subtotal follow the tier | R "item with price inputs, quantity raised across a tier…"; R "(a) 10 units…" |
| cart: the same product added twice (merged quantity crosses a tier) | the tier price | R "the same product added twice…" |
| cart: item saved before this change (no price inputs, no personalization id) | today's arithmetic; order accepted | R "item saved before this change…"; R "summary lines and subtotal use the shared rule; an old item keeps its arithmetic; the server schema accepts both items"; B "personalization without id, with label…" (the old request shape through the real handler) |
| product page first render | byte-identical (serving rows unchanged) | serving row `cm1-identity-commerce` (sale, variant, sold-out product pages against the committed baseline) and the `loc1-*` rows; § 6 |

Extra rows (not in the packet table): B "the server never reads a price or a cost from the request"; B "unmatched
personalization → adds 0"; R "a server refusal (400 with an `error` text) is shown through the existing error path"
(§ 1 item 7).

## 5. Readers of a stored order item's `unitPrice` / `totalPrice` and the order `subtotal` (§ 1 item 5)

Basis (EXECUTED): text search for `unitPrice|totalPrice` over `backend/src`, `admin/src`, `renderer/src`,
`tools/mcp-server/src`, `packages/shared/src`, `packages/plugins/src`, `infra/lib`, `scripts`; and for `subtotal` in
the same trees (cart and coupon hits excluded by reading them). A subset claim limited to these patterns: a reader that
reads the item through a computed key would not be found. The order handlers `orders/get.ts`, `orders/list.ts`,
`orders/public-get.ts` return the stored item as is (no arithmetic). New values: `unitPrice` e.g. `"17.50"`,
`totalPrice` e.g. `35`, `subtotal` e.g. `35`.

| Reader | What it does | Reads the new values correctly? |
|---|---|---|
| `backend/src/orders/create.ts:502` (mail item lines) | `i.totalPrice.toFixed(2)` | Yes: a number. EXECUTED in B "stored order…" (`— 0.10 USD`) |
| `backend/src/orders/create.ts:518` (mail `subtotal`) | `subtotal.toFixed(2)` | Yes: a number. EXECUTED (`Subtotal 0.30`) |
| `backend/src/orders/update-status.ts:116` | `parseFloat(i.totalPrice \|\| 0).toFixed(2)` | Yes: `parseFloat(35)` = 35 (INFERRED from the expression; not executed) |
| `backend/src/orders/update-status.ts:132` | `parseFloat(order.subtotal \|\| 0).toFixed(2)` | Yes (INFERRED) |
| `backend/src/reports/summary.ts:101` | `parseFloat(item.totalPrice) \|\| 0` | Yes (INFERRED) |
| `admin/src/pages/OrderDetail.tsx:137` | subtotal = Σ `parseFloat(unitPrice) × quantity` | Yes: `"17.50"` × 2 = 35. Before: `parseFloat("12.5005")` × 2 = 25.001 (INFERRED) |
| `admin/src/pages/OrderDetail.tsx:183` | line = `parseFloat(unitPrice) × quantity` | Yes, as above. Limit: for a unit price with more than two decimals the stored `unitPrice` is rounded, so this product can differ from `totalPrice` by a cent (finding F-5) |
| `renderer/src/components/SitePage.tsx:1725`, `:1847` | prints `{item.totalPrice}` raw | Yes: a rounded number, e.g. `35` (was `25.001` possible). Format without two decimals is unchanged and pre-existing (finding F-4) |
| `renderer/src/components/SitePage.tsx:1731` | prints `{order.subtotal}` raw | Yes: rounded number (finding F-4) |
| `tools/mcp-server/src/index.ts:1227` | prints `o.total` only | Not an item reader; `total` is unchanged in type |

## 6. Byte-identity statement (§ 1 item 6)

The product page's first render (quantity 1, nothing chosen, no personalization) prints
`linePrice(...).lineTotal.toFixed(2)`; before, `((parseFloat(salePrice || price)) + 0) × 1).toFixed(2)`. For every
captured product (all prices have two decimals: `"100.00"`/`"80.00"`, `"50.00"`, `"30.00"`, `"20.00"`, `"10.00"`,
`"99.00"`/`"79.00"`) the two give the same text. EXECUTED: `npm run test:serving` → 113 / 113, including
`cm1-identity-commerce` (the commerce tenant's product pages against the committed baseline) and the `loc1-*` rows;
`git status` after the run lists no capture or expectation file. EXECUTED: `locale-1d-client` "add-to-cart" (the button's
markup after each interaction step, against the 92adbba capture) passes unchanged.

No change to coupons, shipping, the order number, the mail texts or the customer upsert: their code is untouched (diff
limited to `create.ts:126-189` and the import line). Their INPUT `subtotal` is now the shared rule's sum, so a coupon
minimum and the free-delivery threshold compare against the price the visitor saw, not the plain price.

## 7. What a visitor sees, before and after

| Case | Before (`51e26e2`) | After |
|---|---|---|
| (a) 10 units, price `"10.00"`, tier at 10 = `"8.00"` | Button 80.00; cart 80.00 (frozen at add; if added as 1 and raised to 10 in the cart: 100.00); order charged **100.00**, confirmation and mail 100 | Button 80.00; cart 80.00 also when raised in the cart; order 80, confirmation 80, mail 80.00 |
| (b) option L with `priceOverride` `"20.00"`, price `"12.50"` | Button 20.00; cart 20.00; order charged **12.50** | 20.00 everywhere. If the label matches no single option (a hand-edited cart, a renamed option): checkout shows "Variant selection not recognised for product: <id>" and no order is written |
| (c) price `"12.50"`, personalization cost `"5"`, quantity 2 | Button 35.00; cart 35.00; checkout refused with **"Invalid input"** (schema wanted `id`). Had it passed: `25.001` | Order placed; stored `unitPrice "17.50"`, `totalPrice 35`; confirmation 35 |

INFERRED for the "before" column from the code and the operator's probe (packet § 0 items 3-4); the "after" column is
EXECUTED by the B and R rows cited in § 4.

## 8. Gates (packet § 4) — each run bare, exit code from `echo $?`

The results below are from the LAST run, on the final tree (all 12 rerun after the price block was moved below
`OrderInput` in `index.ts`, a move without a logic change); the first-run failures are noted where they happened.

| # | Command | Expected | Result | Label |
|---|---|---|---|---|
| 1 | `npm run build; echo $?` (root) | 0 | 0 (first run 1: `next build` type-checks `test/unit/order-price-1.test.ts` — `createElement(CartProvider, props, ...children)` lacked the `children` prop; fixed in the test; rerun 0) | EXECUTED |
| 2 | `npm run typecheck; echo $?` (root) | 0 | 0 | EXECUTED |
| 3 | `cd packages/shared && npm test; echo $?` | 0 | 0 — 19 files, 338 tests | EXECUTED |
| 4 | `cd backend && npm run test:unit; echo $?` | 0 | 0 — 51 files passed, 1 skipped; 1371 passed, 1 skipped | EXECUTED |
| 5 | `cd renderer && npm test; echo $?` | 0 | 0 — 33 files, 492 tests (first run 1: 23 failures in `cmrc-counties-1-checkout` and `locale-1d-client`, "No `cartLineTotal` export is defined on the mock"; fixed by re-exporting the real function in their mocks; rerun 0) | EXECUTED |
| 6 | `cd renderer && npm run test:serving; echo $?` | 0, no capture changed | 0 — 113 / 113; `git status --porcelain -uall` after it: no file under `renderer/test/serving-contract/` | EXECUTED |
| 7 | `cd packages/plugins && npm test; echo $?` | 0 | 0 — 6 files, 204 tests | EXECUTED |
| 8 | `cd admin && npm run test:unit; echo $?` | 0 | 0 — 13 files, 283 tests | EXECUTED |
| 9 | `cd tools/mcp-server && npm test; echo $?` | 0 | 0 — 17 / 17 | EXECUTED |
| 10 | `git diff --check; echo $?` + new files | 0; no trailing whitespace | 0; `grep -n " $"` on the three new test files: no match (and this record checked the same way) | EXECUTED |
| 11 | `git status --porcelain -uall` | only allocated paths | the 11 modified + 4 new paths of § 3 — all inside the allocation | EXECUTED |
| 12 | grep tests for `unitPrice`, `totalPrice`, `personalizations`, `volumePricing` | each hit listed | below | EXECUTED |

Oracle 12 — every test file with a hit (search over tracked and new files matching `test/`, `.test.`, `spec.`):

| File | Hit | Status |
|---|---|---|
| `admin/src/pages/ProductEditor.test.ts:12`, `:47-48` | product fixture defaults `[]` | unchanged |
| `backend/test/unit/catalog-mode.test.ts:53`, `:199-219` | catalog product fixtures; catalog write refuses monetary fields | unchanged |
| `backend/test/unit/glam-import-handler.test.ts:122-127`, `:926` | catalog import writes no monetary field | unchanged |
| `packages/shared/test/locale-strings.test.ts:41` | the locale key `volumePricing` | unchanged |
| `packages/shared/test/schemas.test.ts:276-277` | `OrderSchema` fixture with `unitPrice`/`totalPrice` strings (the declared schema, finding F-1) | unchanged |
| `renderer/test/serving-contract/cm1-showcase-dom.mjs:51`, `fixtures.mjs` | product and order fixtures | unchanged |
| `renderer/test/unit/cat-variant-gallery-1-server-render.test.ts:66`, `category-content-1.test.ts:69-73`, `locale-1a-server-render.test.ts:213`, `locale-1b-server-render.test.ts:88-106`, `locale-1d-server-render.test.ts:99-111` | product/order fixtures for server render | unchanged |
| `renderer/test/unit/cmrc-counties-1-checkout.test.ts:25` | a cart item without `priceInputs` | unchanged item; the mock now re-exports `cartLineTotal` (old arithmetic path) |
| `renderer/test/unit/locale-1d-client.test.ts:101-104` | cart items without `priceInputs`; the mock's subtotal uses the old arithmetic | unchanged items and assertions — correct for old carts; the mock now re-exports `cartLineTotal` |
| `renderer/test/unit/locale-1d-client.test.ts:170`, `:188`, `:227`, `:380` | `AddToCartButton` props and cart items with personalizations (`addedCost: 5` / `"0"`) | unchanged; the captured markup still matches |
| the three `order-price-1.test.ts` files | new | new rows of § 4 |

No test asserted the old server price or the old schema refusal under another name (search for
`OrderInputSchema|OrderItemInputSchema` in tests: only `normalizeEmail.test.ts` and `email-key-normalization.test.ts`,
both about the email field).

NOT RUN: a "before" run of the new B/R rows against `51e26e2` (a worktree build of the workspace was not set up); the
defect reproduction rests on the operator's `tsx` probe (packet § 0 items 3-4). `cd backend && npm test` was not run, by
rule (it writes to a live table).

## 9. Findings

- **F-1 (report, non-scope).** `OrderItemSchema` (`packages/shared/src/index.ts`, `// OrderItemSchema`) declares
  `unitPrice`/`totalPrice` as strings and `OrderSchema` declares `subtotal`, `total`, `couponDiscount`, `shippingCost` as
  strings; `orders/create.ts` stores `totalPrice`, `subtotal`, `total`, `couponDiscount`, `shippingCost` as numbers.
  No reader parses a stored order with these schemas today (search: no `OrderSchema.parse`/`safeParse` outside tests).
- **F-2 (documentation outside the allocation).** `docs/commerce.md` is now stale: § "Price Calculation"
  (`lineTotal = (unitPrice + Σ addedCost) × quantity`), § "Server-Side Validation" item 2 ("Uses `salePrice || price`"),
  the `CartItem` interface (no `priceInputs`, no personalization `id`), and § "Volume Pricing" (declares
  `price: number` and "sorted ascending"; stored `price` is text and the rule picks the largest `minQuantity` ≤ quantity).
  Not edited: outside oracle 11's list. Proposed: one follow-up edit of those four passages.
- **F-3 (product data quality).** The admin price inputs (`ProductEditor.tsx` price, tier price, `priceOverride`,
  `addedCost`) are free text. A stored `"12,50"` now gives NaN on the product page (before: 12.00 shown, and an order
  the server could not price) and a 400 at checkout. Validation at the product write boundary is out of scope.
- **F-4 (pre-existing display).** The visitor's order confirmation and tracking pages (`SitePage.tsx:1725`, `:1731`,
  `:1847`) print `totalPrice`/`subtotal` raw: `35`, `12.5`, not `35.00`, `12.50`. Unchanged by this slice.
- **F-5 (rounding edge).** For a unit price with more than two decimals (e.g. `"9.999"`), the stored `unitPrice` is
  rounded (`"10.00"`) while `totalPrice` is `round(9.999 × q)`; the admin's `parseFloat(unitPrice) × q` can differ by
  one cent. No captured product has more than two decimals.
- **F-6 (non-scope, packet § 6).** The server does not compare the visitor's expected total with its own; a cart with
  an old `priceInputs` (the admin changed the price after the add) shows the old price and is charged the new one.
  Before this slice the same was true of the frozen `unitPrice`.
- **F-7 (non-scope).** `selectedVariant` is a display label; a group or option name that contains `", "` or `": "` can
  make the label ambiguous, which the server now refuses (400) instead of guessing. A structured selection is packet
  § 6 non-scope.
- **F-8 (pre-existing).** `addItem` merges by `productId + selectedVariant` and ignores personalizations: the same
  product added twice with different engraving texts keeps only the first item's personalizations. Unchanged.
- **F-9 (non-scope).** The order handler's English error texts (two new ones: "Variant selection not recognised for
  product: <id>", "Invalid price for product: <id>") are shown to the visitor as sent (existing path, § 1 item 7).

## 10. What could not be determined

- Whether any live product holds a malformed price text (F-3). A read of the live table was not done (no AWS access in
  this run, and no scan is allowed). The `console.warn` of each refusal names the product.
- How many visitor carts in browsers hold items saved before this change; they keep working (old arithmetic, schema
  accepts them), and their lines do not follow tiers until the visitor adds the product again.

## Operator closeout

**Review.** One build, one review, verdict approved. The Codex reviewer (`gpt-6.1-sol`) was out (usage limit); the
review ran on the fallback reviewer `claude-sonnet-5-5` (human directive 2026-11-15). Builder `claude-opus-5-5`. Same
provider family for both roles; not cross-vendor independence.

**Operator gates (2026-11-15, on the reviewed tree).** Build, typecheck, shared, plugins, renderer, serving, admin
unit, backend unit, MCP, `git diff --check`: each exit 0. Protected paths, allocation, captures and trailing
whitespace: no line.

**Staging (deployed 2026-11-15; diff read first: function code and metadata, two bucket deployments, the admin
runtime config, three nested-stack descriptions).** Tenant `cm1-commerce`, a probe product (price 20.00, tier 5 → 15.00,
variant `Size` with `L` at 30.00, added cost 5), a real browser:

| Check | Result |
|---|---|
| product page, first render, quantity 1 | 20.00 |
| quantity 5, nothing chosen | 75.00 (tier) |
| `S`, added cost, quantity 5 | 100.00 |
| `L` (own price), added cost, quantity 5 | 175.00 |
| cart, quantity 5 | line and subtotal 100.00 |
| cart, quantity lowered to 3 | 75.00 — the line left the tier (before the fix: 60.00) |
| checkout order summary | 75.00 |

**Not checked on staging: the order itself.** The browser's order request failed before an answer ("Failed to
fetch"), and reCAPTCHA reported an invalid domain: the staging site is served from the CloudFront address, not from
a tenant domain. The server price path (the label match, the added cost as a number, the stored values, the two
refusals) is therefore proven by the handler unit tests only (`backend/test/unit/order-price-1.test.ts`), not by a
live order. The probe product was deleted.

**Findings added by the operator (verified on the code, not fixed here).**
- **F-10 — cash-on-delivery orders are refused.** The checkout sends `paymentMethod: "cash_on_delivery"`
  (`CheckoutPageView.tsx:204`, `:584`); `OrderInputSchema` accepts `"cod"` or `"bank_transfer"`. Probe:
  `safeParse` with `cash_on_delivery` → `success: false`. The stored order schema, the admin and the confirmation
  page all use `cash_on_delivery`; the input schema is the odd one.
- **F-11 — the confirmation address gets no order id.** `orders/create.ts` answers `{ orderId, orderNumber,
  couponDiscount }`; the checkout reads `order.id` (`CheckoutPageView.tsx`, the `router.push` after the order). Read
  from the code only.
- **F-12 — a comma price.** F-3 above matters for a Romanian shop: a stored `"12,50"` showed 12.00 before and shows
  NaN now, and its order is refused. Production data could not be read. Reported to the human before the prod deploy.

Follow-up slice `order-checkout-1`: F-10 and F-11. Prod deploy: the human's.
