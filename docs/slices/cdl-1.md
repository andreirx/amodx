# CDL-1 — catalog labels: site or file labels at import, interest list, mail (implementation record)

Status: **BUILT** (2026-11-15, builder iteration 2, after review-0 and the operator rulings CDL1-RENDERER-COVERAGE = A
and CDL1-SKIP-TAG-ORACLE = A), uncommitted, awaiting review. Start: `main` at `5d4f764`, tree clean. All 12 oracles of
the packet's § 5 pass on the final tree (§ 9): oracle 7a `renderer` `npm test` exit 0, 420 / 420, with the one ruled
renderer path `renderer/test/serving-contract/locale-1/cdl-1/coverage.json`. Iteration 2 also closes the three
review-0 corrections (§ 12).
Design: `docs/slices/catalog-data-labels-1.md` (RATIFIED, § 9), row `cdl-1` of § 10. Track: catalog.
Maturity: the nine pack keys, `catalogServerTexts` and the `importLabels` marker are **PROTOTYPE**; they become MATURE
after the staging run of design § 8.4 (operator).

## 1. The ruling (design § 9, quoted)

> The human ruled "GO. yes on point 5" on the operator's six points.
> 1. **The labels live in the admin.** The Labels page has a card "Import labels": Collection, Unit, Packaging,
>    Minimum order, Default option name. The defaults come from the site language pack (ro / en); the owner can change
>    them (§ 3.1, § 4.9).
> 2. **At import the preview offers a choice, not a warning.** […] The preview shows the two sets side by side: "Use the
>    site labels" (default) and "Use this file's labels", with the line "Products of this list get their own filters,
>    separate from other lists." The request carries the choice; the importer writes the chosen labels. An empty header
>    cell takes the site label of its column. The MCP tool passes the choice as an optional argument (§ 4.2, § 4.3).
> 3. **When labels change later**, the preview names the other lists that still hold other labels. Nothing blocks. No
>    facet merge (§ 5.3).
> 4. **Interest list.** The reader finds the collection through the label set each product stores (`importLabels`). The
>    mail to the site owner is in the site language. The admin submissions table shows fixed English headers for this
>    system form (§ 6).
> 6. **English words:** `Collection`, `Unit`, `Packaging`, `Minimum order`, `Option`, and the mail texts of § 3.1.

Point 5 (paths) is `cdl-2`. Operator ruling in the packet: a malformed `importLabels` is read as absent.

## 2. What changed (file:line at the end of the build)

**Step 2 — shared.**
- `packages/shared/src/index.ts:953` nine catalog keys (`import*`, `interestMail*`) after the quote keys;
  `:1423` `ImportLabelsSchema` (strict, four non-empty strings) + `ImportLabels`; `:1437` `IMPORT_LABELS_WITHOUT_MARKER`;
  `:1532` `ProductSchema.importLabels` (optional); the `InterestResolution` comment follows the new reader.
- `packages/shared/src/locale-strings.ts:265` `catalogServerTexts(resolved)` → `{ siteLabels, variantName, interestMail }`,
  every text non-empty (blank override → language default; non-blank used trimmed).
- `language-packs/en.ts:264`, `ro.ts:255` the nine values (RO byte-equal to today's literals, `ț` = U+021B).

**Step 3 — backend core (pure).**
- `glam/parse.ts:85`, `:105` `GlamParseResult.headerLabels` = header cells 0/6/7/8 in display form ("" when empty or absent).
- `glam/map.ts:26` `GlamUpload.variantName?` (present only when the request gave a non-blank name; `:54` no default);
  `DEFAULT_VARIANT_NAME`, the `ATTRIBUTE` alias and the `COLUMN_ATTRIBUTE` import removed; `:233`
  `planGlamImport(rows, upload, labels, defaultVariantName, applied?, taken?)` — plan `variantName`, an empty label or
  name throws (internal fault); `:337` attributes under `labels.*`; `:359` `differing` names the chosen labels (keeps
  `specificații tehnice`); `:383` every draft carries `importLabels`.
- `glam/profile.ts` `COLUMN_ATTRIBUTE` removed; `:50` `checkProfile(profile, labels)`; `:140`
  `readStoredProfile(item, labels)`; `:177` `parseProfileChoice` checks the shape only.

**Step 4 — handler** (`backend/src/import/glam-pricelist.ts`).
- `:162` comment: only the SHAPE of `profileChoice` is checked before any read; its other rules run at `:234`.
- `:176` body `labels`: absent → "site"; "site"/"file"; other → 400 before any read.
- `:201` step `labels-read`: one consistent `GetCommand` `SYSTEM`/`TENANT#<id>`, projection `#l, catalogStrings`;
  `catalogServerTexts(resolveLocaleStrings(...))`; file set = header cell, else site label of the column; chosen set.
- `:226` label check (§ 3.4): two chosen labels equal after `norm` → 400 with the § 3.4 message and `labels`; dry run too.
- `:234` an explicit `profileChoice` is checked with the chosen labels (400, message unchanged).
- stored profile read with the chosen labels (unsupported → today's 409); `planFor` passes the chosen set and the
  site's default option name for both choices.
- `:269` dry run answers `labels` and `otherLabels`; `:392` the execution answer (200, 503) answers `labels`.
- `:286` comment: two tenant settings are read before the lock — the mode and (CDL-1) the language and catalog texts;
  a Labels page edit made while an import runs takes effect at the next import (design § 4.1 places the read there).
- `:112` `importLabels` added to the dry run's projection; `:685` every PRODUCT item stores `importLabels`;
  `:783` report `variantName` = the plan's; `:1041` `otherLabelsOf`.
- `backend/src/products/create.ts:49`, `update.ts:52`: `importLabels: true` in the omit lists, comments extended.

**Step 5 — interest** (`backend/src/interest/public.ts`): `:63` projection + `importLabels`; `COLLECTION_ATTRIBUTE`
removed; `:178` the collection key = valid marker's `collection`, else `IMPORT_LABELS_WITHOUT_MARKER.collection` (NFC);
`:69` form name "Interest list", field labels "Name", "E-mail", "Phone", "Message", "Products"; `:300` mail lines and
`:320` subject from `catalogServerTexts(...).interestMail` with `fillTemplate` (one pass: a visitor's `{n}` stays text).

**Step 6 — admin.** `GlamPricelistImport.tsx:68` `LabelChoice`; `:123` initial `variantName: ""`, `labels: "site"`;
`:143` a new file resets the choice to "site" (review-0 F-CDL1-LABEL-RESET); `:151` event `labels` = an input change
(withdraws the preview); `:209` `checkRequest` on an `unsupported` editor allows a check without `profileChoice` when the
choice differs from `facts.labels.used` (review-0 F-CDL1-LABEL-RECOVERY); `:560` request member `labels`; `:569`
`labelSets`; `:587` `otherLabelsLine`; `:754` placeholder "Empty: the site's default option name"; `:816`
`LabelChoicePanel`.
`GlamProfileEditor.tsx:82` `LabelsReportDTO`, `OtherLabelsDTO`, `GlamDryRun.labels/otherLabels`;
`COLUMN_ATTRIBUTE_KEYS` and `COLLECTION_ATTRIBUTE` removed; `:254` `editedEditor` passes
`facts.labels[facts.labels.used]`; `:446` `pruneModes(profile, columns)`; `:588` `collectionHint`; `:770` "Column
filters". `pages/FormSubmissions.tsx:49` `fieldHeader`, `:157` used for the headers. `pages/Labels.tsx:603` card
"Import labels" (5 inputs, help text of § 4.9), `:573` the four mail keys in "Interest list".

**Step 7 — MCP.** `tools/mcp-server/src/index.ts:1148` argument `labels` (enum, optional), `variant_name` description;
`tool-shapes.ts:67` request member; `:108` summary lines "Labels: …" and "These lists use other labels: …".

**Step 8 — docs.** `ARCHITECTURE.md` of shared, backend, admin, mcp-server: the behaviour above (admin: the reset and
the re-check rule too).

**Ruled renderer path (CDL1-RENDERER-COVERAGE = A).** `renderer/test/serving-contract/locale-1/cdl-1/coverage.json`
(new, format of `quote-1/coverage.json`): allocates the nine keys; each maps to two existing checks at its reader
(`glam-import-handler.test.ts` or `interest-integration.test.ts`, and `packages/shared/test/cdl-1.test.ts`); every
`case` string was checked against its file (EXECUTED, 18 / 18 found). `locale-coverage.test.ts` is not edited; no
exemption. No other renderer path changed.

## 3. Taxonomy → tests (all EXECUTED, pass)

| Input | State | Test (file › name) |
|---|---|---|
| request `labels` | absent | `backend/test/unit/glam-import-handler.test.ts` › "labels absent → the site labels (English site): written, recorded as importLabels, and reported with used = site"; "labels absent on a Romanian site → today's words; the marker holds them" |
| request `labels` | `"site"` / `"file"` | same file › "labels = %s → that set is written and recorded" (both rows) |
| request `labels` | other value | same file › "labels = %j → 400 before any read" (`"both"`, `""`, `null`, `1`, `["site"]`) |
| header cell | non-empty | `glam-import-core.test.ts` › "headerLabels: the header cells of columns 0, 6, 7, 8 in display form"; handler › "labels = %s …" (file row) |
| header cell | empty / whitespace | handler › "an empty or blank header cell → the file label of that column is the site label"; core › "headerLabels: an empty, blank or absent header cell is \"\"" |
| chosen labels | equal after `norm` | handler › "two chosen labels equal after norm → 400, nothing written; the dry run shows the refusal; the message of § 3.4" |
| `catalogStrings[key]` | absent | `packages/shared/test/cdl-1.test.ts` › "absent locale → English pack values; de-DE (no pack) → English"; "ro-RO without overrides → today's Romanian words" |
| `catalogStrings[key]` | non-empty | shared › "a non-empty override is used (trimmed); …"; handler › "tenant catalogStrings: a non-empty override is the site label; …" |
| `catalogStrings[key]` | `""` / whitespace | shared › "… \"\" or whitespace gives the pack value — never an empty text"; handler › same test as above |
| request option name | absent / blank | handler › "request option name absent or blank → the site default under labels = site AND labels = file"; core › "§ 4.5: no request name → the default option name; …" |
| request option name | given | handler › "request option name given → that name under both choices" |
| stored profile label | equals a chosen label | handler › "a stored profile label equal to a chosen label → unsupported (today's 409); the other set imports"; `glam-profile.test.ts` › "CDL-1 § 4.4: a stored profile whose label equals a chosen label reads as unsupported; …" |
| product `importLabels` | absent | `interest-submit.test.ts` › "CDL-1 § 6.1 collection lookup: no marker → colecție" (+ the NFD row); handler › "otherLabels (§ 5.3): …" (`glam:alpod/a`) |
| product `importLabels` | present, valid | interest-submit › "… marker with the site labels", "… marker with the file's labels", "a marker whose collection key the product does not hold → no collection"; handler otherLabels (`/b` not listed, `/c` listed) |
| product `importLabels` | malformed | interest-submit › three "malformed marker" rows; handler otherLabels (`/d`, `/e` read as the Romanian words) |
| interest mail | `ro-RO`, no override | `interest-integration.test.ts` › "ro-RO, no override → equal to today's mail (today's literal text)" |
| interest mail | `en-US` | interest-integration › "en-US → the English texts of § 3.1" |
| submissions table | interest form, Romanian labels | `admin/src/pages/FormSubmissions.test.ts` › "the interest form stored with Romanian labels (before cdl-1) → English headers by field id" |
| submissions table | any other form | same file › "any other form → its stored labels, as today" |
| admin preview | the choice changes | `admin/src/components/GlamPricelistImport.test.ts` › "a change of the label choice withdraws the shown preview and needs a new dry run; the import sends the choice of the last preview" |
| admin preview (review-0) | stored profile unsupported, choice changed | same file › "a collision resolved by the other label set: the choice withdraws the report, a check re-reads the stored profile (not replaced), and it imports"; "a profile unsupported for another reason stays unsupported under the other set; nothing is importable" |
| admin form (review-0) | a new file after "file" was chosen | same file › "after \"file\" was chosen, choosing a new file selects \"site\" again"; "after a finished import made with \"file\", the next file starts with \"site\"" |

Also: admin › "the editor reads labels[used]: collectionHint …", "… a profile edit keeps the modes of this import's
column labels …", "labelSets: …"; MCP `tool-shapes.test.ts` › the two CDL-1 tests; `catalog-mode.test.ts` › the two
CDL-1 `importLabels` omit tests (create strips; update keeps the stored one).

## 4. Call sites (step 1)

Basis: `git grep -n -w <name>` over `backend admin packages tools renderer`, then the TypeScript errors after the
signature change. The backend `tsconfig.json` excludes tests, so the test list came from `tsc` on a temporary config
outside the repo (`/tmp/CDL-1-tsc`, deleted) that includes `test/unit`, filtered to the changed contracts. The two
lists are equal.
- `planGlamImport`: src `glam-pricelist.ts` (`planFor`); tests: `cat-import-profile-1-golden.ts` (`planOf`),
  `glam-profile-golden.test.ts` (1), `glam-images-handler.test.ts` (2), `glam-import-core.test.ts` (13),
  `glam-profile.test.ts` (7) — 24 test sites (1 + 1 + 2 + 13 + 7; iteration 1 wrote 26, a sum error).
- `checkProfile`: src `profile.ts` (`readStoredProfile`; before: also `parseProfileChoice`), handler (new);
  tests `glam-profile.test.ts` (4).
- `readStoredProfile`: src handler (2); tests `glam-profile.test.ts` (2).
- `checkUpload`: src handler, `glam-images.ts:134` (producer and sheet only — not affected); tests build `GlamUpload`
  only through it.
- `COLUMN_ATTRIBUTE`: `profile.ts` (definition, `checkProfile`), `map.ts` (import, alias). `DEFAULT_VARIANT_NAME`:
  `map.ts` only. Literal constructions: `GlamParseResult` only in `parse.ts`; `GlamUpload` only in `map.ts`.
  The renderer has no call site.

## 5. Abstractions (one line each)

Design § 3.5 (introduced as ratified): `catalogServerTexts` (data axis: tenant language + overrides; users: import
handler, interest route); `importLabels` marker (`ImportLabelsSchema` / `ImportLabels` is its declaration; users:
interest reader, `otherLabels`, the core signatures, the admin DTO); dry-run member `labels` (DTO; users: preview,
editor). Others:
- `IMPORT_LABELS_WITHOUT_MARKER` (shared constant) — users: `interest/public.ts` reader, `otherLabelsOf`; axis: none
  (fixed history of the old importer); rejected: a literal in each reader (two copies), and the RO pack value (a pack
  edit would change how old products are read).
- `otherLabelsOf` (handler-local function, § 5.3) — users: the dry run (1); axis: none, a named block like
  `sheetStates`; rejected: a 15-line expression inside the response literal.
- `LABEL_COLUMN_NAMES` (handler constant) — users: the label-check loop and its message; rejected: four literal pairs.
- Admin: `LabelChoice` type; `labelSets`, `otherLabelsLine`, `fieldHeader` (pure, exported for the node tests, the
  file's pattern — `crossSheetLine`, `galleryLine`); `labelList` (2 users); `LabelChoicePanel` (layout, as
  `PublicationLines`); `LabelsReportDTO`, `OtherLabelsDTO` (the backend DTOs, declared where `GlamDryRun` is);
  `INTEREST_FIELD_HEADERS` (5 English headers). Rejected for each: inline JSX/logic that the node tests cannot reach.
- MCP: `ImportLabelsLine` type, `labelsText` (2 users in the summary).
Removed during self-review: a `choiceRefusal` helper in `profile.ts` (two lines inline instead) and a `written`
bundle parameter of `mapStyle` (two plain parameters instead).

## 6. Golden deltas D1-D6 (design § 4.10; `backend/test/unit/glam-profile-golden.test.ts`)

- D1 `:186` the comparing run's tenant item holds `locale: "ro-RO"`. Mutation check (EXECUTED): a temporary copy
  without it fails at D2 (`Collection` written); the copy was deleted.
- D2 `:119` (`withoutProductImportLabels`) removes `importLabels` from PRODUCT# Put payloads only, asserts the literal;
  `:109` throws when a captured payload holds it; `:115` throws when a non-PRODUCT payload of this run holds it.
- D3 `:139` (`withoutPlanDeltas`) the same on `plan.styles[].draft`; `:134` throws when a captured draft holds it.
- D4 `:136` `plan.variantName` = captured `plan.upload.variantName` (Format, Variantă, Format); `:143` no name sent →
  the new upload has no `variantName`; `:145` the captured one equals `plan.variantName`; only then left out.
- D5 `cat-import-profile-1-golden.ts:33` `labels`, `otherLabels` join `ADDED_MEMBERS`; `:154-155` both in every dry
  run; `:159` `labels` = `{ site: Romanian words, file: header literals per input, used: "site" }` wherever present;
  `:165` `otherLabels = []`.
- D6 `cat-import-profile-1-golden.ts:135` `planOf` and `glam-profile-golden.test.ts:207` pass
  `RO_SITE.siteLabels, RO_SITE.variantName` (`:127`). A re-capture on a pre-cdl-1 base must restore the old call form
  in its copy of the helper (stated in the helper's header).
No general strip rule was added: everything else equals the capture after `mask`. The capture file is unchanged (gate 10).

## 7. Renderer statement

No renderer change is needed (OBSERVED): `SitePage.tsx:196-208` picks the catalog keys one by one (the new keys reach
no client payload); the product page prints stored attribute keys as they are; `InterestShortlist` shows the
`collection` the resolve route answers; no renderer code reads `importLabels`. The renderer source is not edited. Its
unit suite needed one coverage-registry data file, added by ruling (§ 2, § 12).

## 8. Allocation additions

None beyond the ruled one: `renderer/test/serving-contract/locale-1/cdl-1/coverage.json` (CDL1-RENDERER-COVERAGE = A).
Every other changed path is in the packet's allocation (`git status --short`, EXECUTED). Not changed although they hold
related words: `backend/src/import/glam/group.ts:94`, `:181`, `:185` (skip tags, ruled exempt).

## 9. Gates (each run bare; exit code printed by `echo $?`; EXECUTED on the final tree, iteration 2)

All twelve ran again after the last code change of iteration 2. `git diff --check` does not see untracked files: the
three new files (`docs/slices/cdl-1.md`, `packages/shared/test/cdl-1.test.ts`, the renderer `coverage.json`) were
checked with `grep -n -E "[[:space:]]+$"` (no hit, exit 1).

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run build` (root) | 0 | |
| 2 | `npm run typecheck` (root) | 0 | |
| 3 | `cd packages/shared && npm test` | 0 | 15 files, 299 tests |
| 4 | `cd backend && npm run test:unit` | 0 | 48 files (1 skipped: the capture), 1308 tests |
| 5 | `cd admin && npm run test:unit` | 0 | 12 files, 258 tests |
| 6 | `cd tools/mcp-server && npm test` | 0 | route coverage (no route changed, `routes.json` unchanged) + 15 tests |
| 7a | `cd renderer && npm test` | 0 | 28 files, 420 tests (iteration 1: exit 1, the coverage rule; closed by the ruled file) |
| 7b | `cd renderer && npm run test:serving` | 0 | 107 / 107 |
| 8 | `cd packages/plugins && npm test` | 0 | 6 files, 204 tests |
| 9 | `git diff --check` | 0 | |
| 10 | `git status --porcelain -- backend/test/unit/fixtures/glam/cat-import-profile-1-baseline.json` | — | prints nothing |
| 11a | `git grep -n -w <name> -- backend/src admin/src tools/mcp-server/src`, one run per name | 1, 1, 1, 1 | `COLUMN_ATTRIBUTE`, `DEFAULT_VARIANT_NAME`, `COLUMN_ATTRIBUTE_KEYS`, `COLLECTION_ATTRIBUTE`: no hit (git grep exit 1 = nothing found) |
| 11b | `git grep -n -E 'colecție\|împachetare\|comandă minimă\|"unitate"' -- backend/src admin/src tools/mcp-server/src packages/shared/src ':!*MAP.md' ':!**/language-packs/ro.ts'` | 0 | Oracle 11 as corrected by ruling CDL1-SKIP-TAG-ORACLE = A. Every hit is in a permitted place: `index.ts:1438-1441` `IMPORT_LABELS_WITHOUT_MARKER` (the one shared constant of the "product without marker" rule, § 5); comments `group.ts:7`, `parse.ts:28-32`, `facets.ts:27`; tests (`GlamPricelistImport.test.ts`); the ruled exemption `group.ts:94`, `:181` (`"colecție"`; `:185` holds `"produs"`) — the skip tags name a FILE column, design § 2.2 row 22, not changed. (`ro.ts` is excluded from the search: permitted.) |
| 12 | golden deltas | — | § 6; no general strip rule |

## 10. Decisions recorded (local, implied by the design)

- `parseProfileChoice` keeps the strict shape check before any read; ALL `checkProfile` rules of an explicit choice now
  run after the tenant reads (they need the chosen labels). Effect: a profile that breaks a non-label rule still gets
  400 with the same message, after two reads, nothing written. The test "an invalid profileChoice → 400 before any read"
  is split: the shape rows keep the old contract; the label row now runs after the reads and is accepted on an English
  site.
- `catalogServerTexts` returns `variantName` beside `siteLabels` (so `siteLabels` is exactly an `ImportLabels`).
- `labels` is answered by the dry run, the execution (200 / 503) and the label-check 400 (so the admin and MCP can
  show the sets); `otherLabels` by the dry run only (the execution's product read does not project markers).
- `otherLabels` compares labels exactly (facets key on the exact string); one entry per list and label set.
- The fixture tenant of `glam-import-handler.test.ts` holds `locale: "ro-RO"` (an input, as D1), so the tests written
  before cdl-1 keep pinning a Romanian site's words; the CDL-1 block sets other languages explicitly.
- `cat-quote-interest-recipient.test.ts` masks the send time by its ISO form instead of the word "Trimisă" (the
  mail is English on a tenant without a locale).

## 11. What the owner sees in the import preview (INFERRED from the code and the unit tests; not run in a browser)

- Before, every site: option name prefilled "Variantă"; products written with `colecție`, `unitate`, `împachetare`,
  `comandă minimă`.
- After, English site (`en-US` or no locale): a "Labels of the columns …" block with "Use the site labels" (selected)
  — Collection, Unit, Packaging, Minimum order — and "Use this file's labels" — e.g. colectie, unitate de masura,
  unitate de impachetare, comanda minima — with the line "Products of this list get their own filters, separate from
  other lists." (the sets show after the first "Check the file"). The option name is empty ("Empty: the site's default
  option name"); the check says "(Option)". Under the report: "These lists use other labels: …" for lists imported
  before cdl-1 (Romanian words). Changing the choice withdraws the report until the next preview.
- After, Romanian site: the site labels are today's four words and the default option name "Variantă"; lists imported
  before cdl-1 read as the same words, so no "other labels" line (as D5 asserts on the golden).
- Iteration 2: when the saved profile cannot be applied because one of its labels equals a site label, the owner can
  pick "Use this file's labels" and press "Preview": the saved profile is checked again under the file labels and, if
  it fits, loads and can be imported. A new file always starts with "Use the site labels" selected.

## 12. Review-0 and the operator rulings (iteration 2)

**CDL1-RENDERER-COVERAGE = A** — applied: the one ruled path (§ 2). Iteration 1's text, kept for the trail:

Problem: `renderer/test/unit/locale-coverage.test.ts` enforces the locale-1 coverage rule (`docs/slices/locale-1.md`
§ 16.2 item 5): every key of `CatalogStringsSchema` must be allocated by a `coverage.json` under
`renderer/test/serving-contract/locale-1/<slice>/`. The ratified design adds nine catalog keys; the packet allocates no
`renderer/` path and says "Do not edit `renderer/`" and that the renderer must pass unedited. Both cannot hold.
CAT-QUOTE-1 met the same rule with `locale-1/quote-1/coverage.json`. Proposed file (not created in the repo):
`renderer/test/serving-contract/locale-1/cdl-1/coverage.json`, mapping each key to its checks at the reader
(handler, interest-integration and shared `cdl-1` tests). Proof (EXECUTED): in a temporary worktree
(`/tmp/CDL-1-wt`, removed) with this slice's diff and the file, `npx vitest run test/unit/locale-coverage.test.ts`
→ exit 0, 11 / 11. Iteration 2 created exactly that file in the repo; oracle 7a now exits 0.

**CDL1-SKIP-TAG-ORACLE = A** — applied: oracle 11 is reported with the exemption (§ 9, row 11b); `group.ts` unchanged.

**F-CDL1-LABEL-RECOVERY** (defect class: a verdict that depends on an input is kept after that input changes). Rule:
an `unsupported` editor's verdict holds only for the label set it was checked under (`facts.labels.used`); while the
choice differs, `checkRequest` allows a check WITHOUT `profileChoice`, which re-reads the STORED profile under the new
labels — nothing is replaced. The answer goes through `loadEditor` unchanged: supported → `editing` with the stored
profile as working and base; unsupported → `unsupported` again, and the check is closed (the labels now match). The
choice event already withdraws the preview and the confirmation (it is an input change). Tests: § 3, rows "review-0".

**F-CDL1-LABEL-RESET** (defect class: per-import input carried into the next import). Rule: `file-chosen` — the event
that starts a new import — sets `labels: "site"`, like it resets the editor. Tests: § 3, rows "review-0" (after a choice,
and after a finished import).

**F-CDL1-RECORD-ACCURACY** — corrected: the call-site count (§ 4: 24), the status line (iteration 1 claimed 7b-12 pass
while oracle 11 still had the open exemption), and the two ordering comments of `glam-pricelist.ts` (§ 2, `:162`, `:286`).


## 13. Findings

- **F-CDL1-RENDERER-COVERAGE**: closed by ruling A (§ 12).
- **F-CDL1-SKIP-TAG**: closed by ruling A — a permitted location of oracle 11 (§ 9, row 11b).
- **F-CDL1-LABEL-RECOVERY**, **F-CDL1-LABEL-RESET**, **F-CDL1-RECORD-ACCURACY** (review-0): corrected (§ 12).
- **F-CDL1-TEST-TYPES** (pre-existing, observation): `tsc` over `backend/test/unit` reports about 300 errors in SDK-mock
  typings and `possibly undefined` reads (e.g. `content-update-contract.test.ts`, `cat-quote-interest-recipient.test.ts`);
  backend tests are not type-checked by any gate. None comes from this slice's contracts (filtered list in § 4).
- **F-CDL1-CAPTURE-HELPER**: `planOf` (shared by the capture test) now uses the new `planGlamImport` form; a re-capture
  on a base before cdl-1 needs the old call form (noted in the helper header).

## 14. Not run / could not determine

- Staging evidence (design § 8.4): NOT RUN (operator, after review). No AWS call was made.
- The admin UI was not rendered in a browser; § 11 is INFERRED. No end-to-end test covers the import form; the reducer,
  the pure helpers and the request body are unit-tested.
- Prod data: not readable by the builder (design E16).

## 15. Operator closeout


Operator, 2026-11-15. Review-1 approved (reviewer `gpt-6.1-sol`, builder `claude-opus-5-5`, two cycles).

**Gates (operator run on the approved tree).** build 0, typecheck 0, shared 0, plugins 0, renderer 0, serving 0, admin
unit 0, backend unit 0, mcp 0, `git diff --check` 0. Oracles: no change under `infra/`, `renderer/src/`, any
`package.json` or the frozen capture; every changed path is in the amended allocation; the removed names have no hit
under `backend/src`, `admin/src`, `tools/mcp-server/src`; no trailing whitespace in the new files.

**Staging.** `cdk diff`: code and asset hashes only (49 functions, admin and renderer assets, the admin runtime
config, three nested-stack descriptions); no resource added or removed, no permission change. Deployed to
`AmodxStack-staging`. Evidence of design § 8.4, by script against the deployed API and `AmodxTable-staging`:

| § 8.4 item | Result |
|---|---|
| 1. `cm1-catalog` dry run | `labels.site` = `Collection`, `Unit`, `Packaging`, `Minimum order`; `labels.file` = `colectie`, `unitate de masura`, `unitate de impachetare`, `comanda minima`; `used` = `site`; `otherLabels` names `glam:boen/pl` (437), `orc-wood` (8), `orc-laminate` (8), `cig1-mini` (2), `cim1-mini` (2), each with `colecție`. A request with `labels: "both"` → 400. |
| 2. import with "site" | the product holds the keys `Collection`, `Unit`, `Packaging`, `Minimum order` in this order and `importLabels` = the site set. An admin product update that sends another `importLabels` keeps the stored one. The product page shows the row "Collection" and no `colecție`. |
| 3. import with "file" | the product holds the four header labels and `importLabels` = the file set. |
| 4. interest resolve | the re-imported product (marker, key `colectie`) and one active `glam:alpod/orc-wood` product (no marker, key `colecție`) both answer `collection`. |
| 5. interest submit, mail, submissions table | NOT RUN on staging. The deployment requires a reCAPTCHA token, which a script does not have, and no staging tenant has a mail recipient. The stored English form, the Romanian and English mail texts and the English table headers are bound by the unit tests of § 1 only. |
| `glam-staging` (ro-RO), sheet `glam:alpod/sil` | dry run: site labels = the four Romanian words; `otherLabels` empty. After the import: the same 9 products, attribute keys and order equal those before, `importLabels` = the Romanian set. |

Deviations from § 8.4, with the reason:
- Item 1-3 used a 6-row file cut from `backend/test/unit/fixtures/glam/alpod/AUR.csv` (the "Wood" rows of the click
  collection) with probe values `m2`, `cutie`, `1` in the three label columns, which are empty in the fixture. The
  original one-product file of this sheet no longer exists.
- Item 4 used an `orc-wood` product for the no-marker case: all 437 `glam:boen/pl` products of `cm1-catalog` are
  drafts, and the resolve route answers `not-available` for a draft.
- An import creates drafts. The script published the product through `PUT /products/{id}` with the full product body.

State left on staging: `cm1-catalog` `glam:alpod/cig1-aur` holds one active product with the file's labels.
`glam-staging` `glam:alpod/sil` was imported again (9 drafts, as an import writes them).

Not checked: the admin screens in a browser (the label choice panel, the Labels page card, the submissions table).
