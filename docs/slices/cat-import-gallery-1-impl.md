# CAT-IMPORT-GALLERY-1-IMPL — the 13-column pricelist (a gallery per row) in the glam importer (IMPL record)

Status: **IMPLEMENTED** (2026-11-02, round 3 + revision iteration 1). Code complete, review pending. All ten common
gates exit 0 on the final code; `test:serving` 6 consecutive runs exit 0 (§ 5). The round-2 decisions were ruled
(CIG-SERVING-SHELL = A, CIG-STALE-WRITE = A) and are built. One residual of the copy-overlap class is frozen for the
follow-up `CAT-IMAGES-OVERLAP-1` (§ 6 F-CIG-6, corrected in revision iteration 1: it can SUPPRESS a successful copy
and store a SECOND copy, not only misorder). Uncommitted on `main` at `656a9eb`.
(Round-2 status, kept: one gate red on the shells; decisions CIG-SERVING-SHELL and CIG-STALE-WRITE open.)
Contract: the ratified spec `docs/slices/cat-import-gallery-1.md` (§ 3 items 1–6, § 4 CIG-D1 = A, § 5). Builder
packet: operator, 2026-11-01, with the operator correction (2026-11-02 ~02:10Z) and the operator rulings after review 0
(2026-11-02 ~02:40Z: CIG-IMPL-SERVING = A, R-CIG-SAVE, R-CIG-REBASE, R-CIG-REPORT, R-CIG-NEGATIVE, R-CIG-TYPE; fixtures
accepted as built) and after the round-2 review (2026-11-02 ~03:20Z: CIG-SERVING-SHELL = A fail closed, CIG-STALE-WRITE = A,
CIG-REPORT-SCOPE = A, R-CIG-REBASE by the original holding).
Track F — Glam catalog. Vision tie: a catalog product page now shows every image the producer publishes for each
variant of the style (column 13 of glamCRM's catalog file), copied into the site's own media like the main image. The
no-price invariant holds by construction: column 13 is read only as addresses, and only http(s) addresses are kept.
Maturity: glam importer gallery path **PROTOTYPE** → **MATURE** after review and the operator's staging import (§ 7).

Evidence labels: **EXECUTED** = a command run by the builder in this slice; **OBSERVED** = read in a file or in the
output of a command; **INFERRED** = a conclusion, not run.

---

## 1. What changed, per packet item (file:line on the working tree)

| # | Item | Change |
|---|---|---|
| 1 | Parse (rule 2) | `backend/src/import/glam/parse.ts:20` `GLAM_GALLERY_COLUMN_COUNT = 13`; `:94` the header selects the layout (13 cells → 13, any other header → 12, as before); every data record must have that width, else refused (`:130`, wording "12- or 13-column"). `:65` `GlamRow.galleryUrls?` — present only in a 13-column file. `:137` `galleryParts`: split on `\|`, trimmed, empty parts, the column-9 cell and repeats dropped, file order kept. Columns 3–4 never read; 2 and 5 code-only (unchanged). |
| 2 | Shared schema + DTOs (rule 4) | `packages/shared/src/index.ts:1226` option `additionalImageLinks: z.array(z.string()).optional()`. `GlamOptionPlan` (`group.ts:104`, computed at `:252` from the option's rows by `usableGallery` `:64`), `GlamOptionDraft` (`map.ts:70`), `IngestOption` (`images.ts:20`) carry `additionalImageLinks?` (round 2, R-CIG-TYPE: `GlamOptionOutcome` deleted). |
| 3 | One derivation (rule 5) | `packages/shared/src/index.ts:1240` `deriveGallery(options)`: per option `imageLink` then `additionalImageLinks`, each address once; first → `imageLink`, rest → `additionalImageLinks`. Callers in § 4. |
| 4 | Write sites (rule 4) | `glam-pricelist.ts:607` (`productItem`, also the dry-run `drafts`) and `:727` (report options): the key only when non-empty; `:739` report member `gallery` only for a 13-column plan. The rewrite `glam-images.ts` `writeProduct` stores `images.options` as before; `rewriteExtras` (`images.ts:219`) removes the key when no extra is left. |
| 5 | Copy job (rule 6) | `images.ts:41` `SourceHolder.extra?: true`; `:67` `collectSources` adds each extra as a source (main first, then extras); `:196`/`:223` `rewriteExtras(current, read, …)`: copied extra → CDN URL, refused/failed → removed, rebased from the read like the main image (round 2, R-CIG-REBASE); `:264` `remainingWork` returns `extras` apart; `:295` `holdsCopiedImage` ignores extras (an extra never publishes). `glam-images.ts:186` the committed write's before/after, `:279` `committedHolding` (result-aware: a recovered copy is reported), `:218` `counts.extras`, `:250` `progress.remainingExtras`, `:253` `complete` needs both measures at 0. |
| 6 | Admin (rule 7) | `admin/src/components/GlamPricelistImport.tsx:877` `galleryLine` in the check and the import result; image section `:777` "Of which extra images (column 13): …" from `imageCounts(totals, "extras")` (`:422`); `:325` holding identity with `extra`; `:432`/`:434` `mainHoldings` / `extraHoldings`; `:462` `extraImageProblems` and its list `:819` (URL, reason, rows) — round 2, R-CIG-REPORT; every publication / hidden string names the MAIN image (`:523`, `:944-945`, the image-section lines). |
| 7 | Fixtures + end-to-end | `backend/test/unit/fixtures/glam/boen-PL-catalog-10.csv`, `alpod-HER-catalog-10.csv` (new; § 3 D-6). Test `glam-images-handler.test.ts` "CAT-IMPORT-GALLERY-1 end-to-end". |
| 8 | Docs | `backend/ARCHITECTURE.md` (catalog-product, glam-images, glam/ lines), `packages/shared/ARCHITECTURE.md` (ProductSchema row), `admin/ARCHITECTURE.md` (Extra images bullet). This file. |
| 9 | Editor save (R-CIG-SAVE) | `admin/src/pages/ProductEditor.tsx:54` `buildProductPayload` (catalog): an option's non-empty `additionalImageLinks` is sent unchanged with or without `imageLink`; never shown or edited. Tests `ProductEditor.test.ts` (+3: unchanged save, failed main copy, editor-cleared main image). |
| 11 | Stale write (round 3, CIG-STALE-WRITE = A) | `backend/src/import/glam-images.ts:413/:415` the write condition also names the `variants` read (`AND #variants = :readVariants`, or `attribute_not_exists(#variants)`); a cancelled write re-reads and re-plans (CIG-R1, ≤ 3). `backend/test/unit/memory-table.ts:90` accepts the clauses (deep list equality). `docs/slices/cat-images-1.md` § 11 appended. The § 9 overlap row renamed and rewritten for what it now proves; the GATE-1 row's condition string updated; a stale-write row with an unchanged status added. |
| 12 | Rebase by original holding (round 3) | `backend/src/import/glam/images.ts:235` `rewriteExtras`: current extras matched to the read's holdings in order (identity: the source, this request's copy, the source's `MEDIAMAP#` entry; fallback `:268` only to a holding that has a `MEDIAMAP#` entry, else kept after); per holding in read order: a stored copy is kept (and this request's copy of that holding not added), the source takes this request's result, a removed holding takes this request's copy. One image per holding, in read order, holds only when every stored copy is identified (§ 6 F-CIG-6, revision iteration 1). `glam-images.ts:319` `storedCopies` (strongly consistent `MEDIAMAP#` Gets) on a re-plan. Tests: core +4 (the corrected read-order row, five mixed outcomes, two successful copies, no identity), handler +3 (unchanged-status stale write, two successful copies with different names, three extras with mixed outcomes). Revision iteration 1: +1 core and +1 handler row "RESIDUAL CAT-IMAGES-OVERLAP-1 (characterization, not a conformity oracle)" — they pin the known defect of F-CIG-6. |
| 13 | Shell rule (round 3, CIG-SERVING-SHELL = A) | `renderer/test/serving-contract/locale-1/proof.mjs:549` `liveHeadProblem`, `:570` `liveSiteIdReference` (fail closed), `:606` the shell branch; `checkExpected` takes the reference as a 6th input. `contract.test.mjs:1922` (main diff), `:2050`/`:2059` (6 shell controls), `:2353` (404 test, reference of the en-US set of the same run). `locale-1e.md` § 18 round-3 paragraph appended. |
| 14 | Preview wording (round 3, CIG-REPORT-SCOPE = A) | `admin/src/components/GlamProfileEditor.tsx` hidden list "fără adresă de imagine principală (coloana 9)" + comment; `glamPreview.ts` comments and `PUBLICATION_NOTICE` (main image; extras never publish); `glamPreview.test.ts` +2 assertions. |
| 10 | Serving proof (CIG-IMPL-SERVING = A) | `renderer/test/serving-contract/locale-1/proof.mjs:555-569` the live `[siteId]` resources against the live document (shape from the before side; stylesheet in the live head; every script loaded by the live head; the 404 boundary links that stylesheet); `contract.test.mjs:1990` root-script precondition, `:2023` five live-document controls. `docs/slices/locale-1e.md` § 18 appended. Open: shells (§ 5). |

Tests added or changed: `backend/test/unit/glam-import-core.test.ts` (+5 parser rows; the width-refusal message of
the existing row updated to the new wording); `glam-images-core.test.ts` (+6 extras rows, +2 write-boundary rows, +2
rebase rows; `remainingWork` expectations gain `extras: 0`); `glam-images-handler.test.ts` (+1 synthetic import→copy
row, +2 fixture rows, +2 overlap rows (opposing outcomes, both commit orders), +3 negative rows (non-addresses dropped,
counted, never stored; only non-addresses; a policy-refused extra); `counts` gains `extras`, `progress` gains
`remainingExtras`); `packages/shared/test/derive-gallery.test.ts` (new, 6); `admin/src/components/GlamPricelistImport.test.ts`
(+6; the `hiddenCauseText` row's expected text now names the main image); `admin/src/pages/ProductEditor.test.ts` (+3).

## 2. How the 12-column path stays byte-equal (rule 1)

Every new member is ABSENT, not empty, on a 12-column file: `GlamRow.galleryUrls`, `GlamImportPlan.gallery`, the
option `additionalImageLinks` (plan, draft, stored item, report). `deriveGallery` over options without extras is the
§ 3.4 rule (shared test row 2). `withDerivedGallery` returns the same keys in the same order. EXECUTED: the golden
`glam-profile-golden.test.ts` passes with no change to its fixture, its expected file or `cat-import-profile-1-golden.ts`
(`git status --porcelain -- backend/test/unit/fixtures/glam` lists only the two added files). On real data, the BOEN
row of § 1 item 7: the 13-column plan, minus `gallery`, equals the plan of the same rows written as 12 columns.

Two intended changes to the image-copy answer, also on 12-column sheets: `counts.extras` (all 0) and
`progress.remainingExtras` (0). Three existing test expectations were extended for them (§ 1).

## 3. Local decisions (naming and detail; one line each)

- **D-1 Layout selection.** The header selects the width (13 cells → 13, else 12). Basis: spec § 3 item 1 "a file
  mixing widths is refused" applied to the whole file, as § 2 of the spec measured widths, while a 12-column file
  with an odd header stays accepted as before (rule 1). Effect: a 12-column file with one shifted record (a stray
  comma) stays refused — reading it as 13 columns would put a code cell into a stored field.
- **D-2 `GlamOptionOutcome` (map.ts) instead of a field on `GlamOptionPlan`.** `GlamOptionPlan` lives in
  `glam/group.ts`, which is not allocated. The option extras are computed in `map.ts` from the option's rows.
  - 2026-11-02 (round 2): WITHDRAWN by ruling R-CIG-TYPE (`group.ts` allocated). The field is on `GlamOptionPlan`,
    computed in `allocateLabels` where the option's rows are known; `GlamOptionOutcome` and `withGallery` are deleted.
- **D-3 Merged rows.** An option made of several rows (equal label and equal column-9 cell) gets the union of its
  rows' column-13 addresses, in row order, each once. Basis: spec § 3 item 2 "the importer writes a row's column-13
  images there, in file order" — each row's images, none dropped.
- **D-4 `gallery` counts** are over the rows that belong to a product (skipped rows not counted). `dropped` = parts
  that are not an http(s) URL (the `usableImage` rule of column 9). Repeats and the column-9 copy are dropped without
  a count (rule 2 says dropped; rule 3 says dropped and counted only for non-URLs).
- **D-5 Derivation home: `packages/shared/src/index.ts`.** The pure import core (`glam/map.ts`) cannot import
  `lib/catalog-product.ts` without loading `lib/db.ts` (the reason the core's `derive` port exists). Shared is reached
  by both without a new dependency edge. The shared rule "a sibling module for behaviour" was not followed because
  only `index.ts` is allocated; `isCatalogMode` is the precedent.
- **D-6 Fixtures.** glamCRM `boen/catalog/PL.csv` has column 13 EMPTY on all 478 data rows (EXECUTED, § 5), so 10 BOEN
  rows cannot show an option with extras. Added: `boen-PL-catalog-10.csv` (BOEN data rows 1–10, as the packet says;
  proves 13 = 12 on real data) and `alpod-HER-catalog-10.csv` (ALPOD HER data rows 1, 2, 3, 4, 6, 12, 75, 76, 78, 79:
  single-option products with 3 extras each, one row without an image, two 2-option styles with extras on each
  option). Source glamCRM `f6e0d19`, read only (glamCRM `git status --porcelain` empty after). Price columns 3–4
  blanked, codes kept — the repo's fixture rule (`cat-import-1.md` § 9, `cat-import-profile-1a.md` § 242): the glamCRM
  catalog files carry prices in columns 3–4 on every row (EXECUTED).
- **D-7 Extras are rewritten from the product's current list only.** The CIG-R1 `read` rebase stays for the main
  image. Effect (deferred, § 6 T-2): when two overlapping copy requests resolve one extra differently, the extra can
  stay removed although it was copied (it is in `MEDIAMAP#`; the next import brings it back as `cached`).
  - 2026-11-02 (round 2): WITHDRAWN by ruling R-CIG-REBASE. Extras follow the CIG-R1 rebase (`rewriteExtras`): in read
    order, a copied extra is applied also when a concurrent request removed it; a failure removes only an address still
    present; an address another request stored whose source this request did not resolve is kept, after the read-order
    ones (its position is not recoverable without that result). The report rule is result-aware (`committedHolding`).
- **D-10 (round 2) Ordering of an unresolved stored extra.** In the rebase, an extra stored by another request whose
  source this request did not resolve (budget) keeps its place relative to the other such extras, after the read-order
  ones. Rare (needs a deferred source AND a concurrent copy); the gallery still holds every image.
  - 2026-11-02 (round 3): WITHDRAWN by ruling R-CIG-REBASE (merge by the original holding; the read's order is the
    order). Replaced by the holding merge (§ 1 item 12); the round-2 test that encoded the wrong order is corrected.
- **D-11 (round 2) The shell rule is not invented.** The ruled live-document rule is applied as written; on
  `__next_error__` shells it cannot hold (§ 5), so it stays failing there and the choice is a decision.
  - 2026-11-02 (round 3): RESOLVED by ruling CIG-SERVING-SHELL = A (§ 1 item 13).
- **D-12 (round 3) Section number.** The stale-write correction is `cat-images-1.md` § 11, not § 10 as the ruling named:
  § 10 already holds that record's operator closeout (append only, nothing renumbered).
- **D-13 (round 3) The 404 test's reference.** `loc1e-404-document` captures a set holding only the 404 response; its
  shells use the reference of the en-US set captured in the same suite run from the same build and server.
- **D-14 (round 3) `MEDIAMAP#` key.** `storedCopies` derives the key `MEDIAMAP#<md5(url)>` itself: `lib/media-map.ts`
  (not allocated) does not export its `hashUrl`. One line, with a pointer to the owner (§ 6 F-CIG-7).
- **D-15 (round 3) Fallback of the holding match.** An address with no identity may take only a free holding whose
  source has a `MEDIAMAP#` entry (some request copied it), else it is kept after the holdings: the fallback can misorder
  but never drops an image or this request's copy (a looser fallback, tried first, dropped this request's copy when
  identity was missing — caught by the "no identity" row).
  - 2026-11-02 (revision iteration 1, review R-CIG-RESIDUAL-TRUTH): the claim "never drops … this request's copy" is
    WRONG. It holds for an address no holding with a `MEDIAMAP#` entry can take (the "no identity" row). It fails when
    the unidentified address takes a holding whose `MEDIAMAP#` entry is THIS request's copy: that copy is then
    suppressed, and the address's own source can end up stored twice (§ 6 F-CIG-6, witnesses there). True guarantee: a
    STORED image is never removed; this request's copy can be lost.
- **D-8 Admin failure list and hidden causes read main holdings only.** The list's heading says "These variants have
  no image now", and an extra never decides publication; extras are counted in their own line.
  - 2026-11-02 (round 2): SUPERSEDED by ruling R-CIG-REPORT. Lost extras are listed (`extraImageProblems`: URL, reason,
    rows) apart from variants without a main image; the variant list's heading now says "no main image".
- **D-9 `checkProductWrite`** gets no new check: the extra key is not monetary (rule 4); no URL check was added for
  extras (none was asked; the importer only writes http(s) addresses or CDN URLs).

## 4. Abstractions introduced (one line each)

- `deriveGallery` (shared, pure function) — users: `lib/catalog-product.ts` `withDerivedGallery` (create, update — the
  admin save —, the glam import), `import/glam/map.ts`, `import/glam-images.ts` (through the core's `derive` port);
  axis: none new — it REPLACES two copies of one rule (map.ts inline, catalog-product.ts) with one; rejected: the rule
  in `catalog-product.ts` imported by `map.ts` (loads the DB client into the pure core).
- `GalleryCounts` (map.ts DTO) — users: `GlamImportPlan.gallery` → report → admin `galleryLine`; rejected: an inline
  type (named because it crosses to the report).
- `liveSiteIdReference` (proof.mjs, exported) — users: `contract.test.mjs` main diff loop, controls row, 404 row; axis:
  none (the ruled shell anchor); rejected: a reference passed as raw resources by each caller (each would recompute the
  live-head check and the agreement assertion).
- `liveHeadProblem` (proof.mjs, local) — users: `moveRootLayoutRaw` and `liveSiteIdReference`: one live-head rule for
  pages and the reference. `storedCopies` (glam-images.ts, local) — user: the re-plan path.
- `rewriteExtras`, `committedHolding`, `galleryParts`, `usableGallery` (group.ts, used by group.ts and map.ts — one
  "usable column-13 address" rule), admin `mainHoldings` / `extraHoldings` / `problemsOf` (one failure-list rule for two
  holding kinds) — local functions, no new seam. Round 2 removed `GlamOptionOutcome`, `withGallery`, `holdingKey`,
  `changedHoldingKeys`.

Callers of the derivation (basis: EXECUTED exact-identifier `grep -rn` for `deriveGallery(`, `withDerivedGallery(`,
`checkProductWrite(` over `backend/src packages/shared/src admin/src renderer/src tools/mcp-server/src`, plus the
value use in `glam-images.ts`; `tsc` compiles every import; a text search is not a compiler-proven completeness
result): `catalog-product.ts:114` (`withDerivedGallery` → `deriveGallery`), reached from `checkProductWrite`
(`catalog-product.ts:87`) by `products/create.ts:55`, `products/update.ts:63`, `import/glam-pricelist.ts:622`;
`import/glam/map.ts:324`; `import/glam-images.ts:177`, `:200` (passes `deriveGallery` to `planProductWrite`, which
calls it as `derive` in `images.ts` `rewriteProduct`).
No renderer or admin caller. `products/update.ts` was not edited: its derivation call is `checkProductWrite`.

## 5. Gates and oracles (round 3, re-run in revision iteration 1 on the final tree, EXECUTED in order; logs deleted with the temp dir, results in `build-progress.md`)

| Check | Command | Result | Label |
|---|---|---|---|
| 1 | `npm --prefix "<repo>" run build` | exit 0 | EXECUTED |
| 2 | `npm --prefix "<repo>" run typecheck` | exit 0 | EXECUTED |
| 3 | `npm --prefix "<repo>/packages/shared" test` | exit 0, 269 tests | EXECUTED |
| 4 | `npm --prefix "<repo>/packages/plugins" test` | exit 0, 204 tests | EXECUTED |
| 5 | `npm --prefix "<repo>/renderer" test` | exit 0, 375 tests | EXECUTED |
| 6 | `npm --prefix "<repo>/renderer" run test:serving`, 6 consecutive runs | exit 0 six times, 95 pass / 0 fail each; each run: "65 live 200 pages agree on the [siteId] resources" | EXECUTED |
| 7 | `npm --prefix "<repo>/admin" run test:unit` | exit 0, 223 tests | EXECUTED |
| 8 | `npm --prefix "<repo>/backend" run test:unit` | exit 0, 1223 passed, 1 skipped (the capture); the golden passes; +2 vs round 3 = the two RESIDUAL characterization rows | EXECUTED |
| 9 | `npm --prefix "<repo>/tools/mcp-server" test` | exit 0 | EXECUTED |
| 10 | `git -C "<repo>" diff --check` | exit 0 | EXECUTED |
| O-1 | `git diff --stat -- renderer/src infra docs/slices/cat-import-gallery-1.md docs/slices/catalog-mode-1.md docs/slices/cat-import-profile-1.md` | empty | EXECUTED |
| O-2 | `git status --porcelain -uall` | only allocated paths (26 modified, 4 added incl. this file) | EXECUTED |
| O-3 | `git status --porcelain -- backend/test/unit/fixtures/glam` | only the 2 added fixtures | EXECUTED |
| O-4 | `routes.json` | unchanged (`git status -- tools/mcp-server` empty) | EXECUTED |
| O-5 | `git diff -U0 -- docs/slices/locale-1e.md docs/slices/cat-images-1.md` | 0 removed lines each (append only) | EXECUTED |
| D-SDK | DynamoDB accepts `=` on a list value | AWS API reference: EQ "is supported for all data types, including lists and maps" (API_Condition) — the expression comparator; not run against DynamoDB (only the in-memory stub) | INFERRED |

(Round-2 table, kept in substance: gate 6 exit 1 twice on the shells; 6×6 not run.)

Gate 6, round 1 (EXECUTED): a worktree at `656a9eb` passed 95/95; the same worktree with only the rule-4 schema line
failed #84, #85, #87, #94 — the proof pinned the content-hashed client file names of `d9999d2` (`locale-1e.md` § 18).

Gate 6, round 2: with the ruled live-document rule, every 200 page passes and #87 passes. The remaining failures are
the `__next_error__` shells only, for a reason independent of this slice: OBSERVED in `1e/before/catalog/checkout.body`,
a shell's head has no `<link rel="stylesheet">` (only a style preload, which LOC1E-404-SHELL-PRELOAD = A removes after
the move) and loads only bootstrap scripts, none of the `[siteId]` scripts. The failing stylesheet
`0cx63klkdro8w.css` is the same name as at `d9999d2`. EXECUTED read-only probe: all 46 HTML pages of the commerce,
content and catalog subjects in the `d9999d2` capture (200 pages and shells) carry the same `[siteId]` scripts
(`2mtkl633e7u4c.js`, `37dyg5fjsn5y6.js`), so a shell can be anchored to a live 200 page of the same build (option A of
CIG-SERVING-SHELL).

## 6. Findings and deferred debt

- **F-CIG-1 (admin editor drops extras of an option without a main image).** `admin/src/pages/ProductEditor.tsx:46-49`
  (catalog save): `option.imageLink ? option : { value: option.value }` — an option with extras but no `imageLink`
  is sent as `{ value }`, and the update replaces the variants, so the extras are lost on that admin save. Options with
  a main image keep their extras (the object is sent whole). Not allocated ("no other admin change"). Proposed fix:
  `({ value, imageLink, additionalImageLinks })` with each key only when present. Impact today: low (such a product
  stays hidden — an extra never publishes); the next import restores the extras.
  - 2026-11-02 (round 2): the impact line was WRONG (review 0 reproduced it: option A with only an extra, option B with
    a copied main image → an active product lost an image). FIXED under ruling R-CIG-SAVE (§ 1 item 9).
- **F-CIG-2 (MCP tool text is now wrong).** `tools/mcp-server/src/index.ts:1138` describes the import as "the 12-column
  layout"; the route accepts 13 columns now. Not allocated. Proposed: "the 12- or 13-column layout (column 13 = other
  images of the row)".
- **F-CIG-3 (staging plan cannot see extras).** Packet § 5 stages `boen/catalog/PL.csv`; its column 13 is empty
  (D-6), so "gallery count = column 9 + column 13 images" proves nothing about extras. Proposed: stage an ALPOD sheet
  with extras as well (HER: 68 of 148 rows; WIN-spc: 57 of 77; EXECUTED count).
  - 2026-11-02: settled by the operator — staging `glam-staging` receives HER (and SIL per the correction) plus BOEN `PL.csv`.
- **T-1** The core's `derive` port (`images.ts` `DeriveGallery`) has one implementation; its reason (the DB client in
  `catalog-product.ts`) is gone since `deriveGallery` is in shared. Removing it is a later simplification (signature
  churn in two functions and their tests); kept here to keep the diff small.
- **T-2** D-7 (extras not rebased on a re-read). — 2026-11-02 (round 2): closed by R-CIG-REBASE.
- **F-CIG-4 (round 2; stale write when the status does not change).** EXECUTED (a temporary handler probe, deleted):
  R1 = main image failed, extra copied (the product stays `draft`, so R1 does not change `status`); R2 (read before R1
  wrote) = main copied, extra failed. R2's write is conditioned only on `status` (still `draft`), so it commits from its
  stale read, replaces `variants` and removes the extra R1 had copied; R3 finds nothing to do — the copied extra is lost
  until the next import. Class: the copy's write replaces the whole `variants` attribute but its condition covers only
  `status` (CAT-IMAGES-1 § 9 / CIG-R1). The same class reaches a main image with `publishWithoutImages: true`. Closing
  it changes the ratified § 9 behaviour and needs `memory-table.ts` (outside the allocation) → `DECISION_REQUIRED`
  CIG-STALE-WRITE.
  - 2026-11-02 (round 3): FIXED under ruling CIG-STALE-WRITE = A (§ 1 item 11); the probe case is now a committed row.
- **F-CIG-5 (round 2; same wording defect outside the allocation).** `admin/src/components/GlamProfileEditor.tsx:948`
  "Rămân ascunse — fără adresă de imagine în fișier" and the `glamPreview.ts:26-27, :100-101, :124` comments describe the
  condition `optionsOf(d).some(o => o.imageLink)` — no MAIN-image address. An extras-only product has image addresses.
  Proposed: "fără adresă de imagine principală (coloana 9) în fișier", as in `GlamPricelistImport.tsx`.
  - 2026-11-02 (round 3): FIXED under ruling CIG-REPORT-SCOPE = A (§ 1 item 14).
- **F-CIG-6 (round 3; residual of the copy-overlap class → `CAT-IMAGES-OVERLAP-1`).** The holding match needs an
  identity for a copy another request stored. It has one when the copy is the source's current `MEDIAMAP#` entry or this
  request's own copy. It has none when a LATER copy of the same source overwrote that entry (three requests copying one
  source, or two copies plus a third request's re-plan). Then the copy goes to the next free holding that has a
  `MEDIAMAP#` entry, or after the holdings: never dropped, possibly misordered — and if it lands on another copied
  holding, that holding's copy and this one may swap places. Taxonomy for the follow-up: (a) identity overwritten by a
  later copy (this case); (b) the orphan `ASSET#` + S3 object of every second copy (already named in cat-images-1 § 8.3);
  (c) a product contended beyond `WRITE_ATTEMPTS` is left to a later request (as before). A closing design would record
  the source on the stored image (a boundary change) — not done here (the ruling rejected new fields).
  - 2026-11-02 (revision iteration 1, review R-CIG-RESIDUAL-TRUTH): the description above UNDERSTATES the residual
    ("never dropped, possibly misordered"; "three requests"). Corrected statement. Trigger: a stored copy whose
    `MEDIAMAP#` entry was overwritten by a later copy of its source — TWO overlapping requests suffice. Consequences
    (the follow-up's taxonomy):
    1. **misorder** — the gallery differs from the read order when source identity is unavailable;
    2. **suppressed successful result** — the unidentified copy takes a holding whose `MEDIAMAP#` entry is this
       request's own copy, so that copy (fetched, in `MEDIAMAP#`, reported in `copied`) is not stored on the product;
    3. **a second stored copy of another source** — the same request then also stores its own copy of the
       unidentified address's source, so that source is held twice;
    4. (kept from above) the orphan `ASSET#` + S3 object of every copy not stored; (5) a product contended beyond
       `WRITE_ATTEMPTS` is left to a later request.
    What still holds: a STORED image is never removed by the rebase; with every stored copy identified, one image per
    holding in read order (the committed rows of § 1 item 12).
    **Two-request witness (EXECUTED, characterization — NOT a conformity oracle):** holdings A, B. R1: A dead, B copied
    (B-r1). R2 (read before R1's write): A copied (A-r2), B copied (B-r2) — its `MEDIAMAP#` writes overwrite B's entry —;
    its write is cancelled (variants changed) and re-planned: B-r1 has no identity, takes holding A (its entry is A-r2),
    so the extras become `B-r1, B-r2`: A-r2 suppressed, B twice; the correct result is `A-r2, B-r1`. Rows:
    `glam-images-core.test.ts` and `glam-images-handler.test.ts` "RESIDUAL CAT-IMAGES-OVERLAP-1 (characterization, not
    a conformity oracle)"; the follow-up's fix must REPLACE these expectations. No further heuristic and no new field in
    this slice (operator freeze ruling; review: "No further overlap redesign is requested here").
- **F-CIG-7 (round 3).** `lib/media-map.ts` `hashUrl` is not exported; `glam-images.ts` `storedCopies` repeats the
  one-line key rule (D-14). Proposed: export it (a one-line change in `media-map.ts`, outside this allocation).
- **F-CIG-2** (MCP tool text "12-column layout") stays open: `tools/mcp-server/src/index.ts` is not allocated.

## 7. Operator closeout (2026-11-02 ~04:55Z; staging only — no prod deploy overnight, human's rule)

- Review: approved at round 3, revision iteration 1 (review 0 → escalate: CIG-IMPL-SERVING + five code findings;
  round-2 review → escalate: CIG-SERVING-SHELL, CIG-STALE-WRITE, CIG-REPORT-SCOPE, rebase order; round-3 review →
  revise: R-CIG-RESIDUAL-TRUTH, R-CIG-DOC-RIPPLES → approved). Rulings by the operator under the human's overnight
  delegation (packet, dated; reversible). The approval states explicitly that overlapping copies are NOT loss-free:
  F-CIG-6 is frozen for `CAT-IMAGES-OVERLAP-1`, which the human orders.
- Correction to § 6 F-CIG-6's last sentence ("the ruling rejected new fields"): the CIG-STALE-WRITE ruling rejected a
  VERSION COUNTER on the product (DynamoDB compares the whole `variants` value, so none was needed). Recording the source
  on each stored image is a different field and remains an open design choice for the follow-up.
- Operator gate run (`glam/gallery-gates.log`, bare exit codes): build, typecheck, shared 269, plugins 204, renderer 375,
  serving 95/95, admin 223, backend 1223 (+1 skipped golden capture), MCP 13, `git diff --check` — all exit 0;
  infra / `renderer/src` / spec diffs empty; dependency lines none; `cat-images-1.md` and `locale-1e.md` append-only
  (26/0 and 38/0 lines); whitespace none. The gate script's allocation regex missed `backend/test/unit/glam-*.test.ts`
  (allocated by the packet; a regex defect of the operator's script, not a violation).
- `cdk diff -c stage=staging`: code-only — 41 Lambda assets (the shared package is in every bundle), two bucket
  deployments, the admin runtime config; no resource added or removed, no IAM; the same three pre-existing
  nested-stack `Description` encoding lines as `locale-1e`.
- Staging (build `3D5T1ZzXa7IFFqqouxI8L` → `rv89Ivxd6puAjxw3nv86q`): the 51 CM1 URLs text- and status-identical (0
  differences; `cm1-catalog` untouched). New operator tenant `glam-staging` (locale `ro-RO`; renders
  `<html lang="ro">`, "Magazin" — the first live Romanian proof of `locale-1e`). `alpod/catalog/SIL.csv` (packet § 5 as
  corrected): import 9 rows → `gallery {rows 9, addresses 36, dropped 0}`; copy job one batch, 45 ingested (9 main + 36
  extras), 0 refused, 0 failed; six product pages each render exactly 5 distinct images = the file's column 10 ∪ column 13
  for that product, all on the CDN. `boen/catalog/PL.csv` (the production file, column 13 empty): 437 products / 455
  options / 23 deduped — the CAT-IMPORT-1 figures — with `gallery {0, 0, 0}`. Logs: `glam/gallery-staging-out/`.
- Open for the human (morning): order `CAT-IMAGES-OVERLAP-1` (F-CIG-6 taxonomy, § 6); F-CIG-2 (MCP tool text still says
  "12-column", one line in `tools/mcp-server/src/index.ts`); F-CIG-7 (`hashUrl` export). KUBERIT import only after the
  VAT rate is stated; ALPOD only ORC-wood on the real tenant.
