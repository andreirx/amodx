# PRICE-LOCALE-1 — a price typed with a decimal comma is read by the site's locale (implementation record)

Status: **BUILT** (2026-11-15, builder, iteration 2: record corrections of review-1 — § 6, design choices 8-9,
F-PL1-5, F-PL1-10 — plus three bound tests; no product code changed since iteration 1), uncommitted, awaiting review. Start: `main` at `804db36` (one commit after the packet's `5462373`: `order-email-1`,
which touches no price code), tree clean. All oracles of packet § 4 pass on the final tree (§ 7). Allocation: the
packet's list plus `packages/plugins/ARCHITECTURE.md` (added by ruling PL1-SHOWCASE); no other path. Maturity:
**PROTOTYPE** until the operator checks a `ro-RO` product with a `12,50` price and a `10,00` tier on staging (product
page, cart, checkout, a showcase card).

## 1. Human direction (quoted)

> "on comma prices follow the locale too - in Romania 12,50 means 12.50"

Operator rulings (2026-11-15, after review-0): PL1-CART-WIRING = N (the cart needs no locale; the button stores
machine form); PL1-SHOWCASE = C, narrowed (the server gives the card a range only for a comma text of a decimal-comma
tenant; `parseFloat` stays in the card otherwise, as recorded debt); F-PL1-1 confirmed ("the same bytes" = the same
shown output and numbers, and no existing serving capture changes).

## 2. Root cause

The packet's § 0 items 1-4 are confirmed on `804db36` (OBSERVED by reading the files): free-text admin price inputs;
the WooCommerce import stores the cell as it is (`backend/src/import/woocommerce.ts:324-325` — one line above the
packet's `:325-326` — and `:436-437`); one strict parser (`parseMoney`, machine form only) used by `linePrice`; the
other `parseFloat` sites listed in § 4; the tenant locale is `config.locale`, normalised by `normalizeLocale`.

## 3. The rule (§ 1 item 1) and what changed

`parseMoney(text, locale)` — `packages/shared/src/index.ts:1889`, built on the private `machineMoneyText` (`:1867`):

- Every locale reads **machine form**: after trimming, digits with one optional decimal point (`MONEY_TEXT`, `:1840`,
  unchanged: `12.50` → 12.5, `.50` → 0.5, `12.` → 12, `1.250` → 1.25).
- A locale that **writes a decimal comma** (`localeUsesDecimalComma`, `:1856`: `Intl.NumberFormat(normalizeLocale(locale))
  .formatToParts(1.5)`, the `decimal` part is `","`) ALSO reads a text that contains a comma, by
  `DECIMAL_COMMA_MONEY_TEXT` (`:1847`): an integer part of plain digits or of points-grouped digits (1-3 digits, then
  groups of exactly three), the comma, optional decimals; or a comma and digits. Its machine form drops the group
  points and turns the comma into the point. `12,50` → `12.50` → 12.5; `1.250,50` → `1250.50`; `,50` → `.50`; `12,` → `12.`.
- Everything else → `undefined` (the caller's named failure): a comma in a decimal-point locale, a sign, an exponent,
  letters, a currency, a space, two commas, a point after the comma, blank text, an absent value, a digit run too long
  for a finite number.
- The locale is read only when the text contains a comma, so a machine text never builds an `Intl` object.
- Absent, malformed or unknown locale → `normalizeLocale` gives `en-US` → decimal point.

`linePrice(inputs, quantity, locale)` (`:1911`) reads each selected text with `parseMoney(text, locale)`. The third
parameter is required (`string | undefined`), so `tsc` listed every caller: `orders/create.ts` (tenant item locale),
`AddToCartButton.tsx` (`priceLocale`), `CartContext.tsx` (`undefined`: machine form only).

`toMachineFormPriceInputs(inputs, locale)` (`:1938-1984`, ruling PL1-CART-WIRING = N): the price data of a cart line
in machine form. It keeps exactly the texts `linePrice` can select: a non-empty `priceOverride` alone; otherwise every
tier price and the base (`salePrice` when non-empty, else `price` — a `price` hidden by a non-empty `salePrice` is
never read and is omitted); every `addedCost` (blank stays `""`). Each kept text is rewritten by `machineMoneyText`:
a point text is trimmed and otherwise kept as written (`"10.00"` stays `"10.00"`, `" 75.00"` becomes `"75.00"`). The
first kept text that does not parse (or an absent base) → `{ kind: "invalid-price", source, text }`. So the stored
object can hold FEWER texts than the product (never a text the rule reads), and `linePrice` gives the same result on it
at every quantity (S "a point tenant's product with salePrice, with a chosen priceOverride, or with spaces …").

| File | Change | Serves |
|---|---|---|
| `packages/shared/src/index.ts:15` | `import { normalizeLocale }` (already a runtime import of `index.ts` through the re-export on line 14; `locale-strings.ts` imports only types from `index.ts`, so no runtime cycle) | § 1 item 1 |
| `packages/shared/src/index.ts:1836-1893` | `MONEY_TEXT` doc; `DECIMAL_COMMA_MONEY_TEXT`; `localeUsesDecimalComma` (exported); `machineMoneyText` (private); `parseMoney` (now exported, with `locale`) | § 1 items 1, 2 |
| `packages/shared/src/index.ts:1902-1936` | `linePrice(…, locale)`; doc | § 1 item 2 |
| `packages/shared/src/index.ts:1938-1984` | `MachineFormPriceInputs`, `toMachineFormPriceInputs` | ruling PL1-CART-WIRING |
| `backend/src/orders/create.ts:171` | `linePrice(…, item.quantity, tenantConfig.locale)` — the tenant item read at `:70-74` | § 1 items 2, 3 |
| `backend/src/products/bulk-price.ts:10`, `:108-137` | one `GetCommand` `SYSTEM` / `TENANT#<id>` for `locale`; `parseMoney` for `price` and `salePrice` | § 1 items 2, 5 |
| `renderer/src/components/AddToCartButton.tsx:8`, `:59-70`, `:102`, `:131-135`, `:146`, `:158`, `:213` | prop `priceLocale?`; shown total `linePrice(…, priceLocale)`; at add time `toMachineFormPriceInputs` — invalid → no item; the item stores `machine.inputs`; the cart personalization's `addedCost` number and the `(+cost)` label condition use `parseMoney` (were `parseFloat`) | § 1 item 2; ruling PL1-CART-WIRING |
| `renderer/src/context/CartContext.tsx:18-22`, `:28-36` | `cartLineTotal` calls `linePrice(…, undefined)`; docs say the stored texts are machine form. No locale in the provider or the context | ruling PL1-CART-WIRING |
| `renderer/src/components/SitePage.tsx:25`, `:756-770`, `:795-802`, `:1285` | imports `localeUsesDecimalComma`, `parseMoney`; `withCommaPriceRange` and its call in `prepareBlocks`; passes `priceLocale` to `AddToCartButton` only for a decimal-comma locale | § 1 item 2; ruling PL1-SHOWCASE |
| `packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx:16-21`, `:38-51` | `Product._priceRange?`; the card prints it when present, else today's code path (debt comment) | ruling PL1-SHOWCASE |
| 6 new test files | § 5 | taxonomy |
| `packages/shared/ARCHITECTURE.md`, `backend/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, `packages/plugins/ARCHITECTURE.md`, `docs/commerce.md` | the parser row; the order and bulk bullets and test line; the renderer section; the showcase range paragraph and test row; the commerce price passages (`CartItem`, price calculation, server-side validation item 2, volume pricing type, bulk price, a new "Price texts and the locale" section — the four passages `order-price-1` F-2 found stale describe the rule this slice extends) | documentation |

Iteration 1 removed the iteration-0 cart wiring that ruling N replaces: `CartProvider`/context `priceLocale`, the
`cartLineTotal(item, priceLocale)` argument, and the edits to `CartPageView.tsx`, `CheckoutPageView.tsx` and
`renderer/test/unit/order-price-1.test.ts` (those three files are byte-identical to `HEAD` again; restored by
`git show HEAD:<path> > <path>`, no checkout or reset of the tree).

Abstraction lines (each new or newly exported name):

- `parseMoney` (shared, pure; was module-private, now exported) — users: `linePrice`, `bulk-price.ts`,
  `AddToCartButton.tsx` (two sites), `SitePage.tsx` `withCommaPriceRange`; axis: none — it is the one parser the
  packet requires; rejected: `linePrice` for the bulk change and the range (they need single texts, not a line) and a
  local copy per site.
- `machineMoneyText` (shared, private) — users: `parseMoney`, `toMachineFormPriceInputs`; axis: none — the one grammar
  with two outputs (the machine text and its number); rejected: `String(parseMoney(…))`, which writes `"10.00"` as
  `"10"` (a point tenant's stored cart texts would change) and gives exponent text (`1e-7`) for extreme values.
- `localeUsesDecimalComma` (shared, pure, exported) — users: `parseMoney` (via `machineMoneyText`), `SitePage.tsx`
  (whether to pass the prop; whether to compute showcase ranges); axis: the concrete variation is the locale's decimal
  separator (`ro-RO`/`de-DE` vs `en-US`/`en-GB`); rejected: pass the locale to every tenant (the props of `en-GB`, `de-CH`
  … would change for no reading difference) and the existing `formatLocaleProp` rule (`locale !== "en-US"`, same).
- `toMachineFormPriceInputs` + `MachineFormPriceInputs` (shared, pure) — users: `AddToCartButton.tsx`; axis: none — it
  knows which texts `linePrice` can select, so it sits beside `linePrice` instead of repeating that rule in the
  renderer (the "duplicate non-trivial logic" criterion); rejected: convert every present field (a broken `price` hidden
  by a valid `salePrice` would then block an add that works today) and keep raw texts for the cart (needs the locale in
  the cart — what ruling N removes). Dispatch: sum type with exhaustive `kind` check at the caller.
- `DECIMAL_COMMA_MONEY_TEXT` (shared, private constant) — users: `machineMoneyText`; rejected: a hand-written scanner.
- `AddToCartButton` prop `priceLocale?` — browser-boundary data (a string); user: `SitePage`.
- `withCommaPriceRange` (renderer `SitePage.tsx`, module-private) — user: `prepareBlocks`; a named step, not a seam.
- `_priceRange: { min, max }` on a showcase product (data from the server pass to the plugin render — numbers only, no
  framework object) — user: `CategoryShowcaseRender`; rejected: a runtime import of the parser in the render file
  (plugins D3 stands, ruling PL1-SHOWCASE).

A private helper `parseMoneyText(text, decimalComma)` was written and removed in iteration 0: one
`Intl.NumberFormat(…).formatToParts` costs 17.5 µs (EXECUTED, 10 000 calls on Node v22.21.1).

Design choices recorded (decided under the ratified behaviour and the rulings; none crosses a boundary):

1. **Groups of three only.** `1.25,50` and `12.50,5` fail instead of being read as 125.5 and 1250.5.
2. **`,50` → 0.5 and `12,` → 12** (packet: mirror `.50` and `12.`, which `MONEY_TEXT` accepts today — EXECUTED in S).
   Also `1.250,` → 1250.
3. **`1.250.000` (points only, two or more) fails** in a comma locale: without a comma the text is machine form, and
   machine form has at most one point.
4. **A locale whose decimal separator is neither comma nor point** (e.g. `ar-EG`, U+066B) reads machine form only.
5. **The `fr-FR` style** (`1 250,50`, space as group separator) fails: the packet lists a space as a failure.
6. **Bulk price: a text that does not parse is skipped.** Before, `parseFloat` skipped only NaN and read `12abc` or an
   en-US `12,50` as 12 and wrote a new price from it (EXECUTED: `parseFloat("12,50") * 1.1` = 13.200000000000001 →
   `"13.20"`).
7. **A decimal-point tenant with a malformed added cost** (`5,5` on en-US): the `(+5,5 USD)` label is no longer shown
   (before: `parseFloat` read 5 > 0 and showed it), and the cart personalization number is 0 (before: 5).
8. **Not added (ruling N).** Before this slice, a product whose selected price text did not parse showed
   `Add to cart — NaN <currency>` and a click ADDED an item (unit price NaN; the order handler then refused it). Now the
   button shows the same text and a click adds nothing and shows no "added" state. A text the line can use at another
   quantity (a broken tier at 5 while the visitor buys 1) also blocks the add, because the cart lets the visitor raise
   the quantity later. This is a change on MALFORMED data for every tenant, decimal-point tenants included: before, an
   en-US product `12.50` with an unused tier `10,00` at 5 was added and ordered at quantity 1 (`linePrice` and the order
   handler parse only the selected tier); now the button shows `12.50` and a click adds nothing (S "a point tenant's
   product with a malformed tier …"; R "a malformed tier the quantity does not select …"). Valid data: no change. The
   button shows no message (the ruling keeps the display; F-PL1-10).
9. **Only the texts the rule reads are stored.** The stored `priceInputs` is NOT always today's object: a chosen
   override hides `price`, `salePrice` and the tiers; a non-empty `salePrice` hides `price`; texts are trimmed. A kept
   point text is otherwise as written. What stays the same for a decimal-point tenant with valid data: the shown output,
   the line total at every quantity and the order request (S "… salePrice, … priceOverride, … spaces …"; R "salePrice
   and a chosen priceOverride …"). The only readers of `priceInputs` are `AddToCartButton` and `CartContext`
   (search for `priceInputs` over `renderer/src`), so the smaller object has no other consumer.
10. **Showcase range only for products with tiers.** Without tiers the card prints the stored text and parses nothing.
    A comma text that does not parse (e.g. a tier `10,00,1`) → no range: the card keeps its own reading.

## 4. The price-text sites (§ 1 item 2)

Basis (EXECUTED in iteration 0, re-read in iteration 1 for the changed sites): `grep -rnE "parseFloat\(|Number\(|parseInt\(|…"`
filtered for money words over `renderer/src`, `backend/src`, `packages/plugins/src`, `admin/src`, `packages/shared/src`,
`tools/mcp-server/src` (tests excluded); and a second search for arithmetic, comparisons, `toFixed`, `Math.` on
`price|salePrice|priceOverride|addedCost` over `renderer/src`, `backend/src`, `packages/plugins/src`,
`tools/mcp-server/src`. A text search: a site that reads a price through a computed key would not be found.

| Site | Reads | Status |
|---|---|---|
| `packages/shared/src/index.ts` `linePrice` | product price texts | changed: `parseMoney(text, locale)` |
| `backend/src/orders/create.ts:171` | via `linePrice` | changed: the tenant item's locale |
| `backend/src/products/bulk-price.ts:121`, `:136` | `price`, `salePrice` | changed: `parseMoney` with the tenant item's locale |
| `renderer/src/components/AddToCartButton.tsx:102` | via `linePrice` | changed: `priceLocale` |
| `renderer/src/components/AddToCartButton.tsx:134` | the cart item's price inputs | changed: stored in machine form (`toMachineFormPriceInputs`) |
| `renderer/src/components/AddToCartButton.tsx:146`, `:213` | `addedCost` | changed: `parseMoney` (were `parseFloat`) |
| `renderer/src/context/CartContext.tsx:36` (`cartLineTotal`) | via `linePrice`, machine-form texts | changed: `undefined` locale (machine form) |
| `renderer/src/components/SitePage.tsx:766` (`withCommaPriceRange`) | showcase `price`, tier `price` | new: `parseMoney` with the tenant locale |
| `packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx:46-48` | `price`, tier `price` | **kept `parseFloat` for products without `_priceRange` — accepted debt F-PL1-9 (ruling PL1-SHOWCASE)** |
| `renderer/src/context/CartContext.tsx:39-40`, `CartPageView.tsx:119` | cart item `unitPrice`/`addedCost` NUMBERS | not a price text (numbers the button computed) |
| `renderer/src/components/CartPageView.tsx:57` | `data.discount` from the coupon API | not a price text (a number the server computed) |
| `renderer/src/components/SitePage.tsx` (order confirmation: `order.total`, `order.discount`) | stored ORDER values | written by the server in machine form |
| `backend/src/orders/update-status.ts:116-136`, `backend/src/reports/summary.ts:65`, `:101`, `:108`, `admin/src/pages/OrderDetail.tsx:137`, `:183`, `:240-250` | stored ORDER values | not price texts (confirmed, left — packet § 0 item 3) |
| `backend/src/orders/create.ts:286-296`, `backend/src/coupons/public-validate.ts:110-152` | coupon `value`, `minimumOrderAmount`, `maximumDiscount`; the request `subtotal` | coupons: non-scope (§ 8 F-PL1-4) |
| `admin/src/pages/DeliverySettings.tsx`, `CouponEditor.tsx`, `ProductEditor.tsx`, `Settings.tsx` `parseFloat`/`parseInt` | `<input type="number">` values | not stored price texts (a number input's value is machine form) |
| `packages/plugins/src/**/…Editor.tsx`, `EffectControls.tsx`, `renderer/src/components/PopupManager.tsx` | effect/slider/trigger numbers | not money |

Price texts that are emitted, not parsed (rule 4 "shown as stored"): `SitePage.tsx` product JSON-LD `offers.price`,
`ProductByIdPage.tsx:88`, `app/[siteId]/openai-feed/route.ts:33-34` — F-PL1-2.

## 5. Evidence taxonomy — each row and the test that binds it

S = `packages/shared/test/price-locale-1.test.ts`, B = `backend/test/unit/price-locale-1.test.ts`,
R = `renderer/test/unit/price-locale-1.test.ts`, RS = `renderer/test/unit/price-locale-1-server-render.test.ts`,
RSC = `renderer/test/unit/price-locale-1-showcase.test.ts`, P = `packages/plugins/test/showcasePriceRange.test.ts`.
All EXECUTED, passed (§ 7).

| Locale | Text / case | Expected | Test |
|---|---|---|---|
| `ro-RO` | `12,50` / `12,5` / `0,99` | 12.5 / 12.5 / 0.99 | S "12,50 / 12,5 / 0,99" |
| `ro-RO` | `1.250,50` | 1250.5 | S "1.250,50 → 1250.5 …" (also `1.250,5`, `1250,50`, `1.000.000,00`) |
| `ro-RO` | `12.50` / `1.250` / `99` | 12.5 / 1.25 / 99 | S "12.50 / 1.250 / 99 …" |
| `ro-RO` | `12,50,1`, `1,250.50`, `-12,50`, `12,50 lei`, `abc`, `""` | failure each | S "12,50,1 / 1,250.50 / …"; S "more failures …" |
| `ro-RO` | `,50`, `12,` | mirror `.50` → 0.5, `12.` → 12 (both accepted today) | S ",50 and 12, mirror …" |
| `en-US` | `12.50` | 12.5 | S "12.50 → 12.5" |
| `en-US` | `12,50`, `1,250.50` | failure | S "12,50 and 1,250.50 → failure" |
| `de-DE` / `en-GB` | `12,50` | 12.5 / failure | S "de-DE … en-GB …"; also `de-CH` → failure |
| absent / unknown | `12.50` / `12,50` | 12.5 / failure | S "absent or unknown locale …" |
| order handler, tenant `ro-RO`, product `12,50`, added cost `5,5`, quantity 2 | stored `unitPrice` `"18.00"`, `totalPrice` 36 | B "tenant ro-RO, product 12,50, added cost 5,5 …" |
| order handler, tenant `en-US`, product `12,50` | 400, no write | B "tenant en-US …"; B "tenant with no locale …" |
| order handler: the server is the authority | a locale in the request is ignored | B "the server stays the authority …" |
| product page and cart, `ro-RO`, product `12,50`, tier `10,00` at 5 | 12.50 at 1; 50.00 at 5 | R "the button: 12.50 at 1; 50.00 at 5; the cart item holds machine form …"; R "the cart page and the checkout (no locale anywhere in the cart) …"; S "toMachineFormPriceInputs … ro-RO: price 12,50, tier 10,00 at 5 …" |
| cart item content (ruling N) | machine form; no comma text, no locale | R (stored `priceInputs` `{ price: "12.50", volumePricing: [{5, "10.00"}] }`; localStorage holds `12.50`); R "(25,00 RON) … the cart item holds 25.00 and 5.5"; S "only the texts the rule can select are kept" |
| a usable text does not parse at add time (ruling N) | not added; the button shows what it showed before (NaN) | R "decimal-point tenant, product 12,50: … a click adds nothing"; R "ro-RO, a tier text that does not parse …"; S "a usable text that does not parse → invalid-price …" |
| decimal-point tenant, valid data with `salePrice` / a chosen override / spaces | same shown total, line at every quantity and order request; stored object keeps only the texts the rule reads | R "salePrice and a chosen priceOverride …"; S "a point tenant's product with salePrice, with a chosen priceOverride, or with spaces …"; R and S "… without salePrice or override …" |
| decimal-point tenant, malformed UNUSED tier (`12.50`, tier `10,00` at 5), quantity 1 | button shows 12.50; not added (before: added and orderable) | R "a malformed tier the quantity does not select …"; S "a point tenant's product with a malformed tier …" |
| order-price-1 cart item with raw comma inputs | named failure (NaN), no migration | R "an item saved by order-price-1 with a raw comma text …" |
| the props `SitePage` passes | `priceLocale` only for a decimal-comma locale | RS |
| showcase card, `ro-RO`, price `12,50`, tier `10,00` | the range uses 10 and 12.5 | RSC "ro-RO, price 12,50, tier 10,00 → _priceRange { min: 10, max: 12.5 } …"; P "… with the server's range → 10 – 12.5 RON" |
| showcase: only comma texts of a decimal-comma tenant get a range | others unchanged | RSC "ro-RO: point prices, no tiers, or a text that does not parse …"; RSC "en-US, en-GB, absent …"; RSC "de-DE …"; RSC "a catalog tenant …"; P "point prices without a range → exactly today's output" |
| bulk price +10 %, `ro-RO`, price `12,50` | new price from 12.5 | B "bulk price +10 %, ro-RO, price 12,50 → … 13.75 …"; B "salePrice 9,99 …"; B "en-US, price 12,50 → skipped" |
| every existing serving row | unchanged, no capture edited | `npm run test:serving` 115/115; `git status` lists no file under `renderer/test/serving-contract/` (§ 7) |

## 6. Byte-identity statement (§ 1 item 4, F-PL1-1 as ruled)

Each statement names what is the same and the test that binds it; a cart item's stored object is not claimed equal.

- **Decimal-point tenants (en-US, en-GB, de-CH, absent or unknown locale), valid price data:**
  - Page bytes: `SitePage` passes no new prop (RS); their showcase products reach the card unchanged (RSC); the layout
    and the cart provider are unchanged. EXECUTED: `npm run test:serving` → 115/115, including `cm1-identity-*` (every
    flight row of the en-US content, commerce and catalog tenants against the committed baseline).
  - Shown output, numbers and the order request: the same. The button total, the cart line at every quantity and the
    checkout's `totalPrice` equal the raw rule (R "salePrice and a chosen priceOverride …"; S "… salePrice, …
    priceOverride, … spaces …"). `parseMoney` on a machine text is the `MONEY_TEXT` path of `order-price-1`.
  - The cart item's stored `priceInputs` (localStorage, not a page byte) can differ from today's object: it keeps only
    the texts the rule reads, trimmed (design choice 9). For a product without `salePrice` or override and without
    spaces it is today's object (R "a product without salePrice or override …").
- **Decimal-point tenants, malformed price data:** one behaviour change — a malformed text the line can use but the
  current quantity does not select (e.g. an unused tier `10,00`) now blocks the add, where before the item was added and
  orderable at that quantity (design choice 8). Other malformed cases: the added-cost label and number (design
  choice 7); the bulk change skips the product (design choice 6).
- **Decimal-comma tenants whose prices use the point** (e.g. `ro-RO` with `12.50`): the same shown output and numbers
  (B "point prices …", S "byte identity", RSC). Their product page's flight payload carries `"priceLocale":"ro-RO"` on
  the add-to-cart control — allowed by the F-PL1-1 ruling; no existing serving row changed (`loc1-ro-*` pass), so the
  per-product condition of the ruling was not needed. Their showcase products get no `_priceRange` (no comma text).
- Stored texts are still shown as stored (R "(25,00 RON)", "(+5,5 RON)"; RSC: `price` stays `12,50`); computed totals
  keep `toFixed(2)` (`50.00 RON`); the card's range keeps its number format (`10 – 12.5 RON`).

## 7. Gates (packet § 4) — each run bare, exit code from `echo $?`, on the final tree (iteration 2)

| # | Command | Expected | Result | Label |
|---|---|---|---|---|
| 1 | `npm run build; echo $?` (root) | 0 | 0 | EXECUTED |
| 2 | `npm run typecheck; echo $?` (root) | 0 | 0 | EXECUTED |
| 3 | `cd packages/shared && npm test; echo $?` | 0 | 0 — 21 files, 376 tests | EXECUTED |
| 4 | `cd packages/plugins && npm test; echo $?` | 0 | 0 — 7 files, 208 tests | EXECUTED |
| 5 | `cd backend && npm run test:unit; echo $?` | 0 | 0 — 54 files passed, 1 skipped; 1394 passed, 1 skipped | EXECUTED |
| 6 | `cd renderer && npm test; echo $?` | 0 | 0 — 40 files, 564 tests | EXECUTED |
| 7 | `cd renderer && npm run test:serving; echo $?` | 0, no capture changed | 0 — 115/115; `git status --porcelain -uall` after it: no path under `renderer/test/serving-contract/` | EXECUTED |
| 8 | `cd admin && npm run test:unit; echo $?` | 0 | 0 — 13 files, 291 tests | EXECUTED |
| 9 | `cd tools/mcp-server && npm test; echo $?` | 0 | 0 — 17/17 | EXECUTED |
| 10 | `git diff --check; echo $?` | 0 | 0 | EXECUTED |
| 11 | allocation: `git status --porcelain -uall` | only allocated paths | 12 modified (7 code, 5 docs — list below) + 7 new (6 tests, this record) — all in the packet list or the PL1-SHOWCASE addition | EXECUTED |

Modified: `backend/ARCHITECTURE.md`, `backend/src/orders/create.ts`, `backend/src/products/bulk-price.ts`,
`docs/commerce.md`, `packages/plugins/ARCHITECTURE.md`, `packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx`,
`packages/shared/ARCHITECTURE.md`, `packages/shared/src/index.ts`, `renderer/ARCHITECTURE.md`,
`renderer/src/components/AddToCartButton.tsx`, `renderer/src/components/SitePage.tsx`,
`renderer/src/context/CartContext.tsx`. New: the six test files of § 5 and this record. Not touched:
`Providers.tsx`, `layout.tsx`, `CartPageView.tsx`, `CheckoutPageView.tsx`, any `package.json`, `infra/`.

No backend route changed, so `routes.json` was not refreshed (gate 9 passes). `cd backend && npm test` was not run, by
rule. No package was installed. NOT RUN: a staging check (operator's, after review); a real browser on a built site
(the browser paths are covered by the jsdom tests R with the real provider and views, not by a running site).

## 8. Findings

- **F-PL1-1 (ruled).** A decimal-comma tenant's product page payload carries `priceLocale`; no serving row changed.
- **F-PL1-2 (report, non-scope).** Price texts are EMITTED as stored into machine-read outputs: product JSON-LD
  `offers.price` (`SitePage.tsx`), `ProductByIdPage.tsx:88`, the OpenAI feed (`openai-feed/route.ts:33-34`). schema.org
  and feed consumers expect a decimal point, so a `12,50` text there is read wrongly or rejected.
- **F-PL1-3 (report, non-scope).** Computed totals are not formatted by locale: a Romanian site shows `50.00 RON`, and
  the showcase range `10 – 12.5 RON`.
- **F-PL1-4 (report, non-scope).** Coupons and delivery: `CouponSchema` declares `value`, `minimumOrderAmount`,
  `maximumDiscount` as strings and `DeliveryConfigSchema` declares `freeDeliveryThreshold`, `flatShippingCost`,
  `minimumOrderAmount` as strings; the admin writes them from `<input type="number">` with `parseFloat` (numbers in
  machine form), and the server reads them with `parseFloat`. From the admin they cannot hold `12,50`; through the API
  (MCP, direct calls) a text could arrive and would be half-read as today (INFERRED from the code; not executed).
- **F-PL1-5 (report, non-scope).** No validation or normalisation at the product write boundary and in the admin
  editor: `1 250,50`, `12.50,5`, or `12,50` on an en-US tenant are stored. If such a text is the price the button
  selects, the button shows NaN; if it is only a tier the quantity does not select, the button shows a valid total. In
  both cases this slice makes the add-to-cart click add nothing (before: the item was added; in the second case it was
  also orderable at that quantity). This is a change for decimal-point tenants too, on malformed data only.
- **F-PL1-6 (pre-existing).** The stored order item's personalization `addedCost` is the product's TEXT (`"5,5"`),
  copied as is (`create.ts`, `validatedPersonalizations`). Unchanged.
- **F-PL1-7 (pre-existing).** A bulk price change does not change tier prices or option `priceOverride`s.
- **F-PL1-8 (process).** The packet's line numbers for the WooCommerce import are one line off on `804db36`.
- **F-PL1-9 (accepted DEBT, ruling PL1-SHOWCASE).** `CategoryShowcaseRender.tsx:46-48` keeps `parseFloat` on price
  texts for every product without `_priceRange` (all decimal-point tenants; comma tenants' point texts). Packet rule 2
  is not met there. Removing it changes the payload of every tenant and needs a new `cm1` baseline; planned with
  `shop-look-1d`. Also: the card's browser fallback fetch (`/public/categories/{slug}`, used only when the server sent
  no `prefetchedProducts` — e.g. the editor preview, or a category slug the server did not find) brings products
  without `_priceRange`, so a comma text there is read by `parseFloat`: `12,50` with a `10,00` tier shows
  `10 – 12 RON` (P "the same product WITHOUT the server's range").
- **F-PL1-10 (report).** When a usable price text does not parse, the add-to-cart click now does nothing visible and
  shows no message. The button shows NaN only when the broken text is the selected price; with a broken unused tier it
  shows a valid total (e.g. `12.50`), so the visitor sees a price and a button that does nothing. This applies to every
  tenant, decimal-point tenants included (F-PL1-5). A message would need a new locale text key (out of this slice).
- **F-PL1-11 (report).** Carts saved by `order-price-1` with raw comma inputs exist only on staging (ruling); such an
  item shows NaN in the cart and the order handler prices it from the stored product (correct for a `ro-RO` tenant).
  The visitor sees NaN for that line until the item is removed and added again.

## 9. Decisions

None open. PL1-CART-WIRING = N, PL1-SHOWCASE = C narrowed and F-PL1-1 were ruled by the operator (2026-11-15) and are
built as ruled (§ 1, § 3).

## 10. What could not be determined

- Whether any live product holds a comma price (no AWS access in this run; no scan allowed).

## Operator closeout

**Review.** Three builds, three reviews: escalate (the cart had no path to the locale inside the allocation; the
showcase card cannot import shared code at run time), revise (two record claims), approved. Operator rulings after
review-0: PL1-CART-WIRING = N, PL1-SHOWCASE = C narrowed, F-PL1-1 confirmed (in the packet; described in this record).
Builder `claude-opus-5-5`; reviewer `claude-sonnet-5-5` (fallback; the Codex reviewer was out). Same provider family;
not cross-vendor independence.

**Operator gates (2026-11-15, on the approved tree).** Build, typecheck, shared, plugins, renderer, serving, admin
unit, backend unit, MCP, `git diff --check`: each exit 0. Protected paths, allocation, captures, trailing whitespace:
no line.

**Staging (deployed 2026-11-15 with `order-email-1`; diff read first, the usual shape).** Tenant `cm1-commerce`, a
probe product with price `12,50`, a tier 5 → `10,00`, an added cost `5,5`; a real browser.

| Tenant locale | Check | Result |
|---|---|---|
| `ro-RO` (set for the check) | 1 unit | 12.50 |
| `ro-RO` | 5 units (tier) | 50.00 |
| `ro-RO` | 5 units + added cost | 77.50 |
| `ro-RO` | cart line and subtotal | 77.50, no NaN |
| `en-US` (the tenant's own) | the same product | the button shows NaN; the click adds nothing; the cart stays empty |

The locale was put back to `en-US` and the product deleted. Not checked live: the order handler (no order can be
placed on staging); the showcase card with a comma price; the bulk price change. Those are unit-proven.

**To the human before the prod deploy.** The comma is read only when the site's locale uses a decimal comma. A shop
that types `12,50` while its locale is still the default `en-US` shows NaN and takes no order for that product
(before `order-price-1` it charged 12.00). Such a shop must set its locale (Settings) or retype the price.
