# REFACTOR-SITEPAGE-1 — `renderer/src/components/SitePage.tsx` into files by responsibility (moves only)

- **Status:** IMPLEMENTED 2026-11-27 — built, operator gates pending (staging deploy; the three test sites rendered
  against the real tables)
- **Track:** maintenance (order of work from 2026-11-27, `docs/ROADMAP.md`: the third of the pure-move refactor slices,
  after `refactor-shared-1` and `refactor-settings-1`, before Track B)
- **Depends:** none
- **Source plan:** none. Ratified by the human's order of work of 2026-11-27 ("add a slice for refactoring the … big
  files … before moving on to a consequential track like the private commerce table"). ROADMAP row
  `refactor-sitepage-1`. No ratification-class decision.
- **Maturity:** unchanged (a move changes no module's maturity).

## Purpose / risk retired

`renderer/src/components/SitePage.tsx` held 2,054 lines at the start of the slice (the ROADMAP row said 2,039): the
page entry `SitePage` (421 lines), the metadata builder, the locale-string selectors, the block-data preparation
(`prepareBlocks`) and every commerce view (product page, category, shop, search, confirmation, order tracking, facets,
cards, pagination). Nearly every serving slice edited it. After this slice each responsibility has its own file under
`renderer/src/components/site-page/`, and `SitePage.tsx` keeps the entry (479 lines). A visitor receives the same bytes.
The next track (`cmrc-1`, the private commerce table) changes the order views: it finds them in
`site-page/order-views.tsx` (213 lines).

Risk retired: a change to one view no longer means an edit in a 2,000-line file that holds every other view, so a
review sees only the view that changed. This serves the VISION rule "deployable slices, never broad rewrites": the
next commerce slices touch one small file each.

## Scope

1. The declarations of the untouched `SitePage.tsx` move, with their comments, byte for byte, into the nine files of
   § *File map*. Each file holds one or more CONTIGUOUS line ranges of the untouched file, in the original order.
2. The only new text: `import` statements, `export … from` re-exports, and the keyword `export` in front of a
   declaration that another file imports (26 keywords; list in `verify-moves.out`, § *Build record*).
3. `SitePage.tsx` keeps the header comment, `toSiteQuery`, `SitePage`, and re-exports `SiteQuery`, `SitePageInput`
   (from `site-page/input.ts`) and `buildSitePageMetadata` (from `site-page/metadata.ts`).
4. A one-time capture proof (ruling 7): a server-render test with 33 captures, captured on the untouched file and
   compared on the moved one, then removed from the repository by operator ruling RSP1-CAPTURE-SCOPE (§ *One-time
   capture proof (not kept in the repository)*).
5. Docs (ruling 9): `renderer/ARCHITECTURE.md` (file map, the rule, the moved symbols' pointers), the forward-looking
   line references in docs, ROADMAP row, `CURRENT_SLICE.md`.

## Non-scope

No rename, no reordering inside a declaration, no changed prop, text, class name, element, condition or data read, no
new abstraction, no new dependency. `SitePage` itself is not split (splitting a function is not a move). The existing
tests are not edited. A defect or a false name found on the way is in § *Findings, not fixed*. No edit under the
protected paths of ruling 10 (`backend/`, `infra/`, `packages/`, `admin/`, `tools/`, `renderer/middleware.ts`,
`renderer/src/lib/`, a `package.json`, a lockfile, `next.config.*`, `open-next.config.*`): `git status` shows none.

## Architectural boundaries

- **Serving contract.** The HARD CONSTRAINT of the `SitePage.tsx` header (nothing reachable calls a Next.js dynamic
  API) covers every new file: they are reachable from `SitePage.tsx`. No moved code reads a dynamic API (moves only;
  the serving suite's rows on cache headers pass).
- **Server and client (ruling 3).** `SitePage.tsx` had no directive; every new file has none (§ *Boundary table*). No
  component changed side: the 14 client components (`"use client"`) the old file imported stay in `components/` and
  are imported by the new server files.
- **Module graph (ruling 2).** A DAG: `SitePage.tsx` → `site-page/*`; inside `site-page/` one direction only; no new
  file imports `SitePage.tsx` (§ *Import graph*).
- **Public surface (ruling 4).** Every name the old module exported is still exported from `SitePage.tsx` under the
  same name (§ *Importers*).
- Tenant isolation, the no-scan rule and the dependency rule are not touched: no read, key or query changes (moves only).

## File map (ruling 1)

The map was fixed in the generator (`split.mjs`, `GROUPS`) before the first move ran and was not changed after it.
Directory: `renderer/src/components/site-page/`, next to `SitePage.tsx` (one line: the packet's example name; the
files are not route segments, so a plain directory under `components/` and not under `app/`). Import paths use the
`@/components/site-page/<file>` alias, the convention of the old file.

| File | Lines (after) | Holds (untouched `SitePage.tsx` lines) |
|---|---:|---|
| `SitePage.tsx` | 479 | header comment 1–18; `toSiteQuery` 77–82; `SitePage` 357–777; the re-exports |
| `site-page/input.ts` | 26 | 50–75: `SiteQuery`, `SitePageInput` (the per-request DTO) |
| `site-page/locale-strings.ts` | 137 | 84–210: `withFallback`, `pick`, `cartPageStrings`, `checkoutPageStrings`, `accountPageStrings`, `addToCartStrings`, `formatLocaleProp`, `interpolateNodes`, `searchBarLabels`, `facetLabelsOf`, `interestToggleStrings`, `quoteRequestStrings`, `interestListStrings` |
| `site-page/addresses.ts` | 44 | 212–253: `CommerceMatch`, `matchCommercePrefix`, `interestPrefix`, `normalizePageAddressOrKeepRaw` |
| `site-page/metadata.ts` | 107 | 255–355: `buildSitePageMetadata` |
| `site-page/prepare-blocks.ts` | 241 | 779–1014: `withCommaPriceRange`, `SHOWCASE_CARD_READ_LIMIT`, `SHORT_TEXT_MAX`, `cardShortText`, `withShowcaseCardData`, `formForBlock`, `prepareBlocks` |
| `site-page/commerce-parts.tsx` | 101 | 1016–1109: the `--- COMMERCE PAGE COMPONENTS ---` marker, `isEditorial`, `cardCategoriesOf`, `cardThemeProps`, `ProductCard`, `Pagination` |
| `site-page/product-page.tsx` | 462 | 1111–1559: `CatalogVariantPresenter`, `firstOptionGroup`, `interestToggleProps`, `pinnedGalleryTop`, `catalogGalleryProps`, `ProductAttributes`, `ProductPageView` |
| `site-page/listing-views.tsx` | 295 | 1561–1846: the CAT-FACETS-1 comment, `CatalogFacets`, `FacetValueRow`, `FacetPanel`, `FacetedListing`, `CategoryPageView`, `ShopPageView`, `SearchPageView` |
| `site-page/order-views.tsx` | 213 | 1848–2054: `ConfirmationPageView`, `ORDER_STEP_KEYS`, `ORDER_HISTORY_KEYS`, `OrderTrackingView` |

Line counts: `wc -l`, EXECUTED on the final tree. Every file is under 500 lines. The largest, `product-page.tsx`, is
the product page view (304 lines) and its six helpers, which only it uses.

New files have no header comment: the packet permits only import and export text (§ *Deviations*). This table and the
tree in `renderer/ARCHITECTURE.md` describe each file.

**Abstractions introduced.** None: no interface, port, registry or type. The nine files are mandated by ruling 1.
- `site-page/commerce-parts.tsx` (a grouping choice): users `SitePage.tsx` (`isEditorial`, `cardCategoriesOf`),
  `listing-views.tsx` (all but `cardCategoriesOf`), `product-page.tsx` (`isEditorial`); axis: none (one contiguous
  block of the old file, the start of its "COMMERCE PAGE COMPONENTS" section); rejected: `isEditorial` in
  `listing-views.tsx` (the product page would then import the listing file for one function) and a four-line file for
  `isEditorial` alone (a file per function).

## Import graph (ruling 2)

| File | Imports (files of this graph) |
|---|---|
| `SitePage.tsx` | `input`, `locale-strings`, `addresses`, `prepare-blocks`, `commerce-parts`, `order-views`, `listing-views`, `product-page`, `metadata` (the last by `export … from`) |
| `metadata.ts` | `input` (type only), `addresses` |
| `product-page.tsx` | `locale-strings`, `commerce-parts` |
| `listing-views.tsx` | `locale-strings`, `commerce-parts` |
| `commerce-parts.tsx` | `locale-strings` |
| `order-views.tsx` | `locale-strings` |
| `input.ts`, `locale-strings.ts`, `addresses.ts`, `prepare-blocks.ts` | none |

Proof (EXECUTED): `graph.mjs` reads every import and `export … from` statement and every dynamic `import()` of the ten
files with the TypeScript parser (no new dependency), resolves `@/` and relative paths, and searches the graph depth
first: **0 cycles; no new file imports `SitePage.tsx`; DAG: PASS**. Negative control: `--inject-cycle` (an edge
`input.ts` → `SitePage.tsx` in memory) → 1 cycle reported, exit 1.

## Boundary table (ruling 3)

Before the move (`SitePage.orig.tsx`, AST, EXECUTED): no `"use client"` / `"use server"` directive. Client components
it imported (each file's first line is `"use client"`, OBSERVED): `RenderBlocks`, `CommentsSection`, `ThemeInjector`,
`SocialShare`, `CartPageView`, `CheckoutPageView`, `AddToCartButton`, `FBPurchaseEvent`, `ProductImageGallery`,
`AccountPageView`, `SearchBar`, `CelebrationWrapper`, `InterestShortlist` (`InterestToggle`, `InterestListPage`),
`QuoteRequest`. Server-only modules it imported: `@/lib/dynamo`, `@/lib/review-images`, `@/lib/not-found-handoff`,
`@/lib/site-segment`, `@/lib/sanitize`, `next-auth/jwt`, `sanitize-html`.

| File | Directive | Client components it imports (value) | Server-only code it imports | Importers (all, AST walk of 189 files under `renderer/`) |
|---|---|---|---|---|
| `SitePage.tsx` | none | `RenderBlocks`, `CommentsSection`, `ThemeInjector`, `SocialShare`, `CartPageView`, `CheckoutPageView`, `AccountPageView`, `InterestListPage` | `dynamo`, `not-found-handoff`, `site-segment`, `next-auth/jwt` | § *Importers* |
| `input.ts` | none | — | — | `SitePage.tsx`, `metadata.ts` |
| `locale-strings.ts` | none | — (types only, `import type`, erased) | — | `SitePage.tsx`, `commerce-parts.tsx`, `listing-views.tsx`, `order-views.tsx`, `product-page.tsx` |
| `addresses.ts` | none | — | — | `SitePage.tsx`, `metadata.ts` |
| `metadata.ts` | none | — | `dynamo` | `SitePage.tsx` |
| `prepare-blocks.ts` | none | — | `dynamo`, `review-images`, `sanitize-html` | `SitePage.tsx` |
| `commerce-parts.tsx` | none | `InterestToggle` | `dynamo` | `SitePage.tsx`, `listing-views.tsx`, `product-page.tsx` |
| `product-page.tsx` | none | `AddToCartButton`, `ProductImageGallery`, `SearchBar`, `InterestToggle`, `QuoteRequest` | `review-images`, `sanitize` | `SitePage.tsx` |
| `listing-views.tsx` | none | `RenderBlocks`, `SearchBar` | — | `SitePage.tsx` |
| `order-views.tsx` | none | `FBPurchaseEvent`, `CelebrationWrapper` | — | `SitePage.tsx` |

No client component imports a new file (importer column). The type-only imports of `locale-strings.ts` from the client
component files use `import type` (always erased, so no runtime edge to a client module from that file).

## Importers (ruling 4)

Basis: `sitepage-importers.mjs` — every import, `export … from`, dynamic `import()`, `require()` and `vi.mock()` with
a specifier ending in `SitePage` in the repository (AST walk of 944 `.ts/.tsx/.mts/.mjs/.cjs/.js` files; `node_modules`,
build output, `.git`, `.agent-manager` excluded), EXECUTED; cross-checked by `grep -rnE "['\"][^'\"]*/SitePage(\.tsx?|\.js)?['\"]"`
over the same tree (the same 21 files). Re-run in iteration 1 after the one-time capture test was removed: 943 files,
21 references (`sitepage-importers-i1.out`; equal to the build-time list without that test):

| File | Names |
|---|---|
| `renderer/src/app/[siteId]/[[...slug]]/page.tsx` | `SitePage`, `buildSitePageMetadata` |
| `renderer/src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx` | `SitePage`, `buildSitePageMetadata`, `toSiteQuery` |
| `renderer/test/unit/catalog-product-status.test.ts`, `hydration-1-server.test.ts`, `locale-1b-server-render.test.ts`, `locale-1d-server-render.test.ts` | `SitePage`, `buildSitePageMetadata` |
| `renderer/test/unit/lang-1c-membership.test.ts` | `buildSitePageMetadata` |
| `renderer/test/unit/cat-variant-gallery-1-header-clearance.test.ts`, `cat-variant-gallery-1-server-render.test.ts`, `category-content-1.test.ts`, `cdl-2-site-page.test.ts`, `cmrc-counties-1-site-page.test.ts`, `gallery-1-site-page.test.ts`, `landing-1.test.ts`, `locale-1a-server-render.test.ts`, `price-locale-1-server-render.test.ts`, `price-locale-1-showcase.test.ts`, `shop-look-1c-grid.test.ts`, `shop-look-1d-showcase.test.ts`, `shop-look-1e-form.test.ts`, `site-page-reviews.test.ts` | `SitePage` |

`SitePage.tsx` still exports all five old names: `SiteQuery`, `SitePageInput` (re-exported types), `toSiteQuery`,
`buildSitePageMetadata` (re-exported), `SitePage`. No existing test file is edited.

**Source-text readers (ruling 4 stop condition).** Searched every `readFileSync` / `readFile(` under `renderer/test`
and `renderer/src`, and `SitePage.tsx` as a string (EXECUTED): no test reads the source text of `SitePage.tsx`. The
tests that scan sources (`newsletter-1-boundaries` — no file names the newsletter key prefix; `sched-1g-proxy` — no
source imports `zod`; `sched-1g-pure` — the `%5Fbook` tree only; `locale-1e-html-lang` — `layout.tsx`, `not-found.tsx`;
`locale-coverage` — test files) do not depend on where these declarations live, and pass. The stop condition did not
apply.

## Module-level statements (ruling 8)

`module-level.mjs` (TypeScript AST, EXECUTED) lists every top-level statement that is not an import, an export-from,
a function or a type declaration. In the untouched file: four `const`s, each a literal (no call, `new` or tagged
template in the initializer): `SHOWCASE_CARD_READ_LIMIT` (= 12) and `SHORT_TEXT_MAX` (= 400) → `prepare-blocks.ts`,
above their only users; `ORDER_STEP_KEYS` and `ORDER_HISTORY_KEYS` (object literals, `as const satisfies` / annotated)
→ `order-views.tsx`, above their only user. No statement runs code at import, before or after the move.

What did change at import: the ORDER in which some imported modules are first evaluated. `SitePage.tsx` keeps its
remaining original imports in their original order and imports the `site-page/` files after them, so the modules that
only the moved code uses (`review-images`, `AddToCartButton`, `FBPurchaseEvent`, `ProductImageGallery`, `SearchBar`,
`sanitize`, `sanitize-html`, `CelebrationWrapper`, `QuoteRequest`, and `react`'s named exports) are reached later in
the walk. None of the moved code depends on that order (no module-level code). The bytes the visitor receives did not
move (proof 1).

## Proofs

1. **Served bytes (ruling 5).** `npm run test:serving` (176 checks) and `npm run test:serving-bundle` (61 checks) on
   the untouched tree, then on the moved tree: all pass both times; no capture file changed (`git status` shows no
   change under `renderer/test/serving-contract/` or `renderer/test/serving-bundle/`); nothing was re-captured. No row
   moved, so no stylesheet link or script chunk moved.
2. **Unit suite (ruling 6).** `cd renderer && npm test` on the untouched tree: 66 files, 964 tests passed. After the
   move and the removal of the one-time capture test (iteration 1): 66 files, 964 tests passed — the same tests; none
   edited, none skipped, none added. (During the build the suite held the capture test too: 67 files, 997 tests.)
3. **One-time capture proof (ruling 7)** — § *One-time capture proof (not kept in the repository)*.
4. **Moves only.** `verify-moves.mjs` (independent of the generator; reads only the files on disk and the untouched
   copy): each `site-page/` body, without its imports and the added `export` keywords, is ONE byte-exact substring of
   the untouched file; `SitePage.tsx` without imports and re-exports is a subsequence of it; the multiset of non-blank
   lines of all ten files minus the added text equals the untouched file's non-blank non-import lines.
   **MOVES ONLY: PASS.** Negative control: one added space in a class name of `product-page.tsx` → 3 failures.
5. **Graph (ruling 2), boundary (3), importers (4), module-level (8)** — the sections above.

## Coverage (ruling 7)

Which test renders each view, by reading the tests (OBSERVED in the test code; not by instrumentation). The last
column names the states of the one-time capture proof (removed; record in the next section).

| View | Rendered and FULL bytes compared by (standing tests) | Rendered with assertions only (standing tests) | One-time capture proof (state) |
|---|---|---|---|
| Product page, commerce | serving `cm1-identity-commerce` (`/product/sale-rug`, `variant-rug`, `sold-out-rug`, `rug-care-guide`; CM1-A1 canonical form) | `locale-1b`, `price-locale-1`, `cat-variant-gallery-1`, `site-page-reviews`, `catalog-product-status` | `product-commerce`, `product-commerce-ro`, `product-digital` |
| Product page, catalog (variants, attributes, quote, pinned gallery) | none (catalog tenant: `cm1-control` requires a difference) | `cm1-catalog-product`, `cat-variant-gallery-1-*`, `quote-request`, `locale-1b` | `product-catalog-quote`, `product-catalog-plain` |
| Category | `cm1-identity-*` (`/category/rugs`, `/category/mats`) | `locale-1a` (page 2 of 3), `category-content-1`, `cc1-*` | `category-commerce-page2`, `category-commerce-empty`, `category-catalog-facets` |
| Shop | `cm1-identity-*` (`/shop`, `/shop?availability=in_stock`) | `cf1-*`, `locale-1b` | `shop-commerce-instock`, `shop-commerce-empty`, `shop-catalog-all`, `shop-catalog-nomatch`, `shop-catalog-toolong` |
| Search | `cm1-identity-*` (`/search?q=rug`) | `locale-1a`, `locale-1b` | `search-results`, `search-catalog-none`, `search-no-query` |
| Facets (panel, chips, zero, too-long, empty result, notice) | none | `cf1-*`, `locale-1b` | the three `shop-catalog-*` states, `category-catalog-facets` |
| Pagination (links on both sides) | none known (INFERRED: the `cm1` request list has no `?page=`) | `locale-1a` (page 2 of 3), `cc1-category-content` | `category-commerce-page2`, `search-results` |
| Confirmation | serving `locale-1` proof (bank, COD; the expected-difference lists) | `locale-1d` | `confirm-none`, `confirm-bank`, `confirm-cod-ro` |
| Order tracking | serving `locale-1` proof; `locale-1d-server-render` (history, EN bytes) | — | `track-none`, `track-full`, `track-ro` |
| Cart, checkout, account (props) | `cm1-identity-*` (`/cart`, `/checkout`) | `locale-1d`, `cmrc-counties-1` | `cart`, `checkout-ro`, `account-ro` |
| Interest list page | none | `locale-1b`, `cdl-2` | `interest-list` |
| Content page; `prepareBlocks` for the block kinds `postGrid`, `categoryShowcase`, `categoryGrid`, `form`, `newsletter`, `gallery`, `reviewsCarousel`; restricted page; JSON-LD types `Article`, `Organization`, `SoftwareApplication` | `cm1-identity-*` (`/`, `/about`, `/stale-showcase`) | `site-page-reviews`, `shop-look-1c/1d/1e`, `gallery-1`, `landing-1`, `hydration-1`, `price-locale-1-showcase` | `content-blocks`, `content-showcase-ro`, `content-showcase-catalog`, `content-restricted`, `content-home-draft`, `content-software-ro` |
| Metadata (`buildSitePageMetadata`) | `cm1-identity-*` (the `<head>` of each captured page) | `lang-1c-membership`, `locale-1b`, `locale-1d`, `catalog-product-status` | `metadata.json` (the 16 cases listed in the next section; no account route) |

Every listed view is rendered by at least one standing test (the reviewer confirmed it independently in review-0 for
pagination, the catalog facets and the interest list). So ruling 7's condition ("a view that NO existing test renders")
is met by no view, and the standing oracles are the two serving suites and the unit suite. The capture test of the
next section was a one-time proof of this move, not a standing test.

## One-time capture proof (not kept in the repository)

Operator ruling RSP1-CAPTURE-SCOPE (2026-11-27, after review-0): the test and its captures are removed from the
repository and kept here as a recorded one-time proof. Removed in iteration 1 with `rm` (both untracked):
`renderer/test/unit/refactor-sitepage-1-server-render.test.ts` (340 lines) and `renderer/test/unit/refactor-sitepage-1-before/`
(33 files).

**What it rendered.** The real `SitePage` (32 states) and the real `buildSitePageMetadata` (one capture of 16 cases),
with the DynamoDB reads mocked. States (route, query; tenant kind):
- product: `product-commerce` (`/product/rug`; commerce, search bar; sale price, volume pricing, categories by id and
  slug with a parent, description HTML, long description, ingredients, nutritional values, tags, two reviews, one
  approved photo), `product-commerce-ro` (the same, `ro-RO`, comma price), `product-digital` (`/product/guide`;
  `paymentLinkId`, pre-order, a category id that matches no category), `product-catalog-quote` (`/product/oak`;
  catalog, editorial shape, top bar, navbar heights, contact channels, option group with pictures, repeated attribute
  keys), `product-catalog-plain` (`/product/oak`; catalog, no options, no attributes, no image);
- category: `category-commerce-page2` (`/category/rugs`, `page=2` of 3; card category line, landscape cards, editorial,
  category blocks with a `newsletter`), `category-commerce-empty` (`/category/rugs`; no products),
  `category-catalog-facets` (`/category/floors`, `f=producator=ITC`; catalog);
- shop: `shop-commerce-instock` (`/shop`, `availability=in_stock`), `shop-commerce-empty` (`/shop`,
  `availability=in_stock`, no products), `shop-catalog-all` (`/shop`, an `availability` query that a catalog ignores),
  `shop-catalog-nomatch` (`/shop`, `f=producator=NONE`), `shop-catalog-toolong` (`/shop`, a 7,000-character `f`);
- search: `search-results` (`/search`, `q=" rug "`, `page=2` of 3), `search-catalog-none` (`/search`, `q=zzz`;
  catalog), `search-no-query` (`/search`);
- orders: `confirm-none` (`/checkout/confirmation`), `confirm-bank` (`/checkout/confirmation?id&email`; bank transfer,
  celebration, discount, personalisations, address, phone), `confirm-cod-ro` (the same, cash on delivery, `ro-RO`,
  estimated delivery date, no SWIFT), `track-none` (`/checkout/o1`; no order), `track-full` (`/checkout/o1`; `en-GB`,
  status `shipped`, history with an unknown status and a note, tracking number), `track-ro` (`/checkout/o1`; `ro-RO`,
  `delivered`);
- client views: `cart` (`/cart`; delivery config), `checkout-ro` (`/checkout`; `ro-RO`, payment methods, bank
  transfer, countries, counties, no birthday), `account-ro` (`/account`; `ro-RO`, no birthday);
- `interest-list` (`/my-list`; catalog, own site width);
- content: `content-restricted` (`/members`; `Purchase` policy), `content-blocks` (`/about`; `Article`, theme override,
  `hideNav`, comments; blocks: two `postGrid`, two `categoryShowcase` (one with the three card options), `categoryGrid`
  with blank and non-string ids, two `form` (one blank slug), `newsletter`, `gallery` with and without attrs, three
  `reviewsCarousel` scopes, a paragraph), `content-showcase-ro` (`/despre`; `ro-RO`, comma prices with and without
  tiers, one price that does not parse), `content-showcase-catalog` (`/about`; catalog, own product prefix, a showcase
  whose lookup misses with stale prefetched products, `hideFooter`, `hideSharing`), `content-home-draft` (`/`,
  preview; `homePageSlug`, `Draft`, `Organization` with contact e-mail), `content-software-ro` (`/`; `ro-RO`,
  `SoftwareApplication`, an extra language).
- metadata cases: `product` (`/product/rug`, SEO title, 200-character description), `product-catalog-hidden`
  (catalog, status `draft`), `category` (`ro-RO`), `shop`, `search-q` (`q=rug`), `search` (no `q`), `cart`,
  `checkout`, `checkout/confirmation`, `checkout/o1` (the four `ro-RO`), `interest` (catalog, `/my-list`),
  `not-found-root` (no slug, no content), `redirect` (a redirect item), `content-alternates` (a translation set of two
  members, extra language `ro`), `content-one-language`, `content-root` (`homePageSlug`, upper-case domain). No
  account route and no other route kind.

**What it compared.** `renderToStaticMarkup` of each result: the server markup, and for each client component the
page mounts (each replaced by a probe) its props serialized with `JSON.stringify`, in key order. It did NOT compare
RSC payload bytes. `JSON.stringify` does not tell an absent property from one set to `undefined` (both are left
out), and it drops functions; so a move that added or removed an `undefined`-valued prop would not have shown there.
The serving suites (proof 1) compare the served HTML and RSC rows. TZ pinned to UTC. Markup captures were stored
JSON-encoded (one line each); `metadata.json` as indented JSON.

**Result (builder, EXECUTED).** Captured on the untouched `SitePage.tsx`; two compare runs 33/33 with the hashes
unchanged; negative control (one byte in the tracking capture) → 1 failure. On the moved tree: 33/33, 0 hash
mismatches. The first capture set (raw `.html`) was compared after each of the 9 move steps (`steps.log`); it was
replaced by the JSON-encoded set because two raw files held the trailing spaces of the LANDING-1 `<style>` and the
whitespace gate refused them; the JSON set was captured again on the restored untouched file (`split.mjs 0`; its
sha256 equals the saved copy), then the moved tree was regenerated (`split.mjs 9`; concatenated sha256 of the ten
files `a798ca57…`, equal to the tree the gates ran on).

**Reproduction (operator, quoted from ruling RSP1-CAPTURE-SCOPE).** "The operator reproduced it on 2026-11-27: the
test exits 0 (33 of 33) on the new `SitePage.tsx` AND on the `SitePage.tsx` of `HEAD` put in its place, with the 33
capture files not rewritten (one hash over all equal before and after)."

Capture hashes (sha256; the list is also in the slice trail, `captures.sha256`, sha256 of the list `55db1755…`):

```
dda3344f2cdbbf55b82ee3502f96077c9ac2d7ae30cd538b46d87ac2faccf0e7  account-ro.json
df38a0d657156724882ab97785943307e54059a95a23b41f831ec114d637a5a5  cart.json
d5c16b7e915c0cf2e1bb0eebfe4b06c31a64ec93b15aa674ac8837d1c64acb36  category-catalog-facets.json
64513223bc74096f6c0e51d252e8cd88634efc632bdde5826068f0a0f2a2f557  category-commerce-empty.json
ae76410c79a4ac910d9440898fbc72818c01d744db951cbe8b5acd1903638b92  category-commerce-page2.json
50d4d5f3ca9a0bea5a46406d1e4925cc174e23e5e505c1328eed2990e1aeb464  checkout-ro.json
a4df1ac539d62d49ae8921066c3523d8150bf5ab7d59370114dd025239677d76  confirm-bank.json
412db0ad2e6e75682456b4ab60aed76e2885db4835734ef4c10184f856c3ee4a  confirm-cod-ro.json
562c183a4b1db686b98ed4448161849c28bba1eb988514bf1bf8258bdaf601cb  confirm-none.json
123c106105fd0954841789b76e1cace6381abea20d4de254e5378246b00fe53e  content-blocks.json
ad61e43617d6fc166f6aa80f596ede0a91f09c7caabaf0fb04b1acbd5482d579  content-home-draft.json
f972fa11b2402d902b76b81a3a59a93e9b7f302a0202f637173cda887a50818e  content-restricted.json
a129f6e963e866c3ae59517783a52cb2539407f594853e593f77f3d171baca22  content-showcase-catalog.json
12ab4e7b1240c513654fa76944b9e25e56866de15d5363191a95857b00c110ba  content-showcase-ro.json
3f7edfc0caad599ec9226ef46d8dd8ebf669434859e7645aeffed3556b6acb7f  content-software-ro.json
10227c4d9e22f169618b7bc6bb18bbe9c10b81b7fdad4d2d7b6969c3c4117a6c  interest-list.json
6789183f13cc1f4a30a462e267bf4f7af7e971ac2cb1cd930108c17325373224  metadata.json
76b38260645be365647c447000ac283e3243b07b3d674c08e5cfdd0459572a31  product-catalog-plain.json
cc5d33aeaa8a412316de33980413deab846c560b7869e5be9709748bafbed564  product-catalog-quote.json
b8e94eeb9ff7e155d4a556ea63b5fcb6e418a14a0c03e4626bd7b18ca0490f5d  product-commerce-ro.json
c9430d4221c77cf98626fff653d56cb0027956790ea95620148d711631308516  product-commerce.json
689400a23cecc38b0b6e892d103a68f8033ed6752936a3cc871afdfd90b0c8be  product-digital.json
568c0b1b2b9967cf052bd8d8ed617dcdc84142e1a7128ef18e85c0d31e692299  search-catalog-none.json
a219f923707853308ca45ea64720de1c2814cde62cfe1aba5329a8d73debfbdf  search-no-query.json
d495010b609044a1b5616e6680206c382012f13d8000b2a9c8b29b3d7440564b  search-results.json
1e9dcf2f3d2cf57cd68e90b9173bb3d33293d2de6c3dc32173038646281ab1bd  shop-catalog-all.json
7640e1c18843a9c0f1e4cda6e89e9bdb1dae665144fccb08d7a87dd8ba940a36  shop-catalog-nomatch.json
0b984826ccd721b882c684b9025ee49e369b5a698ce36b4f4645eeb1fd35a9c7  shop-catalog-toolong.json
6ff62ab16cf3111f9245e9feaa33fc04254466663dc98e24d86573203a83724b  shop-commerce-empty.json
0d8ab8b667b31755bfd7316844074e516f0d7a755fc3cda0c3bd2b2a118f4c77  shop-commerce-instock.json
c36413afbeef4b725663aeecca846cc731a4c1ac8bc122497706c1c678c13a26  track-full.json
94fc0d78c42b58e0b07b8db40482479d682ab1a0b2ee1105d5ee7bf591db613e  track-none.json
9f9c7f0c84bade276e3475e42b40e214919a4cc932b2c4052077f814f01b35b0  track-ro.json
```

## Migration / deployment notes

- **Data migration:** none. No stored attribute, key, schema, query or default changes.
- **Deployment scope:** the renderer only — the OpenNext server function and its static assets, rebuilt from the
  moved sources. No Lambda handler, route, permission, table, admin or infra change. A normal stack deploy rebuilds the
  other bundles from unchanged sources. The serving suites show no change in the served bytes, the stylesheet links
  or the script chunks.
- **Rollback:** revert the slice's commit, rebuild (`npm run build`) and deploy again. No data to restore. Old cached
  pages stay valid: the bytes are the same.
- **Operator gates (NOT RUN by the builder):** at closeout, the staging diff shows rebuilt code only; deploy to
  staging; render the three test sites (home, sitemap addresses, a product page, a category, the shop, search) against
  the real tables.

## Definition of Done

- Every declaration of the untouched `SitePage.tsx` is in the file named by § *File map*; `SitePage.tsx` holds the
  entry only and exports every name it exported before.
- Moves only: `verify-moves.mjs` PASS; the graph is a DAG (`graph.mjs` PASS).
- Both serving suites pass with no capture changed; the unit suite passes the same 964 tests unedited, none added.
- The one-time capture proof passed on the untouched and the moved file (record above); its files are not in the
  repository (RSP1-CAPTURE-SCOPE).
- The seven packet gates exit 0; docs updated (§ *Scope* item 5); the operator gates above pass.

## Evidence required

- EXECUTED by the builder: the baseline on the untouched tree; the one-time captures and their hashes;
  after each move step the renderer typecheck and the unit suite; the moves-only, graph, module-level and importer
  scripts with their negative controls; the seven gates (§ *Build record*).
- OBSERVED by the operator before SHIPPED: the staging diff and the three test sites on staging.

## Exit criterion

A change to one view is an edit in one file of at most about 460 lines; Track B (`cmrc-1`) changes the order views in
`site-page/order-views.tsx` and the order routing in `SitePage.tsx` only.

## References

- `docs/ROADMAP.md`, order of work from 2026-11-27, row `refactor-sitepage-1`.
- `docs/slices/refactor-shared-1.md`, `docs/slices/refactor-settings-1.md` (the earlier pure-move slices).
- `renderer/ARCHITECTURE.md` § *Page Rendering Pipeline* (file map, rule, import direction).
- `docs/caching-architecture.md` § *Serving contract*; `renderer/test/serving-contract/README.md`.
- `docs/testing-strategy.md` (test layers).

## Docs (ruling 9)

- `renderer/ARCHITECTURE.md`: the `site-page/` tree, § *Page Rendering Pipeline* "Files" paragraph with the rule "a
  new view or helper goes in its file under `site-page/`; `SitePage.tsx` holds the entry only" and the import
  direction; the pointers that named a moved symbol in `SitePage.tsx` (facets, locale-1a/b/d notes, review images,
  head alternates, editorial, `matchCommercePrefix`, `normalizePageAddressOrKeepRaw`, `prepareBlocks`).
- Line references `SitePage.tsx:<n>` (search `grep -rnoE "SitePage(\.tsx)?(:|#L| line[s]? |, line )[0-9]+"` over
  `*.md`, EXECUTED): the forward-looking ones are replaced by a file + symbol reference (a line number goes stale at the
  next edit): `docs/slices/cmrc-1.md` (10), `docs/slices/pay-2.md` (5), `docs/slices/lang-1.md` (5),
  `docs/slices/tags-1.md` (1), `docs/plan-reviews-import.md` (4), `docs/plan-static-html-pages.md` (2),
  `docs/plan-site-move-satulbanului.md` (2). `cmrc-1.md:110` (`SitePage.tsx:10-15`) is still correct (the header
  comment did not move) and stays. Historical citations stay: the closed or built slice documents, the ROADMAP row of
  the shipped `cmrc-counties-1`, and the `landing-1` row of `docs/plan-courses-group-sessions.md`.
- Pointers without a line number that name a moved symbol in `SitePage.tsx`: `docs/caching-architecture.md`
  (`matchCommercePrefix`), `docs/plugin-architecture.md` (`prepareBlocks`), `docs/TECH-DEBT.md` (`matchCommercePrefix`)
  — corrected.
- `renderer/test/MAP.md` and the `*_MAP.md` files are generated and git-ignored: not edited.

## Findings, not fixed

- **F-RSP1-UNUSED-IMPORTS.** The untouched `SitePage.tsx` imports `Product` and `Category` from `@amodx/shared` and
  never uses them (`tsc --noEmit --noUnusedLocals`, EXECUTED: TS6133 on both). Kept in `SitePage.tsx` (dropping an
  import is not a move). Fix: drop both names.
- **F-RSP1-HEADER-ONE-MODULE (false statement).** The header of `SitePage.tsx` says "this module is the ONE
  implementation of the public page render". The render now spans `SitePage.tsx` and `site-page/`; the entry is still
  one. Proposed text: "this module is the ONE entry of the public page render (its views and helpers are in
  `site-page/`)". Not edited (a comment change is not a move).
- **F-RSP1-DISPLACED-DOC.** In `prepare-blocks.ts` the doc comment of `prepareBlocks` ("SERVER PRE-FETCH FOR PLUGIN
  BLOCKS …") stands above the doc comment of `withCommaPriceRange`, 100 lines before `prepareBlocks` (it was so in the
  untouched file, lines 779–787). Fix: move it above `prepareBlocks`.
- **F-RSP1-COMMERCE-MARKER.** `commerce-parts.tsx` starts with `// --- COMMERCE PAGE COMPONENTS ---`, but its
  `isEditorial` is also read by the content page's `<main>` in `SitePage` (not a commerce page).
- **F-RSP1-PREFIX-LITERALS (doc claim vs code).** `renderer/ARCHITECTURE.md` (CDL-2 note) says every view that reads a
  prefix falls back to `URL_PREFIX_DEFAULTS` of the same key. Several fall back to a literal (`"/shop"`, `"/search"`,
  `"/product"`, `"/category"`, `"/checkout"`: `SitePage.tsx` account branch, `listing-views.tsx`, `product-page.tsx`),
  and two read `prefixes.category` with no fallback (`ShopPageView` category links,
  `CategoryPageView` pager base). The literals equal today's English defaults and `mapTenant` gives a complete object,
  so no visitor sees a difference today (INFERRED from the note's own statement). Fix: `URL_PREFIX_DEFAULTS.<key>` or
  `urlPrefixesOf`.
- **F-RSP1-PACKAGES-DOCS.** `packages/plugins/ARCHITECTURE.md` lines 128, 242, 289 and 323 name
  `renderer/src/components/SitePage.tsx` for `prepareBlocks` / its prefetch branches; they are now in
  `site-page/prepare-blocks.ts`. `packages/` is protected by ruling 10: not edited.
- `renderer/src/components/SitePage_tsx_MAP.md` (git-ignored, generated by rmap) is stale; not edited.

## Deviations

- **Ruling 7 — resolved by RSP1-CAPTURE-SCOPE.** The build added a capture test although every listed view is
  rendered by a standing test (review-0 F-RSP1-SCOPE). Operator ruling: removed from the repository, kept as the
  recorded one-time proof above. The claims of review-0 F-RSP1-CLAIMS ("every prop", "every route kind") are
  corrected: the proof compared static markup with JSON-serialized client props, and its metadata cases are the 16
  listed (no account route).
- **Step 1 "propose the file map in the spec before moving" — accepted exception (RSP1-LATE-SPEC).** The map was fixed
  in `split.mjs` (`GROUPS`) and in the build log before the first move; this document was written after the moves.
  The map was not changed after the first move. The operator accepted this chronology; no replay.
- No file header comments in the new files (the packet permits only import and export text); `renderer/ARCHITECTURE.md`
  describes each file.

## Build record

Builder `claude-opus-5-5`, 2026-11-27, base `f649b6a`, tree clean at the start. Detailed log and every script:
`.agent-manager/slices/REFACTOR-SITEPAGE-1/` (git-ignored): `build-progress.md`, `SitePage.orig.tsx` (the untouched
file, sha256 `06b1d8a7…`), `split.mjs` (the generator), `verify-moves.mjs`, `graph.mjs`, `module-level.mjs`,
`sitepage-importers.mjs`, their `.out` files, `steps.log`, the gate logs.

1. **Baseline (EXECUTED, untouched tree).** `npm run build` exit 0; `cd renderer && npx vitest run` 66 files, 964
   tests passed; `npm run test:serving` 176/176; `npm run test:serving-bundle` 61/61.
2. **Captures (EXECUTED, untouched file).** `REFACTOR_SITEPAGE_1_CAPTURE=1 npx vitest run
   test/unit/refactor-sitepage-1-server-render.test.ts` → 33 files; two `CI=1` runs 33/33, hashes unchanged; negative
   control (`TRK-1` → `TRK-2` in the tracking capture) → 1 failure; file restored, hashes equal. Done for the first
   (`.html`) set before the first move and again for the final (`.json`) set on the restored untouched file.
3. **Moves (EXECUTED).** `node split.mjs N`, N = 1..9 in the order `input`, `locale-strings`, `addresses`, `metadata`,
   `prepare-blocks`, `commerce-parts`, `order-views`, `listing-views`, `product-page` (a group moves only after the
   groups it reads from; the generator refuses a file that reads a name still in `SitePage.tsx`). After each step:
   renderer `tsc --noEmit` exit 0; `CI=1 npx vitest run` 997/997; capture hash mismatches 0 against the `.html` set
   (`steps.log`). The final `.json` set: 0 mismatches on the regenerated moved tree, 997/997. Two
   generator corrections, none touching the file map: a file without imports started with a blank line; `SitePage.tsx`
   imported `buildSitePageMetadata` only to re-export it (an `export … from` needs no import).
4. **Checks (EXECUTED).** `verify-moves.mjs` PASS (negative control: 3 failures); `graph.mjs` DAG PASS (negative
   control: 1 cycle); `module-level.mjs` (no import-time code); `sitepage-importers.mjs` (22 references with the capture test, which iteration 1 removed: 21); `tsc --noEmit
   --noUnusedLocals`: in the ten files only `Product`, `Category` (F-RSP1-UNUSED-IMPORTS).
5. **Gates of the build (EXECUTED, exit status; before iteration 1):** `npm run build` 0; `npm run typecheck` 0 (run again after the capture-format
   change: 0); `cd renderer && npm test` 0 (67 files, 997 tests, the capture test included; again after the change: 997); `npm run test:serving`
   0 (176/176); `npm run test:serving-bundle` 0 (61/61); `cd packages/plugins && npm test` 0 (14 files, 388 tests);
   `git diff --check` 0, and every new file checked with `git diff --no-index --check /dev/null <file>` (44 files at
   that time, clean). Also `cd tools/mcp-server && npm test` 0 (no backend route changed).
6. **Iteration 1 (after review-0 and the operator rulings, EXECUTED).** Production files unchanged since review-0:
   `cat renderer/src/components/SitePage.tsx renderer/src/components/site-page/* | shasum -a 256` equals
   `moved-tree.sha256` (`a798ca57…`). The capture hashes still equal `captures.sha256` before the removal. Removed the
   test file and the capture directory (`rm`). Spec, ROADMAP row and `CURRENT_SLICE.md` reconciled (unit count 964;
   the claims of F-RSP1-CLAIMS corrected; `renderer/ARCHITECTURE.md` and `docs/TECH-DEBT.md` do not cite the test —
   `grep`, no hit). Importer scan re-run: 21 references. Gates of this round: § *Iteration 1 gates*.
### Iteration 1 gates (EXECUTED, exit status)

`npm run typecheck` 0; `cd renderer && npm test` 0 (66 files, 964 tests — the count of the untouched tree);
`git diff --check` 0, and each of the 10 new files checked with `git diff --no-index --check /dev/null <file>`: clean.
The full gate set is the operator's this round (ruling after review-0).

7. **NOT RUN:** the operator's staging gates (§ *Migration / deployment notes*); `npm run lint` (not a gate of this
   packet); `cd backend && npm test` (forbidden by the packet).

## Closeout (operator, 2026-11-27)

- Relay: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, two cycles; review-0 `escalate` (two packet deviations,
  one wording finding), operator rulings RSP1-CAPTURE-SCOPE and RSP1-LATE-SPEC, review-1 `approved`.
- Operator's reproduction of the one-time capture proof (before its removal): the capture test exits 0, 33 of 33, on
  the new `SitePage.tsx` and on the `SitePage.tsx` of the commit before this slice put in its place; the 33 capture
  files were not rewritten (one hash over all equal before and after); the new file put back (hash equal).
- Production files unchanged between review-0 and the commit: `SitePage.tsx` plus `site-page/*` concatenated,
  SHA-256 `a798ca5767c4bf0d207e40bab9b7af9badf2b7e0290ef65fdb2855bab4348de0`, equal to the trail's record.
- Operator gates on the approved tree, each exit 0: build, typecheck, shared (662), plugins (388), renderer (964),
  serving (176 pass, 0 fail), serving-bundle (61 pass, 0 fail), admin unit (499), backend unit (2451), infra, mcp (23),
  `git diff --check`; no change under `backend`, `infra`, `packages`, `admin`, `tools`, `renderer/middleware.ts`,
  `renderer/src/lib`, a manifest or a lockfile.
- Edits to other slice documents (`cmrc-1`, `lang-1`, `pay-2`, `tags-1`): these are open specs (draft, reviewed or
  ratified with sub-slices to come), not closed records; the edits replace `SitePage.tsx:<line>` citations with the
  function and file that hold the code now.
- Staging diff (read before the deploy): 0 resources added, 0 removed, no IAM change; the renderer functions and
  site assets rebuilt. Deploy: `AmodxStack-staging` succeeded.
- Staging proof (read-only, real tables): `cm1-commerce` — shop, category, product, search, cart and checkout pages
  answer 200 with a real page, the category and product pages show their names; `cm1-catalog` — shop, category,
  product and search the same; the general smoke passes (home pages, sitemap addresses, 11 admin routes per site,
  admin screens).
- NOT proven on staging: the order confirmation and order tracking pages with a real order, and the account pages
  (they need an order with its e-mail or a signed-in customer). Basis for these: the moved code is byte-identical
  (the moves check), the unit suite and the one-time capture proof (`track-full`, the confirmation states).
