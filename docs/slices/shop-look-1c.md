# SHOP-LOOK-1C — the category tile grid with link chips (implementation record)

Status: **BUILT** (2026-11-16, builder), uncommitted, awaiting review. Start: `main` at `282e99c`, tree clean. All oracles
of the packet's § 4 pass on the final tree (§ 7): serving contract 119 / 119 (117 existing rows unchanged + 2 new `sl1c-*`
rows). Maturity: the block `categoryGrid` is **PROTOTYPE** until the operator's staging run (Operator closeout, below).

## 1. The requirement

The ratified design `docs/slices/shop-look-1.md`, row `shop-look-1c` of § 9, with § 17 (no change to this slice, § 17.3).
Reference sections built: 4 (tall category tiles), 5 (pill links under the grid), 11 (the section label of this block).
Name correction (operator, `shop-look-1a` closeout): the read the design calls `getCategoriesByIds` is
`getActiveCategoriesByIds` (`renderer/src/lib/dynamo.ts:351`). It is used as it is; no second read was added.

What a visitor sees: a section with an optional small label (eyebrow) and headline, then tall tiles (`aspect-[3/4]`) of the
categories the owner picked, in the picked order — the category photo, its name, its description (two lines at most) and,
when set, a short text at the foot of every tile ("SHOP CATEGORY"). Each tile links to the category page on the tenant's
own category path. Under the grid, optional pill links. One column on a phone, two from 640 px, the block's 2, 3 or 4
columns from 1024 px. The block widths of every block (content, wide, full).

## 2. What changed (file:line on the final tree)

| File | Change | Serves |
|---|---|---|
| `packages/plugins/src/category-grid/schema.ts:10-18` (new) | `CategoryGridSchema`: `eyebrow`, `headline`, `categoryIds` (`max(12)`), `columns` (`2`/`3`/`4`, default `4`), `ctaText`, `chips` (`{ label, href }`, `max(12)`), `blockWidth` — the § 4.2 rows, ordinary defaults (new block, § 4) | § 4.2 |
| `packages/plugins/src/category-grid/index.ts:10-45` (new) | `CategoryGridPlugin`: key `categoryGrid`, label "Category Grid", `offeredOn: ['commerce', 'catalog']`, storage `fetchCategoriesFn`, the seven Tiptap attributes with the schema's defaults, tag `app-category-grid` | § 3.1, SL-D11 |
| `packages/plugins/src/category-grid/CategoryGridRender.tsx:36-40` (new) | `GRID_CLASS`: the § 6.2 grid class per `columns`, complete literals | § 6.2 |
| `CategoryGridRender.tsx:43-45` | `textOf`: a non-blank string, trimmed, else `null` (blank = absent) | § 4 |
| `CategoryGridRender.tsx:47-114` | the render: no `_categories` → nothing (`:49`, SL-D12); the grid class by own key, else `4` (`:60`); nothing at all when there is no tile, eyebrow, headline or chip (`:62`); header, tiles (photo `alt=""` `loading="lazy"`, scrim, name, description, foot text), chips (`:105`) | packet § 1 items 1-3; § 6.2 |
| `packages/plugins/src/category-grid/CategoryGridEditor.tsx` (new) | `MAX_GRID_CATEGORIES` (`:7`), `withPickedId` (`:14`), `withItemMoved` (`:20`), `withoutItem` (`:29`); `CategoryGridEditor` (`:43`): English controls — label above, headline, tile foot text, columns, block width; add a category from the tenant's list, move up / down, remove; the chips (label + link, add, move, remove); the picked list with photo and name is the preview; a missing or not active category is marked "skipped on the site" | packet § 1 item 5 |
| `packages/plugins/src/admin.ts:20`, `:44` | import + REGISTRY entry after `CategoryShowcasePlugin` | packet § 1 item 6 |
| `packages/plugins/src/render.ts:43` | `RENDER_LOADERS.categoryGrid` (lazy `import()` thunk, perf-1) | packet § 1 item 6 |
| `admin/src/components/editor/BlockEditor.tsx:90-105` | one `fetchCategories` (the existing `GET /categories` function, moved out of the showcase branch unchanged) injected into `categoryShowcase` and `categoryGrid` storage | packet § 1 item 5 |
| `renderer/src/components/SitePage.tsx:19`, `:25` | imports `getActiveCategoriesByIds`, `urlPrefixesOf` | § 6.4 |
| `SitePage.tsx:752`, `:821-841` | `prepareBlocks`: the `categoryGrid` branch (§ 5 below) | packet § 1 item 4; § 6.3 rule 3; § 6.4 |
| `packages/plugins/test/categoryGrid.test.ts` (new) | 19 tests (§ 3) | taxonomy |
| `packages/plugins/test/offeredOn.test.ts:11`, `:18`, `:24` | `categoryGrid` declared `["commerce", "catalog"]`; "the two declared blocks" → "the declared blocks" | taxonomy row `offeredOn.test.ts` |
| `packages/plugins/test/renderLoaders.test.ts:46-48` | loader count 20 → 21 (test name changed with it) | taxonomy row `renderLoaders.test.ts` |
| `admin/src/components/editor/Toolbar.test.ts:15-26`, `:36-39` | three kind-bound blocks (`KIND_BOUND`); content site: no grid; catalog site: the grid | taxonomy row "catalog, commerce and content sites" |
| `renderer/test/unit/shop-look-1c-grid.test.ts` (new) | 13 tests of the server pass (§ 3) | taxonomy |
| `renderer/test/serving-contract/fixtures.mjs:898-935`, `:987-988` | `SL1C` (set / blank: copies of the CM1 commerce tenant, five extra categories, page `/sl1c-rooms` with one grid) | § 6.3 |
| `renderer/test/serving-contract/contract.test.mjs:44`, `:3182-3267` | rows `sl1c-grid`, `sl1c-blank-draws-nothing` | § 6.3 |
| `tools/mcp-server/src/index.ts:629-652`, `:948`, `:2650`, `:2664` | `BLOCK_SCHEMAS.categoryGrid` (description, attributes, example); `add_block` type `categoryGrid`; the block list line; one tip | packet § 1 item 6 |
| `docs/block-types.md` | table row; § *Category grid* | packet § 1 item 6 |
| `docs/plugin-architecture.md` | the injection example; § *Server-prepared block data* | packet § 1 item 6 |
| `packages/plugins/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md` | count 20 → 21, table row, § *The `category-grid` block*, test table; the injected category list; the `prepareBlocks` branch and rows `sl1c-*` | docs |

Not changed: `renderer/src/lib/dynamo.ts` (the projection already holds every field the tile needs — § 5), `packages/
shared` (no locale text — § 6), backend, infra, `package.json`. No new dependency. Generated maps (`*_MAP.md`, rmap
output, "do not hand-edit") were not created or edited; they are stale until the next `rmap` run.

## 3. Taxonomy → tests (all EXECUTED, pass)

P = `packages/plugins/test/categoryGrid.test.ts` (renders `RENDER_LOADERS["categoryGrid"]` with `react-dom/server`);
R = `renderer/test/unit/shop-look-1c-grid.test.ts` (the real `SitePage` and the real `getActiveCategoriesByIds`, a spy for
helper calls, a DynamoDB document-client stub that counts `GetCommand`s); S = serving rows.

| Input | Expected | Bound test |
|---|---|---|
| 0 / 1 / 12 picked categories | no tile / one tile / twelve tiles, in the picked order | P "0 categories: …", "1 category: …" (byte for byte), "12 categories: …"; R "0 ids stored: …", "1 id: …", "12 ids: …" |
| a 13th id | refused by the schema; a stored 13th id (the backend does not check blocks) is **not read and not drawn** — the first 12 only | P "defaults; 12 ids accepted, a 13th refused; …"; R "a stored 13th id …: not read and not drawn — the first 12 only"; editor P "withPickedId: … 13th id leaves the list unchanged" |
| a hidden category; an id of no category | skipped; the others keep their order | R "a hidden category and an id of no category are skipped; …", "all ids hidden or missing: …"; S `sl1c-grid` (ids walnut, hidden, oak, missing, ash → tiles walnut, oak, ash) |
| a category without a photo; without a description | no `<img>` (the tile's `bg-muted` shows, the scrim and text stay); no description `<p>` | P "a category without a photo: …", "a category without a description: …"; R "a category without a photo or a description: …"; S `sl1c-grid` (walnut has no photo, ash no description) |
| `columns` 2 / 3 / 4 | `grid grid-cols-1 sm:grid-cols-2 gap-6` / `… lg:grid-cols-3 …` / `… lg:grid-cols-4 …`; absent, unknown or an inherited key → `4`; phone: one column, two from `sm` (§ 6.2) | P "columns 2 / 3 / 4: …"; S `sl1c-grid` (`lg:grid-cols-3`) |
| `ctaText` blank / set | no foot text / the text on each tile (trimmed) | P "ctaText blank → …; set → …"; S `sl1c-grid` |
| `eyebrow`, `headline` blank / set | no element (no header `<div>` when both blank) / the element | P "eyebrow, headline: …"; S `sl1c-grid`, `sl1c-blank-draws-nothing` |
| `chips`: none; items with label and href; an item without a label or an href | no row; the pills in order after the grid; the item skipped | P "chips: …"; S `sl1c-grid` (one stored chip without a label, not drawn) |
| the tile link | the tenant's own category path (`urlPrefixesOf(urlPrefixes).category + "/" + slug`), default and a custom prefix; then `_getUrl` | R "the tile path is the tenant's own category path: the default, and a custom prefix"; P "links pass through the tenant URL helper `_getUrl` …"; S `sl1c-grid` (default) |
| the read | one `getActiveCategoriesByIds` call per block, one `GetCommand` per id, none when no id is stored | R "1 id", "12 ids", "one helper call PER BLOCK: two grids → two calls; a page without the block → no call", "0 ids stored: no helper call, no GetCommand"; the read's own keys and projection: `shop-look-1a-read.test.ts` (unchanged, passes) |
| a page without the block | the same bytes as today | every existing serving row, unchanged (117 / 117; no capture or expectation file changed); R "only the grid's attrs change, by exactly one key …" |
| catalog, commerce and content sites | **offered** on commerce and catalog sites (not on content sites); **drawn** on all three (the renderer has no kind gate; category pages are served on every kind, "Product, category, and shop pages work regardless of commerceEnabled", `SitePage.tsx:364`) | offered: `offeredOn.test.ts`, admin `Toolbar.test.ts`; drawn: R "drawn on every site kind (content, commerce, catalog): …"; S `sl1c-grid` on a commerce copy |
| `renderLoaders.test.ts`, `offeredOn.test.ts` | pass with the new key | both pass (21 loaders; `categoryGrid` declared) |

Also bound: no server data (the admin preview) → nothing (P "no server data …", SL-D12); a grid that resolves to nothing,
with blank options → nothing (P "0 categories: …"; S `sl1c-blank-draws-nothing`); a category page's own blocks get the
same pass (R "on a category page …"); the payload holds only the display fields whatever the read returns (R "the tile
carries only its display fields …"); the Tiptap defaults equal the schema defaults (P); the render imports only `react`
(P "the render file imports only react …"); no palette colour class in the render (P "overlay rule: …").

Coverage gap (stated): the plugins package has no DOM harness, so the editor's `onChange` wiring and its category list
(loaded in `useEffect`, which the server renderer does not run) are read, not exercised. The three list functions they
call are tested directly. `BlockEditor.tsx`'s injection is read, not exercised (no admin DOM harness; precedent).

Teeth check (EXECUTED): nine mutations, each restored afterwards. Render: scrim opacity 75 → 40 (4 tests failed), grid
`lg:` → `md:` (1), blank check without trim (1), `alt=""` → the name (1), the "nothing to draw" return removed (1), the own-key
check removed (1, the `"constructor"` case). Server pass: the 12-id cap removed (1), the no-id guard removed (1), the
field-by-field tile replaced by a spread of the read result (7).

## 4. Byte identity

- **Pages without the block:** no existing page holds a `categoryGrid` block. The server pass adds a key only to a
  `categoryGrid` block (§ 6.3 rule 3), so every other page makes the same reads and gets the same attrs. Every existing
  serving row passed unchanged — among them `cm1-identity-commerce`, `cm1-identity-content`, the `loc1-*`, `loc1e-*`,
  `cq1-*`, `ct1-*`, `bpf1-*`, `hc1-*`, `cf1-*`, `cm1-catalog-*` rows of design § 6.3, and `sl1a-*` and `sl1b-*`.
  `git status` lists no file under `renderer/test/serving-contract/` but `contract.test.mjs` and `fixtures.mjs`.
- **The header bar (`shop-look-1a`):** unchanged. `dynamo.ts` is not edited (its projection already held `description`
  and `imageLink`); the layout receives what it received before. `sl1a-header-footer` and `sl1a-blank-as-absent` pass.
- **New rows:** `sl1c-grid` — the set page's HTML equals its blank twin's after removing exactly one `<section>` (the
  block, built in the test from the fixture data: header, three tiles, two chips); its payload equals the twin's (resolved)
  after one swap of the block's attributes (stored attributes + `_categories`). `sl1c-blank-draws-nothing` — the twin
  draws no section; the block's wide wrapper stays, empty (as for any block whose render returns nothing).
- The stylesheet's content-hash file name changes (new classes; accepted precedent CM1-A1).

## 5. The read as built (design § 6.4)

`prepareBlocks` (`SitePage.tsx:829-841`), for a `categoryGrid` block only:

1. ids = the stored `categoryIds` that are non-blank strings, the first 12 (anything else, or not an array → none).
2. No id → no call, `_categories = []`. Else ONE `getActiveCategoriesByIds(tenantId, ids)` call: one `GetCommand` per id on
   `TENANT#<tenant>` / `CATEGORY#<id>`, projection `id, #n, slug, description, imageLink, #s`; status not `active` or no
   item → skipped; the order of `ids` kept. Cost per block per uncached render: 1 helper call, ≤ 12 `GetCommand`s, no
   pagination. Two grids on a page → two calls. Tenant isolation: the key carries the request tenant
   (`shop-look-1a-read.test.ts` "tenant isolation").
3. `_categories` = each category built field by field: `{ id, name, description?, imageLink?, path }`, `path` =
   `urlPrefixesOf(config.urlPrefixes).category + "/" + slug`. The slug and status are not sent.

What the header bar receives: unchanged (`{ label, links: [{ label: name, href }] }`, `layout.tsx:207-213`).

## 6. Overlay rule (tile text over a photo)

Every tile text (name, description, foot text) sits inside one panel at the bottom of the tile: background
`bg-foreground/75` (the theme's text colour at 75 % opacity), text `text-background` (the theme's background colour).
Above the panel a fade `h-16 bg-gradient-to-t from-foreground/75 to-transparent` softens the edge; it carries no text. No
colour literal: both colours are theme tokens (Critical Rule 6), so a dark theme inverts the pair (a light scrim, dark
text).

Why this rule: the photo is unknown, so the text must not depend on it. The worst photo pixel is one of the text's own
colour. Calculated WCAG contrast (EXECUTED, a short script; sRGB alpha blend, then the WCAG 2.1 luminance formula):

| Theme | Text | Worst photo | Ratio at 75 % | (at 60 % / 70 % / 80 %) |
|---|---|---|---|---|
| default (text #020817, background #ffffff) | #ffffff | white | **9.5 : 1** | 5.4 / 7.8 / 11.5 |
| dark example (text #f8fafc, background #020817) | #020817 | black | **10.4 : 1** | 6.8 / 9.1 / 11.9 |

Both are above 7 : 1 (WCAG AAA, normal text). 75 % was chosen as the lowest step that keeps a margin above 7 : 1 on both.
Limit: a tenant theme whose own text/background pair has low contrast gives a lower ratio (the scrim is that pair, mixed);
such a theme has the same problem on every page. Proved by test: every tile text is inside the scrim panel (P "overlay
rule: …"; S `sl1c-grid` byte for byte). The visual check on light and dark photos is the operator's (closeout).

## 7. Gates (each run bare; exit code by `echo $?`; EXECUTED on the final tree, after a fresh root build)

| Command (from the repository root unless named) | Expected | Actual |
|---|---|---|
| `npm run build; echo $?` | 0 | 0 |
| `npm run typecheck; echo $?` | 0 | 0 |
| `cd packages/plugins && npm test; echo $?` | 0 | 0 — 9 files, 266 tests (19 in `categoryGrid.test.ts`) |
| `cd packages/shared && npm test; echo $?` | 0 | 0 — 22 files, 385 tests |
| `cd renderer && npm test; echo $?` | 0 | 0 — 42 files, 591 tests (13 in `shop-look-1c-grid.test.ts`) |
| `cd renderer && npm run test:serving; echo $?` | 0, no existing capture or expectation changed | 0 — 119 / 119 (117 existing + `sl1c-grid`, `sl1c-blank-draws-nothing`) |
| `cd admin && npm run test:unit; echo $?` | 0 | 0 — 13 files, 291 tests |
| `cd backend && npm run test:unit; echo $?` | 0 | 0 — 55 files (1 skipped), 1414 tests (1 skipped) |
| `cd tools/mcp-server && npm test; echo $?` | 0 | 0 — route coverage + 17 tool-shape tests |
| `git diff --check; echo $?` | 0 | 0 (the three untracked new paths checked separately for trailing whitespace: no line) |

Not run: `cd backend && npm test` (packet: never). MCP `routes.json`: no backend route changed, not refreshed.

## 8. Decisions and abstractions (one line each)

- **D-1C-1 nothing resolves (design silent; the packet's default):** `_categories` empty → the eyebrow, the headline and
  the chips only; with none of those → nothing (no empty `<section>`). No server data at all → nothing (SL-D12).
- **D-1C-2 the 13th id:** the server pass reads the first 12 non-blank string ids; a stored 13th is not read and not
  drawn — this keeps the § 6.4 bound (≤ 12 `GetCommand`s per block) true for stored data the backend does not check.
- **D-1C-3 the tile path is computed on the server** (`path` in each tile), not the slug plus a prefix key: the render
  needs no prefix and no meta-tag fallback (the showcase's `_categoryPrefix` path), one key crosses instead of two.
- **D-1C-4 the payload is built field by field** (found by `sl1c-grid`: the serving stub ignores projections,
  `ddb-stub.mjs:253`, and a spread carried `PK`, `SK`, `TenantSlug`, … into the payload). Class: data that a client
  component receives shaped by a read's projection. Rule applied: the server pass names every field it sends.
- **D-1C-5 image `alt=""`:** the photo is decorative; the category name is the tile's text, so the link's name is not
  read twice. The showcase uses the product title as `alt` (not changed).
- **D-1C-6 the eyebrow:** the hero's page eyebrow pill (`rounded-full border … border-primary/30 text-primary`), so the
  labels of the reference look the same on every block (design § 3 row 11).
- **D-1C-7 chips beyond 12:** the schema refuses a 13th chip; a stored 13th chip (no backend check) is drawn — no read
  cost depends on it, so no cap was added.
- **D-1C-8 duplicates:** the editor never adds an id twice (`withPickedId`); a stored duplicate id (e.g. by MCP) is read
  twice and drawn twice (React logs a duplicate-key warning in development). Not de-duplicated: no current writer
  produces it.
- `withPickedId`, `withItemMoved`, `withoutItem` (exported from `CategoryGridEditor.tsx`) — what: the three list edits of
  the editor; users: the category list and the chip list (`withItemMoved`, `withoutItem` on both) and the test; axis: none
  (one rule per edit); rejected: inline array code in each `onClick` (no test seam without a DOM harness — the
  `storedOption` precedent of `shop-look-1b`).
- `fetchCategories` (`BlockEditor.tsx:91`) — what: the existing category-list function, hoisted; users: the
  `categoryShowcase` and `categoryGrid` storages; axis: none; rejected: a second copy of the same function.
- No other abstraction. `GRID_CLASS` and `textOf` are file-local constants/helpers of the render.

## 9. Findings

- **F-1C-STUB-PROJECTION** (observed, not changed): the serving stub returns whole items for `GetItem` and `Query`
  (`ddb-stub.mjs:253`, by its own design note). A row that asserts a payload therefore sees fields DynamoDB would not
  return. Closed for this block by D-1C-4; worth knowing for the next payload row.
- **F-SHOP-BLOCK-DOC** (pre-existing, partly open): the header line of `docs/block-types.md` ("18 custom plugins"), the
  MCP comment and `get_block_schemas` text ("18 custom blocks", "18 plugins") are stale (21 plugins now); the MCP
  `add_block` list still omits `videoHero` and `markdown`. Not changed: outside this slice's block.
- **F-SHOP-HIDDEN-CATEGORY-PAGE** (non-scope, unchanged): a hidden category is left out of the grid, but its page stays
  reachable by URL.
- Generated maps (`*_MAP.md`): not created for `src/category-grid/`; stale for the edited files until the next `rmap` run.

## 10. Design lines that moved

Read on `282e99c`. Held: `admin.ts:23` (REGISTRY), `render.ts:23` (`RENDER_LOADERS`), `category-showcase/index.ts:14`
(`offeredOn`), `BlockEditor.tsx:92` (the showcase's category list), `RenderBlocks.tsx:120` (unknown type → `null`), `:140`
(`_getUrl`), `:142` (`strings`), `dynamo.ts:329` (`getAllCategories` projection without `description`),
`backend/src/categories/create.ts:54` (`SK: CATEGORY#<id>`). Moved: `SitePage.tsx:756` (`prepareBlocks`) → `:772` at
start (`:773` after this slice); `SitePage.tsx:786-789` (the `_catalogMode` precedent) → `:804-811`; `SitePage.tsx:788`
(catalog reduction) → `:810`; `packages/shared/src/index.ts:396` (`blocks: z.array(z.any())`) → `:397`; the MCP `add_block`
list `:891-912` → `:911-924` at start. Renamed: `getCategoriesByIds` → `getActiveCategoriesByIds` (`dynamo.ts:351`).

## Operator closeout

(left empty for the operator: a staging page with six category tiles and chips; hide one category in admin and see it
leave the grid after the purge; screenshots at desktop and 390 px; tile text readable on a light photo and on a dark photo,
in the light theme and, if available, the dark theme.)

**Review.** One build, one review, verdict approved. Builder `claude-opus-5-5`; reviewer `claude-sonnet-5-5`
(fallback; the Codex reviewer was out). Same provider family; not cross-vendor independence. Left as a finding: a
category id stored twice (possible through the MCP, not through the editor) draws its tile twice.

**Operator gates (2026-11-16, on the approved tree).** Build, typecheck, shared, plugins, renderer, serving, admin
unit, backend unit, MCP, `git diff --check`: each exit 0. Protected paths, allocation, existing captures, trailing
whitespace: no line.

**Staging (deployed 2026-11-16; diff read first: three renderer functions, two bucket deployments, the admin runtime
config).** Tenant `cm1-commerce`: six probe categories (photos: light cream, near black, tan, pure white, none, dark
brown; one without a description), one published page with the block (3 columns, eyebrow, headline, foot text, three
chips of which one has no label, and one id of no category). Chromium at 1400 px and 390 px.

| Check | Result |
|---|---|
| six tiles in the picked order; the unknown id skipped | pass |
| eyebrow, headline, foot text on each tile, two chips | pass (seen in the screenshot) |
| the chip without a label | not drawn (screenshot: two chips). The script's text search found `/skipped` in the page source: the block's stored attributes travel in the page payload. The script's check was wrong, not the page |
| tile link | the tenant's category path |
| no horizontal page scroll, 1400 px and 390 px | pass; one column on the phone |
| tile text on a light, a white, a dark and a missing photo | readable on each (operator looked at both screenshots): the text sits on the scrim, not on the photo |
| a category set to hidden | left the grid; the other five stayed |

Not checked: the block editor in a browser; 2 and 4 columns on staging (unit-bound). The probe page was archived and
the categories deleted.

Prod deploy: the human's.
