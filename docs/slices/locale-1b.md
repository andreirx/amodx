# LOCALE-1B — catalog part, shared product surfaces and Romanian plurals (record)

Status: **BUILT 2026-11-01, revised in iteration 1** for review-0 and the operator rulings of 2026-11-01 (packet § 6:
LOCALE1B-WIDGET = A, LOCALE1B-ROW-CUT = A, the R3 defect, the coverage-checker rename) **and in iteration 2** for the second
review-0 and the operator rulings of packet § 7 (R4, R5, the element-only lazy rule, the strain bound) — builder;
uncommitted, for review.
Slice row `locale-1b` of `docs/slices/locale-1.md` § 10, under the human rulings of § 16 (they win over §§ 8, 10, 11), on
top of `locale-1a` (`4e98f98`, `docs/slices/locale-1a.md`). Start: `main` at `4e98f98`, tree clean (EXECUTED). Maturity of
the resolution module: **PROTOTYPE** (MATURE at the end of `locale-1d`). No item is stopped; the comparator is changed only as the
second review and packet § 7 state (§ 9).

What the slice does, in one paragraph: the catalog part of the tenant locale table gets its keys (the interest list, its
header widget and the facet panel, 39 keys), the commerce part gets the 21 keys of the product, category, shop and search
pages shared by commerce and catalog sites, and a count text now holds one text per plural category of its language
(`Intl.PluralRules`: English `one`/`other`, Romanian `one`/`few`/`other` — "1 produs", "2 produse", "20 de produse").
`buildFacetListing` takes the two fixed facet headings as a required parameter. The renderer's shared product surfaces,
the facet panel, the interest toggle, list page and header widget read the resolver; the admin Labels page edits the two
new groups (one input per plural category for a count key); the import preview shows the tenant's headings. **en-US
tenants render the same visible text** on every captured URL of the six non-catalog en-US fixtures (40 URLs); the two
en-US catalog fixtures (34 URLs) change by exactly L-EN-CAT (227 listed items). The Romanian catalog copy shows today's
Romanian catalog texts, except two counts that take the plural form (L-RO-PLURAL). The byte gate compares every URL;
none is excluded.

## 1. Changes, per item (file:line in the candidate tree)

| Item | File:line | What |
|---|---|---|
| Plural schema | `packages/shared/src/index.ts:590` `PluralTextsSchema` (six CLDR categories, each optional) | a count key's stored/packed value (§ 16.2 item 6) |
| 21 shared commerce keys | `index.ts:697-717` (in `CommerceStringsSchema`; three count keys `reviewsSummary`, `productCount`, `searchResultCount`) | § 6.2 shared rows without the two `CategoryShowcaseRender` rows (D2) |
| 39 catalog keys | `index.ts:732` `CatalogStringsSchema` (count keys `facetsCount`, `interestWidgetLabel` `:738`) | § 6.3 (the `…One/…Other` pair = one key, D1) |
| Resolved types | `index.ts:849` `CountText = { language, forms, english }`, `ResolvedPart`, `LocaleStrings` | a count key keeps every form it has (R3) |
| Re-exports | `index.ts:14-15` (`selectPluralText`, `pluralCategoriesOf`, `PLURAL_CATEGORIES`, `PluralCategory`), `:43` `FacetLabels` | |
| Resolver | `packages/shared/src/locale-strings.ts:17` `PLURAL_CATEGORIES`, `:22` `pluralCategoriesOf`, `:34` `selectPluralText` (form → language `other` → English by English rules → English `other`), `ownPluralTexts`, `:133` `countText` (pack forms, then tenant forms, every form kept), `resolvePart`, `resolveLocaleStrings` | per-category layering (R3, ruling item 3) |
| Pack types | `language-packs/types.ts:22` `CompletePart` | EN count values must have `other` (compile time) |
| EN / RO values | `language-packs/en.ts` (commerce `:109-129`, catalog `:133`); `ro.ts` (commerce `:25-45`, catalog `:47`) | EN catalog = § 6.3 EN column; RO catalog = today's literals; RO counts `one`/`few`/`other` |
| Facets | `packages/shared/src/facets.ts:61` `FacetLabels`, `:230` `variantLabel(base, fallback)`, `:401` `buildFacetListing(base, f, path, labels)` | the two Romanian constants removed; ids/hrefs unchanged |
| Shared tests | `test/locale-strings.test.ts` (1b allocation; plural cases EN 0/1/2, RO 0/1/2/19/20/101/119/120 incl. the widget label; overrides per category; Polish throwaway pack incl. kept partial forms; French missing-key case); `test/facets.test.ts` (new EN-labels case); `test/cat-import-profile-1b-golden.ts` `RO_FACET_LABELS`; the golden test, `facet-modes.test.ts`, capture tool `recorder.ts`, `listing.capture.ts` pass it | golden JSON NOT re-recorded |
| PUT limits | `backend/src/tenant/settings.ts:63` `textsOf`, `:84` | a value may be a count text (keys ⊆ `PLURAL_CATEGORIES`, each text ≤ 500 units); `backend/test/unit/locale-settings.test.ts` +2 cases × 2 attributes |
| Admin Labels | `admin/src/pages/Labels.tsx:62` `setCountText`, `:77` `PRODUCT_PAGE_KEYS`, `:85-86` `LabelsSection` / `SECTION_HOME`, `countInputs` (placeholder = the `selectPluralText` chain), `CountF`, Catalog group (incl. the three widget inputs, `:487`), "Product pages & search" group | § 7.1; the seven existing keys a catalog site renders moved into "Product pages & search" (D4) |
| Admin preview | `admin/src/components/glamPreview.ts:45` `facetLabels`, `:52` `siteContextOf` (resolves `GET /settings`), `:280` | `GlamPricelistImport.tsx` unchanged (the same call yields a richer context) |
| Admin tests | `Labels.test.ts` (sections, count inputs, `setCountText`, Reset of the new sections, JSX inputs incl. `CountF`); `glamPreview.test.ts` (`RO_FACET_LABELS` on both sides of every equality + 2 new cases); `GlamPricelistImport.test.ts` (passes `RO_FACET_LABELS`) | no expectation rewritten except as listed |
| SitePage | `renderer/src/components/SitePage.tsx:85` `getCommerceStrings` (commerce-only callers now), `:95` `searchBarLabels`, `:106` `facetLabelsOf`, `:112` `interestToggleStrings`, `:117` `interestListStrings`, `:173-210` metadata, `:276` list page, `:324` product caller (§ 9 item 2), `:335`, `:349` `buildFacetListing`, `:735` `ProductCard`, `:876` `ProductPageView`, `:1128` reviews summary, `:1201-1266` facet panel, `:1266` / `:1320` / `:1389` category / shop / search views, `:1309`, `:1422` counts | `getSearchLabels` removed |
| InterestShortlist | `renderer/src/components/InterestShortlist.tsx:56` `InterestToggleStrings`, `:59` `InterestWidgetStrings`, `InterestListStrings`, `:139` `InterestWidget` (`:145` plural `aria-label`), toggle, list page | all three components read `strings` props |
| Header widget wiring | `renderer/src/app/[siteId]/layout.tsx:106`, `:208-211` (`interest.strings`, catalog tenants only); `renderer/src/components/Navbar.tsx:9`, `:60`, `:172`, `:186` | ruling LOCALE1B-WIDGET = A (allocation extended) |
| SearchBar | `renderer/src/components/SearchBar.tsx:13` `SearchBarLabels`, `:23`, `:167` | `labels` and `placeholder` required; English literal fallbacks removed (the F rule is on the server) |
| ProductByIdPage | `renderer/src/components/ProductByIdPage.tsx:65`, `:143`, `:148` | `buyNow`, `preOrder`, `outOfStock` |
| Renderer tests | `test/unit/locale-1b-server-render.test.ts` (28, incl. the layout → Navbar → widget wiring), `test/unit/locale-1b-client.test.ts` (26, incl. the widget's four plural categories and its storage notice), `interest-toggle.test.ts` (passes the RO toggle texts), `test/unit/locale-coverage.test.ts` (the coverage checker, renamed from `locale-1a-coverage.test.ts` and extended) | |
| Fixtures | `renderer/test/serving-contract/fixtures.mjs:510`, `:531` `LOC1.roCatalog` | copy of `cm1-catalog`, `locale: "ro-RO"` |
| Proof | `locale-1/proof.mjs`: `:274` `splitTextRows`, `:297` `Generated`, `:302` `rawObject`, `:309` `canon`, `:316` `resolveFlight` (`:369` element-only lazy rule), `:386` `firstDifference`, `:411` `stripProp`, `checkExpected` (category-2 `beforeValue`; payload compared as resolved trees), `renderItem`, `:68` `PRE_1B_COUNT_TEXT`; the 1a `renumberRows` and its helpers removed (subsumed, ruling item 2); `locale-1/1b/{before/,expected-diff.json,text-expected.json,ro-expected.json,coverage.json}` | |
| Rows | `contract.test.mjs` `loc1-subjects`, `loc1-text-<subject>`, `loc1-text-mutation`, `:1924` `loc1-diff-1b` (replaces `loc1-diff-1a`, D6; no waiver), `loc1-facet-hrefs`, `:1989` `loc1-flight-controls` (replaces `loc1-renumber-controls`), RO rows incl. new `loc1-ro-catalog`; `cf1-*` rows read the English copy (8 assertions); `cm1-identity-*` titles say "locale-1b tree" | |
| Strict baseline | `cm1-byte-identity/baseline/` re-captured from the final tree (build `FXLhlwklOBQR2eMVwk7XX`); `cm1-byte-identity/README.md` history row and comparison paragraph | § 8.5 rule 4 |
| Docs | `packages/shared/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, `admin/ARCHITECTURE.md` (the three § 6.3 lines + the locale sections), `renderer/test/serving-contract/README.md` | |

## 2. Oracles (EXECUTED 2026-11-01, iteration 2, in the packet's order, on the final tree)

| # | Command | Exit | Last lines |
|---|---|---|---|
| 1 | `npm --prefix "…/amodx" run build` | 0 | `> infra@0.1.0 build` / `> tsc` |
| 2 | `npm --prefix "…/amodx" run typecheck` | 0 | `> tsc --noEmit` |
| 3 | `npm --prefix "…/packages/shared" test` | 0 | `Tests 242 passed (242)` |
| 4 | `npm --prefix "…/packages/plugins" test` | 0 | `Tests 201 passed (201)` |
| 5 | `npm --prefix "…/renderer" test` | 0 | `Tests 239 passed (239)` |
| 6 | `npm --prefix "…/renderer" run test:serving` | 0 | `# tests 89` / `# pass 89` / `# fail 0`; then 6 consecutive runs, each exit 0, 89/89 |
| 7 | `npm --prefix "…/admin" run test:unit` | 0 | `Tests 175 passed (175)` |
| 8 | `npm --prefix "…/backend" run test:unit` | 0 | `Tests 1192 passed \| 1 skipped (1193)` |
| 9 | `npm --prefix "…/tools/mcp-server" test` | 0 | `# pass 13` / `# fail 0` |
| 10 | `git -C "…/amodx" diff --check` | 0 | (no output) |
| + | `git -C "…/amodx" diff --stat -- infra docs/slices/locale-1.md docs/slices/locale-1a.md backend/src/import` | — | prints nothing |
| + | `git diff --name-only \| grep -E "package(-lock)?\.json$"` | — | prints nothing (no dependency change) |
| + | `git status --porcelain -uall` | — | only allocated paths (packet § 4 + § 6 item 1) |
| + | untracked non-`.body` files: `grep -nE "[[:space:]]+$"` | — | no hit |

`…` = `/Users/apple/Documents/APLICATII BIJUTERIE`. Never run: `cd backend && npm test`.

Serving rows of this slice, from the final runs: `(loc1-subjects) 8 subjects, 74 URLs …; L-EN-CAT subjects: catalog,
cip1b-catalog`; `(loc1-text-<subject>)` fixture-tenant 3 HTML URLs / 23 items all equal, wk 1 / 8, iso-a 3 / 29, iso-b 1 / 8,
commerce 14 / 308, content 10 / 118 — all equal; catalog 15 / 527 with 123 L-EN-CAT changes, cip1b-catalog 15 / 449 with
104, all listed; `(loc1-text-mutation)` ok; `(loc1-diff-1b)` ok on all 74 URLs, no waiver; `(loc1-facet-hrefs) 137 filter
hrefs equal to the 4e98f98 capture`; `(loc1-flight-controls) 3 positive controls equal; 7 mutations, 3 1a R5
counterexamples, 3 typed-reference changes, 7 second-review controls and the real-payload productId mutation reported; 3
unknown forms and a disconnected cycle fail closed`; `(loc1-ro-content) 14 URLs, 38 text changes … {"L-RO-1":34,"L-RO-2":2,"L-RO-3":2}`; `(loc1-ro-commerce) 18 URLs,
74 … {"L-RO-1":55,"L-RO-2":10,"L-RO-3":9}`; `(loc1-ro-catalog) 19 URLs, 60 … {"L-RO-1":50,"L-RO-2":7,"L-RO-PLURAL":2,
"L-RO-3":1}`; `cm1-identity-commerce` / `-content` 32 × `same`; `cm1-control` ok; `cf1-*` ok.

## 3. Proof per fixture (§ 8.5; packet hard rules 1-2)

- **Start-commit capture** (EXECUTED, iteration 0): `renderer/test/serving-contract/locale-1/1b/before/` — the 74
  responses of `EN_US_REQUESTS`, from `4e98f98` in the worktree `/tmp/LOCALE-1B-before` (removed), built with that commit's
  shared/effects/plugins, served with THIS tree's `fixtures.mjs` (only `roCatalog` added), `ddb-stub.mjs` and
  `harness.mjs` (byte-identical, `diff -q`). Build `X_EO42dn1h56RiwlRENLM`; stub `unhandled` = `[]`. Not re-captured in
  iteration 1 (immutable).
- **Visible text**: rows `loc1-text-<subject>`; the oracle per subject: equal to `before/`; for the two en-US catalog
  subjects, the item list must equal `1b/text-expected.json` exactly, and each item's `from` is rendered from the RO pack
  (today's literal; a count: the pre-1b text, `PRE_1B_COUNT_TEXT`) and its `to` from the EN pack.
- **Bytes**: row `loc1-diff-1b`, `1b/expected-diff.json`, every URL compared, none excluded:

| Fixture | URLs | Category 1 | Category 2 | Category 3 |
|---|---|---|---|---|
| `cm1-commerce` (en-US) | 18 | `/category/rugs` `3<!-- --> product<!-- -->s` → `3 products`; `/search?q=rug` `4 results` (HTML + payload form, anchored on the element class) | changed prop `SearchBar.labels` (`"$undefined"` ×4 → `Search` / `No products found` / `Searching...` / `View all results`) on shop ×2, category, product ×4, search; changed prop `CartPageView.strings` / `CheckoutPageView.strings` (77 keys unchanged + the 21 keys of 1b, EN values; verified programmatically) on `/cart`, `/checkout`; 8 other URLs `[]` | 0 |
| `cm1-content` (en-US) | 14 | `/category/mats` `1 product`; `/search?q=rug` `1 result` | 0 (no search bar on this fixture) | 0 |
| `cm1-catalog` (en-US) | 19 | the category / search counts | `SearchBar.labels` (changed); `InterestToggle.strings` added on every toggle; `Navbar.interest` changed on every HTML page (`{ tenantId, listPrefix }` → `+ strings`, the widget texts) | L-EN-CAT (HTML + payload forms): `Filtre`, `{n} produse` → `{n} products`, `Producător` → `Brand`, `Mă interesează` → `I&#x27;m interested`; the widget (HTML only, a client render): `aria-label="Lista mea: 0 produse"` → `"My list: 0 products"`, `Lista mea` → `My list` |
| `cip1b-catalog` (en-US) | 15 | the category counts | `InterestToggle.strings` added; `Navbar.interest` changed | L-EN-CAT, also `Variantă` → `Option`; the widget items |
| `fixture-tenant`, `wk`, `iso-a`, `iso-b` | 3, 1, 3, 1 | 0 | 0 | 0 (`[]`, byte-equal) |

  Outside the payload the HTML is compared byte for byte (CM1-A1). The payload is compared as resolved trees
  (`resolveFlight`, ruling LOCALE1B-ROW-CUT = A, § 9): equal on all 74 URLs after the listed differences. Bound mutations
  inside `loc1-diff-1b`: on commerce `/category/rugs` each listed entry dropped, a ghost entry, one HTML byte, a changed
  prop value, a wrong before value; on catalog `/product/oak-plank` a dropped category-3 entry — each reported. The
  comparison's own controls are row `loc1-flight-controls` (§ 9).
- **RO copies**: `loc1-ro-content`, `loc1-ro-commerce` (against the EN source of the same run) and `loc1-ro-catalog` (against
  the start capture of the EN catalog tenant, i.e. today's Romanian catalog texts: a catalog-part item may only be an
  L-RO-PLURAL count). The RO header widget renders the list empty on the server (count 0): "Lista mea: 0 produse" before
  and after (`few`), so it adds no item.
- **Facet ids**: `loc1-facet-hrefs` — the 137 filter hrefs of the catalog pages (two EN subjects and the RO copy) equal the
  start capture.
- **Strict baseline advanced** (§ 8.5 rule 4, EXECUTED): in iteration 0 the strict rows failed only on the 12
  commerce/content URLs with listed entries; `baseline/` was re-captured then, and again in iteration 1 from the final tree
  (the commerce/content captures are unchanged in content; the catalog captures now include the widget); reviewed reason
  = `1b/expected-diff.json`.
- **Client-only states and states the fixtures do not reach** (jsdom / headless server render): every key and every
  plural category, per `1b/coverage.json` (85 entries, checked by `locale-coverage.test.ts`; § 6).

### en-US byte-equality of the English count texts (packet rule 3, per site)

| Site | Today | After (EN) | Same visible text |
|---|---|---|---|
| category count `SitePage.tsx:1309` | `{total} product{total !== 1 ? 's' : ''}` | `productCount` `one` "{n} product" / `other` "{n} products"; `Intl.PluralRules("en")`: 1 → one, every other integer → other | yes (unit: n = 0…1000 equal to today's rule); bytes: category 1 |
| search count `:1422` | `{total} result{s}` | `searchResultCount` | yes; category 1 |
| reviews summary `:1128` | `{avg}/5 ({n} review{s})` | `reviewsSummary` | yes (unit); not on a fixture |
| facet count `:1205` (catalog only) | `n === 1 ? "1 produs" : `${n} produse`` | L-EN-CAT | changes by ruling |
| widget label `InterestShortlist.tsx:145` (catalog only) | `Lista mea: ${count} produse` | L-EN-CAT ("My list: 0 products") | changes by ruling |

## 4. Ledger rows that occurred (exact strings)

- **L-EN-CAT** (`catalog`, `cip1b-catalog`; 123 + 104 items, all in `text-expected.json`): `Filtre` → `Filters`
  (`aria-label` ×3 + text ×6 per subject), `42 produse` → `42 products` (×2), `3 produse` → `3 products` (catalog ×1, cip1b
  ×2), `10 produse` → `10 products` (×1), `Producător` → `Brand` (×2 / ×1), `Variantă` → `Option` (cip1b ×1), `Mă
  interesează` → `I'm interested` (×57 / ×30); the header widget on every HTML page, desktop and mobile mount: `Lista mea:
  0 produse` → `My list: 0 products` (`aria-label`) and `Lista mea` → `My list` (×26 each / ×30 each). The other catalog
  keys render only in client states or on URLs not captured; their L-EN-CAT values are in § 5 and proven by unit tests.
- **L-RO-3** (product page `:324` and search page on the resolver; RO copies): `Description` → `Descriere`; `5+ units` →
  `5+ unități`; `In Stock` → `În stoc` (product page); `Out of Stock` → `Stoc epuizat` (×2, product page + add-to-cart);
  `Add to Cart — 80.00 USD` → `Adaugă în coș — 80.00 USD` (and `50.00`); `Results for "rug"` → `Rezultate pentru "rug"`
  (also `"plank"`).
- **L-RO-2** (an existing key at a new place): the search button `Search` → `Caută` (15 URLs); the shop filter `In Stock`
  → `În stoc` (4 URLs).
- **L-RO-PLURAL**: captured (`loc1-ro-catalog`, `/shop` and `/shop?availability=in_stock`): `42 produse` → `42 de
  produse`. Unit-proven (client widget test, shared plural test): the widget label `Lista mea: 1 produse` → `Lista mea: 1
  produs`, `Lista mea: 20 produse` → `Lista mea: 20 de produse` (`0`, `2`, `19`, `101`, `119` keep `produse`; `120` → `de
  produse`); the facet count `20 produse` → `20 de produse`. In the fixtures no other count reaches `one` or `other`.
- **L-RO-1** (new keys and the 1a site keys on the new RO catalog copy): every other item of `ro-expected.json`.

## 5. Romanian text table — for the operator's approval before the prod deploy (§ 16.2 item 4)

Every key `1b` ships. "RO (proposed)" is `packages/shared/src/language-packs/ro.ts`; for the catalog part it is TODAY's
literal, verbatim (§ 6.3), except that a count key now has a `few` and an `other` form. A changed value is edited in
`ro.ts` only. `{…}` are placeholders filled at render. A count key shows every category; `<br>` separates them.

| # | Part.key | EN (renders for an en-US tenant) | RO (proposed; catalog = today's literal, counts with plural forms) | Where it renders |
|---|---|---|---|---|
| 1 | `catalog.interestListFull` | Your list already has 50 products. Remove one to add another. | Lista are deja 50 de produse. Scoateți un produs ca să adăugați altul. | interest toggle message, list full (client) |
| 2 | `catalog.interestAdd` | I'm interested | Mă interesează | interest toggle on cards and product page |
| 3 | `catalog.interestAdded` | In my list | În lista mea | interest toggle, product in the list |
| 4 | `catalog.interestListTitle` | My list | Lista mea | list page `<h1>` and `<title>`; header widget link text |
| 5 | `catalog.interestWidgetLabel` | one: My list: {n} product<br>other: My list: {n} products | one: Lista mea: {n} produs<br>few: Lista mea: {n} produse<br>other: Lista mea: {n} de produse | header widget link `aria-label` (the list's item count) |
| 6 | `catalog.interestStorageWarning` | This browser cannot save the list. We keep it while this page stays open. | Lista nu poate fi salvată în acest browser; o păstrăm cât timp pagina rămâne deschisă. | header widget notice when the browser cannot store the list |
| 7 | `catalog.interestStorageAck` | Got it | Am înțeles | header widget notice button |
| 8 | `catalog.interestBrowse` | See the products | Vedeți produsele | interest list page: link to the shop |
| 9 | `catalog.interestSentTitle` | Your list was sent | Lista a fost trimisă | interest list page after a send: heading |
| 10 | `catalog.interestSentBody` | Thank you! We received your list and will contact you soon. | Vă mulțumim! Am primit lista dumneavoastră și vă vom contacta în curând. | interest list page after a send |
| 11 | `catalog.interestExcludedIntro` | These products were not included because they are no longer available: | Aceste produse nu au fost incluse, pentru că nu mai sunt disponibile: | after a send: products not included (+ titles) |
| 12 | `catalog.interestEmpty` | Your list is empty. Press “{action}” on the products you like. | Lista este goală. Apăsați „{action}” la produsele care vă plac. | interest list page, empty list ({action} = interestAdd) |
| 13 | `catalog.interestErrorNoneAvailable` | The list has no available products. Choose the products again. | Lista nu are produse disponibile. Alegeți din nou produsele dorite. | list page error: nothing sendable |
| 14 | `catalog.interestErrorInvalid` | Check your details: your name, a valid e-mail address, the phone (at most 40 characters) and the message (at most 2000 characters). | Verificați datele: numele, o adresă de e-mail validă, telefonul (cel mult 40 de caractere) și mesajul (cel mult 2000 de caractere). | list page error: invalid form |
| 15 | `catalog.interestErrorCheck` | We could not check the list now. Try again in a few moments. | Nu am putut verifica lista acum. Încercați din nou peste câteva momente. | list page error: 503 |
| 16 | `catalog.interestErrorAllGone` | The products in the list are no longer available. Choose the products again. | Produsele din listă nu mai sunt disponibile. Alegeți din nou produsele dorite. | list page error: 400 with dropped |
| 17 | `catalog.interestErrorSend` | The list could not be sent. Try again. | Lista nu a putut fi trimisă. Încercați din nou. | list page error: other failure |
| 18 | `catalog.interestErrorNetwork` | The list could not be sent. Check your connection and try again. | Lista nu a putut fi trimisă. Verificați conexiunea și încercați din nou. | list page error: network |
| 19 | `catalog.interestPreviouslySent` | Your earlier list was received. The products below were not sent yet. | Lista trimisă anterior a fost primită. Produsele de mai jos nu au fost trimise încă. | list page: earlier list received |
| 20 | `catalog.interestContactHeading` | Your contact details | Datele dumneavoastră de contact | list page form heading |
| 21 | `catalog.interestName` | Name | Nume | form label |
| 22 | `catalog.interestEmail` | E-mail | E-mail | form label |
| 23 | `catalog.interestPhone` | Phone | Telefon | form label |
| 24 | `catalog.interestMessage` | Message | Mesaj | form label |
| 25 | `catalog.interestSubmit` | Send the list | Trimite lista | form send button |
| 26 | `catalog.interestRowExpired` | This product is no longer in the catalog. Choose it again from the current products. | Produsul nu mai este în catalog. Alegeți-l din nou din produsele actuale. | list row note |
| 27 | `catalog.interestRowUnavailable` | This product is not available now and will not be sent. | Produsul nu este disponibil momentan și nu va fi trimis. | list row note |
| 28 | `catalog.interestRowOptionGone` | The chosen option is no longer offered. Choose the option again. | Varianta aleasă nu mai este oferită. Alegeți din nou varianta dorită. | list row note |
| 29 | `catalog.interestCollection` | Collection | Colecția | list row: before the collection name |
| 30 | `catalog.interestRemove` | Remove {title} from the list | Scoateți {title} din listă | list row remove button `aria-label` |
| 31 | `catalog.facetsTooMany` | Too many filters selected — remove one | Prea multe filtre selectate — eliminați unul | facet value `title` + panel hint |
| 32 | `catalog.facetsCount` | one: {n} product<br>other: {n} products | one: {n} produs<br>few: {n} produse<br>other: {n} de produse | facet panel product count |
| 33 | `catalog.facetsUrlTooLong` | The filters in the address are too long and were not applied. | Filtrele din adresă sunt prea lungi și nu au fost aplicate. | facet panel notice |
| 34 | `catalog.facetsRemove` | Remove the filter {facet}: {value} | Elimină filtrul {facet}: {value} | chip `aria-label` |
| 35 | `catalog.facetsClear` | Clear the filters | Șterge filtrele | facet panel clear link (2 places) |
| 36 | `catalog.facetsNoMatch` | No product matches the selected filters. | Niciun produs nu corespunde filtrelor alese. | empty filtered result |
| 37 | `catalog.facetsTitle` | Filters | Filtre | facet panel `aria-label`, toggle label, heading |
| 38 | `catalog.facetProducer` | Brand | Producător | producer facet heading and chip label |
| 39 | `catalog.facetVariantDefault` | Option | Variantă | variant facet heading when option names differ |
| 40 | `commerce.metaCategoryDescription` | Browse {category} products | Vezi produsele din {category} | category page meta description (no SEO description) |
| 41 | `commerce.metaShopTitle` | Shop - {site} | Magazin - {site} | shop page `<title>` |
| 42 | `commerce.metaSearchQueryTitle` | Search: {query} - {site} | Căutare: {query} - {site} | search page `<title>` with a query |
| 43 | `commerce.metaSearchTitle` | Search - {site} | Căutare - {site} | search page `<title>` |
| 44 | `commerce.searchPlaceholder` | Search products... | Caută produse... | search bar placeholder when Settings has none |
| 45 | `commerce.shopTitle` | Shop | Magazin | shop `<h1>`; breadcrumb on product, category, search pages |
| 46 | `commerce.volumePricing` | Volume Pricing | Prețuri de volum | product page (commerce) |
| 47 | `commerce.preOrder` | Pre-order | Precomandă | product page and by-id page (commerce) |
| 48 | `commerce.buyNow` | Buy Now | Cumpără acum | product page and by-id page (digital product) |
| 49 | `commerce.ingredients` | Ingredients | Ingrediente | product page heading |
| 50 | `commerce.nutritionalValues` | Nutritional Values | Valori nutriționale | product page heading |
| 51 | `commerce.reviewsHeading` | Reviews | Recenzii | product page reviews heading |
| 52 | `commerce.reviewsSummary` | one: {rating}/5 ({n} review)<br>other: {rating}/5 ({n} reviews) | one: {rating}/5 ({n} recenzie)<br>few: {rating}/5 ({n} recenzii)<br>other: {rating}/5 ({n} de recenzii) | product page reviews summary |
| 53 | `commerce.categoryEmpty` | No products in this category yet. | Nu există încă produse în această categorie. | category page, no products |
| 54 | `commerce.productCount` | one: {n} product<br>other: {n} products | one: {n} produs<br>few: {n} produse<br>other: {n} de produse | category page product count |
| 55 | `commerce.shopEmptyInStock` | No products currently in stock. | Nu există produse în stoc momentan. | shop, in-stock filter, none |
| 56 | `commerce.shopEmpty` | No products available yet. | Nu există încă produse disponibile. | shop, no products |
| 57 | `commerce.shopAllProducts` | All Products | Toate produsele | shop filter link (commerce) |
| 58 | `commerce.searchBreadcrumb` | Search | Căutare | search page breadcrumb |
| 59 | `commerce.searchResultCount` | one: {n} result<br>other: {n} results | one: {n} rezultat<br>few: {n} rezultate<br>other: {n} de rezultate | search page result count |
| 60 | `commerce.searchEnterTerm` | Enter a search term to find products. | Introdu un termen de căutare ca să găsești produse. | search page without a term |

## 6. Abstractions introduced (one line each)

- `PluralTextsSchema` / `CountText` / `ResolvedPart` / `CompletePart` — users: the five count keys, resolver, packs, Labels
  `CountF`, PUT validation (`PLURAL_CATEGORIES`); axis: languages with different plural categories (Romanian exists;
  "whatever other language may arrive", ruled § 16.2 items 3, 6) — data per language, selection by `Intl.PluralRules`
  (variants fixed by CLDR → a closed record); rejected: `…One`/`…Few`/`…Other` flat keys (every new language would need
  new schema keys, packet rule 3) and a hand-written `n === 1` rule.
- `selectPluralText`, `pluralCategoriesOf`, `PLURAL_CATEGORIES` — users: SitePage (4 counts), InterestWidget, Labels,
  backend, shared and renderer tests, the coverage rule; axis: none (one rule); rejected: `Intl.PluralRules` inline at
  every site.
- `CountText.english` (iteration 1, R3) — users: `selectPluralText`; reason: the last fallback is English, by English
  rules, per count — so a language's available forms are never discarded because another one is missing (French: 0 →
  `one` would give "0 product" with French rules, unit-proven); rejected: replacing all forms by English when `other` is
  missing (the iteration-0 defect).
- `FacetLabels` (required 4th parameter) — users: SitePage (2 calls), glamPreview, shared/admin tests; axis: the tenant's
  language; rejected: a Romanian default inside `facets.ts` (§ 6.3).
- `RO_FACET_LABELS` (test constant) — in `packages/shared/test/cat-import-profile-1b-golden.ts` (the one module the tests
  AND the capture-tool copies import) and once in each of the two admin test files (no new admin file is allocated, D5).
- SitePage helpers `searchBarLabels` (4 callers), `facetLabelsOf` (2), `interestToggleStrings` (2), `interestListStrings`
  (1; a 25-key pick kept beside the others) — axis: none; rejected: inline object literals at each JSX site.
- `SearchBarLabels`, `InterestToggleStrings`, `InterestListStrings`, `InterestWidgetStrings` (Pick types) — the § 5.3 rule
  "each client component gets only its keys".
- Labels `LabelsSection` / `SECTION_HOME`, `countInputs`, `setCountText` — users: the page and `Labels.test.ts` (test seam:
  the admin unit config has no DOM); axis: none — a section that edits a home it does not name ("Product pages & search"
  → `commerceStrings`) needs the map; rejected: a fifth draft home for the same stored attribute.
- `proof.mjs` `resolveFlight` / `splitTextRows` / `firstDifference` (iteration 1), `Generated` / `canon` / `rawObject`
  (iteration 2) — users: `checkExpected` (rows `loc1-diff-1b`, `loc1-flight-controls`); axis: none — one canonical form
  of a payload, ruled LOCALE1B-ROW-CUT = A; `Generated` exists because generated nodes must not share the representation
  of raw data (second review R5); rejected: the 1a renumbering (cannot see past a moved row cut), a per-URL waiver
  (review-0 R1), and plain marker objects (`{ "$ref" … }`, impersonable).
- `proof.mjs` category-2 `beforeValue`, `renderItem`, `PRE_1B_COUNT_TEXT` — users: rows `loc1-diff-1b`, `loc1-text-*`,
  `loc1-ro-*`; rejected: per-row inline renders.

## 7. Deviations from the design, with the reason

- **D1** A count key is ONE key holding its plural forms (`facetsCount`, `productCount`, `searchResultCount`,
  `reviewsSummary`, `interestWidgetLabel`), not the `…One`/`…Other` pairs of § 6.2/§ 6.3: § 16.2 item 6 ("a count key holds
  one text per category of its language") supersedes § 2.2 rule 3. So the 40 catalog rows of § 6.3 are 39 keys, and the
  25 shared keys of § 6.2 are 21 shipped keys + the three `…One/…Other` merges + `showcaseEmpty` (D2). Stored shape: an
  object `{ one?, few?, other?, … }` (packet rule 3; `PUT /settings` accepts it). The widget label's placeholder is `{n}`
  (as every count key), not § 6.3's `{count}`.
- **D2** `showcaseEmpty` (and the showcase `outOfStock` read) are NOT shipped: § 6.2 allocates the two
  `CategoryShowcaseRender.tsx` rows to `locale-1c`; a key without a reader would have no coverage check (1a D4).
- **D3** (iteration 0: the three widget keys were not shipped) — superseded by ruling LOCALE1B-WIDGET = A; shipped.
- **D4** Labels "Product pages & search" also holds the seven EXISTING commerce keys a catalog site renders
  (`description`, `searchButton`, `searchNoResults`, `searchSearching`, `viewAllResults`, `resultsFor`, `searchProducts`):
  § 2.1 note and "every key of § 6 has exactly one input" — so they moved out of the commerce cards.
- **D5** `RO_FACET_LABELS` is defined once in the shared test package and once in each of the two admin test files.
- **D6** Row `loc1-diff-1a` is replaced by `loc1-diff-1b`, and every `loc1-*` row reads `locale-1/1b/` (§ 8.5 rule 5). The
  `1a/` files stay unchanged as 1a's record; the coverage checker still validates `1a/coverage.json`, whose `rule` text
  names the checker's old file name (`locale-1a-coverage.test.ts`; renamed `locale-coverage.test.ts` by 1b, ruling item 4).
- **D7** Category 2 gained a "changed prop" form (`beforeValue` → `value`, both exact, both must occur): moving the
  SearchBar to the resolver (packet rule 7) changes the VALUE of its existing `labels` prop; the complete EN pack adds 21
  keys to the commerce views' `strings` (F-LOCALE1B-CART-PAYLOAD); the widget texts are added to Navbar's existing
  `interest` prop. Visible text unchanged where the ledger says so.
- **D8** `SearchBar`'s `placeholder` and `labels` are now required and its English literal fallbacks are removed: the F
  rule (`override || language default`) is applied by its one caller module (`SitePage.tsx`).
- **D9** `Colecția` / `interestExcludedIntro` keep the § 6.3 values without a placeholder; the component renders
  `{text} {collection}` / `{text} {titles}.` — the same visible text as before (client-only).
- **D10** (iteration 1) The `1a` controls row `loc1-renumber-controls` became `loc1-flight-controls` (its 1a controls kept,
  run against the new comparison) and `renumberRows` was removed — ruling item 2: "renumbering is subsumed".

## 8. Findings

- **F-LOCALE1B-CART-PAYLOAD** (EXECUTED): `COMMERCE_STRINGS_DEFAULTS` is bound to the complete EN pack, so the commerce
  views' `strings` prop (`getCommerceStrings`, cart/checkout/account) now carries the 21 shared keys (cm1-commerce `/cart`,
  `/checkout`). Payload only; their texts are unchanged; no commerce file touched. Disappears with `getCommerceStrings`
  in `locale-1d`.
- **F-LOCALE1B-COVERAGE-FILENAME** — closed in iteration 1 (ruling item 4): the checker is `locale-coverage.test.ts`.
- **F-LOCALE1B-TEXT-ROW-GLUE** (EXECUTED, iteration 1): a React Flight text row is length-prefixed and the next row follows
  it on the same line; the CM1-A1 canonical rows (split at line ends) therefore glue such rows together. The 1a
  renumbering never saw the glued rows' labels. `resolveFlight` cuts text rows at their length (`splitTextRows`). The
  strict `cm1-identity-*` rows are not affected (they compare canonical strings).
- **F-LOCALE1B-ADMIN-ROMANIAN** (OBSERVED, not changed): the glam import preview's own admin texts are Romanian
  (`FIDELITY_NOTICE`, "Adresa categoriei … este ocupată") — pre-existing, outside this slice.
- The `F-CATALOG-RSC-ORDER` follow-up of 1a stays open (not this slice's). `resolveFlight` makes the locale rows
  insensitive to it, as the 1a renumbering did.

## 9. Iteration 1 — review-0 findings and the operator rulings: the class of each defect and the rule that closes it

| Finding | Class of defect | Rule now in the tree |
|---|---|---|
| R1 the byte gate discarded the whole payload diagnostic on six URLs (a `productId` mutation passed) | a waiver that accepts a diagnostic class wider than the cause it was meant for | no waiver field may exist (`loc1-diff-1b` asserts it); the payload is compared as resolved trees, which ignore row labels and row cuts ONLY; the reviewer's mutation is a bound control in `loc1-flight-controls` and is reported |
| R2 the widget texts and plurals were not implemented (allocation gap) | an allocation that omits the files a required text flows through | ruling LOCALE1B-WIDGET = A applied: layout → Navbar → `InterestWidget` `strings`; schema, packs, Labels inputs, coverage (incl. each plural category), client and server tests, table and ledger rows |
| R3 a count key without `other` lost every form it had | a fallback applied to the whole value instead of to the selected form | `CountText` keeps every form (pack, then tenant, per form) plus the English forms; `selectPluralText` falls back per count: form → language `other` → English by English rules → English `other`; the Polish test now pins kept partial forms |
| coverage checker name | a name that no longer matches the behaviour | renamed `locale-coverage.test.ts` |

**Iteration 2 — the second review-0 (R4, R5, the lazy boundary) and packet § 7.**

| Finding | Class of defect | Rule now in the tree |
|---|---|---|
| R4 payload data omitted: content outside a path into a row, a disconnected cycle, an absent vs `null` row 0 | a comparison that decides what to compare by reachability from row 0 instead of accounting for every row | every parsed row is compared once: a row whose full content some reference places (no path) is compared there; every other row is compared as an entry of its own; every row is resolved, so a cycle anywhere fails closed; an absent row 0 is a generated `#absent-root` node, not `null` |
| R5 comparator markers collide with raw data; an own `__proto__` key was lost | generated representations sharing the representation of input data; copying into `{}` | nodes the comparison makes are instances of a private class `Generated`, printed by `canon` as `#<tag>(…)` (no raw JSON value starts with `#`); raw objects are copied into null-prototype objects with `defineProperty`, in `resolveValue` and `stripProp`, so every own key survives |
| lazy boundary (I-ROWCUT-LAZY) wider than ruled | an equivalence wider than its evidence | packet § 7 item 2 applied: `$L<id>` compares equal to inline content ONLY when the target row is an element tuple `["$", …]` (the encoder's `deferTask` → `serializeLazyID` element outline); any other `$L` target stays a typed lazy reference, so `$L1` ≠ `$1` |

**The resolved-tree comparison** (`locale-1/proof.mjs` `resolveFlight`; ruling LOCALE1B-ROW-CUT = A, packet § 7): every row
is parsed by its kind (model JSON, text cut at its byte length, error/stream rows literal); every plain reference, and a
lazy reference to an element tuple, is resolved into its place, on both sides; the canonical form is row 0's tree, every
row not fully placed by a reference (sorted) and the hint lines. Object keys are data and all of them are kept; typed
references stay typed generated nodes with their target compared; an unknown `$`-form or row kind, a reference cycle
anywhere, a missing path or a truncated text row throws (fail closed); a reference to a missing row resolves to a
generated node no raw content equals. Stated limit: after resolution a row that is SHARED (referenced twice) and two equal
copies look the same. No feature beyond the six catalog list pages and these controls was added (§ 7 item 3).

Controls (`loc1-flight-controls`, each EXECUTED in every serving run):
- Positive (compare equal): the 1a renaming control; the same tree cut into rows at other points (inline, an element
  outlined as `$L`, a plain outline, a glued text row); an element outlined as `$L` vs the same element inline.
- Reported as failures: a rewired reference; a changed value; a changed value in a deep row; a dropped row; an added
  unreferenced row; two rows' contents swapped; one changed HTML byte; the three 1a R5 counterexamples; three
  typed-reference changes (element → error, Map → array, promise → value); the second review's controls as it states
  them — content outside a referenced path (`0:{"x":"$1:a"}`, row 1 `b` changed), a dropped `0:null` root, a Map vs an
  ordinary object `{"$ref":"Q","to":…}`, raw objects impersonating the error-row and missing-reference markers, an own
  `__proto__` key; `$L1` vs `$1` with row `1:{"x":1}`; and the reviewer's real-payload mutation (one toggle's
  `productId` → `WRONG-PRODUCT` inside `catalog /shop`: one problem, "flight payload differs … WRONG-PRODUCT").
- Fail closed (throw): an unknown `$`-form, an unknown row kind, a truncated text row, a disconnected cycle
  (`1:"$2"` / `2:"$1"` beside `0:{"ok":true}`).

Evidence for the element-only rule on the real payloads (EXECUTED, iteration 2): with the narrower rule, `loc1-diff-1b`
is exact on all 74 URLs — the six catalog list pages included — so every measured row cut is an element outline.
Encoder source (iteration 1, EXECUTED read; next 16.4.3,
`node_modules/next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`):
`if (3200 < serializedSize) return deferTask(request, task)` (l. 1701, 1719); `deferTask` returns
`serializeLazyID(task.id)` = `"$L" + id` (l. 1259-1269, 1510).

## 10. Operator's staging checklist (Layer 2) and the human's pre-deploy step

Deploy order (§ 4.5): backend → admin → renderer. Rollback: renderer first.

1. Backend + admin to staging. `PUT /settings` with `catalogStrings: { facetsCount: { one: "x", few: "y", other: "z" } }`
   → 200; with `{ facetsCount: { plural: "x" } }` → 400. In admin on `cm1-catalog`: Labels shows "Catalog" (incl. the three
   header widget inputs) and "Product pages & search"; a count key has inputs `one` / `other` (English tenant).
2. Renderer to staging. Layer 2 extraction (`locale-1/proof.mjs` `extractVisibleText`) against a capture taken before the
   renderer deploy: **`cm1-catalog` 19 URLs — exactly L-EN-CAT** (the items of `1b/text-expected.json` for the `catalog`
   subject, the header widget's "My list" items included); **`cm1-commerce` 18 and `cm1-content` 14 URLs —
   text-identical**.
3. RO evidence on staging needs a RO staging tenant (none exists): create a copy of `cm1-catalog` with `locale: "ro-RO"`
   and compare with `1b/ro-expected.json` (`roCatalog`, against the pre-deploy capture), or record Layer 2 as EN-only.
4. **Human, prod, before the `locale-1b` renderer deploy (§ 16.3):** set the glam catalog tenant's Site language to
   Romanian (`locale` = `ro-RO`) in Settings if it is not — else its catalog texts turn English (§ 8.4). Approve or amend
   the table of § 5.

## 11. Operator approval of the Romanian text table (2026-11-01)

Authority: the human's overnight delegation of 2026-10-31 ("use your best judgement on the Romanian text table -
implement what you recommend"). The § 5 table is approved with two amendments, applied after review approval in
`packages/shared/src/language-packs/ro.ts`, `renderer/test/unit/locale-1b-server-render.test.ts` and
`renderer/test/serving-contract/locale-1/1b/ro-expected.json`; the gates were re-run on the amended tree. The § 5
rows stay as the builder's proposal; this section wins.

| # | Key | Proposed | Approved | Reason |
|---|---|---|---|---|
| 46 | `commerce.volumePricing` | Prețuri de volum | Prețuri pentru cantități mari | "de volum" is a calque; the approved form is the usual shop wording |
| 60 | `commerce.searchEnterTerm` | Introdu un termen de căutare ca să găsești produse. | Introdu un termen de căutare pentru a găsi produse. | same register as the `1a` amendment (`restrictedLoginRequired`) |

Kept as proposed on purpose: the 39 catalog texts are today's live literals (L-RO-CAT); their mixed register (formal
"Alegeți", "Vedeți" next to informal "Elimină", "Șterge") is today's text and is not changed in this slice. A tenant
admin can override any value on the Labels page; a pack value changes in `ro.ts` alone.

## 12. Operator closeout (2026-11-01)

- **Relay.** Builder claude-opus-5-5, reviewer gpt-6.1-sol. Review-0 escalated LOCALE1B-WIDGET and LOCALE1B-ROW-CUT;
  the operator ruled A for both under the human's delegation (packet § 6: the widget's two source files allocated —
  the gap was the packet's; outlined RSC rows resolved into their referencing place, no URL excluded, the reviewer's
  `productId` mutation bound as a failing control). A Claude usage-limit stop interrupted one relaunch (no work lost).
  The next review found comparator holes (unreached rows, disconnected cycles, null root, marker collisions,
  `__proto__`, `$L` erased); the operator ruled packet § 7 (fix as stated; `$L` equals inline content only for element
  tuples) with a strain bound (last comparator cycle). Approved on the following cycle.
- **Gates.** The ten common gates and the packet's extra checks passed on the accepted candidate and again on the tree
  with the § 11 amendments (`ALL GATES GREEN` both times).
- **Staging (Layer 2).** `cdk diff`: Lambda code and nested-stack template URLs only (41 functions, 3 nested stacks).
  Two captures before the deploy of the 51 CM1 URLs were equal (home pages now fetched without the trailing slash).
  After the deploy: `cm1-content` (14) and `cm1-commerce` (18) equal in status, content type and visible text;
  `cm1-catalog` 11 of 19 pages changed, no structural change, and every text change is an L-EN-CAT pair:
  "Mă interesează" → "I'm interested" (46×), "Lista mea" → "My list" (22×), aria-label "Lista mea: 0 produse" →
  "My list: 0 products" (22×), "Filtre" → "Filters" (4× text, 2× aria-label), "Producător" → "Brand" (2×),
  "20 produse" → "20 products" (2×). After the § 11 amendments the tree was deployed again: equal to the first
  deploy on all 51 URLs.
- **Not proven on staging.** Romanian rendering (no Romanian staging tenant); proven by the serving fixture
  `loc1-ro-catalog` and the RO rows.
- **Human, before the prod renderer deploy (§ 16.3):** set the glam catalog tenant's Site language to Romanian
  (`locale` = `ro-RO`) if it is not; otherwise its catalog texts turn English.
