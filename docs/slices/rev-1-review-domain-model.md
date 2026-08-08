# REV-1: Review domain model — images + product|site scope + rights attestation

- **Status:** PLANNED (implementation wave; REV phase 1)
- **Track:** REV
- **Depends:** the RATIFIED plan `docs/plan-reviews-import.md` (D-REV-1..5 + human rulings)
- **Scope class:** schema/data-shape change crossing the storage boundary — ratification
  covered it; this slice IMPLEMENTS exactly the ratified contract, no new decisions.

## Scope (exactly the ratified decisions, no more)

1. **ReviewSchema images (D-REV-1, inline array):** add `images: z.array(ReviewImage).max(N).default([])`
   where `ReviewImage` = `{ assetKey, status: enum(approved|pending|hidden).default("pending"),
   width?, height?, alt? }` — per-image status DEFAULTED to pending (non-publishable),
   bounded array (pick N so the item stays well under the DDB 400KB cap; justify the
   number as a named constant). Metadata only — NO bytes in DynamoDB.
2. **Scope discriminator (D-REV-5, narrowed D):** add `scope: z.enum(["product","site"]).default("product")`.
   `productId` REQUIRED only when `scope==="product"` (refine). Site-scope reviews use a
   distinct SK (e.g. `SITEREVIEW#<id>` or `REVIEW#SITE#<id>` — pick and document; must not
   collide with `REVIEW#<productId>#`). EXISTING product rows: `scope` defaults to
   "product", untouched rows keep their exact key — backward compatible, NO data migration.
3. **Rights attestation (D-REV-3, immutable batch record):** define `ImportBatchSchema`
   `{ id, tenantId, attestedBy, attestedAt, rightsBasis, legalTextVersion }` (immutable;
   written once at import). Reviews/images from an import reference `importBatchId`.
   This slice DEFINES the schema + the type-level requirement; the importer that writes
   it is rev-2.
4. Rebuild shared → dependents (Definition of Done). Update backend reviews handlers'
   types to accept the new fields WITHOUT changing behavior yet (create/list/moderate
   compile against the extended schema; per-image + scope handling is rev-2/rev-3).

## Non-scope

- No importer (rev-2), no moderation UI changes (rev-3), no renderer gallery (rev-4).
- No image storage/promotion pipeline yet (rev-2 with the D-REV-2/D-REV-4 controls).
- No connectors (rev-5/6). SVG already excluded; input allowlist lands with the
  upload path in rev-2.

## DoD / evidence

Shared unit tests: images bound + default-pending; scope refine (site w/o productId
valid, product w/o productId invalid); ImportBatch immutability shape; existing
product-review shape still parses. Root build + typecheck green; backend reviews
handlers compile. Serving suite green (no render change).

## Output surface

Schema diff + unit transcript naming each ratified invariant it pins; the named image
count constant.
