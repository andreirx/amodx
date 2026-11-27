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

## Build record (2026-11-27, builder; base `main` 30421e3; uncommitted, for review)

Ratified by the human 2026-11-27 ("I do want b"); rulings 1–7 of the builder packet. Evidence labels: EXECUTED (run
here), OBSERVED (read in output or code), INFERRED (concluded, not run), NOT RUN.

### Line numbers of this document, read again on today's code (ruling 1)

| This document says | Today (30421e3) | What is there |
|---|---|---|
| `wordpress.ts:194-195` | `wordpress.ts:200-201` | "FLATTEN everything", `` `/${post.slug}` `` |
| `wxr-parser.ts:46-50` | `wxr-parser.ts:46-50` | post types post/page only (unchanged numbers) |
| `wxr-parser.ts:76` | `wxr-parser.ts:75` | `_thumbnail_id` found, never used |
| `woocommerce.ts:117` | `woocommerce.ts:117` | `csvText.split('\n')` |
| `slug.ts:27-34` | `slug.ts:27-34` | `normalizeSlug` |
| `wordpress.ts:198` | `wordpress.ts:204` | existing page matched by slug (`findContentBySlug`) |
| `content/update.ts:149-158` | `content/update.ts:414-427` | the rename's redirect `Put` |
| `media.ts:44-55` | `media.ts:42-53` | attachment items (`wp:post_type` attachment, `wp:attachment_url`) |

### Amendment of scope 3 (operator ruling IP1-BUILTIN-REDIRECTS = A, 2026-11-27)

Scope 3 said: an old address that cannot be kept (reserved prefix, collision) gets the flat address and a redirect.
Amended: an old address that the renderer's own routing answers BEFORE its content and redirect lookup (its
middleware branches, its route handlers, the product page by id, the home page, and the tenant's built-in pages —
product, category, cart, checkout, shop, account, search, the interest list on a catalog) cannot be kept and cannot be
redirected. The page gets its flat address; the dry run lists the old address as "cannot be kept or redirected" with
the reason; the admin shows the count before the import. No renderer change in this slice; the proper solution is
`docs/TECH-DEBT.md` F-IP1-BUILTIN-ADDRESS-LOST. A reserved address the renderer DOES look up (for example `/shop/<x>`)
keeps scope 3 as written: flat address + one redirect. Collisions: ruling 5 (the second item is not imported).

### What changed

- `backend/src/import/wxr-parser.ts` — each post/page gets `link`, `wpId`, `parentId` (absent when 0), `sourceHost` (the
  channel `<link>` host, else `wp:base_site_url`), `featuredImageId` and `featuredImageAttachmentUrl` (the URL of that
  attachment item of the same export). `featuredImage` stays unset, as on 30421e3. Product items are returned as
  `WordPressProduct` (address only).
- `backend/src/import/wp-addresses.ts` (new, pure) — the address plan (rules in its header).
- `backend/src/import/wordpress.ts` — option `keepOldAddresses` and `POST /import/wordpress?dryRun=1`. Option off: the
  code of 30421e3 (`processPost` = the lookup + `writePage` in mode `today`). Option on, and every dry run: the plan,
  the site check, the conditioned writes, and `rows`.
- `backend/src/content/update.ts` — `redirectRouteItem` (ruling 4: two callers, the rename and the importer).
- `backend/src/lib/slug-guard.ts` — `readReservedAddresses` + pure `reservedAddressRefusalIn`; `builtInPageAt`
  exported (authorised: ruling IP1-SHARED-PATH-SCOPE = A).
- `backend/src/import/product-slug.ts` (new) — `slugify` and `findProductBySlug`, moved out of `woocommerce.ts`;
  `findProductBySlug` now counts only this tenant's `PRODUCT#` items (both callers).
- `backend/src/import/woocommerce.ts` — `parseCSV` reads RFC 4180 records (a quoted cell may hold LF or CRLF).
- `admin/src/pages/Migration.tsx`, `admin/src/lib/wpAddressReport.ts`, `admin/src/lib/wpImportRun.ts` (new) — Step 3:
  "Check addresses" (dry run over every batch), "Keep the old addresses" (set by the check), the report table, the
  counts above the import button, the import only after a complete check.
- Docs: `backend/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md`, `packages/shared/src/slug.ts` (comment only,
  authorised by IP1-SHARED-PATH-SCOPE = A), `docs/database-patterns.md`, `docs/TECH-DEBT.md`, `docs/ROADMAP.md`.

### Rules of the build (each implied by a ruling)

1. **Option off = the import of 30421e3** (ruling 3): no new attribute, no featured image, the same commands and
   items. The featured image (scope 4) is resolved with the option on only.
2. **Collision** (ruling 5): the second item is not imported (row `refused-taken`, names the first).
3. **Same imported item** (ruling 5, IP1-ITEM-IDENTITY = A). Identity on 30421e3 (`wordpress.ts:204`): the slug
   only — the page at `ROUTE#/<post name>` is overwritten whoever wrote it (that stays the option-off rule). With the
   option on, a page gets `wordpressSourceItem = "wordpress:<export host>/<wp:post_id>"`; a page that holds the
   address is replaced only when its value is equal. A page without one (made in the admin, imported flat, or imported
   before this slice) or with another is never replaced (`refused-site`, the row names the value). Relation to the
   products' `importSource` (`glam:<producer>/<sheet>`): the same scheme-prefixed string form; `importSource` names
   the uploaded SET a product came from, `wordpressSourceItem` the ONE item a page came from.
4. **Atomic write** (finding 3): with the option on, content LATEST + route are one `TransactWriteCommand`, each
   conditioned on what authorised the write; a change between check and write cancels both (row `failed`, nothing
   written). Comments are written after it; a comment failure is reported on the written page (`commentsError`).
5. **Serving path** (finding 4, review-1 1, IP1-BUILTIN-REDIRECTS = A): page addresses, redirect sources AND product
   destinations are checked against the serving path before the renderer's lookup — CloudFront behaviors, Next.js's
   repeated-slash 308, the middleware branches, the route handlers, the built-in pages (`rendererRoute`, each rule with
   its `file:line`). Every old address gets one outcome whether or not its page is placed. Limit: a copy, pinned by a
   backend table, not against the renderer itself (TECH-DEBT F-IP1-BUILTIN-ADDRESS-LOST).
6. **Products** (scope 5): the CSV holds no address column, so the comparison is in the WXR dry run
   (`productAddresses` + one row per product). A redirect is written only to this tenant's product that is `active`
   and inside its availability dates (the renderer's rules); else the row says why (`unavailable`, `not-found`).
7. **One row per item** (finding 8): a failed read or write is a `failed` result; a written page with a failed redirect
   or comment says both. The admin enables the import only on a complete check (no error, no failed row).
8. **Default** (ruling 3): absent → on for a site with no page of `author: "wordpress-importer"`, decided on the first
   batch; absent on a later batch → 400. An option-off answer gains `keepOldAddresses: false` only when the request
   left it out.
9. **Dry run** = `?dryRun=1`, dispatched past `withInvalidation` (no write, no purge, no CDN marker), batched like the
   import, the plan made over the whole export on every batch.
10. **No address by path** (`<link>` absent, not a URL, or a query only): the page goes under its parent's old address,
    else flat. The home link `/`: flat, and the row says how to keep it (set the page as the home page).

### Readers of `wordpressSourceItem` (ruling IP1-ITEM-IDENTITY = A)

| Reader / writer | What it does with an unknown attribute | Evidence |
|---|---|---|
| `content/get.ts` | returns the whole item (the admin editor receives it) | OBSERVED, `get.ts:35` |
| admin editor save → `content/update.ts` | the body's unknown keys are dropped by `StrictUpdateSchema` (zod strips); the write is `SET` of named attributes, so the stored attribute is KEPT; the history snapshot is `{...current}`, so it is kept there too | EXECUTED: IP1-F2-ADMIN-EDIT (whole item sent back, attribute kept on LATEST and `v1`, the next import updates the page) |
| `content/restore.ts` | `Put` of `{...history item}`: keeps what the snapshot holds | OBSERVED, `restore.ts:47-53` |
| `content/list.ts` | projection without it | OBSERVED, `list.ts:47` |
| renderer `getContentBySlug` / `SitePage` | spreads the item, then reads named fields only; not serialised to the client | INFERRED from `SitePage.tsx` ~585-775; not run |
| MCP server | does not expose this import; its page tools pass the API's JSON through | OBSERVED (`git grep import/wordpress tools/mcp-server/src`: none) |
| shared schema parse on read | none found | OBSERVED (`git grep "ContentItemSchema\.(parse|safeParse|strict)"`: none) |

No reader drops it, so "dropped → refused" does not arise. A restore of a version written before the attribute
existed removes it; the page is then not provable and is refused, as the ruling requires.

### What an old address is (ruling 7, finding 5)

| `<link>` | Old address read | `normalizeSlug` | Outcome |
|---|---|---|---|
| `/Atelier/Program/` | path `/Atelier/Program` | `/atelier/program` | page at `/atelier/program`, redirect from `/Atelier/Program` |
| `/%c8%99coala/` | path `/școala` (each escape decoded once) | `/coala` (letter dropped) | in the fixture `/coala` is held → refused, listed |
| `/ro%2Fdespre/` | path `/ro%2Fdespre` (an encoded slash stays encoded, the renderer's rule) | `/ro2fdespre` | redirect from `/ro%2Fdespre` |
| `/nested/page/?campaign=1` | path `/nested/page`, query dropped | `/nested/page` | kept; the row names the dropped query |
| `/?page_id=60`, `/index.php?p=12` | query only | — | under the parent or flat; "cannot be kept or redirected" |
| `/galerie/#top` | path `/galerie` (a fragment is never sent) | `/galerie` | kept |
| `/a%E0%A4%A/` | undecodable (Next.js answers 400) | — | under the parent or flat; "cannot be kept or redirected" (revision 3) |
| `/` | home | — | flat; "set this page as the home page" |

Raw, `normalizeSlug` would make `/%c8%99coala` → `/c899coala`, `/?page_id=60` → `/page-id60`, `/galerie/#top` →
`/galerie/top`, `/_booking/x` → `/-booking/x` — the reason the URL is parsed first.

### Review-0 findings (revision 1)

| Finding | What changed | Where | Proved by |
|---|---|---|---|
| 1 F-IP1-PRESERVATION | the parser no longer fills `featuredImage`; the attachment URL is `featuredImageAttachmentUrl`, read only with the option on | `wxr-parser.ts:125`, `wordpress.ts:299` | IP1-GOLDEN-OPTION-OFF: answer, commands and items `JSON.stringify`-equal to the golden, no allowance |
| 2 F-IP1-IDENTITY | `wordpressSourceItem`; replace only on equal value | `wordpress.ts:450`, `:617` | IP1-F2-SOURCE-WRITTEN, -OTHER-EXPORT, -NO-SOURCE, -ADMIN-EDIT, IP1-IDENTITY-KEEPS-KEY; mutation (author rule back) → 4 rows fail |
| 3 F-IP1-ATOMICITY | one conditioned `TransactWriteCommand` for content + route | `wordpress.ts:259`, `:375-390` | IP1-F3-ROUTE-INSERTED (rollback), -ROUTE-REPLACED, -OWNER-CHANGED, -NEW-PAGE; mutation (no route condition) → 4 rows fail |
| 4 F-IP1-REACHABILITY + IP1-BUILTIN-REDIRECTS | `servedBefore` over the renderer's order, for destinations and sources (completed in revision 2, below) | `wp-addresses.ts:94` | IP1-F4-SERVED-BEFORE (28 rows since revision 2, incl. the review's `/api/guide/`, `/tenant/x/`, `/_booking/manage/`, `/_dyn/x/`, `/robots.txt`), IP1-F4-PLAN, IP1-TAX-RESERVED; admin IP1-ADMIN-SUMMARY |
| 5 F-IP1-PATH-INTERPRETATION | none / invalid / home / query-only / path (+ dropped query); `%2F` kept | `wp-addresses.ts:51`, `:56`, `:182` | IP1-R7-OLD-ADDRESS (13 rows), IP1-F5-PLAN; admin report rows |
| 6 F-IP1-TENANT-LOOKUP | `item.PK === TENANT#<t>` | `product-slug.ts:24` | IP1-F6-LOOKUP (foreign / own / both), IP1-F6-WOO, IP1-PRODUCT-FOREIGN; mutation → 3 rows fail |
| 7 F-IP1-PRODUCT-TARGET | `unavailable` for a non-active or out-of-dates product, no redirect | `wordpress.ts:653` | IP1-PRODUCT-REDIRECT (product made by the WooCommerce import), -DRAFT, -OUT-OF-DATES |
| 8 F-IP1-FAILURE-REPORT | a row for every item; `failed` redirect, `commentsError`; import gated on a complete check | `wordpress.ts:548`, `:634`, `:700`; `admin/src/lib/wpImportRun.ts:52`; `Migration.tsx:413` | IP1-F8-READ-FAILS, -REDIRECT-FAILS, -COMMENTS-FAIL, -PRODUCT-FAILS; admin IP1-ADMIN-GATE-*, IP1-ADMIN-BATCHES, IP1-ADMIN-CALL-FAILS |
| 9 F-IP1-SCOPE (IP1-SHARED-PATH-SCOPE = A) | the two edits kept as they were | `slug-guard.ts:58`, `:88`; `packages/shared/src/slug.ts` (comment) | the callers' tests (`cdl-2-paths`, `content-create-contract`, `content-update-contract`, `lang-1a-content`, `small-fixes-1-category-body`; files unchanged vs 30421e3) pass on 30421e3 and on the candidate, 70/70 each; IP1-F9-PIN, IP1-F9-ONE-READ |

### Evidence

| Row | Test (`backend/test/unit/…` unless named) | Result |
|---|---|---|
| page `/cursuri/ceara/` → `/cursuri/ceara` | `import-paths-1.test.ts` IP1-TAX-NESTED-PAGE | EXECUTED pass |
| post `/2024/03/titlu/` → `/2024/03/titlu` | IP1-TAX-DATED-POST | EXECUTED pass |
| reserved prefix → flat + one redirect; listed (as amended) | IP1-TAX-RESERVED, IP1-DRY-RUN-LIST | EXECUTED pass |
| two items, one path → second refused, nothing overwritten | IP1-TAX-COLLISION / IP1-R5-FIRST-KEEPS | EXECUTED pass |
| option off → byte-equal to today (golden) | IP1-GOLDEN-OPTION-OFF | EXECUTED pass |
| featured image with attachment → set; without → none, listed | IP1-TAX-FEATURED (+ parser half) | EXECUTED pass |
| ruling 2: quoted line break | `import-paths-1-woocommerce.test.ts` IP1-R2-* | EXECUTED: failed on 30421e3's parser (OBSERVED: "Vas mic" stored `Prima linie`, price `0`, a fragment row skipped), pass after |
| ruling 5: site page / site redirect / own page / second run / other export | IP1-F2-*, IP1-R5-SITE-REDIRECT, IP1-IDENTITY-KEEPS-KEY, IP1-R5-SECOND-RUN | EXECUTED pass |
| ruling 7: upper case, non-ASCII, query, fragment | IP1-R7-OLD-ADDRESS, IP1-R7-NORMALIZE | EXECUTED pass |
| dry run: the whole list for one export | IP1-DRY-RUN-LIST | EXECUTED pass |
| redirect = what the renderer's read finds | IP1-REDIRECT-RENDERER-READ (key shape of `renderer/src/lib/dynamo.ts:216-228`; source checked by `servedBefore`) | EXECUTED pass |
| admin texts, counts and wiring | `admin/src/lib/wpAddressReport.test.ts`, `admin/src/lib/wpImportRun.test.ts`, `admin/src/pages/Migration.test.ts` | EXECUTED pass |

- **Golden** (ruling 3): fixture `fixtures/wordpress/import-paths-1.wxr.xml` (invented; no WXR fixture with items
  existed), captured BEFORE any source change, time zone pinned; captured again from a `git worktree` of 30421e3 with
  the revision-1 harness: equal to the committed `import-paths-1-golden.json` (`cmp`).
- **Existing tests changed:** `lang-1a-import.test.ts` sends `keepOldAddresses: false` (its rows pin the option-off
  overwrite). The admin capture `__markup__/migration.{content,commerce}.html` was re-captured in iteration 0: the 4631
  bytes before the Step 3 card equal the 3912c5d capture for both kinds; the test is renamed to what it proves.

### Review-1 findings (revision 2)

Closing rule applied to all three: every old address has exactly one truthful outcome; every proposed destination is
reachable through the complete serving path; every attempted side effect is reported as confirmed, failed without
being applied, partial, or not confirmed — never a missing confirmation reported as certainty.

| Finding | What changed | Where | Proved by |
|---|---|---|---|
| 1 F-IP1-REACHABILITY (CDN, `//`, classification) | `rendererRoute` adds CloudFront's `/assets/*`, `/_next/static/*`, `/favicon.ico` and Next.js's 308 for `//` / `\`; an old address with `//` is collapsed (Next's own 308 leads to it, `slashesFrom` kept); the old address is classified on its own, also when the page is refused (`cannot-redirect` or `no-target`) | `wp-addresses.ts:66-75`, `:115-136`, `:283` | IP1-R1-REACH-PLAN (`/assets/guide/`, `/a//b/`, `/cart/` with post name `cart`), IP1-R1-REACH-REPORT (whole report through the handler + the admin count), IP1-R1-REACH-SOURCE-ALWAYS, IP1-F4-SERVED-BEFORE (+2 rows); admin IP1-R1-ADMIN-REPORT, IP1-ADMIN-SUMMARY; mutation (classify only placed pages) → 3 rows fail |
| 2 F-IP1-PRODUCT-TARGET (route and slug) | `productPageProblem`: the destination must route to the product pages and the slug the renderer reads there must be the stored one; else `unreachable`, no redirect | `wp-addresses.ts:157`, `wordpress.ts:754` | IP1-R1-PRODUCT-OVERLAP (prefix `/checkout`); the encoded-slug case is now a row of IP1-R2-PRODUCT-REQUEST (revision 3: its earlier fixture rewrote the index key and proved nothing) |
| 3a unconfirmed write | a transaction error that is not a cancellation → `WriteNotConfirmed` → page `unconfirmed` (shown "not confirmed", never "nothing written"), its redirect `not-attempted`; a redirect `Put` that throws → `unconfirmed`, `failed` only when nothing was sent; comment writes via `allSettled`, "n of m not confirmed"; the last-resort row is `unconfirmed` in an import | `wordpress.ts:466`, `:583`, `:448`, `:682` | IP1-R1-WRITE-UNCONFIRMED (commit, then the answer lost: the page exists, the row says not confirmed), IP1-F8-REDIRECT-FAILS, IP1-R1-REDIRECT-READ-FAILS, IP1-F8-COMMENTS-FAIL; admin IP1-R1-ADMIN-REPORT; mutation (every error `failed`) → 1 row fails |
| 3b featured-image copy | `writePage` reports the copy; the row is `copied` or `not-copied` (page written, a problem, in `errors`) | `wordpress.ts:308` | IP1-R1-IMAGE-NOT-COPIED, IP1-R1-IMAGE-COPIED; admin IP1-R1-ADMIN-REPORT |
| 3c a check authorises one import | `PagesImportFlow` holds the check; `runImport` consumes it before the first call; the page renders the button from it | `admin/src/lib/wpImportRun.ts:70`; `Migration.tsx` | IP1-R1-ADMIN-FLOW-FAILED-IMPORT, -PARTIAL-IMPORT, -SUCCESS, -RESET; mutation (consume after the call) → 2 rows fail |

### Review-2 findings (revision 3)

Closing rules: the outcome of a page is decided by the completed write phase, not by the type of an exception; an
address is checked as the request a browser sends before any route or slug comparison; a decoder failure never
becomes a lookup key.

| Finding | What changed | Where | Proved by |
|---|---|---|---|
| 1 F-IP1-FAILURE-REPORT (post-commit comment preparation) | with the option on, each comment is prepared in its own `try` (an unparseable date → "not written", nothing sent), every started write is awaited (`allSettled` → "not confirmed"); nothing after the committed transaction leaves `writePage`, so any error `pageRow` sees was before the send, the cancellation, or `WriteNotConfirmed`. The option-off branch is the 30421e3 code (golden passes) | `wordpress.ts:440-475`, `:718` | IP1-R2-COMMENT-BAD-DATE (date `0000-00-00 00:00:00`: page `kept/create`, "1 of 1 comments not written"), IP1-R2-COMMENT-SECOND-BAD (valid + invalid: the first written), IP1-R2-COMMENT-OPTION-OFF (unchanged), IP1-F8-COMMENTS-FAIL; mutation (keeping mode back to one `Promise.all`) → 3 rows fail |
| 2 F-IP1-PRODUCT-TARGET (URL interpretation) | `requestPathProblem`: the address is parsed as a URL (no `?`/`#`; the same path after the URL's `.`/`..`/`\` rewriting), each segment decodes as Next.js's matcher decodes it, no end slash; `productPageProblem` applies it before the route and slug check | `wp-addresses.ts:148`, `:194` | IP1-R2-PRODUCT-REQUEST (stored slugs `v%61s-mare`, `vas-mare?x=1`, `vas-mare#details`, `../cart`, `vas-mare/`, `a%ZZ`; products made by the real WooCommerce import, index unchanged, the WXR post name = the stored slug); mutation (no request check) → 6 rows fail |
| 3 F-IP1-REACHABILITY (malformed escapes) | `oldAddressOf` → `undecodable` (kept as written, never a lookup key; the page goes under its parent or flat; "cannot be kept or redirected", counted); `rendererRoute` applies `requestPathProblem` first, for every address | `wp-addresses.ts:71`, `:119` | IP1-R7-OLD-ADDRESS (the malformed row now expects `undecodable`), IP1-R2-UNDECODABLE-REPORT (whole report + count), IP1-R2-UNDECODABLE-ROUTE; admin IP1-R1-ADMIN-REPORT (undecodable row + summary); mutation (no `undecodable`) → 2 rows fail |

### Not verified here

- Staging: deploy and an import of an invented export, each old address answering 200 or 308 — operator gate (NOT RUN).
- The renderer's key for a non-ASCII old address (each escape decoded once): the measured contract covers ASCII
  escapes (`site-segment.ts:96-110`); the multibyte case is INFERRED. Probe on staging: import an item with such a link,
  then `curl -sI https://<site>/%C8%99coala-test`.
- `rendererRoute` is a copy of the serving path (CloudFront, Next.js, renderer), pinned by a backend table only
  (F-IP1-BUILTIN-ADDRESS-LOST, drift). Next.js's repeated-slash 308 is read from its code (`base-server.js:577-581`),
  not measured through the OpenNext bundle.
- `/a/` → 308 `/a` (Next's default `trailingSlash: false`; `renderer/next.config.*` sets none): INFERRED.
- `table.grantReadWriteData(importFunc)` (`infra/lib/api-catalog.ts:231`) covers the `GSI_Slug` query and
  `TransactWriteItems`: INFERRED (the grant covers the table and its indexes; `woocommerce.ts` runs the same query).

## Operator closeout 2026-11-27 — SHIPPED on staging through the API; the admin Migration screen cannot reach it yet

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, four cycles, approved. Review-0 escalated nine findings and three
decisions. Operator rulings (recorded here because they amend the specification):

- **IP1-ITEM-IDENTITY = A, bounded.** A page imported with the option on stores its source identity
  (`wordpressSourceItem`: the export's host and the WordPress post id). Only a page with the equal identity is
  replaced; any other page at the address is refused and listed. No backfill.
- **IP1-BUILTIN-REDIRECTS = A (amends Scope item 3).** An old address that the renderer's own routing answers first
  cannot be kept or redirected; the check lists it with the reason and a count. No renderer change. Debt
  F-IP1-BUILTIN-ADDRESS-LOST in `docs/TECH-DEBT.md`.
- **IP1-SHARED-PATH-SCOPE = A, limited** to the `slug-guard.ts` extraction and the `slug.ts` comment.

Operator-executed on the final tree:

| Check | Result |
|---|---|
| Gates: build, typecheck, shared, plugins, renderer unit, serving, serving bundle, admin unit, backend unit, infra, MCP, `git diff --check` | every exit 0; no path under `renderer/`, `tools/` or `infra/` changed |
| Staging diff, read before the deploy | code only: `CreateContentFunc`, `UpdateContentFunc`, `ImportFunc`, `WooImportFunc`, the rebuilt renderer and admin assets |
| Check (dry run) on staging, tenant `cm1-content`, the repository's invented export sent inline | 11 rows, no error, nothing written |
| Import with the option on | 8 pages written; one reported error, expected: the featured image of the invented host cannot be downloaded, and the row says "not copied" |
| Old addresses kept (`/cursuri/`, `/cursuri/ceara/`, `/2024/03/titlu/`, `/coala/`) | each answers 308 (end slash removed) then 200 with the page, at the same path |
| Old addresses that could not be kept (`/shop/despre`, `/Atelier/Program`) | each answers 308 to the new address; the new address answers 200 with the page |
| Old addresses listed as lost (`/product/ghid`: built-in product prefix; `/școala`: same address as "Coala" after normalization) | 404, as the check said before the import |
| Second import of the same export | no page and no route added; every page row says `update` |
| Cleanup | the 21 items the run added are deleted; the tenant's key set equals the one before the run |

Findings of the operator run (not fixed here):

- **F-MIGRATION-UPLOAD-REFUSED (present before this slice; blocks the admin path of this slice).** The admin
  Migration screen uploads the export through `POST /assets` (`admin/src/pages/Migration.tsx` `uploadToS3`). That
  route accepts images and videos only (`packages/shared/src/media.ts` `validateUpload`): an XML file answers 400
  "File type "application/xml" is not allowed" (OBSERVED on staging). So "Check addresses" and the pages and media
  imports of that screen cannot start. The import itself works when the export is sent inline (`wxrContent`, the
  path the staging run used; bounded by the API's request size). Also: `/assets` stores under the public media
  address, which is not a place for an export that holds commenters' mail addresses. Own slice:
  `migration-upload-1`.
- **F-PREVIEW-REDIRECT-PREFIX (present before this slice; renderer unchanged here).** On the by-id preview address
  (`/_site/<id>/…`) a stored redirect answers `Location: /despre`, without the preview prefix, so the preview does
  not follow it to the page. A site on its own domain is not affected. Not verified on an own domain in this run
  (staging has none); the serving suites cover the own-domain redirect.

Not verified: an export larger than one batch on staging (unit tests cover the batch loop); a real WordPress export
(no client file was used, by rule).
