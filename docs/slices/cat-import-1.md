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

## 8. Implementation record (builder; cycle 1 2026-10-29, updated cycles 2–4 2026-10-30)

Status: **BUILT, not committed** — cycle 2 applies review-0's six corrections and the § 9 rulings (CI1-A2); cycle 3
applies review-1's three changes (§ 8.11); cycle 4 applies review-2's rename (§ 8.12); review pending. Base `main`
at `d56b8b0`. Evidence labels: EXECUTED / OBSERVED / INFERRED / NOT RUN. Line numbers are of
the working tree on 2026-10-30.

### 8.1 What changed, per § 2 item

1. **Input** — `backend/src/import/glam/parse.ts`: `parseCsvRecords` (`:130`, RFC 4180; returns a sum
   `records | malformed`) refuses an unclosed quote, a character after a closing quote (`"b"oops`) and a quote inside
   an unquoted cell (`b"c`) — nothing is joined or guessed; `parseGlamCsv` (`:64`) ignores the header, passes over a
   blank line, refuses the file when a record has ≠ 12 cells (B-1, ratified § 9). `GlamRow` (`:40`) has fields for
   idx 0, 1, 6–11 only; `COLUMN` (`:19`) holds those indexes. Columns 3–4 (prices) are never read
   (`NEVER_READ_COLUMNS = [3, 4]`, `:37`). Columns 2 and 5 (producer codes, `CODE_COLUMNS` `:31`) are read only by
   `removeCodeLines` (`:109`): every specs line that holds one of the row's trimmed, non-empty code cells as a whole
   token (not preceded or followed by a letter or digit, Unicode-aware) is dropped; kept lines are joined with "\n".
   Empty idx 1 → `no-name`, empty idx 0 → `no-collection` (`group.ts`).
2. **Upload fields** — `map.ts` `checkUpload` (`:34`): producer and sheet required, no `/`, no U+001F; the producer
   must give a non-empty slug, and the message now states that rule (B-4 ratified, § 9; `:44`); variant name defaults
   to `"Variantă"`; `importSource = "glam:" + norm(producer) + "/" + norm(sheet)`. The handler first requires the body
   to be a JSON object (`glam-pricelist.ts:80-82`; `null`, arrays, strings, numbers → 400).
3. **Product key** — `group.ts` `norm` (`:25`), `KEY_SEPARATOR` (`:18`), key joined with U+001F (`:144`); U+001F in
   colecție / produs → `separator-in-key` with the column; slug = the WooCommerce `slugify` (verbatim copy `:34`,
   B-6), `-2`, `-3`… never equal to any slug of the file (`allocateSlugs` `:225`). Fresh id per import.
4. **Variants** — `group.ts` `groupStyles` (`:125`): rows with an equal normalised label AND an equal trimmed image
   CELL are one option (`:153`; B-3 withdrawn by § 9); the option's image is the cell when it is a usable http(s) URL.
   `allocateLabels` (`:190`) = the C10-2 rule. `map.ts` `mapStyle` (`:180`): one variant group; derived
   `imageLink` / `additionalImageLinks`; `description` / `longDescription` from the first row with non-empty
   (cleaned) specs; `attributes` `{ key, value }` (the schema's field name; § 2 item 4 writes `{ name, value }`, spec
   § 8.13 records the correction); `differing` — one rule for idx 6–8 and 10: a field differs when any row's value,
   empty included, is not the first row's (`:197-203`). `GlamStyleDraft` (`map.ts:78`) has no `price`, `salePrice`,
   `volumePricing`, `sku`, `producerCode` or `personalizations` member.
5. **Categories** — `map.ts` `planGlamImport` (`:140`): parent = slugify(producer), child = slugify(producer +
   collection). `glam-pricelist.ts` `lookupCategory` (`:321`): consistent `Get CATEGORY#<slug>` (projection
   `id, slug`) is a match only when its stored `slug` is the requested one, otherwise the key is **occupied**; then
   `GSI_Slug` (`TenantSlug = <t>#<slug>`), every page followed, projection `SK, id, slug`, a `CATEGORY#` item whose
   stored `slug` equals the requested one. `lookupCategories` (`:364`) handles the three `CategoryLookup` variants in
   an exhaustive `switch` ending in `assertNever` (`:359`, `:384`). In an execution it runs AFTER the lock is
   acquired and before the previous-set read (`:139`, cycle 3); occupied keys → **409** naming each (`:141-146`)
   before any deletion (§ 9 CI1-CATEGORY-OCCUPANCY), the lock then released by its owner; a dry run runs the same
   lookup without a lock and reports them as `categoryConflicts`. `createCategories` (`:395`) writes absent ones after
   the deletes as `CATEGORY#<slug>` with `attribute_not_exists(SK)` (`:416`) — a key occupied since the lookup (only an
   overlapping admin edit can do that now) is never overwritten (500 at step `categories`); categories are never
   deleted.
6. **Replace under the lock** — `glam-pricelist.ts` `_handler` (`:61`): tenant read `readTenantMode` (ConsistentRead)
   → 404 / 403 (`:104-108`), the only read before the lock; no style in the file → 400, execution only (`:111`, B-2
   ratified); lock `acquireLock` (`:239`, `attribute_not_exists(SK)`, owner token, `expiresAt` = now + 15 min,
   takeover conditioned on the observed `expiresAt`; contender → 409 at `:128-133`); category lookup (item 5);
   previous set `readTenantProducts` (`:288`); delete; create (`checkProductWrite(item, true)` on each item);
   `reconcileCategory` (`:487`) + `batchGetProducts` (`:514`); 503 + `incompleteCategories`. Every asynchronous step
   runs under a `step` label (`tenant-read`, `lock`, `categories-lookup`, `previous-set`, `delete`, `categories`,
   `create`, `reconcile`, `audit`); any failure → 500 `{ error, failedStep, recovery }`; the recovery says "No product
   or category was changed" while the failure is before the mutation phase, "import the same file again" once the
   phase is entered (`mutationPhaseEntered`, set just before the delete loop, `:154` — even when the previous set is
   empty — so the message is conservative: after the boundary data MAY have changed, and a failed write's outcome can
   be unknown).
   `releaseLock` (`:266`, `#owner = :me`) runs in `finally` only when this job acquired the lock (`lockOwner`, `:133`,
   `:219`). `backend/src/lib/catprod.ts`: `listCatProductIds` (`:136`) and
   `writeCategoryProjections` (`:161`) appended; the file's diff is additive only.
7. **Guarantee** — as § 2 item 7, unchanged. The tests show (a) and (b) on the in-memory store (§ 8.3).
8. **Dry run** — `?dryRun=1` (`:119-126`): category lookup and previous set (count + first ten titles), the full
   report, categories that would be created, `categoryConflicts`; nothing written (no lock, no CDN marker:
   `withInvalidation` is bypassed for dry runs, `:224-226`). Report shape = spec § 3.4 plus `categoryConflicts`
   (`report`, `:537`).
9. **Binding and scope** — `requireRole(auth, ["TENANT_ADMIN", "EDITOR"], tenantId, "catalog:write")` (B-7);
   `ServiceKeyScope` += `catalog:write` (`packages/shared/src/index.ts:409`); `SERVICE_ROUTE_SCOPES` +=
   `"POST /import/glam-pricelist"` (`backend/src/auth/policy.ts:18`); `service-key-policy.test.ts:72-79` pins the
   table; admin label (`ServiceKeys.tsx:21`); MCP `SERVICE_KEY_SCOPES`. `service-key-handlers.test.ts:106`: the
   "unknown scope" witness is now `leads:write` (it was `catalog:write`).
10. **Admin + MCP + infra** — `admin/src/components/GlamPricelistImport.tsx`: the form state is the pure
    `glamFormReducer` (`:74`): every input change bumps `revision` and withdraws the report; choosing a file drops the
    old content at once and starts a read bound to a fresh token; `canCheck` (`:106`) is false while a read or a
    request is pending; a dry-run answer or failure is accepted only for the revision it was sent with; the
    confirmation sends `confirmInput` (`:112`) — the exact checked snapshot. Producer suggestions: `loadBrands`
    (`:139`) reads `GET /products` WITHOUT the page's filters; that route reads one DynamoDB page (≤ 1 MB of items,
    `products/list.ts`, no `LastEvaluatedKey` loop), so on a very large site brands can be missing — any name can be
    typed. `Products.tsx:364` mounts it on catalog sites. MCP: `routes.json:76`; `import_glam_pricelist`
    (`tools/mcp-server/src/index.ts:1137`, wording now: prices never read, code lines removed, image URLs kept);
    `tool-shapes.ts` (`glamPricelistRequest` / `glamPricelistSummary`); ARCHITECTURE 77 tools (heading and
    internal-structure line). Infra: `GlamPricelistImportFunc` (`infra/lib/api-catalog.ts:279-286`, 15 min, 1024 MB,
    `grantReadWriteData`), route + integration (`infra/lib/api.ts:372-378`); `infra/test/amodx-stack.test.ts` (§ 9
    allocation): 15 CatalogApi functions (`:1004`), the route in `CATALOG_ROUTE_KEYS` (`:1001`), new row
    `(cat-import-1)` (`:1012`) — the route integrates `GlamPricelistImportFunc`, timeout ≤ 15 min.

Docs: `backend/ARCHITECTURE.md` (catprod, glam-pricelist, glam/, scope table, pure seams, five mode-enforcing reads),
`docs/authentication-architecture.md` (scope table, three handlers), `tools/mcp-server/ARCHITECTURE.md`.

### 8.2 Oracles (EXECUTED 2026-10-30 in cycle 4, after `npm run build` exit 0)

| # | Command | Last lines |
|---|---|---|
| 1 | `npm run typecheck` (root) | exit 0; last workspace `infra … tsc --noEmit` |
| 2 | `cd backend && npm run test:unit` | exit 0; `Test Files 35 passed (35)`, `Tests 536 passed (536)` — `glam-import-core.test.ts` 40, `glam-import-handler.test.ts` 49 (cycle 4) |
| 3 | `cd tools/mcp-server && npm test` | exit 0; `PASS: every call targets a live route; ARCHITECTURE.md tool count matches.`; `# tests 10 # pass 10 # fail 0` (new: the summary names dry-run category conflicts) |
| 4 | `cd renderer && npm run test:serving` | exit 0; `# tests 50 # pass 50 # fail 0` |
| 5 | `grep -n -E '(:\|\[\|,)[[:space:]]*(2\|3\|4\|5)[[:space:]]*(,\|\]\|\))' backend/src/import/glam/parse.ts` | exactly three lines: `32: codeOld: 2,`, `33: codeNew: 5,` (the column map used by the code removal) and `37: export const NEVER_READ_COLUMNS = [3, 4] as const;` (skip list). 3 and 4 appear nowhere else outside comments |
| 6 | `git status --porcelain`; `git diff --check`; `shasum -a 256 -c fixtures.sha256` | allocated paths, plus `admin/src/components/GlamPricelistImport.test.ts` (the tests review-0 correction 2 requires) and `backend/test/unit/glam-code-hits.ts` (test helper); exit 0; both replaced fixtures `OK` |
| 7 | `npx cdk diff -c stage=staging AmodxStack-staging` | NOT RUN (operator). Expected: parent +3, CatalogApi +4 (§ 8.5) |
| 8 | `cd infra && npm test` | exit 0; `Tests: 59 passed, 59 total` |

Also EXECUTED: `cd admin && npm run test:unit` → exit 0, 4 files, 32 tests (8 new: `GlamPricelistImport.test.ts`).

### 8.3 BOEN acceptance (EXECUTED, fixture with columns 2 and 5 kept)

| | acceptance["BOEN/PL"] | importer (pure core and handler) |
|---|---|---|
| rows / styles / options | 478 / 437 / 455 | 478 / 437 / 455 |
| deduped / empty labels / suffixed labels | 23 / 53 / 0 | 23 / 53 / 0 |
| imageless styles / collections / skipped | 157 / 27 / 0 | 157 / 27 / 0 |

No row differs (B-3's withdrawal changes nothing on BOEN: all 310 image cells are valid URLs). One slug suffix: row
18 → `…-oak-vivo-live-natural-brushed-4v-bevel-2` (the spec's rows 17/18 witness). **Code-removal oracle (§ 9):**
over all 478 rows, no field of any draft (`glam-import-core.test.ts`) and no field of any item payload the handler
WROTE during the import and during the re-import (`glam-import-handler.test.ts`, the in-memory table's write history:
437 products + 28 categories + 1,748 projection puts, then 437 + 0 + 1,748 — including first-import items the
re-import deleted and projection versions the reconciliation overwrote; cycle 3, review-1 R3) contains any
column-2/5 value of any row (≥ 400 distinct codes), except `imageLink` / `additionalImageLinks` / options'
`imageLink`. Positive controls: a code put into a written payload's `description` or `attributes` is found; the same
code in the three image fields is not; the draft-level search finds codes in the image URLs; no `Article no.` line
remains in a description. In the
report, codes appear only in `rows[].image.sourceUrl` (the image cell as read).

### 8.4 DynamoDB calls of one BOEN import (EXECUTED on the in-memory store; all sequential)

- **First import, 1,077:** tenant `Get` 1; lock `Put` 1; category `Get` 28 + `GSI_Slug` `Query` 28 (one page each);
  previous-set `Query` 1 page; category `Put` 28; product `Put` 437; `BatchWrite` 490 (437 step-(4) + 53 reconciliation: 18
  parent, 35 children); `CATPROD#` `Query` 28; `BatchGet` 32 (5 parent, 27 children); lock `Delete` 1; CDN `Update` 1
  + `Put` 1.
- **Re-import, 1,895:** as above without the 28 GSI queries and 28 category puts (direct hits), plus product `Delete`
  437 and 437 more `BatchWrite`.
- On DynamoDB a query page stops at 1 MB read before projection; 437 BOEN products ≈ 0.5 MB (INFERRED) → 1 page. The
  re-import is ≈ 1,900 sequential round trips: 10–19 s at 5–10 ms each (INFERRED), inside the 30 s API timeout but
  not by a wide margin; the operator measures. On an API time-out (503) the Lambda continues; the admin says so.

### 8.5 Synth delta (EXECUTED counts, INFERRED delta)

`infra` jest synth (split1-5): deployed parent ≈ **464** (raw 398 + 53 + 13), CatalogApi ≈ **61** (raw 45 + 15 + 1).
Against the documented baselines (parent 461 after SERVICE-ACCOUNT-1; CatalogApi 57): parent **+3** (Route,
Integration, Lambda Permission of `GlamPricelistImportInt`), CatalogApi **+4** (Function, Role, Policy, managed log
group). A baseline synth from a clean worktree did not build, so the delta is derived, not diffed.

### 8.6 Abstractions (one line each)

- `glam/parse.ts` / `group.ts` / `map.ts` — pure modules; users: handler, tests; axis: none (the slice's § 4 pure
  core); rejected: inline handler code (no off-target test of the NO-CODES law).
- `GlamRow` — type; the guarantee that no code or price cell is carried; rejected: `string[]` rows.
- `GlamStyleDraft` (+ `GlamUpload`, `GlamImportPlan`) — boundary DTOs (§ 4); user: the handler; rejected: DynamoDB items
  in the core. The spec's name is `GlamProductDraft`; § 4's `GlamStyleDraft` is used, same members.
- `CsvRecordsResult` — sum `records | malformed`; user: `parseGlamCsv`; replaces cycle 1's `null`, so the refusal
  names its cause and row; rejected: throwing.
- `CategoryLookup` — sum `found | absent | occupied` (variants fixed; `lookupCategories` switches on it with an
  `assertNever` default — EXECUTED: a fourth variant makes `tsc` fail with TS2345 at the `assertNever(found)` call); user:
  `lookupCategories`; axis: none (domain states of a slug); rejected: `string | null` (cannot express "occupied").
- `listCatProductIds`, `writeCategoryProjections` — the spec's own lines apply.
- `glamFormReducer` + `canCheck` / `confirmInput` / `brandsOf` — pure functions in the admin component; user: the
  component; axis: a test seam (the admin has no DOM test library; the repo pattern is pure exports, e.g.
  `ProductEditor.test.ts`); rejected: `useState` + async callbacks (the review-0 race, untestable).
- `glamPricelistRequest` / `glamPricelistSummary` (MCP) — test seam (`index.ts` cannot be imported by a test).
- `GlamPricelistImport` (admin) — component; allowed by the packet.
- `MemoryTable`, `codeHits` (tests) — in-memory DynamoDB and the § 9 oracle's search; test seams.

### 8.7 Builder decisions — final state

- **B-1** ≠ 12 cells refuses the file — ratified (§ 9). Cycle 2 adds: misplaced quotes refuse the file (review-0).
- **B-2** an execution with no style is refused, nothing deleted — ratified (§ 9).
- **B-3** WITHDRAWN (§ 9): options merge on equal label + equal trimmed image cell.
- **B-4** non-empty producer slug — ratified with the message stating the rule (§ 9).
- **B-5** categories matched by slug in two stores — now with the stored-slug check, every GSI page, the occupied-key
  409 (§ 9) and a conditional create.
- **B-6** `slugify` verbatim copy of `woocommerce.ts:25-33`. **B-7** roles TENANT_ADMIN + EDITOR. **B-8** no monetary
  key, no `sku` / `currency` on imported items. **B-9** row index = spreadsheet row. **B-10** tests mock `db.js` with
  an in-memory table (repo pattern) rather than `aws-sdk-client-mock`. **B-11** function memory 1024 MB.
- **B-12 (cycle 2)** the specs line separator is always normalised to "\n" (one form, with or without codes).
- **B-13 (cycle 2)** a lock-step failure that may still have written the lock is NOT followed by a release (review-0:
  never release a lock not acquired); such a lock is this job's own and expires in 15 min.

### 8.8 Findings and follow-ups (outside the allocation, named, not fixed)

- **F-1** RESOLVED by § 9 (CI1-SPECS-CODES): code lines removed by value; image URLs keep the code in the file name
  until `cat-images-1` (named exclusion).
- **F-2** `import/woocommerce.ts` matches categories by `Get CATEGORY#<slug>` only, so it duplicates an admin-created
  category with the same slug and can attach products to a renamed one.
- **F-3** Cross-sheet slug collisions (two sheets of one producer with one collection + produs, or a hand-made product
  with an imported slug) give two products with one `TenantSlug`. The spec allocates suffixes within a file only.
- **F-4** A product slug equals its child category slug only if produs slugifies to "" — not seen in BOEN.
- **F-5** The 5-resend backoff exists twice (`catprod.ts`, handler), ≈ 3 lines each; fold into `CATPROD-CONSISTENCY-1`.
- **F-6** `admin/src/lib/api.ts` signs the user out on ANY 403; the form is shown on catalog sites only.
- **F-7** `routes.json` lists the route before deployment; the operator's refresh should keep it.
- **F-8** `GET /products` reads one page (no pagination) — it limits the producer suggestions on very large sites
  (§ 8.1 item 10) and, more widely, the admin product list.

### 8.9 Not determined

Staging wall time; real DynamoDB page counts (INFERRED 1); `cdk diff` (oracle 7, operator); the staging evidence of
§ 5 (dry-run screenshot, `/shop` count, product page, re-import slugs) — NOT RUN.

### 8.10 Cycle 2 — review-0 corrections, by class (2026-10-30)

1. *A match decided on a key, not on the property the contract names* (category "matched by slug"): the stored slug
   decides on both paths; every GSI page is read; an occupied key is refused before any destructive step and never
   overwritten (conditional create). Tests: renamed category → 409 / dry-run report; category on GSI page two; GSI
   item with another stored slug; key occupied between lookup and create.
2. *An async completion applied to state it was not made for* (admin): one rule — every completion carries the
   revision or file token it was started with and is dropped when that is no longer current; the confirmation sends
   the checked snapshot. Tests: delayed file read, review-0's A/B sequence, edit during a dry run, stale failure.
3. *Suggestions derived from a filtered view*: an unfiltered read, its one-page limit stated.
4. *A comparison that skips values the contract counts*: specs differences compare every row with the first,
   empty included (both directions tested); B-3 withdrawn (equal image CELL; distinct invalid cells and invalid vs
   empty tested).
5. *Inputs and failures outside the response contract*: the body must be an object; every async step is
   step-labelled; the lock is released only when acquired; malformed quotes refused (twelve-cell rows tested).
6. *Documentation ripples*: the two ARCHITECTURE.md passages, and § 8 rewritten.

Plus § 9: code removal (unit rows: line removed / others kept; `1016054` not matched in `10160543`; columns 2 and 5
both applied; empty cells remove nothing; 478-row oracle), occupancy, B-3/B-4, infra test.

### 8.11 Cycle 3 — review-1 changes, by class (2026-10-30)

1. **R1 — a decision read outside the lock, acted on inside it.** Cycle 2 looked categories up before taking the lock
   and created them from that result after deleting the previous set; review-1 reproduced an overlapping re-import that
   deleted a completed import's products and then failed (500). Rule: *every read that decides an execution write is
   made while the job holds the lock*; the only read before the lock is the tenant mode (it decides a refusal that
   writes nothing, spec § 3.4 / CM-D11). The execution category lookup now runs after `acquireLock` and before the
   previous-set read; the dry run keeps its lock-free lookup; the conditional category create stays. The failure
   recovery text follows the same rule from the other side: it is keyed on whether the mutation phase was entered
   (`mutationPhaseEntered`, set just before the first command that can change a product or category — cycle 4 renamed
   it from `dataChanged`, review-2 R4), not on whether the lock was held. Tests: review-1's overlapping sequence (B paused before the lock
   while A runs fully → B 200, the same 3 slugs, 3 categories, projections exact); a rename seen only under the lock
   → 409, no product deleted, lock released; a renamed category → 409 whose only writes are the lock's put and its
   owner's delete; a lookup failure under the lock → 500 "nothing changed", lock released. Mutation (EXECUTED):
   moving the lookup back before the lock fails 4 rows including the overlapping regression.
2. **R2 — an exhaustiveness claim without the compiler check.** `lookupCategories` now switches on `CategoryLookup`
   with an `assertNever` default; adding a fourth variant was verified to fail `tsc` (TS2345), then reverted.
3. **R3 — an oracle over the final state claiming the write history.** The in-memory table records every payload a
   command actually wrote; the BOEN code-removal oracle runs over both imports' write history with non-empty counts
   asserted and positive controls (§ 8.3).

DynamoDB call counts are unchanged (1,077 / 1,895; EXECUTED); only their order moved (the category reads now follow
the lock put).

### 8.12 Cycle 4 — review-2 R4 (2026-10-30)

**A name that claimed more than its state establishes.** The recovery flag `dataChanged` was set just before the delete
loop — also when the previous set is empty — so it never meant "data changed". Renamed `mutationPhaseEntered`
(`glam-pricelist.ts:101`, set at `:154`, read at `:214`), with a comment stating the contract: before the boundary a
failure has certainly changed no product or category; after it data MAY have changed (a failed write's outcome can be
unknown), so the recovery is the full re-import — conservative by design. Behaviour unchanged. New row: a failure at
the first category write of a first import (empty previous set, nothing committed) → 500, `failedStep: "categories"`,
the re-import recovery. § 8.1 item 6 and § 8.11 reworded to the boundary.

## 9. Amendment CI1-A2 (human and operator rulings, 2026-10-30, after review-0 `escalate`)

- **CI1-SPECS-CODES (human): remove codes by value.** The real BOEN file carries the producer code inside the specs
  text: all 310 rows with specs have a line `Article no.: <code> (<old code>)`, and `<code>` is the row's column-5
  value. The law "no producer codes on the site" covers that text. Rule: the parser reads the row's column-2 and
  column-5 cells ONLY to remove, from the specs text (idx 10), every line that contains one of those values as a whole
  token (not preceded or followed by a letter or digit); the code cells never reach the parsed row type, the draft or
  any stored field. Columns 3 and 4 (prices) are still never read. The acceptance fixture now keeps columns 2 and 5
  (prices still blanked; counts unchanged) so an oracle over all 478 rows proves no stored text field contains a code.
  Operator measure: 310/310 article lines removed by value; no 7-digit number left in any kept line (BOEN, ITC
  Arc_Edition, ALPOD AUR).
- **Image URLs (human): accepted until `cat-images-1`.** BOEN image URLs carry the code in the file name
  (`…/image/GRD_<code>_<old code>_<name>.jpg`). They stay as imported until `cat-images-1` copies each image into
  tenant media under a neutral name (`lib/image-upload.ts:39`: `<assetId><ext>`). The code-removal oracle names the
  image fields as its only exclusion.
- **CI1-CATEGORY-OCCUPANCY (operator, implied by § 2.5 "matched by slug … never deleted"):** when `CATEGORY#<slug>`
  exists but its stored `slug` differs (an admin renamed it, `categories/update.ts:46`), the import is refused (409,
  the category named) before any deletion; a dry run reports it. The `GSI_Slug` match follows every page.
- **CI1-ADDED-REFUSALS (operator):** B-1 (≠ 12 cells refuses the file) and B-2 (a file with no style is refused,
  nothing deleted) are ratified — each prevents a wrong file from deleting a sheet. B-4 is ratified with a message that
  states the actual rule (the producer must give a non-empty slug). B-3 is withdrawn: options merge on an equal label
  and an equal trimmed image cell, as § 2.4 says; the usable-image test then applies per option.
- **CI1-INFRA-TEST (operator):** `infra/test/amodx-stack.test.ts` joins the allocation (function count and the new
  route wiring).

## 10. Operator closeout (2026-10-30)

- **Relay:** build-0 → review-0 `escalate` (six corrections, four decisions → § 9 CI1-A2); builds 1–3 → reviews 1–2
  `revise`, review-3 `approved` (builder claude-opus-5-5, reviewer gpt-6.1-sol).
- **Gates (operator machine, exit codes bare):** root typecheck 0; backend `npm run test:unit` 35 files / 536 tests;
  renderer `test:serving` 0; admin `test:unit` 4 files / 32 tests; MCP route oracle PASS + shapes; infra `npm test`
  59/59; oracle-5 grep prints only `parse.ts:32` `codeOld: 2`, `:33` `codeNew: 5`, `:37` `NEVER_READ_COLUMNS = [3, 4]`;
  both fixture sha256 OK; `git diff --check` 0; no path outside the allocation. Marker: ALL GATES GREEN.
- **CDK diff (staging):** parent +3 (route, integration, permission; 464/500 resources), CatalogApi +4 (function,
  role, policy, log group) + one output; DynamoDB read/write grant only; no replacement, no removal. The function has
  no fast-lane wiring, as the WooCommerce importer: `withInvalidation` marks `CDN_PENDING` and the sweeper drains it.
- **Staging (operator, real BOEN enriched file with its price and code columns, through the HTTP API with a staging
  admin id-token, tenant `cm1-catalog`):** dry run 200 in 5.0 s (cold start), import 200 in 7.1 s, re-import 200 in
  10.8 s — inside the 30 s integration limit. Reports: 478 rows → 437 products, 455 options, 23 deduped, 0 skipped,
  28 categories created (BOEN + 27 collections), then 0 on re-import; re-import deleted the 437 and created 437 with
  identical slugs and new ids. The first import replaced one older `cm1-catalog` fixture product whose `importSource`
  was the same (`Oak Plank`) — the replace rule working as specified; the Layer 2 `cm1-catalog` fixture set no longer
  holds it.
- **Staging public pages (`staging.amodx.net/tenant/cm1-catalog`):** `/shop` 200, no `RON`; `/sitemap.xml` 200 with
  437 BOEN product URLs; `/openai-feed` 404; product `boen-longstrip-3-strips-oak-andante-live-matt-square-edged` shows
  both sizes (`14x215x2200 mm`, `13,2x215x2200 mm`), no `offers`/`price`/currency/cart string. Product
  `boen-herringbone-click-castle-oak-adagio-live-natural-brushed-4v-bevel`: specs kept (`Product type`, `Floor
  Heating`), `Article no` 0 hits; the code `10151968` appears 10 times, every one inside the BOEN image URL
  (`//image/GRD_10151968_…`) — accepted until `cat-images-1` (§ 9).
- **Deviation:** the staging import used the HTTP route directly, not the admin screen; the admin entry is covered by
  its unit tests (dry-run snapshot binding, stale completions), not by a staging click-through.
- **Prod:** pending the human's deploy with the three `NEXT_PUBLIC_*` values on the command line. Before the first
  ITC import: its collection column holds a price note (`Prices in EUR per m², valid from 01.03.2024, …`), which would
  become a category name.
