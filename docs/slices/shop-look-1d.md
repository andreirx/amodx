# SHOP-LOOK-1D — product card options on the showcase block, and the post grid side panel (implementation record)

Status: **BUILT** (2026-11-16, builder), uncommitted, awaiting review. Start: `main` at `61d965d`, tree clean. All oracles
of the packet's § 4 pass on the final tree (§ 7): serving contract 122 / 122 (119 existing rows unchanged + 3 new `sl1d-*`
rows). Maturity: the ten options are **PROTOTYPE** until the operator's staging run (Operator closeout, below).

## 1. The requirement

The ratified design `docs/slices/shop-look-1.md`, row `shop-look-1d` of § 9 as re-cut by § 17.3, with § 17.1. Human
rulings 2026-11-15: SHOPLOOK-BADGE = **B** (the block lists the badge tags, `badgeTags`; no product field, no product
editor change); SHOPLOOK-FORM = **B** (the contact block is not changed: no edit under `packages/plugins/src/contact/` or
in `backend/src/contact/send.ts`; § 4.4 not built). Reference sections built: 7 (the product card), 8 (the post list with
a side panel), 11 (the section labels of these two blocks).

What a visitor sees, each option optional and off by default:

- **Showcase (`categoryShowcase`).** A small label above the block's heading (`eyebrow`). On each product card: one
  badge over the photo (`badgeTags`), the name of the product's first category above the title (`showCategoryLabel`),
  the product's short text under the title, two lines at most (`showDescription`), and the stars and "4.5/5 (2 reviews)"
  of the approved reviews (`showRating`).
- **Post grid (`postGrid`).** A small label above the headline (`eyebrow`) and a panel with a text, a quote and a button
  (`asideText`, `asideQuote`, `asideButtonText` + `asideButtonLink`): left third of the section from 768 px, above the
  posts on a phone.

## 2. What changed (file:line on the final tree)

| File | Change | Serves |
|---|---|---|
| `packages/plugins/src/category-showcase/schema.ts:12-17` | `eyebrow`, `badgeTags` (`max(10)`), `showCategoryLabel`, `showDescription`, `showRating` — `.optional()`, no default | § 4, § 4.2 |
| `packages/plugins/src/category-showcase/index.ts:35-40` | the five Tiptap attributes, `default: null` | § 4 |
| `packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx:22-28` | `Product`: `tags`, and the three server keys `_categoryName`, `_descriptionText`, `_rating` | § 6.3 rule 3 |
| `CategoryShowcaseRender.tsx:30-55` | `CardOptions`; `textOf` (blank = absent); `badgeOf` (§ 7.4: at most one badge, the block's order wins, exact match) | § 7.4, § 16 R6 |
| `CategoryShowcaseRender.tsx:77-79` | comment only: F-PL1-9 is kept by this slice (operator decision 2026-11-16). No price code changed | packet § 2 |
| `CategoryShowcaseRender.tsx:87-91`, `:111-126` | the card: badge pill (after the out-of-stock overlay), category label above `<h3>`, short text and rating under it | § 7, § 7.2-7.4 |
| `CategoryShowcaseRender.tsx:137-159`, `:211-213`, `:233` | doc comment (texts); the block's options resolved once (`catalogMode` → every card option off, SL-D10); the eyebrow `<p>` first in the `<section>`; `options` passed to each card | § 4.2, § 5, SL-D10 |
| `packages/plugins/src/category-showcase/CategoryShowcaseEditor.tsx:6-33`, `:143-178` | `storedShowcaseOption`, `badgeTagsFromText` (exported pure functions); the controls: label, badge tags (comma-separated, local text state), three tick boxes | packet § 1 item 7 |
| `packages/plugins/src/post-grid/schema.ts:12-17`, `index.ts:36-41` | `eyebrow`, `asideText`, `asideQuote`, `asideButtonText`, `asideButtonLink` — `.optional()`; Tiptap `default: null` | § 4.2 |
| `packages/plugins/src/post-grid/PostGridRender.tsx:14-17`, `:31-41`, `:44-50` | `textOf`; doc comment (the panel rule); the option values; `_getUrl` | § 4.2, SL-D14 |
| `PostGridRender.tsx:123-185`, `:187-206` | today's list element held in `postsEl` (its lines unchanged); the section: eyebrow, headline, then `postsEl` alone or inside `grid md:grid-cols-3` with the `<aside>` first and the list in `md:col-span-2` | § 3 row 8, § 6.2 |
| `packages/plugins/src/post-grid/PostGridEditor.tsx:17-30`, `:73-76`, `:106-129` | `storedText` (exported); a `TextArea`; the label field; the "Side panel" group | packet § 1 item 7 |
| `renderer/src/components/SitePage.tsx:19`, `:39` | imports `getProductById`, `sanitize-html` (already a renderer dependency, used by `lib/sanitize.ts`) | § 6.4, § 7.2 |
| `SitePage.tsx:774-834` | `SHOWCASE_CARD_READ_LIMIT` (12), `SHORT_TEXT_MAX` (400), `cardShortText`, `withShowcaseCardData` (§ 5 below) | § 6.4, § 7.2, § 7.3 |
| `SitePage.tsx:858-860` | `prepareBlocks`, showcase branch: after the products are read, on a non-catalog tenant only, `withShowcaseCardData` | § 6.3 rule 3, SL-D10 |
| `packages/plugins/test/sectionBlocksBaselineCases.ts` (new), `sectionBlocks.baseline.json` (new) | 12 showcase and 10 post grid inputs; their HTML recorded from the UNCHANGED renders at 61d965d (static and streaming renderers) | § 4 |
| `packages/plugins/test/sectionBlocks.test.ts` (new) | 45 tests (§ 3) | taxonomy |
| `renderer/test/unit/shop-look-1d-showcase.test.ts` (new) | 17 tests of the server pass (§ 3) | taxonomy |
| `renderer/test/serving-contract/fixtures.mjs:937-1006`, `:1060-1061` | `SL1D`: commerce copies set / plain / blank and catalog copies set / plain, page `/sl1d-section` | § 6.3 |
| `renderer/test/serving-contract/contract.test.mjs:45`, `:3269-3387` | rows `sl1d-options`, `sl1d-blank-as-absent`, `sl1d-catalog-no-effect` | § 6.3 |
| `tools/mcp-server/src/index.ts:499-503`, `:620-624` | `BLOCK_SCHEMAS.postGrid` and `.categoryShowcase`: the new attributes and their rules | packet § 1 item 8 |
| `docs/block-types.md` | the two table rows; § *Category showcase card options*; § *Post grid side panel* | packet § 1 item 8 |
| `packages/plugins/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md` | the two table rows, § *The `category-showcase` card options and the `post-grid` side panel*, test table; `prepareBlocks` item 5 and § SHOP-LOOK-1D | docs |

Not changed: `renderer/src/lib/dynamo.ts` (the three reads are used as they are), `packages/shared` (no locale text:
§ 6), `admin/` (the editors need no data they do not receive today: `BlockEditor.tsx` not edited), backend, infra,
`package.json`. No new dependency. Generated maps (`*_MAP.md`, rmap output, "do not hand-edit") were not edited; they are
stale for the edited files until the next `rmap` run.

## 3. Taxonomy → tests (all EXECUTED, pass)

P = `packages/plugins/test/sectionBlocks.test.ts` (renders `RENDER_LOADERS[…]` with `react-dom/server`; "baseline" =
`sectionBlocks.baseline.json`, compared in both renderers); R = `renderer/test/unit/shop-look-1d-showcase.test.ts` (the real
`SitePage` and the REAL `getAllCategories`, `getProductById`, `getProductReviews`, each wrapped in a call-counting spy, over
a DynamoDB document-client stub that pages Query results BEFORE the filter, as DynamoDB does); S = serving rows.

| Option | Off / absent / blank | On, data present | On, data absent or malformed |
|---|---|---|---|
| showcase `eyebrow` | baseline, every case, both renderers: P "absent: …", "null: …", "blank 1: …", "malformed: …" (`7`); S `sl1d-blank-as-absent` (`"  "`) | the `<p>` first in the section, trimmed; removing it gives the baseline — P "a <p> first in the section …"; without a category name and on a catalog site still drawn — P "without a category name, and on a catalog site …"; S `sl1d-options` | whitespace → as absent: P "blank 1: …"; S `sl1d-blank-as-absent` |
| `badgeTags` | no badge, baseline: P "absent/null/blank 1 (`[]`)/blank 2 (blank entries)/malformed (a string)"; no read: R "eyebrow and badgeTags need no read …" | P "zero, one and several matching tags, with the block list in both orders" (`[oak]`; `[TOP PICK, POPULAR]`; `[POPULAR, TOP PICK]`; three entries); "the order of the product's own tags never changes the badge (the § 7.4 example)"; "never more than one badge on a card"; "the badge is the tag as stored …, after the out-of-stock overlay; removing it gives today's HTML"; S `sl1d-options` (Sale `[wool]` → wool; `[POPULAR, wool]` and `[wool, POPULAR]` → POPULAR) | **Rule (§ 7.4):** exact string match — case and spaces count on both sides; no trimming, no case folding. P "exact match: …" (`top pick`, `Top Pick`, `TOP PICK `, ` TOP PICK`, `TOPPICK` and a product tag `TOP PICK ` → no badge); a blank entry is ignored and never matches a blank product tag — P "a blank entry of badgeTags is ignored …"; a product without tags or with `tags` not a list → no badge — P "a product without tags, …"; empty list → as absent — P "blank 1: …", S `sl1d-blank-as-absent` |
| `showCategoryLabel` | no label, baseline (P variants); **no read**: R "absent, null and false: no helper call, no DynamoDB request …" (also `"true"` and `1` → off) | the name of `categoryIds[0]`, above the title: R "one getAllCategories call per block; `_categoryName` = …"; P "each element in its place …"; S `sl1d-options` (Rugs ×3, SL1D Wool) | first category hidden or missing → no key → no label: R (p3 hidden first, p4 missing first, p5 no category); P "options on, but no product carries their data …"; S `sl1d-options` (`sl1d-first`: first category hidden; "SL1D Hidden" in neither HTML nor payload). **Several categories (SL-D7):** the FIRST one, even when it is not the showcased category (R: p1 in `[c2, c1]` → "Name c2"); a hidden first category gives no label, the second is not used |
| `showDescription` | no text, baseline; no read (R as above) | plain text under the title, `line-clamp-2`: R "one getProductById (one GetCommand …) per product …"; P "each element in its place …"; S `sl1d-options` (five texts) | no description, blank, or not a string → no key → no element: R (p2; `""`, `42`, `<p> </p><br>`); P "blank label or short text → no element". **HTML (§ 7.2, never raw HTML):** the server reduces it to plain text — tags removed, `script` / `style` content removed, block tags and a literal `\n` → a space, escapes undone, white space collapsed — R "HTML becomes plain text, never HTML …"; S `sl1d-options` (`<p>Hand-<b>woven</b> wool &amp; cotton.</p><p>Second line.</p>` → "Hand-woven wool & cotton. Second line."); the card escapes whatever reaches it — P "text that holds HTML is drawn as text, never as HTML". **Cut:** `line-clamp-2` (§ 7.2) on screen; the payload holds at most 400 code points — R "cut to 400 characters (code points …)" |
| `showRating` | no rating, baseline; no read (R as above) | `★` × the rounded average (`aria-hidden`) and the `reviewsSummary` text of the APPROVED reviews: R "one getProductReviews per product; …approved only…"; RO plural forms — R "the text is the tenant's `reviewsSummary` …"; P "rating: the stars are the rounded average …"; S `sl1d-options` (5 + 4 approved, 1 pending → 4.5/5 (2 reviews); 3 → 3/5 (1 review)) | no approved review → no key → no rating line (§ 7.3): R (p2: one pending only); S `sl1d-options` (`sl1d-first`: two rejected → none). **Two result pages → both counted:** R "reviews over two result pages, the first page empty after the filter: both pages counted, two requests …" and "… approved ones on both: all counted". Malformed `_rating` → no element: P |
| post grid fields | baseline, every case, both renderers: P "absent/null/blank/malformed: …"; S `sl1d-blank-as-absent` | the panel with its parts in order, the list in the right two thirds; removing the panel gives the baseline — P "all parts, in order …"; S `sl1d-options` | each part alone — P "each part alone: …"; **button text without a link → the button goes to `#`** (the hero's second-button rule, `shop-look-1b`) — P "a button text without a link …"; **a link without a text → no button and, alone, no panel** — P "a button link without a button text …", S `sl1d-blank-as-absent` (`/link-without-text`); all blank → as absent — P "blank: …"; the status boxes unchanged with every option set — P "the status boxes …" |
| the reads | none when every option is off: R "absent, null and false: …" (zero helper calls, zero requests); on a catalog tenant, none whatever is stored: R "a catalog tenant (SL-D10): …"; S `sl1d-catalog-no-effect` | per block: label → 1 `getAllCategories` call (≥ 1 Query; two-page case R "two result pages (the first holds no active category after the filter) …"); description → 1 `getProductById` = 1 `GetCommand` per product; rating → 1 `getProductReviews` per product (≥ 1 Query each); all three — R "all three on: 1 getAllCategories + per product …" (3 GetCommands, 4 Queries for 3 products); per block — R "one call PER BLOCK …"; at most 12 products read — R "a stored limit above 12 …" | category not found → no read — R "the category is not found …" |
| the browser fallback fetch | unchanged (no code touched on that path) | the products of `/public/categories/{slug}` are CATPROD# items: they carry `tags` but none of the three server keys, so only the **badge** can show there; label, short text and rating cannot — P "the browser fallback fetch's products …: only the badge can show". The fetch itself runs only in a browser (no DOM harness): INFERRED from the shared product shape, not exercised | — |

Also bound: schema adds no key when absent and refuses an 11th badge tag; the five Tiptap defaults are `null` (P, both
blocks); the editors offer each option with its stored value, and a cleared option stores `null` (P: `storedShowcaseOption`,
`badgeTagsFromText`, `storedText`); both renders keep a type-only `@amodx/shared` import (P, D3); no palette colour class
in any new element (P, Critical Rule 6); only the showcase's products change, by only the new keys (R, S).

**Baseline check (EXECUTED).** `sectionBlocks.test.ts` with its baseline and cases, copied into a separate worktree of
`61d965d` (`/tmp/SHOP-LOOK-1D-baseline-wt`, removed afterwards): the 20 "absent" / negative tests pass on the OLD renders,
the 25 "present" tests fail there. So the baseline is the old render, not the new one.

**Teeth check (EXECUTED).** Twelve mutations, each restored afterwards; each made the named suite fail. Render (P): the
product's tag order wins (2 failed), no blank filter on `badgeTags` (1), the catalog gate removed (2), eyebrow without
the blank check (2), a link alone opens the panel (1), the button link bypasses `_getUrl` (1). Server (R): a truthy flag
reads (1), the 12-product cap removed (1), any active category instead of the first (2), no sanitizing (2), the catalog
gate removed (1), the no-review guard removed (1).

Coverage gap (stated): the plugins package has no DOM harness, so the editors' `onChange` wiring is read, not exercised;
the pure functions they call are tested. The browser fallback fetch is not exercised (row above).

## 4. Byte identity

- **Pages whose blocks store no new attribute:** the render draws today's HTML (P baseline, both renderers, 22 inputs ×
  absent / null / blank / off / malformed) and the server pass adds no key and makes no read (R; § 6.3 rule 3). Every
  existing serving row passed unchanged — among them `cm1-identity-commerce`, `cm1-identity-content`, the `loc1-*`,
  `loc1e-*`, `cq1-*`, `ct1-*`, `bpf1-*`, `hc1-*`, `cf1-*`, `cm1-catalog-*` rows of design § 6.3 (the CM1 home pages hold
  today's showcase, tenant ISO-A's home today's post grid), and `sl1a-*`, `sl1b-*`, `sl1c-*`. `git status` lists no file
  under `renderer/test/serving-contract/` but `contract.test.mjs` and `fixtures.mjs`.
- **New rows:** `sl1d-options` — the set page's HTML equals its plain twin's after removing exactly the new elements
  (14 kinds, each with its asserted count) and the panel's two closing tags; its payload equals the twin's (resolved)
  after removing the stored options and the 9 added product keys. `sl1d-blank-as-absent` — null, blank, empty and off
  options and a link without a text: the plain twin's HTML byte for byte; the payload differs by the stored attributes
  only (no server key). `sl1d-catalog-no-effect` — a catalog copy with every card option on and the data present (tagged
  cards, descriptions, an approved review): the plain twin's HTML byte for byte; the payload differs by the stored
  attributes only.
- **A block saved again in the new admin** gets the new keys as `null` (Tiptap writes every declared attribute): its
  RSC payload changes, its HTML does not (design § 4.2; P "null: …", S `sl1d-blank-as-absent`). An owner action, page by
  page; nothing changes on deploy.
- The stylesheet's content-hash file name changes (new classes; accepted precedent CM1-A1). `sl1d-options` asserts the
  built stylesheet holds all 30 new classes.

## 5. The reads as built (design § 6.4)

`prepareBlocks`, showcase branch (`SitePage.tsx:850-861`), after `getProductsByCategory` and only on a non-catalog
tenant: `withShowcaseCardData(attrs, items, config)` (`SitePage.tsx:798-834`). An option is on only when stored exactly
`true`. With all three off it returns the same array: no call, no request. Otherwise, per block and per uncached render:

| Option | Helper | Helper calls | DynamoDB requests | Key added (only when there is data) |
|---|---|---|---|---|
| `showCategoryLabel` | `getAllCategories` (Query `CATEGORY#`, filter `status = active`, paginates) | 1 per block | ≥ 1: one per 1 MB page of the tenant's category items, hidden ones included | `_categoryName` |
| `showDescription` | `getProductById` (`GetCommand` `PRODUCT#<id>`) | 1 per product | 1 per product | `_descriptionText` |
| `showRating` | `getProductReviews` (Query `REVIEW#<id>#`, filter `status = approved`, paginates) | 1 per product | ≥ 1 per product: one per 1 MB page of that product's review items, all statuses | `_rating` = `{ average, count, text }` |
| `badgeTags`, `eyebrow`, post grid options | none | 0 | 0 | none |

"Per product" covers the products this pass read for the block, at most 12 (`SHOWCASE_CARD_READ_LIMIT`; a larger stored
`limit` shows its extra cards without the data). Every key is `TENANT#<request tenant>` (tenant isolation, design § 1.5);
no scan. The calls of one block run in parallel. Freshness as the design states (§ 6.4, § 17.2): a product, category or
review change purges the tenant's cache. The categories, products and reviews read here were already read by the
product page and the category page; nothing new is persisted.

## 6. Readability rule

- **Badge (over the photo):** an opaque pill — `bg-primary` with `text-primary-foreground`, the theme's own button pair —
  so the photo never shows through it and never sets its contrast. It is painted after the out-of-stock overlay
  (`bg-background/60`), so the overlay does not dim it. Contrast = the theme's primary pair (calculated, WCAG 2.1): default
  theme #000000 / #ffffff **21 : 1**; the "Stone" preset 16.7 : 1; the "Slate" preset 17.1 : 1; the "Indigo" preset
  #6366f1 / #ffffff **4.47 : 1** (finding F-1D-INDIGO-PRESET-CONTRAST, § 9). A long tag is cut with an ellipsis
  (`max-w-[90%] truncate`).
- **Rating, label, short text (under the photo, on the page background):** `text-muted-foreground` (default #64748b on
  #ffffff = 4.76 : 1), the colour of the card's other secondary texts. The stars are `text-primary` and `aria-hidden`: the
  text beside them says the same in the tenant's language, so the stars carry no information of their own.
- **Post grid panel:** page surface; text `text-muted-foreground`, quote `text-foreground` with a `border-primary` rule,
  button `bg-primary` / `text-primary-foreground` (as above).
- No colour literal in any new visitor-facing element (P "the new elements use theme classes only"). The editors use the
  admin's fixed palette (`gray`, `emerald`, `indigo`), as every block editor does; the admin is not tenant-themed.

## 7. Gates (each run bare; exit code by `echo $?`; EXECUTED on the final tree, after a fresh root build)

| Command (from the repository root unless named) | Expected | Actual |
|---|---|---|
| `npm run build; echo $?` | 0 | 0 |
| `npm run typecheck; echo $?` | 0 | 0 |
| `cd packages/plugins && npm test; echo $?` | 0 | 0 — 10 files, 311 tests (45 in `sectionBlocks.test.ts`) |
| `cd packages/shared && npm test; echo $?` | 0 | 0 — 22 files, 385 tests |
| `cd renderer && npm test; echo $?` | 0 | 0 — 43 files, 608 tests (17 in `shop-look-1d-showcase.test.ts`) |
| `cd renderer && npm run test:serving; echo $?` | 0, no existing capture or expectation changed | 0 — 122 / 122 (119 existing + `sl1d-options`, `sl1d-blank-as-absent`, `sl1d-catalog-no-effect`) |
| `cd admin && npm run test:unit; echo $?` | 0 | 0 — 13 files, 291 tests |
| `cd backend && npm run test:unit; echo $?` | 0 | 0 — 55 files (1 skipped), 1414 tests (1 skipped) |
| `cd tools/mcp-server && npm test; echo $?` | 0 | 0 — route coverage + 17 tool-shape tests |
| `git diff --check; echo $?` | 0 | 0 (the four untracked new paths checked separately for trailing whitespace: no line) |

Not run: `cd backend && npm test` (packet: never). MCP `routes.json`: no backend route changed, not refreshed.

## 8. Decisions and abstractions (one line each)

- **D-1D-1 server key names:** `_categoryName`, `_descriptionText`, `_rating` (the design wrote `description`, `rating`):
  the underscore marks data the server pass computed (precedent `_priceRange`); `_descriptionText` is the plain text, not
  the stored `description`; a stored product field can never be read as one of them.
- **D-1D-2 plain text, 400 code points:** the short text is reduced to plain text on the server with sanitize-html (no
  allowed tag) and cut at 400 code points — two lines of the widest card (two columns, full width) hold fewer, so the cut
  never shows; it bounds the payload (a description may hold 5000 characters, × 12 products, in both HTML and payload).
- **D-1D-3 at most 12 products read per block** (`SHOWCASE_CARD_READ_LIMIT`): keeps the § 6.4 bound ("≤ limit (max 12)")
  true for a stored `limit` above the schema's 12 (the backend does not check block attributes); extra cards are drawn
  without the data (precedent D-1C-2).
- **D-1D-4 the first category only (SL-D7):** a hidden or missing first category gives no label; the next category is not
  used (cat-theme-1 D-8 rule).
- **D-1D-5 an option is on only when stored exactly `true`** (render and server): `"true"`, `1` read as off.
- **D-1D-6 the post grid button:** drawn when its text is non-blank; a blank link gives `#`; a link without a text draws
  nothing — the hero's second-button rule (`shop-look-1b`), and design § 4.2 ("the panel shows when text, quote or button
  text is non-blank").
- **D-1D-7 the post grid status boxes** (loading, error, no posts) replace the whole section today (the headline too):
  they stay unchanged and show neither the eyebrow nor the panel.
- **D-1D-8 eyebrow classes:** the `categoryGrid` pill (D-1C-6), placed `mx-auto` in the centred showcase and at the
  start in the left-aligned post grid.
- **D-1D-9 the editor's badge field** is comma-separated and trims each entry (the owner types tags as the products carry
  them); the site's match on stored entries stays exact (§ 7.4). A tag that contains a comma cannot be entered there
  (it can through the MCP).
- `CardOptions` (`CategoryShowcaseRender.tsx:34`) — what: the four card options, resolved once per block (catalog → all
  off); users: `ProductCard` (each card); axis: none (a props record, not a dispatch); rejected: four separate props
  each repeating the catalog gate.
- `withShowcaseCardData`, `cardShortText` (`SitePage.tsx`, file-local) — what: the reads of the three card options and
  the plain-text reduction; users: the showcase branch of `prepareBlocks` (both content and category pages, through it);
  axis: none; rejected: inline code in the `prepareBlocks` branch (no separately testable shape, and the branch already
  holds three concerns).
- `storedShowcaseOption`, `badgeTagsFromText`, `storedText` (exported from the editors) — what: the stored value of a
  cleared or typed option; users: the editors' controls and the plugin test; axis: none; rejected: inline expressions in
  each `onChange` (no test seam without a DOM harness — the `storedOption` precedent of `shop-look-1b`). Not imported from
  the hero editor: that would make two block editors depend on a third.
- No other abstraction. `textOf` and `badgeOf` are file-local helpers of the renders.

## 9. Findings

- **F-PL1-9 kept (operator decision 2026-11-16):** the card's `parseFloat` on price texts (`CategoryShowcaseRender.tsx:76-82`,
  `docs/slices/price-locale-1.md`) stays. Removing it changes every commerce tenant's page bytes for a gain only on
  malformed data. The code comment, which said the debt would be removed by this slice, now says it is kept (comment
  only; no price code changed).
- **F-1D-INDIGO-PRESET-CONTRAST** (new, theme property): the "Indigo" theme preset's primary pair (#6366f1 / #ffffff) is
  4.47 : 1, just under WCAG AA 4.5 : 1 for small text. The badge (12 px) inherits it, as does every primary button of a
  tenant on that preset. Not changed: a preset colour change changes those tenants' pages.
- **F-1D-SHOWCASE-MCP-TEXT** (pre-existing, not changed): the MCP `categoryShowcase` description says it "fetches
  products live from the commerce API" and "only works on commerce-enabled tenants"; the products are read on the server,
  and the block is offered on commerce and catalog sites and drawn on every kind. Same class as F-SHOP-BLOCK-DOC.
- **F-1D-PROBE-DECODE** (test harness, pre-existing in `shop-look-1c-grid.test.ts:98`): its `decoded` helper undoes
  `&amp;` before `&lt;`, so a text that holds an escape is decoded twice. Found when this slice's harness copied it; the
  new test decodes `&amp;` last. The 1c test's data holds no escape, so its results stand.
- **F-SHOP-HARDCODED-COLOURS** (pre-existing, unchanged): `text-blue-600` on the post list and `text-red-500` /
  `bg-red-50` on its error box stay; no colour literal added.
- **F-SHOP-BLOCK-DOC** (pre-existing, open): the "18 custom plugins" lines stay stale.

## 10. Design lines that moved

Read on `61d965d`. Held: `dynamo.ts:228` (`getProductById`), `:278-308` (`getProductsByCategory`), `:318-334`
(`getAllCategories` loop), `:329` (its projection), `backend/src/lib/catprod.ts:12-29`, `:31-52`, `:46` (`tags`),
`category-showcase/index.ts:14` (`offeredOn`), `RenderBlocks.tsx:140` (`_getUrl`), `:142` (`strings`),
`language-packs/en.ts:118`, `ro.ts:114` (`reviewsSummary`). Moved: `SitePage.tsx:756` (`prepareBlocks`) → `:773` at start
(`:836` after this slice); `:786-789` (`_catalogMode`) → `:811` at start; `:853-889` (the shop card) → `:899` at start;
`:1317-1323` (product-page reviews) → `:1364-1371` at start; `CategoryShowcaseRender.tsx:23-67` (the card) → `:29-81` at
start (title `:58` → `:72`, price `:28-37` → `:34-51`, overlay `:52-56` → `:66-70`); `dynamo.ts:512-533`
(`getProductReviews` loop) → `:539-560`; `:536-537` (average) → `:563-564`; `index.ts:1936-1950` (`ReviewSchema`) →
`:2184`.

## Operator closeout

(left empty for the operator: a staging page with the showcase of section 7 with every option on — products with a
badge tag, a description, approved reviews — and the post grid of section 8 with its panel; screenshots at desktop and
390 px.)

**Review.** One build, one review, verdict approved. Builder `claude-opus-5-5`; reviewer `claude-sonnet-5-5`
(fallback; the Codex reviewer was out). Same provider family; not cross-vendor independence.

**Operator gates (2026-11-16, on the approved tree).** Build, typecheck, shared, plugins, renderer, serving, admin
unit, backend unit, MCP, `git diff --check`: each exit 0. Protected paths, allocation, existing captures, trailing
whitespace: no line.

**Staging (deployed 2026-11-16; diff read first: three renderer functions, two bucket deployments, the admin runtime
config).** Tenant `cm1-commerce`: one probe category, four probe products (photos light, dark, white, grey), six
approved reviews and one pending, one published page with the showcase (every option on, `badgeTags`
`["Top pick", "Popular"]`) and the post grid with its side panel. Chromium at 1400 px and 390 px; the operator looked
at both screenshots.

| Check | Result |
|---|---|
| eyebrow above the block heading; the category label on each card | shown |
| badge: tags `["Top pick", "oak"]` → "Top pick"; `["Popular"]` → "Popular"; no tags → none | as designed; the pill is filled, readable on the light and on the grey photo |
| badge: tags `["popular", "TOP PICK"]` (other letter case) → none | as designed (§ 7.4: exact match). See the finding below |
| short text: cut to two lines; a description stored as HTML | "Deep walnut tone." shown as text, no tag |
| rating: 5 and 4 → 4.5/5 (2 reviews); 3 → 3/5 (1 review); 5, 5, 4 → 4.7/5 (3 reviews) | correct |
| the product with only a pending review | no rating |
| post grid: eyebrow; the panel with text, quote and button beside the list; above the list on the phone | shown |
| no horizontal page scroll, 1400 px and 390 px | pass; two cards per row on the phone |

Not checked: the two block editors in a browser; the card's browser fallback fetch; a catalog site. The probes were
removed.

**Finding for the human (F-1D-BADGE-CASE).** The badge match keeps letter case, as § 7.4 ratified, but the badge is
DRAWN in capitals. An owner who sees "TOP PICK" on one card and tags the next product "TOP PICK" while the block
lists "Top pick" gets no badge and no hint why. Proposed: match without regard to case and outer spaces, and draw
the block's spelling. Not changed here (a ratified rule).

Prod deploy: the human's.
