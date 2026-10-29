# CAT-IMPORT-1 — the glam pricelist importer: enriched CSV in, one style per product, replace per file (IMPL slice)

Status: **READY 2026-10-28** — `CATALOG-MODE-1` ratified and committed (`163c777`); CM-D3 and CM-D4 as AMENDED on the
enriched-file evidence (§ 3.4, § 8.13–8.17) bind this packet; § 8.5 "cat-import-1" is the authoritative list of needs.
Depends on `cat-mode-1` (catalog mode at creation, the write boundary, `importSource`, the update condition).
Per-vendor prerequisite in glamCRM (operator-run pl-tools, `glamCRM/docs/slices/pl-tools-2.md`): ITC `produs` ← style,
`format` ← colour number; ALPOD `produs` ← Model + Decor; BOEN needs nothing. Track: Glam catalog.

## 1. Purpose

`POST /import/glam-pricelist` — a sibling of `backend/src/import/woocommerce.ts` consuming ONE enriched CSV from
glamCRM's pl-tools (`pl-tools/out/<vendor>/enriched/<sheet>.csv`: the frozen 12-column layout, one file per
producer/collection sheet), creating a storefront product per STYLE with its variants, for ONE catalog tenant, with
**no code path that can store a producer code or a price**, and REPLACING the sheet's previous product set
(the site is disposable; no identity survives between imports).

## 2. Scope (spec § 3.4)

1. **Input.** `.csv` upload, UTF-8, RFC 4180 quoting (BOEN's `produs` contains commas and is quoted); 12 columns by
   index, header row ignored; the collection column (idx 0) is filled on every product row in the real files — a
   row with empty idx 1 is skipped (`no-name`), a row with empty idx 0 is skipped (`no-collection`, the canonical
   layout's header-row convention is refused openly, never merged under a wrong key). Columns 2, 3, 4, 5 are NEVER
   read: the parsed row type has no field for them (the NO-CODES / NO-PRICES law as a type guarantee; the reviewer's
   oracle greps the parser for those indices and finds them only in a skip list).
2. **Upload fields.** The file; the producer name (the form offers existing `brand` values and accepts a new one);
   the sheet name (default: file name without extension); the variant name (default "Variantă"; "Culoare" for ITC,
   "Format" for BOEN). Identifier rule: no `/` and no `\u001f` inside producer or sheet → 400 before any mutation.
   `importSource = "glam:" + norm(producer) + "/" + norm(sheet)` — a new optional `ProductSchema` string, written
   ONLY by this importer (`cat-mode-1` omits it from authoring input).
3. **The product key (style).** producer + colecție (idx 0) + produs (idx 1), each `trim → whitespace-collapse →
   toLowerCase → NFC LAST` (diacritics kept), joined with `\u001f`; a `\u001f` inside any component refuses the row
   (reported). `format` (idx 11) is NOT in the key. `slug` = slugify(key) with `-2`, `-3` suffixes in file order on
   collision; fresh `id` per import. Owed unit tests before the first import: the separator witness, canonical
   equivalence (`J̌` vs `ǰ` normalise to one key), idempotence of the normalisation, the identifier rule.
4. **Variants (CM-D4 amended).** One product per style with EXACTLY ONE variant group (`ProductVariantSchema`):
   `name` = the variant name; one option per row, `value` = the `format` label, `imageLink` = the row's image
   (absent when empty); rows with an equal label AND an equal image are one option; collision-aware label
   allocation — `#<n>` for empty labels, ` (2)`… for remaining duplicates, never equal to a label already present
   (owed tests: `x, x, x (2)` and `#1, "", ""`); never `priceOverride` or `availability`. Derived, never authored:
   `imageLink` = the first option's image, `additionalImageLinks` = the other distinct option images in order.
   `description`/`longDescription` from the first row with non-empty specs (idx 10); `attributes` `[{name,value}]`
   from the first row (`colecție`, `unitate`, `împachetare`, `comandă minimă`; empty omitted; not `format`).
5. **Categories.** Parent category per producer (`brand`), child per collection; the same slugify as products
   (`import/woocommerce.ts` category writes — not `normalizeSlug`, correction recorded in the spec); existing
   categories matched by slug, created if absent, never deleted; written as `CATEGORY#<slug>` items directly, as
   the WooCommerce importer does (the category CRUD Lambdas live in CommerceApi and are not touched).
6. **REPLACE per file, under the per-tenant lock.** Start-of-job: tenant record read with `ConsistentRead: true`
   → 404 if missing, 403 if not `catalogMode` — BEFORE the lock. Lock `PK TENANT#<t>` / `SK IMPORTLOCK#glam`:
   conditional put (`attribute_not_exists(SK)`) with an owner token and `expiresAt` (15 min; takeover of a stale
   lock conditioned on `expiresAt`); a contender answers 409 and touches nothing; released only by the owner
   (`owner = :me`) in `finally`. Then: the previous set = every product with this `importSource` (consistent query,
   selected in code, no `FilterExpression`; the same pages give each product's `categoryIds`); each previous product
   deleted with its `CATPROD#` items for the categories read; the new set created; categories created if absent;
   **end-of-import reconciliation** of every touched category (spec § 3.4, cycle 13): candidates = a paginated,
   strongly consistent `CATPROD#<C>#` read ∪ the previous-set members of any origin ∪ the created products; a
   `ConsistentRead` `BatchGet` of the candidates (≤ 100 keys, `UnprocessedKeys` retried); writes of category C only,
   `UnprocessedItems` retried (5 resends, 100 ms doubling); 503 with `incompleteCategories` when the bound is
   exhausted; two new functions in `lib/catprod.ts` (`listCatProductIds`, `writeCategoryProjections`), the existing
   three and their callers unchanged. CDN invalidation via `withInvalidation` as the WooCommerce importer.
   Partial-failure recovery: import the same file again. Idempotent: the same file twice → the same set.
7. **Guarantee (exact).** After a successful import: (a) the sheet's `PRODUCT#` items equal the file's set; (b) at
   the end of the reconciliation pass the `CATPROD#` projections of every touched category equal those categories'
   current products, absent an overlapping admin edit of one of them (`CATPROD-CONSISTENCY-1`); (c) public pages
   follow the existing debounced invalidation. Nothing stronger is claimed.
8. **Dry run first** (`?dryRun=1`): the previous set it would delete (count + first ten titles), styles to create,
   options per style, rows deduped into an option, imageless styles, skipped/refused rows with reasons. The admin
   UI shows the report and asks for confirmation. Report statuses: `created` / `option` / `deduped` / `skipped`,
   `deleted` count, `products[]` with `productId` and options and per-row image disposition (the seam
   `cat-images-1` reads).
9. **Tenant binding and scope.** `x-tenant-id` bound to the caller as `import-policy-1` made `/import/wordpress` do;
   the route declares `catalog:write` in `SERVICE_ROUTE_SCOPES` (the first route to do so — the future glamCRM push);
   `ServiceKeyScope` gains `catalog:write`; the admin Integration-keys form gains the checkbox.
10. **Admin entry** Products → Import → "Listă de prețuri (glam)" beside the WooCommerce import (copy in business
    language); **MCP parity**: the route in `routes.json` + the drift oracle; tool `import_glam_pricelist` with dryRun.

## 3. Non-scope

Cross-import identity (`GLAM-IDENTITY-MIGRATION-1` when glamCRM pushes with its codification); any grouping beyond
exact equality of the key; price/code handling of any kind; image ingest (`cat-images-1`); facets (`cat-facets-1`);
the yearly replacement workflow on the glam side; scheduling (GC-SITE-SYNC-1); projection races between admin edits.

## 4. Architectural boundaries

Dependencies point inward: parser + mapper + grouping are pure (`backend/src/import/glam/`: `parse.ts`, `map.ts`,
`group.ts`, no I/O), the handler composes them with the product/category writes. The mapper's output is a raw DTO
(`GlamStyleDraft` with its options), never a DynamoDB item; it has no `price`, `sku`, `producerCode` member —
typecheck proves it. CDK: one route + one integration on the CatalogApi import handler group — state the resource
delta against the current synth (parent 461/500 after SERVICE-ACCOUNT-1).

## 5. Definition of Done / evidence

- Unit: parser rows (header/product/blank/garbage/quoted-comma/`\u001f`); mapper per column incl. the NO-CODES /
  NO-PRICES oracle (keys asserted exactly); the key normalisation tests of item 3; grouping and label allocation of
  item 4; lock rows (acquire, 409, stale takeover, owner-only release); reconciliation rows over a mocked database
  (paginated candidates, unprocessed retries, 503 naming categories).
- Integration (in-memory store): first import creates N styles + categories; re-import of the same file = the same
  set and slugs, new ids; a changed spec → the style updated; previous set deleted; reconciliation exact.
- Fixtures — the real enriched files, with the operator's measured expectations
  (`cat-import-1-expected-counts.json`, re-measured after PL-TOOLS-2): BOEN `PL.csv` 478 rows (format = size →
  variants of a decor); ITC `Arc_Edition.csv` after the pl-tools fix ≈ 66 styles × ~8 colour options; ALPOD after
  the fix (decor names present). Before the fix ALPOD imports type-level styles with `#n` options — the wrong grain,
  no data lost (recorded, not accepted as the DoD).
- Staging: real import of the BOEN file into the catalog tenant through the admin UI; the dry-run report screenshot;
  product count on `/shop`; one product page with the variant presenter showing sizes, NO price, NO code
  (operator-run); a re-import → identical slugs.
- `routes.json` + MCP drift oracle green; typecheck + `npm run test:unit` bare-green; synth delta stated.

## 6. References

glamCRM `docs/PRICELISTS.md`, `pl-tools/README.md`, `docs/slices/pl-tools-2.md`; `backend/src/import/woocommerce.ts`;
`backend/src/lib/catprod.ts`; `backend/src/lib/service-keys.ts` (the conditional-write pattern);
`docs/slices/import-policy-1.md`; `docs/slices/catalog-mode-1.md` §§ 3.4, 8.5, 8.13–8.17.

## 7. Launch amendment CI1-A1 (human ruling, 2026-10-29)

- **Ruling.** The human launches `cat-import-1` before glamCRM PL-TOOLS-2 and keeps two versions of the enriched
  pricelists: the current files and, later, the storefront-grain files PL-TOOLS-2 would produce. PL-TOOLS-2 is
  deferred (recorded in glamCRM `docs/slices/pl-tools-2.md`).
- **What changes in § 5.** The acceptance fixture is BOEN `PL.csv` only (BOEN needs no PL-TOOLS-2 change, § 1). It is
  committed as `backend/test/unit/fixtures/glam/boen-PL.csv`: the 2026-08-02 enriched file with columns 2–5 (producer
  codes, purchase price, list price, replacement code) blanked on data rows, so no price or code enters this repo; the
  operator's measured counts are identical before and after blanking. Expected counts:
  `backend/test/unit/fixtures/glam/cat-import-1-expected-counts.json` — BOEN 478 rows → 437 styles, 455 options,
  23 deduped rows, 53 empty labels, 0 suffixed, 157 imageless styles, 27 collections, 0 skipped. ITC and ALPOD counts
  in that file are informational (pre-PL-TOOLS-2) and are NOT acceptance values. The NO-CODES / NO-PRICES law is
  proven by unit rows over synthetic rows that carry codes and prices, not by the blanked fixture.
- **What does not change.** The importer is producer-agnostic (§ 2); it imports any enriched CSV of the frozen
  layout, current or storefront-grain. Importing today's ITC/ALPOD files gives the grain § 5 already describes
  (ITC one colour per product, ALPOD type-level styles) — no data lost; the choice of which version to import is the
  human's, at import time.
