# CAT-FACETS-1 — storefront filters on catalog shop and category pages (SPEC slice)

Status: **PLANNED** (2026-10-30) — implementation not started (`docs/documentation.md` § Status taxonomy).
Design state (separate from the lifecycle status): spec revision 2 (2026-10-30, after review-1 `revise`; corrections
by class in § 11); next step decision-review, then the human. SPEC ONLY: this file is the whole deliverable; no code,
infra or test file changes with it. Five decisions are open (§ 9). The impl slice (`cat-facets-1-impl`, outlined in
§ 8) starts only after the human rules on them.
Track: F — Glam catalog (`docs/ROADMAP.md`, row `cat-facets-1`). Parent spec: `docs/slices/catalog-mode-1.md` § 3.7
(names the slice, does not design it). Depends (shipped or built): `cat-mode-1` (shipped), `cat-import-1`,
`cat-images-1`, `cat-interest-1` (built, prod deploy pending). Written from `main` at `39f4081`.
Maturity target: the facet module enters as **PROTOTYPE**; it becomes MATURE when the impl slice's staging evidence
(§ 8.4) is recorded.

Evidence labels: **OBSERVED** = read in the file at the cited line on `39f4081` (2026-10-30); **EXECUTED** = a command
was run (§ 10); **INFERRED** = a conclusion from observed code or documented vendor behaviour, not run. Every
`file:line` is OBSERVED unless marked otherwise.

---

## 1. Purpose and the human's direction

> Human direction, 2026-10-28 (`catalog-mode-1.md` § 1 addendum, item 3): "The storefront should have filters and
> categories and producers and whatnot for all applicable fields."

> Requirement as the parent spec states it (`catalog-mode-1.md` § 3.7): "On the shop page and on category pages a
> visitor filters by producer (`brand`), collection, format, unit, packaging and minimum order — every `attributes` key
> the import writes (§ 3.4) — and sees a count per value."

**What this slice retires.** A catalog site has up to ≈ 1,900 products today (§ 2.2) and the only ways to narrow a
listing are the category tree and the search box. The visitor cannot ask "BOEN planks of 14×138×2200 mm" or "ALPOD
profiles sold per metre". This design gives the listing pages a filter panel with a count per value, without a price
surface (CM-D8 stays closed: no facet reads a monetary field), and without any change for non-catalog tenants (§ 7).

**Vision tie.** VISION "Core product guarantees" 1 (tenant isolation: every read is one tenant's `PK`) and 3 (the
filter rules are a pure function, testable off-target — § 8.1 `facets.ts`); "How work is executed" (expand before
contract, production-sensitive CDK: the one infra change has a named gain, § 5.3).

**Three findings change the shape the ROADMAP row assumed** (row `cat-facets-1`, `docs/ROADMAP.md:194`):

1. **Filtered pages are never cached at the edge** (§ 5.3, code-proven). The row's named gain "filtered pages cached
   per value" is false. The allowlist entry is still required — for CORRECTNESS, not caching.
2. **The CloudFront cache policy accepts at most 10 query-string names** (AWS quota "Query strings per cache policy:
   10", adjustable only by a support case — § 5.2). The allowlist holds 7 today
   (`infra/lib/renderer-hosting.ts:568-587`). One named parameter per facet (6) does not fit.
3. **The `CATPROD#` projection does not need to change** if the catalog listing reads `PRODUCT#` — which the shop page
   already does for every tenant (§ 3). That path touches no backend writer. The row assumed the projection grows.

---

## 2. Facet set

### 2.1 Candidate fields and their source (OBSERVED)

The importer writes, per product (`backend/src/import/glam-pricelist.ts:449-480`, `productItem`): `brand` = the upload's
producer (`:463`); `attributes` = `[{ key, value }]` (`:467`) with the keys of `backend/src/import/glam/map.ts:128-133`
(`colecție`, `unitate`, `împachetare`, `comandă minimă`), empty values omitted, values from the FIRST row of the
style (`map.ts:180-189`, `mapStyle`); exactly one variant group whose option `value`s are the `format` labels (idx 11),
with generated labels `#1`, `#2`, … for empty cells and `<label> (n)` for duplicates (`catalog-mode-1.md` § 3.4
"Collision-aware allocation"). The importer also turns producer and collection into categories: a parent per producer
and a child per collection (`map.ts:140-152`, `planGlamImport`).

| Facet id (§ 5.1) | Label (RO) | Source on the `PRODUCT#` item | Offered |
|---|---|---|---|
| `producator` | Producător | `brand` | yes |
| `colectie` | Colecție | `attributes[key="colecție"].value` | yes |
| `unitate` | Unitate de măsură | `attributes[key="unitate"].value` | yes |
| `impachetare` | Ambalare | `attributes[key="împachetare"].value` | yes |
| `comanda-minima` | Comandă minimă | `attributes[key="comandă minimă"].value` | yes — hidden while no product has it |
| `varianta` | the variant group `name` (§ 4.5) | `variants[].options[].value`, minus generated `#<digits>` labels (§ 2.3) | yes |

No other `attributes` key is written by the importer: `ATTRIBUTE` (`map.ts:128-133`) is the only place the keys are
named, and the 12-column layout is frozen (`catalog-mode-1.md` § 3.4 "Input"). So the facet set is CLOSED: a later
fill of columns 6–8 or 11 (PL-TOOLS-2) changes VALUES, never the set. Hand-created products in a catalog tenant can
carry other `attributes` keys (the schema allows any key, `packages/shared/src/index.ts:1044`); they are not facets
(§ 9 CF1-FACET-SET names the consequence).

### 2.2 Values today, per producer (EXECUTED, § 10 E-7, E-8)

Measured by running the importer's own pure core (`parseGlamCsv` + `planGlamImport`, producer = vendor name, sheet =
file name) over the enriched files of 2026-08-02 (`glamCRM/pl-tools/out/<vendor>/enriched/*.csv`, read only). This is
the PRODUCT grain the import writes, not the row grain.

| | ALPOD (21 files) | BOEN (1 file) | ITC (2 files) |
|---|---|---|---|
| data rows → products → options | 1,803 → **915** → 1,503 | 478 → **437** → 455 | 580 → **576** → 580 |
| categories (parent + children) | 120 | 28 | 2 |
| `producator` | 1 value | 1 value | 1 value |
| `colectie` | 119 values, on 915 / 915 | 27 values, on 437 / 437 | 1 value, on 576 / 576 — the sentence "Prices in EUR per m², valid from 01.03.2024, ex works Tielt, Belgium" |
| `unitate` | 2 values (`buc` 151, `ml` 135), on 286 / 915 | none | none |
| `impachetare` | 38 values (e.g. `60x15x2500` 23), on 154 / 915 | none | none |
| `comanda-minima` | none | none | none |
| `varianta` (real labels) | **none** — all 1,503 labels generated (`#1`…`#44`, max 44 options per product) | **26 values** (e.g. `14x138x2200 mm` on 73 products); 53 options generated (`#1`) | **none** — all 580 labels generated |
| rows of one style that differ in idx 6–8 | 0 (only specs differ: 28 styles) | 0 (specs: 8) | 0 |

The last row matters: `unitate`/`împachetare` are taken from the first row of a style, and no style has rows that
disagree on them, so the stored attribute is exact for every product today.

**Shop page of a tenant with all three producers:** `producator` 3 values, `colectie` 147 values, `unitate` 2,
`impachetare` 38, `varianta` 26 (BOEN only), `comanda-minima` hidden.

**Reconciliation with the packet's row-level table (§ 0).** Row-level counts EXECUTED (E-7) agree on every empty
count; distinct counts differ by one where the packet says unit 3 / packaging 39 / BOEN format 27 and the measure says
2 / 38 / 26 (trimmed, non-empty). INFERRED cause: the packet counted the empty value as a value (2 + 1, 38 + 1,
26 + 1). Not a contradiction of substance.

### 2.3 Rules that decide what a visitor sees

- **A facet is shown exactly when selecting could change the listing; otherwise it is HIDDEN** (no heading, no
  space). One rule: facet F is rendered iff F has an active selection, OR some value of F is held by at least one but
  not all products of the BASE set (the page's products before any facet filter). The rule follows from § 4.1: a
  product without a value for F leaves the listing when F is selected (bullet "A product without a value", below),
  so a facet with ONE value still narrows a base set in which some products lack it. Expected results:
  - base {p1 `unitate`=ml, p2 ml, p3 —} → `unitate` shown with "ml (2)"; selecting ml lists {p1, p2};
  - base {p1 ml, p2 ml} → `unitate` hidden (selecting ml would list the same set);
  - base {p1 `varianta`={A, B}, p2 {A, B}} → hidden; base {p1 {A, B}, p2 {A}} → shown (B narrows; A is listed too);
  - `producator` on a producer's own category page (every product has that brand) → hidden; `comanda-minima` with
    no product holding it → hidden ("a facet with no data shows nothing").
- **A value whose count is 0 under the other active filters is shown DISABLED** (greyed, not a link, "(0)") so the
  panel does not jump while the visitor clicks. A selected value is always shown and always removable.
- **Generated variant labels are not values.** An option label of the exact form `#<digits>` is not a facet value: the
  importer writes that form only for an empty `format` cell. Measured: 0 of 402 labels read from the files have that
  form (E-8), so the rule removes no real data today. Named consequence: a future file whose real label is `#12` would
  not offer it. Duplicate-suffixed labels `<label> (n)` are kept as values (0 occurrences today, E-8; BOEN 0 suffixed
  labels, `cat-import-1.md:240`).
- **A product without a value for facet F** stays in the listing while F has no selection, and leaves it as soon as F
  has one. (Hand-created products without `brand` behave so; correct, not a defect.)
- **Value order — a total order:** `cmp(a, b) = a.localeCompare(b, "ro", { numeric: true }) || (a < b ? -1 : a > b ?
  1 : 0)`. The first term sorts plank sizes and colour numbers as numbers; it can call two DIFFERENT strings equal
  (`"2".localeCompare("02", "ro", { numeric: true }) === 0`, E-15), so the second term (UTF-16 code-unit order) breaks
  every tie; two values compare 0 only when they are the same string. Witness: `["2","02"]` and `["02","2"]` both sort
  to `["02","2"]` (E-15). Measured today: 0 of the 216 distinct facet values form such a tie (E-15); the tie-breaker
  is for correctness, not for today's data. The order does not change with counts.

---

## 3. Data path

### 3.1 What the listing reads today (OBSERVED)

| Page | Function | DynamoDB read | Paging |
|---|---|---|---|
| Category | `getProductsByCategory` (`renderer/src/lib/dynamo.ts:266`) | `Query PK=TENANT#<t>, begins_with(SK,"CATPROD#<categoryId>#")`, every page followed (`:270-286`), no projection | **in memory**: status + availability filter, sort by `sortOrder` (`:288-291`), slice 24 (`:292-293`) |
| Shop | `getActiveProducts` (`:328`) | `Query begins_with(SK,"PRODUCT#")`, `FilterExpression status = active`, projection `:346` (no `brand`, no `attributes`, no `variants`), every page followed | **in memory** (`:353-363`) |
| Search | `searchProducts` (`:369`) | same `PRODUCT#` query, projection `:390` | in memory (`:410`) |

Every listing therefore already reads the WHOLE set on every render and pages in memory. Two DynamoDB facts decide
the cost (INFERRED from documented DynamoDB behaviour, not executed here): a Query page stops at 1 MB of items read
BEFORE projection and filter; read units are charged on the size of the items read, not on the projected size
(`ProjectionExpression` and `FilterExpression` reduce the response, not the cost). Consequence: adding fields to the
shop projection (`:346`) costs **zero** additional read units and zero additional requests.

**Counts cost nothing extra on any path.** The counts are one pass in memory over the set the page already read: 0
additional DynamoDB requests, 0 additional read units.

### 3.2 Item sizes and the cost per render (EXECUTED estimate E-7, arithmetic INFERRED)

Size proxy: the JSON length of the item the importer writes (`productItem` shape; 36-character ids), an upper bound
of the DynamoDB item size. Averages over all 1,928 products / 3,856 projections: `PRODUCT#` **1,530 B**; `CATPROD#`
**588 B** today, **733 B** with `brand` + `attributes` + option values (+25 %). (`cat-import-1.md:263` estimates
437 BOEN products ≈ 0.5 MB; this proxy gives 0.72 MB — both INFERRED; the impl measures, § 8.4.)

Read units below are eventually consistent (½ unit per 4 KB, rounded up on the total of each Query request).

| Read | 800-product catalog (packet's case) | Glam tenant today (1,928 products) |
|---|---|---|
| Shop, `PRODUCT#` (today, every tenant) | 800 items, 1.22 MB → **2 requests, ≈ 150 RCU** | 1,928 items, 2.95 MB → **3 requests, ≈ 361 RCU** |
| Category via `CATPROD#` today (worst case: all 800 in the category) | 800 items, 0.47 MB → **1 request, ≈ 58 RCU** | ALPOD parent, 915 items, 0.51 MB → **1 request, ≈ 63 RCU** |
| Category via `CATPROD#` with facet fields (option A) | 800 items, 0.59 MB → 1 request, ≈ 72 RCU | 915 items → 1 request, ≈ 77 RCU |
| Category via `PRODUCT#` (option B) | same as the shop row: 2 requests, ≈ 150 RCU | same as the shop row: 3 requests, ≈ 361 RCU |
| Facet counts, any option | +0 requests, +0 RCU | +0 |

When the cost is paid: a bare category or shop page is ISR + edge cached (zero DynamoDB reads on a warm entry —
contract row `(a2)`, `renderer/test/serving-contract/contract.test.mjs:523`); it is read once per publication. A
FILTERED view is never cached (§ 5.3): every filtered view is one origin render plus the read above.

### 3.3 The options

**A — extend the `CATPROD#` projection.** `ProductCardProjection` (`backend/src/lib/catprod.ts:12-29`, not `:10-27` as
the packet says) and `buildCatProdItem` (`:31-52`) gain `brand`, `attributes`, and the option values. Every site that
builds a projection must carry them, or its next write wipes them from the card:
`products/create.ts:81`, `products/update.ts:88-89`, `products/bulk-price.ts:169-170`, `products/delete.ts:41`
(delete only — no change), `import/woocommerce.ts:504-507`, `import/glam-pricelist.ts:177` and `:530` through `cardOf`
(`:488`) **and the reconciliation's BatchGet projection `CARD_PROJECTION` (`:498`)** — without it the reconciliation
rewrites every touched card without facet fields — and `import/glam-images.ts:153-154` through its own `cardOf`
(`:276`, built from the `ALL_NEW` item, `:266`). `bulk-price.ts` and `woocommerce.ts` live in the frozen CommerceApi
(`infra/lib/api-commerce.ts:489,500`); on a catalog tenant they write no card (woocommerce is refused, CM-D8 guard 1;
bulk-price skips every priceless product, `bulk-price.ts:111-112`), so they can be left as they are if the new
fields are optional — at the price that a commerce tenant's cards then lack them (irrelevant: facets are
catalog-only). Backfill: existing catalog cards have no facet fields until rewritten; a re-import of each file
rewrites them. Consistency: the cards inherit `CATPROD-CONSISTENCY-1` (overlapping admin edits; the helpers ignore
`UnprocessedItems`); a dropped card write leaves a card with stale facet values or a product missing from its
category until the next import. Shop page: unchanged path (`PRODUCT#`), only the projection `:346` grows.

**B — catalog listings read `PRODUCT#` (RECOMMENDED, § 9 CF1-DATA-PATH).** For a catalog tenant only, the shop and
the category page read the tenant's `PRODUCT#` items (the shop query, projection + `brand, attributes, variants`) and
the category page selects members in memory by `categoryIds` contains the category id — the field every product
writer keeps as the source of truth and from which the `CATPROD#` items are derived. **No backend writer, no
projection, no backfill, no CommerceApi file changes.** Consistency — what is guaranteed and what is not (DynamoDB
"Read consistency", fetched E-14): (i) every item a listing shows is a COMMITTED `PRODUCT#` item ("read-committed
isolation … The read will never present a view to the item from a write which did not ultimately succeed"); the
facet values and the card come from that same item, so they cannot disagree with each other — the drift class
`CATPROD-CONSISTENCY-1` (card ≠ product) does not exist on this path; (ii) the read is eventually consistent (the shop
query's default): it "might not reflect the results of a recently completed write"; AWS states no time bound and this
design claims none; (iii) the read follows several Query pages and is NOT an atomic snapshot: an item written between
two page requests can appear in its old or its new state, and a listing read during an import's replace window can
show part of the old set and part of the new one. Re-import: after a successful import, guarantee (a) of
`catalog-mode-1.md` § 3.4 ("the sheet's `PRODUCT#` items equal the file's set") holds for the items; an uncached
(filtered) listing read after that shows them subject to (ii); a CACHED bare page follows the publication process of
guarantee (c) — see finding F-CF1-ISR (§ 9.7). Image copy (`cat-images-1`): it rewrites `imageLink`/options'
`imageLink` on the `PRODUCT#` item; facet values (option `value`) are not touched, and a listing read after the copy
shows the new image subject to (ii). Cost: the category page
of a catalog tenant reads the whole tenant (§ 3.2: 3 requests on the glam tenant today) — what the shop page of every
tenant already does. Ceiling (INFERRED): at ≈ 1.5 KB per product, 10,000 products ≈ 15 MB ≈ 15 sequential requests
per render; the shop page has the same ceiling today. Two preservation obligations, so membership does not change:
the category branch keeps its status rule `!status || status === "active"` (`dynamo.ts:289`) and the shop branch keeps
`status = active` (`:339`); both keep `isProductAvailable` and the `sortOrder` sort; with equal `sortOrder` (every
imported product has 0, `glam-pricelist.ts:477`) both reads return items in `productId` order (the `CATPROD#` SK ends
with the id, `catprod.ts:34`; the `PRODUCT#` SK is the id), so the card order is the same (INFERRED; the impl's
fixture row asserts it).

**C — a facet summary item per category, computed at import.** Gives counts for the unfiltered page only. Filtering
the product list still needs each product's values, so C does not stand alone (it needs A or B), and an admin edit
makes it stale. Rejected.

**D — compute at import into the product item.** The importer already writes the source fields; nothing to add.
Not an option distinct from B.

### 3.4 Write, backfill and read costs side by side

Charging rules (DynamoDB "Read and write operations", fetched E-14): a write consumes 1 write unit (WRU) per started
1 KB of the item ("Item sizes for writes are rounded up to the next 1 KB multiple"); a `PutItem` that replaces an
item is charged on "the larger of the two"; a `DeleteItem` on "the size of the deleted item"; `BatchWriteItem`
charges each item as its own put/delete, rounded per item. Reads: see § 3.1 (Query: total size per request, 4 KB
rounding, ½ unit eventually consistent; projection does not reduce it). Labels: item sizes are the E-7/E-15 JSON
proxy (EXECUTED as a computation, INFERRED as DynamoDB sizes); operation counts are a model of the importer's
sequence (INFERRED), anchored on `cat-import-1.md` § 8.4, which counted 1,895 calls for one BOEN re-import on the
in-memory store (EXECUTED there).

| Cost | A — extend `CATPROD#` | B — catalog listings read `PRODUCT#` |
|---|---|---|
| **Extra requests per product write** (any writer) | 0 — the same puts/deletes, larger items | 0 |
| **Extra write units per product write** | 0 measured: 0 of 3,856 cards exceed 1 KB with the facet fields (largest 1,015 B, E-15), so each card put stays 1 WRU. Margin 9 B: a product with more or longer option labels (e.g. ITC after PL-TOOLS-2, ≈ 8 colours per style) can cross 1 KB → 2 WRU per card write (INFERRED) | 0 |
| **Code / deploy** | 4 writer handlers that run on catalog tenants (`products/create.ts`, `products/update.ts`, `import/glam-pricelist.ts` incl. `CARD_PROJECTION`, `import/glam-images.ts`) + `lib/catprod.ts`; backend deploy | renderer only + one cache-policy line |
| **Backfill** — catalog cards written before the change lack the fields | Needed, once per catalog tenant. Existing mechanism: re-import every file (24 files today) — ≈ 9,700 requests, ≈ 38,800 WRU, ≈ 44,100 RCU (table below). Free if a re-import happens anyway (e.g. after PL-TOOLS-2). Alternative: a one-off card-rewrite script — 3 Query requests reading 1,928 products (≈ 361 RCU) + ≈ 155 `BatchWrite` requests putting 3,856 cards (3,856 WRU) — but it is new code to write and review | None |
| **Read per uncached category render** | per category: 800-product case ≈ 72 RCU, 1 request; ALPOD parent ≈ 77 RCU | whole tenant: 800-product case ≈ 150 RCU, 2 requests (+ ≈ 92 vs today's card read); glam tenant ≈ 361 RCU, 3 requests (+ ≈ 298 vs today) |
| **Read per uncached shop render** | unchanged (≈ 150 / ≈ 361 RCU) | unchanged |
| **Consistency exposure** | cards inherit `CATPROD-CONSISTENCY-1` (card ≠ product after overlapping edits or a dropped unacknowledged batch) | none beyond (ii)/(iii) above, which A's card read also has |

**Backfill of A by re-importing every file — three units per step** (model of the importer's sequence, INFERRED;
item counts from the importer's own planner over the 24 files, E-23; sizes from E-15). Anchor: the same model gives
exactly 1,895 calls for BOEN alone (4 × 437 + 53 + 32 + 28 + 28 + 1 + 5), the count `cat-import-1.md` § 8.4 EXECUTED.
Requests = API calls; items = items read or written; units = capacity units (WRU per started 1 KB; RCU per started
4 KB, strongly consistent where the importer sets `ConsistentRead`).

| Step (per file, summed over 24 files) | Requests | Items | Capacity units |
|---|---|---|---|
| Product delete + product put (steps 3–4) | 3,856 | 3,856 | ≈ 7,744 WRU (≈ 2 per item, E-15) |
| Card-delete batch + card-put batch, one each per product | 3,856 | 7,712 cards | ≈ 7,712 WRU (1 per card) |
| Reconciliation writes (`writeCategoryProjections`, ⌈members/25⌉ per touched category; 174 touched categories summed over files; each ALPOD file re-puts the 915 cards of the ALPOD parent) | 1,051 | 23,324 card puts | ≈ 23,324 WRU |
| Reconciliation reads: `BatchGet` (⌈candidates/100⌉) | 387 | 23,324 products | ≈ 23,324 RCU (strong, ≤ 4 KB per item) |
| Reconciliation reads: `CATPROD#` list Query per touched category | 174 | the cards of each touched category | ≈ 3,457 RCU (strong; projection does not reduce it) |
| Previous-set read (tenant-wide, strongly consistent, once per file) | 72 (3 pages × 24) | 24 × 1,928 | ≈ 17,304 RCU (24 × 721) |
| Category lookups (Get per touched category) | 174 | 174 | small (< 200 RCU) |
| Tenant read, lock put/delete, CDN marker (5 per file) | 120 | 120 | small |
| **Total** | **≈ 9,690** | | **≈ 38,780 WRU + ≈ 44,085 RCU** |

How to read the trade: A pays once (backfill) plus a code change in four writer handlers and `catprod.ts`; B pays ≈ 300 RCU more per
UNCACHED catalog category render on today's glam tenant and nothing on writes. Bare category pages are cached (§ 3.2),
so B's extra read is paid per filtered view and per cold render.

---

## 4. Semantics

### 4.1 Combination

- **OR within a facet, AND across facets.** `colectie ∈ {X, Y}` AND `unitate ∈ {ml}`. A product with several values
  for one facet (`varianta`: several option labels) matches when ANY of its values is selected.
- **Counts are disjunctive.** Definition (the only claim made about a count): count(F, v) = the number of products of
  the base set that match every active selection of the OTHER facets and hold v. Consequences, and their limits:
  - selecting `BOEN` does not drive the other values of `producator` to 0 — their counts ignore F's own selection;
  - when F has NO selection, count(F, v) equals the size of the listing after selecting v alone;
  - when F already has selections, adding v gives the UNION of the products holding any selected value of F, so the
    new listing size is not "current size + count(F, v)" in general. For a facet where each product holds at most one
    value (`producator`, and the four attribute facets for imported products — one entry per key, `map.ts:180-189`)
    the union is disjoint and the sum holds; for `varianta` (several labels per product) it does not.
  - Worked example, single-valued: base {p1 `colectie`=X, p2 Y, p3 X}, X selected → listing {p1, p3} (2);
    counts X 2, Y 1; adding Y → {p1, p2, p3} (3 = 2 + 1).
  - Worked example, multi-valued: base {p1 `varianta`={A, B}, p2 {B}, p3 {A}}, A selected → listing {p1, p3} (2);
    counts A 2, B 2; adding B → {p1, p2, p3} (3, not 2 + 2).
  - With another facet active: `unitate`=ml selected → every `colectie` count is computed over the products whose
    `unitate` is ml.
  Cost: one pass per facet over the base set — 6 × ≤ 1,928 products, in memory, negligible.
- **The total line** ("437 produse") counts the filtered set.

### 4.2 Pagination

Filtering happens before pagination (the whole set is in memory, § 3.1). Every facet link omits `page`, so a filter
change returns to page 1. The pager carries the filter state: `Pagination`'s `baseUrl` (`renderer/src/components/
SitePage.tsx:703`, category `:1127`, shop `:1192`) gains `?f=…`; the pager already appends `&page=` when the base URL
holds a `?` (`:706`). A `page` past the last page renders an empty grid, as today.

### 4.3 Empty result

When the selections match nothing: the grid is replaced by "Niciun produs nu corespunde filtrelor alese." and a link
"Șterge filtrele" to the bare path; the selected values stay visible and removable. A selected value that does not
exist in the base set (a stale link after a re-import) is kept as a selection (it matches nothing) and shown so the
visitor can remove it — it is not silently dropped.

### 4.4 Any `f` — the parse is total

There is no parse failure. `parseSelection(f)` is defined for every string, in these steps:
1. Absent `f` or `f === ""` → the empty selection.
2. The string is read with the WHATWG `application/x-www-form-urlencoded` parser (`new URLSearchParams(f)`). That
   parser never throws: a malformed escape stays literal text (`"%zz"` → key `"%zz"`; `"colectie=a%"` → value `"a%"`),
   an escape that is not valid UTF-8 decodes to U+FFFD (`"colectie=%E0%A4%A"` → value `"�%A"`), `"&&"` → no pairs
   (E-15). (Next decodes the OUTER level of `?f=` before the page sees `query.f`; that decode is not in this
   function and is covered by row `cf1-malformed`, § 5.5.)
3. A pair whose key is not a facet id of § 2.1 is dropped (this covers `""`, `"%zz"` and every unknown key).
4. A pair whose value is `""` is dropped.
5. Repeated equal pairs collapse to one.
The result maps each facet id to a set of non-empty strings. A value is compared with stored values by exact string
equality; a value that matches no product (a stale link after a re-import, a U+FFFD value, a typo) stays selected,
matches nothing and is shown as a removable selection (§ 4.3). The page answers 200 for every `f` that reaches it; whether
Next passes an OUTER malformed escape to the page at all is not determined (row `cf1-malformed` records it). React escapes the echoed value (no HTML injection, INFERRED from React's text rendering).

### 4.5 The `varianta` heading

The heading is the variant group `name` when every product of the base set that has options shares one name (BOEN's
upload name, e.g. "Format"); otherwise "Variantă". So a BOEN category shows "Format"; a mixed shop page shows
"Variantă".

---

## 5. URL state and caching

### 5.1 Encoding — one parameter `f` (decision CF1-URL-PARAMS, § 9)

`f` holds the whole selection as a form-encoded string (`application/x-www-form-urlencoded`, the format
`URLSearchParams` reads and writes), percent-encoded once more as the value of `f`:

```
selection  { colectie: ["Planks 138 mm"], varianta: ["14x138x2200 mm", "13,2x181x2200 mm"] }
inner      colectie=Planks+138+mm&varianta=13%2C2x181x2200+mm&varianta=14x138x2200+mm
URL        /category/boen?f=colectie%3DPlanks%2B138%2Bmm%26varianta%3D13%252C2x181x2200%2Bmm%26varianta%3D14x138x2200%2Bmm
```

Why this form (all OBSERVED or EXECUTED):
- **Quota.** One name in the allowlist (8 of 10 after the change), whatever the facet count.
- **Any value round-trips.** Values contain `,` (BOEN `13,2x181x2200 mm`), `/`, `.`, `(`, `)`, `²`, diacritics (E-7).
  A separator character would need a rule for values that contain it; the nested form encoding needs none, and it
  carries several values of one facet as repeated inner keys.
- **No change to the shared query DTO.** `toSiteQuery` keeps only the FIRST value of a repeated parameter
  (`SitePage.tsx:73-77`); `SiteQuery` is `Record<string, string | undefined>` (`:46`). One `f` string fits it; repeated
  outer parameters would need a DTO change on a path every tenant's dynamic render uses.

**Canonical form** (one rule, so equal selections give equal URLs): `formatSelection(s)` writes inner keys in the
facet-table order of § 2.1 and the values of one key in the total order `cmp` of § 2.3, each pair once; the empty
selection gives no `f` at all. The server accepts any order and does not redirect (filtered views are not cached,
§ 5.3, so a non-canonical URL costs nothing extra). Acceptance oracle, three properties the impl's unit tests check:
- **round trip:** `parseSelection(formatSelection(s))` equals `s` for every selection `s` (sets of non-empty values);
- **fixed point:** for ANY string `x`, `c(x) = formatSelection(parseSelection(x))` satisfies `c(c(x)) === c(x)`;
- **order independence:** two selections with the same sets give the same string, whatever the insertion order —
  including the tie witness `"2"` / `"02"`.

**URL length — one invariant, one acceptance rule.** CloudFront's documented maximum URL length is 8,192 bytes
(E-11). Measured: one `colectie` value costs up to 229 bytes inside `f`; all 147 together cost 12,124 bytes; the 70
longest already fill 8,192 bytes of `f` alone (E-15) — so valid clicks can build an unusable URL unless the page stops
them. And the length of an INCOMING URL says nothing about the length of the links built from it: the parser accepts
raw characters that the canonical form encodes, so a compact non-canonical `f` expands (witness below).

Definitions. `href(p, s, n)` = the exact string a link carries: the path `p` (including any `basePath`), then
`?f=` + `encodeURIComponent(formatSelection(s))` when `s` is not empty, then `&page=<n>` (or `?page=<n>`) when
`n > 1`. Its length is counted in UTF-8 bytes. `HREF_BUDGET = 6,144` bytes, leaving ≥ 2,048 bytes of the 8,192 for
scheme and host (≤ 253 bytes). `PAGE_RESERVE = 16` bytes (`&page=` plus up to 10 digits; the glam tenant needs 8:
`&page=81`). A selection `s` **fits** on path `p` when `bytes(href(p, s, 1)) + PAGE_RESERVE ≤ HREF_BUDGET`.

- **Invariant (every link, measured on its final string).** The page never emits an `href` longer than
  `HREF_BUDGET` bytes — add, remove, pager and "Șterge filtrele" links alike. Each href is serialized first and then
  measured; safety is never inferred from the selection getting smaller. An add-link is emitted only when the
  selection it leads to FITS (the same test as the acceptance rule below, so a link the panel emits is never refused
  on the next request); otherwise the value is rendered disabled (not a link) with the hint "Prea multe filtre
  selectate — eliminați unul".
- **Acceptance rule (recovery for incoming selections).** After `parseSelection`, the page measures the CANONICAL
  href of the incoming selection, never the incoming URL. A selection that does not fit is NOT applied: the page
  renders the unfiltered listing, with no selection shown, the notice "Filtrele din adresă sunt prea lungi și nu au
  fost aplicate." and a "Șterge filtrele" link to the bare path. Every link on that page then derives from the empty
  selection.
- **Consequence for an accepted selection `s`** (it fits): a remove-link carries `formatSelection` of `s` minus one
  pair; the canonical form is the encoded pairs joined by `&`, each pair encoded on its own, so removing a pair
  removes its substring and the href gets shorter (checked over 2,000 random selections: never longer, E-22). A pager
  link adds at most `PAGE_RESERVE` bytes, so it fits. The bare-path link is shorter than any filtered href. So on an
  accepted selection the invariant never suppresses a remove-link or a pager link; the measurement stays in the code
  as the runtime guard, and the tests assert it (row `cf1-url-budget`, § 8.3).
- **Witness — compact input, expanded output** (the review-1 case, reproduced E-22): `x` = `"/"` × 2,000;
  incoming `/shop?f=colectie=<x>A%26colectie=<x>B` is 4,031 bytes and parses to 2 values; its canonical href is
  20,035 bytes and the canonical href that removes one value is 10,020 bytes. Under the acceptance rule this selection
  does not fit, so it is not applied; no link of 10,020 bytes is ever emitted.

Rejected alternative: apply an over-budget selection and disable the links that do not fit. The visitor would see a
filtered listing with no working remove- or pager-link, only "Șterge filtrele".

Measured consequence: the 45 longest collection names fit in 6,000 bytes of `f` (5,911 bytes, E-15), so with the path
added, about 45 of the longest can be selected together; every measured value of the other facets fits many times
over (all 38 `impachetare` values together: 912 bytes). A selection the panel itself built always fits, because each
add-link was emitted only after the fit test. Only a hand-built URL, or one built on a longer path (e.g. a preview
`basePath`), can trigger the acceptance rule.

### 5.2 The allowlist change and the quota (OBSERVED + EXECUTED E-11)

`infra/lib/renderer-hosting.ts:568-587` lists `page, q, availability, id, email, preview, nf` (7). AWS "Quotas —
Amazon CloudFront", § General quotas on policies: "Query strings per cache policy — 10", raised only by a support case;
"Total combined length of all query string, header, and cookie names in a cache policy — 1024". The impl adds ONE
name, `f`, with its comment under rule (a) (`:544-548`): read by `SitePage.tsx` (catalog shop and category). The
pinned test `infra/test/amodx-stack.test.ts:327-335` gains `'f'`. The origin request policy forwards ALL query strings
(`renderer-hosting.ts:476`), so it needs no change.

### 5.3 Are filtered pages cached? — No (code-proven)

1. Without `f` in the key, `/category/x?f=…` collapses onto the bare `/category/x` entry; a warm entry is answered at
   the edge before middleware runs (`renderer-hosting.ts:537-548`). The visitor gets the UNFILTERED page. So `f` must
   be listed — that is a correctness requirement.
2. With `f` in the key, the request is an edge miss and reaches the origin. Middleware sends every request with a
   query string to the twin: `needsDynamicRender = … request.nextUrl.search !== ''` (`renderer/middleware.ts:222-224`),
   rewrite `:296`.
3. The twin is `force-dynamic` (`renderer/src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:25`), so every response is
   `private, no-cache, no-store, max-age=0, must-revalidate` (`:18-19`; measured, `docs/caching-architecture.md:41-42`).
4. The cache policy's `minTtl` is 0 (`renderer-hosting.ts:499`, comment: "0 => a `no-store` origin response is not
   stored"). CloudFront stores nothing.
5. Executable proof of the same chain for `?page=2`: contract row `(b1)` (`contract.test.mjs:638-641`, asserts
   `no-store`). The cacheable route renders with `query={{}}` literally (`[siteId]/[[...slug]]/page.tsx:48`), so it can
   never produce a filtered representation.

**Answer:** a filtered view is rendered at the origin on every request and is never stored at the edge or in the ISR
cache. The ROADMAP row's gain "filtered pages cached per value" does not hold; the named gain of the infra change is
**correctness** (a filtered URL shows the filtered page). Decision CF1-CACHE (§ 9) asks the human to accept this or
choose a design that caches.

Cost consequence: each filtered view = one renderer Lambda invocation + the § 3.2 read. Abuse surface: the same as
`?page=N` and `?q=` today — any client can request any `f` value, and each one is an origin render. Nothing in this
design BOUNDS that load; no new abuse-control infrastructure is proposed. Two LOAD-REDUCTION measures in the impl,
neither a guarantee:
- facet links do not prefetch (`<Link prefetch={false}>`, or plain `<a>`), so the visitor's own browser does not
  request ≈ 230 filter URLs (shop page, § 2.2) in the background per page view (INFERRED from Next's viewport
  prefetch; the impl measures the request count, row `cf1-prefetch`). It changes only what our own page asks for;
  it does not stop any other client;
- facet links carry `rel="nofollow"`. Google's documentation says such links "will generally not be followed" and
  that the linked pages "may be found through other means … and may still be crawled" (E-17). It reduces crawler
  enumeration of combinations; it does not prevent it.

### 5.4 SEO

- **Canonical:** a filtered page already declares the BARE path as canonical: `canonicalUrl` is built from the path
  only (`SitePage.tsx:131`) and used for category (`:158`) and shop (`:164`). No change.
- **No `noindex`** on filtered views: combining `noindex` with a canonical that points elsewhere sends mixed signals
  (Google's published guidance, INFERRED, not fetched here); the canonical alone consolidates. Builder decision,
  recorded in § 9.6; the decision-review may promote it.
- Facet links carry `rel="nofollow"` (§ 5.3): it reduces how many combinations crawlers follow; it does not prevent
  crawling (E-17).
- The sitemap is unchanged (it lists bare paths).

### 5.5 Serving-contract rows the impl adds (`renderer/test/serving-contract/contract.test.mjs`)

On the catalog fixture tenant `cm1-catalog` (`fixtures.mjs:216`), with facet fixtures added (≥ 2 producers, ≥ 2
collections, a category whose products all share one `unitate` value except one product without it, one product
with generated `#1` labels, one status-less legacy product, one product with a `,` in a variant label, and enough
long collection names to pass `HREF_BUDGET`):

| Row | Request | Asserts |
|---|---|---|
| `cf1-filter` | `/shop?f=<producator=P1>` | 200, `no-store`, only P1's cards (slug list exact), total line = P1 count |
| `cf1-counts` | `/category/<c>?f=<colectie=X>` | disjunctive counts of § 4.1, exact numbers from the fixture |
| `cf1-not-stored` | the `cf1-filter` URL twice | both `no-store`; no ISR entry is created (as row `(f)`) |
| `cf1-bare-intact` | bare `/shop` after a filtered request | the stored bare entry is HIT and lists every card |
| `cf1-empty` | a selection that matches nothing, and an unknown value | 200, the empty-result copy, the selection shown |
| `cf1-roundtrip` | a value with `,` `/` `²` and a diacritic | selected → the link the panel emits selects the same value |
| `cf1-order` | category page of the catalog tenant, no `f` | card order and membership equal to the `CATPROD#`-path order (B's preservation obligation, § 3.3) |
| `cf1-legacy` | category and shop, no `f` | the status-less legacy product: on the category page, not on the shop page (today's rules) |
| `cf1-singleton` | the category with one `unitate` value and one product without it; then a category where every product holds the same value | first: `unitate` shown with that one value, selecting it removes the product without it; second: `unitate` absent from the HTML (§ 2.3) |
| `cf1-malformed` | `f` values `%zz`, `colectie%3D%25E0%25A4%25A`, `colectie%3Da%25`, `%26%26`, an unknown key, and an outer malformed escape `f=%E0%A4%A` | for each inner witness: 200, unknown keys ignored, a value that matches nothing shown as a removable selection (§ 4.4); for the outer malformed escape: the status is RECORDED — 200 if Next passes it to the page; if the framework refuses it before the page runs (not determined, § 10), a 4xx is acceptable, a 5xx fails the row |
| `cf1-url-budget` | (a) a fitting selection whose next add-links would not fit; (b) the review-1 witness `/shop?f=colectie=<"/"×2000>A%26colectie=<"/"×2000>B` (4,031 bytes, canonical href 20,035 bytes) | every `href` in the HTML (add, remove, pager, "Șterge filtrele") is ≤ 6,144 bytes, measured on the attribute value; (a): the values whose selection would not fit render disabled with the hint, every remove-link and pager link is present; (b): 200, the unfiltered listing, the notice "Filtrele din adresă sunt prea lungi și nu au fost aplicate.", no selection chips (§ 5.1) |
| `cf1-prefetch` | `renderer/test/interest-e2e/facets.spec.mjs` (new): load a catalog shop page with the panel in Chromium, wait for network idle | no request for any facet-link URL before a click; one request after a click (§ 5.3) |
| existing `cm1-identity-*` (`:1145`) | every § 3.6 URL of the commerce and content tenants | byte-identical to the committed baseline — unchanged |

---

## 6. UI

- **Placement.** Desktop (`lg` and up): a left column (≈ 16 rem) beside the grid on the shop and category pages.
  Mobile: one collapsed block above the grid, "Filtre" + the count of active selections. Each facet is a native
  `<details>` element (no JavaScript, server-rendered — the pattern of the catalog variant presenter,
  `SitePage.tsx` `CatalogVariantPresenter`); a facet is open when it has a selection or ≤ 10 values, else closed.
- **Interaction.** Each value is a link to the URL with that value added or removed (no form, no client state). Above
  the facets: the active selections as removable chips and "Șterge filtrele".
- **Copy (Romanian, business register).** "Filtre"; facet headings of § 2.1; "{n} produse" / "1 produs";
  "Șterge filtrele"; "Niciun produs nu corespunde filtrelor alese."; value rows "{value} ({count})"; the length
  hint "Prea multe filtre selectate — eliminați unul" and the notice "Filtrele din adresă sunt prea lungi și nu au fost
  aplicate." (§ 5.1). The catalog
  controls already use fixed Romanian copy ("Mă interesează" / "În lista mea", `renderer/src/components/
  InterestShortlist.tsx:102`). Named finding, outside this slice: the listing views around the panel still print
  English ("Shop" `SitePage.tsx:1104`, `:1151`; "{n} products" `:1114`; "No products in this category yet." `:1118`; "Page 1 of N" `:714`).
- **Interest toggle.** Unchanged. Cards are server-rendered and the toggle reads the shortlist from local storage per
  card (`SitePage.tsx:698`), so a selection survives every filter navigation, as it survives `?page=2` today.
- **Search box.** Unchanged. It navigates to the search page (`/search?q=…`), which has no facets in this slice (the
  requirement names shop and category pages); the filter state is not carried into a search. The shop page's
  category pills (`SitePage.tsx:1169`) stay.
- **Price surfaces.** None: no facet reads `price`, `salePrice`, `volumePricing` or an option `priceOverride`; the
  `PRODUCT#` projection of the catalog branch does not list them for the panel (it lists the card fields of `:346`,
  which the card already suppresses on catalog, plus `brand, attributes, variants`).

---

## 7. Non-catalog tenants — unchanged

- **Rule.** The facet panel and the catalog listing branch run only when `isCatalogMode(config)` (`SitePage.tsx:225`,
  `catalog`). Under option B, non-catalog shop and category pages keep `getActiveProducts` and
  `getProductsByCategory` exactly as they are — the impl does not edit those two functions. Under option A, the
  backend writes additive card fields for every tenant; `ProductCard` is a server component that passes only named
  fields to the client toggle (`SitePage.tsx:668-700`), so the fields reach no rendered byte (INFERRED; the oracle
  proves it).
- **Edge.** Adding `f` to the cache key changes nothing for a request without `f` (the key of a URL without `f` is the
  same; CloudFront keys only the parameters present, INFERRED from the policy semantics). Existing entries remain valid,
  but a cache-policy change is a production CDK deploy (§ 8.4).
- **Oracle.** The `cm1-identity-commerce` and `cm1-identity-content` rows (`contract.test.mjs:1145`, CM1-BYTE-IDENTITY
  Layer 1, `catalog-mode-1.md` § 3.6 and amendment CM1-A1) pass against the committed baseline with no baseline
  change. Staging: Layer 2 of § 3.6 (the `id=cm1-<run>` capture through the edge, `x-cache: Miss from cloudfront` per
  URL), before and after the impl deploy.

---

## 8. Impl slice outline (`cat-facets-1-impl`, assuming the RECOMMENDED rulings of § 9)

### 8.1 Allocation

| File | Change | Requirement |
|---|---|---|
| `renderer/src/lib/facets.ts` (new) | Pure: facet table (§ 2.1); `facetValuesOf(product)`; `parseSelection(f)` / `formatSelection(sel)` (§ 5.1, canonical order); `applyFacets(base, sel) → { items, total, facets[] }` (§ 2.3, § 4) | §§ 2, 4, 5.1 |
| `renderer/src/lib/dynamo.ts` | New `getCatalogListing(tenantId, categoryId?)`: the `PRODUCT#` query, projection `:346` + `brand, attributes, variants`, the per-page status rule of § 3.3 | § 3.3 B |
| `renderer/src/components/SitePage.tsx` | Catalog branch of the category (`:284-290`) and shop (`:292-300`) dispatch; a `FacetPanel` server component; `Pagination` base URL with `f`; empty-result copy | §§ 4, 6 |
| `infra/lib/renderer-hosting.ts` | `'f'` in the allowlist (`:568-587`) + comment; safety-argument (b) read list updated (`:549-555`) | § 5.2 |
| `infra/test/amodx-stack.test.ts` | expected list `:327-335` gains `'f'` | § 5.2 |
| `renderer/test/unit/facets.test.ts` (new) | `facets.ts` units: disjunctive counts, OR/AND, hidden/disabled rules, `#n` exclusion, round-trip of every measured value class, canonical order | §§ 2.3, 4, 5.1 |
| `renderer/test/serving-contract/fixtures.mjs`, `contract.test.mjs` | catalog facet fixtures; rows of § 5.5 | § 5.5 |
| `renderer/test/interest-e2e/facets.spec.mjs` (new) | `cf1-prefetch` (picked up by the harness's `testMatch: /.*\.spec\.mjs$/`, `playwright.config.mjs:17`) | § 5.3 |
| `docs/caching-architecture.md` | allowlist table (`:2148-2156`), read-site table (`:2186-2190`), "seven" (`:20`), diagram (`:1944`) | rule (b) basis |
| `renderer/ARCHITECTURE.md` | catalog listing path + facets | CLAUDE.md DoD |

No backend, shared-package, MCP or admin file. MCP: no route changes, so `routes.json` stays.

**Abstraction lines** (each must survive the impl review):
- `renderer/src/lib/facets.ts` — a module of pure functions; users: the catalog category view and the catalog shop
  view (two) and the unit test; axis: none (a fixed table, data-driven values); rejected: inline in `SitePage.tsx`
  (≈ 1,300 lines; the rules need off-target tests — the test-seam criterion).
- `getCatalogListing` — a function; users: the two catalog branches; axis: none; rejected: a flag on
  `getActiveProducts` (changes the function every non-catalog shop render calls, § 7) and two inline copies.
- The facet table — data, not a registry: one array of `{ id, label, values(product) }`, six rows, dispatch by
  iteration (variants fixed by the frozen layout, operations few).

### 8.2 Oracles (the impl report quotes exact commands; bare exit codes)

```
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run build; echo "exit=$?"            # 0
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run typecheck; echo "exit=$?"        # 0
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm test; echo "exit=$?"        # 0 (facets units)
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving; echo "exit=$?"   # 0, incl. cm1-identity-* and cf1-*
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving-bundle; echo "exit=$?" # 0
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:interest-e2e; echo "exit=$?"  # 0, incl. facets.spec.mjs (cf1-prefetch) and the existing interest spec
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/infra" && npm test; echo "exit=$?"           # 0, allowlist pin
cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/tools/mcp-server" && npm test; echo "exit=$?" # 0 (no route change)
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check; echo "exit=$?"            # 0
git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --stat -- backend packages admin tools   # empty
```

### 8.3 Units owed (beyond § 5.5)

`applyFacets` on a fixture of the measured shape:
- visibility (§ 2.3): each of the four expected results listed there, plus a facet with a selection shown even when
  the base set gives it no narrowing value;
- counts (§ 4.1): the definition; both worked examples (single-valued 2 + 1 = 3; multi-valued 3 ≠ 2 + 2); a count
  computed under another facet's selection; a zero-count value disabled;
- `#1`…`#44` excluded and a read label `14x138x2200 mm` kept;
- order (§ 2.3): `cmp` is a total order — `"2"`/`"02"` sorted the same from both input orders; `cmp(a, b) === 0`
  only when `a === b`.

`parseSelection` / `formatSelection` (§ 4.4, § 5.1):
- round trip for every measured value class (comma, slash, `²`, parentheses, diacritics, `+`, `&`, `=`, `%`);
- fixed point `c(c(x)) === c(x)` for the malformed witnesses `"%zz"`, `"colectie=%E0%A4%A"`, `"colectie=a%"`,
  `"&&"`, `"=x"`, `"colectie"` and duplicated pairs, each giving exactly the selection § 4.4 states;
- order independence, including the tie witness.

`HREF_BUDGET` / fit (§ 5.1): with the 147 measured collection names, every emitted href of every kind (add, remove,
pager, clear) is ≤ 6,144 bytes measured on the serialized string; an add-link is emitted only when its selection fits;
on every fitting selection, every remove-link and pager link is emitted; the review-1 witness (4,031-byte input,
20,035-byte canonical href) is not applied; a property test over random selections (values with `/`, ` `, `,`, `+`,
`&`, `=`, `%`, `²`, `ș`) checks that a remove-link is never longer than the current canonical href.

### 8.4 Staging evidence (operator-run, with real imported data, before the prod GO)

On the staging catalog tenant that holds the BOEN import (`cat-import-1.md` § 10) and the ALPOD file of `cat-images-1`
§ 10, after the renderer and infra deploy:
1. `/shop?f=<producator=BOEN>`: the total line equals the count of active, available BOEN `PRODUCT#` items, counted by
   an independent read-only script (not the renderer code); the first page's card slugs are BOEN slugs.
2. On the BOEN parent category: every `varianta` count equals the script's count of products carrying that label;
   no `#<digits>` value appears; the heading is the upload's variant name.
3. Each filtered URL requested twice: `x-cache: Miss from cloudfront` both times and `cache-control` contains
   `no-store`; then the bare path: `x-cache: Hit from cloudfront` and the full count (the filter did not poison it).
4. Origin time of a filtered shop view (`curl -w '%{time_starttransfer}'` with a fresh `id=cf1-<run>` value) and the
   `ConsumedCapacity` of the catalog listing query from a read-only probe with `ReturnConsumedCapacity: TOTAL` —
   replaces the INFERRED numbers of § 3.2.
5. CM1-BYTE-IDENTITY Layer 2 (§ 7) on the two staging non-catalog tenants: PASS.
6. The deployed cache policy lists 8 query strings (`aws cloudfront get-cache-policy`), on staging and, after the
   human's GO, on prod.

---

## 9. Decisions

DECISION_REQUIRED:
- ID: CF1-FACET-SET
  QUESTION: Which facets ship first?
  PROBLEM: The requirement says "every applicable field". The data today fills only some of them: `comandă minimă` is
    empty everywhere; `unitate` and `împachetare` exist only for ALPOD (286 and 154 of 915 products); real variant
    labels exist only for BOEN (26 values); ITC's only collection value is a price-validity sentence, a known pl-tools
    defect. Each facet that ships costs one row of a table and its tests — the URL parameter is shared (§ 5.1), so
    there is no infra cost per facet.
  OPTIONS:
  - A. All six, with the visibility rules of § 2.3. REWARD: the human's "all applicable fields" literally; a later
    data fill (PL-TOOLS-2) appears without a new slice. RISK: the shop page shows 147 collection values, among them
    ITC's sentence (it is already visible today as a category name); `împachetare` values are technical strings
    (`60x15x2500`) that a visitor may not read as packaging.
  - B. `producator`, `colectie`, `varianta` only. REWARD: a shorter panel with the three facets that have broad data.
    RISK: `unitate`/`împachetare` need a second slice when wanted; the requirement is met only in part.
  - C. `producator` and `varianta` only. REWARD: the smallest panel. RISK: `colectie` duplicates the category tree
    anyway, but cannot then be combined with other filters; the requirement is met least.
  RECOMMENDED: A — the marginal cost per facet is one table row; the hidden-when-empty rule removes what has no data.
  Hand-created products' other `attributes` keys are not facets under any option.
  BLOCKING_REASON: The facet table and the fixture set of the impl depend on it.

DECISION_REQUIRED:
- ID: CF1-DATA-PATH
  QUESTION: Where do the catalog listing pages read facet values from?
  PROBLEM: The category page reads small card items (`CATPROD#`) that have no brand, attributes or variant labels.
    Either the cards grow (and every writer of cards must carry the new fields), or the catalog category page reads
    the full product items, as the shop page of every tenant already does. Details and numbers: § 3.
  OPTIONS:
  - A. Extend `CATPROD#`. REWARD: the category read stays per category (≈ 72 RCU, 1 request for 800 products); no
    extra write units today (0 of 3,856 cards cross 1 KB, § 3.4); matches the ROADMAP row. RISK: 4 catalog writer
    handlers + `catprod.ts` change (the two CommerceApi writers can stay as they are, § 3.3); a one-time backfill of
    ≈ 9,700 requests, ≈ 38,800 WRU and ≈ 44,100 RCU by re-importing every file (§ 3.4; free if a re-import happens
    anyway), or a new rewrite script (≈ 158 requests, 3,856 WRU, ≈ 361 RCU); the largest
    card is 9 B under 1 KB, so larger labels can double card write units; facet values inherit
    `CATPROD-CONSISTENCY-1` drift; backend deploy needed.
  - B. Catalog listings read `PRODUCT#` (category members by `categoryIds`). REWARD: no backend, shared or CommerceApi
    change, 0 extra write units, no backfill; card and facet values come from one committed item (no projection
    drift); renderer + one cache-policy line. RISK: a catalog category render reads the whole tenant (3 requests,
    ≈ 361 RCU for the glam tenant today, + ≈ 298 vs today; ≈ 150 for 800 products) on every filtered view and every
    cold bare render; a 10,000-product catalog would need ≈ 15 sequential requests per render (the same ceiling the
    shop page has today).
  - C. Per-category facet summary item. REWARD: none alone. RISK: cannot filter without A or B; stale after admin edits.
  RECOMMENDED: B — the smallest design that is correct; its read cost is the shop page's existing cost, paid only on
  uncached renders, and it has no write or backfill cost; it removes a consistency exposure instead of adding one.
  Revisit threshold: UNRESOLVED. The repo states no latency budget for a page render (searched, E-16; the renderer
  p99 figures in `docs/TECH-DEBT.md:95` and `docs/slices/opennext-1b.md:392` are measurements, not budgets). The impl
  reports the § 8.4 item 4 timing; the human then sets the budget, or the product count, above which A is reopened.
  BLOCKING_REASON: Allocation of the impl slice (backend files or not) depends on it.

DECISION_REQUIRED:
- ID: CF1-URL-PARAMS
  QUESTION: How are the filters written in the URL, given the 10-name quota of the CloudFront cache policy?
  PROBLEM: Every query parameter that changes a page must be in the cache key, or the edge answers a filtered URL with
    the unfiltered page. The key accepts at most 10 parameter names by default; 7 are used. Six readable names
    (`?producator=BOEN&varianta=…`) would need 13.
  OPTIONS:
  - A. One parameter `f` with a nested form encoding (§ 5.1). REWARD: 1 name (8/10 used); any value round-trips;
    no DTO change; any later facet needs no infra change. RISK: URLs are less readable
    (`?f=producator%3DBOEN`); a hand-typed URL is unlikely to be right.
  - B. Six named parameters + an AWS quota increase (support case) on the staging and the prod account before the
    deploy. REWARD: readable URLs. RISK: an account-level dependency outside the repo and outside CDK; a deploy that
    fails if either account is not raised; repeated outer parameters need a change to `toSiteQuery`, which every
    tenant's dynamic render uses; 2 slots left for all future needs become 0 without another case.
  - C. Three named parameters (`producator`, `colectie`, `varianta`) and no others. REWARD: readable, fits (10/10).
    RISK: forces CF1-FACET-SET to C/B; the quota is then exhausted for every later parameter of any feature.
  RECOMMENDED: A — closed by one rule, no external dependency, no quota consumed per facet.
  BLOCKING_REASON: The allowlist change and the URL contract (a public, linkable surface) depend on it.

DECISION_REQUIRED:
- ID: CF1-CACHE
  QUESTION: Accept that filtered views are never cached (the ROADMAP row says they are)?
  PROBLEM: The serving design sends every URL with a query string to a non-cacheable render (§ 5.3). So each filtered
    view costs one renderer invocation and the § 3.2 read. The ROADMAP row's named gain "filtered pages cached per
    value" is therefore not true; the real gain of the infra change is correctness.
  OPTIONS:
  - A. Accept: server-side filtering, uncached filtered views, bare pages cached as today. REWARD: no change to the
    serving contract; works without JavaScript; 24 cards per page. RISK: origin load per filtered view, NOT bounded —
    `nofollow` and disabled prefetch reduce it, they do not cap it (§ 5.3); latency of a filtered view = a full
    render (measured in § 8.4 item 4).
  - B. Client-side filtering on the cached page (every product of the listing in the cached HTML; state in the URL,
    read only by browser code). REWARD: filtered views served from the edge; no cache-key change at all. RISK: the
    cached shop page of the glam tenant carries ≈ 1,928 cards and their facet data (multi-MB HTML/flight payload),
    pagination becomes client-side, ≈ 1,928 toggles hydrate, filtering needs JavaScript; changes catalog pages far
    beyond the panel.
  - C. Path-encoded filters (`/category/x/f/<selection>`) rendered by the cacheable route. REWARD: filtered views
    cacheable after their first visit. Invalidation that ALREADY covers such paths (no new mechanism): an import is
    wrapped in `withInvalidation` (`glam-pricelist.ts:226`), which on a 2xx marks the bulk lane
    (`backend/src/lib/invalidate-cdn.ts:259-271`), and the bulk lane fires a `/*` CloudFront invalidation
    (`invalidate-cdn.ts:9-13`; `backend/src/scheduled/debounce-flush.ts:295`) — every edge entry of the tenant,
    filter paths included; an ordinary product edit purges the tenant's whole ISR (S3) prefix
    (`docs/caching-architecture.md:425`; `renderer/src/app/api/revalidate/route.ts:23-29`) — filter entries included.
    RISK — what would be genuinely new: (1) a new route shape in the catch-all router and in the not-found handoff, a
    serving-contract change; (2) an unbounded number of cached entries per category (one ISR object and one edge entry
    per visited combination), each a cold render on its first visit; (3) the bulk lane purges the EDGE only — the
    caching doc lists no ISR purge for imports (`caching-architecture.md:426`, column "Layer 2 (ISR)": "—") — so
    whatever an import leaves stale in the ISR layer for bare pages today (finding F-CF1-ISR, § 9.7, not determined
    here) would apply to every cached combination too.
  RECOMMENDED: A, and the operator corrects the ROADMAP row's named gain to "filtered URLs show the filtered page
  (correctness)".
  BLOCKING_REASON: It decides whether the infra change is the one-line allowlist entry or a serving redesign, and it
  corrects a stated gain the human approved.

DECISION_REQUIRED:
- ID: CF1-PL-TOOLS-2-ORDER
  QUESTION: Does PL-TOOLS-2 (glamCRM, deferred 2026-10-29) run before the impl slice?
  PROBLEM: The facet machinery is data-driven: PL-TOOLS-2 changes the values, not the design. But what a visitor sees
    differs. Today: ITC = 576 one-colour products, its only collection value the price sentence, no ITC variant
    values; ALPOD has no variant values. After PL-TOOLS-2 (effect named, not designed): ITC ≈ 66 styles × ≈ 8 colours
    (`catalog-mode-1.md` § 3.4, EXECUTED there) with colour numbers as variant values, its collection value repaired;
    ALPOD Model + Decor changes the product count (not measured), its variant values stay empty.
  OPTIONS:
  - A. Impl now, PL-TOOLS-2 later. REWARD: filters for BOEN (format, collection) and ALPOD (collection, unit,
    packaging) ship on today's data; staging evidence uses data that is already imported. RISK: the ITC sentence is
    a `colectie` value on the shop page until PL-TOOLS-2 (it is already a category name today).
  - B. PL-TOOLS-2 first. REWARD: the first visitor-facing filters show ITC colours and a clean ITC collection. RISK:
    the impl waits on a deferred glamCRM slice; staging evidence must wait for a re-import of every vendor.
  RECOMMENDED: A. Open point, UNRESOLVED, for the human either way: whether an ITC colour number names the same
  colour in every ITC style is not determinable from the files (no colour name column; INFERRED only that it may
  not). If it does not, a `varianta` facet that combines ITC styles can mislead — and restricting the facet to one
  producer would NOT help, because all those styles belong to the one producer ITC. This design proposes no remedy;
  the question returns with PL-TOOLS-2, which is the slice that fills ITC's colour labels.
  BLOCKING_REASON: It decides the staging data of § 8.4 and what the first release shows.

### 9.6 Builder decisions (local, recorded, not asked)

- Facet ids are ASCII Romanian (`producator`, `colectie`, `unitate`, `impachetare`, `comanda-minima`, `varianta`) —
  they appear inside `f` and must survive any URL handling.
- Counts are disjunctive (§ 4.1); zero-count values disabled; a facet is shown iff selecting could change the
  listing (§ 2.3).
- SEO: canonical = bare path (existing), no `noindex`, facet links `nofollow` and not prefetched — load-reduction
  measures, not bounds (§ 5.3–5.4).
- URL length (§ 5.1): `HREF_BUDGET = 6,144` bytes for EVERY emitted href, measured on the serialized string;
  `PAGE_RESERVE = 16`; an incoming selection whose canonical href does not fit is not applied (notice + unfiltered
  listing).
- Value order `cmp` with the code-unit tie-breaker (§ 2.3); parse rules of § 4.4.
- The search page gets no facets (requirement names shop and category).
- Unknown facet ids ignored; stale values kept as removable selections (§ 4.3–4.4).

### 9.7 Findings outside this slice (named, not fixed; the operator may promote them)

- **F-CF1-ISR — after an import, does the ISR layer still hold the old bare category page?** The bulk lane that an
  import marks fires only a CloudFront `/*` (`backend/src/scheduled/debounce-flush.ts:295`); the caching doc lists no
  ISR purge for imports (`docs/caching-architecture.md:426`, "Layer 2 (ISR)": "— (imports/settings not
  path-scoped)"), while ordinary edits purge the tenant's whole S3 prefix (`:425`). If no other path purges it, an
  edge miss after the `/*` would be answered from the old ISR entry, and a re-imported catalog's bare category pages
  would stay stale until an ordinary edit or a deploy. NOT DETERMINED here: this design did not read the whole
  publication path, and `cat-import-1.md` § 10 records a verified staging import. It affects bare pages today, under
  every option of § 9; facets do not create it. The operator checks it against `cat-import-1`'s staging record.
- **English copy around the catalog listing** (§ 6): "Shop", "{n} products", "No products in this category yet.",
  "Page 1 of N".

---

## 10. Evidence log (builder, 2026-10-30)

| # | Command (abridged; cwd = repo unless stated) | Result line |
|---|---|---|
| E-1 | `git log --oneline -1 && git status --porcelain -uall` | `39f4081 cat-interest-1: …`; tree clean (EXECUTED) |
| E-2 | `grep -n "interface ProductCardProjection\|function buildCatProdItem\|export async function" backend/src/lib/catprod.ts` | interface `:12`–`:29`, builder `:31`, writers `:58`, `:81`, query `:105`, reconciliation `:136`, `:161` (EXECUTED) |
| E-3 | `grep -rn "writeCatProductItems\|deleteCatProductItems\|writeCategoryProjections\|queryCatProducts\|listCatProductIds\|cardOf\|CATPROD#" backend/src renderer/src tools/mcp-server/src admin/src packages` (ts/tsx) | writers: create `:81`, update `:88-89`, bulk-price `:169-170`, delete `:41`, woocommerce `:504-507`, glam-pricelist `:160,177,530` (`cardOf :488`), glam-images `:153-154` (`cardOf :276`); readers: public-list `:22`, list `:31`, categories/public-get `:37`, renderer dynamo `:279` — a literal-text scan of the five source roots, complete for those strings (EXECUTED) |
| E-4 | `grep -n "CARD_PROJECTION\|ReturnValues\|ProjectionExpression…" backend/src/import/glam-*.ts` | `CARD_PROJECTION` `:498` used `:544`; glam-images `ReturnValues: "ALL_NEW"` `:266` (EXECUTED) |
| E-5 | `sed -n 255,420p renderer/src/lib/dynamo.ts` + `grep -n` | category `:266` reads every page, slices in memory `:292`; shop `:328`, projection `:346`; search `:369`, `:390` (EXECUTED) |
| E-6 | `grep -n` over `renderer/middleware.ts`, `%5Fdyn/[[...slug]]/page.tsx`, `[[...slug]]/page.tsx`, `infra/lib/renderer-hosting.ts`, `contract.test.mjs` | `needsDynamicRender` `:222-224`; `force-dynamic` `:25`; `query={{}}` `:48`; `minTtl: 0` `:499`; allowlist `:568-587`; row `(b1)` `:638-641`; `cm1-identity` `:1145` (EXECUTED) |
| E-7 | `tsx /tmp/CAT-FACETS-1-measure/measure.mts` (imports `backend/src/import/glam/parse.ts`, `map.ts`; reads the 24 enriched CSVs; writes nothing) | ALPOD 1,803 rows / 915 products / 1,503 options, unit 2 distinct + 1,468 empty, packaging 38 + 1,600 empty, min-order and format all empty; BOEN 478 / 437 / 455, format 26 distinct + 53 empty; ITC 580 / 576 / 580, collection 1 value; sizes `PRODUCT#` 1,267,905 + 722,756 + 959,151 B; `CATPROD#` 3,856 items 2,265,656 B now, 2,824,732 B with facet fields (EXECUTED; sizes are a JSON-length proxy, INFERRED as DynamoDB sizes) |
| E-8 | same script, label-origin pass (`groupStyles`) | "read-origin option labels: 402; of form #<digits>: 0; facet-field cells containing "\|": 0" (EXECUTED) |
| E-9 | `sed -n 668,735p; 1083,1200p renderer/src/components/SitePage.tsx` + `grep -n` | `ProductCard` `:668` (server), `InterestToggle` `:698`, `Pagination` `:703`, category view `:1083`, shop view `:1133`, pagers `:1127`, `:1192`; `toSiteQuery` `:73`, `SiteQuery` `:46`, `canonicalUrl` `:131` (EXECUTED) |
| E-10 | `sed -n 318,340p infra/test/amodx-stack.test.ts` | allowlist pinned `:327-335`, 7 names (EXECUTED) |
| E-11 | WebFetch `https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html` | "Query strings per cache policy — 10 (Request a higher quota)"; "Total combined length of all query string, header, and cookie names in a cache policy — 1024"; "Maximum length of a URL — 8,192 bytes" (EXECUTED, 2026-10-30) |
| E-12 | `node -e` nested `URLSearchParams` round trip of § 5.1 | inner and URL strings exactly as printed in § 5.1; round trip `true` for `13,2x181x2200 mm`, a value with ` / `, `m²`, and `a+b&c=d%` (EXECUTED) |
| E-13 | `rm -rf /tmp/CAT-FACETS-1-measure` | measurement directory removed (EXECUTED) |
| E-14 | WebFetch `https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html` and `…/read-write-operations.html` (revision 1) | "read-committed isolation … The read will never present a view to the item from a write which did not ultimately succeed"; eventually consistent reads "might not reflect the results of a recently completed write" — no time bound stated; writes "rounded up to the next 1 KB multiple"; `PutItem` replacing an item: "the larger of the two"; `DeleteItem`: "the size of the deleted item"; Query: total size of the items, 4 KB rounding; a projection "has no impact on the item size calculations" (EXECUTED, 2026-10-30) |
| E-15 | `tsx /tmp/CAT-FACETS-1-measure2/m.mts` (revision 1; same read-only inputs as E-7) | 24 files, 1,928 products, 174 categories summed over files, `PRODUCT#` write units 3,872; cards 3,856, 0 over 1 KB today and 0 with facet fields, largest 1,015 B; `colectie` 147 values, longest 127 chars, up to 229 B inside `f`, all together 12,124 B, 45 longest fit 6,000 B (5,911 B), 70 fit 8,192 B; `impachetare` all together 912 B; `"2"` vs `"02"`: `localeCompare` 0, with tie-break 1, both input orders sort to `["02","2"]`; 216 distinct values, 0 `localeCompare` ties; `URLSearchParams("%zz")` → `[["%zz",""]]`, `("colectie=%E0%A4%A")` → `[["colectie","\uFFFD%A"]]`, `("colectie=a%")` → `[["colectie","a%"]]`, `("&&")` → `[]`, `("=x")` → `[["","x"]]` (EXECUTED) |
| E-16 | `grep -rn -i "latency budget\|page budget\|ms budget\|p95\|p99\|TTFB budget\|response-time budget" docs CLAUDE.md` | no budget defined; p99 measurements only (`docs/TECH-DEBT.md:95`, `docs/slices/opennext-1b.md:392`) and planning notes (EXECUTED) |
| E-17 | WebFetch `https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links` | `nofollow` links "will generally not be followed"; the linked pages "may be found through other means, such as sitemaps or links from other sites" and "may still be crawled" (EXECUTED, 2026-10-30) |
| E-18 | `sed -n` / `grep -n` over `backend/src/lib/invalidate-cdn.ts`, `backend/src/scheduled/debounce-flush.ts`, `backend/src/import/glam-pricelist.ts`, `renderer/src/app/api/revalidate/route.ts`, `docs/caching-architecture.md`, `docs/documentation.md`, `renderer/test/interest-e2e/playwright.config.mjs` | bulk lane comment `:9-13`, `withInvalidation` `:259-271` (2xx only, `:263-267`); flush `submitInvalidation(["/*"], …)` `:295`; importer `withInvalidation` `:226`; whole-tenant S3 purge `route.ts:23-29`; caching table ordinary `:425`, bulk `:426` (ISR "—"); status taxonomy `documentation.md:45-55`; `testMatch` `:17` (EXECUTED) |
| E-19 | `rm -rf /tmp/CAT-FACETS-1-measure2` | revision-1 measurement directory removed (EXECUTED) |
| E-20 | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" status --porcelain -uall` (final, revision 1) | `?? docs/slices/cat-facets-1.md` — the only entry (EXECUTED) |
| E-21 | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check`; then the same with the file marked intent-to-add (`git add -N`, undone with `git reset -q <file>`); `grep -nE '[[:blank:]]$' docs/slices/cat-facets-1.md \| wc -l` (final, revision 1) | exit 0; exit 0; 0 lines (EXECUTED) |
| E-22 | `node /tmp/CAT-FACETS-1-witness/w.mjs` (revision 2; implements § 4.4 `parseSelection`, § 5.1 `formatSelection` and `href`) | "incoming bytes 4031 \| selections 2"; "canonical href of the incoming selection 20035"; "canonical href removing one value 10020"; "max (remove-link bytes − current canonical bytes) over 2,000 random selections: 0" (no remove-link longer); "longest page suffix for 1,928 products / 24: 8 bytes" (EXECUTED) |
| E-23 | `tsx /tmp/CAT-FACETS-1-witness/backfill.mts` (revision 2; importer planner over the 24 files, read-only) | 24 files, 1,928 products, 174 touched categories summed over files, 23,324 reconciliation card puts, 1,051 reconciliation `BatchWrite` requests, 387 `BatchGet` requests, ≈ 3,457 RCU for the `CATPROD#` list queries, previous-set read 3 pages and 721 RCU per file (EXECUTED as a computation; the request sequence is a model, INFERRED) |
| E-24 | `rm -rf /tmp/CAT-FACETS-1-witness` | revision-2 working directory removed; no `/tmp/CAT-FACETS-1-*` left (EXECUTED) |
| E-25 | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" status --porcelain -uall` (final, revision 2) | `?? docs/slices/cat-facets-1.md` — the only entry (EXECUTED) |
| E-26 | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check`; the same with the file marked intent-to-add (`git add -N`, undone with `git reset -q <file>`); `grep -nE '[[:blank:]]$' docs/slices/cat-facets-1.md \| wc -l` (final, revision 2) | exit 0; exit 0; 0 lines (EXECUTED) |

**Not determined** (named, not guessed): the real DynamoDB item sizes and consumed capacity on staging (§ 8.4 item 4
replaces § 3.2's proxy); whether Next 16's default `<Link>` prefetch of a dynamic URL reaches the origin (the impl
measures, `cf1-prefetch`); ALPOD's product count after PL-TOOLS-2; whether ITC colour numbers mean the same colour
across styles; which staging tenant ids hold the BOEN and ALPOD imports (in the shipped slices' records, not
re-read here); whether Next passes an outer malformed escape in `?f=` to the page (row `cf1-malformed`); whether an
import leaves the bare category page stale in the ISR layer (F-CF1-ISR, § 9.7); the latency budget that would
reopen CF1-DATA-PATH (none exists, E-16).

---

## 11. Revision record

### 11.1 Revision 1 (builder, 2026-10-30, after review-0 `revise`) — corrections by defect class

Each finding is stated as the class it belongs to and closed with one rule, not only the reported instance.

| Review item | Class of defect | Rule that closes the class | Where |
|---|---|---|---|
| 1 URL contract | A function from visitor input to output that is not total or not unique (order ties, "parse failure" that cannot happen, unbounded output length) | Every input → output function of the URL contract is TOTAL and has a fixed-point oracle: `cmp` is a total order (code-unit tie-break); `parseSelection` is defined for every string by five steps; `c = formatSelection ∘ parseSelection` is idempotent; every emitted href is ≤ `HREF_BUDGET` (completed in revision 2, § 11.2) | § 2.3, § 4.4, § 5.1, § 5.5, § 8.3 |
| 2 Unsupported guarantees | A guarantee stated stronger than its source (freshness bound, snapshot, "bounds" from hints) | Every guarantee names its source; where the vendor states no guarantee, the design states none (eventual consistency without a bound; no snapshot; `nofollow` and no-prefetch are load-reduction measures) | § 3.3 B, § 5.3, § 5.4, CF1-CACHE, § 9.6 |
| 3 Facet semantics | A display rule not derived from the filter semantics | Visibility is derived from the semantics: a facet is shown iff selecting could change the listing; a count claims only its definition, with worked examples for single- and multi-valued facets | § 2.3, § 4.1, § 8.3 |
| 4 Decision evidence | A RISK or remedy line asserted, not checked | Every RISK cites a file:line or is marked INFERRED/UNRESOLVED; a remedy is listed only if it addresses the stated risk (the producer-only rule is withdrawn) | CF1-CACHE C, CF1-PL-TOOLS-2-ORDER, § 9.7 |
| 5 Data-path comparison | A comparison matrix with missing cost dimensions or an undefined threshold | Each option has a row for operations, write units, backfill, reads and consistency, each labelled measured / modelled; a threshold names an existing budget or is UNRESOLVED | § 3.4, CF1-DATA-PATH |
| 6 Verification and evidence gaps | A planned check with no command, an executed check not logged, a status outside the taxonomy | Every planned row maps to a command in § 8.2; every command run is in § 10; the status line uses `docs/documentation.md` § Status taxonomy, with the design state stated separately | Status line, § 8.1, § 8.2, § 10 |

### 11.2 Revision 2 (builder, 2026-10-30, after review-1 `revise`) — corrections by defect class

| Review item | Class of defect | Rule that closes the class | Where |
|---|---|---|---|
| 1 URL length | Safety of an output inferred from a property of the input (the incoming URL's length, the selection getting smaller) instead of measured on the output | Every emitted href — add, remove, pager, clear — is serialized and then measured against `HREF_BUDGET`; an incoming selection is judged by its CANONICAL href and is not applied if it does not fit (notice + unfiltered listing); an add-link is emitted only when its selection passes the same fit test, so no emitted link is refused on the next request. Witness: 4,031-byte input → 20,035-byte canonical href (E-22) | § 5.1, § 5.5 `cf1-url-budget`, § 8.3, § 9.6, § 11.1 |
| 2 Writer count / units | A quantity restated in several places and changed in only some; costs stated in mixed units | Each cost has one source (§ 3.4) and every restatement was re-read against it (`grep` for every count and figure); every cost line states its unit — requests, items, or capacity units (WRU/RCU) | § 3.4 (three-unit backfill table), "How to read the trade", CF1-DATA-PATH |

## 12. Ratification (human, 2026-10-30)

Decision review: 5 decisions, all converged (challenger codex gpt-6.1-sol, rebutter claude-opus-5-5; packet
`.agent-manager/slices/CAT-FACETS-1/ratification-packet.md`, local). Human rulings, each the RECOMMENDED option:

- **CF1-FACET-SET = A** — all six facets, with the § 2.3 visibility rules.
- **CF1-DATA-PATH = B** — catalog listings read `PRODUCT#`; no `CATPROD#` change, no backend writer change, no backfill.
- **CF1-URL-PARAMS = A** — one parameter `f` (allowlist 8/10).
- **CF1-CACHE = A** — server-side filtering; filtered views are not cached; bare pages cached as today. The ROADMAP
  row's "filtered pages cached per value" is corrected to "filtered URLs show the filtered page (correctness)".
- **CF1-PL-TOOLS-2-ORDER = A** — the impl slice now; PL-TOOLS-2 later. Open with PL-TOOLS-2: whether an ITC colour
  number means the same colour across styles.

**Binding amendments from the decision review (the builder conceded each; they replace the text named):**
1. § 2.3, "Generated variant labels are not values": the sentence "the importer writes that form only for an empty
   `format` cell" is replaced by: "The importer writes this form for every empty `format` cell. It also stores the
   form unchanged when the cell itself reads `#<digits>` (`group.ts:193-195`). The stored item does not record which
   case applies (`labelOrigin` is used only in the import report, `map.ts:157`). So this rule is a heuristic on the
   label's form, not a check of its origin. A real `#<digits>` label is not offered as a value. Measured today: 0 of
   402 read labels have this form (E-8)."
2. § 9 CF1-DATA-PATH option B RISK gains: "relative to today, the extra read is largest for small categories".
3. § 9.7 finding F-CF1-ISR is replaced by: "After an import, the bulk lane purges only the edge
   (`debounce-flush.ts:295`; `caching-architecture.md:426`, ISR column '—'). The import also bumps `CDN_LAST_CHANGE`
   (`invalidate-cdn.ts:131-143`), so the next nightly flush at 02:00 UTC deletes the tenant's ISR objects too
   (`nightly-cache-flush.ts:112-139`). Bound (INFERRED): an old bare category page in the ISR layer lives until the
   first of these: an ordinary edit, a deploy, or the next nightly flush that succeeds. Normally that is ≤ ~24 h, and
   the flush logs any failure. Not determined: whether some other path clears it sooner, and whether that delay is
   acceptable for publishing an import. Facets do not create this problem."

**Next:** the impl slice `cat-facets-1-impl` per § 8, under these rulings. Named finding promoted for the human:
the listing views around the panel print English copy ("Shop", "{n} products", "No products in this category yet.",
"Page 1 of N") on a Romanian catalog storefront (§ 6).

## 13. Amendment CF1-FACET-SET-2 (human ruling, 2026-10-30) — the facet set is data-driven

**Human direction:** "filters will need to work on any spec sheet parameter that consistently repeats too, like the
arc edition or itc various parameters for the carpeting." Rulings: (1) grouping and specification-filter choices live
in an amodx **import profile** per producer, chosen in admin with a preview (new slice `CAT-IMPORT-PROFILE-1`, design
first); (2) the filters are built NOW with a data-driven facet set, before the profiles.

**Evidence (operator, 2026-10-30, enriched files, specs column idx 10 after the parser's code-line removal is NOT
applied in this measure — `Article no.` lines are still counted here):** every specs line is `Key: value` (ITC 3,113
lines / 0 other; ALPOD 3,726 / 0; BOEN 4,158 / 11). Keys, rows holding them, distinct values: ITC Pile weight 531/20,
Structure 531/5, Usage class 531/2, Collection 531/6, Pile material 520/4, Pattern 469/5; ALPOD installation_method
1096/5, installation_system 1058/11, dimensions 1050/82, type_of_material 522/6; BOEN Product type 310/2, Wood 310/5,
Treatment 310/8, Format 310/11, Article no. 310/310, Dimensions (mm) 310/11, Connection 310/2, Floor Heating 310/3,
Surface 310/17, Certificates 310/1, Color 305/31, Appearance 305/5, Style 304/17, Nordic swan 133/1.

**What changes in this slice (replaces CF1-FACET-SET's fixed list of six):**
- **Candidates** = producer (`brand`), the variant option values (§ 2.3 rules unchanged), and EVERY `attributes` key
  present on the base set's products — not a fixed list.
- **Repeat rule** (per base set, deterministic): a key is offered when (i) at least 2 products hold it, (ii) its most
  frequent value is held by at least 2 products (a value unique to each product is not a filter — e.g. an article
  number), and (iii) it has at most 40 distinct values. Then the § 2.3 visibility rule (shown only when selecting
  could change the listing) applies unchanged. Expected on today's specs once extracted: ALPOD `dimensions` (82) not
  offered; BOEN `Color` (31), ITC `Pile weight` (20) offered; `Certificates` (1 value) hidden by § 2.3.
- **Labels:** the attribute key as stored, until a profile supplies a label (`CAT-IMPORT-PROFILE-1`). The four keys
  the importer writes today are already Romanian (`colecție`, `unitate`, `împachetare`, `comandă minimă`).
- **Order of facets:** producer, then the variant values, then the remaining keys by the number of products holding
  them (descending), ties by the § 2.3 total order on the key.
- **URL:** unchanged — `f` carries any facet name (§ 5.1); no infra change per key.
- **Not in this slice:** extracting specs lines into `attributes` (the importer still writes the four keys; that is
  `CAT-IMPORT-PROFILE-1`), label mapping, merges across producers, list splitting, variant-level specifications.
