# CAT-SLUG-UNIQUE-1 — product addresses unique across a producer's sheets (IMPL slice)

Status: **READY 2026-10-31** — human ruling "suffix on collision" on finding F-2 of `docs/slices/cat-image-gate-1.md`
§ 8. Track: Glam catalog.

## 1. Problem and ruling

The glam importer keeps product slugs unique only within one file (`backend/src/import/glam/group.ts` `allocateSlugs`
`:235`, called `:168`). Two sheets of one producer can produce the same slug; the product page resolves a slug through
the slug index, first match wins, so such an address shows either product. Measured with the importer's own planner
over the 24 real enriched files: 1,920 distinct slugs, **8 produced by two sheets** — all `ALPOD/ORC-laminate` +
`ALPOD/ORC-wood` (e.g. `alpod-organic-eco-design-water-resistant-wood-flooring-clever`). **Ruling:** when a planned slug
is already held by a product of the tenant that this import does not replace (another `importSource`, or a product
without one), the importing product gets the sheet appended (`<slug>-<slugify(sheet)>`; if that is also taken, the
existing within-file rule continues with `-2`, `-3`, …); the dry run and the import report list every such product.

## 2. Scope

1. The deciding read: the tenant's product slugs held by products OUTSIDE this import's own previous set, read under the
   lock with the existing tenant product read (`backend/src/import/glam-pricelist.ts` `readTenantProducts :418`, its
   projection gains `slug`); the dry run reads the same way (not under the lock; it can differ from the execution —
   state it).
2. Pure allocation: within-file uniqueness as today, then cross-sheet uniqueness against the taken set; deterministic
   for a given file + taken set; a re-import of the same sheet keeps its slugs (its own previous products are not in
   the taken set).
3. Report: `crossSheetSuffixed: { slug, previousSlug, rowIndex, heldBy: importSource | null }[]` in the dry run and the
   import response; admin report line (Romanian) and MCP summary count.
4. Category slugs are out of scope (they are producer + collection, shared by design).

## 3. Evidence

Units: collision with another sheet → suffixed; collision with a hand-made product (no `importSource`) → suffixed;
own previous set → not a collision (re-import keeps slugs); suffix itself taken → numbered; no collision → output
byte-identical to today (the golden `backend/test/unit/fixtures/glam/cat-import-profile-1-baseline.json` unchanged).
Staging (operator): import `ORC-laminate`, then `ORC-wood` → 8 products of `ORC-wood` suffixed, listed; re-import
`ORC-wood` → the same 8 slugs; each of the 16 addresses opens the product of its own sheet.
