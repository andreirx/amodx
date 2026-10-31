# CAT-IMPORT-PROFILE-1A — import profile: backend + shared schema + MCP summary (IMPL record)

Status: **IMPLEMENTED** (2026-10-31) — code complete; review and the operator's staging evidence (§ 12) pending
(`docs/documentation.md` § Status taxonomy). Uncommitted on `main` at `d690a2a` (= `b0a3055` plus the operator's docs-only
correction of the design, § 12 "T3 obligation (2) stated over the guarded fragments"; no code changed between them, so the
golden's base stays `b0a3055`). Cycle 2 (iteration 1): after review-0
`escalate` and the operator's rulings, recorded verbatim in § 14; corrections by defect class in § 15. Iteration 2:
after review-1 `revise` (finish review-0 finding 5), § 16.
Contract: the ratified design `docs/slices/cat-import-profile-1.md` — § 7.1 slice `1a`, § 7.2 oracles, § 7.3 the 1a
golden, § 7.4 the 1a units, § 4.5 — under § 11 (the human's rulings), which wins where § 7 assumed an unratified
recommendation: **CIP1-PROSE = A** (prose unchanged for every import) and **CIP1-VALUE-GUARD = B1 with T3** (the guard
compares on the folded form; four obligations, § 5 below). Maturity: `backend/src/import/glam/profile.ts` enters as
**PROTOTYPE**; it becomes MATURE when the staging evidence of design § 7.5 is recorded for all three producers.
Track F — Glam catalog. Vision tie: guarantee 1 (the profile is one item under `TENANT#<t>`, read with one `GetCommand`
on the full key); guarantee 3 (every profile rule is a pure function of the file and the profile, tested off-target);
"expand before contract" (1a ships inert: with no stored profile every import writes what `b0a3055` writes — proven
against a golden captured from `b0a3055`, § 3).

Evidence labels: **EXECUTED** = a command was run in this session; **OBSERVED** = read in a file; **INFERRED** = a
conclusion, not run. Gate logs and measurement scripts are kept in the relay's gitignored directory
`.agent-manager/slices/CAT-IMPORT-PROFILE-1A/` (`gates/`, `measure/`).

---

## 1. What changed, per step of § 7.1 (file:line on the working tree)

| Step | Change | Where |
|---|---|---|
| 0 | Golden captured from `b0a3055` BEFORE any edit (§ 3) | `backend/test/unit/fixtures/glam/cat-import-profile-1-baseline.json`; helper `backend/test/unit/cat-import-profile-1-golden.ts`; capture `backend/test/unit/cat-import-profile-1-golden.capture.test.ts` (skipped unless `CAPTURE_GOLDEN_TO` is set) |
| shared | `FacetModesSchema`, `SpecKeyRuleSchema`, `GlamImportProfileSchema` — every object `z.strictObject` (§ 3.3 item 1) | `packages/shared/src/index.ts:1014`, `:1025`, `:1031` |
| shared | `ProductSchema.facetModes`, `ProductSchema.importProfileRevision` (positive integer) | `packages/shared/src/index.ts:1131-1132` |
| parse | `parseGlamCsv` also returns `codeCells` (every trimmed non-empty column-2/5 cell of the file; never a `GlamRow` field); the whole-token rule is one exported function used by the same-row removal and by the guard | `backend/src/import/glam/parse.ts:63`, `:80`, `:92`, `:114`; `wholeTokenPattern` `:136` |
| fold | `foldTokens(text) = slugify(norm(text)).split("-")` — the ONE folding function (T3 obligation 1) | `backend/src/import/glam/group.ts:51` |
| profile.ts | new, pure: `checkProfile` `:60`, `readStoredProfile` `:134`, `parseProfileChoice` `:167`, `resolveProfile` `:198`, `profileReport` `:257`, `buildGuard` `:350`, `guardedFragments` `:367`, `guardSpecLine` `:385`, `applyProfileToRows` `:410`, `extractAttributes` `:470`, `analyseSpecKeys` `:557`; `COLUMN_ATTRIBUTE` `:27` (moved from `map.ts`), `DEFAULT_PROFILE` `:35` | `backend/src/import/glam/profile.ts` |
| map | `planGlamImport(rows, upload, applied?)` `:162`: without `applied` the code path is today's; with it — the profile's row rules, extracted attributes after the column attributes `:236`, the stamps, and `plan.profile.refused` `:138`. `GlamStyleDraft` gains `facetModes?` / `importProfileRevision?` `:100` | `backend/src/import/glam/map.ts` |
| handler | `profileChoice` (400) `:130`; early profile read — refuses only — `:166`; under the lock the deciding read `:204`; step `profile` write before the mutation phase `:229`; stamps in `productItem` `:586`; audit `profileRevision` / `profileSource` on profiled imports only `:289` (`auditProfileDetails` `:839`); recovery text after a profile-write failure `:318`; projections `:73`, `:85`; `readProfileItem` `:704`, `writeProfile` `:718`, `isUsable` `:767`, `profileRefusal` `:784`, `storedRevisionOf` `:804`, `dryRunProfile` `:821`, `sheetStates` `:882`, `previewDrafts` `:910`, `siteProductOf` `:923` | `backend/src/import/glam-pricelist.ts` |
| create/update | `facetModes: true, importProfileRevision: true` in the omit lists | `backend/src/products/create.ts:48`, `update.ts:52` |
| MCP | `glamPricelistSummary`: `Profil: …` `:91`, sheets not current `:96`, refused spec lines `:99` (no route change; `routes.json` unchanged) | `tools/mcp-server/src/tool-shapes.ts` |
| tests | `backend/test/unit/glam-profile.test.ts` (new, 448 rows incl. the corpus `it.each` and the three-producer fixture rows; operator-supplied, read-only sanitised fixtures `fixtures/glam/itc/*.csv` (2) and `fixtures/glam/alpod/*.csv` (21), digests checked against `fixtures.sha256`: 23/23 OK), `glam-profile-golden.test.ts` (new, 7), `glam-import-handler.test.ts` (+17 rows; the projection row updated, § 8 D-7), `catalog-mode.test.ts` (+2 ownership rows), `memory-table.ts` (`#revision = :observed`), fixture `fixtures/glam/cat-import-profile-1a-fold-corpus.json`; `packages/shared/test/glam-import-profile.test.ts` (new, 11); `tools/mcp-server/test/tool-shapes.test.ts` (+1) | — |
| docs | `backend/ARCHITECTURE.md`, `packages/shared/ARCHITECTURE.md`, `tools/mcp-server/ARCHITECTURE.md`; this file | — |

**Not changed (CIP1-PROSE = A):** `mapStyle`'s description rule. Proven by the unit "CIP1-PROSE = A: over the BOEN
fixture, a profiled import's prose equals the unprofiled prose for the same rows" (every key extracted, split comma:
`[slug, description, longDescription]` of all 437 drafts deep-equal; 280 products carry spec attributes). EXECUTED.

## 2. Gates (§ 7.2, bare exit codes; iteration-2 logs `.agent-manager/slices/CAT-IMPORT-PROFILE-1A/gates/iter2-*.log`)

All gates were run again in iteration 2, in this order, on a fresh build after the last code change. The results
equal iteration 1's, line for line.

| # | Command | Exit | Last line(s) | Label |
|---|---|---|---|---|
| 1 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run build; echo "exit $?"` | 0 | `> infra@0.1.0 build` / `> tsc` | EXECUTED |
| 2 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run typecheck; echo "exit $?"` | 0 | `> tsc --noEmit` | EXECUTED |
| 3 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/shared" && npm test; echo "exit $?"` | 0 | `Tests  118 passed (118)` | EXECUTED |
| 4 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend" && npm run test:unit; echo "exit $?"` | 0 | `Tests  1133 passed \| 1 skipped (1134)` (the skipped row is the golden capture) | EXECUTED |
| 5 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm test; echo "exit $?"` | 0 | `Tests  138 passed (138)` | EXECUTED |
| 6 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving; echo "exit $?"` | 0 | `# pass 66` / `# fail 0` | EXECUTED |
| 7 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/admin" && npm run test:unit; echo "exit $?"` | 0 | `Tests  65 passed (65)` | EXECUTED |
| 8 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/tools/mcp-server" && npm test; echo "exit $?"` | 0 | `# pass 11` / `# fail 0` (route coverage: `routes.json: 112 routes`) | EXECUTED |
| 9 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/infra" && npm test; echo "exit $?"` | 0 | `Tests: 61 passed, 61 total` | EXECUTED |
| 10 | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check; echo "exit $?"` | 0 | (nothing) | EXECUTED |
| + | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --stat -- renderer admin infra` | 0 | prints nothing | EXECUTED |
| + | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" status --porcelain -uall` | 0 | 47 paths: the 24 of this candidate (§ 1, this record included) and the operator's 23 fixtures; all allocated | EXECUTED |
| + | each untracked file (operator fixtures aside): `git diff --no-index --check /dev/null <file>` | 1 (no whitespace error) | — | EXECUTED |

**Infra synth unchanged — operator evidence (ruling § 14 item 4).** The operator's staging `cdk diff` on this candidate,
`.agent-manager/slices/CAT-IMPORT-PROFILE-1A/operator/cdk-diff-staging-iter0.log`: nothing added or removed; 41 functions
change `Code`/`Metadata` only (they bundle `packages/shared`); admin/renderer assets redeploy; no route, permission,
environment or policy change. Builder check of that log (EXECUTED, `grep`): 0 top-level `[+]`/`[-]` resources; modified:
41 `AWS::Lambda::Function` (properties `Code` 41, `Metadata` 41), 3 nested `AWS::CloudFormation::Stack` (`TemplateURL`),
2 `Custom::CDKBucketDeployment` (`SourceObjectKeys`), 1 `Custom::AWS` (`Create`/`Update`) — asset redeploys. The
operator repeats the diff at closeout on the final candidate. Gate 9 (a real `cdk synth`) prints, in this iteration,
`AmodxStack(parent)=401/53fn, CatalogApi=45/15fn, CommerceApi=221/36fn, EngagementApi=89/14fn`. The builder's own
attempt to synth `b0a3055` in a worktree (iteration 0) failed for an environment reason (Turbopack cannot resolve `next`
through symlinked `node_modules`; `gates/CAT-IMPORT-PROFILE-1A-infra-base.log`) and is superseded by the operator's diff.

## 3. The 1a golden (§ 7.3)

- Base commit: `b0a3055c703bc4b308aca6a736a4521e05508795`. Worktree `/tmp/CAT-IMPORT-PROFILE-1A-baseline`, created
  before any edit, removed afterwards (EXECUTED).
- File `backend/test/unit/fixtures/glam/cat-import-profile-1-baseline.json`, 4,460,810 bytes, compact JSON,
  **sha256 `c818dd412d6023a50f317fa60badfb666f23955f288bd862abe2024d86981a1d`**.
- Helper `cat-import-profile-1-golden.ts` sha256 `8bd709dae25471c9a6c288af53df3b5d3c8cd30001c42f2ad920dfd33825e88f`
  (unchanged since the capture; the comparison imports the same steps).
- Inputs: the BOEN fixture; `synthetic-mixed` (duplicates, empty labels, quoted commas in name and format, a same-row
  code line, a cross-row code line, a `Price: 25 EUR` line, skipped rows, a slug collision, two collections, a
  hand-made product and another sheet's product); `synthetic-no-product`. Per input: the plan, then a dry run, an
  execution and a re-execution — each with status, response body, every write command's payload in order, and the
  audit calls. UUIDs → `<uuid-n>`, ISO stamps → `<ts-n>` in order of first appearance; the clock is fixed.
- **Reproducibility finding:** the first capture was not reproducible (two runs gave different sha256): the
  reconciliation's write order follows the sort order of random product ids (`CATPROD#<c>#<id>`). The capture and the
  comparison therefore replace `crypto.randomUUID` with a counter (creation order = sort order). Two captures then gave
  the same sha256 (EXECUTED).
- Comparison `backend/test/unit/glam-profile-golden.test.ts`: for each input, (a) no `profileChoice` and (b)
  `profileChoice = DEFAULT_PROFILE`, `baseRevision: null` — plan, write history, audit and response equal the golden
  after removing ONLY the added members (`profile`, `sheets`, `specKeys`, `drafts`, `siteProducts`,
  `specLineRefusals`); no `IMPORTPROFILE#` item; no product stamp. **7/7 pass** (EXECUTED).
- Positive control: `sortOrder: 0` → `1` in `productItem` made 4 of 7 rows fail (the two no-product rows write nothing
  and stay green, correctly); restored → 7/7 (EXECUTED).
- `cat-import-1-expected-counts.json` unchanged (OBSERVED, not in `git status`).

## 4. The § 4.5 oracles

| Oracle | Result | Label |
|---|---|---|
| O-CODES-1 `grep -n -E '(:\|\[\|,)[[:space:]]*(2\|3\|4\|5)[[:space:]]*(,\|\]\|\))' backend/src/import/glam/parse.ts` | exactly `32: codeOld: 2,`, `33: codeNew: 5,`, `37: export const NEVER_READ_COLUMNS = [3, 4] as const;` | EXECUTED |
| O-CODES-2 `grep -n "parseCsvRecords\|cells\[" "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend/src/import/glam/profile.ts"; echo "exit $?"` | `exit 1`, nothing else | EXECUTED |
| O-CODES-3 BOEN, worst-case profile (every key an attribute, split comma) | handler row: 437 products, 280 with spec attributes, `codeHits(write history, 801 codes) = []`; positive control finds a planted code; plan-level row as well | EXECUTED |
| O-CODES-4 cross-row code `AAA-1` in `Alternate article` | no attribute; refusal `{ key: "Alternate article", rowIndex: 3, reason: "code" }`; no `AAA-1` outside image fields in the written payloads (handler) and drafts (core) | EXECUTED |
| O-CODES-5 cross-row code as the collection | row 3 → sheet name; no category or slug holds `aaa-1` | EXECUTED |
| O-PRICES-1 no monetary key | worst-case BOEN: no `price`/`salePrice`/`volumePricing`/`personalizations`/`sku` on any written product, none on projections; the key-set unit: a profiled draft gains exactly `facetModes`, `importProfileRevision` | EXECUTED |
| O-PRICES-2 `Price: 25 EUR`, `Cost: 12 lei`, `Finish: €` | no attribute; three refusals `money`; `Wood: Oak` written | EXECUTED |
| O-PRICES-3 collection from `Price: 25 EUR` | category = sheet `S`; no `25`/`eur` in categories, slugs, attributes; control `Collection: Delight` → `Delight` | EXECUTED |
| O-PRICES-4 `Price: 25` (and `Price:25`) | refused as attribute and as collection; `Pricey look: yes` kept | EXECUTED |
| O-TRANSFORM-1/2 | superseded by ruling T3: both witnesses are now REFUSAL rows (§ 5 (3)), not pinned exclusions | EXECUTED |
| O-VALUE-1 substring | all three producers' fixtures (ruling § 14 item 3), worst-case profile per file (every key an attribute, split comma): every spec attribute value is a substring of a line of one row of its style; 0 refusals. ITC 2 files / 576 products / 3,099 values; BOEN 1 / 437 / 4,274; ALPOD 21 / 915 / 1,328 — equal to review-0's independent replay | EXECUTED |
| false-refusal regression | the same rows assert 0 guard refusals (split none and comma) over every spec line: ITC 3,113, BOEN 3,837, ALPOD 3,726 | EXECUTED |

## 5. T3 obligations (ruling CIP1-VALUE-GUARD = B1 with T3; obligation (2) as ruled on review-0, § 14 item 1)

**How the guard works** (`guardSpecLine`, `profile.ts:385`). A selected line is refused for `code` when the NFC line
holds a code cell of ANY row of the file as a whole token, case-sensitive (B1, the `removeCodeLines` rule), or when the
folded line or one of its folded GUARDED FRAGMENTS holds a folded code cell as whole tokens (T3). It is refused for
`money` when the NFC, lower-cased line holds `€ $ £`, or a currency code / price word as a whole token (B1), or when the
folded line or a folded fragment holds a folded money word (T3). The guarded fragments (`guardedFragments`,
`profile.ts:367`) are exactly the ruled ones: the line's key, its value and — with `split: "comma"` — the value's list
parts. The whole line is folded in addition (stricter than the ruling; it can only add refusals; 0 false refusals on the
real data, (4)). B1 and T3 both run: the folded check is not a superset of the unfolded one (`x.AAA-1` folds to
`xaaa-1`, which does not hold the folded code `aaa-1`, but the unfolded check finds it).

**Obligation (2) — the packet's first wording was unsatisfiable.** It said "every token of the derived identifier is a
token of the folded source line". `slugify` DELETES punctuation, so the whole line `Collection:Oak` folds to the one
token `collectionoak`, while the identifier is computed from the value `Oak` (token `oak`). Review-0 reproduced this.
The operator replaced the wording (§ 14 item 1). **No test in this candidate is claimed to satisfy the first wording.**

| # | Obligation | Evidence | Label |
|---|---|---|---|
| (1) | one folding function, derived from `slugify`; a corpus test fails if they disagree on token boundaries | `foldTokens = slugify ∘ norm` split on `-` (`group.ts:51`). Corpus: 58 real spec lines, one per value class of the three producers' files (`fixtures/glam/cat-import-profile-1a-fold-corpus.json`, extracted by `measure/t3-measure.mts`), plus 17 witnesses; each line, key, value and comma part asserts: fold tokens join to `slugify(norm(s))`; `slugify(norm(s)) === slugify(s)`; `slugify(norm(p) + " " + norm(s))` tokens = fold(p) ++ fold(s) for p ∈ {BOEN, ITC, ALPOD, Prod X} | EXECUTED (unit, pass) |
| (2) as ruled | every token of every identifier derived from a checked spec line is a token of one of that line's guarded fragments (folded key, folded value — or the folded value's list parts when splitting applies) | Unit `derivedViolations` (`glam-profile.test.ts`, block "T3 (2) as ruled") over the corpus + 17 witnesses + `Collection:Oak`, × 4 producer names. Fields asserted: category name (equals the value; its fold tokens ⊆ fragments), category slug's collection tokens, `colecție` value, product slug's collection part (collection = spec); attribute value, split none and comma (its fold IS a fragment's fold); attribute key when the label is the file's key as written (the § 6.1 proposal). 0 violations. Reviewer's witness `Collection:Oak` (no space): kept; `guardedFragments` = `["Collection", "Oak"]`; `oak` ∈ folded value fragment; slugs `p-oak`, `p-oak-name`. Over EVERY spec line of the three producers' real files with the ruled fragments: **10,676 lines, 0 violations** (`measure/t3-obligation2-real.mts` → `t3-obligation2-real.iter1.out`) | EXECUTED |
| (3) | refusal rows `Collection: Cóst`; `Collection: ABC` with a same-file code `abc` | both refused (`money`, `code`), the row takes the sheet name, slug `p-s`; the unit also shows the unfolded check alone keeps both | EXECUTED |
| (4) | false-refusal count of the folded check on the three producers' real files | **0** — ITC 3,113 lines (0 code cells), BOEN 3,837 (801 code cells), ALPOD 3,726 (21 files, 1,404 code cells), each with split none and comma; § 4.4 measured 0 unfolded (`measure/t3-measure.iter1.out`), and as a regression row over the checked-in fixtures (§ 4). BOEN 3,837 vs § 4.4's 3,848: the 11 empty-value lines (`Appearance:` 5, `Style:` 6) give no value, so they are not spec lines here | EXECUTED |

**Attribute keys and labels (§ 14 item 2).** Profile labels are author input, not guarded; they carry no file value.
An attribute rule must have a label (the schema refuses a rule without one — unit row), so no attribute key is derived
from a spec line except a label the author typed equal to the file's key; that case is covered by (2) above.
**Other parts outside the guard, as § 4.3 and the ruling state:** the slug suffix `-<n>` of a slug collision (a builder
token, from no source); column-derived parts (producer, name, the token `trailing-number` removes, column 0 under
`collection: column`, column-11 labels); the prose.

## 6. Abstraction one-liners (what · current users · axis · rejected simpler alternative)

- `GlamImportProfileSchema` / `SpecKeyRuleSchema` / `FacetModesSchema` (shared zod) · handler (request + stored item), `ProductSchema`, the shared tests; admin editor in 1c · a documented boundary crossed (admin ↔ API ↔ MCP, stored); sum types `grouping`, `collection`, `SpecKeyRule` dispatched by exhaustive `switch` + `assertNever` (variants fixed, operations growing) · untyped JSON per caller.
- `backend/src/import/glam/profile.ts` · `map.ts`, the handler, the unit tests · no axis — the slice's pure core next to `parse.ts`/`group.ts`/`map.ts` (the golden and the oracles need the profile step as one seam) · rules inline in `group.ts`/`map.ts`.
- `ProfileResolution` / `StoredProfile` (sums) · the handler (both reads, refusal, plan, report) · variants fixed (none / supported / unsupported; unprofiled / stored / save / unsupported / changed), exhaustive matches · a boolean `profiled` plus nullable revision fields (a defect-shaped type).
- `AppliedProfile` (parameter DTO of `planGlamImport`) · the handler, the tests · absent = today's code path (the golden proves it) · a profile argument always present with `DEFAULT_PROFILE` meaning "unprofiled" (it cannot say "stamp nothing").
- `SpecLineGuard` (code cells prepared once per file) · `planGlamImport`, `analyseSpecKeys` · none — performance (801 code cells × 3,837 lines) · re-building patterns per line.
- `foldTokens` · `guardSpecLine`, the corpus tests · none — T3 obligation (1) requires ONE folding derived from `slugify` · a second normaliser.
- `wholeTokenPattern` (exported from `parse.ts`) · `removeCodeLines`, `buildGuard` · none — one whole-token rule for the same-row removal and the file-wide check · a copy of the regex.
- No interface, registry, adapter or config layer. Helpers with no external user were made module-private
  (`canonicalJson`, `sameProfile`, `parseSpecLine`).

## 7. New admin-visible and MCP strings (copy)

- 400: `profileChoice is not valid: <path>: <message>; …` · `The import profile is not valid: <checkProfile error>`
- `checkProfile`: `The spec key "<k>" is empty or has leading or trailing spaces.` · `The spec key "<k>" is listed twice.` ·
  `The label of "<k>" is empty or has leading or trailing spaces.` · `The label "<l>" of "<k>" is the name of a column attribute; choose another label.` ·
  `The collection spec key is empty or has leading or trailing spaces.` · `The spec key "<k>" is the collection source; it cannot also be in the key list.` ·
  `The filter-mode key "<k>" is empty or has leading or trailing spaces.` · `The filter mode of "<k>" is set twice.`
- 409 unsupported: `The stored import profile of <producer> (revision <r>) uses settings this importer cannot apply: <reason>. Nothing was changed. To replace it, import with a profile this importer supports and baseRevision <r>.`
- 409 changed: `The import profile of <producer> was changed by another import since you loaded it (stored revision <s|none>, loaded <b|none>). Nothing was changed. Load the stored profile, preview again and import.`
- 500 recovery after a profile-write failure: `No product or category was changed; the profile may have been saved. Import the same file again with the same profile.`
- MCP summary: `Profil: <source>, revizia <n>` / `Profil: <source>, fără revizie` (+ ` — <reason>` when unsupported) ·
  `Sheets not current (import them again): <importSource> <state> [<revisions>], …` · `Spec lines refused by the value guard: row <n> <key> (<reason>), …`

## 8. Builder decisions and deviations (local, recorded)

- D-1 `codeCells` instead of the design's `codeTokens`: the member holds the file's code CELLS; each is matched as a whole token. Name follows the contract.
- D-2 The stored profile is read twice in an execution: before the lock only to refuse early (409 / 400 with nothing written — the existing "no product row → nothing written" row stays true), and under the lock to decide (rule `cat-import-1.md` § 8.11 R1 kept). A profile changed between the two reads is seen under the lock (unit row).
- D-3 A dry run applies an explicit choice without the acceptance rule (it writes nothing; the execution decides). Its `profile` member carries `stored: { kind, revision[, reason] }` next to an explicit choice, so the admin (1c) can show an unsupported or newer stored profile (§ 3.3 item 5).
- D-4 Refused spec lines are a response member `specLineRefusals` (dry run and execution, profiled plans only) besides the dry run's `specKeys[].refused`; the line is never echoed (stricter than § 4.3 item 3, which forbids echo only for `code`).
- D-5 **Operator-approved deviation from design § 3.5 (§ 14 item 5).** `sheets[]` carries `importSource` (the normalised sheet id), not a display sheet: products imported before 1a carry only the normalised `importSource`, so the original spelling cannot be recovered. Admin-only cosmetic. States: `no-profile` none stamped; `current`/`stale` all stamped with one revision equal / not equal to the stored one; `mixed` otherwise.
- D-6 `checkProfile` refuses keys/labels with leading or trailing spaces (no hidden trimming); labels are compared with column keys by `norm` (so `Colecție` is refused too). For a collection `spec` key, the row's FIRST line with that key is used.
- D-7 The existing row "the previous-set read is a strongly consistent PRODUCT# query" pinned the projection string; the projection gains `importProfileRevision` (design § 3.4), so the expected string was updated. The row's name still states what it proves. The dry run reads more fields, through `#f<n>` name placeholders (`status` is a DynamoDB reserved word).
- D-8 `COLUMN_ATTRIBUTE` moved from `map.ts` to `profile.ts` (same values): `checkProfile` needs them and `map.ts` imports `profile.ts`; keeping them in `map.ts` would make a module cycle.
- D-9 Audit `details` gain `profileRevision` / `profileSource` only on profiled imports, so an unprofiled import's audit equals the golden.
- D-10 Golden fixture stored as compact JSON (4.46 MB; pretty-printed it was 6.9 MB).
- D-11 The MCP summary also lists refused spec lines (one line, only when there are some): an MCP import has no dry-run table to show them. Additive to the two items § 6.4 names.
- D-12 Handler profile rows were added to `glam-import-handler.test.ts` (reusing its harness), as § 7.1 names.
- D-13 Exhaustive dispatch (§ 14 item 6): every decision on a profile sum type is an exhaustive `switch` with `assertNever` / a `never` default (§ 15 item 3 lists the sites).

## 9. Findings outside this slice (named, not fixed)

- **F-1A-1 (pre-existing, direct API callers only):** `ProductSchema.omit(...).partial()` in `products/update.ts` still applies every `.default()` in zod 4 (EXECUTED: `z.object({a: z.array(z.string()).default([]), s: z.string().default("draft")}).partial().parse({})` → `{"a":[],"s":"draft"}`). So a direct `PUT /products/{id}` request with a PARTIAL body resets `status` to `draft`, `variants`, `tags`, `attributes`, … to their defaults. On an imported product this answers 400 ("exactly one variant group (found 0)"); on a hand-made product it silently resets fields. Scope corrected after review-0: the MCP `update_product` tool already compensates — it reads the stored product, merges the sent keys and sends the full product (`tools/mcp-server/src/index.ts:1089`, OBSERVED). Not changed here (outside allocation); the admin editor sends full bodies (INFERRED, not checked).
- F-1A-2: the analysis restates the renderer's repeat rule (`MIN_HOLDERS`, `MAX_ATTRIBUTE_VALUES`, `profile.ts:517-518`) — duplication until 1b moves `facets.ts` to `packages/shared`.

## 10. Follow-ups

- FU-1 (1b) import the repeat-rule constants from the shared facet module; remove the restatement (F-1A-2).
- FU-2 (1b/1c) the renderer precedence (N2), the joined product-page row, the admin editor/proposal/preview — per design § 7.1.
- FU-3 closed by ruling § 14 item 2: profile labels are author input, not guarded; no label check is added.
- FU-4 F-1A-1 above.
- FU-5 the response size of a dry run with `drafts` + `siteProducts` on the real tenant (staging item 8 below).

## 11. Not determined

- The final candidate's `cdk diff` (the operator repeats it at closeout; § 2 cites the iteration-0 diff).
- Whether DynamoDB accepts the dry-run projection and the `#revision = :observed` condition exactly as the in-memory table does — the in-memory table implements the forms the handler sends; real DynamoDB runs on staging (§ 12).
- The real response size and wall time of a dry run on a tenant with all three producers.

## 12. Staging checklist for 1a (design § 7.5 restated; operator-run, tenant `cm1-catalog`)

1. **(item 1)** BOEN `PL.csv` without a profile, dry run then execution → the report equals `cat-import-1.md` § 10 (437 products / 455 options / 23 deduped / 0 skipped); `aws dynamodb get-item` on `TENANT#<t>` / `IMPORTPROFILE#glam#boen` → no item; a `PRODUCT#` query projecting `importProfileRevision, facetModes` → no product carries either.
2. **(item 5)** MCP `import_glam_pricelist` dry run for BOEN → the summary has `Profil: default, fără revizie` while none is stored. `stored, revizia <n>` needs a stored profile, which only an execution with a `profileChoice` writes — and only the admin (1c) sends one; before 1c the operator may store one by an API call with `profileChoice` (a write to the staging tenant: the operator's choice). Counts equal the admin's.
3. **(item 8)** Record the response size of the largest dry run (an ALPOD sheet on a tenant holding all three producers); the Lambda response limit is 6 MB.

Later slices: items 2, 3, 4, 6 need the human's profiles through the admin (1c) and the renderer precedence (1b); item 7
(Layer 2 byte identity) belongs to 1b, which changes the renderer.

## 13. Iteration history of the gates

Iteration 0 ran gates 1–10 (all exit 0) and, after three helpers were made module-private, re-ran build, typecheck,
backend units, MCP and `diff --check` (logs `gates/rerun-*.log`). Iteration 1 re-ran every gate after its code changes
(logs `gates/iter1-*.log`), plus O-CODES-1/2 (`gates/iter1-ocodes12.log`). Iteration 2 re-ran every gate after its
code changes (§ 2, logs `gates/iter2-*.log`), plus O-CODES-1/2 (`gates/iter2-ocodes12.log`).

## 14. Operator rulings on review-0 (verbatim, operator, 2026-10-31, binding)

1. **T3 obligation (2) — corrected wording (operator defect in the packet).** The packet said "every token of the
   derived identifier is a token of the folded source line". That wording is unsatisfiable for harmless input: the
   whole line `Collection:Oak` folds to the single token `collectionoak`. The guard examines the line's KEY and its
   VALUE as separate fragments, and the safety property the human ratified (§ 11: no derived identifier holds a folded
   same-file code token or a folded money token) follows from: **every token of every identifier derived from a
   checked spec line is a token of one of that line's guarded fragments (folded key, folded value — or the folded
   value's list parts when splitting applies).** Obligation (2) is replaced by that statement. Keep your fragment
   tests; make them assert exactly this for every derived field the packet lists (attribute key when no label is
   given, attribute value, category name, category slug, `colecție` value, the product-slug part), and add the
   reviewer's witness `Collection:Oak` (no space) → kept, `oak` ∈ folded value fragment.
2. **Labels are outside the guard, stated.** A Romanian label is typed by a person in the profile; it is not taken
   from the file. NO-CODES / NO-PRICES protects file data, and every file VALUE passes the guard. The record states:
   "profile labels are author input, not guarded; they carry no file value" — no label check is added.
3. **O-VALUE-1 for ITC and ALPOD.** The operator added sanitised fixtures (price columns 3–4 blanked, codes kept):
   `backend/test/unit/fixtures/glam/itc/*.csv` (2 files) and `backend/test/unit/fixtures/glam/alpod/*.csv` (21 files),
   sha256 in `.agent-manager/slices/CAT-IMPORT-PROFILE-1A/fixtures.sha256` — read-only. Add the O-VALUE-1 rows over
   them as for BOEN, plus the false-refusal count = 0 on all three as a regression row.
4. **"infra synth unchanged" — operator evidence.** `.agent-manager/slices/CAT-IMPORT-PROFILE-1A/operator/
   cdk-diff-staging-iter0.log` (staging `cdk diff` on this candidate): nothing added or removed; 41 functions change
   `Code`/`Metadata` only (they bundle `packages/shared`); admin/renderer assets redeploy; no route, permission,
   environment or policy change. Cite it; the operator repeats the diff at closeout on the final candidate.
5. **D-5 sheet display — approved.** `sheets[]` shows the normalised sheet id; products imported before 1a carry only
   the normalised `importSource`, so the original spelling cannot be recovered. Admin-only cosmetic. Record it as an
   operator-approved deviation from § 3.5.
6. **Exhaustive dispatch.** As review-0 finding 5: exhaustive switches with `assertNever` at `profile.ts:447`, `:535`
   and every sibling policy dispatch on a profile sum type.
All oracles again, fresh logs; update the record (and do not describe any earlier test as satisfying the original
obligation (2)).

## 15. Iteration 1 — corrections by defect class

1. **A proof obligation stated against a form the identifiers are not computed from** (review-0 finding 1). Rule: the
   obligation and its tests name the exact strings an identifier is computed from — the line's guarded fragments. Done:
   `guardedFragments` now returns exactly the ruled fragments (key, value, list parts); the guard folds the whole line in
   addition; the tests assert token membership in those fragments for every listed field, add `Collection:Oak`, and
   cover the attribute key when the label equals the file key; the real-file replay was re-run with the ruled
   fragments (0 violations on 10,676 lines). The iteration-0 text of § 5 that called this a "deviation within the
   ruling's intent" is removed.
2. **Regression coverage that exists only for one of the producers it claims** (finding 2). Rule: every per-producer
   oracle runs over a checked-in fixture of each producer. Done: one `describe.each` over ITC, BOEN and ALPOD runs
   O-VALUE-1 and the 0-false-refusal row on every file; the BOEN-only O-VALUE-1 row is replaced by it.
3. **A policy decision on a sum type taken by an `===` test or a ternary** (finding 5). Rule: every decision on a
   profile sum type is an exhaustive `switch` whose default is `assertNever` (or a `never` assignment). Sites converted:
   `profile.ts` — `profileReport` (both `source` unions), `guardedFragments` (`Split`), `applyProfileToRows` (grouping
   `label`), `extractAttributes` (`SpecKeyRule.action`, the review's `:447`), `analyseSpecKeys` `ruleOf` (`collection`)
   and `splitOf` (`SpecKeyRuleReport`, the review's `:535`); `glam-pricelist.ts` — the dry run's resolution view
   (`dryRunProfile`), the profile-write step, the audit details (`auditProfileDetails`) and `storedRevisionOf`.
   **Correction (review-1):** iteration 1 claimed a grep found no dispatch left "on profile sums". That claim was too
   wide: the grep covered the profile's input and resolution unions only, not the profile-owned RESULT unions
   (`ProfileChoiceParse`, `ProfileCheck`, `GuardResult`) and the import mode. Those sites are closed in iteration 2
   (§ 16).
4. **Evidence obligations met by inference** (findings 3, 4): resolved by the operator's rulings (§ 14 items 4, 5);
   cited in § 2 and D-5.
5. **A finding scoped wider than the code shows** (review-0 record correction): F-1A-1 is now scoped to direct
   partial `PUT` requests; MCP `update_product` merges first.

## 16. Iteration 2 — review-1 `revise`: finish finding 5 (exhaustive dispatch)

**Defect class:** a decision on a profile-owned union taken by an `===` test, a ternary or an `if`/`else`, so a new
variant falls into an existing branch without a compiler error (review-1 reproduced it: a fourth `ProfileChoiceParse`
variant gave zero diagnostics). **Rule (the same as § 15 item 3, now applied to every profile-owned union — inputs,
results and modes):** every decision on a union that `profile.ts` defines or that the handler builds from it is an
exhaustive `switch` with one case per variant and an `assertNever` / `never` default. Pre-existing unions outside this
slice (`checkUpload`, `parseGlamCsv`, `parseCsvRecords`, `checkProductWrite`, the route dispatch) are not changed, as
review-1 directs.

Sites converted (file:line on the working tree):

| Union | Site |
|---|---|
| `ProfileChoiceParse` | `glam-pricelist.ts:130-140` (`absent` → no choice, `accepted` → the choice, `refused` → 400) |
| `ProfileCheck` | `profile.ts` `readStoredProfile` (`:134`), `parseProfileChoice` (`:167`) |
| import mode `"dry-run" \| "execution"` | `profile.ts` `resolveProfile` `accepts` (`:198`) |
| `GuardResult` | `profile.ts` `applyProfileToRows` collection (`:410`), `extractAttributes` (`:470`), `analyseSpecKeys` (`:557`) |

**Compiler probe (EXECUTED; log `gates/iter2-exhaustiveness-probe.log`).** In a temporary state (`profile.ts` backed up
to `/tmp/CAT-IMPORT-PROFILE-1A-probe`, restored, the directory removed) a fourth variant `probe` was added to
`ProfileCheck`, `ProfileChoiceParse`, `GuardResult` and the mode parameter. `tsc --noEmit` exited 2 with exactly 7
diagnostics, one at each converted site: `glam-pricelist.ts(137)` TS2322; `profile.ts(146)`, `(176)`, `(213)`,
`(451)`, `(496)`, `(614)` TS2345. After the restore, `tsc --noEmit` is clean. A grep for `choiceParse.kind ===`,
`check.kind ===`, `verdict.kind ===` and `mode ===` in `glam/*.ts` and `glam-pricelist.ts` finds only
`glam-pricelist.ts` `productItem`'s `checkProductWrite` result (`lib/catalog-product.ts`'s `ProductWriteCheck`, a
pre-existing union outside this slice).

Gates: all re-run, all exit 0 (§ 2). No behaviour change: backend units 1,133 passed (the same count as iteration 1);
golden 7/7 inside them.

## 17. Operator closeout (operator, 2026-10-31)

**Review.** review-0 escalate (the operator's T3 obligation-(2) wording, labels, ITC/ALPOD coverage, infra evidence,
sheet display, exhaustive dispatch → rulings § 14; design § 12 correction `d690a2a`), review-1 revise (finish
exhaustive dispatch), review-2 **approved**. Builder claude-opus-5-5, reviewer codex gpt-6.1-sol.

**Gates (operator, approved candidate, bare exit codes, `ALL GATES GREEN`).** build 0; typecheck 0; `packages/shared`
118; backend unit 1,133 passed + 1 skipped (the golden capture, runs only with `CAPTURE_GOLDEN_TO`); renderer unit 138;
`test:serving` 66 / 0; admin 65; MCP 11 / 0; infra 61; `git diff --check` 0; operator fixtures 23/23 sha256 OK; no change
under `renderer admin infra`; every changed path inside the allocation.

**Staging CDK diff and deploy (final candidate).** 0 resources added or removed; 41 functions change `Code`/`Metadata`
only (they bundle `packages/shared`); admin and renderer assets redeploy. `cdk deploy` → `AmodxStack-staging` ✅.

**Staging checklist (§ 12), tenant `cm1-catalog`.**
1. BOEN `PL.csv` without a profile: dry run (5.9 s), import (11.3 s), re-import (10.3 s), all 200; counts
   437 / 455 / 23 deduped / 0 skipped on all three = `cat-import-1.md` § 10; `profile.source = "default"`, no
   revision; `IMPORTPROFILE#glam#boen` absent; 0 of 441 products carry `importProfileRevision` or `facetModes`.
2. MCP dry run: **NOT RUN** — the operator machine's MCP configuration (`tools/mcp-server/.env`) targets the PROD API;
   the summary line is covered by `tools/mcp-server/test/tool-shapes.test.ts`. A staging run needs a staging service
   key; it becomes meaningful after `1c` stores a profile.
3. Dry-run response sizes: BOEN 874,250 B (437 drafts + the tenant's 441 products); ALPOD `AUR` 249,603 B (7 drafts).
   The three-producer tenant was not available on staging (it holds BOEN + 2 ALPOD products); INFERRED from these
   sizes: well under the 6 MB Lambda response limit for 1,928 products — measure again when staging holds all three.

1a ships inert: with no stored profile every import writes what `b0a3055` writes (golden) — safe to deploy to prod
before `1b`/`1c`.
