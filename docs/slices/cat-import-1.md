# CAT-IMPORT-1 — the glam pricelist importer (IMPL slice)

Status: **PROPOSED**, blocked on `CATALOG-MODE-1` ratification (D-1, D-2, D-3, D-4 bind this
packet). Track: Glam catalog (`docs/plan-glam-catalog.md`).

## 1. Purpose

`POST /import/glam-pricelist` — a sibling of `backend/src/import/woocommerce.ts` consuming the
glam **canonical 12-column layout** (glamCRM `docs/PRICELISTS.md` §1; produced by glamCRM's
`pl-tools` normalize step, one file per producer sheet), creating/updating products and
categories for ONE tenant, idempotently, with **no code path that can store a producer code or a
price**.

## 2. Scope

1. **Parser**: CSV and XLSX (the enriched files are XLSX; pl-tools emits CSV too). Index-based
   column mapping (idx 0–11 exactly as PRICELISTS §1 — header row NOT used for mapping, mirroring
   glam's own importer; the STANDING RISK "inserting a column mid-file silently re-maps" is
   named in the handler header). Collection header rows (idx 0 filled, product columns empty)
   open a collection; product rows belong to the open collection.
2. **Mapping** per `docs/plan-glam-catalog.md` § data mapping, under the ratified D-1 (no price
   field written), D-3 (identity key → the non-rendered `externalRef`), D-4 (1:1 or grouped).
   Columns 2/3/4/5 are read for nothing — the handler does not bind them to variables (the
   reviewer's oracle: no identifier in the handler references those indices).
3. **Categories**: parent category per producer (`brand`), child per collection; slugs via
   `backend/src/lib/slug.ts` `normalizeSlug` (BACKEND-CONTRACT-1's single normalizer); existing
   categories matched by slug, never duplicated.
4. **Idempotency**: upsert by `externalRef.key`; unchanged rows are no-ops (hash of the mapped
   fields); rows present in the store but absent from THIS file → **untouched** (a file is one
   producer sheet, never the whole catalog; archiving is an explicit admin action, not an import
   side-effect).
5. **Dry-run first**: `?dryRun=1` returns the report without writing: rows read / products to
   create / to update / unchanged / rows skipped (with reasons: no name, no collection, invalid
   image URL) / duplicate keys within the file (refused — the file is wrong, per glam's
   match-not-conflict law each key is unique among active products). The admin UI shows the
   report and asks for confirmation before the real run.
6. **Tenant binding**: `x-tenant-id` bound to the caller exactly as `import-policy-1` made
   `/import/wordpress` do (EDITOR imports inside own tenant; the service key — SERVICE-ACCOUNT-1
   — carries its own tenant). Refuse `catalogMode=false` tenants? NO — the importer is
   mode-agnostic; D-1's write-boundary refinement is what refuses a priceless product on a
   commerce tenant (test it).
7. **Admin entry**: Products → Import → "Listă de prețuri (glam)" beside the WooCommerce import;
   upload → dry-run report → confirm. Copy in business language (the glamCRM copy law applies to
   anything the client reads).
8. **MCP parity**: the route in `routes.json` + the drift oracle (`mcp-sync-1`); the tool
   `import_glam_pricelist` with dryRun.
9. **CAT-IMAGES-1 seam**: the report carries every image URL per row; under D-2 = ingest, the
   ingest step consumes the report (this slice stores the URL as given; CAT-IMAGES-1 rewrites).

## 3. Non-scope

Grouping heuristics (D-4 b) unless ratified; price/code handling of any kind; the yearly
replacement workflow on the glam side (pl-tools owns it); scheduling/automation (GC-SITE-SYNC-1).

## 4. Architectural boundaries

Dependencies point inward: parser + mapper are pure (`backend/src/import/glam/`: `parse.ts`,
`map.ts`, no I/O), the handler composes them with the product/category repositories. The mapper's
output type is a raw DTO (`GlamProductDraft`), never a DynamoDB item. CDK: one route + one
integration on the existing import handler group — state the resource delta against the current
synth (the 500 ceiling precondition in the plan).

## 5. Definition of Done / evidence

- Unit: parser rows for header/product/blank/garbage lines; mapper rows per column incl. the
  NO-CODES/NO-PRICES oracle (`GlamProductDraft` has no `price`/`sku`/`producerCode` member —
  typecheck proves it; a test asserts the mapped object's keys exactly).
- Integration (in-memory store): first import creates N products + categories; re-import of the
  same file = 0 writes; re-import with one changed spec = 1 update; a file with a duplicate key
  is REFUSED with the duplicates named; cross-tenant key cannot be written (binding).
- Fixture: a real pl-tools output for BOEN (glamCRM `pl-2025/`, 462 rows, 307 with images) —
  counts stated; a second producer file proves per-producer categories.
- Staging: real import of the BOEN file into the catalog tenant via the admin UI; the dry-run
  report screenshot; product count on `/shop`; one product page screenshot showing NO price and
  NO code (operator-run).
- `routes.json` + MCP drift oracle green; typecheck + unit suites bare-green; synth count stated.

## 6. References

glamCRM `docs/PRICELISTS.md`, `pl-tools/README.md`; `backend/src/import/woocommerce.ts`;
`docs/slices/import-policy-1.md`; `docs/slices/catalog-mode-1.md`.
