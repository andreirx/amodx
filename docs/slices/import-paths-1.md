# IMPORT-PATHS-1 — a WordPress import keeps the old addresses

Status: **PLANNED (draft 2026-11-20, not ratified)**. Track: import. Depends: none (works with `redirect-1`).
Named client: galeriilevoicu.ro (a WordPress and WooCommerce site whose search position must be kept).

## The problem

- The WordPress importer writes every post and page at `/<slug>`: "FLATTEN everything"
  (`backend/src/import/wordpress.ts:194-195`). A page that lived at `/cursuri/ceara/` arrives at `/ceara`.
- It reads posts and pages only (`backend/src/import/wxr-parser.ts:46-50`); no categories, tags or authors.
- The featured image of a post is read as an id and never resolved (`wxr-parser.ts:76`).
- It writes no redirects (no `redirect` in `backend/src/import/`).
- The WooCommerce importer takes a CSV; it splits the file on line ends (`woocommerce.ts:117`), so a cell with a
  line break inside quotes breaks the row (INFERRED; the slice proves it with a fixture first).

An address may hold `/` on AMODX (`packages/shared/src/slug.ts:27-34`), so the old paths can be kept.

## Scope

1. The WXR parser reads each item's `<link>` and the parent page id. The importer writes the page at the old
   path (host removed, end slash removed), through `normalizeSlug`; the dry run lists every old address with
   the address it gets, and marks the ones `reservedAddressRefusal` refuses.
2. An import option "keep the old addresses" (default on for a new import; a re-import of a site imported flat
   keeps flat unless the option is changed — existing pages are matched by slug, `wordpress.ts:198`).
3. For an old address that cannot be kept (reserved prefix, collision), the importer writes the page at the
   flat address and a redirect item from the old one (the item shape of `backend/src/content/update.ts:149-158`).
4. Featured image: resolve the thumbnail id through the attachment items the media import already reads
   (`backend/src/import/media.ts:44-55`).
5. WooCommerce CSV: a parser that honours quoted line breaks; the product address prefix of the old site is
   compared with the tenant's product prefix in the dry run, with redirects offered when they differ.
6. The red "REVIEW SLUG" marks of `import-policy-1` stay as they are.

## Non-scope

Categories and tags as archive pages. Authors. Comments beyond today's behaviour. Languages of a translated
WordPress site (WPML / Polylang): that mapping is specified after `lang-1a`, as its own slice.

## Evidence taxonomy

| Old item | Expected |
|---|---|
| page `/cursuri/ceara/` | page at `/cursuri/ceara` |
| post `/2024/03/titlu/` | page at `/2024/03/titlu` |
| address under a reserved prefix | flat address + one redirect; listed in the dry run |
| two items with the same path | second refused in the dry run, nothing overwritten |
| option off | byte-equal to today's import (golden of the existing fixture) |
| featured image id with an attachment | image set; without → none, listed |

## Exit criterion

A dry run of the client's export lists every old address with its new one, and after the import each old
address answers 200 or 308 on staging.
