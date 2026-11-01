# CAT-ADMIN-1 — the admin of a catalog site, designed from the start (DESIGN, for ratification)

Status: **RATIFIED 2026-11-01** (human: "A for both, commit and launch cat-admin-1"; CA-D1 = A, CA-D2 = A; § 10). Every
file:line claim below was read in the tree at `eba5e18`. § 7 is the slicing; `cat-admin-1` launched the same day.

## 1. The human's direction (2026-11-01, quoted)

> "it feels like the catalog feature was just snapped onto whatever agents found in the admin instead of providing a
> clear UX and logic for it"

> "we need to think from the start, and whether we can enable/disable the catalog feature or it's just an import
> feature that just generates pages and whether commerce can be turned on later and what that changes in the
> interface. I mean at least for the commerce we have entire admin sections and settings - where are those for
> catalog? how would catalog and commerce coexist? I think they can't so maybe the commerce section becomes the
> catalog section?"

Rulings, same day: **(1)** the mode stays fixed at creation (CM-D11 holds); **(2)** one sidebar group, named by the
site kind; **(3)** Digital Products (Paddle) is its own mode of operation, unrelated to the kind — it stays
available on a catalog site, on a different level; **(4)** the pricelist import gets its own page.

## 2. Why the admin feels snapped on (the cause, in the record)

`docs/slices/catalog-mode-1.md` § 3.2 defines the catalog mode by a sweep: `grep -rn "price\|salePrice\|availability\|Buy"`
over the admin and the renderer, every hit a row, each row SUPPRESSED / CHANGED / UNAFFECTED. That method proves
"no price surface is left" by construction — the right proof for the storage invariant. It cannot produce an admin:
nothing in it asks what a catalog operator does on a Monday. The six slices that followed (`cat-mode-1`,
`cat-import-1`, `cat-interest-1`, `cat-images-1`, `cat-image-gate-1`, `cat-import-profile-1a/b/c`, `cat-facets-1`,
`cat-slug-unique-1`) each mounted its control where the shop's control was (`Products.tsx:361` mounts the import
inside the WooCommerce "Import CSV" panel; `Sidebar.tsx:87` adds "Liste de interes" under ENGAGEMENT). The plan's
own finding F-5 (`catalog-mode-1.md` § 8.4, lines 1543-1545: editor blocks and autolink for catalogs) was never
scheduled. The defect is in the packeting policy (slices cut along mechanisms, verified by shop byte-identity), not
in any build.

## 3. What a catalog site is (the facts the design stands on)

| Fact | Where (OBSERVED) |
|---|---|
| A catalog stores **no** monetary field on any product; the backend refuses the write (400). A non-catalog site stores a price on every product. | `backend/src/lib/catalog-product.ts:57` `checkProductWrite`; `products/create.ts:55`, `update.ts:63` |
| `catalogMode` and `commerceEnabled` both true is a **400**; the mode cannot change after creation (400). | `backend/src/tenant/settings.ts:226-231` |
| The mode is chosen only in `POST /tenants` (`catalogMode: body.catalogMode === true`) — the "Create New Site" dialog and the MCP tool `create_tenant`. | `backend/src/tenant/create.ts:48`; `admin/src/components/layout/Sidebar.tsx:120,178-187`; `tools/mcp-server/src/tool-shapes.ts:14` |
| A catalog's visitor features: product, category, shop and search pages without price, stock or buying; the sitemap lists products; the feed is withheld; the **interest list** (`/lista-mea`, cap 50) sends a submission of the reserved system form `interest-list`, notified to `integrations.contactEmail`. | `renderer/src/app/[siteId]/sitemap.xml/route.ts:18`; `docs/slices/cat-interest-1.md` §§ 2.5-2.7; `packages/shared/src/index.ts:99` |
| The **pricelist import** is the catalog's data path: one enriched 12-column CSV per producer sheet, dry run → preview (per-producer profile editor) → confirm; images copied after; products start hidden until an image arrives. Hand edits of an imported product are replaced by the next import of its sheet. | `admin/src/components/GlamPricelistImport.tsx` (header comment), `GlamProfileEditor.tsx`; `backend/src/import/glam/parse.ts:6-9`; `catalog-mode-1.md` § 3.2.2 (ProductEditor row) |
| Filters (facets) are derived from the import profile; they have no admin page and need none. | `docs/slices/cat-facets-1.md` (no admin file; line 548) |
| Hand-made products are allowed on a catalog: the product editor works without the monetary fields; title is the only required field. | `admin/src/pages/ProductEditor.tsx:151-152, 344, 364, 399` |
| **Digital Products** (Paddle) list products with `productType === "digital"` or a `paymentLinkId`; pricing lives in Paddle. Independent of both flags. | `admin/src/pages/DigitalProducts.tsx:40-42, 57` |
| A non-catalog site with `commerceEnabled` false still renders product, category and shop pages **with prices** and no cart ("Products, categories, and Paddle purchases work without this"). | `admin/src/pages/Settings.tsx:678`; `docs/plan-glam-catalog.md` § "What exists today" row 2 |

So there are two **kinds** of site, fixed at creation — **catalog** and **non-catalog** — and two independent
**switches** on a non-catalog site: commerce (cart, checkout, orders) and digital sales (Paddle). A catalog has the
digital-sales switch too (ruling 3) and never the commerce switch. The admin must say this; today nothing does.

## 4. The catalog admin, screen by screen (today → designed)

### 4.1 Create New Site (`Sidebar.tsx:153-200`)

Today: name, domain, one checkbox "Catalog site — no prices, no ordering". Designed: a **radio choice** with one
sentence each, replacing the checkbox (same payload):

- **Shop or content site** — products with prices; commerce (cart, checkout, orders) can be switched on later in Settings.
- **Catalog site** — products without prices or ordering; visitors collect an interest list and send it to you. This choice is fixed for the life of the site.

### 4.2 Sidebar (`Sidebar.tsx:46-100`)

Today: one group "Commerce" for every site (Products, Digital Products, Categories; the seven commerce entries when
enabled); "Liste de interes" under Engagement for a catalog. Designed (ruling 2 and 3):

| Group | Non-catalog site | Catalog site |
|---|---|---|
| CONTENT | unchanged | unchanged |
| **COMMERCE** / **CATALOG** (one group, named by kind) | Products, Categories; with commerce on: Reports, Orders, Customers, Coupons, Reviews, Delivery, Email Templates | Products, Categories, **Pricelist import**, **Interest lists** |
| **DIGITAL SALES** (new group; the "different level") | Digital Products | Digital Products |
| GROWTH, ENGAGEMENT, SYSTEM | unchanged | unchanged ("Liste de interes" leaves Engagement) |

Operator decision CA-L1 (local, reversible): the non-catalog group keeps the name "Commerce" so that povesti's and
every live tenant's admin does not change; "Catalog" is the catalog name. "Interest lists" is English: the admin UI
stays English (human 2026-10-31, `locale-1.md`); the stored form name "Listă de interes" is data and stays.

### 4.3 Pricelist import — its own page (ruling 4)

New route `catalog-import` ("Pricelist import"), catalog sites only (a non-catalog site gets the same 403 the backend
already gives, `backend/src/import/glam-pricelist.ts:176`). The page mounts the existing `GlamPricelistImport`
component unchanged (897 lines, already self-contained: dry run, profile editor, preview, confirm, image copy). It
leaves `Products.tsx:361-366`. The page header states the contract in two sentences: one producer sheet per upload;
the next import of a sheet replaces what it created, hand edits included.

### 4.4 Products (`Products.tsx:196-370`)

Today on a catalog: "Manage physical products for your store.", an "Import CSV" button that opens the WooCommerce
panel (which the backend refuses for a catalog, `woocommerce.ts:236`) with the glam import below it. Designed on a
catalog: subtitle "The products of the catalog. Imported products are replaced by the next import of their sheet;
products you add here stay."; primary action **"Import a pricelist"** (a link to § 4.3), "Add Product" kept; no
WooCommerce button or panel. Non-catalog: unchanged bytes.

### 4.5 Settings (`Settings.tsx`)

| Card | Today on a catalog | Designed |
|---|---|---|
| Commerce (`:676-700`) | the card shows only "This mode was chosen when the site was created and cannot be changed here." | becomes **Catalog**: "A catalog site: products without prices, stock or ordering. Visitors collect an interest list and send it to the contact e-mail below (Notifications)." No control. |
| Digital Sales (Paddle) (`:707`) | shown | shown (ruling 3) |
| Product Search (`:920`, gated `commerceEnabled`) | hidden — search is a catalog feature (F-5) | shown on a catalog too |
| URL Prefixes (`:1360-1400`) | product, category, **cart, checkout**, shop, **account**, search; no input for the interest list although the schema has `urlPrefixes.interest` (`index.ts:99,111`) — **finding F-CA-1**: a catalog cannot change `/lista-mea` | catalog: product, category, shop, search, **interest list**; non-catalog: unchanged |
| Commerce Bar, Payment Methods, Bank Transfer, Order Celebration (`commerceEnabled` gates) | hidden | hidden (unchanged) |

### 4.6 WP Migration (`Migration.tsx:190-300`)

Today: three steps on every site; step 2 (products → `/import/woocommerce`) accepts a file on a catalog and fails
with the 403. Designed on a catalog: two steps (Media, Pages) and one sentence under the title: "Products of a
catalog come from the pricelist import." Non-catalog: unchanged.

### 4.7 Page editor (F-5)

- `AdminLayout.tsx:45` loads product and category autolinks only under `commerceEnabled`: a catalog's editors cannot
  link a product. Designed: `commerceEnabled || catalogMode`.
- `Toolbar.tsx:22` offers a plugin with `commerce: true` only under `commerceEnabled`. The category showcase block
  already renders a catalog correctly (`CategoryShowcaseRender.tsx:19-24,77`: no price, no stock) but a catalog
  author cannot insert it. The reviews carousel must stay hidden (a catalog has no reviews). Designed: the plugin
  definition says where a block is offered — `offeredOn: ("commerce" | "catalog")[]` replaces the boolean `commerce`
  (`packages/plugins/src/types.ts:13-14`; two declarations, `category-showcase/index.ts:14` → both,
  `reviews-carousel/index.ts:14` → commerce). Abstraction line: a two-value list on the plugin definition — users:
  the two plugins and `Toolbar.tsx`; axis: the site kinds a block applies to (fixed set, two members); rejected: a
  second boolean `catalog?: boolean` (two flags with an unstated relation).

### 4.8 Interest lists (`FormSubmissions.tsx:117-118`)

The page already renders the items with product links. Designed: title "Interest lists" when `id === INTEREST_FORM_ID`
(today "Listă de interes - Submissions"); reached from the CATALOG group. Nothing else.

## 5. What does not change

No renderer file, no backend route, no shared schema, no infra, no MCP tool, no stored data. The mode rules of
`catalog-mode-1.md` (CM-D1, CM-D6, CM-D8, CM-D11) are untouched. The shop byte-identity suite (`cm1-identity-*`)
and the locale `before/` captures keep passing unchanged; the only package outside `admin/` is `packages/plugins`
(§ 4.7, a definition field read by the admin only. EXECUTED: `git grep -n "getPluginList\|p\.commerce\|commerce?: boolean"
-- renderer/src admin/src packages/plugins/src tools/mcp-server/src` finds the declaration `packages/plugins/src/types.ts:14`,
the projection `packages/plugins/src/admin.ts:53` and the one reader `admin/src/components/editor/Toolbar.tsx:22`; no
renderer file. `cat-admin-2` changes exactly those three plus the two plugin declarations.)

## 6. Decisions

- **CA-D1 — the digital-sales group.** PROBLEM: ruling 3 says Paddle is its own mode on a different level; the
  sidebar has to show that. OPTIONS: **A** a group "Digital sales" with the one entry, on every site kind (REWARD:
  the structure says what the human said; RISK: a one-entry group looks thin). **B** keep Digital Products inside
  the kind group (REWARD: no new group; RISK: says Paddle is part of the shop or of the catalog, which it is not).
  RECOMMENDED: A.
- **CA-D2 — the interest-list prefix input (F-CA-1).** PROBLEM: the address exists and is unchangeable from the admin.
  OPTIONS: **A** add the input to URL Prefixes on catalog sites (REWARD: parity with the other prefixes; RISK: the
  same "existing links stop working" caveat the card already states). **B** leave it fixed (REWARD: nothing to
  build; RISK: a catalog that wants `/my-list` cannot have it). RECOMMENDED: A.
- **CA-L1** (operator, local): group names "Commerce" / "Catalog" (§ 4.2). **CA-L2** (operator, local): the route
  name `catalog-import`, the page title "Pricelist import".

## 7. Slicing (after ratification)

| Slice | Scope | Allocation | Oracles |
|---|---|---|---|
| `cat-admin-1` | §§ 4.1–4.6, 4.8 | `admin/src/components/layout/Sidebar.tsx` (+ test), `admin/src/App.tsx` (one route), `admin/src/pages/CatalogImport.tsx` (new), `admin/src/pages/Products.tsx`, `admin/src/pages/Settings.tsx` (+ test), `admin/src/pages/Migration.tsx`, `admin/src/pages/FormSubmissions.tsx` (+ test), `admin/ARCHITECTURE.md`, this record | the ten common gates of `locale-1.md` § 10; admin unit: the sidebar of each kind (catalog: CATALOG group exactly the four entries, no Liste de interes; non-catalog: unchanged list), the Settings cards per kind, the submissions title; `git diff --stat -- renderer backend packages infra tools` prints nothing; serving suite 6/6 |
| `cat-admin-2` | § 4.7 | `packages/plugins/src/types.ts`, `packages/plugins/src/admin.ts`, `category-showcase/index.ts`, `reviews-carousel/index.ts`, `admin/src/components/editor/Toolbar.tsx`, `admin/src/components/layout/AdminLayout.tsx`, tests, `packages/plugins/ARCHITECTURE.md` | plugins + admin unit; `git grep -n "commerce: true" -- packages/plugins/src` prints nothing (exit 1); a catalog toolbar lists the showcase and not the carousel; `git diff --stat -- renderer backend infra` prints nothing; serving suite |

Order: `cat-admin-1` → `cat-admin-2` → `locale-reviews-date-1` → `locale-1e` (the two staged locale packets).

## 8. Non-scope (named)

A conversion between kinds (`MODE-MIGRATION-1`, offline; ruling 1). The interest list on showcase cards
(`CAT-INTEREST-SHOWCASE-1`). A service-key read of interest lists (`CAT-INTEREST-READ-1`). A dashboard or home for a
catalog (none exists for any kind: "Pages" is the home). Any visitor-facing change.

## 9. References

`docs/plan-glam-catalog.md`; `docs/slices/catalog-mode-1.md` §§ 3.1, 3.2, 8.4 (F-5), 8.8 (CM-D11);
`docs/slices/cat-interest-1.md`; `docs/slices/locale-1.md` § 7.1 (admin stays English).

## 10. Ratification (2026-11-01)

Human, verbatim: "A for both, commit and launch cat-admin-1". CA-D1 = A (a "Digital sales" group with Digital
Products, on every site kind). CA-D2 = A (the interest-list prefix input on catalog sites). CA-L1 and CA-L2 stand as
operator decisions, reversible. Order confirmed: `cat-admin-1` → `cat-admin-2` → `locale-reviews-date-1` → `locale-1e`.
