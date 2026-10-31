# CAT-IMPORT-PROFILE-1C — admin: profile editor, proposal, preview (IMPL record)

Status: **IMPLEMENTED** (2026-10-31; iteration 2 after review-1 `revise`, § 12; iteration 1 after review-0, § 11) — code complete; review and the operator's staging evidence (§ 10) pending
(`docs/documentation.md` § Status taxonomy). Uncommitted on `main` at `86fca54`.
Contract: the ratified design `docs/slices/cat-import-profile-1.md` — § 7.1 slice `1c` (definition of done), § 5 (preview;
§ 5.1 what the user sees, § 5.2 DTO and base sets, § 5.3 fidelity limits, § 5.5 units for `1c`), § 6.1–6.3 and § 6.6
(flows), § 3.3 (the `unsupported` state), under § 11 (CIP1-PREVIEW = A; CIP1-PROSE = A — the preview shows the prose
exactly as the import writes it, which is unchanged) and § 12. Shipped inputs: `1a` (`2cf738e`, the dry-run members) and
`1b` (`86fca54`, `packages/shared` `facets.ts` + `catalog-listing.ts`).
Maturity: the editor and the preview enter as **PROTOTYPE**; MATURE when the design § 7.5 staging evidence is recorded.
Track F — Glam catalog. Vision tie: guarantee 3 (the preview's data and filters are the renderer's own pure functions
from `packages/shared`, fed the renderer's inputs, tested off-target in node — no DOM, no AWS); "expand before contract"
(with nothing stored the admin sends the default profile, which the backend treats as unprofiled: no profile item, no
stamp — the 1a golden; the profile is stored only by an import the user previewed and confirmed).

Evidence labels: **EXECUTED** = a command was run in this session; **OBSERVED** = read in a file; **INFERRED** = a
conclusion, not run. Gate logs: `.agent-manager/slices/CAT-IMPORT-PROFILE-1C/gates/` (relay's gitignored directory).

---

## 1. What changed, per step of the packet (file:line on the working tree)

| Step | Change | Where |
|---|---|---|
| 0 | Measured BOEN's `specKeys` through the backend's own pure core (`parseGlamCsv` → `planGlamImport` → `analyseSpecKeys`, default profile) over `backend/test/unit/fixtures/glam/boen-PL.csv`: 437 products, 13 keys (EXECUTED; script and output kept in `.agent-manager/slices/CAT-IMPORT-PROFILE-1C/`, `boen-speckeys.mts`, `measure-boen-speckeys.json`) | — |
| 1 | Editor state inside the existing reducer: `GlamFormState.profile` `:73`, `preview.choice` / `preview.context` `:71`; events `profile-edit` `:94`, `import-profile-changed` `:93`, `import-incomplete` `:91`; transitions `:118` (new file → `not-loaded`), `:124` (producer → `not-loaded`), `:125` (edit = an input change: revision + 1, report withdrawn), `:129` (check answered: load / reload / preview), `:151` (import done → base + sheets), `:155` (503 incomplete → base + sheets), `:157` (409) | `admin/src/components/GlamPricelistImport.tsx` |
| 1 | `ProfileEditor` sum `:104` and its pure transitions `loadEditor` `:126`, `confirmChoiceOf` `:161`, `previewedEditor` `:172`, `editorAfterImport` `:194` (with `ExecutionProfileReport` `:183`), `editorAfterConflict` `:216`, `editedEditor` `:227`, `storedMoved` `:252`; copy pinned by the units `movedNotice` `:292`, `SAVE_RULE` `:301`, `FILTER_MODE_HELP` `:309`, `VARIANT_MODE_HELP` `:316`, `FACET_VISIBILITY_HELP` `:320`; `proposeProfile` `:347`; `applyProfileEdit` `:433`; hints `keyHints` `:505`, `nameNumberHint` `:535`, `collectionHint` `:551`; sheet states `sheetId` `:569`, `sheetStateText` `:573`, `sheetsToReimport` `:584`; DTO types `:27-86` | `admin/src/components/GlamProfileEditor.tsx` (new) |
| 2 | Preview assembly, pure: `siteContextOf` `:34`, `previewCards` `:54`, `defaultProductSlug` `:72`, `attributeRows` `:84`, `previewProductPage` `:107`, `draftCategoryRef` `:131`, `producerCategoryId` `:144`, `collectionCategoryIds` `:149`, `categoryLabel` `:157`, `previewPanel` `:178` (calls `catalogListing`, `catalogListingPath`, `buildFacetListing` from `@amodx/shared`), `selectionOfHref` `:223`, `FIDELITY_NOTICE` `:228`, `FIDELITY_LIMITS` `:234`, `effectivePreviewChoice` `:248`, `proseParagraphs` `:266` | `admin/src/components/glamPreview.ts` (new) |
| 3 | Requests: `checkRequest` `:173` (first check without a choice; then "Previzualizează" with `{ working, baseRevision }`), `confirmRequest` `:190` (replaces `confirmInput`: the preview's input AND choice), `incompleteImportReport` `:197`, `profileChangedRefusal` `:205`, `requestBody(input, choice)` `:417`; dialog: `loadSiteContext` `:460` (`GET /settings` + `GET /categories`), `sendCheck` `:469`, `confirm` `:487` (409 → reload `:505`) | `admin/src/components/GlamPricelistImport.tsx` |
| 3 | `ApiError` `:16` (`status`, parsed `body`; `message` unchanged), thrown `:71` — the one existing helper extended | `admin/src/lib/api.ts` |
| 4 | Components (Romanian copy): `ProfileEditorPanel` `:642` / `EditingPanel` `:666` / `KeyTable` `:788`; `ImportPreview` `:865`, `ProseText` `:971`, `FilterPanelPreview` `:982`; mounted at `GlamPricelistImport.tsx:615`, `:617` | `GlamProfileEditor.tsx` |
| 5 | Units: `GlamPricelistImport.test.ts` +29 rows (the 30 existing rows adapted, § 4); `glamPreview.test.ts` (new, 22 rows) | — |
| 6 | `admin/ARCHITECTURE.md` (tree, new section "Glam pricelist import and the import profile", API client) ; this record | — |

`GlamPricelistImport.tsx` is 720 lines (576 before). `GlamProfileEditor.tsx` is 1,043 lines: about 615 pure (types,
transitions, edits, hints, pinned copy) and 430 layout. `glamPreview.ts` is 274 lines.

## 2. How it works (for the reviewer)

**The state machine.** The form had one rule: a confirmed import is exactly the input the shown dry run was made for.
1c keeps that rule and extends "input" to the profile. The editor is a member of the same reducer state, a sum:
`not-loaded` → (first check answered) → `editing { base, working, facts, otherImport }`, or `unsupported { revision,
reason, facts }` when the stored profile does not parse. `base` is the stored profile as the latest check WITHOUT a
choice reported it (`none` | `stored { revision, value }` | `unsupported { revision, reason }`); `baseRevision` is
derived from it, so it cannot disagree with it. `working` is what a preview sends. `facts` is the latest answered dry
run (key table, sheet states, hints) — it stays while edits withdraw the shown report.

| Step | Request | What the answer does |
|---|---|---|
| "Check the file" (editor `not-loaded`) | dry run, no `profileChoice` | loads: `working` = stored value (or the backend's default); the report is shown and importable with `choice = { that profile, its revision }` (§ 6.2) — `null` when unsupported |
| "Previzualizează" (`editing`) | dry run, `profileChoice = { working, baseRevision }` | shown, importable with exactly that choice; if the answer's `profile.stored` revision ≠ `baseRevision`, a notice says the import MAY be refused (`movedNotice`; whether it is, is the backend's acceptance rule, not restated in the admin) |
| any edit | — | revision + 1, report withdrawn, confirm impossible until a new preview |
| "Confirm the import" | execution with the preview's input + choice | 200, and the 503 "incomplete" (written, profile saved): `base` := the profile it used, the sheet states := the answer's `sheets` (`editorAfterImport`). 409 with `storedRevision`/`baseRevision`: report withdrawn, `otherImport` set, and a reload dry run (no choice) is sent; its answer changes `base` only — the user's `working` is KEPT; the user takes the stored one ("Folosește profilul salvat") or keeps theirs, then previews again, so the re-sent choice has `baseRevision = m` (§ 6.6) |

Why "the default with `baseRevision: null`" rather than "no choice" for a first import with nothing stored: the backend
treats an explicit default with nothing stored as unprofiled (no write, no stamp — `resolveProfile`,
`backend/src/import/glam/profile.ts:217`, OBSERVED), and if another import stores a profile in between, the execution
is refused (409) unless that stored profile equals the default (the "content equal" clause, `profile.ts:221-222`,
OBSERVED) — instead of silently applying a profile the user did not preview.

**The preview.** `previewPanel` concatenates `siteProducts` and `drafts` (both from the dry run), calls
`catalogListing(items, scope id, today)` — the renderer's membership, date window and order — and then
`buildFacetListing(base, f, path)` with `path = catalogListingPath(prefixes, slug)` — the renderer's own path string on
the public domain (`basePath = ""`). Scopes come from the drafts' `categoryIds`: index 0 is the producer's category
(OBSERVED `backend/src/import/glam/map.ts:177-180`), the others are collections; an id is `<found id>`, `new:<slug>` or
`occupied:<slug>` (`previewDrafts`, `glam-pricelist.ts:910`). A found category's slug is not in the dry run, so the
admin reads `GET /categories` (an existing route, also used by `ProductEditor.tsx:117`); the lookup found it BY that
slug (`lookupCategory`, `glam-pricelist.ts:448-473`), so the stored slug is the plan's. A click on a value does what the
site's `<a>` does: it takes the `f` of the href `buildFacetListing` built (`selectionOfHref`) and builds the panel again.
The filter selections and the WANTED product and collection are local UI state of `ImportPreview`; what is shown is
`effectivePreviewChoice(report.drafts, wanted)` — a wanted value the current report no longer holds (a `new:<slug>`
that another import created, so the next dry run names it by its stored id) falls back to the report's default. So no
panel is built from a reference of an older report, also when a new report arrives without a form edit.

**After an import.** The execution answer (200, and the 503 "incomplete", which also wrote the products and saved the
profile) carries `profile` and `sheets` — the producer's sheets as written. Both refresh the editor
(`editorAfterImport`): the base becomes the profile used, and the sheet states are the answer's, so the other sheets a
profile change made `stale` are listed for re-import at once (§ 6.3).

**What the admin does NOT render like the site** (stated in the UI by the § 5.3 copy): theme, fonts, layout; the prose
is shown as text: `proseParagraphs` (pure) reverses the importer's exact format — one `<p>` per line, the five HTML
escapes — so each paragraph is the line as written (a line holding `<b>` shows `<b>`); any other form is shown whole and
undecoded. It is rendered as React text, never injected as HTML (the admin holds the session token; the site renders
it sanitised). All the § 5.3 limits are listed under the ruled notice (`FIDELITY_LIMITS`). The card order of a filtered listing is not shown:
draft ids are `preview:<slug>` placeholders, so ties in `sortOrder` would order differently from the real ids; the
panels show counts, not ordered lists.

## 3. Gates (§ 7.2 + packet § 2; bare exit codes; iteration 2, fresh build after the last code change; logs `gates/iter2-*.log`; iteration 1: `gates/iter1-*.log`)

| # | Command | Exit | Last line(s) | Label |
|---|---|---|---|---|
| 1 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run build; echo "exit $?"` | 0 | `> infra@0.1.0 build` / `> tsc` (admin `vite build`: one 2,829 kB chunk warning, the single-bundle SPA — pre-existing, INFERRED) | EXECUTED |
| 2 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" && npm run typecheck; echo "exit $?"` | 0 | `> tsc --noEmit` (0 `error TS`) | EXECUTED |
| 3 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/packages/shared" && npm test; echo "exit $?"` | 0 | `Tests  196 passed (196)` | EXECUTED |
| 4 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/backend" && npm run test:unit; echo "exit $?"` | 0 | `Tests  1133 passed \| 1 skipped (1134)` | EXECUTED |
| 5 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm test; echo "exit $?"` | 0 | `Tests  104 passed (104)` | EXECUTED |
| 6 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/renderer" && npm run test:serving; echo "exit $?"` | 0 | `# pass 71` / `# fail 0` | EXECUTED |
| 7 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/admin" && npm run test:unit; echo "exit $?"` | 0 | `Tests  116 passed (116)` (65 before + 51 new) | EXECUTED |
| 8 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/tools/mcp-server" && npm test; echo "exit $?"` | 0 | `# pass 11` / `# fail 0` (`routes.json: 112 routes`; no route change) | EXECUTED |
| 9 | `cd "/Users/apple/Documents/APLICATII BIJUTERIE/amodx/infra" && npm test; echo "exit $?"` | 0 | `Tests:       61 passed, 61 total` (iteration 2, first run). In iteration 1 the first run exited 1 (`61 failed`: esbuild killed by a signal, `exited with status null`, while bundling unchanged backend code — an environment failure; `iter1-g9-infra.log`) and the re-run passed (`iter1-g9-infra-rerun.log`) | EXECUTED |
| 10 | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --check; echo "exit $?"` | 0 | (nothing) | EXECUTED |
| + | (iteration 1 only) after its gates, one `FIDELITY_LIMITS` string was narrowed and the admin build / typecheck / unit were re-run (`gates/iter1-final-admin-*.log`); iteration 2 ran every gate after its last change | — | — | EXECUTED |
| + | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" diff --stat -- backend renderer infra tools packages` | 0 | prints nothing | EXECUTED |
| + | `git -C "/Users/apple/Documents/APLICATII BIJUTERIE/amodx" status --porcelain -uall` | 0 | 8 paths, all allocated: `M` `admin/ARCHITECTURE.md`, `admin/src/components/GlamPricelistImport.{tsx,test.ts}`, `admin/src/lib/api.ts`; `??` `admin/src/components/GlamProfileEditor.tsx`, `admin/src/components/glamPreview.{ts,test.ts}`, `docs/slices/cat-import-profile-1c.md` | EXECUTED |

## 4. Units (§ 7.1 `1c`, § 5.5 for `1c`)

**Existing rows adapted** (30, same names, same properties): `check-done` now carries `choice` and `context`, and an
accepted answer must carry `profile` (the reducer reads it), so the test helper `dryRun()` builds a report with the
default profile; `confirmInput` → `confirmRequest`, whose expected value now includes `choice: { profile: DEFAULT,
baseRevision: null }`; the import-done row's result carries `profile`.

**New rows, `GlamPricelistImport.test.ts`** (20 in iteration 0, + 6 in iteration 1 — § 11, then its 3 copy rows replaced by 6 in iteration 2 — § 12):
- load: nothing stored → the default loaded, not the proposal, confirm sends `{default, null}`; stored revision 3 →
  loaded, confirm and preview send `{stored, 3}`; unsupported → nothing loaded, not importable, no preview, only the
  proposal starts an edit, then `baseRevision` = 4 (§ 3.3 item 5); new file / producer resets, sheet / variant name
  keep.
- **edit withdraws the report** (revision + 1, preview null, confirm null, a late answer ignored); **confirm sends the
  previewed profile and `baseRevision`** (deep-equal, also through `requestBody`); the body has `profileChoice` only
  with a choice; after an import the base is the answer's revision (the next sheet's preview is accepted).
- **409 → reload → re-preview**: snapshot n refused (m stored) → withdrawn, `otherImport`, reload keeps the snapshot and
  shows nothing importable; option "re-apply with `baseRevision = m`" and option "take m"; a new preview is confirmable;
  the next import clears the notice. `storedMoved` row. `profileChangedRefusal`: only a 409 naming both revisions (not
  the lock's 409, not the unsupported 409, not a 500, not a plain `Error`).
- **proposal over BOEN's measured `specKeys`** — fixture choice: a HAND-BUILT `specKeys` fixture whose numbers are
  copied from the backend's own pure planner output (§ 1 step 0), not a JSON fixture file (a new fixture file is outside
  the allocation). Rows: 13 keys → attribute, label = key, split none, no mode, default grouping/collection, not equal
  to the default; loading does not apply it; hints: `Style` "listă cu virgule în 201 rânduri", `Dimensions (mm)`
  "diferă între opțiuni în 7 produse" + "egal cu eticheta variantei (fără spații și „mm”) în 258/310 rânduri",
  `Certificates` "o singură valoare", `Wood` none; ALPOD `dimensions` (82 values) "regula repetării nu l-ar oferi ca
  filtru pentru produsele acestui fișier (82 valori)";
  grouping and collection hints.
- `applyProfileEdit`: collection key consumed; rule positions kept; a label carries its mode, a removed rule drops its
  mode, column-key modes stay; `variant` serialised only when "never" (§ 3.3 item 2). Sheet states: other non-current
  sheets listed only when a profile is stored.

**New rows, `glamPreview.test.ts`** (16 in iteration 0, + 6 in iteration 1 — § 11; unchanged in iteration 2):
- § 5.5 assembly fixture: kept active (shop + category), kept `draft` (neither), kept status-less legacy (category, NOT
  shop), kept `availableFrom` tomorrow and `availableUntil` yesterday (neither), the previous set (absent — the backend
  leaves it out of `siteProducts`, 1a handler row; the admin row proves the assembly adds no other source), a draft in an
  existing collection (found id) and one in a new collection (`new:<slug>`, only there); the producer facet lists each
  draft's `brand`.
- **No copy:** for the shop, the producer category, the existing and the new collection, with and without a selection,
  `previewPanel(...).listing` deep-equals `buildFacetListing(catalogListing(siteProducts ∪ drafts, id, today), f,
  catalogListingPath(URL_PREFIX_DEFAULTS, slug))` called directly.
- **Near budget:** a 125-character slug, a selected 3,000-byte value, a second value sized so the page-1 href is exactly
  `HREF_BUDGET − PAGE_RESERVE` bytes (asserted): (1) the panel deep-equals the direct call on `/categorie/<slug>` and the
  value is `link`; (2) on `/_site/cm1-catalog` + that path the value is `too-long` and `budgetHint` is set — the stated
  limit, pinned; (3) the path follows custom `urlPrefixes` (`/categorie`), and absent `urlPrefixes` give
  `URL_PREFIX_DEFAULTS`. A click follows the href (selected after), the clear link gives `""`.
- Unavailable panels (no context, a found id missing from the category list, an occupied address); cards (first 24, count
  30); default product (most options, tie → first); product page (gallery, variant labels, joined rows, prose unchanged
  string); the fidelity copy.

**Mutation controls** (EXECUTED; each applied alone to a copy-backed file, the suite run, the file restored; sha256 of
the three files re-checked OK; `/tmp/CAT-IMPORT-PROFILE-1C-mutation` removed):

| Mutation | Rows red |
|---|---|
| M1 the base set without the drafts | 7 |
| M2 a non-public path (`/_site/x` + path) | 7 |
| M3 a profile edit that does not withdraw the report | 2 |
| M4 the reload replaces the user's snapshot | 1 |
| M5 confirm sends the report-derived choice instead of the previewed one | 2 |

## 5. Abstraction one-liners (what · current users · axis · rejected simpler alternative)

- `ProfileEditor` (sum `not-loaded | unsupported | editing`) · `glamFormReducer`, `checkRequest`, `ProfileEditorPanel`, the units · variants fixed (states of § 3.3 / § 6), exhaustive switches · a boolean `loaded` plus a nullable `working` / `baseRevision` (a defect-shaped type).
- `StoredBase` (sum) · `ProfileEditor.editing`, `baseRevisionOf`, `BaseLine` · variants fixed (none / stored / unsupported); `baseRevision` derived, never stored beside it · a separate `baseRevision: number | null` field that could disagree with what is shown.
- `ProfileEdit` (sum) + `applyProfileEdit` · the reducer's `profile-edit` event, the editor layout, the units · operations on a fixed profile shape (one variant per control) · one `field`/`value` string event per control (untyped).
- DTO types `ProfileReportDTO`, `SheetReportDTO`, `SpecKeyFact`, `GlamDryRun` · the reducer and the editor · data crossing the API boundary (raw structures, typed as the backend sends them) · `any` everywhere (the existing report stays `any` where 1c does not read it).
- `glamPreview.ts` (module, pure) · `ImportPreview`, the units · none — the § 5.2 seam: the node tests need the assembly without React, and the rules stay the shared functions · the assembly inline in the component (untestable without a DOM, which may not be added).
- `PreviewPanel` / `DraftCategoryRef` / `PreviewScope` (sums) · `previewPanel`, `FilterPanelPreview` · variants fixed (panel / unavailable; found / new / occupied; shop / category) · string prefix tests at each use site.
- `ApiError` (class in the existing `lib/api.ts`) · every `apiRequest` failure (constructed), read by `profileChangedRefusal` · none — the 409 path must read `storedRevision`, which the old `Error` dropped · parsing the backend's English message (couples to prose).
- `SiteContext` (DTO) · `previewPanel`, `categoryLabel` · the two site facts the dry run does not carry · passing raw `GET /settings` and `GET /categories` answers through.
- No interface, registry, adapter or config layer. The two new files are the packet's allowed siblings.

## 6. Copy inventory (complete; every new user-visible string, as in the code after iteration 1)

Buttons and labels — `Previzualizează` (the check button once the editor is loaded; before: the existing `Check the
file`) · `Folosește propunerea` (title: `Fiecare cheie devine atribut, cu eticheta egală cu cheia; gruparea și colecția
rămân implicite`) · `Folosește profilul salvat (revizia <r>)` · `Ce este un produs` · options `Fiecare nume din fișier
este un produs` / `Numărul de la sfârșitul numelui, când există, devine eticheta variantei` / `Numele fără numărul final;
varianta din coloana format` · `De unde vine colecția` · options `Coloana colecției din fișier` / `Cheia „<k>” (<n>
valori, <r> rânduri)` / `Cheia „<k>”` · `Filtrele coloanelor` · `variantele` · mode options `automat` / `mereu` /
`niciodată` · key table headers `Cheia din fișier` / `Fapte măsurate (ultima verificare)` / `Devine` / `Eticheta pe
site` / `Împărțire` / `Filtru` · action options `atribut` / `doar în text` / `nerevizuit` · `sursa colecției` · split
options `valoare întreagă` / `împarte la virgulă` · `Pagina produsului` · `Filtrele, după import` · `Categoria
producătorului: <label>` · `Colecția: <label>` · `Magazinul` · `Șterge filtrele` · `Descriere (textul publicat)`.

Editor text — `Profilul de import al producătorului <p>` · `Niciun profil salvat pentru acest producător.` · `Profil
salvat: revizia <r>.` · `Profilul salvat (revizia <r>) folosește setări pe care acest importator nu le poate aplica:
<reason>; un import cu profilul de mai jos îl înlocuiește, dacă între timp alt import nu a salvat alt profil.` ·
`SAVE_RULE`: `Profilul se salvează doar printr-un import: un import acceptat salvează profilul previzualizat dacă
diferă de cel salvat (revizia crește cu 1); dacă este identic, revizia rămâne. Cât timp nu este salvat niciun profil,
profilul implicit nu se salvează: importul rămâne fără profil. Celelalte liste ale producătorului se schimbă doar când
sunt importate din nou.` · unsupported panel: `Profilul salvat (revizia <r>) folosește setări pe care acest importator
nu le poate aplica: <reason>. Nu poate fi deschis aici. Porniți de la propunere; un import cu profilul ales aici îl
înlocuiește, dacă între timp alt import nu a salvat alt profil.` · `Profilul a fost schimbat de alt import (revizia
<m>). Mai jos este profilul dvs.; alegeți profilul salvat sau păstrați-l pe al dvs., apoi apăsați „Previzualizează” din
nou.` · `<n> din <m> produse au numele terminat într-un număr.` · `Coloana colecției are <n> valori.` · `Un rând fără
această cheie, sau cu o valoare refuzată de filtrul de valori, primește ca colecție numele listei.` ·
`FILTER_MODE_HELP`: `Filtrele de atribute — automat: filtrul este oferit pe o pagină când, fără produsele marcate
„niciodată”, cel puțin 2 produse ale paginii au cheia, cea mai frecventă valoare este la cel puțin 2 dintre ele și sunt
cel mult 40 de valori; mereu: este oferit pe orice pagină unde un produs importat cu acest profil are cheia, chiar dacă
aceste condiții nu sunt îndeplinite; niciodată: produsele importate cu acest profil nu contribuie la oferirea filtrului
și valorile lor nu sunt propuse, dar ele rămân găsite și numărate când o valoare este aleasă.` · `VARIANT_MODE_HELP`:
`Filtrul variantelor — automat: este oferit pe orice pagină, fără regula repetării; niciodată: variantele produselor
importate cu acest profil nu sunt propuse, dar aceste produse rămân găsite și numărate când o variantă este aleasă.` ·
`FACET_VISIBILITY_HELP`: `Pe pagină, un filtru este afișat dacă are deja o valoare aleasă, sau dacă este oferit și cel
puțin una dintre valorile propuse nu este la toate produsele paginii.`` ·
`Listele producătorului pe site` · `<sheet> (această listă) — <n> produse, <state>` with states `importată fără
profil` / `importată cu profilul salvat (revizia <r>)` / `importată cu un profil mai vechi (revizia <r>)` /
`amestecată (revizii: <r…>; <n> produse fără profil)` · § 6.3: `Aceste liste au fost importate cu un profil mai vechi
sau fără profil: <sheets> — importați-le din nou.` · `Fișierul nu are linii de specificații de forma „cheie: valoare”.`
· `nu apare în acest fișier` · facts `<rows> rânduri, <products> produse, <n> valori (cea mai des: <h> produse)` / `ex.:
<samples>` · hints `listă cu virgule în <n> rânduri` / `diferă între opțiuni în <n> produse` / `egal cu eticheta
variantei (fără spații și „mm”) în <n>/<rows> rânduri` / `egal cu colecția din coloana 0 (fără spații și „mm”) în
<n>/<rows> rânduri` / `o singură valoare` / `regula repetării nu l-ar oferi ca filtru pentru produsele acestui fișier
(<n> valori)` / `<n> linii refuzate de filtrul de valori (cod sau preț)`.

Dialog text (`GlamPricelistImport.tsx`) — 409: `Profilul producătorului a fost schimbat de alt import (revizia <m>) după
ce l-ați încărcat. Nimic nu a fost schimbat. Profilul salvat se reîncarcă; alegeți profilul și previzualizați din nou.`
· `Acest raport nu poate fi importat: profilul salvat nu poate fi aplicat. Folosiți propunerea de mai jos și
previzualizați.` · `movedNotice`: `Profilul salvat s-a schimbat de când l-ați încărcat (acum: revizia <m> | niciun profil). Importul
poate fi refuzat; dacă este refuzat, nu se schimbă nimic și profilul salvat se reîncarcă pentru a alege între cele
două.`` · the 503 "incomplete" shows the existing
`explain()` text (unchanged).

Preview — `Previzualizare — nimic nu a fost scris încă` · **`aspect aproximativ — datele și filtrele sunt exacte pentru
adresa publică a site-ului`** (ruled, § 5.3), then the list `FIDELITY_LIMITS`: (1) `Aspectul nu este al site-ului:
tema, fonturile și așezarea paginilor nu sunt aplicate aici. Valorile, numerele, ordinea și vizibilitatea filtrelor sunt
cele pe care site-ul le calculează pentru aceleași date, pe adresa publică.` (2) `Datele sunt cele de la momentul
verificării. Produsele schimbate între timp de alți utilizatori sau de alt import și prefixele de adresă schimbate după
verificare nu apar aici; importul citește din nou produsele, categoriile și profilul salvat.` (3) `Data de
disponibilitate se compară cu ziua UTC, ca pe site. O perioadă care începe sau se termină între verificare și vizita pe
site nu este reflectată aici.` (4) `Limita de lungime a adresei este exactă pentru adresa publică a site-ului. Pe
adresele de previzualizare (/_site/<id>/…) adresele sunt mai lungi, așa că o valoare aproape de limită poate fi activă
aici și inactivă acolo.` (5) `Imaginile sunt adresele producătorului: copierea lor pe site vine după import, iar unele
pot apărea aici rupte.` · `<n> produse` / ` — primele <24>` · `Fără imagini.` · `Fișierul nu are niciun produs.` ·
`Nicio colecție separată de categoria producătorului.` · `<path> — <k> din <n> produse` · `Niciun filtru nu este afișat
pe această pagină.` · category labels `<slug> (nouă)` / `<slug> (adresă ocupată)` · unavailable panels `Setările sau
categoriile site-ului nu au putut fi citite.` / `Categoria <id> nu este în lista de categorii a site-ului.` / `Adresa
categoriei „<slug>” este ocupată de altă categorie; importul nu poate rula.` · copied from the site's panel
(`SitePage.tsx:1126`, `:1154`, `:1167`): `Prea multe filtre selectate — eliminați unul`, `Filtrele din adresă sunt prea
lungi și nu au fost aplicate.`, `Șterge filtrele`.

Not changed: the existing English copy of the dialog (`Check the file`, `Confirm the import`, the report lines). The
packet's "Importă" is the existing `Confirm the import` button (D-1).

## 7. Builder decisions and deviations (local, recorded)

- **D-1** "Importă" = the existing "Confirm the import" button; its English label is kept (renaming existing copy is not
  in the allocation's purpose; the new copy is Romanian). Follow-up FU-4.
- **D-2** `confirmInput` replaced by `confirmRequest` (input + choice). One gate for the confirmation; the existing rows
  now assert the pair.
- **D-3** A first check without a choice is importable with the profile it was planned with (`confirmChoiceOf`): the
  default with `baseRevision: null`, or the stored profile with its revision (§ 6.2). Sending no choice would let a
  profile stored meanwhile apply silently.
- **D-4** The reload after a 409 never shows an importable report (the user's working profile and the reloaded stored
  one differ until the user chooses); a new "Previzualizează" is required (§ 6.6 "previews again").
- **D-5** A new file or another producer resets the editor; the sheet and variant names keep it (a profile is per
  producer; the keys belong to the file).
- **D-6** The admin reads `GET /categories` for a found category's slug and name — the dry run carries only ids
  (`previewDrafts`). No backend change; § 2 explains why the stored slug equals the plan's.
- **D-7** Filter-mode editing: a label change carries its mode; modes of keys no rule writes are dropped
  (`pruneModes`); a collection key leaves `specKeys` (the backend refuses it in both). Positions of rules are kept so an
  unchanged profile stays canonically equal (no revision bump, design B-4).
- **D-8** Labels are not validated in the admin: the backend's `checkProfile` answers 400 and the message is shown (it
  is the authority, as for every other rule of this form). A proposed label that equals a column key would be refused
  that way; the checked-in files of the three producers have none (EXECUTED: `grep -ciE '(colecție|unitate|împachetare|comandă minimă)[[:space:]]*:'`
  over `backend/test/unit/fixtures/glam/{boen-PL.csv,itc/*.csv,alpod/*.csv}` → 0 lines; other spellings that the
  backend's `norm` makes equal to a column key are not covered by that grep).
- **D-9** The prose is shown as text, via the pure `proseParagraphs` (iteration 1; iteration 0 used `DOMParser` in the component, untested — review-0 R5), never as HTML.
- **D-10** The grouping hint counts PRODUCTS whose name ends in a number (the dry run carries product titles, not row
  names); the design's example counts rows ("531 of 536 names").

## 8. Debt, findings and follow-ups

- **Restated, not shared** (each is a display rule or a contract string that lives in another app and is not in
  `packages/shared`): `attributeRows` (the joined rows of `SitePage.tsx` `ProductAttributes`, 1b); `COLUMN_ATTRIBUTE_KEYS`
  (backend `glam/profile.ts` `COLUMN_ATTRIBUTE`); the three facet-panel strings of `SitePage.tsx`; the trailing-number
  test of the grouping hint (backend `applyProfileToRows`, used only for a hint). FU-1: move `attributeRows` and the
  column keys to `packages/shared` when a third user appears or the next shared slice touches them.
- FU-2: the dry-run DTO types are restated from the backend (`ProfileReport`, `SpecKeyAnalysis`, `SheetReport`); they
  could move to `packages/shared` with the response schema (a shared change, outside this slice).
- FU-3: `GlamProfileEditor.tsx` is 1,043 lines; split the preview layout into its own file when the next slice touches it (the packet allows at most two new files in this one).
- FU-4: the dialog's existing English copy (incl. "Check the file", "Confirm the import") — translate in one pass.
- Finding F-1C-1 (pre-existing, not changed): `GET /categories` and `GET /products` read ONE DynamoDB page (no
  `LastEvaluatedKey` loop, `backend/src/categories/list.ts`). On a site with more than ~1 MB of categories a found
  category can be missing from the list; its panel then says so ("nu este în lista de categorii").

## 9. Not determined

- The look and the behaviour in a browser: no DOM test exists in admin and none may be added; the components were
  typechecked and built, not rendered (NOT RUN). The staging run (§ 10) is the first rendering.
- Whether the producers' image hosts allow hot-linking from the admin origin (BOEN's do not load at all, `cat-images-1.md`
  § 7 — stated in the UI).
- The dry-run size and time with `siteProducts` on a three-producer tenant (1a § 17 item 3: BOEN 874,250 B).

## 10. Staging checklist for 1c (operator-run, tenant `cm1-catalog`; design § 7.5 items 2, 4, 5)

1. **(item 2) BOEN with the human's profile.** Admin → Products → Import → glam: choose `PL.csv`, producer BOEN, "Check
   the file". Expect: "Niciun profil salvat"; key table with 13 keys and the § 4 hints; preview: "437 produse — primele
   24", product page of the product with the most options, three panels (`/category/boen`, one collection, `/shop`).
   "Folosește propunerea", set the labels, `Certificates` / `Nordic swan` → `niciodată`, `Style` → "împarte la virgulă",
   `Dimensions (mm)` → "doar în text"; "Previzualizează": the BOEN panel lists the chosen labels with counts and no
   `Certificates`; a product whose `Format` has two values shows one joined row. "Confirm the import": 437 products; the
   API shows `IMPORTPROFILE#glam#boen` revision 1 (`aws dynamodb get-item`), every BOEN product with
   `importProfileRevision: 1`; independent counts for the `/category/boen` panel by `aws dynamodb query` (as in
   `cat-facets-1-impl.md` closeout) equal the admin's preview counts and the site's panel.
2. **(item 4) ALPOD, `colecție` → `mereu`.** Import each ALPOD sheet with the ALPOD profile; after the first sheet, the
   next sheets load "Profil salvat: revizia n"; `/shop` shows `colecție` with its values, closed by default (> 10). The
   staging tenant holds 2 ALPOD products today (packet § 0), so the full 21-sheet run needs the ALPOD files.
3. **(item 5) MCP.** `import_glam_pricelist` dry run for BOEN → summary `Profil: stored, revizia 1`; counts equal the
   admin's. Needs a staging service key (1a § 17 item 2: the operator machine's MCP targets prod).
4. **409 path (§ 6.6), optional:** open the dialog in two tabs on the same producer; import in tab A with a changed
   profile; in tab B (loaded before) "Confirm the import" → the Romanian 409 message, the editor shows "Profilul a fost
   schimbat de alt import (revizia n)"; "Previzualizează" again, then import.
5. **Unsupported state, optional:** only reachable with a stored profile this importer cannot parse (e.g. written by
   hand with `version: 2` — a write to the staging tenant, the operator's choice).

## 11. Iteration 1 — review-0 `revise`: corrections by defect class

| Finding | Defect class | Rule that closes the class | Where | Units (new) | Control |
|---|---|---|---|---|---|
| R1 sheet states stale after an import | the editor keeps facts from an answer that a later answer supersedes | **every answer that reports the stored profile and the sheet states refreshes the editor** — the 200 execution answer AND the 503 "incomplete" (it wrote the products and saved the profile; `incompleteImportReport`); other failures change nothing | `editorAfterImport(editor, { profile, sheets })`; reducer `import-done`, new event `import-incomplete` | new revision → the other sheet `stale` listed at once; unchanged re-import → all `current`, nothing listed; 503 with `profile`+`sheets` refreshes, a gateway 503 / a 500 / `import-failed` do not | N1 (sheets not taken from the answer): 2 rows red |
| R2 preview selection kept across reports | local UI state that outlives the report it was chosen on | **every preview choice is checked against the report it is shown with**; a value the report no longer holds falls back to the default | `effectivePreviewChoice` (pure); `ImportPreview` stores only the WANTED values | `new:boen-classic` → stored id with no input edit: the obsolete reference lists 0, the effective one lists the draft; missing product → default | N2 (stale reference kept): 2 rows red |
| R3 fidelity limits not in the UI | a ruled limit stated in the design but not to the user | **every § 5.3 limit is one sentence of `FIDELITY_LIMITS`, rendered under the ruled notice**: theme/layout, snapshot (other users' or imports' product changes, URL prefixes changed later), UTC date window, the `/_site/<id>/…` budget limit, images | `glamPreview.ts:234`; `ImportPreview` | one row pins each limit | — |
| R4 copy that promises more than the mechanism | user-facing claims wider than the backend / facet contract | iteration 1: the claims with a condition became exported constants (`movedNotice`, `FILTER_MODE_HELP`, `SAVE_RULE`) pinned by units, and the rest of the copy was qualified (unsupported-replacement lines, the equality hints "fără spații și „mm”", the repeat-rule hint "pentru produsele acestui fișier", the collection fallback, the trailing-number option, the first fidelity line). **Incomplete — review-1 found that the new texts of `movedNotice` and `FILTER_MODE_HELP` still overstated the rules (§ 12); their iteration-1 wording is superseded and is not repeated here.** | `GlamProfileEditor.tsx` copy constants | the iteration-1 copy rows (replaced in § 12) | — |
| R5 prose transformation untested | behaviour inside a component, outside the node-testable seam | **the transformation is a pure exported function for the importer's exact format**; the component only renders its strings | `proseParagraphs` (`glamPreview.ts:266`); `ProseText` uses it; `DOMParser` removed | paragraph per line with all five escapes (incl. `&amp;lt;` → `&lt;`), literal `<script>` text stays text, any other form returned whole and undecoded | N3 (`&amp;` decoded first → double decoding): 1 row red |

Controls N1–N3 EXECUTED (each alone on a copy-backed file; files restored, sha256 re-checked OK;
`/tmp/CAT-IMPORT-PROFILE-1C-mutation` removed). Iteration-0 controls M1–M5 (§ 4) were not re-run; the code they
mutate is unchanged.

## 12. Iteration 2 — review-1 `revise`: finish R4, complete the ripple

**Defect class:** a sentence that restates a rule owned by another module (the shared facet function, the backend
acceptance rule) stated part of it as the whole — absolute words ("only", "every case", "does not appear") where the
rule has exceptions — and a test that pinned the sentence without checking it against the rule.

**Rule that closes the class** (stated in the code, `GlamProfileEditor.tsx` above `movedNotice`): a sentence that
restates a rule owned elsewhere is scoped to the part of the rule it restates — which facet kind, and the OFFER or the
VISIBILITY step — and names every exception of that part; each such sentence has counterexample rows computed by the
module that owns the rule (`buildFacetListing` from `@amodx/shared`). A rule the admin cannot execute (the backend's
acceptance rule) is not restated: the sentence is bounded ("poate") and the record points to the backend's units.

| Review-1 counterexample | Copy now | Counterexample row (shared `buildFacetListing`) |
|---|---|---|
| A holds `Oak, Ash`, B holds `Oak` → Ash (1), Oak (2) listed: a universal value IS listed | `FILTER_MODE_HELP` (attribute OFFER only) no longer speaks of single values; `FACET_VISIBILITY_HELP` states the visibility test exactly: shown when a value is selected, or when offered and some proposed value is not held by every product | A/B witness → `[["Ash", 1], ["Oak", 2]]` |
| a SELECTED facet stays shown when its value covers the whole page | `FACET_VISIBILITY_HELP` names the selection clause | 3 products, `always`, all `Oak`: not shown; with `a.Esență=Oak` → shown, `[["Oak", 3]]` |
| the repeat thresholds do not apply to the variant facet | `VARIANT_MODE_HELP` (new): variants are offered without the repeat rule; `never` → not proposed, still matched | two distinct non-repeating variants → both offered; `variant: never` holder not proposed but matched by `varianta=120` |
| `movedNotice(null)`: the backend also accepts the explicit default when none is stored | `movedNotice` is bounded: "Importul poate fi refuzat; dacă este refuzat, nu se schimbă nimic…" for every revision value | row asserts the bounded text for `2` and `null` and the absence of "va fi refuzat" / "acceptat numai"; the admin does not block the import. The acceptance cases themselves are backend units: `glam-profile.test.ts` "a choice equal to DEFAULT_PROFILE while none is stored stays unprofiled" and "acceptance: baseRevision equal → … content equal → …", `glam-import-handler.test.ts` acceptance rows (OBSERVED by name, run in gate 4) |

Also under the rule: `FILTER_MODE_HELP` now names the non-silent scope of the repeat rule ("fără produsele marcate
„niciodată”"; row: two silent holders + one automatic → not offered, yet a chosen `Oak` lists the 2 silent holders) and
the `always` holder condition ("unde un produs importat cu acest profil are cheia"; row: 1 holder of 3 → offered and
shown); `SAVE_RULE` says "un import acceptat" (a refused import saves nothing). The same audit of the record found § 2's
"another import stores a profile → 409" too wide: the backend accepts it when the stored profile equals the default;
§ 2 now says so.

**Ripple completed:** § 2 (the moved notice "MAY be refused"), § 6 (copy inventory = the code), § 11 (the R4 row no
longer repeats the superseded wording), the `ImportPreview` comment (a new report of the same revision keeps the wanted
values that it still holds; others fall back — it no longer says "starts from the defaults"), `admin/ARCHITECTURE.md`
(the list of pinned copy constants). Line references of § 1 refreshed.

## 13. Operator closeout (operator, 2026-10-31)

**Review.** review-0 revise, review-1 revise (R4 copy), review-2 **approved** (builder claude-opus-5-5, reviewer codex
gpt-6.1-sol).

**Gates (operator, approved candidate, bare exit codes, `ALL GATES GREEN`).** build 0; typecheck 0; `packages/shared`
196; backend unit 1,133 + 1 skipped; renderer unit 104; `test:serving` 71 / 0; `test:serving-bundle` 58 / 0;
`test:interest-e2e` 5 passed; admin **116**; MCP 11 / 0; infra 61; `git diff --check` 0; no change under `backend
renderer infra tools packages`; changed paths: `GlamPricelistImport.{tsx,test.ts}`, new `GlamProfileEditor.tsx`,
`glamPreview.{ts,test.ts}`, `admin/ARCHITECTURE.md`, this record.

**Staging CDK diff and deploy.** 0 resources added or removed; the admin asset and its runtime config redeploy; the
renderer functions change code only (bundle id). `cdk deploy` → `AmodxStack-staging` ✅.

**Staging evidence — through the deployed admin UI (Playwright, `https://admin.staging.amodx.net`, the `.env.test`
staging admin; screenshots in `.agent-manager/slices/CAT-IMPORT-PROFILE-1C/operator/`, gitignored).**
1. Site "CM1 Catalog" → Products → Import CSV → "Listă de prețuri (glam)": BOEN `PL.csv`, producer BOEN, sheet PL,
   "Check the file" → report 437 / 455 / 23 / 157 imageless; "Niciun profil salvat"; the key table with 13 keys, each
   with its measured facts and hints ("diferă între opțiuni în 7 produse", "listă cu virgule în 201 rânduri",
   "o singură valoare", "egal cu eticheta variantei … în 258/310 rânduri").
2. "Folosește propunerea"; operator's provisional edits (the human sets the real labels on prod): Wood → `Esență`,
   Treatment → `Finisaj`, Style → "împarte la virgulă", Dimensions (mm) → "doar în text", Certificates and Nordic swan →
   "niciodată". "Previzualizează" → the fidelity notice and limits; "437 produse — primele 24" cards (BOEN images show
   broken — their producer addresses are dead, as the notice says); one product page; three panels
   (`/category/boen` 437, collection "Herringbone light" 11, `/shop` 441) with `Esență` Ash (12), Beech (4), Maple can.
   (4), Oak (250), …
3. "Confirm the import" → `IMPORTPROFILE#glam#boen` revision 1; 437 / 437 BOEN products `importProfileRevision: 1`.
   (The operator's script waited for an "Imported:" line that the page does not keep after the list reloads; the
   database is the evidence.)
4. Live site `/_site/cm1-catalog/category/boen`: 11 attribute facets shown (colecție 27, Connection 2, Esență 5,
   Finisaj 8, Floor Heating 3, Format 11, Product type 2, Surface 17, Appearance 5, Color 31, Style 4 — split), every
   count equal to an independent `aws dynamodb query` count; Certificates and Nordic swan not shown (`never`);
   Dimensions (mm) not a facet (`prose-only`).
5. NOT RUN: ALPOD 21-sheet run (§ 10 item 2), MCP with a stored profile (needs a staging service key), the optional
   409 and unsupported paths. The staging BOEN profile (revision 1, provisional labels) is left in place as test data.

**Findings for the human (not fixed):** the glam import dialog mixes English (pre-existing: "Check the file",
"Confirm the import", "File", "Producer", the report) with the new Romanian profile section; the label inputs are
narrow ("Product ty", "Connectio" are cut off). Staging holds dozens of leftover "E2E Test Site" tenants.

**Correction to § 13 "Gates" (operator, 2026-10-31).** The list of changed paths omits `admin/src/lib/api.ts`. That
change is allocated (packet: `admin/src/lib/**` "only if an existing helper must be extended (name it)") and named by the
builder (§ 1 step 3, § 5 `ApiError`: the 409 path reads `storedRevision`; `message` unchanged for existing callers). The
operator's gate printed only the `admin/src/components/` paths; the omission is in the operator's sentence, not in the
candidate.
