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

## 4. Implementation record (builder, 2026-10-31, on `0af60f6`, uncommitted)

### 4.1 Per item — what changed

1. **The deciding read** (§ 2 item 1). `backend/src/import/glam-pricelist.ts`: `StoredProductRef.slug` `:75`;
   `EXECUTION_PROJECTION` gains `slug` `:85`; `DRY_RUN_FIELDS` gains `slug` `:96` (not in `SITE_PRODUCT_FIELDS`, so
   `siteProducts` is unchanged). The taken map is built from the existing `readTenantProducts` read by the pure
   `takenSlugsOf` (`backend/src/import/glam/map.ts:165`): every product whose `importSource` is not this sheet's
   (another sheet, or none), with a non-empty string slug, slug → its `importSource` (`null` when it has none); the
   first holder in read order is reported when two products already share a slug. Execution: the plan that is reported
   and written is made right after that read, under the lock (`:245`). The read order is kept (category lookup, then
   the product read — `glam-import-handler.test.ts:516` pins it): a plan without the taken map (`unchecked`, `:226`)
   decides only the 400 "no product rows" refusal and the category lookup; neither depends on a product slug (the
   categories come from producer + collection). Dry run: the same read, no lock (`:191`, `:194`); the handler header,
   `backend/ARCHITECTURE.md` and the admin dry-run line state that its list can differ from the execution's.
2. **Pure allocation** (§ 2 item 2). `backend/src/import/glam/group.ts`: `TakenSlugs` `:144`, `CrossSheetCheck`
   `:147`, `groupStyles(…, crossSheet?)` `:158`, `:192`; `avoidTakenSlugs` `:288` runs AFTER the unchanged
   within-file `allocateSlugs`, in file order: a slug not taken is kept; a taken slug becomes `<slug>-<slugify(norm(sheet))>`;
   when that is reserved (taken, or another slug of this file) the numbering continues on it: `<slug>-<sheet>-2`,
   `-3`, …; when the sheet gives an empty slug, `<slug>-2`, `-3`, …; each new slug is reserved at once. So the new
   slug is always the held slug followed by the sheet's slug and/or a number (pinned on all four paths, § 4.9). `GlamStylePlan.crossSheet?` carries `previousSlug` + `heldBy`.
   `map.ts`: `planGlamImport(rows, upload, applied?, taken?)` `:203`, `:211`. Without `taken` the output is exactly
   today's (no new member). Deterministic for a file + taken map (a pure function; set membership only).
3. **Report** (§ 2 item 3). `map.ts`: `CrossSheetSuffix` `:152`, plan member `crossSheetSuffixed?` `:132` /
   `:242` — present only on a plan made with the taken map (`[]` = checked, none). Handler `report()` `:723` sends it
   on the dry run and the execution (also the 503 body, which spreads the report); it is absent on the 400 "no
   product rows" body (that plan has no product and was not checked). Admin:
   `admin/src/components/GlamPricelistImport.tsx` `crossSheetLine` `:780`, shown in the dry-run report `:832` and the
   import result `:703`; `withinFileLine` `:799` / `:829` (iteration 1). MCP: `tools/mcp-server/src/tool-shapes.ts` member
   `:86`, count line `:129`.
4. **Category slugs** — untouched (no change to `lookupCategories` / `createCategories`).

Tests: `backend/test/unit/glam-import-core.test.ts:469` (8 rows: other sheet → suffixed; hand-made → `heldBy null`;
own previous set → re-import keeps its slugs, and the other sheet keeps its own; suffix taken → `-2`, `-3`, and a slug
planned in the file is never reused, and a within-file `-2` that is taken gets the sheet after its number; a sheet with
an empty slug → `<slug>-2`; no collision → today's plan + `crossSheetSuffixed: []` (JSON-equal), deterministic;
`takenSlugsOf` edge cases; ALPOD ORC-laminate then ORC-wood → **8** suffixed `-orc-wood`, `heldBy
glam:alpod/orc-laminate`, incl. `alpod-organic-eco-design-water-resistant-wood-flooring-clever`; re-import of either
sheet keeps its slugs). `backend/test/unit/glam-import-handler.test.ts:971` (5 rows through the handler on the
in-memory table: dry run + execution list both holders, written `slug` and `TenantSlug` suffixed, holders untouched,
tenant slugs unique; re-import keeps slugs; no holder → `[]`; a slug taken AFTER the dry run, at lock time, is avoided
by the execution — the deciding read is the one under the lock; 400 body has no member) and `:198` (the pinned
projection gains `slug`, as § 2 item 1 requires). Admin `GlamPricelistImport.test.ts:783` (4 rows since iteration 1), MCP
`tool-shapes.test.ts:130` (1 row).

**Golden.** The fixture `cat-import-profile-1-baseline.json` is unchanged (`git diff --stat` empty). Before the
helper change the golden test failed 6/7 and the ONLY diff line was `"crossSheetSuffixed": []` (EXECUTED, all diff
lines counted). `crossSheetSuffixed` joined the documented additive list `ADDED_MEMBERS`
(`backend/test/unit/cat-import-profile-1-golden.ts`), as `publication` did in CAT-IMAGE-GATE-1, and
`glam-profile-golden.test.ts:107` now asserts the split-off member is `[]` wherever it is sent. Plan, write history,
audit and the other response members equal the golden: 7/7.

### 4.2 Oracles (EXECUTED, fresh build, packet order; last lines — re-run in iteration 1)

| Command | Exit | Last line(s) |
|---|---|---|
| `npm run build` | 0 | `> infra@0.1.0 build` / `> tsc` |
| `npm run typecheck` | 0 | `> infra@0.1.0 typecheck` / `> tsc --noEmit` |
| `packages/shared: npm test` | 0 | `Test Files 10 passed (10)`, `Tests 197 passed (197)` |
| `backend: npm run test:unit` | 0 | `Test Files 43 passed \| 1 skipped (44)`, `Tests 1170 passed \| 1 skipped (1171)` — the skipped file is the golden CAPTURE (run alone: `1 skipped`; it runs only with `CAPTURE_GOLDEN_TO`) |
| `admin: npm run test:unit` | 0 | `Test Files 6 passed (6)`, `Tests 133 passed (133)` |
| `tools/mcp-server: npm test` | 0 | `# tests 13`, `# pass 13`, `# fail 0` |
| `git diff --check` | 0 | (no output) |
| `git diff --stat -- renderer infra packages` | — | (no output) |
| `git diff --stat -- …/cat-import-profile-1-baseline.json` | — | (no output) |
| `git status --porcelain -uall` | — | 12 modified paths, all allocated (+ this doc) |

Fixtures read-only: `alpod/ORC-laminate.csv` and `ORC-wood.csv` sha256 `f697…ba56` before and after.

### 4.3 Abstraction lines

- `TakenSlugs` (type alias, `ReadonlyMap<slug, importSource | null>`) — users: `takenSlugsOf`, `planGlamImport`,
  `groupStyles`, the handler's `planFor`; axis: none (a named data shape crossing core ↔ handler, raw DTO); rejected:
  a `Set<string>` — it cannot give `heldBy`, which § 2 item 3 requires.
- `CrossSheetCheck` (`{ taken, sheetSlug }`) — user: `groupStyles` (built in `planGlamImport`); axis: none; rejected:
  two optional parameters that are valid only together (a defect-shaped signature).
- `takenSlugsOf` (pure function) — users: the handler's dry run and execution, the unit rows; it holds the § 1 rule
  "products this import does not replace", which is domain logic, so it lives in the pure core and is tested without
  I/O; rejected: an inline filter in the handler (two copies, untested without the table).
- `avoidTakenSlugs` (private function) — user: `groupStyles`; rejected: folding it into `allocateSlugs` (that would
  change the function the golden pins for the no-taken case).
- `crossSheetLine` (admin, exported pure function) — users: the dry-run report and the import result, plus the test;
  rejected: two inline JSX copies.
- `withinFileLine` (admin, exported pure function, iteration 1) — users: the dry-run report and its copy test (the
  test seam review-0 R2 asks for: the combined within-file + cross-sheet path); rejected: the inline JSX it replaces,
  which cannot be tested in the admin unit suite (`.test.ts`, no DOM).
- No new module, package, dependency or boundary. Dispatch axis: n/a (no new sum type; `crossSheet?` /
  `crossSheetSuffixed?` are absent = "not applicable / not checked", one representation each).

### 4.4 Copy

(Revised in iteration 1, § 4.9 — the iteration-0 copy promised "la sfârșit numele foii", false on two paths.)

- Admin, dry run: „Adrese de produs schimbate, pentru că sunt deja ale altor produse de pe site — adresa nouă este
  adresa ocupată, urmată de numele foii și/sau de un număr (N): `<previousSlug>` → `<slug>` (rândul R; adresa este a
  unui produs din `<importSource>` | fără sursă de import), …. La import lista poate diferi dacă produsele altor foi se
  schimbă între timp.”
- Admin, import: „Adrese de produs schimbate, pentru că erau deja ale altor produse de pe site — adresa nouă este
  adresa ocupată, urmată de numele foii și/sau de un număr (N): …”
- Admin, within-file line (existing, English, reworded): "N product address(es) got a number (-2, -3…) because
  products of this file had the same address; final address: `<slug>` (row R), …"
- MCP: „Adrese schimbate / Adrese care ar fi schimbate (adresa era deja a altui produs; adresa nouă este adresa
  ocupată, urmată de numele foii și/sau de un număr): N produs/produse” (count only; printed only when N > 0).

### 4.5 Interpretations recorded (local detail, decided)

- "if that is also taken, the existing within-file rule continues with `-2`, `-3`" read as numbering ON the suffixed
  slug: `<slug>-<sheet>-2`. "Taken" there includes the slugs this file plans (else two products of the file could meet).
- A sheet name whose slug is empty (e.g. "—"): nothing to append, so the numbering applies to the taken slug itself
  (`<slug>-2`, first free).
- A style that was numbered within the file (`<slug>-2`) and whose `<slug>-2` is taken gets `<slug>-2-<sheet>`; it then
  appears in both `suffixedSlugs` (final slug) and `crossSheetSuffixed` (`previousSlug` = `<slug>-2`). The admin
  line for `suffixedSlugs` said "got a number at the end", false for that product; reworded in iteration 1 (§ 4.9).
- `slugify(norm(sheet))` instead of `slugify(sheet)`: equal output (slugify lower-cases and folds; `norm` only trims,
  collapses, lower-cases, NFC), and the same form the producer slug uses.

### 4.6 Follow-ups and findings

- **F-SU-1 (data, for the human).** OBSERVED: the real enriched `glamCRM/pl-tools/out/alpod/enriched/ORC-laminate.csv`
  and `ORC-wood.csv` are byte-identical (sha256 `511f…67e6`), and so are the sanitised fixtures. Each plans 8 products
  from 132 rows, so the "8 collisions" are every product of the sheet: after this slice the site holds 8 pairs of
  identical products (same titles, same categories — the collection is the same) at two addresses each. This slice
  fixes the address; it cannot tell whether the two files should differ. Question: is the identical output an
  upstream pl-tools defect (wrong source for one sheet), or are the two sheets truly one product range? If a defect,
  the fix is upstream and one sheet should be re-generated; if one range, importing only one sheet avoids the
  duplicates. No code decision depends on the answer.
- **F-SU-2 (name).** `previousSlug` (ratified in § 2 item 3) means "the slug the product would have had, held by
  another product", not a slug it held before. Kept as ratified; documented on `CrossSheetSuffix`.
- Products already imported with a shared slug before this change are not renamed (non-scope); the next import of
  either sheet moves that sheet's products to suffixed slugs (the other sheet holds the plain slug).
- The audit details do not carry a cross-sheet count (not in scope).

### 4.7 What I could not determine

- NOT RUN: anything against AWS / staging (not this builder's duty; the operator's checklist is below). The handler
  rows run on the in-memory table (`backend/test/unit/memory-table.ts`), not on DynamoDB.
- INFERRED: `slug` is not a DynamoDB reserved word — this file already sends it unescaped in `CARD_PROJECTION` and
  in the category lookup projection, which run in production.
- NOT RUN: the renderer's slug resolution (first match wins) was not re-read; § 1 states it, and no renderer change is
  in scope.

### 4.8 Operator staging checklist (from § 3)

1. Import `ALPOD / ORC-laminate` (dry run, then import). Expect `crossSheetSuffixed: []` unless ORC-wood is already on
   the site.
2. Dry run `ALPOD / ORC-wood`: the report lists 8 products, each `<slug>` → `<slug>-orc-wood`, held by
   `glam:alpod/orc-laminate`. Import: the same 8 in the result.
3. Re-import `ORC-wood` (dry run and import): the same 8 slugs (`crossSheetSuffixed` lists the same 8 again, because
   the plain slugs are still ORC-laminate's).
4. Open each of the 16 addresses. Because the two files are identical (F-SU-1), the two pages of a pair look the same:
   check the product id / `importSource` (admin product list, or the import result's `products[].productId`) to
   confirm that each address opens the product of its own sheet.
5. If ORC-laminate and ORC-wood were both imported BEFORE this deploy, expect the first re-import of either sheet to
   suffix that sheet's 8 products (see § 4.6).

### 4.9 Iteration 1 — review-0 corrections (builder, 2026-10-31)

**R1 — the defect class: a preservation claim wider than what its proof covers.** Rule applied to every such claim:
it states its condition (no product outside this sheet's previous set holds a slug the file plans) and names
cross-sheet allocation as an intended exception; the golden covers only the no-holder case. Places:
`backend/src/import/glam-pricelist.ts` header (two numbered exceptions: `status`, and the slug — with `TenantSlug`
and the CATPROD# `slug` — when an outside product holds a planned slug); `backend/ARCHITECTURE.md` ("every write
equals the base capture … except the intended changes"); `glam/map.ts` `planGlamImport` ("without `applied` AND
without `taken`"; with `taken` and no holder the plan differs only by `crossSheetSuffixed: []`); `glam/group.ts`
`groupStyles` (with `crossSheet` the output differs only where a within-file slug is taken). No code change.

**R2 — the defect class: a description of the new address that promises a literal final component.** Rule: every
description says only what holds on all four allocation paths — the new address is the occupied (planned) address
followed by the sheet's slug and/or a number — and shows the exact old → new address; the exact rule lives once, in
`avoidTakenSlugs`. Places: admin `crossSheetLine` (dry run and import), the existing within-file line (now
`withinFileLine`, "got a number (-2, -3…) … final address", no "at the end"), the MCP count line, and the comments
in `group.ts`, `map.ts`, `glam-pricelist.ts`, `ARCHITECTURE.md`, `tool-shapes.ts` that said "the sheet appended".
Pinned by tests: core `glam-import-core.test.ts:544` drives the four paths — ordinary (`-pl-2`), suffix held
(`-pl-2-2`), empty sheet slug (review-0 witness: sheet "—", `boen-coll-oak` held → `boen-coll-oak-2`), within-file
then sheet (`boen-coll-oak-2-pl-2`) — and checks every entry against the exact form; admin
`GlamPricelistImport.test.ts:783` renders each of the four paths and the combined within-file line and asserts no
"la sfârșit" / "at the end" promise; MCP `tool-shapes.test.ts:130` covers the empty-sheet path. `previousSlug` kept
(ratified). Also fixed: MCP "1 produse" → "1 produs".

## 5. Operator closeout (2026-10-31)

**Relay.** Builder claude-opus-5-5, reviewer gpt-6.1-sol. Cycle 1 `revise` (R1: preservation claims wider than the
golden proves; R2: report copy promised a literal final component). Cycle 2 `approved`. Both findings were wording;
the allocation and handler logic did not change between cycles.

**Gates (operator, on the unchanged candidate; `csu1-gates-iter1.log`).** ALL GREEN: typecheck; shared 197/197; backend
1170 passed + 1 skipped (the golden capture, gated on `CAPTURE_GOLDEN_TO`); admin 133/133; MCP 13/13; `git diff --check`
clean; no change under `renderer/`, `infra/`, `packages/`; the 1a golden and every fixture unchanged; all 13 paths
allocated.

**Staging.** `cdk diff -c stage=staging`: asset-only — `GlamPricelistImportFunc` inside the CatalogApi nested stack, the
admin bundle, and the renderer's rebuilt assets (renderer sources unchanged); 0 resources added or removed, 0 IAM, 0
parameters. Deployed with the explicit staging `NEXT_PUBLIC_*` values; `GlamPricelistImportFunc` updated 13:05:06Z.
Proof on tenant `cm1-catalog`, which held no ORC product before (scan: 0 of 6,522 items), with the real
`out/alpod/enriched/ORC-wood.csv` for both sheets (the two files are identical, § 4.6 F-SU-1):

| Call | Products | Deleted | `crossSheetSuffixed` | Held by |
|---|---|---|---|---|
| ORC-laminate dry run / import | 8 / 8 | 0 / 0 | 0 / 0 | — |
| ORC-wood dry run / import | 8 / 8 | 0 / 0 | 8 / 8 | `glam:alpod/orc-laminate` |
| ORC-wood dry run / re-import | 8 / 8 | 8 / 8 | 8 / 8 | `glam:alpod/orc-laminate` |

Row 2 `…-clever` → `…-clever-orc-wood`; row 18 `…-clever-silent` → `…-clever-silent-orc-wood` (the reviewer's witnesses).
ORC-wood's slugs are identical on re-import; every ORC-wood slug ends `-orc-wood`; 16 distinct slugs over both sheets.
Independent table read (consistent query of `PRODUCT#` items with `importSource` `glam:alpod/orc*`): 16 rows, 16 distinct
`TenantSlug`, 8 per sheet, `TenantSlug == cm1-catalog#<slug>` on every row. Image copy: laminate 90 ingested / 9 failed
(all nine are `Clever Long Silent`'s files, `www.alpod.eu` answers 404 `text/html`), 7 products published; wood 90 cached
(the `MEDIAMAP#` reuse, no second fetch) / 9 failed, 7 published. Pages: 14 of the 16 addresses answer 200; the two 404s
are `…-clever-long-silent` and `…-clever-long-silent-orc-wood`, both `draft` under `cat-image-gate-1` and both listed in
`hiddenWithoutImage` — the image gate, not this slice. Checklist § 4.8 step 5 did not apply (no ORC product before the
deploy).

**Not checked on staging.** The admin report line was not viewed in the browser; its copy is unit-tested
(`GlamPricelistImport.test.ts`) over the same dry-run payload the proof received. MCP was not run against staging
(`tools/mcp-server/.env` targets prod; standing note since 1a); its count line is unit-tested.

**F-SU-1, recorded where it belongs.** The 8 collisions are one raw ALPOD sheet `ORC` fanned out to `ORC-wood` and
`ORC-laminate` by `glamCRM/pl-tools/vendors/alpod.config.mjs:65-68`, under the glamCRM decision PLTOOLS-ORGANIC
(`docs/slices/pl-tools-1.md:988`, recommends WOOD only, never ruled). Recorded in glamCRM `docs/slices/pl-tools-2.md`
§ 11 (commit `8e23b49`). The ruling is the human's; until then only one ORC file should be imported. The slice's rule
stands for any two sheets that share a style name.

**Leftovers on staging.** `cm1-catalog` keeps the 16 ORC products (14 active, 2 draft) and their copied images.

**Abstractions.** None new beyond § 4.3; `withinFileLine` (admin) is a pure function with two users (the report line
and its test), introduced because the admin unit suite has no DOM; the simpler inline JSX could not be tested there.
