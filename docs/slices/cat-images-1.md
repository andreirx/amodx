# CAT-IMAGES-1 — ingest producer images into tenant media on import (IMPL slice, CONDITIONAL)

Status: **PROPOSED — exists only if `CATALOG-MODE-1` D-2 = (b) ingest.** Depends on
`CAT-IMPORT-1` (consumes its per-row image report). Track: Glam catalog.

## 1. Purpose

A storefront is its images. Producer image URLs are a third party's web layout — they rot (the
BNR-URL incident: a silent 302-to-HTML). This slice copies each imported product's image into the
tenant's own media (S3 + CDN) during import so the catalog's pictures are the tenant's.

## 2. Scope

1. After CAT-IMPORT-1 writes/updates products, an ingest step runs over the import report's rows:
   for each `imageLink` not already ingested (idempotency: key by `sha256(sourceUrl)` recorded on
   the product's `externalRef.media[]`), fetch with a bounded timeout, validate content-type +
   magic bytes (image/jpeg|png|webp — the same allow-list discipline as glamCRM's CAP-FILES-1),
   size cap, store via the existing media pipeline the WooCommerce importer's `mediaMap`/
   `rewriteUrl` uses, and rewrite `imageLink` to the tenant URL.
2. Failures are per-row, reported (status, content-type, bytes) in the import report, and leave
   the product with NO image (honest absence — never the dead producer URL, never a placeholder).
3. A re-run is safe: unchanged source URLs are skipped; a changed source URL re-ingests and the
   old object is released through the media pipeline's own lifecycle (no direct deletes here).
4. Admin: the import report's image section lists failures with the row and the producer URL so
   the client can source a picture by hand.

## 3. Non-scope

Image optimization/resizing beyond what the media pipeline already does; galleries (one image per
row today; `additionalImageLinks` stays empty unless the canonical layout grows a column).

## 4. Definition of Done / evidence

- Unit: the ingest decision per row (new / unchanged / changed / failed) over a fake fetcher;
  magic-byte refusal of an HTML body served with an image content-type (the BNR shape).
- Integration: an import of a 3-row fixture with one dead URL → 2 images ingested, 1 reported,
  product 3 has no `imageLink`; a re-run → 0 fetches.
- Staging: the BOEN import with ingest; the report's counts (307 expected with images per
  glamCRM's record); three product pages with tenant-hosted images (operator-run).
- Typecheck + suites bare-green; no new CDK resources (the media pipeline exists) — state it.
