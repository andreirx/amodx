# WP-EXPORT-1 — a tenant's content leaves as a WordPress import file

Status: **PLANNED (draft 2026-11-21, not ratified)**. Track: import / export. Depends: none; independent of every
other draft (human 2026-11-21). Not scheduled.

## Purpose

Clients who were left stranded by a developer ask what happens if they leave AMODX. WordPress lets them change
developers; AMODX is open source, but another developer must learn it. An export to WordPress removes the
concern: the content is theirs in the format every WordPress developer knows. AMODX already imports that format
(`backend/src/import/wxr-parser.ts`, `wordpress.ts`, `woocommerce.ts`).

**What it is, to say to a client in plain words:** a data exit, not a copy of the site. The text, images,
addresses and search fields move. The design does not: pages take the look of the WordPress theme they choose.

## Scope

1. `POST /export/wordpress` (TENANT_ADMIN of the tenant; bound with `requireRole` like the importers after
   `backend-contract-1`). Runs in batches like the import (`batchStart` / `batchSize`); writes the files to the
   tenant's private storage; answers a short-lived download link. Audit entry with the actor.
2. **WXR file** (pages and posts):
   - every published content item; type `post` for items shown by post grids, else `page` (the rule is written
     in the record; today every imported item is a Page, `wordpress.ts:248-267`);
   - the address as the WordPress slug and parent chain, so `/cursuri/ceara` arrives at the same path;
   - title, publish date, SEO title and description (as the common SEO plugin's custom fields), featured image;
   - body: each block rendered to plain semantic HTML by a pure function per block type — text, headings,
     images, lists, tables, video links, galleries as image lists. One function per block; a block type with no
     function is exported as a visible HTML comment naming the block, never dropped silently.
   - blocks that are live features (forms, product showcases, booking, popups) → the named comment plus, where
     one exists, the plain fallback (a link);
   - redirects (`type=Redirect` items) as a separate CSV, because WXR has no redirect item.
3. **Media**: attachment items with the public file addresses; the WordPress importer fetches them. A manifest
   lists every file with its size.
4. **Products** (when the tenant sells): a WooCommerce product CSV with the columns the AMODX importer reads
   (`woocommerce.ts:48-110`), so the round trip is testable. Catalog-mode tenants: no price columns exist to
   export.
5. **Customers and orders**: CSV files, TENANT_ADMIN only, after Track B through `commerce-db.ts`.
6. Admin: Settings → "Export site" with the plain-words statement above and the list of what does not move.

## Round-trip proof (the main test)

Export a fixture tenant → import the files into an empty tenant with the existing importers → compare: same
addresses, same titles, same text content, same image count per page, same product count, prices and variants.
Differences are listed in the record as the known limits of the format.

## Evidence taxonomy

Empty tenant → valid empty files. A block type with no HTML function → the named comment, counted in the
report. An address with several segments → slug and parent chain rebuild it. Another tenant's id in the request
→ 403. A second language (after `lang-1a`) → the language as a field per item; the mapping to a WordPress
language plugin is not in scope.

## Non-scope

A WordPress theme that copies the design. Automatic transfer to a WordPress host. Bookings and course rosters
(they stay usable through `sched-frame-1`). Reviews and leads as WordPress items (CSV only, follow-up).

## Exit criterion

The round-trip proof passes on the fixture tenant, and a stock WordPress accepts the WXR file with every page at
its old address.
