# LOCALE-1D — commerce texts through the tenant locale table (record)

Status: **BUILT 2026-11-01, revised in iteration 1** for review-0 (R1-R3, § 12) (builder; uncommitted, for review). Slice row `locale-1d` of `docs/slices/locale-1.md` § 10,
under the human rulings of § 16 (they win over §§ 8, 10, 11) and the operator decision LOCALE1-FREEZE = A (named
exception "LOCALE-1D commerce strings", packet 2026-11-01). Start: `main` at `92adbba`, tree clean (EXECUTED). On top of
`locale-1a` (`4e98f98`), `locale-1b` (`959f288`) and `cmrc-counties-1` (`92adbba`). Maturity of the resolution module:
**PROTOTYPE** — after this slice only the block chrome (`locale-1c`) still renders English literals.

What the slice does, in one paragraph: the commerce part of the tenant locale table gets its 80 commerce-only keys
(§ 6.2), and every commerce-only page reads the table — the cart, checkout and account views, the add-to-cart control,
the commerce bar, the navbar account links, the order confirmation and order tracking pages and their four titles. The
three views and the control receive only their own keys; the F rule of § 5.2 (a stored `""` falls back to the language
default) is applied on the server. The RO language pack holds every value as a literal (the 75 commerce, 5 cookie and
4 legal texts of the RO country pack moved unchanged); the country packs hold country facts only; the English-defaults
helper, its exported constant and the country-pack text members are gone (`L1D-NO-READER` exits 1). Admin Labels groups
the commerce cards by page. **en-US tenants render the same visible text** on all 81 captured en-US URLs (the 74 of 1b
plus 7 new order pages of the commerce fixture) and in every client-only state of the commerce views (jsdom, markup
equal to a `92adbba` capture); their bytes differ only by category-2 props. A Romanian shop's commerce pages turn
Romanian (L-RO-1/2/3, exact strings in § 4); stored overrides keep winning.

## 1. Changes, per item (file:line in the candidate tree)

| Item | File:line | What |
|---|---|---|
| 80 commerce-only keys | `packages/shared/src/index.ts:717-800` (in `CommerceStringsSchema`, after the 21 keys of 1b) | § 6.2 "Commerce-only surfaces" (the non-E: rows); no count key |
| `site.errorTryAgain` | `index.ts:924` (end of `SiteStringsSchema`) | the generic checkout error (`CheckoutPageView`, D1) |
| Compatibility export removed | `index.ts` (the `COMMERCE_STRINGS_DEFAULTS` binding and the EN-pack import deleted; header comment `:12-13`) | § 10.2 |
| EN pack | `packages/shared/src/language-packs/en.ts:1-14` (header), `:128-210` (80 literals), `:263-272` cookie/legal literals, `:307` | every value a literal; no import of the country pack |
| RO pack | `packages/shared/src/language-packs/ro.ts:1-21` (header), `:26-100` (the 75 country-pack texts as literals), `:122-202` (80 RO values), cookie/legal literals, `:297` | values unchanged against the `92adbba` build (test) |
| Country packs | `packages/shared/src/country-packs/types.ts` (`CountryPack` = `code`, `name`, `currency`, `locale`, `address`; `CountryPackLegal` / `CountryPackGdpr` removed), `en.ts`, `ro.ts` (members removed), `index.ts:1` (type re-exports) | facts only (§ 10.2) |
| Shared tests | `packages/shared/test/locale-strings.test.ts` (1d allocation, EN 98 + 80 order, RO literals vs the start build, country packs facts only, no compatibility export); `packages/shared/test/fixtures/locale-1d-packs-92adbba.json` (the start build's pack texts) | |
| Admin Labels | `admin/src/pages/Labels.tsx` commerce section: cards Product Page — buying, Header — account and cart, Shopping Cart, Checkout × 5 (contact, company, shipping, billing, delivery date, payment), Account Page, Order Confirmation, Order Tracking; Site card + `errorTryAgain` | § 7.1; one input per key; the section's Reset covers the 150 commerce-only keys |
| Admin test | `admin/src/pages/Labels.test.ts` (site 43, commerce 150, 1d inputs, Reset of stored pack copies) | |
| SitePage | `renderer/src/components/SitePage.tsx:81-162` (`withFallback`, `pick`, `cartPageStrings`, `checkoutPageStrings`, `accountPageStrings`, `addToCartStrings`, `formatLocaleProp`, `interpolateNodes`), `:288-292` (4 titles), `:452-468` account, `:470-487` cart, `:489-515` checkout, `:1135` add-to-cart, `:1511-1617` confirmation, `:1621-1712` tracking (`ORDER_STEP_KEYS`, `ORDER_HISTORY_KEYS`) | the English-defaults helper deleted |
| Views | `CartPageView.tsx:12` `CartPageStrings`; `CheckoutPageView.tsx:17` `CheckoutPageStrings`, `:51`/`:68` `formatLocale`, `:105` month name; `AccountPageView.tsx:13` `AccountPageStrings`, `STATUS_LABEL_KEYS`, `:86` `formatLocale`; `AddToCartButton.tsx:42` `AddToCartStrings` | `strings` required; no English literal left |
| Header | `CommerceBar.tsx:14` `CommerceBarStrings` (`labels`); `CartWidget.tsx` `total?: { template, currency }` (D4); `Navbar.tsx:15` `NavbarCommerceStrings`, prop `commerceStrings` | |
| Layout | `renderer/src/app/[siteId]/layout.tsx:108` (`defaults` added), `:186-191` commerce bar labels, `:215` navbar commerce texts (commerce sites only) | |
| Unit tests | `renderer/test/unit/locale-1d-client.test.ts` (jsdom, 19 states + the § 5.2 D preservation cases) + `locale-1d-client-before.json` (92adbba); `locale-1d-server-render.test.ts` (node) + `locale-1d-server-before.json` (92adbba); repointed: `cmrc-counties-1-{checkout,site-page}.test.ts`, `cmrc-counties-1-fields.ts`, `locale-1a-{client,server-render}.test.ts`, `locale-1b-server-render.test.ts`; `locale-coverage.test.ts` (1d file; every commerce key after the 77 pre-locale ones is allocated) | § 9 |
| Fixtures | `renderer/test/serving-contract/fixtures.mjs` (`cm1-commerce` gains `integrations.bankTransfer`; 2 `ORDER#` items; `CM1_ORDER_EMAIL`) | coverage rule item 2 |
| Proof | `locale-1/proof.mjs` (`orderRequests`, `cm1Requests`, `renderItem` `segment`; extraction re-exported); `locale-1/extract.mjs` (the extraction, moved unchanged, D11); `locale-1/1d/{before/,expected-diff.json,ro-expected.json,coverage.json}` | |
| Rows | `contract.test.mjs`: `loc1-*` read `1d/`; `loc1-diff-1d` (replaces `loc1-diff-1b`); `loc1-ro-*` against each copy's own start capture; new `loc1-order-pages`; `cmrc-counties-1` expectation changed; `cmrc-counties-diff` retired (D10); `cm1-identity-*` titles | § 9 |
| Strict baseline | `cm1-byte-identity/baseline/` re-captured (build `tTkUtzygz_xH1HtPD_q6t`); `cm1-byte-identity/README.md` history row | § 8.5 rule 4 |
| Docs | `packages/shared/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, `renderer/test/serving-contract/README.md`, this file | |

Pre-edit reader search (packet § 4, EXECUTED): `git grep -n -E 'getCommerceStrings|COMMERCE_STRINGS_DEFAULTS|defaultStrings'`
and the country-pack member search (`RO_PACK`, `EN_PACK`, `getCountryPack`, `COUNTRY_PACKS`, `.gdpr.`, `.legal.`) over all
tracked files: every hit was inside the allocation (shared src/test, the four renderer components, five renderer unit
tests, `contract.test.mjs` for regions only). `admin/src/pages/Settings.tsx` reads `COUNTRY_PACKS` / `getCountryPack`
for `name` and `currency` only (facts; unchanged). No backend or MCP hit. Basis: deterministic text search; a computed
property access would escape it (none seen in the files read).

## 2. Oracles (EXECUTED 2026-11-01, iteration 1, in the packet's order, on the final code)

| # | Command | Exit | Last lines |
|---|---|---|---|
| 1 | `npm --prefix "…/amodx" run build` | 0 | `> tsc` |
| 2 | `npm --prefix "…/amodx" run typecheck` | 0 | `> tsc --noEmit` |
| 3 | `npm --prefix "…/packages/shared" test` | 0 | `Tests 243 passed (243)` |
| 4 | `npm --prefix "…/packages/plugins" test` | 0 | `Tests 201 passed (201)` |
| 5 | `npm --prefix "…/renderer" test` | 0 | `Test Files 21 passed (21)` / `Tests 317 passed (317)` |
| 6 | `npm --prefix "…/renderer" run test:serving` | 0 | `# tests 91` / `# pass 91` / `# fail 0` |
| 7 | `npm --prefix "…/admin" run test:unit` | 0 | `Tests 176 passed (176)` |
| 8 | `npm --prefix "…/backend" run test:unit` | 0 | `Tests 1192 passed \| 1 skipped (1193)` |
| 9 | `npm --prefix "…/tools/mcp-server" test` | 0 | `# pass 13` / `# fail 0` |
| 10 | `git -C "…/amodx" diff --check` | 0 | (no output) |
| + | `git -C "…/amodx" diff --stat -- infra docs/slices/locale-1.md docs/slices/locale-1a.md docs/slices/locale-1b.md docs/slices/cmrc-counties-1.md backend/src/orders` | 0 | prints nothing |
| + | `L1D-NO-READER` (§ 10.1): `git -C "…/amodx" grep -n -E 'getCommerceStrings\|COMMERCE_STRINGS_DEFAULTS\|defaultStrings' -- renderer/src admin/src packages/shared/src` | **1** | no match |
| + | `git -C "…/amodx" diff --name-only \| grep -E "package(-lock)?\.json$"` | 1 | prints nothing (no dependency change) |
| + | `git -C "…/amodx" status --porcelain -uall` | 0 | only allocated paths (packet § 4) |
| + | untracked non-`.body` files: `grep -nE "[[:space:]]+$"` | — | no hit |
| + | `npm --prefix "…/renderer" run test:serving`, 6 consecutive runs after gate 6 | 0 × 6 | 91/91 each |

`…` = `/Users/apple/Documents/APLICATII BIJUTERIE`. Never run: `cd backend && npm test`. The record itself was written
after gates 1-9; gate 10 and the status check were re-run with it in the tree (build report).

Serving lines of this slice (gate 6): `(loc1-subjects) 8 subjects, 81 URLs …; RO copies 58 URLs`; `(loc1-text-commerce)
21 HTML URLs, 474 extracted items, all equal` (every other subject all equal, as in 1b); `(loc1-diff-1d)` every URL its
listed differences; `(loc1-facet-hrefs) 137 filter hrefs equal to the 92adbba capture`; `(loc1-ro-content) 14 URLs, 2 text
changes … {"L-RO-1":2}`; `(loc1-ro-commerce) 25 URLs, 87 text changes … {"L-RO-2":33,"L-RO-1":51,"L-RO-3":3}`;
`(loc1-ro-catalog) 19 URLs, 2 text changes … {"L-RO-1":2}`; `(loc1-order-pages)` ok; `(cmrc-counties-1) … strings = the
language's table (58 keys)`; `cm1-identity-commerce` / `-content` 32 × `same`.

## 3. Proof (§ 8.5; packet hard rules 1-5)

- **Start-commit capture** (EXECUTED): `renderer/test/serving-contract/locale-1/1d/before/` — 139 responses: the 81 en-US
  URLs of `EN_US_REQUESTS` and the 58 URLs of the three RO copies, from `92adbba` in the worktree `/tmp/LOCALE-1D-before`
  (removed), built with that commit's shared/effects/plugins, served with THIS tree's `fixtures.mjs` and `proof.mjs`
  (`harness.mjs`, `no-dotenv.cjs`, `ddb-stub.mjs`, `cm1-byte-identity.mjs` byte-identical, `diff -q`). Build
  `4U15OyNJtOKuh7TY7pa5a`; stub `unhandled` = `[]`; statuses 200 × 129, 307 × 8, 404 × 2. It includes the
  `cmrc-counties-1` change (packet hard rule 1).
  Procedure (EXECUTED; the throwaway script was deleted after use):

  ```bash
  git worktree add --detach /tmp/LOCALE-1D-before 92adbba
  cp -cR node_modules /tmp/LOCALE-1D-before/node_modules     # and each workspace's node_modules (APFS clones)
  (cd /tmp/LOCALE-1D-before && npm run build -w packages/shared && npm run build -w packages/effects && npm run build -w packages/plugins)
  cp <tree>/renderer/test/serving-contract/{fixtures.mjs,locale-1/proof.mjs} /tmp/LOCALE-1D-before/renderer/test/serving-contract/…
  # script, run from /tmp/LOCALE-1D-before/renderer: harness.mjs startStubs → buildRenderer → startRenderer;
  # proof.mjs captureRequests over [...EN_US_REQUESTS, ...LOC1_REQUESTS]; cm1-byte-identity.mjs writeCaptures(<tree>/…/1d/before)
  # unit captures, same worktree (the two test files copied in, and locale-1/extract.mjs):
  LOCALE_1D_CAPTURE=<tree>/renderer/test/unit/locale-1d-client-before.json LOCALE_1D_COMMIT=92adbba npx vitest run test/unit/locale-1d-client.test.ts
  # iteration 1: re-run in a fresh 92adbba worktree whose ONLY source change was `export` before `function DeliveryDatePicker`
  # (the test seam of § 6); the 16 earlier states came out identical, the 3 new ones were added (§ 12)
  LOCALE_1D_SERVER_CAPTURE=<tree>/renderer/test/unit/locale-1d-server-before.json LOCALE_1D_COMMIT=92adbba npx vitest run test/unit/locale-1d-server-render.test.ts
  git worktree remove --force /tmp/LOCALE-1D-before
  ```
- **Order pages** (coverage rule item 2): the commerce fixture has a bank-transfer order and a cash-on-delivery order;
  `proof.mjs` `orderRequests` derives, by rule from the `ORDER#` items of every commerce fixture, `/account`, the
  confirmation without an order, each order's confirmation and tracking page, and one "Order Not Found" request. The
  lookup is the exact-key GetItem the stub already served (no stub change). Row `loc1-order-pages` is the positive
  control that the states are reached (bank block with IBAN/SWIFT, COD block, thank-you, tracking with a tracking
  number, not found, account 200).
- **en-US visible text**: rows `loc1-text-<subject>` — equal to `before/` on every HTML URL of every subject (zero ledger
  rows; no catalog exception any more).
- **en-US bytes**: row `loc1-diff-1d`, `1d/expected-diff.json` — category 2 only, every URL listed, none excluded:

| Subject | URLs | Listed differences |
|---|---|---|
| `commerce` | 25 | on every HTML page (21): `Navbar.commerceStrings` added (`{ signIn: "Sign In", accountLabel: "Account", myAccount: "My Account" }`); `/cart`: `CartPageView.strings` changed (the 98-key commerce object → its 19 keys); `/checkout`: `CheckoutPageView.strings` changed (→ 57 commerce keys + `errorTryAgain`); `/account`: `AccountPageView.strings` changed (→ 27 keys); the three product pages with the control: `AddToCartButton.strings` changed (5 → 8 keys); 4 machine routes `[]` |
| `content`, `catalog`, `cip1b-catalog`, `fixture-tenant`, `wk`, `iso-a`, `iso-b` | 14, 19, 15, 3, 1, 3, 1 | `[]` (byte-equal under the comparison) |

  No category 1: the templates with a value render through `interpolateNodes` (§ 6), whose children equal the JSX they
  replace — the order pages' HTML is byte-identical. Comparison = the `1b` one, unchanged (CM1-A1 plus the ruled
  resolved-tree payload comparison). Bound mutations in the row: each listed entry dropped, a ghost entry, one HTML
  byte, an unlisted prop value, a wrong before value (`/cart`), one order-page text byte — each reported.
- **RO copies**: rows `loc1-ro-*` compare each copy with ITS OWN capture in `before/`, so every listed item is a change of
  this slice; each item's `from` is the EN pack render and `to` the RO pack render (`renderItem`; `segment` for the two
  sentences whose value is its own element). Exact strings: § 4.
- **Client-only states** (`renderer/test/unit/locale-1d-client.test.ts`, jsdom; the cart lives in localStorage and the
  account data is fetched, so the server HTML shows only the empty or loading states): 19 states — cart empty / with
  items (free-delivery progress, minimum order) / with a coupon / coupon refused and coupon check failed; checkout empty /
  full form (company fields, separate billing address, both payment methods, country select) / delivery date picker and
  a selected date / the three order errors; account loading / signed out / profile with every order status and a legacy
  status / no orders / edit and saving; add-to-cart default, out of stock, personalization and option errors, added;
  commerce bar signed out and signed in; navbar account links desktop and mobile; (iteration 1) checkout while the order request is pending, the date picker's loading branch, a selected option that becomes out of stock. Plus the § 5.2 pattern-D cases at the readers (absent / `""` / `"X"`, EN and RO): the seven status badges, `orderFailed`, `orderFailedStatus`, `errorTryAgain`; a server error text passes through. Oracle 1 (en-US): the markup after
  every step equals `locale-1d-client-before.json`, rendered by the same file from `92adbba` (capture mode
  `LOCALE_1D_CAPTURE`, in the worktree; the month name, the birthday and the loyalty points, which keep the runtime
  default for an en-US tenant, are tokenised on both sides and checked against the runtime default). Oracle 2 (RO):
  every visible-text change is a declared key (EN → RO) or a declared formatted value, and every declared key whose RO
  value differs changes.
- **Headless server renders** (`locale-1d-server-render.test.ts`, node, `TZ=UTC`): the props of each view (exact keys,
  EN and RO), the F/D preservation cases of § 5.2 for every F site (checkout 14, account 3, add-to-cart 5, commerce bar
  2) and one D site per view, EN and RO; stored overrides (a Romanian shop holding the 75 old country-pack copies plus two
  edits; an en-US shop with five overrides) render every stored text (packet hard rule 2); `formatLocale` absent for
  absent / `en-US` / `en_US` / `xx-YY`, present for `ro-RO` and `de-DE`; the four titles; the layout wiring (commerce bar
  labels, navbar texts only on a commerce site); the tracking page with a status history (EN bytes equal to the
  `92adbba` capture `locale-1d-server-before.json`; RO changes all declared; a legacy status stays raw).
- **Bound mutations of the unit tests** (EXECUTED, each file restored from a saved copy): `emptyCart` left a literal in
  `CheckoutPageView` → 1 failure; the 14 checkout F keys made D → 2; `formatLocale` always passed → 1; history status
  rendered raw → 1; restored → 51/51. Iteration 1 (EXECUTED, restored, `cmp`): the old badge fallback → 2 failures; the old error chain (translated text thrown, then `|| errorTryAgain`) → 2; `placingOrder`, `deliveryDatesLoading`, `variantUnavailable` each left an English literal → 1 each; restored → 44/44.
- **Coverage** (§ 16.2 item 5): `1d/coverage.json` maps the 144 allocated keys (the 80 new keys, 62 existing commerce keys
  whose readers this slice moved, `site.errorTryAgain`, `site.formSelectPlaceholder`) to captured URLs and named tests;
  `locale-coverage.test.ts` checks it and now also requires every commerce key after the 77 pre-locale ones to be
  allocated. No 1d key is a count key.
- **Strict baseline advanced** (§ 8.5 rule 4, EXECUTED): after `loc1-diff-1d` passed (first serving run: 90/91, only
  `cm1-identity-commerce`, on exactly the 14 commerce HTML URLs), `baseline/` was re-captured. Reasons: `1d/expected-diff.json`,
  and the fixture's `bankTransfer` — EXECUTED: the previous `baseline/` and `1d/before/` are CM1-A1-equal on all 32
  commerce/content URLs except commerce `/checkout`, and equal there once `bankTransfer` is put back to `"$undefined"`.

### How each en-US formatter stays identical

| Formatter | Before | After, for an en-US tenant |
|---|---|---|
| `AccountPageView` order dates | `toLocaleDateString("en-US", …)` | `toLocaleDateString(formatLocale ?? "en-US", …)`, `formatLocale` absent |
| `AccountPageView` birthday, loyalty points | `toLocaleDateString()`, `toLocaleString()` (runtime default) | `(formatLocale)` with `formatLocale` absent = `(undefined)` = the runtime default (ECMA-402) |
| `CheckoutPageView` month name | `toLocaleString("default", …)` | `toLocaleString(formatLocale ?? "default", …)` |
| `CheckoutPageView` selected date, summary date; tracking dates | `locale` / `config.locale` (`"en-US"`) | unchanged |

## 4. Ledger rows that occurred (exact strings)

- **en-US: none** (zero rows; the client states and the server renders show the same text, § 3).
- **L-RO-1** (new keys; captured, `loc1-ro-commerce` unless named): titles `Cart - CM1 Commerce` → `Coș - CM1 Commerce`,
  `Checkout - …` → `Finalizare comandă - …`, `Order Confirmation - …` → `Confirmare comandă - …`, `Order Tracking - …` →
  `Urmărire comandă - …` (and on the 307 bodies of `/cart`, `/checkout` of `loc1-ro-content` and `loc1-ro-catalog`: the
  first two, finding F-LOCALE1D-307-TITLE); checkout `Add some products before checking out.` → `Adaugă produse înainte de
  a finaliza comanda.`; confirmation `Thank you for your order!` → `Îți mulțumim pentru comandă!`, `Your order has been
  placed successfully. You will receive a confirmation email shortly.` → `Comanda ta a fost plasată. Vei primi în curând
  un e-mail de confirmare.`, `Order Confirmed!` → `Comandă confirmată!`, `Order` → `Comanda` (before the number),
  `Bank Transfer Details` → `Detalii pentru transfer bancar`, `Please transfer the total amount to the following
  account:` → `Transferă suma totală în contul următor:`, `Bank:` → `Banca:`, `Account Holder:` → `Titular cont:`,
  `Reference:` → `Referință:`, `Amount:` → `Suma:`, `You will pay` / `when you receive your order.` → `Vei plăti` /
  `când primești comanda.`, `Estimated delivery:` → `Livrare estimată:`, `Order Details` → `Detalii comandă`, `Qty: 2`
  → `Cant.: 2`, `Phone: +1 555 0100` → `Telefon: +1 555 0100`; tracking `Order CM1-0001` → `Comanda CM1-0001`, `Placed on
  15.10.2026` → `Plasată pe 15.10.2026`, steps `pending`, `confirmed`, `processing`, `shipped`, `delivered`, `completed` →
  `în așteptare`, `confirmată`, `în procesare`, `expediată`, `livrată`, `finalizată` (shown capitalised by CSS: "În
  Așteptare"), `Tracking` → `Urmărire`, `Tracking Number:` → `Număr AWB:`, `Items` → `Produse`, `Order Not Found` →
  `Comanda nu a fost găsită`, `Please check the order ID and email address.` → `Verifică numărul comenzii și adresa de
  e-mail.`. Client-only (jsdom): every other key of § 5 (cart coupon errors, calendar heads `Lu Ma Mi Jo Vi Sâ Du`,
  `Selectată: marți, 3 noiembrie 2026`, the order errors, the account page, the status badges `Plasată` … `Stornată`,
  the add-to-cart errors `Completează „Monogram”`, `Selectează Size`, the commerce bar total `Coș/80 USD`); the history
  labels `plasată` … `stornată` (headless).
- **L-RO-2** (an existing key at a new place, a literal before): the navbar `Sign In` → `Autentificare` (21 pages); checkout
  `Your cart is empty` → `Coșul tău este gol`; on the confirmation and tracking pages `Continue Shopping` →
  `Continuă cumpărăturile`, `Shipping` → `Livrare`, `Free` → `Gratuit`, `Discount` → `Reducere`, `Shipping Address` →
  `Adresa de livrare`, `Cash on Delivery` → `Plata la livrare (ramburs)` (`Subtotal`, `Total`, `IBAN:`, `SWIFT:` are the
  same in Romanian). Client-only: the navbar `Account` → `Contul meu`, `My Account` → `Contul meu`, the account page
  `Email`, `Phone` → `Telefon`, `Birthday` → `Data nașterii`, the add-to-cart `Select...` → `Selectează...`.
- **L-RO-3** (an existing key the cart view read through the removed helper, the English default before): `/cart` `Your
  cart is empty` → `Coșul tău este gol`, `Browse our products and add something you like.` → `Răsfoiește produsele noastre
  și adaugă ceva ce îți place.`, `Continue Shopping` → `Continuă cumpărăturile`; client-only: every other cart, checkout
  and account text of the list in § 5.
- **L-RO-6 / L-ALL-1** (dates and numbers, RO tenant): the account order dates `Oct 15, 2026` → `15 oct. 2026`; the
  birthday and the loyalty points (`12.345`) and the checkout month name (`noiembrie 2026`) take `ro-RO` instead of the
  browser default.
- **L-RO-4** (a stored `""` at an F site, RO tenant): the RO default (server test, § 3).

## 5. Romanian text table — for the operator's approval before the prod deploy (§ 16.2 item 4)

The RO column is the "RO" column of § 6.2, except row 81 (D1). A changed value is edited in
`packages/shared/src/language-packs/ro.ts` only (and the tests that pin it); a tenant admin can override any of them on
the Labels page.

| # | Key | EN (today) | RO (proposed, § 6.2) | Where |
|---|---|---|---|---|
| 1 | `commerce.metaCartTitle` | Cart - {site} | Coș - {site} | SitePage metadata |
| 2 | `commerce.metaCheckoutTitle` | Checkout - {site} | Finalizare comandă - {site} | SitePage metadata |
| 3 | `commerce.metaOrderConfirmationTitle` | Order Confirmation - {site} | Confirmare comandă - {site} | SitePage metadata |
| 4 | `commerce.metaOrderTrackingTitle` | Order Tracking - {site} | Urmărire comandă - {site} | SitePage metadata |
| 5 | `commerce.personalizationRequired` | Please fill in "{label}" | Completează „{label}” | AddToCartButton |
| 6 | `commerce.variantRequired` | Please select {name} | Selectează {name} | AddToCartButton |
| 7 | `commerce.cartWidgetTotal` | Cart/{total} {currency} | Coș/{total} {currency} | CommerceBar → CartWidget |
| 8 | `commerce.couponValidateFailed` | Could not validate coupon | Cuponul nu a putut fi verificat | CartPageView |
| 9 | `commerce.deliveryDatesLoading` | Loading delivery dates... | Se încarcă datele de livrare... | CheckoutPageView |
| 10 | `commerce.calendarMo` | Mo | Lu | CheckoutPageView |
| 11 | `commerce.calendarTu` | Tu | Ma | CheckoutPageView |
| 12 | `commerce.calendarWe` | We | Mi | CheckoutPageView |
| 13 | `commerce.calendarTh` | Th | Jo | CheckoutPageView |
| 14 | `commerce.calendarFr` | Fr | Vi | CheckoutPageView |
| 15 | `commerce.calendarSa` | Sa | Sâ | CheckoutPageView |
| 16 | `commerce.calendarSu` | Su | Du | CheckoutPageView |
| 17 | `commerce.checkoutEmptyMessage` | Add some products before checking out. | Adaugă produse înainte de a finaliza comanda. | CheckoutPageView |
| 18 | `commerce.orderFailed` | Order failed | Comanda a eșuat | CheckoutPageView |
| 19 | `commerce.orderFailedStatus` | Order failed ({status}) | Comanda a eșuat ({status}) | CheckoutPageView |
| 20 | `commerce.deliveryDateSelected` | Selected: {date} | Selectată: {date} | CheckoutPageView |
| 21 | `commerce.bankTransferTo` | Transfer to {bank} - {iban} | Transfer către {bank} - {iban} | CheckoutPageView |
| 22 | `commerce.orderStatusPlaced` | Placed | Plasată | AccountPageView |
| 23 | `commerce.orderStatusConfirmed` | Confirmed | Confirmată | AccountPageView |
| 24 | `commerce.orderStatusPrepared` | Prepared | Pregătită | AccountPageView |
| 25 | `commerce.orderStatusShipped` | Shipped | Expediată | AccountPageView |
| 26 | `commerce.orderStatusDelivered` | Delivered | Livrată | AccountPageView |
| 27 | `commerce.orderStatusCancelled` | Cancelled | Anulată | AccountPageView |
| 28 | `commerce.orderStatusAnnulled` | Annulled | Stornată | AccountPageView |
| 29 | `commerce.myAccount` | My Account | Contul meu | AccountPageView, Navbar (mobile) |
| 30 | `commerce.accountSignInPrompt` | Sign in to view your orders and manage your account. | Autentifică-te ca să vezi comenzile și să îți gestionezi contul. | AccountPageView |
| 31 | `commerce.signInWithGoogle` | Sign In with Google | Autentificare cu Google | AccountPageView |
| 32 | `commerce.signOut` | Sign Out | Deconectare | AccountPageView |
| 33 | `commerce.profileHeading` | Profile | Profil | AccountPageView |
| 34 | `commerce.edit` | Edit | Editează | AccountPageView |
| 35 | `commerce.accountName` | Name | Nume | AccountPageView |
| 36 | `commerce.save` | Save | Salvează | AccountPageView |
| 37 | `commerce.saving` | Saving... | Se salvează... | AccountPageView |
| 38 | `commerce.cancel` | Cancel | Anulează | AccountPageView |
| 39 | `commerce.loyaltyPoints` | Loyalty Points | Puncte de fidelitate | AccountPageView |
| 40 | `commerce.defaultAddress` | Default Address | Adresa implicită | AccountPageView |
| 41 | `commerce.orderHistory` | Order History | Istoric comenzi | AccountPageView |
| 42 | `commerce.noOrdersYet` | No orders yet. | Nicio comandă încă. | AccountPageView |
| 43 | `commerce.startShopping` | Start Shopping | Începe cumpărăturile | AccountPageView |
| 44 | `commerce.orderThankYou` | Thank you for your order! | Îți mulțumim pentru comandă! | SitePage order confirmation |
| 45 | `commerce.orderPlacedMessage` | Your order has been placed successfully. You will receive a confirmation email shortly. | Comanda ta a fost plasată. Vei primi în curând un e-mail de confirmare. | SitePage order confirmation |
| 46 | `commerce.orderConfirmed` | Order Confirmed! | Comandă confirmată! | SitePage order confirmation |
| 47 | `commerce.orderNumber` | Order {number} | Comanda {number} | SitePage confirmation + tracking |
| 48 | `commerce.bankTransferDetails` | Bank Transfer Details | Detalii pentru transfer bancar | SitePage order confirmation |
| 49 | `commerce.bankTransferInstruction` | Please transfer the total amount to the following account: | Transferă suma totală în contul următor: | SitePage order confirmation |
| 50 | `commerce.bankLabel` | Bank: | Banca: | SitePage order confirmation |
| 51 | `commerce.accountHolderLabel` | Account Holder: | Titular cont: | SitePage order confirmation |
| 52 | `commerce.ibanLabel` | IBAN: | IBAN: | SitePage order confirmation |
| 53 | `commerce.swiftLabel` | SWIFT: | SWIFT: | SitePage order confirmation |
| 54 | `commerce.referenceLabel` | Reference: | Referință: | SitePage order confirmation |
| 55 | `commerce.amountLabel` | Amount: | Suma: | SitePage order confirmation |
| 56 | `commerce.codPayOnDelivery` | You will pay {amount} when you receive your order. | Vei plăti {amount} când primești comanda. | SitePage order confirmation |
| 57 | `commerce.estimatedDelivery` | Estimated delivery: | Livrare estimată: | SitePage order confirmation |
| 58 | `commerce.orderDetails` | Order Details | Detalii comandă | SitePage order confirmation |
| 59 | `commerce.quantityLabel` | Qty: {n} | Cant.: {n} | SitePage order confirmation |
| 60 | `commerce.phoneLine` | Phone: {phone} | Telefon: {phone} | SitePage order confirmation |
| 61 | `commerce.orderNotFound` | Order Not Found | Comanda nu a fost găsită | SitePage order tracking |
| 62 | `commerce.orderNotFoundMessage` | Please check the order ID and email address. | Verifică numărul comenzii și adresa de e-mail. | SitePage order tracking |
| 63 | `commerce.placedOn` | Placed on {date} | Plasată pe {date} | SitePage order tracking |
| 64 | `commerce.orderStepPending` | pending | în așteptare | SitePage order tracking |
| 65 | `commerce.orderStepConfirmed` | confirmed | confirmată | SitePage order tracking |
| 66 | `commerce.orderStepProcessing` | processing | în procesare | SitePage order tracking |
| 67 | `commerce.orderStepShipped` | shipped | expediată | SitePage order tracking |
| 68 | `commerce.orderStepDelivered` | delivered | livrată | SitePage order tracking |
| 69 | `commerce.orderStepCompleted` | completed | finalizată | SitePage order tracking |
| 70 | `commerce.statusHistory` | Status History | Istoric status | SitePage order tracking |
| 71 | `commerce.orderHistoryPlaced` | placed | plasată | SitePage order tracking |
| 72 | `commerce.orderHistoryConfirmed` | confirmed | confirmată | SitePage order tracking |
| 73 | `commerce.orderHistoryPrepared` | prepared | pregătită | SitePage order tracking |
| 74 | `commerce.orderHistoryShipped` | shipped | expediată | SitePage order tracking |
| 75 | `commerce.orderHistoryDelivered` | delivered | livrată | SitePage order tracking |
| 76 | `commerce.orderHistoryCancelled` | cancelled | anulată | SitePage order tracking |
| 77 | `commerce.orderHistoryAnnulled` | annulled | stornată | SitePage order tracking |
| 78 | `commerce.tracking` | Tracking | Urmărire | SitePage order tracking |
| 79 | `commerce.trackingNumber` | Tracking Number: | Număr AWB: | SitePage order tracking |
| 80 | `commerce.items` | Items | Produse | SitePage order tracking |
| 81 | `site.errorTryAgain` | Something went wrong. Please try again. | A apărut o eroare. Încearcă din nou. | CheckoutPageView (generic error) |

Existing keys that now reach Romanian visitors through this slice's readers (values unchanged from the RO country pack
at `92adbba`; 62): `addToCart` Add to Cart → Adaugă în coș; `addedToCart` Added to Cart! → Adăugat în coș!; `viewCart` View Cart → Vezi coșul; `outOfStock` Out of Stock → Stoc epuizat; `variantUnavailable` Variant Unavailable → Variantă indisponibilă; `shoppingCart` Shopping Cart → Coș de cumpărături; `emptyCart` Your cart is empty → Coșul tău este gol; `emptyCartMessage` Browse our products and add something you like. → Răsfoiește produsele noastre și adaugă ceva ce îți place.; `continueShopping` Continue Shopping → Continuă cumpărăturile; `orderSummary` Order Summary → Sumar comandă; `subtotal` Subtotal → Subtotal; `shipping` Shipping → Livrare; `discount` Discount → Reducere; `total` Total → Total; `freeShipping` Free → Gratuit; `freeDeliveryFrom` Free delivery from → Livrare gratuită de la; `addMoreForFreeDelivery` Add {amount} more for free delivery → Adaugă încă {amount} pentru livrare gratuită; `minimumOrder` Minimum order → Comandă minimă; `proceedToCheckout` Proceed to Checkout → Finalizează comanda; `couponCode` Coupon code → Cod cupon; `apply` Apply → Aplică; `remove` Remove → Șterge; `invalidCoupon` Invalid coupon → Cupon invalid; `checkout` Checkout → Finalizare comandă; `placeOrder` Place Order → Plasează comanda; `placingOrder` Placing Order... → Se plasează comanda...; `email` Email → Email; `phone` Phone → Telefon; `phonePlaceholder` (empty) → 07XX XXX XXX; `shippingAddress` Shipping Address → Adresa de livrare; `streetAddress` Street Address → Strada; `city` City → Oraș; `county` County → Județ; `selectCounty` Select county... → Selectează județul...; `postalCode` Postal Code → Cod poștal; `deliveryNotes` Delivery Notes → Note livrare; `deliveryNotesPlaceholder` Apartment, floor, etc. → Apartament, etaj, etc.; `paymentMethod` Payment Method → Metodă de plată; `cashOnDelivery` Cash on Delivery → Plata la livrare (ramburs); `cashOnDeliveryDesc` Pay when you receive your order → Plătești când primești comanda; `bankTransfer` Bank Transfer → Transfer bancar; `termsAgreement` By placing your order, you agree to our terms and conditions. → Prin plasarea comenzii, ești de acord cu termenii și condițiile noastre.; `preferredDeliveryDate` Preferred Delivery Date → Data de livrare preferată; `country` Country → Țară; `selectCountry` Select country... → Selectează țara...; `birthday` Birthday → Data nașterii; `birthdayHint` For a birthday surprise! → Pentru o surpriză de ziua ta!; `billingDetails` Billing Details → Date de facturare; `firstName` First Name → Prenume; `lastName` Last Name → Nume; `orderAsCompany` Order as a company → Comandă ca persoană juridică; `companyName` Company Name → Nume firmă; `taxId` Tax ID → CUI; `taxIdPlaceholder` (empty) → ex. 12345678; `vatNumber` VAT Number → Nr. TVA; `vatNumberPlaceholder` (empty) → ex. RO12345678; `registrationNumber` Registration No. → Nr. Reg. Com.; `registrationNumberPlaceholder` (empty) → ex. J40/1234/2020; `useSameAsShipping` Use same address for billing → Folosește aceeași adresă pentru facturare; `billingAddress` Billing Address → Adresa de facturare; `signIn` Sign In → Autentificare; `accountLabel` Account → Contul meu

## 6. Abstractions introduced (one line each)

- Pick types `CartPageStrings`, `CheckoutPageStrings`, `AccountPageStrings`, `AddToCartStrings`, `CommerceBarStrings`,
  `NavbarCommerceStrings` — users: `SitePage` / the layout and each component; axis: none (the § 5.3 rule "each client
  component gets only its keys"); rejected: passing the whole commerce part (178 keys, count keys included, into every
  RSC payload) or keeping `COMMERCE_STRINGS_DEFAULTS` prop defaults (§ 10.2 removes them).
- `withFallback` / `pick` (SitePage, local) — users: the four view helpers; axis: none; rejected: 60 inline
  `s.k || d.k` / `s.k` lines.
- `cartPageStrings`, `checkoutPageStrings`, `accountPageStrings`, `addToCartStrings` (SitePage, local) — one caller
  each; not an abstraction layer but a named key list per view, kept out of the JSX branches; rejected: inline object
  literals of 20-60 keys inside JSX.
- `formatLocaleProp` (SitePage, local) — users: account and checkout branches; axis: none; rejected: repeating the
  conditional spread (the 1a `dateLocale` precedent).
- `interpolateNodes` (SitePage, local) — users: 6 sentences of the confirmation and tracking pages; axis: none;
  rejected: `fillTemplate` (merges the value, changes en-US bytes, cannot hold markup) and the layout's `interpolate`
  (values are primitives only; not exportable from a Next layout file).
- `STATUS_LABEL_KEYS`, `ORDER_STEP_KEYS`, `ORDER_HISTORY_KEYS` — users: the account badges, the tracking timeline and
  history; axis: none (status value → key); rejected: a `switch` per site.
- `proof.mjs` `orderRequests` — users: `EN_US_REQUESTS`, `LOC1_REQUESTS`; axis: commerce fixtures and their orders added
  later → a rule over `fixtures.mjs` (the 1a `EN_US_REQUESTS` precedent); rejected: a hand list.
- `proof.mjs` `renderItem` `segment` — users: `ro-expected.json` (4 items), rows `loc1-ro-*`; rejected: unlisted
  fragment items (an unexplained change) or fragment keys (§ 2.2 rule 2).
- `locale-1/extract.mjs` — users: `proof.mjs` (re-export), `locale-1d-client.test.ts`; a test seam: vitest gives modules
  other than the test file an `http://` `import.meta.url` under jsdom (EXECUTED, scratch check, removed), so the proof
  module graph cannot load there; rejected: a copy of the extraction in the test.
- `export` of `DeliveryDatePicker` (`CheckoutPageView.tsx`, iteration 1) — users: `locale-1d-client.test.ts` only; a test seam: no page state reaches its loading branch (§ 8); rejected: a coverage exception without a test, and changing when the page mounts the picker (production reachability). No behaviour change; serving bytes unchanged (gate 6).
- Coverage check flag `props: true` (iteration 1) — users: `1d/coverage.json`, `locale-coverage.test.ts`; marks a test of a mocked component's props; rule: every allocated key needs a check at its reader; rejected: listing the three keys as exceptions (a special-case list the next review extends).
- Capture modes `LOCALE_1D_CAPTURE`, `LOCALE_1D_SERVER_CAPTURE` — users: the one start-commit capture each (and a reviewer
  who re-runs it); rejected: hand-written "today's markup" (the `cmrc-counties-1` precedent).

## 7. Deviations from the design, and local decisions (one line each)

- **D1** `site.errorTryAgain` ships in `1d`: § 8.5 plans the `CheckoutPageView.tsx:345` check in `1d`, and `1c` cannot touch
  a commerce file. RO proposed `A apărut o eroare. Încearcă din nou.` instead of § 6.1's `Ceva nu a funcționat. Încearcă din
  nou.`, for consistency with the approved `1a` amendment #49 (`formErrorShort` → `A apărut o eroare`). `1c` reuses the key.
- **D2** The F rule is applied on the server (the 1b D8 precedent), not through `defaults` props: one prop per view.
- **D3** `formatLocale` (spread only for a non-en-US tenant, the 1a `dateLocale` precedent) feeds the formatters that used
  the runtime default or a fixed `"en-US"`; `CheckoutPageView` keeps its `locale` prop for the two dates it already had.
- **D4** `CartWidget`'s `showTotal` + `currency` became `total?: { template, currency }` (a flag with fields valid only when it
  is set); two callers, both in the allocation, checked by the compiler. The `currency || "USD"` rule moved to `CommerceBar`.
- **D5** `Navbar` gets `commerceStrings?` (present exactly on commerce sites), beside `commerceEnabled`: replacing the flag
  would change the payload of every non-commerce page (the 1b `interest` precedent).
- **D6** The navbar account texts are pattern D (§ 5.2 lists no F site there); the commerce bar's are F.
- **D7** Fixtures: `cm1-commerce` gets `integrations.bankTransfer` and two orders; the captured order has no `statusHistory`
  (its time depends on the server time zone; an immutable capture cannot pin it) — the history is proven headless with
  `TZ=UTC`.
- **D8** `before/` also holds the RO copies; rows `loc1-ro-*` compare each copy with its own start capture (so a listed item
  is a change of this slice); `text-expected.json` is not needed (zero en-US ledger rows).
- **D9** (corrected in iteration 1, review-0 R1) A known status renders its badge text as resolved — a stored `""` renders an empty badge (pattern D); only a status WITHOUT a key renders as stored. The iteration-0 text ("falls back to the raw status, the inherited `|| status`") described a defect, now fixed.
- **D10** Row `cmrc-counties-diff` is retired: its oracle (the `959f288` capture plus one difference) cannot hold once every
  commerce page changes; `loc1-diff-1d` compares the same URLs with the `92adbba` capture, which contains the counties
  change; row `cmrc-counties-1` and its unit tests still pin that change. Its capture set stays. The two comparisons are
  NOT the same (iteration 1, review-0 R3): the retired row used CM1-A1 exactly; `loc1-diff-1d` uses CM1-A1 plus the ruled
  resolved-tree payload comparison of `locale-1b` (LOCALE1B-ROW-CUT = A: payload row labels and row cuts are not compared).
  The CM1-A1-exact comparison of the 32 commerce/content URLs continues in rows `cm1-identity-*`, against the baseline this
  slice re-captured. No comparator was changed.
- **D11** The extraction moved to `extract.mjs` unchanged (§ 6).
- **D12** Row `cmrc-counties-1`'s strings assertion changed from "RO copy = en-US tenant" to "each = its language's table"
  (texts now follow the language; still never the country). Tests whose expectation changed: § 9.
- **D13** `CartPageView` keeps `addMoreForFreeDelivery.replace("{amount}", …)` (not `fillTemplate`, which § 5.1 lists): no
  requirement needs it, and it would change a stored override that repeats the placeholder.
- **D14** Five existing keys have no visitor reader and are not allocated (F-LOCALE1D-UNREAD-KEYS).

## 8. Findings

- **F-LOCALE1D-UNREAD-KEYS** (OBSERVED, `git grep` over `renderer/src` and `packages/plugins/src`, a text search):
  `orderConfirmation`, `contactInformation`, `fullName` (only a local variable), `shippingStreetAddress`,
  `billingStreetAddress` are read by no visitor surface; Labels still offers them. `orderConfirmation` ("Order
  Confirmation") overlaps the new `metaOrderConfirmationTitle`. Not changed (a removal is a stored-data question).
- **F-LOCALE1D-UNREACHABLE** (OBSERVED in code): `deliveryDatesLoading` — the date picker section is shown only after the
  dates loaded, so its loading text never renders; `variantUnavailable` — an out-of-stock option is a disabled button, so
  it cannot be selected at mount. Iteration 1: both are now checked at their reader (the picker rendered with `loading`, exported as a test seam; an option that becomes out of stock while selected) — visitor reachability is unchanged.
- **F-LOCALE1D-307-TITLE**: the 307 handoff bodies of `/cart` and `/checkout` on non-commerce sites carry the commerce title
  (`buildSitePageMetadata` matches the prefix before the commerce check); on a RO tenant it is Romanian now. Not shown.
- **F-CMRC-COUNTIES-LABEL** (from `cmrc-counties-1`) stays: an English shop's free-text region field is labelled "County".
- `renderer/src/lib/dynamo.ts:156-160` (not allocated) still says the commerce date readers are "not touched by this slice"
  (1a wording); stale after 1d, harmless.
- The `1b` record § 1 lists `getCommerceStrings` as present; correct for `1b`, not edited (records are immutable).

## 9. Rows and tests whose expectation changed

| Row / test | Old expectation | New |
|---|---|---|
| `loc1-diff-1b` | 4e98f98 capture + 1b list | replaced by `loc1-diff-1d` (92adbba capture + 1d list) |
| `loc1-text-<catalog subjects>` | exactly L-EN-CAT | equal (L-EN-CAT is in `before/`) |
| `loc1-ro-*` | against the EN source (content, commerce) or the EN catalog capture | against the same copy's 92adbba capture |
| `loc1-subjects` | `before/` = en-US URLs; L-EN-CAT subjects | `before/` = en-US + RO URLs; category 2 only |
| `cmrc-counties-1` | RO copy `strings` = en-US `strings` | each = its language's table (58 keys) |
| `cmrc-counties-diff` | 959f288 + 1 difference | retired (D10) |
| `cm1-identity-*` | baseline from the cmrc-counties-1 tree | baseline from this tree |
| unit `cmrc-counties-1-site-page` "COUNTIES-TEXT-LAYER = off" | strings = the English-defaults export, key order | strings = the same tenant's without a country; RO pack text differs |
| unit `cmrc-counties-1-checkout`, `-fields` | the English-defaults export | the EN table (same values) |
| unit `locale-1a-*` | RO cookie/legal values from the RO country pack | from the RO language pack (same values) |
| unit `locale-1b-server-render` add-to-cart props | 5 keys | 8 keys |
| unit `locale-coverage` | 1a, 1b files | + 1d; commerce keys after the 77 pre-locale ones all allocated |

## 10. Operator's staging checklist (Layer 2) and the human's pre-deploy step

Deploy order (§ 4.5): admin → renderer (no backend change). Rollback: renderer first.

1. Admin to staging: Labels on `cm1-commerce` shows the commerce cards per page; placeholders are the English texts.
2. Renderer to staging. Layer 2 extraction (`locale-1/proof.mjs` `extractVisibleText`) of the 51 CM1 URLs against a
   capture taken before the deploy: **all text-identical** (commerce, content, catalog). Optional: an order confirmation
   and tracking page of a staging test order, before and after — text-identical.
3. RO evidence needs a RO staging shop (none exists): a copy of `cm1-commerce` with `locale: "ro-RO"`, compared with
   `1d/ro-expected.json`, or Layer 2 stays EN-only.
4. **Human, before the prod renderer deploy:** approve or amend the table of § 5 (D1 row 81 included). `povesti-pe-biscuite`
   already has `locale: "ro-RO"` (1a pre-deploy step). If it stores copies of the old pack texts, they keep showing (rule
   2); "Reset to the language defaults" in the Commerce section removes them.

## 11. Not done here

`docs/ROADMAP.md` and `CURRENT_SLICE.md` (not allocated; the operator updates them at closeout). No browser end-to-end run
(no allocated E2E target covers the commerce forms; the jsdom states are the client proof with mocked I/O). Money stays
`toFixed(2)` + currency code (§ 3.2 item 5, deferred). Track B (`cmrc-1` …) has not started.

## 12. Iteration 1 — review-0 findings, the class each is an instance of, and the rule that closes it

| Finding | Class of defect | Rule now in the tree |
|---|---|---|
| R1 empty overrides at nine new keys rendered another text (`AccountPageView` badges → raw status; checkout `orderFailed` "" → the status text, `orderFailedStatus` "" → `errorTryAgain`) | a truthiness fallback (`||`) that tests a TRANSLATED value, so a pattern-D `""` (§ 5.2) is replaced | a fallback may test only a non-translated value (server text, a runtime error message, session data) to choose a branch; a table text is shown exactly as resolved; the F rule lives only in `SitePage` (`withFallback`) and the two commerce-bar labels of `layout.tsx`. Applied: the badge shows the key's text for a known status, the raw status only for an unknown one; the checkout chooses the failure branch from the response (not JSON → `orderFailed`; a server `error` → as sent; else → `orderFailedStatus`) and sets that text directly. Audit (EXECUTED, every `||` of the 8 renderer files and `layout.tsx`): no other site tests a translated value. Tests: § 3 D-preservation cases, EN and RO |
| R2 `placingOrder`, `deliveryDatesLoading`, `variantUnavailable` covered only by a props test of mocked components | a coverage entry backed only by props, not by the reader that renders the text | `coverage.json` marks props-only checks `props: true`; `locale-coverage.test.ts` fails a key whose checks are all props-only (bound by a red case). The three keys now have reader states (§ 3); no production reachability changed |
| R3 the retired counties row's successor was said to use "the same comparison" | an equivalence claim between two oracles without naming each one's comparison | every place that names `loc1-diff-1d` as the successor states both: the retired row CM1-A1 exactly; `loc1-diff-1d` CM1-A1 plus the ruled resolved-tree payload comparison (LOCALE1B-ROW-CUT = A); the CM1-A1-exact check continues in `cm1-identity-*` (`contract.test.mjs`, serving README, `cm1-byte-identity/README.md`, `renderer/ARCHITECTURE.md`, D10). No comparator changed |

Iteration-1 evidence (EXECUTED): the ten gates exit 0 (renderer 317/317; serving 91/91 with the UNCHANGED strict
baseline — the two fixes are client-only and the `export` changes no served byte); then 6 consecutive serving runs, each
exit 0 (91/91). The review's two submitted items (counties-row retirement, `site.errorTryAgain`) were accepted subject to
R3; the Romanian table still needs the operator's approval (§ 10 step 4).


## 13. Operator approval of the Romanian text table (2026-11-01)

Authority: the human's overnight delegation of 2026-10-31 ("use your best judgement on the Romanian text table -
implement what you recommend"). The § 5 table is approved with one amendment, applied after review approval in
`packages/shared/src/language-packs/ro.ts` (no test pins the value); the gates were re-run on the amended tree. The
§ 5 rows stay as the builder's proposal; this section wins.

| # | Key | Proposed | Approved | Reason |
|---|---|---|---|---|
| 30 | `commerce.accountSignInPrompt` | Autentifică-te ca să vezi comenzile și să îți gestionezi contul. | Autentifică-te pentru a vedea comenzile și a-ți gestiona contul. | the register of the `1a`/`1b` amendments |

Every other row is approved as proposed. Stored `commerceStrings` overrides of a tenant still win; a tenant admin can
override any value on the Labels page.

## 14. Operator closeout (2026-11-01)

- **Relay.** Builder claude-opus-5-5, reviewer gpt-6.1-sol; 2 cycles (review-0: empty overrides of known statuses,
  reader-level coverage of three keys, comparator wording; review-1 approved). Freeze exception LOCALE1-FREEZE = A was
  the operator's decision in the packet under the human's overnight delegation (Track B entirely PLANNED, so no
  parallel work).
- **Gates.** The ten common gates and the packet's extra checks passed on the accepted candidate and again with the
  § 13 amendment (`ALL GATES GREEN`); `L1D-NO-READER` exits 1 (no reader of `getCommerceStrings`,
  `COMMERCE_STRINGS_DEFAULTS` or `defaultStrings` remains in `renderer/src`, `admin/src`, `packages/shared/src`).
- **Staging (Layer 2), en-US.** `cdk diff`: Lambda code and nested-stack template URLs only (41 functions, 3 nested
  stacks). All 51 CM1 URLs equal in status, content type and visible text after the deploy, and again after the
  § 13 amendment was deployed. Staging has no order confirmation/tracking page and no cart with items; those states
  are proven by the serving rows (`loc1-order-pages`) and the unit tests.
- **Not proven on staging.** Romanian commerce rendering (no Romanian staging shop); proven by `loc1-ro-commerce` and
  `1d/ro-expected.json`.
- **D1 approved:** `site.errorTryAgain` RO "A apărut o eroare. Încearcă din nou." (consistent with the `1a`
  amendment of `formErrorShort`).
- **Human, before the prod renderer deploy:** `povesti-pe-biscuite` must already have `locale` = `ro-RO` (the `1a`
  step). Its stored copies of old pack texts keep showing; "Reset to the language defaults" in the Commerce section
  removes them if wanted.
