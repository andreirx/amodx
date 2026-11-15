# CATEGORY-CONTENT-1 — a category page shows editable content before its product list (implementation record)

Status: **BUILT, revision 2** (2026-11-15, builder), uncommitted, awaiting review. Start: `main` at `6a70499`, tree
clean. Review-0 and review-1 (each verdict revise) found admin editor state defects; revisions 1 and 2 close their
class (§ 14). All 10 oracles of the packet's § 5 pass on the revised tree (§ 11): serving contract 113 / 113 (111
existing rows unchanged + 2 new `cc1-*` rows). No allocation addition (§ 10). Maturity: **PROTOTYPE** until the
operator sees a category with content on staging.

## 1. Human direction (quoted)

> "check if we can have additional content on each category page before the product listing starts - we need that too
> (that means we can edit each category page normally and after that content is rendered, also the list of products is
> rendered with filters and so on)"
>
> "we need auto-generated pages for producer, category, collection … if there's not much work to do A and you say it's
> cleaner and tidier, then sure, do A."

Option A (ruled): the category holds its own blocks. No linked content page.

## 2. The facts of packet § 0 — confirmation (OBSERVED in the base tree unless marked)

| Fact | Confirmation |
|---|---|
| `CategorySchema` fields | Confirmed (`packages/shared/src/index.ts`, `// --- CATEGORIES ---`). |
| `CategoryPageView` prints breadcrumb, `<h1>`, description, count, `FacetedListing` or grid, pager; serves every site kind | Confirmed (base `SitePage.tsx:1452-1503`). |
| Content page: `RenderBlocks` after a preparation pass (`_catalogMode`) | Confirmed (base `:654-719` pass, `:798` draw). The pass loads `postGrid` posts, `categoryShowcase` products (+ catalog-mode reduction, URL prefixes), `reviewsCarousel` reviews. |
| `BlockEditor` two users | Confirmed (`ContentEditor.tsx:680`, `StrategyEditor.tsx:115`). It reads `initialContent` once (`useEditor`); an empty list = an empty editor (`BlockEditor.tsx:63`). |
| Category routes; `create.ts:38`, `update.ts:35` use `CategorySchema.omit(...)` | Confirmed. Extension: update is `.omit(...).partial()`, and zod 4 applies `.default()` values inside `.partial()` (EXECUTED, finding F-1). |
| Glam import creates only absent categories | Confirmed: `PutCommand` with `attribute_not_exists(SK)` (`glam-pricelist.ts` `createCategories`). |
| WooCommerce import writes categories | Confirmed. Extension: Get `CATEGORY#<slug>`, then an UNCONDITIONAL Put when the Get found nothing (§ 3 (b)). |

## 3. Step 1 enumerations (before any edit)

Basis (EXECUTED): text search over `backend/src`, `renderer/src`, `admin/src`, `packages/plugins/src`,
`tools/mcp-server/src`, `scripts`, `infra/lib` for `CATEGORY#`, `GSI_Slug` / `TenantSlug`, `getAllCategories` /
`getCategoryBySlug`, `productCount`, `"/categories`. No query on a tenant partition without an SK prefix exists (search
for a bare `"PK = :pk"`: none). The compiler after the schema change: the root build passed with no new error — an
optional field breaks no site, so the compiler names no reader; the basis stays the text search (a subset claim limited
to these patterns).

**(a) Readers of category items**

| Reader | single / many | `blocks` in the answer |
|---|---|---|
| `backend/src/categories/get.ts` (`GET /categories/{id}`) | single, whole item | yes — the admin editor needs it |
| `backend/src/categories/list.ts` (`GET /categories`) | many | no: `ProjectionExpression` (unchanged); page loop added (§ 5) |
| `backend/src/categories/public-list.ts` (`GET /public/categories`) | many | no: `ProjectionExpression` (unchanged); page loop added (§ 5) |
| `backend/src/categories/public-get.ts` (GSI_Slug) | single + its products | yes (whole item; finding F-9) |
| `backend/src/categories/delete.ts` | single (`slug`), children query (`id`) | no |
| `backend/src/import/glam-pricelist.ts` `lookupCategory` | single (`id, slug` / `SK, id, slug`) | no |
| `backend/src/import/woocommerce.ts` Get `CATEGORY#<slug>` | single, whole item (uses `id`) | read, not returned |
| `backend/src/products/public-get.ts`, woocommerce `findProductBySlug`, renderer `getProductBySlug` (GSI_Slug) | a category with the same slug is read and discarded | no (F-12) |
| renderer `getCategoryBySlug` (category page, its metadata, the showcase preparation) | single, whole item | yes — the page draws them |
| renderer `getAllCategories` (product page, shop, sitemap, card categories) | many, paginated | no: projection (unchanged) |
| admin `Categories`, `CategoryEditor` parent list, `ProductEditor`, `BlockEditor`, `AdminLayout`, `GlamPricelistImport` | many, via `GET /categories` | no |
| admin `CategoryEditor` load | single, via `GET /categories/{id}` | yes |
| MCP `list_categories` | many, via `GET /categories` | no |

**(b) Writers of `CATEGORY#` items**

| Writer | merge / replace | Result for `blocks` |
|---|---|---|
| `categories/create.ts` | Put of a new `CATEGORY#<uuid>` | stored when sent; no key when not sent |
| `categories/update.ts` | merge: Get, `{ ...existing, ...input }`, Put | kept when the body has no `blocks` (needs the schema without default, § 4) |
| `categories/delete.ts` | delete | out of rule 6 |
| `import/glam-pricelist.ts` `createCategories` | create only (`attribute_not_exists(SK)`) | never touches an existing category — pinned by a test, no change |
| `import/woocommerce.ts` | Get, then unconditional Put when absent → a replace in a race | **changed**: the Put has `attribute_not_exists(SK)` |
| `productCount` updates | none (written 0 at create, never updated) | — |

**(c) Serving-contract rows that hold a category page:** `cm1-identity-commerce` (`/category/rugs`),
`cm1-identity-content` (`/category/mats`), the `loc1-*` en-US and RO subject rows (catalog `/category/floors`, the
`cf1-*` categories), `cm1-catalog-listings`, the `cf1` facet rows, `loc1e-category-controls`, `cq1-*` / `ct1-*`
captures, `cdl2-partial-prefixes`. No fixture category of theirs has `blocks`: they prove "absent → today's bytes".

## 4. What changed (file:line at the end of the build)

| File | Change |
|---|---|
| `packages/shared/src/index.ts:1611-1615` | `CategorySchema.blocks = ContentItemSchema.shape.blocks.unwrap().optional()` — the content page's type and rule (`z.array(z.any())`), without its `[]` default |
| `backend/src/categories/list.ts:18-39`, `public-list.ts:11-38` | every page of the Query followed (`ExclusiveStartKey` loop); projection unchanged |
| `backend/src/import/woocommerce.ts:368-371` | the category Put has `ConditionExpression: "attribute_not_exists(SK)"` |
| `renderer/src/components/SitePage.tsx:748-818` | `prepareBlocks(blocks, config)`: the content page's pass, moved verbatim (indentation only), one function |
| `SitePage.tsx:675` | content page: `await prepareBlocks(content.blocks, config)` |
| `SitePage.tsx:411-412` | category page: `await prepareBlocks(category.blocks, config)` (no read without blocks) |
| `SitePage.tsx:1475-1494`, `:1519` | `titleBlock` (the old title `<div>`, unchanged), `pageContent` (`<div class="mb-8" data-category-content>` + `RenderBlocks`), `{pageContent ? <>{titleBlock}{pageContent}</> : titleBlock}` |
| `admin/src/pages/CategoryEditor.tsx:21-44`, `:46-123`, `:154-164`, `:169-170`, `:235-248` | `CategoryForm`, `categoryFormOf(data)` (load mapping, `blocks` = stored list or `[]`); revisions 1–2: one editing session `{ session, id, tenantId, form }` with a token per run of the load effect (`lastEditingSession`), `ready` (route id AND current tenant), `edit(forSession, change)`, the load effect (`isCurrent`, parent list reset per session), `setField`, the upload bound to its session; card "Page content" with the help line and `BlockEditor` (`key={editing.session}`, changes through `edit`) |
| `tools/mcp-server/src/tool-shapes.ts:44-61`, `src/index.ts:10`, `:1194-1204` | `create_category`: optional `blocks` (JSON array, `parseJsonInput`); body by `createCategoryBody` (`name` = the `title` argument) |
| tests | `packages/shared/test/category-content-1.test.ts` (new); `backend/test/unit/category-content-1.test.ts` (new); `backend/test/unit/glam-import-handler.test.ts:199`; `renderer/test/unit/category-content-1.test.ts` (new); `renderer/test/serving-contract/fixtures.mjs:781-810` (`CC1`), `contract.test.mjs:2860-2971` (rows `cc1-*`); `admin/src/pages/CategoryEditor.test.ts` (new); `tools/mcp-server/test/tool-shapes.test.ts` (+2) |
| docs | `packages/shared/ARCHITECTURE.md`, `backend/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md` (§ "Category page content"), `admin/ARCHITECTURE.md`, `tools/mcp-server/ARCHITECTURE.md`, `renderer/test/serving-contract/README.md` (row `cc1-*`, count 113) |

No new dependency, module, registry, route, permission or infra change. `routes.json` unchanged (same `POST /categories`).

## 5. Decisions taken inside the slice (one line each)

- **No default on `blocks`.** zod 4 fills `.default()` values inside `.partial()` (EXECUTED), so the content schema's
  `[]` default would make every `PUT` body without `blocks` erase the stored content. Control (EXECUTED): with the
  default, 2 backend rows fail.
- **The list routes follow every page.** DynamoDB's 1 MB Query page counts the stored item before the projection;
  before this slice a category was ~0.5 KB, so a single page held ~2 000 categories; with page content, a few large
  categories fill it and `GET /categories` / `GET /public/categories` would return a cut list with no error. A loop of
  the renderer's own form (`getAllCategories`). Control (EXECUTED): without it both list rows fail.
- **WooCommerce Put conditional.** The Get is not a lock. With the condition, a category written since the Get is never
  replaced; the row fails (reported in `errors`) and a second import matches it — the glam import's rule.
- **Title block as one element.** `{cond && <X/>}` would add a `false` child to every category page's RSC payload.
  Control (EXECUTED): the plain form `{titleBlock}{pageContent}` fails `cm1-identity-commerce`, `cm1-identity-content`,
  `loc1-diff-cdl-2` (serving) and 13 unit rows.
- **Admin sends the editor's list as is** (rule 4 "Save sends them"); see F-6 for the emptied editor.
- **MCP `name`.** `create_category` sent `title`; the route requires `name` (F-3), so no category could be created by
  the tool and its `blocks` could not reach the route. The body now carries `name`; the tool argument is unchanged.

## 6. Taxonomy → tests (all EXECUTED, pass)

| Input | State | Expected | Test |
|---|---|---|---|
| category `blocks` | absent | page byte-equal to the base, every site kind | serving: every existing capture row unchanged (`cm1-identity-commerce`, `cm1-identity-content`, `loc1-*` incl. catalog, `cq1-*`, `ct1-*`, `loc1e-*`); unit `category-content-1.test.ts` "[content\|commerce\|catalog] blocks absent …" (main keeps 4 children, title block a `<div>`, no probe, no extra read) |
| category `blocks` | `[]` | as absent | unit "[kind] blocks []: …"; serving `cc1-category-no-content` (catalog `cf1-many`, page 1 HTML byte-equal to the twin, page 2 `<main>` byte-equal, payload equal resolved) |
| category `blocks` | one paragraph + a block that needs the preparation pass | both between the title block and the listing; filters and pager work; page 2 too | serving `cc1-category-content`: catalog `cf1-many` page 1, `?page=2`, the twin's first filter link — `<main>` equals the twin but for one content `<div>` right after the title block, holding the paragraph and a `categoryShowcase` of `floors` with its prefetched products (no price, currency or stock text; `_catalogMode` in the payload); page 1 / page 2 list 24 / the other 6; commerce `rugs` with a `postGrid` listing the tenant's posts. Unit "[kind] a paragraph + a showcase + a post grid …" (position on page 1, `?page=2`, `?f=`, filtered page 2; no width props) and "[kind] the blocks, their prepared attrs and the texts equal what a content page …" (catalog-mode rule, Romanian texts) |
| category `blocks` | stored malformed (not an array) | ignored; page as absent; no error page | unit "[kind] blocks not an array (string\|object)"; serving `cc1-category-no-content` (commerce `rugs`, a string) |
| create / update route | `blocks` not an array, or a block the content route refuses | refused with the content route's rule | shared `category-content-1.test.ts` "the content page's rule: exactly what the content schema accepts and refuses" (create and update forms); backend "blocks not an array → refused …, nothing written" (POST and PUT; status 500 = the category routes' existing refusal path, F-2). The content rule refuses no array content (`z.array(z.any())`) |
| update route | body without `blocks` | stored `blocks` kept | backend "a body without blocks keeps the stored blocks"; shared "absent stays absent" |
| update route | `blocks: []` | stored as empty; page as absent | backend "blocks: [] → stored as []"; page: the `[]` row above |
| list routes and list reads | category with large `blocks` | no `blocks` | backend "GET /categories: every category, none with blocks", "GET /public/categories: …" (4 × 300 KB categories, one per page); renderer `getAllCategories` projection unchanged (OBSERVED) |
| glam import | category exists with `blocks` | kept | `glam-import-handler.test.ts` "CATEGORY-CONTENT-1 rule 6: categories that exist with page content …" (admin uuid key and importer slug key; first and repeated import; only the absent collection category written) |
| WooCommerce import | category exists with `blocks` | kept | backend "the category at CATEGORY#<slug> exists with blocks → matched, not written"; "written between the import's Get and its Put (the race) → the Put is refused"; "an absent category is still created". Control: without the condition the race row fails |
| any other `CATEGORY#` writer | — | kept | none other found (§ 3 (b)) |
| admin editor | load, edit, save | saved body carries the edited `blocks`; no blocks → empty editor | `admin/src/pages/CategoryEditor.test.ts` (18 rows; the REAL component and callbacks run on a hook store, POST / PUT bodies captured; the editor's document is modelled as `BlockEditor` keeps it — read once per key, then its own edits — and EVERY Save asserts saved `blocks` = the shown document): load / empty / edit + save; older-render handlers; review-0 upload rows; the four "category changes while a load is slow" rows; the six review-1 rows of "an editing session is a category AND a tenant AND a visit" (initial tenant resolution null → t1, tenant change on a draft, tenant change on a category with its parent options, late t1 answers, "new" → c1 → "new" with an upload pending, an old editor's late onChange); section texts; load mapping. Controls: on the review-0 component 7 of 12 failed; on the revision-1 component 5 of 18 fail |
| refresh | category save | the page refreshes as after a description change | backend "the refresh: a save purges the category page by the same call as a description change" |
| MCP | `create_category` with / without `blocks` | passed through / no key | `tool-shapes.test.ts` "create_category sends the name as `name` …", "… passes `blocks` through as sent …" |

## 7. Abstractions (one line each)

- `prepareBlocks` (`SitePage.tsx:756`) — the block preparation pass; users: the content page (`:675`) and the category
  page (`:412`); axis: none new (packet § 2 forbids a copy); rejected: a copy in the category branch (duplicated
  non-trivial logic: three block kinds and the catalog-mode rule).
- `categoryFormOf` (`CategoryEditor.tsx:31`) — the form from a stored category; users: the new-category state (2 places:
  initial, effect) and the load answer; rejected: literal shapes with `blocks` added to each.
- `edit(forSession, change)` (`CategoryEditor.tsx:78`, revisions 1–2) — the one way to change the form; users:
  `setField` (7 fields), the name, the upload, the block editor; axis: none — it is the rule of § 14; rejected: one
  functional `setForm` per handler with a separate loaded-id state (two states to keep in step, and an upload ending
  after a move would need a ref to know the current session).
- `lastEditingSession` (module counter, `:51`) and `EditingSession` (type, `:54`), revision 2 — the session token; user:
  the load effect (it creates one per run); rejected: the route id as identity (two visits to "new" and a tenant change
  keep the same id — review-1); rejected: `useRef` (a counter needs no per-instance state; the token must only differ
  between runs).
- `CategoryForm` (type) — named because `edit` and `setField` take it; before, the shape was inferred.
- Test-only: the hook store of `CategoryEditor.test.ts` (`useState` / `useEffect` replacement, `render`, `settle`, finders)
  and the editor-document model (`h.docs`, `shown`, `type`).
- `createCategoryBody` (`tool-shapes.ts:49`) — the `POST /categories` body; user: `create_category` (1); justification:
  test seam (`index.ts` starts the server on import, the file's documented reason); rejected: the inline payload.
- Test-only: fixtures `CC1`, `CC1_TWIN`; contract helpers `cc1Page`, `titleBlockEnd`, `cc1Section`, `cc1Resolved`.

## 8. Width rule, size limit, refresh mechanism

- **Width.** `RenderBlocks` gets no `contentMaxWidth` / `siteMaxWidth`, so it adds no per-block wrapper. Each block takes
  the width of the category page's own container (`<main>`: `header.contentMaxWidth`, default `max-w-6xl`, `px-6`),
  aligned with the title and the grid. Why: the category page already has one container for the title, the filters
  and the grid; the content belongs to that column. A content-width wrapper (`max-w-4xl mx-auto`) inside it would centre
  the text in a narrower column than the left-aligned title, with double side padding; leaving the container (to allow
  full-bleed blocks) would change the `<main>` of every category page. Effect: a "full" block (hero, CTA) shows as a
  band inside the container, not edge to edge.
- **Size.** The content route has no size rule of its own (`z.array(z.any())`); the limit is DynamoDB's 400 KB per
  item (the whole category item: `blocks` plus the other attributes and their names). A larger body fails at the Put
  and the route answers 500 with DynamoDB's message, as the content route does. No new rule.
- **Refresh.** `PUT /categories/{id}` → `revalidateTenantPaths(tenantId, "category", [new slug, old slug])`
  (`update.ts`), the same call for any field: the category page's stored render is purged and the CDN path invalidated
  (the fast lane), and the bulk `/*` lane is armed (CACHE-10). A description change refreshes by this call today, so
  nothing new was added. `?page=2` and filter states are dynamic renders (not cached).

## 9. Findings

1. **F-1 — a partial category update resets three fields** (pre-existing). zod 4 applies `.default()` inside
   `.partial()`: `PUT /categories/{id}` with `{ "name": "X" }` writes `parentId: null`, `sortOrder: 0`,
   `status: "active"` over the stored values (EXECUTED: `{"name":"X","parentId":null,"sortOrder":0,"status":"active"}`).
   The admin sends the full form, so it is not hit there; any partial caller is. `blocks` has no default, so it is safe.
   Proposed: remove the defaults in the update schema (`.partial()` over a schema without them). Not done: outside rule 6.
2. **F-2 — category routes answer 500 for a client error.** `create.ts` / `update.ts` call `.parse()` inside the `try`;
   a refused body answers 500 + the zod message. The content routes answer 400 "Validation failed" (BACKEND-CONTRACT-1
   D1). Kept: changing the status changes the answer of every refused category body.
3. **F-3 — MCP `create_category` could not create a category** (pre-existing): it sent `title`, the route requires
   `name`. Fixed in the body builder (§ 5). Not fixed: `list_categories` prints `c.title`, which the list projection
   does not return — every line says "undefined". Proposed: print `c.name`.
4. **F-4 — `DELETE /categories/{id}` checks one category for children.** `Limit: 1` with a `FilterExpression`: DynamoDB
   applies the filter after the limit, so only the first `CATEGORY#` item is examined; a parent whose child is not the
   first category is deleted. Pre-existing; not fixed.
5. **F-5 — WooCommerce does not match admin-created categories.** It looks only at `CATEGORY#<slug>`; an admin category
   (`CATEGORY#<uuid>`) with the same slug gets a twin with the same slug (two items on one `GSI_Slug` key). The page then
   shows whichever item the index returns first — possibly the twin without the content. The content is not lost, but it
   can be hidden. Pre-existing for every field. Proposed: match by slug as the glam import does (`lookupCategory`).
6. **F-6 — an emptied editor stores an empty paragraph.** Tiptap's empty document is `[{"type":"paragraph"}]`; saving it
   stores that list, and the page shows an empty content section (an empty paragraph, a small gap). The same holds on
   content pages. Proposed: on save, a list of empty paragraphs only → `[]`.
7. **F-7 — the shared block rule accepts `[null]`.** `z.array(z.any())`; `prepareBlocks` and `RenderBlocks` read
   `block.type`, so a stored `[null]` throws during the render (INFERRED from the code) — on content pages and now on
   category pages alike. Not changed: the slice ratifies the content rule.
8. **F-8 — the serving README lacked the `hc1-*` rows** (HEADER-COLOURS-1). Not added (not this slice's rows).
9. **F-9 — `GET /public/categories/{slug}` returns the whole category**, `blocks` included, to the `categoryShowcase`
   browser fallback. One category per answer, so outside rule 5; a heavier answer when the content is large.
10. **F-10 — twin comparisons on the serving build are timing-sensitive** in two ways (EXECUTED): Next numbers payload
    rows in the order its async work ends (equal twins carried the metadata icon row as `1f` and `2a`), and a dynamic
    render streams its metadata tags into `<head>` or after it. The `cc1-*` rows compare payloads with `maskBody` +
    `resolveFlight` and dynamic pages by `<main>`. The `hc1-*` rows compare sorted payload rows of cacheable pages and pass
    today, but rely on equal row numbering.
11. **F-11 (process deviation).** Two early backend runs used `npx vitest run <file>`, which reads the DEFAULT config: its
    `test/setup.ts` loads `.env.test` into the test process. `setup.ts` makes no request, and every I/O module the tested
    handlers use (`db.js`, `events.js`, `revalidate.js`) was mocked; no value was printed. All later runs used
    `npm run test:unit` / `--config vitest.unit.config.ts`.
12. **F-12.** Product lookups on `GSI_Slug` (`getProductBySlug`, `products/public-get.ts`, the WooCommerce product
    lookup) also read a category with the same slug and discard it — now possibly a large item (read units only).

## 10. Allocation additions

None. Every changed path is in the packet's § 4 list (`git status --porcelain`, EXECUTED).

## 11. Gates (each run bare; exit code printed by `echo $?`; EXECUTED on the final tree)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run build` (root) | 0 | |
| 2 | `npm run typecheck` (root) | 0 | |
| 3 | `cd packages/shared && npm test` | 0 | 315 / 315 |
| 4 | `cd backend && npm run test:unit` | 0 | 1350 / 1350 (+1 skipped) |
| 5 | `cd renderer && npm test` | 0 | 482 / 482 |
| 6 | `cd renderer && npm run test:serving` | 0 | 113 / 113, three runs in a row; `git status --porcelain -- renderer/test/serving-contract`: only `README.md`, `contract.test.mjs`, `fixtures.mjs` modified — no `before/`, `after/`, `baseline/` or `expected*` file |
| 7 | `cd admin && npm run test:unit` | 0 | 283 / 283 |
| 8 | `cd packages/plugins && npm test` | 0 | 204 / 204 |
| 9 | `cd tools/mcp-server && npm test` | 0 | 17 / 17 (route coverage green; `routes.json` unchanged) |
| 10 | `git diff --check` | 0 | the new untracked files checked for trailing white space separately: none |

Controls (EXECUTED, each restored): schema with the `[]` default → 2 backend rows fail; no page loop → 2 list rows fail;
no WooCommerce condition → the race row fails; plain `{titleBlock}{pageContent}` → 13 renderer unit rows and 3 serving
rows fail; no `prepareBlocks` call on the category page → 3 renderer unit rows fail.
Revision 1: the review-0 `CategoryEditor.tsx` (a copy) under the new admin test → 7 of 12 rows fail.
Revision 2: the revision-1 `CategoryEditor.tsx` (a copy) under the extended admin test → 5 of 18 rows fail.

## 12. What the owner does, and what a visitor sees (a producer page)

**Owner:** Admin → Categories → open the producer's category (for example "BOEN") → card **Page content** (under Basic
Information; help line "Shown on the category page after the title and before the product list.") → in the block
editor, type a heading (toolbar heading button) and insert a picture (the image block: upload or pick from the media
library) → **Save**. The save purges the category page (§ 8); the visitor sees the change on the next request after the
purge.

**Visitor, page 1** (`/category/boen`): breadcrumb; the `<h1>` "BOEN", the plain-text description (if any), the product
count; then the heading and the picture, in the page's column (the width of the title and the grid); then the filters
(catalog site) and the first 24 products; the pager.

**Visitor, page 2** (`?page=2`) and any filter state (`?f=…`): the same title block, the same heading and picture, then
the next products (or the filtered ones). The content is part of every page of the category.

## 13. What could not be determined

- The admin block editor inside the category editor in a real browser (no DOM in the admin tests; NOT RUN). The admin
  tests run the real component on a hook store that copies React's rules for `useState` / `useEffect` (slots by call
  order, effects after a render when their deps change, cleanup first, a re-render after an effect sets state); they
  do not run React's scheduler. The editor's document is a model of `BlockEditor` (reads `initialContent` once per key),
  not Tiptap itself. `edit` is safe whether or not Tiptap keeps the first `onChange` (not verified which).
- The look of each block type inside the category container (only the server HTML was checked; no browser run).
- Staging (operator).

## 14. Revisions 1 and 2 (review-0, review-1)

### Revision 1 — review-0 (verdict revise)

Review-0 found two admin defects (rule 4): (1) an image upload that ends after a block edit wrote an older copy of the
form back (`setForm({ ...form, imageLink })`), so Save sent the old blocks; (2) the editor could mount for one category
with another category's blocks, and an obsolete load answer could replace the current form. It also asked for tests that
run the real callbacks.

**Class of defect.** A write to the editor state from an older snapshot: a handler that holds a copy of the form from an
older render, or an answer that belongs to an older request.

**Rule (revision-1 tree; items 1 and 2 are replaced by revision 2 below).**
1. The form and the category it belongs to are ONE state, `editing = { id, form }`. The form, the block editor (key =
   `editing.id`) and Save render only when `editing.id` is the route's `id`; otherwise a spinner.
2. Every change goes through `edit(forId, change)`: a functional update applied to the current form, and only while that
   form still belongs to `forId`, the category the action started for. No handler writes a copy of `form` it holds.
3. The load effect marks its requests obsolete in its cleanup (route `id` or tenant changed); an obsolete answer —
   data, parent list or failure — changes nothing.

Effects outside the two findings, from the same rule: switching the tenant resets the form of a new category (before,
the form of one site could be saved into the other); the parent list of an older request is dropped; an older load
failure no longer alerts and leaves the page. (Revision 1 also claimed "a new category's form is shown on the first
commit"; revision 2 withdraws it — see below.)

**Tests.** `CategoryEditor.test.ts` now runs the real component and its callbacks (hook store; mocked router, tenant,
`apiRequest` and `uploadFile` as deferred promises, `BlockEditor` as a marker) and captures the POST / PUT bodies — 12
rows (§ 6). Control (EXECUTED): against the reviewed component, 7 of the 12 fail, among them both review scenarios
("edited blocks retained: false" of the review reproduces as the upload row).

### Revision 2 — review-1 (verdict revise)

Review-1 confirmed both review-0 findings fixed and found what the revision-1 rule missed. With real React and an editor
that reads its document once: (A) when the tenant resolves (null → t1, which happens on the admin's first load) the
new-category form was reset but the editor kept its key `"new"`, so it showed the pre-tenant draft while Save sent `[]`;
(B) an upload started on one visit to `"new"` entered the next visit's draft (`imageLink: …/FIRST-DRAFT.jpg`), because
both had the id `"new"`.

**Class of defect.** The identity of an editing session was the route label (`id`). A label is not a session: two
visits to `"new"` and a tenant change keep the same label. Revision 1's guarantee "applied only while the form still
belongs to forId" was therefore false for those cases; the corrected guarantee follows.

**Rule (replaces items 1 and 2 above; `CategoryEditor.tsx:46-123`).**
1. Every run of the load effect (route `id` × tenant) starts a new session with its own token (`lastEditingSession`);
   a new draft is a session too. The state is ONE value `{ session, id, tenantId, form }`.
2. The form, the block editor and Save render only when the session is for the route's `id` AND the current tenant
   (`ready`). No form exists before the tenant is known (a spinner, as for a category that is still loading).
3. The block editor is keyed by the session, so every session mounts a new editor on that session's blocks: the shown
   document and the form's `blocks` start equal in every session.
4. Every change goes through `edit(forSession, change)`, applied only while the form is still that session's — an upload,
   or an unmounted editor's late `onChange`, from an older session changes nothing.
5. The parent list is emptied when a session starts and filled only by that session's answer (`isCurrent`, item 3 above,
   unchanged); under a new tenant, no option of the old tenant is shown.

Behaviour change: a NEW category's form now appears after the tenant is known and the effect has run (one spinner frame
on a normal visit), not on the first render. A draft typed before the tenant resolved cannot exist any more.

**Tests.** The harness now models the editor's document as `BlockEditor` keeps it and asserts on EVERY Save that the saved
`blocks` equal the shown document; the tenant is controllable. Six rows were added (§ 6). Control (EXECUTED): against the
revision-1 component, 5 of the 18 rows fail (initial tenant resolution, tenant change on a draft, tenant change on a
category with its parent options, `"new"` → c1 → `"new"` with an upload pending, an old editor's late `onChange`). The
sixth new row (late t1 answers while pending) passes on revision 1 too — it guards item 5.

## 15. Operator closeout


Operator, 2026-11-15. Review-2 approved (reviewer `gpt-6.1-sol`, builder `claude-opus-5-5`, three cycles; reviews 0
and 1 found defects in the admin editor's session handling, all corrected).

**Gates (operator run on the approved tree).** build 0, typecheck 0, shared 0, plugins 0, renderer 0, serving 0, admin
unit 0, backend unit 0, mcp 0, `git diff --check` 0. Oracles: no change under `infra/` or any `package.json`; every
changed path is in the allocation; no existing capture or expectation file changed; no trailing whitespace in the
new files.

**Staging.** `cdk diff`: code and asset hashes only; no resource added or removed, no permission change. Deployed
to `AmodxStack-staging`. Evidence on tenant `glam-staging`, category `alpod` (made by the glam import), by script:

| Check | Result |
|---|---|
| `PUT /categories/alpod` with `blocks: "not an array"` | refused, nothing written. The answer is HTTP 500 with the schema message (finding F-2: the category routes answer every schema refusal with 500). |
| `PUT` with a heading block and a paragraph block | 200; `GET /categories/alpod` returns them; name and slug unchanged |
| `GET /categories` (30 categories) | no item carries `blocks` |
| Category page, page 1 | heading and paragraph after the `<h1>` and before the listing (positions 8899 < 9164 < 9239 < 9331); screenshot taken |
| Category page, `?page=2` | shows the content too |
| Re-import of sheet `alpod/sil` | 200; the category's `blocks` are kept |
| `PUT` with `blocks: []` | 200; the page shows no content again |

State left on staging: `alpod` holds `blocks: []`; the sheet `alpod/sil` was imported again (drafts).

Not checked: the admin "Page content" editor in a browser (the reviewer's probes used a stand-in for the editor);
a block that needs the preparation pass on staging (the serving-contract row binds it); a category with products
and filters on staging (`glam-staging` products are drafts, so the listing was empty).

Follow-up recorded, not done: F-2 — category create and update answer a schema refusal with 500; it should be 400.
