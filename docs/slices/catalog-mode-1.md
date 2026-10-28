# CATALOG-MODE-1 — the presentation-store tenant mode (SPEC slice)

Status: **RATIFIED 2026-10-28 (human; amended the same day on file evidence) — COMMITTED 2026-10-28 (§ 8.18); spec complete (13 build cycles, decision-review 11/11 converged); write closure rests on
SETTINGS-KEYS-1 (2ff85c7) and SETTINGS-KEYS-1B (569202e)**. Previous status line: "COMPLETE 2026-10-28 — awaiting
ratification (decision-review packet)". History: **PROPOSED**
(packet written 2026-10-27 by the glamCRM operator session; see `docs/plan-glam-catalog.md` for the why and the
integration plan). SPEC ONLY — no code changes with this document; the gate proves it. **Amended 2026-10-27 by
the amodx operator** after a code check: CM-D1 ratified (b); new block CM-D6-ORDER-GUARD ratified (A); CM-D5
re-cast on the lead-key evidence; § 3.5 abuse posture corrected to what forms actually do. **Completed
2026-10-28 by the builder** (§ 3.1–3.6 defined, surface table filled from the sweep, evidence added to CM-D2..D5,
CM-D5 given a RECOMMENDED line, CM-D7-IMAGE-ABSENCE added because the schema sweep forced it; record in § 8).
**Cycles 2–4, 2026-10-28** (after review-0, review-1 and review-2 `escalate`): the human ratified CM-D8 = A (every
price door closed inside `cat-mode-1`), CM-D9 = A and CM-D10 = B (an online transition protocol), then CM-D11 =
fixed at creation (the mode never changes online), which supersedes CM-D9 and CM-D10. Records in § 8.6–8.8
(§ 8.6–8.7 are historical).
**Cycles 5–6, 2026-10-28** (after review-3 and review-4 `escalate`): write closure rests on SETTINGS-KEYS-1
(`2ff85c7`) and SETTINGS-KEYS-1B (`569202e`) — the prerequisites that stop `PUT /settings` from letting the request
body name the item it writes, set any index key, or claim another tenant's hostname, and that make the public slug
readers accept only the tenant's own product/category items (records in § 8.9–8.10).
**Cycle 7, 2026-10-28 — ratification** (after review-5 `approved` and the decision-review packet: 11 converged,
0 contested): the human ratified CM-D2 (b), CM-D3 (b) — against the recommendation, with the operator's format
correction — CM-D4 (a), CM-D5 (b) and CM-D7 (a); the operator accepted two refinements within ratified rulings
(CM-D8, CM-D11). Record in § 8.11.
Ratified: CM-D1, CM-D2, CM-D3, CM-D4, CM-D5, CM-D6, CM-D7, CM-D8, CM-D11. Superseded: CM-D9, CM-D10. Accepted
refinements: CM-D8, CM-D11. Open: none.
**Cycle 8 amendments, 2026-10-28** (the human's direction after ratification, § 1 addendum, and the operator's
measurement of the enriched CSVs): CM-D3 and CM-D4 AMENDED — import from the enriched CSV, identity within one import
only, one product per distinct composite with the other rows as its gallery, replace per file; new slice
`cat-facets-1` (§ 3.7). Record in § 8.13. Amended: CM-D3, CM-D4.
**Cycle 10 amendments, 2026-10-28** (after review-8 `escalate`; human ruling on the per-vendor evidence, operator
rulings on C8-1..C8-4): a product is a STYLE and each row a VARIANT (CM-D4, CM-D3 AMENDED again; `format` leaves the
key); a catalog-mode variant presenter in `cat-mode-1`; replace per file under a per-tenant import lock; the
identifier rule for `importSource`; expired shortlist items are reselected, never rebound. Record in § 8.14.
**Cycle 11 corrections, 2026-10-28** (after review-9 `escalate`; operator ruling C10-REPLACE-WRITER-SCOPE = A, bounded
to conditional writes): every writer that can touch a product is conditional on its existence, projections are
written with their product, the lock has an owner, tenant checks come before it; interest items keep each chosen
option; imported products keep one variant group with derived images. Record in § 8.15.
**Cycle 12 — scope freeze, 2026-10-28** (after review-10 `escalate`; human scope ruling): products exact; the importer
reconciles the categories it touched; projection races under concurrent admin edits are the follow-up
`CATPROD-CONSISTENCY-1`; the cycle-11 transactional projection protocol is withdrawn; `importSource` is importer-owned.
Record in § 8.16.
**Cycle 13 corrections, 2026-10-28** (after review-11 `escalate`; operator ruling C12-RECONCILIATION-BOUNDARY = A):
the import guarantee separates the database result from page publication and names the overlapping-edit
qualification; the reconciliation reads completely, writes with acknowledgement and only the category it
reconciles, and answers 503 when it cannot finish. Record in § 8.17.

Evidence labels in this document: **OBSERVED** = read in the file at the cited line on 2026-10-28;
**EXECUTED** = a command was run (§ 8); **INFERRED** = a conclusion from observed code, not run.
All `file:line` citations are OBSERVED unless marked otherwise.

## 1. Human direction (2026-10-27), quoted

"generate a presentation website like those with commerce enabled so it looks like an online
store with images and descriptions but **without the producer codes, without prices and without
any possibility of ordering**, rather just offering some sort of 'pick the items you're
interested in and contact us about them'."

**Addendum — human direction, 2026-10-28 (after ratification), quoted:**
1. "Right now I want to be able to import products into the presentation site directly from the enriched CSV files
   in glamCRM" — pl-tools' `out/<vendor>/enriched/<sheet>.csv` (frozen 12-column layout, index-based, header row
   never used for mapping; one file per producer/collection sheet). Not a glamCRM export, not the raw vendor files.
2. "In the distant future glamCRM will populate the storefront when importing that year's pricelists itself — not
   for now." (`GC-SITE-SYNC-1` and the `catalog:write` scope: future; named, nothing built.)
3. "The storefront should have filters and categories and producers and whatnot for all applicable fields." → the new
   slice `cat-facets-1` (§ 3.7).
4. "It will be disposable — when we update pricelists in glamCRM we'll see how we handle that." → a re-import
   replaces the file's product set; no cross-import identity is kept (§ 3.4).

## 2. Purpose / risk retired

A tenant can today flip `commerceEnabled=false` and get product/category/shop pages with no cart —
but the pages still print a price, a Buy/availability control, JSON-LD `offers`, and the OpenAI
feed publishes `price` for every product; the sitemap drops the products entirely. A catalog tenant
built on today's code would publish fabricated prices ("0 USD") to search engines and AI agents,
which is a trust defect, not a cosmetic one. This spec defines the mode in which none of that can
happen, by construction.

## 3. What the spec must define — and the definitions

Each subsection opens with the requirement as written on 2026-10-27 (quoted), then gives the definition.

### 3.1 The flag

> **The `catalogMode` tenant flag** (name final at ratification): where it lives in the tenant config
> (`packages/shared` TenantConfig), who may set it (TENANT_ADMIN in the admin settings card), and the rule that
> it is **mutually exclusive with `commerceEnabled`** (both true is a validation error, not a precedence rule).

**Name: `catalogMode`.** Kept. It says what the tenant is (a catalog, not a shop) and pairs with
`commerceEnabled`. Rejected alternatives: `presentationMode` (says nothing about products), `hidePrices` (wrong
contract — the mode is "no price exists", not "a price is hidden"; see CM-D1).

**Location.** `TenantConfigSchema` (`packages/shared/src/index.ts:747`), directly after
`commerceEnabled: z.boolean().default(false)` (`:785`): `catalogMode: z.boolean().default(false)`. The default
`false` keeps every existing tenant record valid and unchanged.

**Who sets it, and when (CM-D11 = fixed at creation, ratified 2026-10-28).** The mode is chosen when the tenant is
created and never changes online.

- *Set at creation.* `POST /tenants` is GLOBAL_ADMIN-only (`backend/src/tenant/create.ts:18`, `requireRole(auth, [])`)
  and parses the new tenant with `TenantConfigSchema` (`:50`). The handler builds the record field by field
  (`:34-49`: `id, domain, name, status, plan, theme, integrations, createdAt, ownerId, createdBy`), so a body field
  reaches the record only if it is copied there: `cat-mode-1` adds `catalogMode: body.catalogMode === true`. The
  schema default (`false`) covers every other caller. `commerceEnabled` is not taken from the creation body today
  (it is always `false` at creation), so the two flags cannot both be true at creation.
- *Creation surfaces.* The admin has a tenant-creation form: the "Create New Site" dialog in
  `admin/src/components/layout/Sidebar.tsx:153-177` (handler `:108-125`, payload `{ name, domain }` at `:114`). It
  gains one checkbox, "Catalog site — no prices, no ordering", sent as `catalogMode`. (`admin/src/context/
  TenantContext.tsx` only reads `GET /tenants`, `:36`.) The dialog is visible to every admin user, but the backend
  refuses non-GLOBAL_ADMIN callers. The MCP tool `create_tenant` (`tools/mcp-server/src/index.ts:650-663`,
  `{ name, domain }`) gains `catalog_mode?: boolean`, sent as `catalogMode` — a `cat-mode-1` change.
- *Never changed online.* `PUT /settings` (`backend/src/tenant/settings.ts` `_updateHandler`, `:94-202`;
  TENANT_ADMIN or GLOBAL_ADMIN, `:104`) refuses the change (rule below). Prerequisites: SETTINGS-KEYS-1 and
  SETTINGS-KEYS-1B (`docs/slices/settings-keys-1.md` §§ 2 and 12, commits `2ff85c7` and `569202e`; staging verified,
  prod on the human's word). Before them, an unparsed request body could (review-3 C4-1) choose the item written —
  another tenant's record or a `PRODUCT#` item — through `PK`/`SK`/`id`, and (review-4 C5-1) place the tenant record
  in another tenant's `GSI_Slug` partition through `TenantSlug` + `Type`, where `GET /public/products/{slug}` and
  `GET /public/categories/{slug}` returned it, secrets included; the operator also witnessed a hostname claim through
  `domain`. Since them:
  - the route can set **no key of the table or of any GSI**: `SERVER_OWNED_FIELDS` (`settings.ts:26-29`, eleven
    names: `PK`, `SK`, `id`, `Domain`, `createdAt`, `createdBy`, `Type`, `CreatedAt`, `Status`, `ScheduledFor`,
    `TenantSlug`) are removed from the body before the merge (`:111-112`), and the written item sets `PK: "SYSTEM"`,
    `SK: TENANT#<tenantId>`, `id: tenantId` after the spread (`:177-182`), with `tenantId` the `x-tenant-id` that
    `requireRole` checked (`:104`);
  - the route cannot claim **another tenant's hostname**: a changed `domain` that `GSI_Domain` shows held by another
    tenant record is refused with 409 before the write (`:149-164`);
  - the two public slug readers accept an index hit only from the tenant's own partition and entity prefix
    (`backend/src/products/public-get.ts:28-30`, `backend/src/categories/public-get.ts:29-31`; the renderer's rule,
    `renderer/src/lib/dynamo.ts:241,258`) — this also neutralises a record poisoned before the fix. These two readers
    are the third named exception to the commerce freeze (security, SETTINGS-KEYS-1B).
  So the narrow two-flag parse below sits on a handler whose write target is bound to the checked tenant and which
  can name no index key. Neither prerequisite validates the config content (`settings-keys-1.md` § 8 (c));
  CAT-MODE-1's narrow parse is the first validation on that route. One window stays open and is named, not closed:
  two tenants can both store the same new hostname if their requests overlap or fall inside the `GSI_Domain`
  propagation lag (`settings-keys-1.md` § 12.4); the closing item — a `DOMAIN#<host>` uniqueness record — is
  SETTINGS-KEYS-1B follow-up § 12.7 (a), not built.
- *Changing an existing tenant's mode* is not an online operation. It is the named follow-up `MODE-MIGRATION-1` — an
  offline data migration slice, opened only on a demonstrated need (§ 8.4).

**The write rules — where they run.** Two write paths store a tenant config:

| Write path | Today's validation | Rule |
|---|---|---|
| `backend/src/tenant/settings.ts` `_updateHandler` (`:94-202`) | **no content schema** — `JSON.parse` of the body (`:110`), the eleven key names removed (`:111-112`, SETTINGS-KEYS-1/1B), shallow merge onto the stored item (`:120-140`), hostname-claim refusal (`:149-164`, 1B), `PutCommand` with `PK`/`SK`/`id` set after the spread (`:175-183`); no schema runs on the config content | a NEW narrow parse of exactly `{ commerceEnabled, catalogMode }` on the **merged** object (after `:140`, before `:149`), not on the body. It refuses with **400** (a) a `catalogMode` different from the stored one — "the mode is fixed when the site is created"; (b) `commerceEnabled: true` when `catalogMode` is true — "a catalog site has no cart or checkout". Both sides of the comparison in (a) use the same absent-as-false rule: the stored mode is `current.catalogMode === true`, and the merged mode is the narrow parse's `catalogMode`, whose default is `false`. So an EXISTING tenant record that has no `catalogMode` attribute (every tenant created before CAT-MODE-1) counts as not-catalog on both sides, and an ordinary settings save for it is not refused. A MISSING tenant record is a different case: the read of `current` (`:114-117`) becomes `ConsistentRead: true`, and when it returns no item the handler answers **404** with nothing written instead of defaulting to `{ name: "Unknown" }` (`:119`) (CM-D11 accepted refinement). No query, no transaction, no revert: nothing else is checked |
| `backend/src/tenant/create.ts` (`:50`, `TenantConfigSchema.parse(newTenant)`) | full schema, on a new record | `catalogMode` copied from the body (above); `commerceEnabled` is `false` at creation, so rule (b) cannot fail here |

Shape: a narrow zod schema local to `settings.ts`, `z.object({ commerceEnabled: z.boolean().default(false),
catalogMode: z.boolean().default(false) })` plus the two refusals, compared with `current`. The handler uses the parse
only as a check and then writes `merged` as today, so no other stored field changes.

- *Abstraction line:* none added. The narrow schema has one caller (`settings.ts`), so it stays local; a shared
  `TenantModeSchema` (cycle 1–3 text) is withdrawn — its second caller (`create.ts`) no longer needs the rule.
  Rejected alternative: `.refine` on the whole `TenantConfigSchema` (see the regression class below). Zod is `4.6.7`
  (EXECUTED, `node_modules/zod/package.json`).
- *Named regression class — "a new validator on a path that never validated":* stored tenant configs predate the
  schema (written by the raw merge, now `:175-183`). A full `TenantConfigSchema.parse` of a stored config on the
  settings path can refuse a live tenant's next settings save for a field unrelated to this slice. Rule: on that
  path, parse only the fields this slice owns. `tenant/create.ts:50` already parses the full schema on a NEW
  record, so it is not at risk.

**The invariant and the writers (CM-D1, CM-D8, CM-D11).** A tenant in catalog mode stores no monetary field on any
product (the CM-D1 list, § 4); a tenant not in catalog mode stores a `price` on every product (CM-D1 refinement
"required unless catalogMode"). The invariant keys on `catalogMode` only. Because the mode is fixed at creation, a
writer that reads the mode once can trust it until its write commits — no coordination is needed.

*Every read that enforces the mode is authoritative and fails closed (CM-D11 accepted refinement, 2026-10-28).*
`GetItem` is eventually consistent by default, so a read just after a catalog tenant is created can miss the record;
today `settings.ts:119` turns a miss into `{ name: "Unknown" }` (mode absent = not catalog), which would let a partial
settings save overwrite the real record with one that has no mode, and the same miss in `products/create.ts` would
accept a price. Rule: the mode read uses `ConsistentRead: true` and a missing tenant record answers **404**, nothing
written, in `tenant/settings.ts` `_updateHandler`, `products/create.ts`, `products/update.ts`,
`import/woocommerce.ts` (CM-D8 guard 1), the glam importer (§ 3.4) and the interest handler (§ 3.5). The order
handler already fails closed: it maps a miss to `{}` (`backend/src/orders/create.ts:70-74`) and the CM-D6 guard then
refuses it (no `commerceEnabled`). Named, intended regression: a settings save for a tenant whose record is truly
missing used to create `{ name: "Unknown", … }` and now answers 404 — that record was only ever the symptom of a
defect.

- `backend/src/products/create.ts:40-42` and `backend/src/products/update.ts:39-41` read the tenant config once and
  refuse the monetary fields on a catalog tenant (and a missing `price` on any other tenant). The product write stays
  a plain `Put` (`create.ts:52`, `update.ts:50`), no `ConditionCheck`: the mode cannot change between the read and
  the write. `create.ts` needs `grantReadWriteData` for the read (CM-D1 note).
- `backend/src/import/woocommerce.ts`: the start-of-job refusal (CM-D8 guard 1) is the whole guarantee, for the same
  reason.
- `backend/src/products/bulk-price.ts`: UNAFFECTED. On a catalog tenant no product carries a price, so `:111-112`
  skips every item and nothing is written. Review-2's stale-snapshot counterexample (`:147-164`) needs a mode switch
  between the read and the write; there is none.
- `backend/src/lib/catprod.ts` projections (`:38-46`, written by `BatchWriteCommand` at `:66`) copy the product's
  price only when the product has one — never on a catalog tenant, because no catalog product has one.
- The glam importer (CAT-IMPORT-1) writes no monetary field by type (§ 3.4).

Consequence for consumers: "price present" holds for every non-catalog tenant from creation on (CM-D1 refinement on
every write; no mode change), so no commerce consumer — the OpenAI feed (`renderer/src/app/[siteId]/openai-feed/
route.ts:28`), the price and offer rows of § 3.2, the order handler (`backend/src/orders/create.ts:120`) — needs an
absence rule; their rows stay as they are. Image absence on a catalog tenant is handled by the image readers'
absence rules in § 3.2.

**One predicate.** `isCatalogMode(config)` in `packages/shared` (named in `docs/slices/cat-mode-1.md` § 4) returns
`config.catalogMode === true`. Every render site in § 3.2 uses it; no site re-derives the rule.

**What each existing `commerceEnabled` reader does for a catalog tenant** (the tenant has `commerceEnabled =
false` by the rule above, so every reader that gates on it already turns its commerce surface off):

| Reader (file:line) | Catalog tenant behaviour |
|---|---|
| `packages/shared/src/index.ts:785` | unchanged; `catalogMode` is added after it |
| `renderer/src/lib/dynamo.ts:154` (inside `mapTenant`, `:123-175`) | **must change**: `mapTenant` copies fields one by one into the config the renderer sees; without a new line `catalogMode: item.catalogMode ?? false` the renderer never sees the flag (a name is not its semantics: `getTenantConfig` is a whitelist mapper, not a pass-through) |
| `renderer/src/app/[siteId]/layout.tsx:85,91` | no cart prefix passed to `Providers` — unchanged |
| `renderer/src/app/[siteId]/layout.tsx:158` | `CommerceBar` not rendered — unchanged |
| `renderer/src/app/[siteId]/layout.tsx:183-184` | `Navbar` gets `commerceEnabled=false`; the Contact pill stays (`hideContactButton` false) — unchanged |
| `renderer/src/components/Navbar.tsx:22,144-157,170,233` | no account link, no Sign-in, no `CartWidget` (desktop and mobile) — unchanged; CAT-INTEREST-1 adds its widget under `isCatalogMode` |
| `renderer/src/components/SitePage.tsx:209-214` | product/category/shop/search pages render (as today); § 3.2 removes their price surfaces |
| `renderer/src/components/SitePage.tsx:252` | `ProductPageView` gets `commerceEnabled=false` → no `AddToCartButton` (`:824`) — unchanged |
| `renderer/src/components/SitePage.tsx:286-287` | account/cart/checkout/confirmation/tracking → 404 — unchanged; this already satisfies cat-mode-1 § 2.2 "404 even if requested directly" |
| `renderer/src/app/[siteId]/sitemap.xml/route.ts:17-18` | **must change** — § 3.3 |
| `admin/src/components/layout/Sidebar.tsx:41` (`isCommerce`, used at `:58-60`) | Orders/Customers/… hidden; Products, Digital Products, Categories (`:55-57`) stay — unchanged |
| `admin/src/components/layout/AdminLayout.tsx:45-80` | product/category autolink list not fetched → editors of a catalog tenant cannot autolink products. Recommended change: `commerceEnabled \|\| catalogMode` (admin only; no renderer bytes) — see § 8.4 F-5 |
| `admin/src/components/editor/Toolbar.tsx:21-22` | commerce plugins (`categoryShowcase`, `reviewsCarousel`, `packages/plugins/src/category-showcase/index.ts:14`, `reviews-carousel/index.ts:14`) hidden. Unchanged unless F-5 is accepted; if `categoryShowcase` is offered, the § 3.2.6 `_catalogMode` rows come first |
| `admin/src/pages/Settings.tsx:651-652` | the Commerce toggle; hidden on a catalog tenant, where the card shows the mode read-only (CM-D11) |
| `admin/src/pages/Settings.tsx:712` (Commerce Bar), `:915` (Payment Methods), `:963` (Bank Transfer), `:1568` (Order Celebration) | hidden — unchanged |
| `admin/src/pages/Settings.tsx:879` (Product Search) | hidden today; recommended `commerceEnabled \|\| catalogMode` — search is a catalog feature (§ 8.4 F-5) |
| `admin/src/context/TenantContext.tsx:9` | type gains `catalogMode?: boolean` |
| `backend/src/tenant/list.ts:29,56` | both projections gain `catalogMode: item.catalogMode ?? false` — this is the admin's only source for `currentTenant` |

The packet named `Sidebar.tsx:41` and `AdminLayout.tsx:45-80` without directory; the files are under
`admin/src/components/layout/`. `admin/src/context/TenantContext.tsx:9` is a reader the packet did not list.

**New backend readers of the tenant mode (all inside `cat-mode-1` unless named otherwise)** — every product write
path, found by `grep -rln 'PRODUCT#' backend/src` intersected with files that write (EXECUTED, § 8.1): writers are
`products/create.ts`, `products/update.ts`, `products/bulk-price.ts`, `import/woocommerce.ts`; `resources/presign.ts`,
`webhooks/paddle.ts` and `orders/create.ts` only read `PRODUCT#` items.

| Path | Reads | Behaviour for a catalog tenant |
|---|---|---|
| `backend/src/tenant/settings.ts` (`_updateHandler`) | merged `commerceEnabled`, `catalogMode`; stored `catalogMode` | refuses a changed `catalogMode` (400, fixed at creation — CM-D11) and `commerceEnabled: true` on a catalog tenant (400) — above. Writes only `SYSTEM / TENANT#<checked tenantId>` and sets no index key (SETTINGS-KEYS-1/1B, `:111-112`, `:177-182`), and refuses another tenant's hostname (`:149-164`), so it can name no `PRODUCT#` item, no other tenant and no `GSI_Slug` partition |
| `backend/src/products/create.ts`, `update.ts` | `catalogMode` (new `GetItem`; `create.ts` needs `grantReadWriteData`) | monetary fields refused (400) — CM-D1 note; the product write stays a plain `Put` (`create.ts:52`, `update.ts:50`) — the mode cannot change (CM-D11) |
| `backend/src/import/woocommerce.ts` | `catalogMode` (new `GetItem`; grant already read-write) | whole import refused (403) before the first write — CM-D8 guard 1, the whole guarantee (CM-D11) |
| `backend/src/products/bulk-price.ts` | none | UNAFFECTED — writes only products that already have a price (`:111-112`); a catalog tenant has none from creation on |
| glam importer (CAT-IMPORT-1) | `catalogMode`, once at the start of the job | refuses a non-catalog tenant before the first write (§ 3.4); its draft type has no monetary member |
| `backend/src/orders/create.ts` | `commerceEnabled` | 403 — CM-D6 |

### 3.2 The surface table (CAT-MODE-1's oracle)

> **Every price/ordering surface, enumerated, with its catalog-mode behavior** — the spec's table is the oracle for
> CAT-MODE-1. […] Backend rows […]: `orders/create.ts:120`, `products/bulk-price.ts`, `products/public-list.ts:49-50`
> […] the table lists each with its catalog-mode behaviour.

Classes: **SUPPRESSED** = under `isCatalogMode` the element or field is not emitted (absent, not hidden by CSS);
**CHANGED** = code changes for catalog mode or for absent price, without a visible surface; **UNAFFECTED** = no
change, with the reason; **OUT OF SCOPE** = not a product price/ordering surface, or excluded by § 5.
Sweep: `grep -rn "price\|salePrice\|availability\|Buy" <dir>` with `*MAP.md` excluded (EXECUTED; counts in § 8.1).
Every hit is a row or is inside a row's line range. Hits found outside the sweep's directories or regex are in
§ 3.2.6.

#### 3.2.1 `renderer/src` — 81 hits / 6 files

| File:line (hits) | What it is | Class / catalog-mode behaviour |
|---|---|---|
| `app/[siteId]/openai-feed/route.ts:28,29,31` | feed `price`, `sale_price`, `availability` | SUPPRESSED — whole route withheld (404) per § 3.3 |
| `components/ProductByIdPage.tsx:75,76,77` | legacy `/products/[id]` JSON-LD `offers` (`:72-79`) | SUPPRESSED — no `offers` key; `Product` stays |
| `components/ProductByIdPage.tsx:109,111,112,115` | legacy page price / sale price / currency | SUPPRESSED |
| `components/ProductByIdPage.tsx:123,130,135` | Paddle "Buy Now", "Pre-order", "Out of Stock" (`:123-137`) | SUPPRESSED — the whole control block |
| `components/SearchBar.tsx:26,28` | result type with `price`/`salePrice` | CHANGED — `price` optional in the type |
| `components/SearchBar.tsx:197,198,200` | dropdown result price (data from `GET /public/products?search=`, `:69-70`) | SUPPRESSED — `SearchBar` gets a `showPrices` prop, false under catalog mode |
| `components/AddToCartButton.tsx:11,13,34,50,51,53,61,62,74,83,85,86,92,94,95,109,110,111,178,193,194` | cart control | UNAFFECTED — rendered only when `commerceEnabled` (`SitePage.tsx:824`), which the § 3.1 rule makes false for every catalog tenant |
| `components/SitePage.tsx:265,267,270` | shop `?availability=` query passed to data and view | SUPPRESSED — under catalog mode the view gets no availability filter (`availability` forced `undefined`) |
| `components/SitePage.tsx:439` | `offers` price "0" USD on content pages whose schema type is `SoftwareApplication` | OUT OF SCOPE — content-page schema chosen by the tenant (default `Organization`); not a product. Named risk: a catalog tenant that picks `SoftwareApplication` publishes this "0" |
| `components/SitePage.tsx:476` | access-policy "Purchase" text | OUT OF SCOPE — gated-content policy, not a product |
| `components/SitePage.tsx:634,636,637,640` | `ProductCard` price / sale price (`:622-648`; used by category `:984`, shop `:1048`, search `:1097`) | SUPPRESSED — `ProductCard` gets `showPrice`/`showAvailability` false |
| `components/SitePage.tsx:643,644` | `ProductCard` availability badge | SUPPRESSED |
| `components/SitePage.tsx:680,681,682` | product page JSON-LD `offers` (`:678-683`) | SUPPRESSED — `offers` key not emitted; name/description/image stay; `aggregateRating` (`:685-690`) stays |
| `components/SitePage.tsx:732,734,735,738` | product page price block (`:730-740`) | SUPPRESSED |
| `components/SitePage.tsx:750` | volume-pricing tiers (`:742-755`) | SUPPRESSED |
| `components/SitePage.tsx:759,763` | availability line (`:757-768`) | SUPPRESSED |
| `components/SitePage.tsx:819` | Paddle "Buy Now" (`:812-821`, "always, regardless of commerceEnabled") | SUPPRESSED |
| `components/SitePage.tsx:830,831,833` | `AddToCartButton` props | UNAFFECTED — behind `commerceEnabled` (`:824`); a commerce tenant carries a price on every product from creation on (CM-D1 refinement + CM-D11, § 3.1), so no absence rule is needed (the cycle-2 absence rule here is withdrawn) |
| `components/SitePage.tsx:995,1018,1023,1024,1043,1053` | shop "All Products / In Stock" filter, empty-state text, pagination URL | SUPPRESSED — no filter row; empty text uses the non-stock variant; pagination URL without `availability` |
| `lib/dynamo.ts:74` | comment on the date-window helper | UNAFFECTED (comment) |
| `lib/dynamo.ts:326,355,356,357` | `getActiveProducts` availability filter | UNAFFECTED — data filter, emits nothing; the view no longer passes it (row `:265`) |
| `lib/dynamo.ts:344,388,689` | projections that name `price`, `salePrice`, `availability` | UNAFFECTED — a projection of an absent attribute returns nothing |
| `lib/dynamo.ts:703,705,706` | `getProductsForFeed` mapping | UNAFFECTED — its only consumer (the feed) is withheld for catalog tenants |

#### 3.2.2 `admin/src` — 41 hits / 7 files

| File:line (hits) | What it is | Class / catalog-mode behaviour |
|---|---|---|
| `components/InvalidationBanner.tsx:14` | comment | OUT OF SCOPE |
| `lib/csv-headers.ts:15,16,30,31` | WooCommerce CSV header translations | OUT OF SCOPE — WooCommerce import, not the glam import |
| `pages/ProductEditor.tsx:39,41,43,54` | form defaults: price, salePrice, availability, volume tiers | SUPPRESSED — fields not shown. **Under catalog mode only**, the save (`:117` sends the whole form) drops `price` and `salePrice` when they are empty strings, so a catalog product is saved with no such keys and `volumePricing: []`; an empty string is not absence and the catalog write rule refuses a present key (CM-D1 note). On a commerce tenant the save is unchanged: there the update path merges the request over the stored item (`backend/src/products/update.ts:43`), so dropping a cleared `salePrice` would silently keep the old sale price, and the request bytes of a commerce tenant must not change (§ 3.6) |
| `pages/ProductEditor.tsx:110` | client validation `!form.title \|\| !form.price` | CHANGED — under catalog mode only `title` is required (CM-D1) |
| `pages/ProductEditor.tsx:47,117` (outside the regex) | `imageLink: ""` initial value, sent whole at `:117` | CHANGED (CM-D7, ratified with explicit removal) — on create the save omits an empty `imageLink` (never sent as `""`; the schema `.url().optional()` refuses `""`, and create never accepts `null`); on update, when a stored image has been cleared, the save sends `imageLink: null`, which the update handler reads as removal and deletes the key before the `Put` (`update.ts:43` merges, so an omitted key would keep the old image) |
| `pages/ProductEditor.tsx:289,308,316,343,359` | volume tier add, price, sale price, tier price, availability inputs | SUPPRESSED |
| `pages/ProductEditor.tsx:56,413,476,484` | variant option `priceOverride` / `availability` | SUPPRESSED — the option price and availability inputs are not shown. Cycle 10: catalog imports DO write one variant group (CM-D4 AMENDED), and `addOption` initialises `{ value: "", priceOverride: "", imageLink: "", availability: "in_stock" }` (`:413`); under catalog mode the save omits `priceOverride` and `availability` from every option, because the CM-D1/CM-D8 refusal refuses a present `priceOverride` key even when it is `""`. Hand edits of an imported product's options are allowed and are replaced by the next import of its file (disposable catalog). Cycle 11 (C10-3), for a product carrying `importSource`: the save also omits an empty option `imageLink` (`:413` initialises it to `""`, which the write boundary refuses); the backend keeps exactly one group with unique option values (400 otherwise) and re-derives `imageLink`/`additionalImageLinks` from the options on every save, so the editor states next to those two fields that they are derived from the variants and a direct edit is overwritten |
| `pages/OrderDetail.tsx:137,139,183,185,212` | order line prices | UNAFFECTED — no order can exist (CM-D6 guard); the Orders link is hidden (`Sidebar.tsx:58-60`) |
| `pages/DeliverySettings.tsx:555` | delivery calendar help text | OUT OF SCOPE |
| `pages/DigitalProductEditor.tsx:49,248,253,266,271` | Paddle product editor | OUT OF SCOPE (§ 5 Paddle); its render output (`SitePage.tsx:812-821`) is SUPPRESSED above |
| `pages/Products.tsx:150,170,173,258,266` | "Adjust Prices" (bulk price) dialog | SUPPRESSED — the button and dialog are not rendered |
| `pages/Products.tsx:427,429,430,433` | list price column | SUPPRESSED — column not rendered |
| `pages/Products.tsx:444,447` | list availability column | SUPPRESSED |

#### 3.2.3 `tools/mcp-server/src` — 20 hits / 1 file (`index.ts`)

| Line(s) | What it is | Class / catalog-mode behaviour |
|---|---|---|
| `148,164,174` | docs of the `pricing` content block | OUT OF SCOPE — a content block, not a product |
| `1017` | `list_products` prints `(${p.price} ${p.currency})` | CHANGED — print the price part only when `p.price` is present; never the text "undefined" |
| `1050,1061,1065` | `create_product` requires `price: z.string()` | CHANGED — `price` optional in the tool schema; the backend write-boundary refinement (CM-D1) decides per tenant |
| `1053` (outside the regex) | `create_product` requires `image_link: z.string()` | CHANGED (CM-D7) — optional; an empty value is dropped, never sent as `""` |
| `1087-1101` (outside the regex) | `get_product` returns the stored item whole (`JSON.stringify(response.data)`, `:1096`) | UNAFFECTED for price: under CM-D1 (b) + CM-D8 a catalog product stores no monetary field, so none is returned. It DOES return the stored defaults `availability: "in_stock"`, `currency`, `condition` — an admin-authenticated surface; § 8.4 F-6 |
| `1056,1075` | `create_product` `sale_price` | UNAFFECTED — optional already; the backend refuses it for a catalog tenant (CM-D1 refinement, § 4) |
| `1070` | `create_product` sends `availability: "in_stock"` | UNAFFECTED on rendered pages (no page shows it under catalog mode); it is stored and returned by `get_product` and the JSON routes — § 8.4 F-6 |
| `1112,1113` | `update_product` field documentation | CHANGED — text says `price` is optional for catalog sites |
| `1447,1453,1456,1461,1462` | `bulk_price_adjust` | UNAFFECTED — backend skips priceless products (`bulk-price.ts:111-112`) |
| `2513,2562,2605` | server help text | OUT OF SCOPE |

#### 3.2.4 `backend/src` — 62 hits / 12 files

| File:line (hits) | What it is | Class / catalog-mode behaviour |
|---|---|---|
| `products/public-list.ts:5,68` | availability-date helper import/use | UNAFFECTED |
| `products/public-list.ts:49,50` | projection names `price, currency, salePrice, availability` | UNAFFECTED — CommerceApi (`infra/lib/api-commerce.ts:206`), not changed. The guarantee is data absence on every product write path: CM-D1 refinement (`products/create.ts`, `update.ts`), CM-D8 guard 1 (`import/woocommerce.ts`), the mode fixed at creation (CM-D11), the glam draft type (§ 3.4); `bulk-price.ts` writes only already-priced products. No price residual. The stored `availability` default is still returned — § 8.4 F-6 |
| `products/public-get.ts:4` | helper import | UNAFFECTED; note `:43` returns the **whole item** (`JSON.stringify(product)`) — since SETTINGS-KEYS-1B only ever a product item of that tenant (`:28-30`: `PK === TENANT#<tenantId>` and `SK` begins `PRODUCT#`); relevant to CM-D3, and the public carrier of the `availability` default (§ 8.4 F-6) |
| `products/create.ts:70,71` | CATPROD# projection gets `price`, `salePrice`, `availability` | CHANGED (types only): `price` may be `undefined` |
| `products/create.ts:85` | audit `details.price` | UNAFFECTED — `undefined` is dropped by JSON |
| `products/update.ts:61,62` | CATPROD# projection on update | CHANGED (types only), as create |
| `products/bulk-price.ts:12-30` (`roundPrice`, hits `12,13,16,20,21,25,27,30`) | rounding helper | UNAFFECTED |
| `products/bulk-price.ts:106,111,120,125,126,129` | price calculation | UNAFFECTED — **checked as CM-D1 asked**: `parseFloat(undefined)` is `NaN` and `:112` `if (isNaN(oldPrice) \|\| oldPrice <= 0) continue;` skips the product; it is neither previewed nor written |
| `products/bulk-price.ts:153,158,166,172,173,198` | write of new prices | UNAFFECTED — reached only for products that passed `:112` |
| `products/list.ts:56` | admin list projection | UNAFFECTED — absent attributes return nothing |
| `lib/catprod.ts:16,18,20,38,40,42` | `ProductCardProjection` (`:11-…`) `price: string` (`:16`) and its copy | CHANGED (type): `price?: string` |
| `lib/invalidate-cdn.ts:9` | comment | OUT OF SCOPE |
| `orders/create.ts:105,120` | server-side price validation; `unitPrice = product.salePrice \|\| product.price` | UNAFFECTED for catalog tenants: the CM-D6 guard, placed after the tenant-config read (`:69-74`), refuses every non-`commerceEnabled` tenant before `:105` |
| `import/woocommerce.ts:55,56,70,71` | CSV header translations | OUT OF SCOPE |
| `import/woocommerce.ts:310,311,312,393,418,419,427,429,459,461,462,495,496,497` | WooCommerce price/availability mapping; writes `price: regularPrice \|\| '0'` (`:459`, `:495`) directly to DynamoDB, without the schema | CHANGED (guard) — CM-D8 guard 1: the handler reads the tenant config and refuses a catalog tenant before its first write (`:336`); the mapping lines themselves do not change. Second named exception to the commerce freeze (route `infra/lib/api-commerce.ts:513`) |
| `scheduled/debounce-flush.ts:41,64` | the word "priced" in comments | OUT OF SCOPE |
| `categories/public-get.ts:5,36` | availability-date filter | UNAFFECTED; since SETTINGS-KEYS-1B the category it returns is only ever a category item of that tenant (`:29-31`) |

#### 3.2.5 `packages/shared/src` — 7 hits / 1 file (`index.ts`)

| Line | Schema | Class / catalog-mode behaviour |
|---|---|---|
| `156` | `AccessPolicySchema.price` (`:150-158`, gated content) | OUT OF SCOPE |
| `962` | `VolumePricingTierSchema.price` (`:960-963`) — **this is the tier price the packet asked to identify** | UNAFFECTED — catalog products carry `volumePricing: []`; the refinement refuses tiers for a catalog tenant |
| `982,984` | `ProductVariantSchema` option `priceOverride`, `availability` (`:977-986`) | UNAFFECTED in the schema (cycle 11 correction: since CM-D4 AMENDED the catalog import DOES write one variant group per product; its options carry `value` and `imageLink` only — `priceOverride` and `availability` are never written by the importer and are refused at the write boundary, CM-D1 note) |
| `1012` | `ProductSchema.price` | CHANGED — `z.string().optional()` (CM-D1 b) |
| `1014` | `ProductSchema.salePrice` | UNAFFECTED (already optional) |
| `1018` | `ProductSchema.availability` default `in_stock` | UNAFFECTED in schema; every rendered surface is SUPPRESSED by flag. The stored default is returned by the JSON routes and MCP `get_product` — § 8.4 F-6 |

The packet said `imageLink: z.string().url()` at `:1049` "is in a third schema". It is not: `:1049` lies inside
`ProductSchema` (`:996-1069`). It is **required** there, and that fact forces CM-D7. The other `imageLink` fields
in `index.ts` are all optional: `ProductVariantSchema` option `:983`, `CategorySchema` `:1088`, `PopupSchema`
`:1565`.

#### 3.2.6 Surfaces outside the sweep (directories or words the regex does not cover)

| File:line | What it is | Class / catalog-mode behaviour |
|---|---|---|
| `packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx:17-58` (price build `:19-30`, render `:53-58`) | `categoryShowcase` block prints `${product.price} ${product.currency}`; `showPrice` defaults `true` (`packages/plugins/src/category-showcase/schema.ts:9`) | SUPPRESSED — the render receives only `attrs` and `tenantId` (`CategoryShowcaseRender.tsx:63`), no tenant config. The renderer already injects tenant facts into this block's attrs (`renderer/src/components/SitePage.tsx:515-530`: `prefetchedProducts`, `_productPrefix`, `_categoryPrefix`); it adds `_catalogMode: true` there **only when** `isCatalogMode` (the key is absent otherwise, so non-catalog bytes and RSC payloads do not change). With `_catalogMode` the price line is not emitted. (The cycle-2 additional absence rule is withdrawn — a non-catalog tenant has a price on every product, § 3.1.) |
| `packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx:18,46-50` | "Out of Stock" overlay (`outOfStock = product.availability === "out_of_stock"`, `:18`) — independent of the price line | SUPPRESSED — not emitted when `_catalogMode` is set |
| `renderer/src/components/ProductByIdPage.tsx:98` | legacy page main `<img src={product.imageLink}>`, unchecked | CHANGED (CM-D7 absence rule) — the element is emitted only when `imageLink` is present (as `ProductImageGallery.tsx:14` already does: `if (!mainImage) return null`) |
| `renderer/src/components/ProductByIdPage.tsx:101` | legacy page additional `<img>` per `additionalImageLinks` entry | CHANGED (absence rule) — falsy entries are not emitted |
| `renderer/src/components/ProductImageGallery.tsx:14` | slug product page gallery | UNAFFECTED — already returns nothing without a main image |
| `renderer/src/components/SitePage.tsx:813-821` | Paddle button (the word "Buy" is at `:819`) | SUPPRESSED (row above) |
| `renderer/src/app/[siteId]/layout.tsx:158-175` | `CommerceBar` with `currency` (`:164`) and cart total | UNAFFECTED — behind `commerceEnabled` |
| `renderer/src/components/Navbar.tsx:157,170` | `CartWidget` | UNAFFECTED — behind `commerceEnabled` |
| `renderer/src/app/[siteId]/sitemap.xml/route.ts:17-18` | product/category inclusion | CHANGED — § 3.3 |
| `renderer/src/app/[siteId]/robots.txt/route.ts:17` | points to `/sitemap.xml` | UNAFFECTED |
| `renderer/src/app/[siteId]/llms.txt/route.ts` | no product, price or feed reference (EXECUTED grep, § 8.1) | UNAFFECTED |
| `renderer/src/components/ProductByIdPage.tsx:67` | JSON-LD `"sku": product.id` — the amodx UUID, not a producer code | UNAFFECTED |
| `renderer/src/lib/dynamo.ts:401`, `backend/src/products/public-list.ts:61` | search matches `sku` | UNAFFECTED — the catalog import writes no `sku` |
| `renderer/src/components/SitePage.tsx` `ProductPageView` (`:669-944`) — NEW catalog-mode variant presenter (cycle 10) | the product's single variant group: the option labels (`value`) with their images | ADDED by `cat-mode-1`, rendered only under `isCatalogMode`, read-only, no price and no availability; it exposes the selected option to the interest control (§ 3.5). Under catalog mode it is the only `variants` reader; non-catalog pages do not render it, so their bytes do not change (§ 3.6) |
| `renderer/src/components/AddToCartButton.tsx` (via `SitePage.tsx:834`) | the commerce `variants` reader | UNAFFECTED — behind `commerceEnabled` (`SitePage.tsx:824`), never on a catalog tenant |
| grouped-product consumers (C8-4) — what each emits for a product carrying the catalog variant group | | none emits `priceOverride` (the importer never writes it; the write boundary refuses it, CM-D1 note) |
| — feed `renderer/src/app/[siteId]/openai-feed/route.ts:21-35` | maps product fields; no `variants` field | catalog tenant: withheld, 404 (§ 3.3) — emits nothing; `additional_image_links` (`:27`) only for non-catalog tenants |
| — product-page JSON-LD `SitePage.tsx:672-684` | `Product` with `name`, `description`, `image` (the main `imageLink`) | catalog tenant: no `offers` (§ 3.2.1); no variants emitted |
| — legacy-page JSON-LD `ProductByIdPage.tsx:61-80` | `image: [imageLink, ...additionalImageLinks]` (`:65`) | catalog tenant: no `offers`; the image list carries the option images (derived `additionalImageLinks`); no variants emitted |
| — MCP `get_product` (`tools/mcp-server/src/index.ts:1087-1101`) | the stored item whole | returns the variant group with option `value` and `imageLink` only (plus the F-6 product defaults) |
| — MCP `list_products` (`index.ts:1017`) | title, price, status, id | no variants; the price part is omitted when absent (§ 3.2.3) |
| — admin editor Variants tab (`admin/src/pages/ProductEditor.tsx:390-415`) | edits the groups and options | catalog tenant: labels and images only; price/availability inputs hidden and not sent (§ 3.2.2) |
| — public JSON `products/public-get.ts:43` | the whole item | includes the variant group (labels and images, no `priceOverride`) |
| — public JSON `products/public-list.ts:49-50`, `categories/public-get.ts:51` (`CATPROD#` items) | projections / adjacency items | carry no `variants` (neither projection names it) |

**Closing rule (one rule for the whole table).** Catalog emission is mode-gated: under `isCatalogMode` no price,
availability or ordering element is emitted, whatever the data holds; and price and image absence each have one
representation in storage and rendering — the key is absent (never `""`, never `"0"`, never `null`); a create omits
the key, an update that clears a stored image sends `imageLink: null` and the handler deletes the key, writers never
send `""`, and the schema refuses `""`. Price is absent only on a catalog tenant, and a tenant's
mode never changes (CM-D11), so commerce price readers need no absence rule; an image can be absent (CM-D7), so every
image reader emits nothing for an absent image.
(`CategoryShowcaseRender.tsx` is a client component — `"use client"`, `:1` — so its attrs travel in the RSC
payload; this is why `_catalogMode` is set only when true.)

### 3.3 Sitemap and feed rule

> **The sitemap/feed inclusion rule**: catalog tenants are INDEXABLE — products and categories appear in the
> sitemap; the OpenAI feed either omits price fields or is withheld (decide).

**Sitemap — the exact change.** `renderer/src/app/[siteId]/sitemap.xml/route.ts:17-18` read
`config.commerceEnabled ? … : Promise.resolve(…)`. Both conditions become
`(config.commerceEnabled || isCatalogMode(config))`. Nothing else in the route changes, so a tenant without
`catalogMode` produces the same bytes. Named limit (INFERRED from code, not a change in this spec):
`getActiveProducts(config.id, 1, 1000)` (`:18`; slicing at `lib/dynamo.ts:360-361`) puts at most 1000 products in
the sitemap. BOEN alone has 462 rows (glamCRM `docs/PRICELISTS.md:108`); the full glam catalog size across the six
complete lists is not known here (§ 8.3). CAT-MODE-1 states the imported count; if it exceeds 1000 the limit is a
named follow-up (the protocol allows 50 000 URLs per file).

**OpenAI feed — RECOMMENDED: withhold.** Under `isCatalogMode` the route `app/[siteId]/openai-feed/route.ts`
answers **404** before it reads products (after the config read, `:11-13`).

Reason, from what a consumer does:
- The route claims the OpenAI/Google product-feed format (`:20`). In OpenAI's stable product-feed spec, `price`
  and `availability` are required fields, and rows with a missing or unrecognized availability are rejected
  (OpenAI Commerce "Products" file-upload reference, https://developers.openai.com/commerce/specs/file-upload/products —
  read 2026-10-28 via web search; INFERRED that other consumers apply the same rule). A priceless entry is therefore
  a malformed record: a strict consumer drops the row or the file; a lenient one fills the gap — with a default, a
  guess, or a price scraped elsewhere. Each outcome is the fabricated price this spec exists to prevent, or noise.
- With no entry, an AI agent still finds every product through the sitemap (§ 3.3) and the product page's
  JSON-LD `Product` (name, description, image, brand — `offers` removed). That is the discovery value the plan
  wants, in a format that has no price slot to fill.
- Withholding is the smallest change (one guard) and has no partial state to keep correct.

Rejected: "omit price fields" — keeps a non-conforming feed alive and depends on every consumer reading absence
honestly. `getProductsForFeed` (`lib/dynamo.ts:670`) stays unchanged.

### 3.4 Import contract (CAT-IMPORT-1)

> **The import contract** for the glam canonical 12-column layout: required/optional columns, the identity key,
> idempotency semantics, the dry-run report shape, and the NO-CODES / NO-PRICES law stated as a schema-level
> guarantee for CAT-IMPORT-1.

*Amended 2026-10-28 (human direction, § 1 addendum; CM-D3 and CM-D4 AMENDED on file evidence).* The text below
replaces the cycle-7 identity, lookup-item and update contract. What was withdrawn is listed in § 8.13.

**Input.** One enriched CSV produced by glamCRM's pl-tools, `out/<vendor>/enriched/<sheet>.csv` — one file per
producer/collection sheet. Not a glamCRM export, not a raw vendor file (§ 1 addendum, item 1). Upload as `.csv`,
UTF-8, RFC 4180 quoting: BOEN's `produs` values contain commas and are quoted (257 of BOEN's 478 product rows,
e.g. `"Oak Andante Live Matt brushed , 4V bevel"`), and so are some `format` values (`"10,5x137x790 mm"`) — EXECUTED
over the file, § 8.1. Twelve columns **by index** (every row of all 24 files has exactly 12 cells, EXECUTED); the
header row is ignored. A row whose `produs` cell (idx 1) is empty is skipped and reported.

*Amended again 2026-10-28 (cycle 10): the product grain is the STYLE, and each row is a VARIANT (CM-D4 and CM-D3
AMENDED, human ruling on the per-vendor evidence).* The text below replaces the cycle-8 "one product per distinct
composite" contract.

**Upload fields** (all required before any mutation; invalid metadata answers 400 and writes nothing):
- the file;
- the **producer** name — not in the file; the form offers the tenant's existing `brand` values and accepts a new
  one; it becomes `brand` and the parent category (`docs/plan-glam-catalog.md:75`);
- the **sheet** name — default: the file name without `.csv`;
- the **variant name** — what the variant labels mean for this file (default "Variantă"; e.g. "Culoare" for ITC,
  "Format" for BOEN); it becomes the variant group's `name`.

`importSource = "glam:" + norm(producer) + "/" + norm(sheet)`, with `norm` the key normalisation below. One rule
closes the identifier class (C8-2): **a separator of an identifier may not occur inside any of its components.** So
`producer` and `sheet` may contain neither `/` (the `importSource` separator) nor `\u001f` (the key separator); a
value that does is refused (400) before any mutation. Without the rule, producer `a/b` + sheet `c` and producer `a` +
sheet `b/c` both give `glam:a/b/c`, and one upload could delete another sheet's products (review-8).

| idx | Column | Read? | amodx target | Rule |
|---|---|---|---|---|
| 0 | colecție | yes | child category (one per collection, under the producer's parent category) + attribute `colecție`; part of the product key | filled on every product row of all 24 files (EXECUTED); a product row with it empty is skipped (`no-collection`) |
| 1 | produs | yes | `title`; part of the product key | empty → row skipped (`no-name`) |
| 2 | cod producător vechi | **never** | — | the parsed row type has no field for it |
| 3 | preț achiziție | **never** | — | as above |
| 4 | preț de listă | **never** | — | as above |
| 5 | cod producător înlocuitor | **never** | — | as above |
| 6 | unitate de măsură | yes | attribute `unitate` | empty → omitted |
| 7 | unitate de împachetare | yes | attribute `împachetare` | empty → omitted |
| 8 | comandă minimă | yes | attribute `comandă minimă` | empty → omitted; never appended to the title |
| 9 | link imagine produs | yes | the variant option's `imageLink` (and, derived, the product's `imageLink` / `additionalImageLinks`) | a valid `http(s)` URL is used; empty or invalid → the option has no image, reported per row; never a skip reason (CM-D7 (a)) |
| 10 | specificații tehnice | yes | `longDescription` (HTML-escaped paragraphs) + `description` (first ~300 chars, plain) | from the first row of the style whose specs are non-empty |
| 11 | format | yes | the VARIANT LABEL (`options[].value`) | per vendor (PRICELISTS.md § 2): BOEN's plank size, ITC's colour number after the prerequisite below; empty allowed |

Columns 2–5 are present in the files (EXECUTED) and are never read: the row type the parser produces has no field for
them — the NO-CODES / NO-PRICES law as a type guarantee (below).

**Product key — within one import only (CM-D3 AMENDED twice).** The key identifies a storefront product (a STYLE)
inside ONE import; no identity is kept across imports — the catalog is disposable (§ 1 addendum, item 4).
- *Key:* producer (the upload field) + colecție (idx 0) + produs (idx 1) — the columns of the plan's mapping table
  (`docs/plan-glam-catalog.md:63-75`: `:65`, `:66`, `:75`). `format` is NOT part of the key since cycle 10; it labels
  the variant. Producer CODES are never read (`docs/plan-glam-catalog.md:124`).
- *Normalisation*, per value, in this order: trim → collapse every run of whitespace to one space → lower-case with
  the locale-independent `String.prototype.toLowerCase()` → Unicode NFC **last**. Diacritics are kept. The final NFC
  gives one code-point form per letter after lower-casing, so canonically equivalent input gives one key
  (decision-review CM-D3 correction, `decision-rebuttal.md`; re-run in § 8.1, EXECUTED).
- *Separator rule:* no normalised key component may contain `\u001f`; normalisation does not remove it (`trim()` keeps
  it; `/\s/` does not match it, EXECUTED). A `colecție` or `produs` cell that contains it makes the row `skipped`
  (`separator-in-key`, column named); the upload fields are covered by the identifier rule above. An empty component
  is allowed.
- *Join:* the three checked values joined with `\u001f`; the separator cannot occur inside a component and the key has
  exactly three components, so two different tuples give two different keys.
- *Tests CAT-IMPORT-1 owes before the first import* (§ 8.5): review-6's separator witness (rows whose `produs` holds
  `\u001f` → `skipped`); canonical equivalence (`["P","C","J̌"]` and `["P","C","ǰ"]` → one key);
  idempotence (`norm(norm(x)) === norm(x)` for that witness, for Romanian upper- and lower-case diacritics, and for a
  whitespace-only value); the identifier rule (`a/b`+`c` and `a`+`b/c` → both refused with 400).
- *Slug:* from the key, so a product's URL is normally the same after a re-import — the slugify the WooCommerce
  importer uses (`backend/src/import/woocommerce.ts:24-33`: diacritics folded, no leading `/`) applied to the three
  normalised components joined with a space (slugify drops `\u001f` and glues the words, EXECUTED § 8.1). Not
  `normalizeSlug` (`packages/shared/src/slug.ts:27-34`), the content-page normaliser (leading `/`, drops `ș`). Two
  different keys can give one slug — slugify drops punctuation, so `"… brushed, 4V bevel"` and `"… brushed , 4V bevel"`
  collide (review-8's BOEN witness, `PL.csv` rows 17/18); the later key in file order gets `-2`, `-3`… and the report
  lists it. Named consequence: if the file order of two such keys changes, their URLs swap on the next import. Slugs
  are URLs only, never identity (C8-3 below).
- *`id`:* a fresh id per import (products are recreated on every import; "Replace" below).

**Variants — one product per style, one option per variant (CM-D4 AMENDED twice).** One source of truth: the
existing variant model (`ProductVariantSchema`, `packages/shared/src/index.ts:977-986`: a group `{ id, name,
options[{ value, priceOverride?, imageLink?, availability? }] }`).
- Every imported product has exactly one variant group: `id` generated, `name` = the upload's variant name.
- One option per row of the style, in file order: `value` = the row's `format` label (idx 11, trimmed), `imageLink`
  = the row's usable image (absent when it has none). `priceOverride` and `availability` are never written (CM-D8's
  refusal list names `priceOverride`).
- *Dedupe first, then label.* Rows of one style whose normalised `format` AND image URL are both equal are ONE option
  (ALPOD pack variants: one decor under codes `/0 /1 /2`). Then labels are allocated so that each option `value` names
  exactly one option — the interest list records an option by its `value` (§ 3.5). *Collision-aware allocation (C10-2),
  one rule:* labels are compared in their normalised form (the § 3.4 key normalisation); the set `L` starts with every
  non-empty label of the style as read; options are visited in file order; an option whose label is empty receives
  the first of `#1`, `#2`, … that is not in `L`; an option whose label equals an earlier option's label receives the
  first of `<label> (2)`, `<label> (3)`, … that is not in `L`; every allocated label is added to `L` at once. So a label
  read from the file such as `x (2)` or `#1` is never produced again by allocation. The report lists every relabelled
  option. Tests owed (§ 8.5): a style with labels `x`, `x`, `x (2)` gives `x`, `x (3)`, `x (2)`; a style with labels
  `#1`, empty, empty gives `#1`, `#2`, `#3`.
- *Derived, never edited by hand* (one rule, applied on EVERY write of a product that carries `importSource` — the
  import, CAT-IMAGES-1, and `products/update.ts`): `imageLink` = the image of the first option that has one;
  `additionalImageLinks` = the other distinct option images, in option order. A direct edit of `imageLink` or
  `additionalImageLinks` on such a product is overwritten by the derivation (the editor says so, § 3.2.2); a request's
  `imageLink: null` (CM-D7 removal) is likewise replaced by the derived value. This feeds the existing gallery readers
  without change (`renderer/src/components/SitePage.tsx:722`, `ProductByIdPage.tsx:65,100`,
  `openai-feed/route.ts:27`). A style whose options have no usable image is one imageless product (CM-D7).
- *Invariants on every write of such a product (C10-3):* exactly one variant group (any other count → 400); option
  `value`s unique within the group in normalised form (collision → 400); an option `imageLink` is omitted when there
  is none — `""` is refused (CM-D7 extended to option images) by a write-boundary check for products carrying
  `importSource`; the shared `ProductVariantSchema` is unchanged, so commerce editors and products without
  `importSource` behave as today.
- `longDescription`/`description` from the first row of the style whose specs (idx 10) are non-empty (review-8
  witness: alpod `HER.csv`, "Am. walnut oil", first row 77, first non-empty specs row 80). `attributes` (the schema's
  array of `{ key, value }`, `index.ts:1033-1036`) from the first row of the style: `colecție`, `unitate`,
  `împachetare`, `comandă minimă`, empty values omitted; `format` is no longer an attribute (it is the variant label).
  If later rows differ in idx 6–8 or 10, the report says `differing: [<fields>]`; nothing else is done.
- What a visitor sees: one card (`ProductCard` shows `imageLink`), one product page with the gallery and — added by
  `cat-mode-1` — the catalog-mode variant presenter (§ 3.2.6): the option labels with their images, read-only.

**Per-vendor prerequisites in pl-tools** (glamCRM, operator-run, not amodx work — "before the first import of that
vendor"; § 8.5):
- **ITC** — `produs` ← the style, `format` ← the colour number (today `produs` is style + colour, e.g. "Altona UX
  Altona 34"; stripping the trailing number gives 66 styles over 536 rows, 8.1 colours per style — EXECUTED, § 8.1).
- **ALPOD** — `produs` ← Model + Decor (raw column 4 exists; `vendors/alpod.config.mjs:79` maps `produs: [2]` for AUR,
  `:64` KRO `[2]`, `:70` EGP `[2, 4]`), `format` stays empty (pack variants dedupe to one option). Today AUR.csv has 7
  distinct `produs` for 219 rows and 48 distinct images for 216 image rows (EXECUTED).
- **BOEN** — none (`produs` is decor + finish, `format` the plank size).
- Expected product and option counts after these mapping changes: to be measured by the operator. Today, with
  `format` excluded from the key: ITC Arc_Edition ≈ 66 styles of ≈ 8 colours; ALPOD unknown until Decor is mapped.

**Replace per file, under a per-tenant import lock.** A re-import of a file REPLACES that file's product set: the
products whose `importSource` equals the upload's are deleted, then the new set is created.
- *Lock (C8-1, operator ruling C8-IMPORT-EXECUTION-POLICY = A; ownership per C10-1).* After the tenant checks (below),
  the job writes `PK TENANT#<tenantId>`, `SK IMPORTLOCK#glam` with `{ owner: <fresh token>, expiresAt: now + 15 min }`
  and `ConditionExpression: attribute_not_exists(SK)` — the same conditional-write pattern as
  `backend/src/lib/service-keys.ts:72-87`. A lock past its `expiresAt` may be taken over with a `ConditionExpression`
  on that observed `expiresAt` value (so two jobs cannot both take it over). A contender that cannot take the lock
  answers **409** "an import is running" and touches nothing — it neither writes nor deletes the lock. Only the owner
  releases the lock, in a `finally`, with `DeleteCommand` and `ConditionExpression: owner = :me`; a job whose lock was
  taken over after expiry therefore cannot delete its successor's lock. 15 min equals the import function
  timeout the CatalogApi uses today (`infra/lib/api-catalog.ts:218`), so a lock past `expiresAt` belongs to a job that
  can no longer be running (INFERRED; CAT-IMPORT-1 sets its function timeout ≤ the lock duration). No queue, no job
  table. Without the lock, two overlapping jobs both read the old set, both delete it and each create the new set —
  two products per style (review-8, executed as a model).
- `importSource` is a NEW optional string on `ProductSchema` (`packages/shared`). *Abstraction line:* one optional
  field; users: the importer's delete (find the previous set) and its create (stamp the new set); axis: none (a data
  field); rejected alternative: matching the previous set by `brand` + category — a producer has several sheets, so
  that would delete another sheet's products. Display-safe on the public route (`products/public-get.ts:43` returns
  the whole item): it holds a producer and a sheet name, no code and no price.
- *Finding the previous set:* `Query PK = TENANT#<tenantId>`, `SK begins_with "PRODUCT#"`, **`ConsistentRead: true`**
  (an eventually consistent read can miss products written moments before and leave them behind), projection
  `id, title, categoryIds, importSource`, following `LastEvaluatedKey` — a query, not a scan (CLAUDE.md rule 2); it
  reads every product item of the tenant once per import. The previous set is the items whose `importSource` equals
  the upload's, selected in code (cycle 13: no `FilterExpression`, so the same pages also give every product's
  `categoryIds`, whatever its origin, which the reconciliation below uses; DynamoDB applies a `FilterExpression` after
  the read, so it did not reduce the items read — documented DynamoDB behaviour, not executed here).
- *Dry run* (no lock needed, nothing written) reports: the previous set it would delete — the count and the first ten
  titles, so a mistyped producer or sheet is visible before execution — the styles to create with their options, the
  rows deduped into an existing option, the imageless styles, the skipped rows.
- *Execute, in this order:* (1) the tenant read — strongly consistent; 404 for a missing tenant record, 403 for a
  non-catalog tenant — BEFORE the lock, so a refused import writes nothing, not even a lock (CM-D11 accepted
  refinement; C10-1); (2) take the lock; (3) delete each product of the previous set and its `CATPROD#` items for the
  `categoryIds` the previous-set query read (`deleteCatProductItems`, `backend/src/lib/catprod.ts:80`); (4) create
  the new set, each product with its `CATPROD#` items (`writeCatProductItems`, `:57`); categories: the producer parent
  and one per collection, created if absent, never deleted — slugs from the same slugify (as `import/woocommerce.ts:326`
  does): producer for the parent, producer + collection for the child; (5) **reconcile the categories the import
  touched** (below); release the lock. Then the CDN invalidation is marked, as the WooCommerce importer does
  (`export const handler = withInvalidation(_handler)`, `backend/src/import/woocommerce.ts:540`), and published later
  by the debounced flow (guarantee (c) below).
- *End-of-import reconciliation (cycle 12, human scope ruling; completeness rules cycle 13, C12-2).* The categories
  the import touched are the categories of the deleted products (from the previous-set query) and of the created
  products (the producer parent and each collection category). Steps (3) and (4) keep the existing helpers; whatever
  their unacknowledged batches drop in a touched category is repaired here. For each touched category `C`:
  1. *Candidates* — the union of: (i) every product id in a `CATPROD#<C>#` item, read COMPLETELY and strongly
     consistently: `Query PK = TENANT#<tenantId>`, `begins_with(SK, "CATPROD#<C>#")`, `ConsistentRead: true`,
     projection `id`, following `LastEvaluatedKey` to the end; (ii) every product of the previous-set query (the
     tenant-wide read that step (3) uses) whose
     `categoryIds` contains `C` and that the import did not delete — whatever its `importSource`, or none: the
     previous-set selection by `importSource` does NOT apply when finding category members; (iii) every product the
     import created in `C`. `queryCatProducts` (`backend/src/lib/catprod.ts:104-114`) must not be used as is: it sends
     one `QueryCommand` with no `LastEvaluatedKey` loop and no `ConsistentRead`, so it reads one page.
  2. *Current state* — the candidates' `PRODUCT#` items are read with `BatchGetCommand`, `ConsistentRead: true`, at
     most 100 keys per request, projection = the card fields of `buildCatProdItem` (`:30-50`) plus `categoryIds`;
     each response's `UnprocessedKeys` are sent again under the retry bound below. A *member* is a candidate whose
     item exists and whose current `categoryIds` contains `C`; every other candidate is an *orphan*.
  3. *Writes, category `C` only* — delete `CATPROD#<C>#<id>` of each orphan; put the projection of each member for
     `C` only, built by the existing `buildCatProdItem` (so its shape, including its `categoryIds` field — the
     product's full list — is the one every writer produces). Batches of 25; each response's `UnprocessedItems` are
     sent again under the retry bound. No item of another category is written.
  - *Retry bound* — at most 5 resends per request, waiting 100, 200, 400, 800 and 1,600 ms with full jitter
    (at most 3.1 s of waiting per request).
  - *Incomplete result* — category `C` is incomplete when, after the bound, keys stay unread in step 2 (membership
    cannot be decided; nothing is written for those ids) or items stay unprocessed in step 3. If any touched
    category is incomplete, the import answers **503** with the full report plus `incompleteCategories: [{
    categoryId, unreadProducts, unwrittenProjections }]`: the `PRODUCT#` items are already written (guarantee (a)
    holds); the named categories' projections are not. A non-2xx answer does not mark the CDN
    (`backend/src/lib/invalidate-cdn.ts:263-267`); recovery is the one below — import the same file again. The lock
    is released in `finally` as on every path.
  - *Helper change inside `cat-import-1` (`backend/src/lib/catprod.ts`).* Today `writeCatProductItems` and
    `deleteCatProductItems` (`:57-98`) discard the `BatchWriteCommand` response, so `UnprocessedItems` are dropped
    without a trace, and `queryCatProducts` reads one page. `cat-import-1` adds two exported functions next to them
    and changes nothing in the three existing ones or in their callers (`products/create.ts:68`, `update.ts:58-59`,
    `delete.ts:41`, `bulk-price.ts:169-170`, `import/woocommerce.ts:491,494`; `queryCatProducts`:
    `products/public-list.ts:22`, `products/list.ts:31`, `categories/public-get.ts:37` — `grep -rn` over the source
    roots, § 8.1):
    - `listCatProductIds(tenantId, categoryId): Promise<string[]>` — step 1(i).
      *Abstraction line:* a function; user: the reconciliation (one caller); kept in `catprod.ts` because that module
      owns the `CATPROD#<categoryId>#<productId>` key layout (`:7`, `:33`); axis: none; rejected: an option on
      `queryCatProducts` (changes the read cost of its three callers, two of them public) and an inline query in the
      importer (a second copy of the key layout).
    - `writeCategoryProjections(tenantId, categoryId, members, orphanIds): Promise<{ unprocessed: number }>` — step 3
      with the retry bound; returns the count left unprocessed.
      *Abstraction line:* a function; user: the reconciliation (one caller); kept in `catprod.ts` because it builds
      items with the non-exported `buildCatProdItem`, whose shape the renderer's category read depends on
      (`renderer/src/lib/dynamo.ts:264-294`); axis: none; rejected: adding the retry to the two existing helpers
      (changes five product writers, one of them `bulk-price.ts` in the frozen CommerceApi — that weakness is the
      follow-up `CATPROD-CONSISTENCY-1`, § 8.4) and an inline write in the importer (a second copy of the projection
      shape).
  - *Cost* — no tenant-wide read beyond the step-(3) read the import already makes. Per touched category: the
    paginated projection read (one item per projection of `C`), ⌈candidates / 100⌉ `BatchGet` requests (one item read
    per candidate), ⌈(members + orphans) / 25⌉ `BatchWrite` requests, plus retries — O(products and projections of
    the touched categories).
  - *What it finds* — every product that is a member of `C` at its step-2 read and that has a projection in `C`, was
    in `C` at the step-(3) read, or was created by the import. A product that an admin edit moves into or out of `C`,
    or edits, while the import runs is an overlapping admin edit (R3): its card can be missed or stale; that is the
    qualification in guarantee (b). Nothing is claimed for other categories.
- *Writers during a replacement (C10-1, operator ruling C10-REPLACE-WRITER-SCOPE = A, bounded to conditional writes;
  scope frozen by the human ruling of cycle 12).* No other writer can bring back a product the replacement deleted:
  - `products/update.ts` reads the item (`:31`), answers 404 when it is missing (`:36`), then writes with an
    unconditional `Put` (`:50`). Review-9 executed the consequence: an update whose read came before the replacement's
    delete restored the deleted product (200). The `Put` gains `ConditionExpression: "attribute_exists(PK)"`; a
    cancelled write answers 404, and the `CATPROD#` rebuild (`:55-59`), which runs only after a successful `Put` as
    today, does not run.
  - CAT-IMAGES-1's per-product `UpdateCommand` carries `ConditionExpression: "attribute_exists(PK)"` (an unconditional
    `Update` upserts a deleted item) (§ 8.5).
  - `products/create.ts` writes only fresh ids, and it cannot put a product into a replacement set: `importSource` is
    importer-owned (below), so a hand-created product never carries one.
  - `import/woocommerce.ts` is refused on a catalog tenant before its first write (CM-D8 guard 1).
  - `products/bulk-price.ts` writes nothing on a priceless tenant: `:111-112` skips every product without a price.
  - Projection consistency under two overlapping ADMIN edits of one product is out of scope: it is pre-existing on
    every tenant (`products/update.ts:55-59` deletes and rewrites the projections without a version check) and is the
    follow-up `CATPROD-CONSISTENCY-1` (§ 8.4). No transaction, version condition or re-read is specified for admin
    updates.
- *`importSource` is importer-owned (C11-3).* `products/create.ts` and `products/update.ts` add `importSource: true` to
  the `.omit({...})` lists of their parsed input (`create.ts:40-42`, `update.ts:39-41`), so an authoring request that
  carries it is ignored (stripped, not refused) — the same treatment `tenant/settings.ts` gives server-owned fields.
  `update.ts` merges the parsed input over the stored item (`:43`), so a stored `importSource` is kept and cannot be
  changed or removed. Only the glam importer writes it. So a product created by hand can never join a replacement
  set, and an update can never move a product into or out of one.
- *Guarantee (worded per cycle 13, C12-RECONCILIATION-BOUNDARY = A):* After a successful import: (a) the sheet's
  `PRODUCT#` items equal the file's set; (b) at the end of the reconciliation pass, the `CATPROD#` projections of
  every category the import touched equal those categories' current products, in the absence of an overlapping admin
  edit of one of those products (R3, `CATPROD-CONSISTENCY-1`); (c) public category pages follow the existing
  publication process — the handler's `withInvalidation` marks the invalidation
  (`backend/src/lib/invalidate-cdn.ts:259-271`), the debounced bulk invalidation publishes it
  (`docs/caching-architecture.md:358-375`) — so a warm page may show the previous set until that publication
  completes. A "successful import" is a 2xx answer; a 503 for incomplete categories (above) is not one. Nothing is
  claimed for other categories or for later admin edits.
- *Named windows and recovery:* between the deletes and the creates the producer's category pages are short of that
  file's products (seconds). If the job fails part-way, it answers non-2xx, and `withInvalidation` marks the CDN only
  for 2xx responses (`backend/src/lib/invalidate-cdn.ts:263-267`), so cached pages can still show the old set while
  the store holds a partial one. Recovery: import the same file again — the lock is released in `finally` (or
  expires), the replace runs in full, and its 2xx answer marks the CDN. The report of a failed job names the step
  it stopped at.

**Report shape.** Reused from the WooCommerce result where it fits (`backend/src/import/woocommerce.ts:200-207`:
`skipped`, `categoriesCreated`, `errors`): `{ dryRun, producer, sheet, variantName, importSource, totalRows, counts: {
deleted, products, options, deduped, skipped }, categoriesCreated, previousSet: { count, firstTitles[] }, rows:
GlamRowResult[], products: { productId, slug, title, rowIndexes, options: { value, imageLink?, rowIndexes }[],
differing: string[] }[], relabelled: { slug, value }[], suffixedSlugs: { slug, rowIndex }[] }`. `productId` is the
fresh id of the created product (absent in a dry run) — CAT-IMAGES-1 needs it directly (C8-4). `GlamRowResult` is a
sum on `status`: `created { index, slug, optionValue, image }` (the first row of a style) | `option { index, slug,
optionValue, image }` (a further option of that style) | `deduped { index, slug, optionValue }` (equal label and image
to an existing option) | `skipped { index, reason: "no-name" | "no-collection" | "separator-in-key", column? }`.
`deleted` is a count. Every row appears exactly once. `image` is `{ sourceUrl, disposition }`, `sourceUrl` the idx-9
cell as read (trimmed; `""` when empty), `disposition` one of `used` (the option's image), `absent`, `invalid` — the
column CAT-IMAGES-1 reads together with `products[].productId`.

**NO-CODES / NO-PRICES as a type guarantee.** The parsed row type has fields only for idx 0, 1, 6, 7, 8, 9, 10, 11; it
has no field for 2, 3, 4 or 5. The mapper's output `GlamProductDraft` (cat-import-1 § 4) has `title`, `description`,
`longDescription?`, `attributes`, `imageLink?`, `additionalImageLinks`, `variants` (exactly one group whose options
have only `value` and `imageLink?`), `brand`, `categoryKeys`, `slug`, `importSource`, `rowIndexes` — and no `price`,
`salePrice`, `volumePricing`, `sku`, `producerCode` or `personalizations` member, and no `priceOverride` or
`availability` on an option (typecheck proves the types; a unit test asserts the exact key sets). The importer writes
product items directly, so the CM-D1 refusal in `products/create.ts` is not on its path; the types are the guarantee,
and CAT-IMPORT-1's integration test asserts that no written item carries a monetary key (the CM-D1 list, which
includes a variant `priceOverride`).

**Future, named only (§ 1 addendum, item 2):** glamCRM populating the storefront when it imports a year's pricelists
— `GC-SITE-SYNC-1` (glamCRM) with the reserved `catalog:write` scope — and the cross-import identity it will need,
`GLAM-IDENTITY-MIGRATION-1`. Nothing is built for them here.

**Route placement (INFERRED recommendation, the operator ratifies in the packet).** Put the handler in CatalogApi
with the route in the parent stack, as `/import/wordpress`, `/import/media`, `/import/reviews` are
(`infra/lib/api-catalog.ts:216,232,253`; routes `infra/lib/api.ts:358-368`), **not** beside `/import/woocommerce`,
which lives in CommerceApi (`infra/lib/api-commerce.ts:500,513`) under the commerce freeze.

### 3.5 Interest-list contract (CAT-INTEREST-1)

> **The interest-list contract**: client-side shortlist persistence; submission payload (contact fields + `items[]`
> of product ids + titles at submission time); the backend record (D-5); notification; abuse posture. **Corrected
> 2026-10-27:** the forms posture is what `backend/src/forms/public-submit.ts` does — the browser calls the public
> route directly (`renderer/src/components/DynamicForm.tsx:56`, no renderer hop), the handler checks `x-tenant-id`
> against the request origin (`verifyTenantFromOrigin`, :18) and reCAPTCHA (deployment-level mandatory, :24-51).
> Forms have NO per-IP rate limit and NO honeypot today. The interest route mirrors that posture and adds size caps
> and item-id validation; a rate limit or honeypot is new work and is named as such if the spec wants it.

**Shortlist (client).** `localStorage` key `amodx:interest:<tenantId>` (cat-interest-1 § 2.1), items
`{ productId, title, slug, imageLink?, optionValue?, addedAt }` — a snapshot (CM-D4 AMENDED, cycle 10): `optionValue`
is the variant option the visitor chose in the catalog-mode variant presenter (§ 3.2.6), when one was chosen, and
`imageLink` is that option's image (else the product's main image). The choice comes from the variant presenter, not
from the gallery: `ProductImageGallery` keeps its selection in private state with no callback
(`renderer/src/components/ProductImageGallery.tsx:5-14`), so CAT-INTEREST-1 wires the presenter's selected option
into the "Mă interesează" control (C8-4). Deduped by `productId` + `optionValue`, **cap 50** (= the server cap; the
51st add is refused with a message, not dropped silently). Storage failure → the list lives for the page only
(cat-interest-1 § 2.1).

**Expired items (C8-3, operator ruling C8-EXPIRED-SHORTLIST-POLICY = A).** A re-import renews product ids (§ 3.4), so a
saved item can name an id the catalogue no longer has. When the list page renders, CAT-INTEREST-1 resolves the stored
ids against the current catalogue (named, not designed here); an id that no longer exists is shown as **expired** with
its snapshot title and must be reselected by the visitor; a submission carries only items that resolved. Nothing is
rebound by slug or by any other locator: slugs are URLs, not identity, and two different products can exchange slugs
between imports (§ 3.4 "Slug"). The cycle-8 slug-recovery text is withdrawn.

**Payload** (`POST /public/interest`, zod `InterestSubmissionSchema` in `packages/shared`, `.strict()` — unknown
keys refused): `{ name (1–200), email (valid, ≤254), phone? (≤40), message? (≤2000), items: [{ productId (≤64),
optionValue? (≤200) }] (1–50 entries), submissionToken (uuid v4, client-generated per send), recaptchaToken }`.
Client titles, slugs and images are not sent: the server records the title, slug and image it reads from the product
at submission time (the client cannot forge them; the record still shows what the visitor saw on that day). An
`optionValue` is kept only if it names one of that product's own variant options; the recorded image is that
option's `imageLink`, else the product's `imageLink`. `email` is required because it is the reply channel
(`Reply-To`, as `public-submit.ts:145`) and the identity glamCRM matches prospects on.

**Record (CM-D5 = (b), ratified 2026-10-28).** `PK TENANT#<tenantId>`, `SK FORMSUB#interest-list#<submissionId>`,
`Type: "FormSubmission"`, `id` (= `submissionId`), `tenantId`, `formId: "interest-list"`, `formName`,
`data: { name, email, phone, message, items: [{ productId, title, slug, optionValue, imageLink }] }`, `submitterEmail` (normalized),
`status: "new"`, `createdAt` — the same item shape as `public-submit.ts:118-133`.
`submissionId` = a hash of `submissionToken`, written with `attribute_not_exists(SK)`: a resend of the same list
(refresh, double click) creates no second record and answers 200 with the same id. This replaces cat-interest-1
§ 2.6's "dedupe within 10 minutes" — it needs no TTL and no extra item (whether the table has a TTL attribute was
not determined, § 8.3).

**The system form.** One reserved form id per tenant, `interest-list` (a constant `INTEREST_FORM_ID` in
`packages/shared`; forms created by `backend/src/forms/create.ts:48` get a random UUID, so no user form can take
it). Item `PK TENANT#<tenantId>`, `SK FORM#interest-list`, `Type: "Form"`, `id`, `tenantId`, `name: "Listă de
interes"`, `fields` (`[{id: "name"}, {id: "email"}, {id: "phone"}, {id: "message"}, {id: "items"}]`, each with
`label` and `type`), `status: "active"`, `createdAt`, `updatedAt` — the shape `forms/create.ts:52-64` writes, minus
`slug` and `notifyEmail`. The interest handler creates it on first use with `attribute_not_exists(SK)`. It
deliberately breaks `FormDefinitionSchema`'s `slug: min(1)` (`packages/shared/src/index.ts:1594`): it has no slug,
so it has no `FORMSLUG#` pointer and the generic public route (`public-submit.ts:58-63` resolves only through
`FORMSLUG#`) cannot reach it.

Fields the existing consumers read (so the record above carries them): the submissions route projects `id, formId,
formName, data, submitterEmail, status, createdAt` (`backend/src/forms/submissions.ts:27`); the admin page
`admin/src/pages/FormSubmissions.tsx` reads the form's `name` and `fields` (`:35,59,70`) and each submission's `id`,
`status`, `data[field.id]`, `submitterEmail`, `createdAt` (`:99-131`). It prints values with `String(...)`
(`:114,116`), so the `items` column needs a list renderer (CAT-INTEREST-1 § 2.5).

Backend protection (in CAT-INTEREST-1):
- `backend/src/forms/update.ts` refuses `id === INTEREST_FORM_ID` with 409 before any read or write. Reason: its two
  pointer writes — the slug-change transaction (`:69-86`, pointer at `:78-84`) and the name-change re-put
  (`:94-106`, pointer `FORMSLUG#${oldSlug}` at `:100`) — would create a pointer; for a form without a slug, `oldSlug`
  is `undefined` (`:43`), so the second write would create `FORMSLUG#undefined`.
- `backend/src/forms/delete.ts` refuses the id with 409 (it deletes `FORMSLUG#${slug}`, `:44`, and would orphan the
  submissions).
- `backend/src/forms/list.ts` (Query on `FORM#`, `:19-24`) leaves the id out, so the admin forms list never opens
  the editor on it — the editor requires a slug (`admin/src/pages/FormEditor.tsx:133-135`) and could never save it.
  MCP `update_form` / `delete_form` call the same routes and get the same refusals.
- The admin reaches the list through a sidebar entry shown under `isCatalogMode` that opens the existing route
  `forms/:id/submissions` (`admin/src/App.tsx:116`) with `interest-list`. Its back button goes to `/forms/${id}`
  (`FormSubmissions.tsx:65`) — the editor; CAT-INTEREST-1 points it elsewhere for this id.

**Notification.** Recipient: the tenant's `integrations.contactEmail` (`IntegrationsSchema`,
`packages/shared/src/index.ts:426`) — the address the contact form (`backend/src/contact/send.ts:75`) and the order
e-mails (`backend/src/orders/create.ts:457`) already use, set in Settings (`admin/src/pages/Settings.tsx:1230-1231`).
That setting is the one permitted configuration operation; the system form itself has no editable field. The handler
reads the tenant config it already reads (reCAPTCHA, mode check) and sends one SES e-mail, mirroring
`public-submit.ts:136-156`: `Source` from the tenant `name` (as `:143`), subject "Listă de interes — <name>", body =
contact fields + one line per item (title, the chosen option when there is one, public product URL), `Reply-To` = the visitor. A send failure is logged
and does not fail the request (as `:153-155`). If `contactEmail` is empty, no mail is sent — no fallback to the
platform sender address (`contact/send.ts:75` falls back to `FROM_EMAIL`; for this record that would send a
visitor's personal data to the platform's own mailbox). The record is still written and the admin list shows it.

**Abuse posture.** Mirrors forms: `verifyTenantFromOrigin` (`public-submit.ts:18-22`) and reCAPTCHA
(`:24-52`). Added: (1) refuse with 403 a tenant that is not `isCatalogMode`, the tenant config read with
`ConsistentRead: true` and a missing tenant record refused with 404 (CM-D11 accepted refinement); (2) the size caps
of the schema;
(3) item validation, in this order:
   - deduplicate the retained items by the pair `(productId, optionValue)` (first occurrence kept) — two options of
     one product are two items; only the FETCH KEYS are deduplicated by `productId`, because DynamoDB `BatchGetItem`
     refuses a request with repeated keys (C10-2);
   - cap: at most 50 distinct ids (the schema already caps the raw list at 50 entries);
   - read `PRODUCT#<id>` under the tenant's PK with `BatchGetCommand` in chunks of ≤ 100 keys, projection
     `id, title, slug, status, imageLink, variants` — the fields the record and the option check need (C8-4);
   - retry `UnprocessedKeys` at most 3 times with backoff; if keys are still unprocessed, answer **503**
     `{ error, retryable: true }` and write **nothing** (no record, no mail) — never a truncated list;
   - only after a complete read: an absent id is "unknown" (an expired item — no rebinding, C8-3), an item whose
     `status` is not `active` is "not available", an item whose chosen `optionValue` the current product does not
     have is **dropped** (`option-not-found`) — never turned into interest in the product without an option (C10-2);
     every dropped item is listed in the response with its reason (`dropped: [{ productId, optionValue?, reason }]`);
     zero valid items → 400.
   No rate limit
and no honeypot (RECOMMENDED: not built; the stage throttling of 50 rps / burst 100, `infra/lib/api.ts:130-131`,
applies to every caller). cat-interest-1 § 5 lists honeypot and 429 tests that its own
§ 2.3 does not ask for; the operator removes them when updating the packet (§ 8.5).

**What glamCRM would read (NOT open to keys today).** `SERVICE_ROUTE_SCOPES` (`backend/src/auth/policy.ts:15-18`)
lists exactly `GET /products` and `GET /leads`. Under (b) glamCRM needs `GET /forms/{id}/submissions`
(`backend/src/forms/submissions.ts`, `requireRole` at `:18` without a service scope) plus a new scope (proposed
`interest:read`), a table entry, and a handler check that admits a key **only** for the interest system form's id —
otherwise the key reads every form's submissions (contact forms with personal data). Also named: `submissions.ts`
reads one Query page (`:20-30`, no `LastEvaluatedKey` loop), so more than 1 MB of submissions is silently cut.
Under (c) glamCRM needs a new `GET /interest` route and a new scope. Either way, CAT-INTEREST-1 or a follow-up
opens it; it is not open now.

### 3.6 Byte-identity oracle for non-catalog tenants

> **The renderer byte-identity oracle for non-catalog tenants**: a named check that a tenant without the flag
> renders byte-identical HTML before/after CAT-MODE-1 (the live-tenants rule).

**Name: `CM1-BYTE-IDENTITY`.** Two layers; the hermetic layer is the gate, the staging layer is the operator's
confirmation.

**Layer 1 — hermetic (gate, run by the CAT-MODE-1 builder and the reviewer).** The serving-contract harness exists
(`renderer/test/serving-contract/`: `next build` + `next start` + a local DynamoDB stub, fixtures in
`fixtures.mjs`; `cd renderer && npm run test:serving`). Procedure:
1. Fixtures (added by CAT-MODE-1 to the stub data, used by both builds): one **commerce** tenant
   (`commerceEnabled: true`, no `catalogMode` key) with products covering every branch of § 3.2 — sale price,
   volume tiers, variants, `preorder`, `out_of_stock`, a Paddle `paymentLinkId`, a `categoryShowcase` block — and
   one **content** tenant (`commerceEnabled: false`, no `catalogMode` key) with one product and one category
   (product pages render without commerce, `SitePage.tsx:214`).
2. Baseline = a `git worktree` of the commit CAT-MODE-1 starts from, built with the same stub data; candidate = the
   slice's tree. Same request list against both.
3. URLs per tenant: `/`, one content page, `/shop`, `/shop?availability=in_stock`, `/category/<slug>`,
   `/product/<slug>` for each fixture product, `/products/<id>` (legacy), `/search?q=<term>`, `/cart`,
   `/checkout`, `/sitemap.xml`, `/openai-feed`, `/robots.txt`, `/llms.txt`. Capture: status, `Content-Type`,
   body bytes (saved as files; the files are committed as the slice's evidence, as cat-mode-1 § 5 asks).
4. Masks (applied to both sides before comparison, each with its count reported): `/_next/static/…` asset paths
   (chunk and CSS hashes), the Next build id, and the client-reference rows of the RSC flight payload
   (`self.__next_f.push` lines with `I[` module references: module ids and chunk lists). These change with any
   build and say nothing about what the visitor or a crawler reads.
5. Pass = every masked body is byte-identical (`cmp`) and every status/`Content-Type` is equal. Any other
   difference fails the gate — including JSON-LD, visible text, attribute order and whitespace.

**Layer 2 — staging (operator, after deploy to staging, before prod).**

*Unresolved prerequisite:* the operator supplies the two staging tenant ids — one `commerceEnabled` tenant with
active products and categories, one content-only tenant — at the launch of `cat-mode-1`. No repo document names a
staging tenant (§ 8.3); this spec does not invent ids. Until they are supplied, Layer 2 is defined but not runnable.

Same URL list as Layer 1, with the tenants' real slugs. Capture before and after the staging deploy. The capture must
reach the origin; an edge hit would compare an old cached body with itself and pass falsely.

- *Why a query string alone is not enough.* CloudFront keys only an allowlist of query parameters
  (`infra/lib/renderer-hosting.ts:568-587`: `page`, `q`, `availability`, `id`, `email`, `preview`, `nf`). Any other
  parameter (e.g. `utm_source`) collapses onto the bare-path entry, and a warm entry is answered at the edge before
  middleware runs (`renderer-hosting.ts:537-542`; `renderer/middleware.ts:318-320`).
- *The parameter.* Append `id=cm1-<capture-run-id>` (a new value per capture run, e.g. a UTC timestamp). `id` is in
  the allowlist, so each new value is a cache-key miss that reaches the origin. It does not change the representation
  of any URL in the list: the render body reads `query.id` only on the order-confirmation page
  (`renderer/src/components/SitePage.tsx:353-354`), which is not in the list; the route handlers (`sitemap.xml`,
  `openai-feed`, `robots.txt`, `llms.txt`) do not read it (INFERRED from their source, § 3.3). At the origin, a
  page request with a query string is routed to the no-store `%5Fdyn` twin (`renderer-hosting.ts:562-567`), which
  shares the page render body with the ISR route (`docs/caching-architecture.md:88-95`); the route handlers have no
  twin (`renderer/middleware.ts:122`) and are `force-dynamic` (e.g. `sitemap.xml/route.ts:4`). The value must be new per run
  because route-handler responses carry `s-maxage` (e.g. `sitemap.xml/route.ts:71`) and a repeated value could be
  answered from an entry the previous run created.
- *Existing query parameters are kept.* `/shop?availability=in_stock` → `/shop?availability=in_stock&id=cm1-<run>`;
  `/search?q=<term>` → `/search?q=<term>&id=cm1-<run>`.
- *Required evidence per URL and per capture:* the `x-cache` response header value, which must be
  `Miss from cloudfront`, recorded beside the status, `Content-Type` and the saved body. A URL whose capture shows a
  hit is captured again with a new run id; it is never compared.
- Alternative, if the operator prefers the cacheable route itself: a CloudFront invalidation of exactly the
  captured paths before each capture, with the same `x-cache: Miss from cloudfront` evidence per URL.

Same masks, same pass rule as Layer 1. The live data must not change between the two captures (the operator states,
from the audit log, that no product, category, page or setting of the two tenants changed in between).

### 3.7 Facets — the new slice `cat-facets-1` (named, not designed here)

> Human direction, 2026-10-28: "The storefront should have filters and categories and producers and whatnot for all
> applicable fields." (§ 1 addendum, item 3)

**Requirement.** On the shop page and on category pages a visitor filters by producer (`brand`), collection, format,
unit, packaging and minimum order — every `attributes` key the import writes (§ 3.4) — and sees a count per value.

**Named, for the slice to design:**
- *Facet source.* The products' `attributes`, `brand` and — since cycle 10, when `format` became the variant label —
  the variant option values. None reaches the listing pages today: the `CATPROD#`
  projection (`backend/src/lib/catprod.ts`, `ProductCardProjection` from `:11`) carries no `brand` and no
  `attributes`, and the shop read projects neither (`renderer/src/lib/dynamo.ts:344`). The projection must gain them
  (or the facet read must use another source the slice names).
- *URL state.* Filters live in query parameters. Consequence: the CloudFront cache-key allowlist
  (`infra/lib/renderer-hosting.ts:568-587`, today `page`, `q`, `availability`, `id`, `email`, `preview`, `nf`) must
  carry the facet parameters, or a filtered page collapses onto the bare-path entry and shows the unfiltered page
  (the allowlist's own rule (a), `renderer-hosting.ts:544-548`). An infra change, with a named gain: filtered pages
  that are correct and cacheable.
- *Order.* After `cat-mode-1` and `cat-import-1`: it needs real imported data to choose the facets and test counts.
- *ROADMAP row:* added by the operator.

## 4. DECISION_REQUIRED blocks

DECISION_REQUIRED:
- ID: CM-D1-PRICE-ABSENCE
  QUESTION: `ProductSchema.price` is REQUIRED (`z.string()`). How does a catalog product carry no
    price without lying?
  OPTIONS:
  - (a) TENANT-MODE SUPPRESSION ONLY: schema unchanged; the importer writes `price: "0"`; every
    render/feed surface is gated by `catalogMode`. RISK: a stored "0" is a lie in the data — one
    missed surface (a future feed, an MCP tool, an export) publishes "0 lei"; the data cannot be
    trusted by itself. REWARD: no schema change, no migration, smallest diff.
  - (b) PRICE OPTIONAL UNDER CATALOG MODE: `price` becomes optional in the shared schema with a
    refinement "required unless the tenant is catalogMode" enforced at the write boundary; the
    importer writes NO price; render surfaces treat absence as "nothing to show". RISK: a shared
    schema change touches every product writer/reader (backend, renderer, admin editor, MCP) —
    each must handle absence honestly; a cross-cutting diff. REWARD: the data tells the truth —
    there is no price to leak, by construction; no surface can fabricate one.
  RECOMMENDED: (b). The human's ruling is "without prices", not "with hidden prices"; the
    standing honest-absence law applies to data as much as to UI. The write-boundary refinement
    keeps commerce tenants exactly as strict as today.
  RATIFIED 2026-10-27 (human, accepting the operator's recommendation): **(b), together with
    CM-D6 = A.** With the order guard, no catalog-tenant request reaches the CommerceApi code that
    reads `price` (`orders/create.ts:120`); `products/bulk-price.ts` is checked for priceless
    items (read, no change expected) and the result is recorded in the surface table.
  BLOCKING_REASON: fixes the shared product contract that CAT-IMPORT-1, CAT-MODE-1 and the MCP
    tools all build against; reversing it after products exist is a data migration.

*Implementation note to the ratified CM-D1 (builder, 2026-10-28; not a reopening — the decision-review pass may
contest the second bullet):*
- The write boundary is `backend/src/products/create.ts:40-42` (`ProductSchema.omit(…).parse`) and
  `backend/src/products/update.ts:39-41` (`.partial().parse`, on the merged item for the rule). Neither reads the
  tenant config today. `create.ts` runs with `table.grantWriteData` only (`infra/lib/api-catalog.ts:179`); the
  refinement adds a `GetItem` of `SYSTEM / TENANT#<id>`, so the grant must become `grantReadWriteData` in the
  same change — the slug-guard regression class. `update.ts` already has read-write (`:200`).
- Rule for a catalog tenant: `price`, `salePrice`, non-empty `volumePricing`, any variant option `priceOverride`
  and a non-empty `personalizations` array are **refused** (400), not dropped (CM-D8 accepted refinement,
  2026-10-28; the cycle-2 exception for `addedCost: "0"` is deleted). A key that is present is refused even when its
  value is `""`; authoring paths omit the key (§ 3.2 closing rule). Why the whole array: `addedCost` is a stored
  monetary field (`packages/shared/src/index.ts:973`, `z.string().default("0")`; read as a cost at
  `backend/src/orders/create.ts:131`), `ProductSchema` parsing writes the `"0"` default into every personalization,
  and a stored `"0"` is still a monetary value on a public route (`products/public-get.ts:43` returns the whole item).
  Every reader of `personalizations` is a commerce path (decision-review evidence), so under catalog mode nothing
  needs them; refusing the array means the default can never be written. This list is the complete
  set of monetary fields; a catalog tenant stores none of them from creation on (CM-D11). Basis: the plan's non-goal "No price storage of any kind for catalog tenants (not
  even hidden — see D-1)" (`docs/plan-glam-catalog.md:123-124`), ratified as CM-D8 = A.
- Bulk price checked as asked: priceless products are skipped (`bulk-price.ts:111-112`), § 3.2.4.
- Products that carry `importSource` (cycle 11, C10-3; applies on create and update, catalog tenants only — products
  without `importSource` and every non-catalog tenant behave as today): exactly one variant group (otherwise 400);
  option `value`s unique in normalised form (otherwise 400); an option `imageLink` of `""` refused (400) — absence is
  the omitted key (CM-D7 extended to option images); `imageLink` and `additionalImageLinks` recomputed from the
  options by the § 3.4 derivation rule before the write, replacing whatever the request sent.
- `products/update.ts` (cycle 11, C10-1; cycle 12 scope): the product `Put` (`:50`) carries `ConditionExpression:
  "attribute_exists(PK)"` (a cancelled write answers 404; the `CATPROD#` rebuild at `:55-59` then does not run). The
  rebuild itself stays as today. The cycle-11 transactional projection protocol and its "more than fit → 400" category
  limit are withdrawn (§ 8.16). `products/create.ts` and `update.ts` omit `importSource` from their parsed input
  (`create.ts:40-42`, `update.ts:39-41`) — importer-owned (§ 3.4).

DECISION_REQUIRED:
- ID: CM-D2-IMAGE-POLICY
  QUESTION: glam's enriched lists carry PRODUCER image URLs (external hosts). Hotlink or ingest?
  EVIDENCE (builder, 2026-10-28):
  - The copy step exists, but not where option (b) says. `import/woocommerce.ts` only rewrites URLs through a map
    (`rewriteUrl`, `:196-198`, used `:369-370`). The copy is `downloadAndUploadImage`
    (`backend/src/lib/image-upload.ts:23-70`, called by `import/media.ts`), and the map is `MEDIAMAP#<md5(url)>`
    (`backend/src/lib/media-map.ts:5-7,13-28`) — idempotency by source URL already exists.
  - That copy step has no fetch timeout, no size cap and no content check: `fetch(imageUrl)` follows redirects
    (`image-upload.ts:29`), and a missing content-type becomes `image/jpeg` (`:35`). A 302-to-HTML answer (the BNR
    shape) would be stored as an asset. CAT-IMAGES-1 must add timeout, size cap and magic-byte check (its § 2.1
    already asks for them); it should reuse `MEDIAMAP#` instead of a new `externalRef.media[]` (cat-images-1 § 2.1).
  - Option (a)'s "`next/image` needs an allowlist per host" is not true today: product images render with plain
    `<img>` (`renderer/src/components/SitePage.tsx:627`, `ProductImageGallery.tsx:20`). The hotlink risks that
    remain are link rot, producer hotlink blocking, and the visitor's browser calling a third-party host.
  OPTIONS:
  - (a) HOTLINK: `imageLink` = the producer URL as imported. RISK: producer sites move/rot (the
    BNR-URL incident shape: a silent 302-to-HTML killed a feed for five weeks); `next/image` needs
    an allowlist per host; a dead link = honest absence on a storefront that is ALL images.
    REWARD: zero storage, zero copy step, instant import.
  - (b) INGEST on import: the WooCommerce importer's existing `mediaMap`/`rewriteUrl` path copies
    each image into tenant media (S3/CDN) and stores the tenant URL; failures are reported per
    row in the dry-run/import report and render as honest absence. RISK: import time + storage;
    a copy step that must be idempotent (re-import must not re-upload unchanged images — key by
    source URL hash). REWARD: the storefront's images are the tenant's and stable; no external
    allowlist; the same media pipeline reviews/content already use.
  RECOMMENDED: (b), as CAT-IMAGES-1 riding CAT-IMPORT-1's report. A storefront whose images rot
    with a third party's web redesign is the BNR incident with pictures. Confirmed 2026-10-28 with the
    evidence above: the reusable parts are `image-upload.ts` + `media-map.ts`, and the validation they lack is
    CAT-IMAGES-1 work, not a reason to hotlink. "Honest absence" for a failed image needs CM-D7.
  RATIFIED 2026-10-28 (human): (b), with the destination policy of the decision-review's corrected cell — http/https
    only; the resolved address is refused when it is loopback, RFC 1918, link-local, CGNAT, ULA, IPv6 link-local,
    unspecified or IPv4-mapped to any of these; the connection goes to the checked address; `redirect: "manual"`,
    the policy re-run on each hop, at most 3 hops; then timeout, size cap and magic bytes.
  BLOCKING_REASON: decides whether CAT-IMAGES-1 exists and what `imageLink` means for catalog
    products.

DECISION_REQUIRED:
- ID: CM-D3-IDENTITY-KEY
  QUESTION: What is the import's idempotency key?
  EVIDENCE (builder, 2026-10-28):
  - The codification is not in the file. glamCRM `docs/PRICELISTS.md` § 1 defines the canonical layout as idx 0–11
    (no codification column); § 2: the codification is "minted once, STORED" by glamCRM's own import;
    `pl-tools/README.md:30`: pl-tools outputs the "canonical 12-col CSV". So under (a) the amodx importer needs a
    13th column (`codificare internă`) from a glamCRM export that does not exist yet. A pl-tools file cannot be
    imported under (a). This changes the plan's Phase 1 ("a human doing the import from the admin UI",
    `docs/plan-glam-catalog.md:57`): the first import waits for that glamCRM export.
  - Option (a)'s premise "`attributes` is rendered" is not true today: no renderer file reads `attributes`
    (EXECUTED grep, § 8.1). The real leak path is wider: `GET /public/products/{slug}` returns the **whole**
    DynamoDB item (`backend/src/products/public-get.ts:43` since `569202e`, `:40` before; `JSON.stringify(product)`; noAuth route in CommerceApi,
    `infra/lib/api-commerce.ts:207`). Any field on the product item — a dedicated `externalRef` too — is public.
    Changing `public-get.ts` is a CommerceApi change outside the named exceptions (CM-D6, CM-D8 guard 1).
  - Lookup cost: with the key on the product, each import must Query every `PRODUCT#` item of the tenant (or add a
    GSI) to find matches. A lookup item is one `GetItem`/`BatchGet` per key — the pattern of `FORMSLUG#`,
    `COUPONCODE#`, `SVCKEYHASH#`.
  OPTIONS:
  - (a) glam INTERNAL CODIFICATION (`category-pricelist-collection-idx`, immutable by glam law,
    unique among active products) stored on the amodx product in a NON-RENDERED field (e.g.
    `attributes` is rendered — so a dedicated `externalRef: { system: "glamcrm", key }` field).
    RISK: a new shared field; the key is glam-internal and must never reach a render surface
    (the spec names the oracle). REWARD: exact, stable identity across yearly replacements —
    glam's replacement law carries the codification onto the new product, so the site updates
    in place.
  - (a2) the same key, stored in a LOOKUP ITEM, not on the product: `PK TENANT#<tenantId>`,
    `SK PRODUCTREF#glamcrm#<key>` → `{ productId, contentHash, sourceImageUrl }`, written with the product in one
    transaction (shape updated in cycle 3; `sourceImageUrl` drives the image rule, § 3.4).
    RISK: two items to keep consistent — deleting a product in admin leaves the lookup item (the importer detects
    the missing product, re-creates, repoints and reports it); the key is still glam-internal data stored in amodx.
    REWARD: the key never sits on the product, so `public-get.ts`, the renderer, the admin product JSON and MCP
    `get_product` cannot publish it without any CommerceApi change; O(1) match per row. Corrected in cycle 2:
    "unchanged" also needs one projected existence read of the product per matched row, because
    `products/delete.ts:32-41` does not remove the lookup item (§ 3.4).
  - (b) title+collection+producer composite. RISK: a renamed product duplicates; a producer
    rename orphans a whole collection. REWARD: no new field.
  RECOMMENDED: (a2) — the identity glam built for this purpose (a), stored where no public read returns it. The
    input contract (§ 3.4) requires column idx 12; a file without it is refused, never matched by position. The
    dependency on a glamCRM export is named for the human: it is glamCRM work (non-scope here, § 5).
  RATIFIED 2026-10-28 (human): (b), the title + collection + producer composite — against the recommendation;
    reward taken: no new field and no wait for a glamCRM export (the first import runs from the 12-column pl-tools
    file); risks accepted as named (a renamed product duplicates; a producer rename orphans a collection).
    Operator correction the same day, before launch: the composite also includes `format` (idx 11), because under
    CM-D4 (a) the rows of one model differ only in format — defined in § 3.4.
  EVIDENCE (operator, 2026-10-28, file measurement; reproduced by the builder, § 8.1): over every
    `out/<vendor>/enriched/*.csv` in `../glamCRM/pl-tools` (24 files: alpod 21, boen 1, itc 2; 2,861 product rows),
    915 rows repeat an earlier row's normalised (colecție idx 0, produs idx 1, format idx 11) within the same file —
    113 groups, 1,028 rows; alpod 888 of 1,803 rows (AUR.csv: 212 of 219 — `produs` is "Wood" / "Dryback", the
    identity is the producer code, e.g. `AURPLA-1001/1`), boen 23 of 478, itc 4 of 580. Inside the groups: 21 have no
    image at all; producer codes are all-distinct in 82 groups; the operator counts 58 groups with a distinct image
    URL on every row (decors) and 34 that share some URLs (one producer code at several quantity-price tiers, e.g.
    `EXTDEC-CUM11x` ×3) — the builder's re-count gives 51/41 when "every row has its own image" and 60/32 when "no URL
    is shared among rows that have one"; the split depends on that definition, the totals match. The collection column
    is filled on every product row; price columns 3–4 and code columns 2 and 5 are present in the file. Builder
    spot-check: AUR.csv's most frequent `produs` values are "Wood" (92 rows), "Herringbone" (52), "Stone" (48), with
    codes such as `AURPLA-1001/1`; `EXTDEC-CUM11x` occurs 3 times in `alpod/enriched/DEC.csv`.
  AMENDED 2026-10-28 (human, on the file evidence): the composite is the identity of a storefront product WITHIN ONE
    IMPORT; no cross-import identity exists (disposable); the lookup item, the conditional transactional writes and
    the conflict/duplicate-key statuses are withdrawn. (Specified in § 3.4; the normalisation order is trim →
    whitespace collapse → lower-case → NFC last, per the decision-review's CM-D3 correction.)
  AMENDED 2026-10-28 (human, cycle 10, on the per-vendor evidence in CM-D4): the composite loses `format` — the
    product key is producer + colecție (idx 0) + produs (idx 1), normalised as in § 3.4 (the `\u001f` rule
    unchanged); `format` is the variant label. Still within one import only; slugs are URLs, never identity.
  BLOCKING_REASON: idempotency semantics of every import after the first.

DECISION_REQUIRED:
- ID: CM-D4-EXPLODE-VS-GROUP
  QUESTION: glam's law is one product per colour/format variant (needed for ordering). Does the
    storefront show 462 BOEN rows, or group variants under one presentational product?
  EVIDENCE (builder, 2026-10-28) — what `variants` means today:
  - `ProductVariantSchema` (`packages/shared/src/index.ts:977-986`) is an option GROUP `{id, name}` (e.g.
    "Weight") with `options[{ value, priceOverride?, imageLink?, availability? }]`. Options have no id.
  - The only renderer reader is `AddToCartButton` (`SitePage.tsx:834`), which renders only when `commerceEnabled`
    (`:824`). It uses the first group only to resolve the effective price and availability
    (`AddToCartButton.tsx:76-77`); it renders every group's selector (`:172-178`), requires a selection in every
    group (`:126-131`) and puts every group in the cart label (`:133-135`). The option `imageLink` is shown by no
    renderer surface. Writers: admin `ProductEditor.tsx:390-415` (Variants tab), `import/woocommerce.ts:418-441`;
    `orders/create.ts:150` copies the client's `selectedVariant` string.
  - So today `variants` means "purchase options for the cart". Under catalog mode no rendered page shows them. Option
    (b) would need a new catalog presenter AND a per-option key field — the grouping heuristic is only part of its
    cost.
  OPTIONS:
  - (a) ONE-TO-ONE: each glam product = one amodx product. RISK: category pages of near-identical
    rows; the visitor's "interest list" fills with variants of one floor. REWARD: trivial mapping;
    the identity key is 1:1; no inference.
  - (b) GROUP BY STYLE: the importer groups rows sharing (producer, collection, base name) into
    one product with `variants[]` options (colour/format), each option carrying its own image and
    its own glam key; the interest list records the chosen option. RISK: the grouping rule is a
    heuristic over names — a wrong split or merge misrepresents the catalog; the identity key
    becomes per-option. REWARD: a storefront that looks like a storefront.
  RECOMMENDED: (a) for the first import, with the grouping rule as a NAMED follow-up once the
    human sees real category pages — a heuristic over producer naming must be ratified against
    real data, not guessed in a spec (the glam pl-tools history: every "uniform layout" assumption
    was refuted by the raw files). Confirmed 2026-10-28: (a) also matches glamCRM's EXPLODE RULE ("every
    variation … becomes ITS OWN product line with its own codification", PRICELISTS § 2), and (b) would build on a
    field whose current meaning is cart options.
  RATIFIED 2026-10-28 (human): (a); grouping is the named follow-up, written only after real category pages are
    seen.
  EVIDENCE (operator, 2026-10-28, file measurement): the same measurement as CM-D3 — 113 groups of rows equal in
    (colecție, produs, format) within one file, 1,028 rows; most are decors or quantity-price tiers of one model.
  AMENDED 2026-10-28 (human, on the file evidence): one storefront product per DISTINCT composite; rows equal in the
    composite are that product's gallery. The rule is exact equality on the file's own fields — no naming
    heuristic; the "grouping follow-up" is withdrawn, the data decided it. (Specified in § 3.4 "Grouping".)
  EVIDENCE (operator, 2026-10-28, measured on `../glamCRM/pl-tools`; reproduced by the builder where marked, § 8.1):
    the raw ALPOD Aurora sheet has the columns `Product Group | Collection | Model | Type | Decor | Surface`, and
    `vendors/alpod.config.mjs:79` maps `produs: [2]` (Model only) — the Decor column is dropped at normalisation, which
    is why AUR.csv has 7 distinct `produs` for 219 rows and 48 distinct images for 216 image rows (reproduced), each
    decor recurring under pack-variant codes `/0 /1 /2`; KRO maps `[2]` (`:64`), EGP `[2, 4]` (`:70`) (both read by
    the builder). ITC Arc_Edition's `produs` is style + colour number ("Altona UX Altona 34"): stripping the trailing
    number gives 66 styles, 8.1 colours per style on average (reproduced: 536 rows, 366 distinct images). BOEN's
    `produs` is decor + finish and `format` is the plank size. The 12-column layout has no style/variant grain;
    `format` (idx 11) is per-vendor (PRICELISTS.md § 2).
  AMENDED 2026-10-28 (human): a storefront product is a STYLE; every row of that style is a VARIANT labelled by
    `format`, with its image — one variant group per product (the existing `ProductVariantSchema`), one option per
    row, equal label and image deduped, `priceOverride`/`availability` never written; `imageLink` and
    `additionalImageLinks` derived from the option images; `cat-mode-1` adds a read-only catalog-mode variant
    presenter. Supersedes the cycle-8 "one product per distinct composite, the other rows as its gallery". Specified
    in § 3.4 "Variants".
  BLOCKING_REASON: the product count, the identity key's grain and the interest-list payload.

DECISION_REQUIRED:
- ID: CM-D5-INTEREST-RECORD
  EVIDENCE (operator code check 2026-10-27): a Lead is ONE record per person per tenant —
    `SK: LEAD#<email>`, written by an unconditional `Put` from three handlers
    (`leads/create.ts:62-66`, `contact/send.ts:99`, `comments/create.ts:68`); `DELETE
    /leads/{email}` addresses it by email. A second interest list from the same visitor, or a
    later contact-form message or blog comment, OVERWRITES the first list. A FormSubmission is
    one record per submission (`SK: FORMSUB#<formId>#<submissionId>`, `forms/public-submit.ts:122`)
    and the handler already sends the tenant a notification email (:143).
  EVIDENCE (builder, 2026-10-28):
  - **No status workflow exists for leads or for submissions.** `LeadSchema.status` is an enum
    New/Contacted/Converted/Archived (`packages/shared/src/index.ts:919`), but the only lead routes are
    POST/GET `/leads` and DELETE `/leads/{email}` (`infra/lib/api.ts:529,534,546`); the admin leads page reads
    and deletes (`admin/src/pages/Leads.tsx:21,33`) and shows the status as text (`:104`); every writer puts
    `status: "New"` (`leads/create.ts:70`, `comments/create.ts:74`). FormSubmission also stores `status: "new"`
    (`public-submit.ts:130`) with no route to change it (`forms/submissions.ts` is a read). So option (a)'s
    "existing … status workflow" is a name without a mechanism, and (c)'s status workflow is all new build.
  - (a2)'s three writers are not cheap to change: they live in three handlers in two stacks, each would move from
    `Put` to a merging `UpdateExpression`, and `DELETE /leads/{email}` would still erase every list.
  - Who follows up: the plan has glamCRM "pull interest leads as prospects, link them to projects/offers"
    (`docs/plan-glam-catalog.md:53-55`) — follow-up status is tracked in the sales tool, not in the website admin.
  - Admin display: `FormSubmissions.tsx:99-116` prints each field with `String(...)`; an `items` array would print
    "[object Object]". Under (b) CAT-INTEREST-1 changes that view (cat-interest-1 § 2.5 already plans an admin
    view change).
  - glamCRM read under (b): `GET /forms/{id}/submissions` + new scope, admitted only for the system form (§ 3.5);
    under (c): new `GET /interest` + new scope. Neither is open to keys today (`policy.ts:15-18`).
  QUESTION: Where does an interest-list submission live so that no submission is lost?
  OPTIONS:
  - (a) LEAD AS TODAY (`data.items[]` on `LEAD#<email>`). RISK: silent loss — the next touch
    from the same email replaces the items; glamCRM reads only the last one. REWARD: the existing
    leads view and status workflow. Not acceptable without (a2).
  - (a2) LEAD + MERGE: the interest handler updates `LEAD#<email>` with a conditional append to
    `data.interestLists[]` (one entry per submission, capped). RISK: the other three writers still
    `Put` and would erase the appended history unless they change too — that widens the slice into
    contact/comments/leads handlers. REWARD: one person record carrying every list.
  - (b) FORM SUBMISSION on a system form "Listă interes" per catalog tenant. RISK: no status
    workflow (New→Contacted) — the client tracks follow-up elsewhere; items are a structured field
    on a generic record; glamCRM reads form submissions (a `forms`-scoped read, not `leads:read`).
    REWARD: one record per submission by construction, the abuse posture and the notification
    email already exist, no change to other writers.
  - (c) NEW RECORD `INTEREST#<submissionId>` with its own status field, plus the usual person-Lead
    upsert for the contact. RISK: a new record type, a list route and an admin view (the largest
    option). REWARD: per-submission history AND a status workflow, nothing overwritten.
  RECOMMENDED: (b). Against the criterion: (1) the client does not need a follow-up status per list in amodx —
    follow-up happens in glamCRM, and amodx has no status mechanism for any record today, so (c) would build one
    for a need the plan places elsewhere; (2) glamCRM reads one record per submission, never overwritten, through
    one scoped read admitted only for the system form. (b) reuses the record shape, the notification and the
    abuse posture; it changes no other writer. Choose (c) instead if the human wants the client to track
    follow-up inside the amodx admin — that is the one fact that flips this recommendation.
  RATIFIED 2026-10-28 (human): (b).
  BLOCKING_REASON: the record glamCRM will read; the admin surface the client works from.

DECISION_REQUIRED:
- ID: CM-D6-ORDER-GUARD
  QUESTION: "No possibility of ordering" — enforced in the renderer only, or at the order API?
  OPTIONS:
  - (A) GUARD IN THE ORDER HANDLER: `backend/src/orders/create.ts` (CommerceApi) refuses with 403
    unless the tenant's `commerceEnabled` is true. About 3 lines; Lambda code only, no infra.
    RISK: a named exception to the "do not touch commerce" rule; a selling tenant with the flag
    unset would stop receiving orders (the implementing slice reads every live tenant's flag first
    and states the result). REWARD: the promise holds at the API for every non-selling tenant, not
    only the catalog one.
  - (B) RENDERER ONLY. RISK: a direct POST writes a real order on a catalog tenant ("0" or NaN
    totals). REWARD: no commerce code touched.
  RATIFIED 2026-10-27 (human): **(A)**, implemented inside CAT-MODE-1 as its one named exception to
    the commerce-track freeze.

DECISION_REQUIRED:
- ID: CM-D8-WRITE-CLOSURE
  QUESTION: How does the spec reconcile the no-price-storage guarantee for catalog tenants with the existing product
    write paths and the CommerceApi freeze? (Raised by review-0 R1: `import/woocommerce.ts:459` writes
    `price: regularPrice || '0'` without the schema; `products/public-get.ts:40` publishes the whole stored item;
    a tenant switched to catalog mode keeps the prices its products already carry.)
  OPTIONS:
  - (A) CLOSE EVERY DOOR INSIDE CAT-MODE-1: narrowly bounded catalog guards — the WooCommerce importer refuses a
    catalog tenant; `PUT /settings` refuses a switch to catalog mode while any product carries a monetary field;
    the CM-D1 write refusal covers every monetary field, `addedCost` included. RISK: widens the named exception to
    the commerce freeze (a second CommerceApi file) and adds implementation checks. REWARD: the data guarantee
    holds on every write path, so no read path (public JSON, MCP, feeds, future exports) can publish a price for a
    catalog tenant.
  - (B) KEEP THE FREEZE; BLOCK THE ROLLOUT: no catalog tenant goes live until a separately approved slice closes
    these paths. RISK: the glam catalog delivery waits for that slice. REWARD: scope control and the invariant both
    kept.
  - (C) NARROW THE REQUIREMENT: guarantee absence only on the import and render paths. RISK: a stored price on a
    catalog tenant is possible and is published by the public JSON route; it needs an explicit change to the
    plan's no-price law. REWARD: no extra guards.
  RECOMMENDED: A
  RATIFIED 2026-10-28 (human): **A** — every price door closed inside `cat-mode-1`.
  ACCEPTED REFINEMENT 2026-10-28 (operator, from the decision-review, within the ratified A): on a catalog tenant a
    non-empty `personalizations` array is refused (400) with price, salePrice, non-empty volumePricing and any variant
    priceOverride; the `"0"` exception is deleted.
  BLOCKING_REASON: the spec promised a tenant-wide invariant while it left reachable violations as follow-ups; a
    build iteration could not grant the scope to close them.

*CM-D8 specification — the three guards `cat-mode-1` implements:*

1. **WooCommerce import refusal — the second named exception to the commerce freeze.** Route
   `POST /import/woocommerce` (`infra/lib/api-commerce.ts:513`, CommerceApi). `backend/src/import/woocommerce.ts`
   reads the tenant config (`GetItem` `PK SYSTEM`, `SK TENANT#<tenantId>`) after the role and body checks
   (`:214-228`) and before the CSV parse (`:230`) — that is, before its first write (the category `PutCommand` at
   `:336`). For a catalog tenant it refuses with the CM-D6 response: CM-D6 says the order handler "refuses with
   403" with a business-language message (`docs/slices/cat-mode-1.md` § 2.6), and the backend's error body shape is
   `{ error: "<message>" }` (e.g. `orders/create.ts:98-101`). So: **403**, `{ error: "<business message>" }`,
   nothing written, no audit entry for an import. Grant: `wooImportFunc` already holds `grantReadWriteData`
   (`infra/lib/api-commerce.ts:510`); no grant changes. This start-of-job refusal is the whole guarantee: the mode
   is fixed at creation (CM-D11), so it cannot change while the import runs. No other line of the importer changes.
2. **Mode change in `PUT /settings`** — as ratified, a guard against switching into catalog mode with priced
   products. Under CM-D11 it becomes simpler: the narrow parse of `{ commerceEnabled, catalogMode }` on the merged
   item refuses any change of `catalogMode` (400) and `commerceEnabled: true` on a catalog tenant (400); no product
   query, no grant change (§ 3.1). A catalog tenant therefore starts with no products and only ever receives writes
   that refuse monetary fields.
3. **`addedCost`** — added to the CM-D1 refusal list (implementation note under CM-D1). Superseded by the accepted
   refinement of 2026-10-28: a non-empty `personalizations` array is refused, so no `addedCost` — not even the `"0"`
   default — is stored on a catalog product (§ 8.4 F-6).

With the three guards, the CM-D1 refusal and the glam draft type (§ 3.4), every product write path is covered:
`products/create.ts`, `products/update.ts`, `products/bulk-price.ts` (writes only already-priced products),
`import/woocommerce.ts`, the glam importer (§ 3.1 table of backend readers; EXECUTED grep, § 8.1). There is no
concurrency case: the mode a writer reads cannot change before it writes (CM-D11).

DECISION_REQUIRED:
- ID: CM-D9-TRANSITION-COORDINATION
  QUESTION: What enforcement must protect CM-D8 against product writes already running when catalog mode is
    enabled? (Raised by review-1 C2-1: a writer reads `catalogMode=false`; the settings guard finds no priced
    product; settings stores `catalogMode=true`; the earlier writer stores its priced product — the violation
    persists after both requests end. An already-running WooCommerce import has the same shape.)
  OPTIONS:
  - (A) COORDINATE MODE CHANGES AND PRODUCT WRITES: a defined transactional protocol across the affected writers.
    RISK: requires a transactional or locking protocol across the writers (more implementation and tests). REWARD:
    the tenant-wide guarantee holds under concurrency.
  - (B) ENFORCED QUIESCENT TRANSITION: an operational procedure that excludes concurrent writes until coordinated
    transitions exist. RISK: an operational restriction, and evidence is needed that concurrent writes are
    excluded. REWARD: a bounded implementation change.
  - (C) ACCEPT THE RACE: narrow CM-D8's guarantee. RISK: catalog products can keep and publicly expose prices;
    changes the ratified requirement. REWARD: the proposed mechanisms stay as they are.
  RECOMMENDED: A
  RATIFIED 2026-10-28 (human): **A** — specified in § 3.1 ("Mode transitions and product writes"): writers assert
    the validated mode with a `ConditionCheck` in the product transaction; the switch stores, verifies, reverts.
  SUPERSEDED 2026-10-28 by CM-D11 (human): no online transition exists; the mechanism is not built.
  BLOCKING_REASON: the spec acknowledged the race while it claimed complete write closure; no ruling accepted the
    weaker guarantee.

DECISION_REQUIRED:
- ID: CM-D10-COMMERCE-ENTRY
  QUESTION: How must CAT-MODE-1 handle priceless products when a tenant leaves catalog mode (to commerce)? (Raised
    by review-1 C2-2 with executed evidence: the OpenAI feed maps an absent price to `"undefined USD"`
    (`renderer/src/app/[siteId]/openai-feed/route.ts:28`); the order path computes `NaN`, the DynamoDB marshaller
    refuses it, so `orders/create.ts` increments the order counter (`:285-294`), fails at the transaction (`:406`)
    and answers 500 (`:549`).)
  OPTIONS:
  - (A) KEEP THE SWITCH ALLOWED; ADD ABSENCE RULES: explicit missing-price order refusal and absence-aware feed and
    display behaviour. RISK: extends the specified order guard and the consumer work. REWARD: keeps the permitted
    transition without malformed output or unexpected order failure.
  - (B) REFUSE ENTERING COMMERCE UNTIL EVERY PRODUCT HAS A PRICE. RISK: supersedes the directive that the reverse
    switch needs no guard. REWARD: preserves the existing commerce readers' assumption that a price exists.
  - (C) KEEP THE CONSUMERS AND ACCEPT THE FAILURES. RISK: malformed feed entries and order-path 500 responses
    remain; "display stays honest" cannot be claimed. REWARD: no additional work.
  RECOMMENDED: B
  RATIFIED 2026-10-28 (human): **B** — the transition protocol of CM-D9 with the target-mode predicate (leaving
    catalog mode: refused while any product lacks `price`); § 3.1 "Symmetric entry rule".
  SUPERSEDED 2026-10-28 by CM-D11 (human): no online transition exists; the mechanism is not built.
  BLOCKING_REASON: the reverse-switch safety premise was contradicted by the consumers; the earlier rationale also
    relied on an incorrect claim that a `NaN` order is stored.

DECISION_REQUIRED:
- ID: CM-D11-MODE-FIXED-AT-CREATION
  QUESTION: How does a tenant's mode (catalog or not) change, given that every online transition mechanism specified
    so far (CM-D9 protocol, with or without the `modeTransition` marker) leaves reachable violations? (Raised by
    review-2: the store-first switch publishes an unvalidated mode — public product responses are cacheable 60 s,
    `products/public-get.ts:39`, and `withInvalidation()` invalidates only on 2xx, `lib/invalidate-cdn.ts:263-267`;
    `products/bulk-price.ts:147-164` writes a stale snapshot with an unconditional `Put`; `lib/catprod.ts:38-46`
    price-bearing projections are written by an unconditional `BatchWriteCommand` and served by
    `categories/public-get.ts:48`; the marker has no operation ownership; the verify query is not strongly
    consistent. No requirement ever named an online mode switch — this packet's S1 introduced "TENANT_ADMIN toggles
    the mode in Settings".)
  OPTIONS:
  - FIXED AT CREATION: the mode is chosen in `POST /tenants` (GLOBAL_ADMIN) and `PUT /settings` refuses any change;
    changing an existing tenant's mode is an offline migration slice (`MODE-MIGRATION-1`), opened only on need.
    RISK: an operator who picks the wrong mode must recreate the tenant or wait for a migration slice; no
    self-service switch. REWARD: the whole transition class disappears — no race, no reverse switch, no
    publish-before-validate, no stale bulk snapshot, no stale projection, no cache window; writers keep plain `Put`s.
  - OWNED ONLINE TRANSITION (review-2 A): keep the active flags unchanged while an owned, recoverable transition
    excludes conflicting writes; validate authoritatively; then publish the target mode conditionally, covering bulk
    writes and price-bearing projections. RISK: changes CM-D9's mechanism, touches more commerce code (bulk price,
    projections), and has a large verification and maintenance burden. REWARD: a self-service switch with the
    guarantees intact.
  - OFFLINE PROCEDURE (review-2 C): mode changes only under enforced maintenance/quiescence. RISK: changes the
    operating contract and must exclude in-flight writers, readers and stale cached output. REWARD: less concurrent
    complexity than an online transition.
  - ACCEPT RESIDUALS (review-2 D): keep the CM-D9 mechanism and weaken the guarantees. RISK: prices can persist or be
    published; malformed feeds stay reachable; rejected switches can have durable effects. REWARD: no further work.
  RECOMMENDED: fixed at creation
  RATIFIED 2026-10-28 (human): fixed at creation — specified in § 3.1 ("Who sets it, and when"; "The write rules";
    "The invariant and the writers").
  ACCEPTED REFINEMENT 2026-10-28 (operator, from the decision-review, within the ratified policy): every read that
    enforces the mode uses ConsistentRead: true and refuses a missing tenant record (404, nothing written) instead of
    defaulting — settings.ts _updateHandler, products/create.ts, products/update.ts, import/woocommerce.ts, the glam
    importer, the interest handler; the order handler already fails closed.
  BLOCKING_REASON: it removes the transition protocol from every impl packet (`cat-mode-1`, `cat-import-1`) and
    decides how the glam tenant is created.

DECISION_REQUIRED:
- ID: CM-D7-IMAGE-ABSENCE
  EVIDENCE (builder, 2026-10-28; forced by the schema sweep the packet asked for):
  - `ProductSchema.imageLink` is `z.string().url()` — REQUIRED (`packages/shared/src/index.ts:1049`), enforced by
    the admin write path (`products/create.ts:40-42`).
  - BOEN has 462 rows and 307 with images (`docs/slices/cat-import-1.md` § 5): 155 products have no image URL.
    CAT-IMAGES-1 § 2.2 says a failed ingest leaves "the product with NO image (honest absence)" — the schema does
    not allow that product today.
  - Precedent: the WooCommerce importer writes `imageLink: ''` (`import/woocommerce.ts:369`) straight to DynamoDB,
    bypassing the schema; the admin editor cannot then save that product (`.url()` refuses `''`).
  - Readers already tolerate absence in places: `ProductCard` shows a placeholder when `imageLink` is falsy
    (`SitePage.tsx:626-629`). Others do not check: JSON-LD `image` (`SitePage.tsx:677`), legacy page metadata
    `images: [product.imageLink]` (`ProductByIdPage.tsx:36`), the legacy page `<img>` elements
    (`ProductByIdPage.tsx:98,101`), the feed `image_link` (`openai-feed/route.ts:26`).
  - Writers that send an empty string today (added cycle 2): the admin editor initialises `imageLink: ""`
    (`admin/src/pages/ProductEditor.tsx:47`) and sends the whole form (`:117`); MCP `create_product` requires
    `image_link` (`tools/mcp-server/src/index.ts:1053`). Under (a) both drop an empty value; the key is omitted.
  QUESTION: How does a catalog product with no usable image exist?
  OPTIONS:
  - (a) IMAGE OPTIONAL UNDER CATALOG MODE: `imageLink` becomes `z.string().url().optional()`, with the same
    write-boundary rule as CM-D1 (required unless the tenant is `catalogMode`). Every reader treats absence as "no
    image" (placeholder in cards, no `image` key in JSON-LD, no `<img>` element); every writer omits the key
    instead of sending `""` (§ 3.2 closing rule). RISK: a second shared-schema change; every image reader and
    writer must handle absence (the lists above). REWARD: the 155 products appear with their name and specs; the
    data holds one representation of "no image"; CAT-IMAGES-1's honest absence becomes possible.
  - (b) SKIP ROWS WITHOUT A VALID IMAGE: the importer reports them (`skipped`, reason `no-image`) and writes
    nothing. RISK: one third of BOEN is not on the site; a later image failure in CAT-IMAGES-1 has nowhere to go
    but deleting or archiving the product. REWARD: no schema change.
  - (c) EMPTY-STRING SENTINEL, as the WooCommerce importer does. RISK: two representations of absence; the admin
    cannot edit such a product (the editor's save fails `.url()`); readers that do not check publish `""`. REWARD:
    no schema change, no skipped rows.
  RECOMMENDED: (a) — the same honest-absence law the human ratified for price (CM-D1), the same write-boundary
    rule, and the only option under which CAT-IMAGES-1 can do what its packet says. Commerce tenants stay as
    strict as today.
  RATIFIED 2026-10-28 (human): (a), with explicit removal on update per the corrected cell — storage: the key is
    absent, never `""` or `null`; the UPDATE request accepts `imageLink: null` as removal and the handler deletes the
    key before the `Put`; create never accepts `null`; the editor sends `null` when a stored image is cleared; the
    importer and CAT-IMAGES-1 remove the attribute explicitly.
  BLOCKING_REASON: the shared product contract the importer writes and the image readers consume; how many glam
    products the site shows.

## 5. Non-scope

Orders, checkout, customer accounts, Paddle, reviews, Track B/C. Any grouping heuristic (D-4 b)
beyond naming it. The glamCRM side (GC-SITE-SYNC-1 is glamCRM's own future slice) — including any glamCRM export
of the codification column, which CM-D3 (b) no longer needs (follow-up `GLAM-IDENTITY-MIGRATION-1`, § 3.4).

## 6. Definition of Done

- This document complete per the house format with every block above ratified or recorded as
  contested in the ratification packet; the enumerated surface table filled from a builder sweep
  (`grep -rn "price\|salePrice\|availability\|Buy" renderer/src admin/src tools/mcp-server/src`
  — every hit classified: suppressed / unaffected / out of scope, with file:line). **Done 2026-10-28** (§ 3.2;
  the sweep also covered `backend/src` and `packages/shared/src`, per the builder packet).
- `npm run typecheck` at every workspace untouched-green (no code in this slice). **EXECUTED** — § 8.1.
- The three impl packets (`cat-import-1`, `cat-mode-1`, `cat-interest-1`) updated to the ratified
  decisions before any of them launches. **Not this builder's duty** (packet allocation: this file only); the
  changes they need are listed in § 8.5.

## 7. References

`docs/plan-glam-catalog.md`; glamCRM `docs/PRICELISTS.md` §1–2 (the canonical layout and the
identity laws); `docs/platform-decisions.md` PD-001/002 (unaffected: no customer identity here);
`backend/src/import/woocommerce.ts` (importer precedent); `docs/slices/import-policy-1.md`
(importer tenant-binding precedent); `docs/slices/service-account-1.md` § 8 (service-key scopes);
`docs/caching-architecture.md` (dynamic twin, § 3.6); OpenAI Commerce product-feed reference
(https://developers.openai.com/commerce/specs/file-upload/products, § 3.3).

## 8. Spec-build record (builder, 2026-10-28)

### 8.1 Commands and counts (EXECUTED)

| Command | Result |
|---|---|
| `git status --porcelain` before the edit | empty (clean tree) |
| `grep -rn "price\|salePrice\|availability\|Buy" <dir> --exclude='*MAP.md' \| wc -l` and `grep -rln … \| wc -l` | renderer/src **81/6**, admin/src **41/7**, tools/mcp-server/src **20/1**, backend/src **62/12**, packages/shared/src **7/1** — equal to the operator's counts |
| `grep -rn -e attributes -e '\.sku' -e variants renderer/src` | no product `attributes` reader; `variants` only in `AddToCartButton.tsx` and `SitePage.tsx:834`; `sku` only in search (`dynamo.ts:401`) |
| `grep -n "feed\|product\|commerce\|Product\|sitemap" llms.txt/route.ts robots.txt/route.ts` | only `robots.txt/route.ts:17` (sitemap link) |
| `grep -rn "price\|Price\|commerce:" packages/plugins/src` | `category-showcase` price render; `commerce: true` on `category-showcase` and `reviews-carousel` |
| `grep -rln commerceEnabled renderer/src admin/src backend/src tools/mcp-server/src` | 11 files (§ 3.1 table) |
| `node_modules/zod/package.json` version | `4.6.7` |
| cycle 2: `grep -rln 'PRODUCT#' backend/src --include='*.ts' \| grep -v MAP \| xargs grep -ln "PutCommand\|UpdateCommand\|TransactWrite\|BatchWrite"` | 7 files: `products/{bulk-price,create,update}.ts`, `import/woocommerce.ts`, `resources/presign.ts`, `webhooks/paddle.ts`, `orders/create.ts`; reading the `PRODUCT#` lines of the last three (`presign.ts:73` Query, `paddle.ts:76` Get, `orders/create.ts:112` Get) shows they only read product items |
| cycle 2: `grep -rn "query\.\(id\|email\|preview\|nf\)" renderer/src/components/SitePage.tsx` | `query.id` only at `:354` (checkout-confirm), `query.email` at `:355,364` |
| cycle 3: `cd backend && node -e '…marshall({total:NaN},{removeUndefinedValues:true})…'` (`@aws-sdk/util-dynamodb`) | throws `Special numeric value NaN is not allowed` — reproduces review-1 |
| cycle 11: `node -e` model of the § 3.4 label allocation and the § 3.5 retention rule | labels `x, x, x (2)` → `x, x (3), x (2)`; `#1, "", ""` → `#1, #2, #3`; `X, x` → `X, x (2)`; items `(p,red), (p,blue), (p,red)` → 2 retained, 1 fetch key |
| cycle 10: `python3 -I` over `../glamCRM/pl-tools/out/{alpod/enriched/AUR.csv,itc/enriched/*.csv,boen/enriched/*.csv}`; `sed -n` on `../glamCRM/pl-tools/vendors/alpod.config.mjs:60-82` | AUR.csv: 219 product rows, 7 distinct `produs`, 216 image rows, 48 distinct images; ITC Arc_Edition.csv: 536 rows, 66 styles after stripping the trailing number, 8.1 rows per style, 366 distinct images; ITC.csv: 44 rows, 44 styles, no images; BOEN first row `produs` "Oak Andante Live Matt brushed , 4V bevel", `format` "10,5x137x790 mm"; config maps AUR `produs: [2]` (`:79`), KRO `[2]` (`:64`), EGP `[2, 4]` (`:70`). The raw Aurora column list was not read (operator evidence) |
| cycle 8: `python3 -I` over `../glamCRM/pl-tools/out/*/enriched/*.csv` (read-only; `csv` module, RFC 4180), composite (idx 0, 1, 11) normalised trim → collapse → lower → NFC | 24 files (alpod 21, boen 1, itc 2); 2,861 product rows (1,803 / 478 / 580); 915 repeat rows (888 / 23 / 4); 113 groups, 1,028 rows; 21 groups without image; codes all-distinct in 82 groups; image split 51/41 (every row its own image) or 60/32 (no URL shared among rows with one) vs the operator's 58/34; AUR.csv 212 of 219; collection empty on 0 product rows; every row 12 cells; 257 BOEN `produs` values contain a comma |
| cycle 8: `node -e` with the § 3.4 normalisation (trim → collapse → lower → NFC) | canonical equivalence `J\u030c` vs `\u01f0`: same key; idempotence: true for the witness, Romanian upper/lower diacritics, NFD Romanian, whitespace-only, inner tabs; whitespace-only → `""`; `\u001f` survives normalisation |
| cycle 8: `node -e` with the WooCommerce slugify (`import/woocommerce.ts:24-33`) on a `\u001f`-joined composite | `boenherringbone-lightoak-andante-live-matt-brushed-4v-bevel105x137x790-mm` — the separator is dropped and words glued, hence the space join for slugs (§ 3.4) |
| cycle 7 (review-6): `node -e` with the § 3.4 normalisation and `sha256` | `String.prototype.trim()` keeps `\u001f` and `/\s/` does not match it; review-6's two tuples give the same key without the separator rule; the rule flags both; a whitespace-only format normalises to `""` |
| cycle 3: `node -e` with the feed template `` `${p.price} ${p.currency}` `` and `p = {currency:"USD"}` | `{"price":"undefined USD"}` — reproduces review-1 |
| cycle 13: `grep -rn -e queryCatProducts -e writeCatProductItems -e deleteCatProductItems backend/src renderer/src admin/src packages/shared/src tools/mcp-server/src infra/lib` | `queryCatProducts`: `products/public-list.ts:22`, `products/list.ts:31`, `categories/public-get.ts:37`; write helpers: `products/create.ts:68`, `update.ts:58-59`, `delete.ts:41`, `bulk-price.ts:169-170`, `import/woocommerce.ts:491,494`; plus `catprod_ts_MAP.md` (generated) — text search, complete for these roots, not for dynamic imports |
| cycle 13: `grep -n` in `node_modules/@aws-sdk/client-dynamodb/dist-types/models/models_0.d.ts` | `KeysAndAttributes.ConsistentRead` (`:6985`), `BatchGetItemOutput.UnprocessedKeys` (`:8212`), `BatchWriteItemOutput.UnprocessedItems` (`:9531`) |
| `npm run typecheck` (cycle 13, after the edit; cycles 2–12 gave the same result) | exit 0; 8 workspace `typecheck` scripts ran (shared, effects, plugins, backend, admin, renderer, mcp-server, infra; admin's is `tsc -b --noEmit --force`, the other seven `tsc --noEmit`); 0 lines containing "error". Logs kept at `.agent-manager/slices/CATALOG-MODE-1/typecheck-cycle{2,3,4,5,6,7,7b,8,10,11,12,13}.log` (gitignored) |

### 8.2 Files read, per section

- **S1 / § 3.1:** `packages/shared/src/index.ts:747-800`; `backend/src/tenant/settings.ts` (whole; re-read in
  cycle 5 after SETTINGS-KEYS-1); `docs/slices/settings-keys-1.md` (§ 2, § 8);
  `backend/src/tenant/create.ts:50`; `backend/src/tenant/list.ts:15-60`; `renderer/src/lib/dynamo.ts:86-175`;
  `renderer/src/app/[siteId]/layout.tsx:80-190`; `renderer/src/components/Navbar.tsx:140-240`;
  `admin/src/components/layout/{Sidebar,AdminLayout}.tsx`; `admin/src/components/editor/Toolbar.tsx:21-22`;
  `admin/src/pages/Settings.tsx` (flag lines and card titles); `admin/src/context/TenantContext.tsx`.
- **S2 / § 3.2:** every sweep hit in context; `renderer/src/components/{SitePage,ProductByIdPage,SearchBar}.tsx`;
  `packages/plugins/src/category-showcase/*`; `backend/src/products/{create,update,public-get,public-list,
  bulk-price}.ts`; `backend/src/lib/catprod.ts`; `backend/src/orders/create.ts:60-135`;
  `tools/mcp-server/src/index.ts` (product tools); `infra/lib/{api-catalog,api-commerce}.ts` (placement, grants).
- **S3 / § 3.3:** `renderer/src/app/[siteId]/{sitemap.xml,openai-feed,robots.txt,llms.txt}/route.ts`;
  `renderer/src/lib/dynamo.ts:326-364,670-712`; OpenAI product-feed reference (web search, 2026-10-28).
- **S4 / § 3.4:** `docs/plan-glam-catalog.md`; `docs/slices/cat-import-1.md`; glamCRM `docs/PRICELISTS.md` § 1–2,
  `pl-tools/README.md` (read-only, outside this repo); `backend/src/import/woocommerce.ts`;
  `backend/src/lib/{media-map,image-upload}.ts`; `admin/src/lib/importReportView.ts`;
  `packages/shared/src/index.ts:1481-1554`.
- **S5 / § 3.5:** `docs/slices/cat-interest-1.md`; `backend/src/forms/{public-submit,submissions}.ts`;
  `backend/src/{leads/create,contact/send,comments/create}.ts` (lead writes); `admin/src/pages/{Leads,
  FormSubmissions}.tsx`; `backend/src/auth/policy.ts:15-18`; `docs/slices/service-account-1.md` § 8.
- **S6 / § 3.6:** `renderer/test/serving-contract/` (listing, `fixtures.mjs`); `docs/caching-architecture.md`
  (§ on the `%5Fdyn` twin and query-string routing).
- **S7 / § 4:** all of the above; `docs/slices/{cat-mode-1,cat-images-1}.md`.
- **Cycle 2:** `.agent-manager/slices/CATALOG-MODE-1/review-0.json`; `infra/lib/renderer-hosting.ts:525-595`;
  `renderer/middleware.ts:305-330` and its `_dyn` lines; `backend/src/products/delete.ts:25-45`;
  `backend/src/forms/{update,create,delete,list}.ts`; `admin/src/pages/{FormEditor,FormSubmissions}.tsx`;
  `admin/src/App.tsx:115-116`; `packages/shared/src/index.ts:420-428,966-975,1585-1603`;
  `backend/src/contact/send.ts:75-82`; `backend/src/orders/create.ts:120-175,457`;
  `packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx` (whole);
  `renderer/src/components/SitePage.tsx:345-370,505-530`; `renderer/src/components/{ProductByIdPage,
  ProductImageGallery,AddToCartButton}.tsx`; `admin/src/pages/ProductEditor.tsx:36-50,108-125`;
  `tools/mcp-server/src/index.ts:1044-1101`; `infra/lib/api.ts:260-270`; `infra/lib/api-commerce.ts:497-514`.

- **Cycle 8:** `../glamCRM/pl-tools/out/*/enriched/*.csv` (all 24, read-only, measured); `.agent-manager/slices/
  CATALOG-MODE-1/{decision-rebuttal.md,ratification-packet.md}`; `packages/shared/src/slug.ts`;
  `backend/src/import/woocommerce.ts:24-33,318-345`; `backend/src/lib/catprod.ts` (exports); renderer gallery readers
  (`SitePage.tsx:722`, `ProductByIdPage.tsx:65,100`, `openai-feed/route.ts:27`, `lib/dynamo.ts:344,689,708`).

- **Cycle 10:** `.agent-manager/slices/CATALOG-MODE-1/review-8.json`; `../glamCRM/pl-tools/vendors/alpod.config.mjs`
  (`:60-82`); `../glamCRM/pl-tools/out/{alpod,itc,boen}/enriched/*.csv` (read-only); `backend/src/lib/service-keys.ts:72-87`;
  `backend/src/lib/invalidate-cdn.ts:263-267`; `infra/lib/api-catalog.ts:218`; `admin/src/pages/ProductEditor.tsx:408-416`;
  `renderer/src/components/{SitePage.tsx:669-944,ProductImageGallery.tsx,ProductByIdPage.tsx:61-80}`;
  `renderer/src/app/[siteId]/openai-feed/route.ts:21-35`.

- **Cycle 11:** `.agent-manager/slices/CATALOG-MODE-1/review-9.json`; `backend/src/products/update.ts:28-60`;
  `backend/src/lib/catprod.ts:57-100`; `renderer/src/lib/dynamo.ts:264-294` (category pages read `CATPROD#` items).

### 8.3 Not determined (named, not guessed)

- The total number of glam products across the six complete lists (only BOEN = 462 is recorded), so whether the
  sitemap's 1000-product limit (§ 3.3) is reached.
- Which staging tenants Layer 2 of `CM1-BYTE-IDENTITY` uses — no repo document names one. Unresolved prerequisite:
  the operator supplies the two ids at the launch of `cat-mode-1` (§ 3.6).
- That CloudFront answers an uncached `no-store` twin response with `x-cache: Miss from cloudfront` — INFERRED from
  CloudFront's documented header values; the first Layer 2 capture records it.
- That the `%5Fdyn` twin's HTML equals the ISR route's HTML for the same path (§ 3.6 Layer 2) — INFERRED from the
  shared render body; confirmed on the first capture.
- Whether the DynamoDB table has a TTL attribute (not needed by the § 3.5 design; it is why the design avoids TTL).
- Whether zod 4.6.7 refuses `.omit()`/`.partial()` on a refined object schema — not tested; § 3.1 avoids the
  question by not refining `TenantConfigSchema` itself.
- The exact masks of § 3.6 step 4 are stated by kind; their regular expressions are CAT-MODE-1 build work.

### 8.4 Findings for the decision-review pass (not DECISION blocks; the operator may promote any of them)

- **F-1 — `attributes` are not rendered anywhere.** The plan maps collection, unit, packaging, minimum order and
  format to `attributes` (`docs/plan-glam-catalog.md:65-73`), but no renderer surface reads `attributes` (§ 8.1).
  Without a change, a visitor sees title, image and specs only. Recommended: CAT-MODE-1 renders `attributes` as a
  key/value list on the product page under `isCatalogMode` only (additive; byte-identity holds). Not in any packet
  today — surfaced, not built.
- **F-2 — CM-D1's write-boundary refinement has no owning packet.** cat-mode-1 § 2.4 covers the admin editor;
  cat-import-1 § 2.6 tests the refinement; neither builds `products/create.ts`/`update.ts` + the CDK grant
  (CM-D1 note). Recommended owner: CAT-MODE-1 (it owns the flag).
- **F-3 — price doors on a catalog tenant: closed by construction (CM-D8 + CM-D11 in `cat-mode-1`); no residual.**
  (i) Products priced before a switch to catalog mode — there is no switch: a catalog tenant is created as one and
  starts with no products (CM-D11, § 3.1); (ii) `POST /import/woocommerce` writing `price: '0'`
  (`woocommerce.ts:459`) — refused at the start of the job (CM-D8 guard 1), and the mode cannot change while the job
  runs; (iii) the admin and MCP product writes — refused by the CM-D1 refinement, which reads a mode that cannot
  change before the write; (iv) `bulk-price.ts` and the `lib/catprod.ts` projections — they only carry prices that
  products already have, and no catalog product has one; (v) no other product writer — the earlier argument rested on
  a literal search for `PRODUCT#` writers, which cannot see a write target chosen at run time. Review-3 C4-1 found one:
  `PUT /settings` let a request body `PK`/`SK` name a `PRODUCT#` item and write a price into it. Review-4 C5-1 found
  the same class through the index: a body `TenantSlug` + `Type` made the tenant record (with a `price` and the
  tenant's secrets) the public answer of `GET /public/products/{slug}` or `/categories/{slug}`, even for another
  tenant's slug. Closed by the prerequisites SETTINGS-KEYS-1 (`2ff85c7`) and SETTINGS-KEYS-1B (`569202e`). A tenant
  record cannot be published as a product or category:
  - *not by key* — the eleven key names are removed from the body (`settings.ts:26-29`, `:111-112`) and the handler
    sets `PK`, `SK`, `id` after the spread (`:177-182`), so the route writes only its own tenant record;
  - *not by index* — `TenantSlug`/`Type` and the other GSI keys are among those eleven names, and the public readers
    accept only an item with `PK = TENANT#<tenantId>` and an `SK` prefix of `PRODUCT#`/`CATEGORY#`
    (`products/public-get.ts:28-30`, `categories/public-get.ts:29-31`), which also neutralises a record poisoned
    before the fix (prod was not checked, `settings-keys-1.md` § 12.1);
  - *not by hostname* — a changed `domain` held by another tenant is refused with 409 (`settings.ts:149-164`), so a
    tenant cannot take over another tenant's hostname — for example, to show its priced pages under a catalog
    tenant's domain.
  A body field such as `price` can still land on the tenant record (`settings-keys-1.md` § 8 (c)); that is not a
  product item, no public reader returns the tenant record any more, and the renderer copies tenant fields one by
  one (`renderer/src/lib/dynamo.ts:123-175`). One window is named, not closed: two tenants can both store the same new
  hostname when their requests overlap or fall inside the `GSI_Domain` propagation lag (`settings-keys-1.md` § 12.4);
  the closing `DOMAIN#<host>` uniqueness item is follow-up § 12.7 (a), not built. (vi) A missed read cannot count as
  "not a catalog": every mode read is strongly consistent and a missing tenant record is refused with 404 (CM-D11
  accepted refinement, § 3.1). Closure is by construction; it rests on SETTINGS-KEYS-1 and 1B being deployed wherever
  `cat-mode-1` is deployed.
- **F-4 — the glamCRM export with the codification column** — no longer a prerequisite: CM-D3 was ratified (b)
  (2026-10-28), so the first import runs from the 12-column pl-tools file — since the 2026-10-28 amendment, the
  enriched CSV (§ 3.4). No cross-import identity is kept (CM-D3 AMENDED); the future glamCRM-driven sync
  (`GC-SITE-SYNC-1`) and the cross-import identity it will need (`GLAM-IDENTITY-MIGRATION-1`) are named only.
- **F-5 — admin conveniences for catalog tenants** (all admin-only, no renderer bytes): autolink products
  (`AdminLayout.tsx:45`), the Product Search settings card (`Settings.tsx:879`), and the `categoryShowcase` plugin
  in the toolbar (`Toolbar.tsx:22`, after the § 3.2.6 `_catalogMode` rows). Recommended in CAT-MODE-1; the
  operator decides.
- **F-6 — schema defaults write commerce data onto catalog products.** `availability` defaults `in_stock`
  (`packages/shared/src/index.ts:1018`), `currency` `USD` (`:1013`), `condition` `new` (`:1029`). (The
  `personalizations[].addedCost` `"0"` default, `:973`, is no longer stored on a catalog product: since the CM-D8
  accepted refinement a non-empty `personalizations` array is refused there.) No rendered page shows them
  under catalog mode. Corrected in cycle 2 — they ARE returned by: the public route `GET /public/products/{slug}`
  (`backend/src/products/public-get.ts:43`, whole item) and `GET /public/products` (projection includes
  `availability`, `public-list.ts:49-50`) — public, CommerceApi; the admin `GET /products/{id}` and MCP
  `get_product` (`tools/mcp-server/src/index.ts:1087-1101`) — authenticated. The public `availability: "in_stock"`
  is an availability claim that `docs/slices/cat-mode-1.md` § 1 says no surface may publish. Recommended for the
  decision-review pass: the catalog write paths do not store `availability` and `condition` (the glam importer
  omits them; `products/create.ts`/`update.ts` delete the parsed defaults when the tenant is a catalog) — a
  CatalogApi-only change, no CommerceApi touch. Not decided here.
- **F-7 — pre-existing order-pricing defect (out of scope, commerce track; INFERRED from code; the arithmetic was
  EXECUTED in `node`).** `backend/src/orders/create.ts:120` takes `unitPrice` as the stored string; `:131-132` add
  `addedCost` (a string, `index.ts:973`) to the number `0`; `:140` computes `unitPrice + personalizationCost`.
  With a stored price `"12.50"` and an `addedCost` of `"5"`: `0 + "5"` is `"05"`, `"12.50" + "05"` is `"12.5005"`,
  and `× 2` gives `25.001` instead of `35.00`. Live for any selling tenant that uses priced personalizations.
  Reported to the operator; not part of this track.
- **F-8 — why a priceless product must never exist on a commerce tenant, and why it cannot (corrected in cycle 3,
  restated in cycle 4).** The cycle-2
  text said a `NaN` order is written; that was wrong. Corrected evidence (review-1; reproduced by the builder, § 8.1):
  `unitPrice` is `undefined` (`orders/create.ts:120`), `undefined + 0` is `NaN` (`:140`); the DocumentClient
  marshaller (`backend/src/lib/db.ts:8-9`, `removeUndefinedValues: true`) refuses `NaN` ("Special numeric value NaN
  is not allowed"); `orders/create.ts` has already incremented the order counter (`:285-294`), fails at the
  transaction (`:406`) and answers 500 (`:549`) — no order is written, one order number is consumed. The OpenAI feed
  maps an absent price to `"undefined USD"` (`openai-feed/route.ts:28`). This evidence is the record of WHY a
  priceless product must never exist on a commerce tenant. It cannot: a non-catalog tenant's product writes require
  `price` (CM-D1 refinement) and the mode never changes (CM-D11), so neither consumer needs an absence rule (§ 3.1
  "The invariant and the writers").
- **Named follow-up (not a decision): `CATPROD-CONSISTENCY-1`** (all tenants, not catalog-specific; cycle 12 scope
  ruling). Projection (`CATPROD#`) consistency under two overlapping admin edits of one product is pre-existing:
  `products/update.ts:55-59` deletes and rewrites a product's projections from the categories its own earlier read
  saw, with no version check. Symptom: a stale card on a category page (for example a card for a deleted product)
  until that product is written again. Counterexample (review-10, C11-1, executed as a model): two updates both read
  categories `[A]`; the first commits `[B]` (delete A, write B), the second commits `[C]` (delete A, write C); a later
  delete removes C and leaves an orphan projection in B. Out of scope for this track; the importer's reconciliation
  (§ 3.4) repairs only the categories an import touches.
  Named instances added in cycle 13 (C12-2), pre-existing on every tenant: (1) `writeCatProductItems` and
  `deleteCatProductItems` (`backend/src/lib/catprod.ts:57-98`) discard the `BatchWriteCommand` response, so
  `UnprocessedItems` are dropped and the writer still answers 2xx — every product write is affected
  (`products/create.ts:68`, `update.ts:58-59`, `delete.ts:41`, `bulk-price.ts:169-170`,
  `import/woocommerce.ts:491,494`). Symptom: a product missing from a category page after a lost put, or a card for a
  deleted product after a lost delete, until that product is written again. (2) `queryCatProducts` (`:104-114`) reads
  one `Query` page, so its callers (`products/public-list.ts:22`, `products/list.ts:31`,
  `categories/public-get.ts:37`) see at most one page of a category's projections (INFERRED from the code: no
  `LastEvaluatedKey` loop; not measured). The importer does not change these; it uses its own paginated read and
  acknowledged writes for the categories it touches (§ 3.4).
- **Named follow-up (not a decision): `MODE-MIGRATION-1`** — changing an existing tenant's mode is an offline data
  migration slice, opened only on a demonstrated need (CM-D11).

### 8.5 What the four impl packets need after ratification (operator applies; this builder did not edit them)

- `cat-import-1` (rewritten 2026-10-28 cycle 10, CM-D3/CM-D4 AMENDED twice): one enriched CSV per upload (RFC 4180,
  12 columns by index, header ignored, columns 2–5 have no field in the parsed row type); upload fields file,
  producer (offers existing `brand` values), sheet (default: file name), variant name (default "Variantă"); the
  identifier rule — no `/` and no `\u001f` inside producer or sheet, 400 before any mutation;
  `importSource = "glam:" + norm(producer) + "/" + norm(sheet)`, a new optional `ProductSchema` field; the product key
  producer + colecție + produs (no `format`), normalised trim → whitespace collapse → lower-case → NFC last
  (diacritics kept), the `\u001f` rule, joined with `\u001f`; the unit tests owed before the first import (separator
  witness, canonical equivalence `J\u030c` vs `\u01f0`, idempotence, the identifier rule); one product per style with
  exactly one variant group (name = the variant name; one option per row, `value` = `format`, `imageLink` = the
  row's image; equal label and image deduped, then collision-aware label allocation — `#<n>` for empty labels and
  ` (2)`… for remaining duplicates, never equal to a label already present, with the two owed tests `x, x, x (2)` and
  `#1, "", ""`; never `priceOverride` or `availability`); `imageLink`/`additionalImageLinks` derived from the option
  images; specs from the first row with non-empty specs, attributes from the first row (without `format`);
  `slug` from the key (`-2`, `-3` suffixes in file order); fresh ids; REPLACE per `importSource` under the per-tenant
  lock `IMPORTLOCK#glam` (owner token, conditional put, `expiresAt` 15 min, conditional takeover, a contender's 409
  touches nothing, release only by the owner with `owner = :me`, in `finally`); the tenant checks (404/403) BEFORE
  the lock; the previous-set query with `ConsistentRead: true`; each previous product deleted with its `CATPROD#`
  items for the categories the query read; the previous-set query without a `FilterExpression` (the previous set is
  selected in code; the same pages give every product's `categoryIds`); the END-OF-IMPORT RECONCILIATION of every
  touched category per § 3.4 (cycle 13): candidates from a paginated, strongly consistent `CATPROD#<C>#` read plus the
  step-(3) members of any origin plus the created products; a `ConsistentRead` `BatchGet` of the candidates (≤ 100
  keys, `UnprocessedKeys` retried); writes of category `C` only, `UnprocessedItems` retried (5 resends, 100 ms
  doubling); 503 with `incompleteCategories` when the bound is exhausted; two new functions in `lib/catprod.ts`
  (`listCatProductIds`, `writeCategoryProjections`), the existing three and their callers unchanged; `importSource`
  written only by the importer; the cycle-13 guarantee (a)/(b)/(c) (§ 3.4); dry run listing the previous set (count
  and the first ten titles); delete, create, categories created if absent and never deleted, CDN invalidation; the
  partial-failure recovery (import the same file again); the report shape (`created` / `option` / `deduped` /
  `skipped`, `deleted` count, `products[].productId` and options, per-row image disposition); the start-of-job
  refusal of a missing (404) or non-catalog (403) tenant, read with `ConsistentRead: true` (CM-D11); route in
  CatalogApi + parent route. Correction to the packet: cat-import-1 § 2.3 names `normalizeSlug` for category slugs;
  categories use the same slugify as products (`import/woocommerce.ts:326`). Per-vendor pl-tools prerequisites
  (glamCRM, operator-run, before the first import of that vendor): ITC `produs` ← style, `format` ← colour number;
  ALPOD `produs` ← Model + Decor, `format` empty; BOEN none (§ 3.4). Withdrawn: lookup items, conditional row writes,
  `conflict`, `duplicate-key`, the existence read, `sourceImageUrl`, `unchanged`/`updated`/`recreate`, the cycle-8
  "one product per composite with the other rows as its gallery".
- `cat-mode-1`: the § 3.1 reader lists (incl. `mapTenant`, `tenant/list.ts` and the backend mode readers);
  **CM-D11**: `catalogMode` set at creation (`tenant/create.ts:34-49` copies it; the "Create New Site" dialog
  checkbox, `Sidebar.tsx:153-177`; MCP `create_tenant` `catalog_mode`), and the narrow parse in `PUT /settings`
  refusing a changed mode or commerce on a catalog tenant; every mode read (`settings.ts`, `products/create.ts`,
  `products/update.ts`, `import/woocommerce.ts`) with `ConsistentRead: true` and 404 on a missing tenant record —
  including the intended settings regression (no more `{ name: "Unknown" }` records); the Settings card shows the
  mode read-only and hides the Commerce toggle; the CM-D1 refusal list incl. a non-empty `personalizations` array
  (CM-D8 accepted refinement) + `grantReadWriteData` for `create.ts` (F-2), product writes stay plain `Put`s; **CM-D8**: WooCommerce import refusal (second named commerce-freeze exception); feed = 404;
  `_catalogMode` injection for `categoryShowcase` (price line + stock overlay); the image absence rules (legacy
  `<img>`); editor and MCP omit an empty `imageLink` on create, the editor sends `imageLink: null` to clear a stored
  image and the update handler deletes the key (CM-D7); the editor drops empty `price`/`salePrice` under catalog mode
  only; `CM1-BYTE-IDENTITY` (§ 3.6) replacing § 5's
  two-fixture wording, with the operator's two staging tenant ids as a launch prerequisite; F-1 / F-5 / F-6 if
  accepted. Gallery (2026-10-28): no gallery reader is missing — the product page already passes
  `additionalImageLinks` to the gallery (`renderer/src/components/SitePage.tsx:722`) and the legacy page renders them
  (`ProductByIdPage.tsx:100`). **Variant presenter (cycle 10, CM-D4 AMENDED):** `cat-mode-1` adds a read-only
  catalog-mode presenter of the product's variant group (option labels with their images) on the product page,
  rendered only under `isCatalogMode`; it is the only `variants` reader under catalog mode and exposes the selected
  option to the interest control (§ 3.2.6, § 3.5). F-1 (render `attributes`) carries the imported `unitate` /
  `împachetare` / `comandă minimă` values. **Writers (cycle 11, C10-1/C10-3; cycle-12 scope):** `products/update.ts` — the
  product `Put` with `attribute_exists(PK)` (404 when cancelled; the `CATPROD#` rebuild then does not run, and
  otherwise runs as today); `products/create.ts` and `update.ts` — `importSource: true` added to the `.omit({...})` lists
  (`create.ts:40-42`, `update.ts:39-41`), so authoring requests cannot set, change or remove it; for products carrying
  `importSource`: one variant group, unique option values (400),
  option `imageLink` `""` refused, `imageLink`/`additionalImageLinks` re-derived from the options on every write; the
  editor omits empty option images and marks the two derived fields.
- `cat-interest-1`: record per CM-D5 (ratified (b)); shortlist items are snapshots `{ productId, title, slug,
  imageLink, optionValue }`, the option chosen in the variant presenter (not in `ProductImageGallery`, whose
  selection is private); expired items (ids a re-import removed) shown as expired and reselected, never rebound by
  slug (C8-3 = A); the server validates ids with the projection `id, title, slug, status, imageLink, variants` and
  records title, slug, option and image itself (§ 3.5); retained items deduplicated by `(productId, optionValue)`
  and only the fetch keys by `productId`; an item whose chosen option the product no longer has is dropped with
  reason `option-not-found`, never turned into plain product interest (C10-2); the tenant read with `ConsistentRead: true` and 404 on a
  missing tenant record (CM-D11); the reserved system form `interest-list` (item shape, no slug) and its
  protection in `forms/update.ts`, `forms/delete.ts`, `forms/list.ts`; the sidebar entry and the back-button fix;
  recipient = `integrations.contactEmail`, no platform fallback; `email` required for the reply channel (not
  because of `Lead.email`); server-side titles; item validation (dedupe, cap 50, chunked `BatchGet`, bounded
  `UnprocessedKeys` retry, 503 without a write); token-hash dedupe instead of the 10-minute window; remove the
  honeypot / 429 rows from § 5 unless the human wants them; the glamCRM read scope as a named follow-up.
- `cat-images-1`: reuse `MEDIAMAP#` + `downloadAndUploadImage`, adding the CM-D2 destination policy (http/https
  only; resolve the hostname and refuse the request if ANY resolved address is loopback, private (RFC 1918),
  link-local (`169.254/16`), CGNAT (`100.64/10`), IPv6 unique-local (`fc00::/7`), IPv6 link-local (`fe80::/10`),
  unspecified, or IPv4-mapped to any of these ranges — an IPv4-mapped address of a public IPv4 address is allowed;
  connect to the checked address; `redirect: "manual"`, policy per hop, at most 3 hops) before the timeout, size cap
  and magic-byte check; a failed ingest removes `imageLink` explicitly (CM-D7 = (a), ratified). The policy lives in
  `downloadAndUploadImage`, so the WordPress and media importers inherit the refusal (operator confirms in that
  slice). Since cycle 10 it reads the import report's `products[]` — the fresh `productId` and each option's image —
  and the per-row image column, and copies every option image. Failure rule per source (C8-4): a source that fails
  is removed from the option that holds it (the option keeps its label, without an image); the sources that
  succeeded are kept; then `imageLink` and `additionalImageLinks` are derived again by the § 3.4 rule (first option
  with an image, then the other distinct option images) — so when the original main image fails, the next option
  image becomes the main one, and when every source fails the product is imageless (`imageLink` removed; the gallery
  then renders nothing, `ProductImageGallery.tsx:14`, and the card shows its placeholder). Products are recreated on
  each import, and `MEDIAMAP#` keeps an already-copied URL from being fetched again. Writes (cycle 11, C10-1): the
  per-product `UpdateCommand` carries `ConditionExpression: "attribute_exists(PK)"` — an unconditional `Update`
  upserts a deleted item; a cancelled write means the product was replaced meanwhile, and the ingest of that product
  stops (reported). After a successful update it rewrites that product's `CATPROD#` items with the existing helper, as
  the product writers do today; projection consistency under concurrent edits is `CATPROD-CONSISTENCY-1` (§ 8.4).
- `cat-facets-1` (new, 2026-10-28; § 3.7): shop and category filters by producer, every imported attribute and the
  variant option values (the format/colour labels, since cycle 10), with counts; the projection gains `brand`,
  `attributes` and the option values; the cache-key allowlist gains the facet parameters; after
  `cat-mode-1` and `cat-import-1`; ROADMAP row by the operator.

### 8.6 Cycle 2 corrections (builder, 2026-10-28, after review-0 `escalate` and the human's ruling CM-D8 = A) — HISTORICAL

Line numbers below are of this document as it stood after cycle 2 (cycle 3 inserted text above them; § 8.7 gives cycle-3 line numbers).

| Finding | Class of defect | What changed, where |
|---|---|---|
| R1 — catalog write invariant left open | a tenant-wide promise with reachable write paths left as follow-ups | New block CM-D8-WRITE-CLOSURE (ratified A), lines 796-840, with the three guards; § 3.1 narrow parse + named regression class + mode-switch guard + reverse-direction reasoning, lines 62, 76-99; backend mode-reader table, lines 131-143; § 3.2.4 `public-list.ts` and `woocommerce.ts` rows, lines 224, 237; CM-D1 note gains `addedCost` and the empty-string rule, lines 606-622; F-3 closed, F-6 extended, lines 981-1001. Rule: every product write path is listed (EXECUTED grep, § 8.1) and each one either refuses a monetary field for a catalog tenant or cannot carry one |
| R2 — staging capture could compare cached bodies | cache bypass by a parameter that is not in the cache key | § 3.6 Layer 2 rewritten, lines 545-578: allowlisted `id=cm1-<run>` (new value per run, existing parameters kept), `x-cache: Miss from cloudfront` recorded per URL, invalidation as the alternative; staging tenant ids recorded as an unresolved prerequisite (also § 8.3) |
| R3 — emission and absence beyond the regex | surfaces gated by data instead of by mode; more than one representation of "absent" | § 3.2 rows: Add-to-Cart absence rule (179), editor empty-value drops (192, 194), MCP `image_link` and `get_product` (211-212), `categoryShowcase` `_catalogMode` injection + stock overlay, legacy `<img>` rows (261-265); closing rule, lines 275-281; CM-D7 evidence and option (a), lines 842-877; F-6 names the JSON and MCP surfaces |
| R4 — import recovery and image idempotency | "unchanged" decided from a hash that cannot see a deletion; an update overwriting an ingested image | § 3.4: column 9 one rule (339); existence check, `recreate`, `sourceImageUrl`, image-preservation rule (352-389); report sum types (390-402); CM-D3 (a2) REWARD corrected (657-695) |
| R5 — system form unconfigured and unprotected | a reused record type whose existing writers can break its isolation | § 3.5 lines 449-488: reserved id `interest-list`, item shape, fields consumers read, refusals in `forms/update.ts`/`delete.ts`, exclusion in `forms/list.ts`, recipient `integrations.contactEmail` with no platform fallback |
| R6 — unread items treated as invalid | partial-read result taken as a complete answer | § 3.5 item validation, lines 490-502: dedupe, cap 50, chunked `BatchGet`, bounded `UnprocessedKeys` retry, 503 with no write |
| R7 — wrong evidence | claims stated beyond what the code shows | CM-D4 evidence reworded (705-709); `CategoryShowcaseRender` signature `:63` and full path (261) |

New in cycle 2, not asked by review-0: F-7 (pre-existing order-pricing string arithmetic, out of scope) and F-8 (a
direct order for a priceless product on a commerce tenant after a reverse switch — contradicts "the reverse needs no
guard" for the order path only; raised for the decision-review pass, lines 1008-1017). § 3.4 also now says that a
direct-writing glam importer is not covered by the CM-D1 refusal (line 409).

Oracles after cycle 2: 1 (one changed path) and 4 (citations) unchanged in kind; 2 (typecheck) re-run; 3 = **8**
decision blocks (CM-D1 … CM-D8). Results in the build report and the § 8.1 typecheck row.

### 8.7 Cycle 3 corrections (builder, 2026-10-28, after review-1 `escalate` and the human's rulings CM-D9 = A, CM-D10 = B) — HISTORICAL (the transition mechanism it records is superseded by CM-D11, § 8.8)

Line numbers below are of this document as it stands after cycle 3.

| Item | Class of defect | What changed, where |
|---|---|---|
| C2-1 → CM-D9-TRANSITION-COORDINATION (ratified A) | check-then-act across two requests: the guard and the writer validate against a mode that can change before they write | New block, lines 908-927. § 3.1 protocol, lines 82-146: every product write asserts its validated mode with a `ConditionCheck` in the same transaction (`create.ts:52`, `update.ts:50`, `woocommerce.ts:484`, glam importer; 409 on cancel; `CATPROD#` after the transaction; category `Put` and `bulk-price.ts` need no condition); the switch stores → verifies → reverts. Backend reader rows 185-189; `public-list.ts` row 271; CM-D8 specification 882-907; F-3 lines 1093-1100. Rule: no product write commits unless the mode it validated under is the stored mode at commit time |
| C2-2 → CM-D10-COMMERCE-ENTRY (ratified B) | a safety argument for a state that consumers do not support | New block, lines 929-948. § 3.1 "Symmetric entry rule", lines 140-146: leaving catalog mode is refused while any product lacks `price`; "price present" is a non-catalog invariant, so commerce consumers keep their rows. The cycle-2 absence rules on the Add-to-Cart row (226) and in `categoryShowcase` (308) are withdrawn; closing rule restated (322-329). F-8 rewritten with the corrected evidence (1124-1132) |
| C2-3 — import consistency | a decision taken on a read that may not see the latest write; a report seam that omits rows | § 3.4: `ConsistentRead: true` and why (406-418); catalog `ConditionCheck` for importer writes (428-432); every importable row, `unchanged` included, carries `image: { sourceUrl, disposition }` (447-463); CM-D3 (a2) lookup shape gains `sourceImageUrl` (743-745); § 8.5 `cat-import-1` |

**Withdrawn premise.** § 5's "the reverse switch (catalog → commerce with priceless products) is honest under CM-D1 (b)
and needs no guard", and this document's cycle-2 text built on it (§ 3.1 "Why only this direction is guarded", the
Add-to-Cart absence rule, the `categoryShowcase` commerce absence rule, F-8's "the order is written with `NaN`
totals" and its options (a)/(b)/(c)), are withdrawn. The consumers did not support the state (feed `"undefined USD"`;
order path counter increment then 500, no order written — reproduced, § 8.1). CM-D10 replaces them.

**Builder findings in cycle 3 (for the decision-review pass).** The directed protocol leaves two gaps, stated in § 3.1
(lines 116-128): residual (iv) — a write validated under the new mode during the verify window survives a revert —
and the directive's healing claim — a retry of the same switch does not re-run the protocol, because the merge no
longer changes `catalogMode`, and `current` is then the switched config. The `modeTransition` marker (lines 129-139)
closes both and is labelled as a builder addition; if it is removed, residuals (ii) and (iv) stand, and F-3's
closure claim is limited accordingly (F-3 says so).

Oracles after cycle 3: 1 (one changed path) and 4 (citations) unchanged in kind; 2 (typecheck) re-run; 3 = **10**
decision blocks (CM-D1 … CM-D10).

### 8.8 Cycle 4 corrections (builder, 2026-10-28, after review-2 `escalate` and the human's ruling CM-D11 = fixed at creation)

Line numbers below are of this document as it stands after cycle 4.

**The ruling.** CM-D11-MODE-FIXED-AT-CREATION (lines 924-956): a tenant's mode is set in `POST /tenants` and never
changes online; changing it is the offline follow-up `MODE-MIGRATION-1` (§ 8.4, line 1139). CM-D9 and CM-D10 keep
their text; each gets one appended line, `SUPERSEDED 2026-10-28 by CM-D11 (human)` (lines 898, 920). No online
transition mechanism is built.

**What was deleted or replaced** (cycle-3 line numbers in brackets, from § 8.7):
- § 3.1 "Mode transitions and product writes" — the `ConditionCheck` transactions, the 409 answer, store → verify →
  revert, the four named residuals, the builder's `modeTransition` marker and the "Symmetric entry rule" [82-146] —
  replaced by "Who sets it, and when", "The write rules" and "The invariant and the writers" (lines 55-121). The
  shared `TenantModeSchema` is withdrawn (one caller left; line 88).
- § 3.1 backend reader rows [185-189] → lines 159-163: plain `Put`s, start-of-job refusals, `bulk-price.ts`
  UNAFFECTED.
- § 3.2 rows that cited CM-D9/CM-D10: Add-to-Cart (200), `public-list.ts` (245, "no price residual" now true without
  qualification), `categoryShowcase` (282), closing rule (299-301).
- § 3.4 catalog `ConditionCheck` for importer writes [428-432] → start-of-job refusal of a non-catalog tenant
  (402-405).
- CM-D1 note: "the predicate the CM-D9 transition protocol checks" → the complete monetary list (652-653).
- CM-D8 specification guard 1 and guard 2 and the closing sentence (865-878).
- § 8.3: the open question about the `modeTransition` marker is removed (it no longer exists).
- § 8.4 F-3 (1098-1104): closed by construction, no residual. F-8 (1128-1138): the corrected evidence (counter
  increment then 500; feed `"undefined USD"`) kept as the reason a priceless commerce product must never exist, with
  why it cannot. `MODE-MIGRATION-1` added (1139-1140).
- § 8.5 `cat-import-1` and `cat-mode-1` needs (1144-1159): CM-D11 creation path, settings refusal, plain writes.
- Header (lines 10-15, status summary): ratified CM-D1, CM-D6, CM-D8, CM-D11; superseded CM-D9, CM-D10; § 8.6-8.7 marked historical.

**New facts verified for the creation path** (OBSERVED): `tenant/create.ts:18` GLOBAL_ADMIN-only; `:34-49` builds the
record field by field, so `catalogMode` must be copied explicitly (a body field is otherwise dropped); `:50` full
schema parse. The admin has a creation form — the "Create New Site" dialog, `admin/src/components/layout/
Sidebar.tsx:153-177`, payload at `:114`; `admin/src/context/TenantContext.tsx` only lists tenants (`:36`). MCP
`create_tenant` is `tools/mcp-server/src/index.ts:650-663`.

**Taxonomy — the transition class, closed by CM-D11.** Every finding of review-0 R1 (residual race), review-1
C2-1/C2-2 and review-2 C3-1/C3-2 is an instance of one class: *a product's monetary state validated against one mode
and observed or committed under another*. Its instances — the concurrent-write race, the reverse switch
(priceless commerce products: feed `"undefined USD"`, order 500), publish-before-validate (an unvalidated mode
cacheable 60 s, `products/public-get.ts:39`; invalidation only on 2xx, `lib/invalidate-cdn.ts:263-267`), the
stale bulk snapshot (`products/bulk-price.ts:147-164`), price-bearing projections (`lib/catprod.ts:38-46`, served by
`categories/public-get.ts:48`), marker ownership and the eventually consistent verify query — all need a mode change
between a read and a write or a read. CM-D11 removes the mode change, so the class has no instance; nothing in the
implementation has to detect one.

Oracles after cycle 4: 1 (one changed path) and 4 (citations) unchanged in kind; 2 (typecheck) re-run; 3 = **11**
decision blocks (CM-D1 … CM-D11).

### 8.9 Cycle 5 record (builder, 2026-10-28, after review-3 `escalate`)

Line numbers below are of this document as it stands after cycle 5.

**C4-1 — what was found.** Review-3 executed the then-current `PUT /settings` handler in memory: the request body was
spread over the stored record and the written item set its server keys BEFORE `...merged`, so a body `PK`/`SK`/`id`
chose the item written. Witnesses: an admin of tenant A wrote tenant B's record; a catalog admin wrote
`{"PK":"TENANT#…","SK":"PRODUCT#…","price":"999"}` — a priced product item, past every product write boundary; a body
`id` relabelled the record (the renderer copies `item.id`, `renderer/src/lib/dynamo.ts:141`). The defect class: *a
written item whose keys come from an unparsed request body*. It invalidated this document's cycle-4 claim "no other
product writer", which rested on a literal search for `PRODUCT#` writers — a search that cannot see a write target
chosen at run time.

**Where it was fixed.** Not here: the human ruled "fix first", and the operator fixed it in SETTINGS-KEYS-1
(`docs/slices/settings-keys-1.md`, commit `2ff85c7` on `main`; staging verified, prod on the human's word). The
operator proved the defect live on staging and swept the class (the settings handler was the only site). The rule:
the body never names the item; the handler does — `SERVER_OWNED_FIELDS` (`backend/src/tenant/settings.ts:20`) are
removed from the body before the merge (`:102-103`), and the written item sets `PK`, `SK`, `id` after the spread
(`:144-149`). SETTINGS-KEYS-1 does not validate config content (its § 8 (c)); this spec's narrow two-flag parse is the
first validation on that route.

**What changed in this document.**
- Header: the cycle-5 line naming the prerequisite (line 14).
- § 3.1 "Never changed online" (lines 72-81): the prerequisite, its rule and its scope.
- § 3.1 write-rules table, settings row (line 91): `settings.ts` citations moved to the post-fix lines (`:85-169`,
  `:95`, `:101`, `:102-103`, `:105-110`, `:111-131`, `:142-150`) and the key binding stated. The regression-class
  bullet (line 103) cites `:142-150`. All `settings.ts` line citations in this document were re-checked against the
  file at HEAD `a1fbacf` (EXECUTED, `sed -n`); SETTINGS-KEYS-1 shifted the handler by about 11 lines, and only
  `backend/src/tenant/settings.ts` among the cited code files changed in `2ff85c7`/`a1fbacf` (EXECUTED,
  `git show --stat`).
- § 3.1 backend reader table, settings row (line 169): the write target is the checked tenant's record only.
- § 8.4 F-3 (lines 1115-1122): new item (v) — no other product writer, now true because the settings route can no
  longer name a `PRODUCT#` item; closure rests on SETTINGS-KEYS-1 being deployed wherever `cat-mode-1` is.
- § 8.2 S1 files read (line 1052): `settings.ts` re-read after the fix; `settings-keys-1.md` § 2 and § 8.

No ratified or superseded block was changed. Oracles after cycle 5: 1 and 4 unchanged in kind; 2 re-run; 3 = **11**.

### 8.10 Cycle 6 record (builder, 2026-10-28, after review-4 `escalate`)

Line numbers below are of this document as it stands after cycle 6.

**C5-1 — what was found.** SETTINGS-KEYS-1 bound the base key of the settings write, but not the index keys. Two
vectors:
- *Index-key impersonation* (review-4, real handlers, I/O mocked): a tenant-A admin saved `TenantSlug: "<B>#probe"`,
  `Type: "Product"`, `status: "active"`, `price: "999"`; `GSI_Slug` projects all attributes, and
  `GET /public/products/{slug}` / `GET /public/categories/{slug}` took the first index hit without checking its
  partition, so A's tenant record — price and secrets included — became the public answer for B's slug.
- *Hostname claim* (operator, live on staging, two throwaway tenants deleted after): `PUT /settings` with another
  tenant's `domain` answered 200, and the renderer's tenant lookup for that hostname then saw two tenant records.
Defect class (one rule closes it): *request-controlled metadata must not decide a record's tenant namespace or public
entity classification* — binding only the base primary key is not enough.

**Where it was fixed.** Not here: the human ruled "fix first" again, and the operator fixed it in SETTINGS-KEYS-1B
(`docs/slices/settings-keys-1.md` § 12, commit `569202e` on `main`; staging verified, prod on the human's word):
eleven key names stripped (`backend/src/tenant/settings.ts:26-29`, `:111-112`); both public slug readers accept only
the tenant's own `PRODUCT#`/`CATEGORY#` items (`products/public-get.ts:28-30`, `categories/public-get.ts:29-31`) — the
third named exception to the commerce freeze; a hostname held by another tenant refused with 409
(`settings.ts:149-164`). Named window, not closed: two simultaneous (or index-lagged) claims of the same new hostname
(`settings-keys-1.md` § 12.4; follow-up § 12.7 (a)).

**What changed in this document.**
- Header (lines 14-17): both prerequisites named.
- § 3.1 "Never changed online" (lines 74-98): 1B added — no key of the table or of any GSI, no other tenant's hostname,
  partition-checked public readers, the named hostname window.
- § 3.1 write-rules settings row (line 106) and regression-class bullet (line 118): `settings.ts` citations moved to
  the post-`569202e` lines.
- § 3.1 backend reader settings row (line 184): no index key, no other hostname.
- § 3.2.4 rows `products/public-get.ts` (line 271; `:40` → `:43`, partition check `:28-30`) and
  `categories/public-get.ts` (line 285; sweep hit `:33` → `:36`, partition check `:29-31`).
- `public-get.ts:43` in § 3.4 (line 417), CM-D3 evidence (line 727 — CM-D3 is open, not ratified) and § 8.4 F-6
  (line 1162).
- § 8.4 F-3 (v) (lines 1130-1151): not by key, not by index, not by hostname; the named window; closure rests on both
  prerequisites being deployed.
- Sweep re-run after `569202e` (EXECUTED): renderer/src 81/6, admin/src 41/7, tools/mcp-server/src 20/1,
  backend/src 62/12, packages/shared/src 7/1 — unchanged.

**Citations this cycle may not edit, mapped to the current code.** `569202e` changed three cited files
(`git show --stat`, EXECUTED): `backend/src/tenant/settings.ts`, `backend/src/products/public-get.ts`,
`backend/src/categories/public-get.ts`. Ratified blocks are not reopened, and the cycle records § 8.8–8.9 describe the
code at the commit they were written against (§ 8.8: `a1fbacf` and earlier; § 8.9: `a1fbacf`). Their citations of
those three files map to the code at HEAD `7d0b522` as follows (OBSERVED, `sed -n`):

| Where cited | Cited as | Now |
|---|---|---|
| CM-D8 block (ratified), § 8.8 | `products/public-get.ts:40` (`JSON.stringify(product)`) | `:43` |
| CM-D11 block (ratified), § 8.8 | `products/public-get.ts:39` (`Cache-Control: public, max-age=60`) | `:42` |
| CM-D11 block (ratified), § 8.8 | `categories/public-get.ts:48` (`products`) | `:51` |
| § 8.9 | `settings.ts:20` (`SERVER_OWNED_FIELDS`) | `:26-29` |
| § 8.9 | `settings.ts:85-169`, `:95`, `:101`, `:102-103`, `:105-110`, `:111-131`, `:142-150`, `:144-149` | `:94-202`, `:104`, `:110`, `:111-112`, `:114-119`, `:120-140`, `:175-183`, `:177-182` |

Every other cited line in those three files was moved in the body of this document above. No ratified or superseded
block was changed. Oracles after cycle 6: 1 and 4 unchanged in kind; 2 re-run; 3 = **11**.

### 8.11 Ratification record (cycle 7, 2026-10-28)

The human ratified every open decision on 2026-10-28 after review-5 (`approved`) and the decision-review packet
(11 converged, 0 contested). Each ruling is a dated line appended inside its block; no existing block text was
reworded. Line numbers below are of this document as it stands after cycle 7.

| ID | Final line(s) |
|---|---|
| CM-D1-PRICE-ABSENCE | RATIFIED 2026-10-27 (human): (b), together with CM-D6 = A |
| CM-D2-IMAGE-POLICY | RATIFIED 2026-10-28 (human): (b), with the destination policy of the corrected cell (line 770) |
| CM-D3-IDENTITY-KEY | RATIFIED 2026-10-28 (human): (b), the title + collection + producer composite — **against the recommendation** ((a2)); reward taken: no new field and no wait for a glamCRM export; risks accepted as named: a renamed product duplicates, a producer rename orphans a collection. Operator correction the same day: the composite also includes `format` (line 817) |
| CM-D4-EXPLODE-VS-GROUP | RATIFIED 2026-10-28 (human): (a); grouping is the named follow-up after real category pages (line 855) |
| CM-D5-INTEREST-RECORD | RATIFIED 2026-10-28 (human): (b) (line 908) |
| CM-D6-ORDER-GUARD | RATIFIED 2026-10-27 (human): (A) |
| CM-D7-IMAGE-ABSENCE | RATIFIED 2026-10-28 (human): (a), with explicit removal on update (line 1094) |
| CM-D8-WRITE-CLOSURE | RATIFIED 2026-10-28 (human): A; ACCEPTED REFINEMENT 2026-10-28 (operator): a non-empty `personalizations` array is refused on a catalog tenant; the `"0"` exception is deleted (line 947) |
| CM-D9-TRANSITION-COORDINATION | RATIFIED 2026-10-28 (human): A; SUPERSEDED 2026-10-28 by CM-D11 |
| CM-D10-COMMERCE-ENTRY | RATIFIED 2026-10-28 (human): B; SUPERSEDED 2026-10-28 by CM-D11 |
| CM-D11-MODE-FIXED-AT-CREATION | RATIFIED 2026-10-28 (human): fixed at creation; ACCEPTED REFINEMENT 2026-10-28 (operator): every mode read is strongly consistent and refuses a missing tenant record with 404 (line 1053) |

**What changed in this cycle.**
- Status line and header (lines 3-25): RATIFIED status; the cycle-7 summary; "Open: none".
- § 3.1 (lines 112, 134-144): the settings read becomes strongly consistent and refuses a missing tenant record
  (404); the general fail-closed read rule with its six readers, the order handler's existing behaviour
  (`orders/create.ts:70-74`) and the named, intended regression (no more `{ name: "Unknown" }` records).
- § 3.2.2 (lines 256, 258) and closing rule (lines 339-345): CM-D7 corollary — drop empty `price`/`salePrice` under
  catalog mode only (a commerce save that dropped a cleared `salePrice` would keep the old one through the merge at
  `products/update.ts:43`, and would change commerce bytes); an update that clears a stored image sends
  `imageLink: null`, the handler deletes the key.
- § 3.4 (lines 387-520): 12-column input; column 9 and 11 rows; the identity paragraph rewritten for CM-D3 (b) —
  composite producer + colecție + produs + format, normalisation (NFC, trim, whitespace collapse, lower-case,
  diacritics kept), `\u001f` join, `sha256`, lookup `PRODUCTREF#glam#<sha256>`, conditional writes, `conflict` and
  `duplicate-key` statuses (the file is no longer refused for duplicates), the "changed composite = new product,
  old one absent" consequence, follow-up `GLAM-IDENTITY-MIGRATION-1`; fail-closed tenant read in the importer;
  explicit `imageLink` removal; absent-rows paragraph aligned with (b); parser indices 0, 1, 6–11.
- § 3.5 (lines 552, 604): CM-D5 record labelled ratified; the interest handler's tenant read is strongly consistent
  with 404 on a missing record.
- § 4 CM-D1 implementation note (lines 727-735) and CM-D8 specification guard 3 (line 970): the refusal list now
  refuses a non-empty `personalizations` array; the `"0"` exception is deleted.
- § 5 non-scope (line 1104), § 8.4 F-3 item (vi) (line 1232), F-4 (line 1236), F-6 (line 1244), § 8.5 (lines
  1277-1313): aligned with the rulings; the § 8.5 `cat-images-1` need now names the destination policy and that the
  WordPress and media importers inherit the refusal (operator confirms in that slice).
- F-3 and the "conditional" wording: F-3 carried no wording conditional on the CM-D11 mode reads (the decision-review
  proposed it but it was never written here). With the accepted refinement in place, F-3 now states closure by
  construction (item (vi) added). The dependency on SETTINGS-KEYS-1 and 1B being deployed stays: it is a deployment
  fact, not a design condition.

**Not changed:** CM-D1, CM-D6 and the text of every block (only appended lines); the four impl packets; the plan; any
code. Oracles after cycle 7: 1 and 4 unchanged in kind; 2 re-run; 3 = **11**.

### 8.12 Cycle 7 revision (builder, 2026-10-28, after review-6 `revise`)

Three transcription defects, no ruling reopened (lines of this document after this revision):
- **C7-1 — an identity guarantee asserted, not enforced.** § 3.4 said `\u001f` "cannot appear in a value typed by a
  person"; nothing checked it, and review-6 executed a collision. Now: every normalised identity component is
  checked; a cell containing `\u001f` makes the row `skipped` (`separator-in-key`, column named), a `producer`
  value containing it refuses the request (400); the empty format stays valid; the witness is a CAT-IMPORT-1 unit
  obligation (§ 3.4 "Separator rule" and "Join and key", the `skipped` reason union, § 8.5 `cat-import-1`). The
  builder re-ran the claims (§ 8.1, EXECUTED).
- **C7-2 — a default applied to one side of a comparison only.** The cycle-7 settings row compared the narrow
  parse's defaulted `catalogMode` with the raw `current.catalogMode`; for an existing tenant without the attribute
  that reads `false !== undefined` and would refuse an ordinary save. Now both sides use absent-as-false, and an
  existing record without the flag is told apart from a missing record (404) (§ 3.1 write-rules settings row).
- **C7-3 — a ratified policy summarised more broadly than ratified.** § 8.5 `cat-images-1` said "IPv4-mapped
  addresses"; the corrected cell refuses addresses IPv4-mapped TO the prohibited ranges, and refuses when ANY
  resolved address is prohibited. § 8.5 now copies both qualifications and the ranges.

Rule applied to all three: a guarantee the spec states must name the check that enforces it, with the same
interpretation on every side it compares. Line numbers in § 8.11 refer to the document before this revision: up to
§ 3.4's "Separator rule" they are unchanged; after it they are 11 lines lower up to § 8.1 (e.g. the CM-D2
ratification line 770 → 781, CM-D3 817 → 828, the CM-D11 refinement 1053 → 1064), 12 lines lower from § 8.1 (one
added row; F-3 item (vi) 1232 → 1244), and up to 16 lines lower from § 8.5 on (§ 8.5 grew by 4 lines; § 8.6
1315 → 1331). No block text changed. Oracles: 1, 2, 4 unchanged in kind; 3 = **11**.

### 8.13 Cycle 8 amendments (builder, 2026-10-28, directive § 11 "cycle 9") — the human's direction on file evidence

Numbering: the directive asks for "§ 8.12 Cycle 8 amendments"; § 8.12 already holds the cycle-7 revision record
(review-6), so this record is § 8.13. Line numbers below are of this document after this cycle.

**The direction** (quoted in § 1 as a dated addendum): import directly from glamCRM's enriched CSVs now; glamCRM-driven
population later (named only); filters for producers, categories and all applicable fields (new slice
`cat-facets-1`); the catalog is disposable — a re-import replaces the file's products.

**The evidence.** The operator's measurement of the 24 enriched CSVs, reproduced by the builder (§ 8.1, EXECUTED):
totals match exactly (2,861 rows; 915 repeats; 113 groups, 1,028 rows; 21 imageless groups; 82 groups with
all-distinct codes; AUR.csv 212 of 219). Two details differ and are recorded, not resolved: the decor/tier image
split (operator 58/34; builder 51/41 or 60/32, by definition), and AUR.csv's most frequent `produs` values (observed
"Wood", "Herringbone", "Stone"; the operator's text says "Wood" / "Dryback").

**What changed.**
- § 1 addendum (the four quoted directions).
- Header and status line: "amended the same day on file evidence"; cycle-8 summary; "Amended: CM-D3, CM-D4".
- CM-D3 and CM-D4 blocks: dated EVIDENCE and AMENDED lines appended after the RATIFIED line (append-only).
- § 3.4 rewritten from "**Input.**" to before "**Route placement**": enriched CSV input and upload fields; the column
  table (columns 2–5 never read); identity within one import (composite, normalisation with NFC last, separator rule,
  owed tests, slug, fresh ids); grouping (main image + gallery, specs and attributes from the first row, `differing`
  report); replace per file (`importSource`, previous-set query, dry run, execute order, category slugs, named
  windows, CAT-IMAGES-1 note); report shape (`created` / `merged` / `skipped`, `deleted` count, image disposition);
  NO-CODES / NO-PRICES type guarantee; future items named.
- § 3.5: shortlist item snapshot `{ productId, title, slug, imageLink }` deduped by slug; payload items carry `slug`
  and the chosen `imageLink` (kept only if it is one of the product's own images); the server resolves an id a
  re-import renewed by its slug, before calling it unknown.
- § 3.7 (new): Facets — requirement, facet source (the `CATPROD#` projection and the shop read carry neither `brand`
  nor `attributes`), URL state and the cache-key allowlist consequence, order, ROADMAP row.
- § 8.1 three EXECUTED rows; § 8.4 F-4; § 8.5 `cat-import-1` rewritten, `cat-images-1` and `cat-interest-1` extended,
  `cat-mode-1` gallery note, `cat-facets-1` added.

**What was withdrawn** (cycle-7 contract, by CM-D3/CM-D4 AMENDED): the lookup item `PRODUCTREF#glam#<sha256>` and its
`contentHash`/`sourceImageUrl`; the conditional transactional writes; the strongly consistent existence read and the
deletion-recovery mechanism; the `unchanged`, `update`, `recreate`, `conflict` and `duplicate-key` statuses; the
image-preservation-on-update rule; the "rows absent from the file: leave and report" rule (replace per file instead);
the "grouping follow-up" of CM-D4 (the data decided it). The CM-D3 lookup text remains in the blocks and in
§ 8.11–8.12 as history.

**Builder notes the reviewer should see.**
- The directive says to keep "the cycle-8 order and its idempotence/canonical-equivalence tests … exactly as written —
  they stand". They were not in this document: the decision-review's CM-D3 correction (`decision-rebuttal.md`,
  final NFC after lower-casing, tests (i) and (ii)) had not been written in. The builder wrote them now, in the
  directive's order (trim → collapse → lower-case → NFC last; the corrected cell also had an NFC first, which the
  directive's order drops), and re-ran both tests (§ 8.1).
- The directive describes `attributes` as `{ name, value }`; the schema is `{ key, value }`
  (`packages/shared/src/index.ts:1033-1036`). § 3.4 uses the schema's field name.
- "`slug` = slugify(composite)": applied literally, slugify drops `` and glues the words (§ 8.1); § 3.4 joins
  the normalised components with a space for the slug. `normalizeSlug` is not used for product or category slugs
  (leading `/`, drops `ș`) — a correction to cat-import-1 § 2.3, listed in § 8.5.
- New consequence the directive did not spell out: a re-import renews product ids, so a visitor's saved shortlist
  holds ids that no longer exist; without a rule the § 3.5 validation would drop them as unknown. § 3.5 now resolves
  such an id by its slug (one `GSI_Slug` query per miss, partition-checked).

No ratified text was reworded; CM-D1, CM-D6 and the original § 1 quote are unchanged. Oracles: 1, 2, 4 unchanged in
kind; 3 = **11**.

### 8.14 Cycle 10 amendments (builder, 2026-10-28, directive § 12) — the product grain and the four C8 findings

Numbering: the directive asks for "§ 8.13 Cycle 10 amendments"; § 8.13 already holds the cycle-8 record, so this is
§ 8.14. Line numbers are of this document after this cycle; look sections up by their headings.

**A. Grain (human ruling on the per-vendor evidence).** A storefront product is a STYLE; each row of the style is a
VARIANT labelled by `format`, with its image. Written as: CM-D3 AMENDED (the key loses `format`), CM-D4 EVIDENCE and
AMENDED (append-only); § 3.4 "Product key", "Variants" (one group per product, dedupe-then-label, the derivation rule
for `imageLink`/`additionalImageLinks` stated once), "Per-vendor prerequisites in pl-tools"; § 3.2.6 the new
presenter row; § 8.5 `cat-mode-1` presenter, `cat-import-1` grain. Evidence reproduced where the files allow (§ 8.1).

**B. The four review-8 findings, by class.**
- **C8-1 — a "replace" guarantee with no exclusion of overlapping jobs** (operator ruling A, with a lock item). Rule:
  a destructive replace runs only while the job holds the per-tenant lock `IMPORTLOCK#glam`, taken by a conditional
  write. Plus `ConsistentRead: true` for the previous-set query and the partial-failure recovery (non-2xx is not
  invalidated, `invalidate-cdn.ts:263-267`; re-import heals). § 3.4 "Replace per file, under a per-tenant import
  lock".
- **C8-2 — an identifier whose separator may occur in its parts.** Rule (the same rule as the key's `\u001f`): a
  separator of an identifier may not occur inside any of its components — `/` and `\u001f` are refused in producer and
  sheet (400 before any mutation); the producer field offers existing brands; the dry run lists the previous set
  (count + first ten titles). § 3.4 "Upload fields".
- **C8-3 — an identity claim the ruling did not grant** (operator ruling A). Rule: slugs are URLs, never identity.
  Expired shortlist items are shown and reselected; a submission carries only resolved items; nothing is rebound.
  The cycle-8 slug-recovery text in § 3.4 and § 3.5 is withdrawn.
- **C8-4 — consumer contract gaps for the grouped product.** Rule: every consumer of the variant group is listed with
  what it emits, and none emits `priceOverride` (§ 3.2.6 rows: feed, both JSON-LD blocks, MCP `get_product` /
  `list_products`, the admin Variants tab, the public JSON routes). Also: the interest selection comes from the variant
  presenter, not from `ProductImageGallery`'s private state; the validation projection gains `slug, imageLink,
  variants`; the report gives CAT-IMAGES-1 the fresh `productId`; the per-source image-failure rule; specs from the
  first row with non-empty specs (review-8's `HER.csv` witness).

**Builder decisions recorded in one line each (local, implied by the rulings).**
- Option labels must be unique within a product, because the interest list names an option by its `value`: after
  dedupe, empty labels become `#<n>` and remaining duplicate labels get ` (2)`, ` (3)`…; the report lists them.
- Dedupe compares the raw normalised `format` and the image URL BEFORE `#<n>` labels are assigned — otherwise every
  empty-format ALPOD pack variant would get a distinct `#<n>` and none would dedupe, against the ruling.
- `format` is no longer an `attributes` entry (it is the variant label); facets read the option values (§ 3.7).
- The admin editor omits empty `priceOverride`/`availability` from options on a catalog tenant (`ProductEditor.tsx:413`
  initialises both), or the CM-D1/CM-D8 refusal of a present key would refuse every save of an imported product.

**Withdrawn this cycle:** the cycle-8 "one product per distinct composite, other rows as its gallery"; `format` in
the key; the `merged` row status (now `option` / `deduped`); the cycle-8 slug-recovery for interest items; the
`main` / `gallery` image dispositions (now `used` / `absent` / `invalid` per option).

No ratified text was reworded; CM-D1, CM-D6, the original § 1 quote and § 2 are unchanged. Oracles: 1, 2, 4 unchanged
in kind; 3 = **11**.

### 8.15 Cycle 11 corrections (builder, 2026-10-28, directive § 13) — the projection protocol in it is WITHDRAWN by § 8.16

Numbering: the directive asks for "§ 8.14 Cycle 11 corrections"; § 8.14 holds the cycle-10 record, so this is § 8.15.

**C10-1 — writers that can restore what a replacement deleted** (operator ruling A, bounded to conditional writes).
Class: *a write decided on a read that may be stale, committed without re-checking that its target still exists.*
Rule: every product write commits only if the product still exists (`attribute_exists(PK)`), and every `CATPROD#`
projection is written in the same transaction as such a product write or existence check; a delete removes the
projections of the item as it was when deleted (`ReturnValues: "ALL_OLD"`). Applied to `products/update.ts` (the
`Put` at `:50` and the rebuild at `:55-59`, now one transaction), the replacement's deletes, `products/delete.ts`, and
CAT-IMAGES-1's updates; `products/create.ts` (fresh ids), `import/woocommerce.ts` (refused) and
`products/bulk-price.ts` (writes nothing on a priceless tenant) need nothing. Lock: owner token; only the owner
releases (`owner = :me`); a contender's 409 touches nothing; the tenant checks run before the lock. Guarantee
stated in § 3.4: after a successful import the sheet's product set equals the file's set, and its `CATPROD#` items are
exactly that set's projections. Sections: § 3.4 "Lock", "Execute", "Writers during a replacement"; § 4 CM-D1
implementation note; § 8.5 `cat-mode-1`, `cat-import-1`, `cat-images-1`.
*Builder note:* the directive names the conditional `Put` and "the CATPROD# rebuild never runs" when the write is
cancelled. It does not cover two interleavings that review-9 asked to be reviewed ("delayed `CATPROD#` writes"): an
update whose `Put` succeeds before the delete and whose rebuild lands after it, and a delete that removes the
categories an earlier query read while a concurrent edit changed them. Both leave a card for a deleted product,
because category pages read `CATPROD#` items directly (`renderer/src/lib/dynamo.ts:264-294`). The projection rule
above closes both with conditional writes only — within ruling A as bounded. If the decision-review prefers the
narrower text, these two interleavings stand as named residuals.

**C10-2 — a dedupe key narrower than the identity it protects.** Rule: deduplicate a thing by its full identity;
narrow keys only where a store requires it. Retained interest items by `(productId, optionValue)`, fetch keys by
`productId`; a chosen option the product no longer has → the item is dropped (`option-not-found`), never degraded;
label allocation is collision-aware against every label already present (two owed tests). § 3.4 "Dedupe first, then
label"; § 3.5 item validation; § 8.5 `cat-interest-1`, `cat-import-1`.

**C10-3 — a derived field with more than one writer.** Rule: on a product carrying `importSource`, the variant group
is the only source; `imageLink`/`additionalImageLinks` are recomputed from it on every write and a direct edit is
overwritten; one group, unique values, no `""` option image (400) — enforced at the write boundary for such products
only; the shared schema and all other products are unchanged. § 3.4 "Derived" and "Invariants"; § 3.2.2 editor
rows; § 4 implementation note; § 8.5 `cat-mode-1`.

**C10-4 — a stale active summary.** § 3.2.5's `ProductVariantSchema` row no longer says "no variants written by the
catalog import". Search of the active text for "no variants", "CM-D4 = (a)" and "CM-D4 = a" outside the decision
blocks and the historical records (EXECUTED `grep`): the only other matches are three § 3.2.6 consumer rows
(product-page JSON-LD, legacy-page JSON-LD, MCP `list_products`) saying those consumers emit no variants — true of
the current grain, so unchanged.

No ratified text was reworded. Oracles: 1, 2, 4 unchanged in kind; 3 = **11**.

### 8.16 Cycle 12 — scope freeze (builder, 2026-10-28, directive § 14, human scope ruling)

**The ruling (human, 2026-10-28):** products exact; the importer reconciles its own categories; projection races are a
follow-up outside this track. Taxonomy, applied:
- **R1 — import vs import:** closed by the owner-token lock (cycle 11). Unchanged.
- **R2 — a deleted product brought back by another writer:** closed by `attribute_exists(PK)` on `products/update.ts:50`
  and on CAT-IMAGES-1's update; fresh ids on create, which can no longer carry `importSource`; WooCommerce refused;
  bulk-price inert on a priceless tenant. Unchanged, plus C11-3.
- **R3 — `CATPROD#` consistency under two overlapping admin edits of one product:** pre-existing on every tenant,
  independent of the import → follow-up `CATPROD-CONSISTENCY-1` (§ 8.4) with its symptom and review-10's
  counterexample (C11-1). No mechanism in § 3.4.

**Withdrawn (C11-2):** the cycle-11 transactional projection protocol — the product `Put` and its `CATPROD#` deletes
and puts in one `TransactWriteCommand`, the `ReturnValues: "ALL_OLD"` delete rule for the replacement and for
`products/delete.ts`, CAT-IMAGES-1's `CATPROD#` updates in the same transaction — and its "more than fit → 400"
category limit. Why: (1) as specified it was not a valid transaction — the existing rebuild deletes all old
projections and writes all new ones, so an unchanged category gives a Delete and a Put on one key, which
`TransactWriteItemsCommand` prohibits (review-10, citing the installed SDK's `TransactWriteItemsCommand.d.ts`);
(2) it did not protect stale context anyway (C11-1); (3) the category limit was a new rejection rule without
authority — "a handful of categories — INFERRED" was not evidence. § 8.15's builder note describing that extension is
superseded by this record.

**Added:**
- § 3.4 "Execute" step (5) and "End-of-import reconciliation": for every category the import touched, rebuild its
  `CATPROD#` items from the current `PRODUCT#` items with the existing helpers; cost stated. (Completed in cycle 13,
  § 8.17: paginated reads, acknowledged writes, two new functions; the cost sentence corrected.)
- § 3.4 "Writers during a replacement": R2 only; R3 named as out of scope.
- § 3.4 "`importSource` is importer-owned" (C11-3): omitted from the parsed input of `products/create.ts:40-42` and
  `update.ts:39-41`, ignored rather than refused. The builder checked the zod behaviour (EXECUTED, zod 4.6.7): an
  omitted key in the body is stripped and the parse succeeds.
- § 3.4 guarantee: replaced in cycle 13 (C12-1, § 8.17) by: (a) the sheet's `PRODUCT#` items equal the file's set;
  (b) at the end of the reconciliation pass, the touched categories' `CATPROD#` projections equal their current
  products, in the absence of an overlapping admin edit (R3); (c) public pages follow the existing debounced
  publication, so a warm page may show the previous set until it completes. The cycle-12 page-exactness wording is
  withdrawn.
- CM-D1 implementation note: the withdrawal and the omit lists. § 8.4: `CATPROD-CONSISTENCY-1`. § 8.5: `cat-import-1`
  reconciliation and ownership; `cat-mode-1` omit lists and the conditional `Put` only; `cat-images-1` conditional
  update only.

No ratified or superseded block was reopened; R1/R2 unchanged. Oracles: 1, 2, 4 unchanged in kind; 3 = **11**.

### 8.17 Cycle 13 corrections (builder, 2026-10-28, directive § 15, after review-11 `escalate`)

Neither finding reopens the scope freeze (§ 8.16); R1/R2 and every ratified block are unchanged.

- **C12-1 — a guarantee stated past its mechanism** (operator ruling C12-RECONCILIATION-BOUNDARY = A; § 14
  sentence (b) was the operator's imprecision). The cycle-12 wording promised category PAGES exact at the end of
  the import. But `withInvalidation` only marks a pending invalidation (`backend/src/lib/invalidate-cdn.ts:259-271`),
  the debounced bulk invalidation publishes it later (`docs/caching-architecture.md:358-375`), and overlapping admin
  edits stay out of scope (R3). Rule: a guarantee names the layer it is about and the mechanism that makes it true;
  publication is a separate, named process. § 3.4 (lines 671-679) and the § 8.16 repeat (lines 2136-2140) now read
  (a) `PRODUCT#` set equals the file's; (b) `CATPROD#` projections of the touched categories equal their current
  products at the end of the reconciliation pass, unless an admin edit of one of those products overlaps (R3);
  (c) pages follow the existing publication process. `grep -n "show exactly\|exactly the current"` finds no
  stronger wording elsewhere (EXECUTED after the edit).
- **C12-2 — reuse of helpers whose completeness was assumed, not read.** `queryCatProducts`
  (`lib/catprod.ts:104-114`) reads one page; `writeCatProductItems`/`deleteCatProductItems` (`:57-98`) discard
  `UnprocessedItems` (OBSERVED in the code; review-11 executed both against mocked responses). Rule: every read the
  reconciliation decides on is complete (paginated to the end) and strongly consistent, every write is acknowledged
  (bounded retry, then a named non-success), and the write scope equals the claim scope. Changes, § 3.4:
  - the previous-set query drops its `FilterExpression` and selects the set in code, so the same tenant read
    gives every product's `categoryIds` whatever its origin (lines 571-577);
  - the reconciliation (lines 591-647): candidates from a paginated `ConsistentRead` `CATPROD#<C>#` read, the
    step-(3) members of any origin and the created products; a `ConsistentRead` `BatchGet` (≤ 100 keys,
    `UnprocessedKeys` retried) decides membership; writes for category `C` only, `UnprocessedItems` retried
    (5 resends, 100 ms doubling, at most 3.1 s waiting per request); 503 with `incompleteCategories` when the
    bound is exhausted;
  - two new functions in `lib/catprod.ts` inside `cat-import-1` (`listCatProductIds`, `writeCategoryProjections`),
    each with its abstraction line; the three existing helpers and their eight call sites are unchanged;
  - the cost sentence: the reconciliation adds no tenant-wide read (the step-(3) read already exists and its cost is
    unchanged); per touched category, O(products and projections of that category).
  - § 8.4 `CATPROD-CONSISTENCY-1` gains the two helper instances (lines 1581-1590); § 8.5 `cat-import-1` restates
    the reconciliation and the guarantee (lines 1613-1620); § 8.1 records the caller search and the SDK field check
    (lines 1429-1431); header line for this cycle (lines 42-45).
- **Builder choices within the directive (recorded, not decisions):** 503 as the non-success status (the cause of an
  exhausted bound is throttling, a retryable condition); the retry bound (5 resends, 100 ms doubling with full
  jitter); per-category writes rather than an accounting of the existing helper's all-category fan-out (the write
  scope then equals the claim scope in (b), and an incomplete category maps to one `categoryId` in the report);
  candidates (ii) from the existing step-(3) read rather than a second tenant read (without (ii), a product of `C`
  whose projection an earlier lost batch dropped would not be found, and (b) would be false for it).

Oracles: 1, 2, 4 unchanged in kind; 3 = **11**.

### 8.18 Ratification and operator closeout (operator, 2026-10-28)

- Decision-review pass regenerated 2026-10-28T21:21:38Z after the cycle-13 approval (`gpt-6.1-sol` challenge,
  `claude-opus-5-5` rebuttal): 11 converged, 0 contested. The four challenges (CM-D3, CM-D4, CM-D9, CM-D10)
  quoted the historical RECOMMENDED lines; each rebuttal conceded that the AMENDED (D3, D4) or SUPERSEDED (D9, D10)
  line is the final state. No mechanism changed. One builder note recorded: the canonical layout (`PRICELISTS.md:10`,
  collection only on header rows) differs from the real enriched files (collection filled on every product row);
  a file following the canonical layout is refused openly per row (`no-collection`), never merged under a wrong key.
- Final state of the eleven blocks: CM-D1 (b), CM-D6 (A), CM-D8 (A + accepted refinement), CM-D11 (fixed at
  creation + accepted refinement) RATIFIED; CM-D2 (b, destination policy), CM-D5 (b), CM-D7 (a, null removal on
  update) RATIFIED; CM-D3 and CM-D4 RATIFIED then AMENDED the same day on the enriched-file evidence (style grain;
  `format` = variant label; replace per file; no cross-import identity); CM-D9 and CM-D10 SUPERSEDED by CM-D11.
  Scope freeze (§ 8.16): R3 projection races = `CATPROD-CONSISTENCY-1`, outside this track.
- Thirteen build cycles, nine escalations, every escalation a correct finding against the packet, a ruling or the
  code; two findings were live production defects fixed first (SETTINGS-KEYS-1 `2ff85c7`, SETTINGS-KEYS-1B
  `569202e`, both on prod 2026-10-28). Operator oracles at closeout: `git status --porcelain` one line;
  `DECISION_REQUIRED:` count 11; `git diff --check` exit 0.
- Prerequisites recorded outside this repo: glamCRM `docs/slices/pl-tools-2.md` (per-vendor `produs`/`format`
  mapping for ITC and ALPOD; local commit `2f8b488`).
