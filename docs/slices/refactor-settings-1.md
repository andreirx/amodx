# REFACTOR-SETTINGS-1 — `admin/src/pages/Settings.tsx` into one file per section (moves only)

- **Status:** IMPLEMENTED 2026-11-27 — built, operator gates pending (staging: every card present, one save round trip)
- **Track:** maintenance (order of work from 2026-11-27, `docs/ROADMAP.md`: the second of the pure-move refactor
  slices, before Track B)
- **Depends:** none
- **Source plan:** none. Ratified by the human's order of work of 2026-11-27 ("add a slice for refactoring the … big
  files … before moving on to a consequential track like the private commerce table"). ROADMAP row
  `refactor-settings-1`. No ratification-class decision.
- **Maturity:** unchanged (a move changes no module's maturity).

## Purpose / risk retired

`admin/src/pages/Settings.tsx` held 2,666 lines at the start of the slice (the ROADMAP row said 2,595): about 25
settings cards, their pure helpers and the page component. Nearly every slice that adds a setting edits it. After this
slice each section has its own file under `admin/src/pages/settings/` and the page composes them. The owner sees the
same screen: the same cards, in the same order, with the same texts, and the same Save. The next track (the private
commerce table) adds commerce settings; it finds them in `settings/Commerce.tsx` or `settings/Payments.tsx`.

## Scope

1. The cards of the page, the pure helpers and the module-level declarations move, with their comments, into the
   files of § *File map*. JSX is re-indented (JSX drops whitespace that holds a line break; the markup oracle shows the
   markup is unchanged).
2. A moved card receives what it reads today as props, by the names the page uses today (`config`, `setConfig`,
   `updateHeader`, `updateIntegration`, `updateTheme`, …), the pattern the file already used for `MailerLiteCard` and
   `ContactChannelsCard`.
3. `Settings.tsx` keeps the page: the state, the two effects, load and save, the custom-theme load/save/delete, the
   closures `updateHeader`, `updateIntegration` (used by sections in two files), `updateTheme` (see the closure rule)
   and `handleLogoUpload` (it sets the page's `loading`), and the composition. It re-exports every name it exported
   before.
4. Docs: `admin/ARCHITECTURE.md` (file map, the rule "a new setting goes in its section file"), `docs/TECH-DEBT.md`
   (§ *Split Settings page into sections*), the forward-looking pointers to `Settings.tsx` in plan docs, ROADMAP row,
   `CURRENT_SLICE.md`.

## Non-scope

No rename of an exported name, no change of a text, a class name, an element, the order of cards, a default, a save
payload or a request. No new feature, no UI library, no state-management change (no context, reducer or store), no
lazy loading or dynamic import (the admin stays one Vite bundle). The existing tests (`Settings.test.ts`,
`Settings.scheduling.test.ts`, `Leads.newsletter-1.test.ts`) are not edited. A defect found on the way is recorded in
§ *Findings, not fixed*.

## Architectural boundaries

- The admin is a client-only SPA that talks to the backend through `apiRequest` only; this slice changes no request,
  no route and no payload (proof 1 pins the requests and the Save bodies).
- Module graph inside `admin/src/pages/`: `Settings.tsx` → `settings/*`; no section file imports `Settings.tsx`
  (a DAG; § *File map*). The public surface of the page module is unchanged (§ *Imports*).
- Tenant isolation, the no-scan rule and the dependency rule are not touched: no backend, shared or infra file changes.

## Rules applied to each move

- **Conditions stay at the call site.** A card shown under a condition (`config.commerceEnabled && …`, `isAdmin && …`,
  the catalog/commerce ternary) keeps its condition in the page; the section file holds the card only. The page then
  shows in one place which cards depend on what.
- **Slots stay.** Every card keeps its place among its siblings, and the three fragments of the page (Commerce or
  Catalog + Scheduling; Contact channels + Notifications; MailerLite + Research) stay fragments in the page. React
  derives `useId` values from the tree's child positions; a component that calls no `useId` adds no position, so the
  ids the server-render captures of `Settings.test.ts` pin do not move. The new components call no hook except
  `LanguageListControls` (its existing `useState("")`).
- **Comments between cards stay in the page**, above the call site (they describe the slot or the condition);
  comments inside a card move with it.
- **Closures (ruling 5 applied to functions).** A closure of the page moves into a section file when only that file's
  sections use it and it needs nothing but their props (`updateUrlPrefix` → `UrlPrefixesCard`; `applyPreset` →
  `ThemeCard`; the seven link-list closures → `Menus.tsx`, shared by its two cards through `linkEdits`); a closure that
  sections in two files use, or that writes page state other than `config`, stays in the page and is passed down by
  its current name. One recorded exception: `updateTheme` (only `Theme.tsx` uses it) stays beside `activeTab` and
  `activeConfig`, so the theme tab's read rule and write rule stay together where `Settings.test.ts` and
  `admin/ARCHITECTURE.md` name them.
- **Reads at render.** `getRendererUrl()` and the preview link moved into `SiteIdentityCard`; they read
  `window.AMODX_CONFIG` when the card renders instead of when the page renders (no hook; the same render; same value).
- **Helpers (ruling 1).** A pure helper moves with the section that uses it; the one declaration used by every
  section file, the `SettingsDraft` type, goes to `settings/draft.ts`.

## File map (ruling 1) — proposed before the move, built as proposed

Line counts after the build (`wc -l`, EXECUTED): `Settings.tsx` 383 (was 2,666); `draft.ts` 12, `ColorInput.tsx` 17,
`SchedulingSwitch.tsx` 35, `Contact.tsx` 117, `UrlPrefixes.tsx` 121, `Privacy.tsx` 137, `Payments.tsx` 196,
`Integrations.tsx` 226, `Languages.tsx` 231, `Identity.tsx` 261, `Menus.tsx` 263, `Commerce.tsx` 293, `Theme.tsx` 321,
`NavbarLayout.tsx` 376. Each file starts with two comment lines (what it holds; "a new setting of this section goes in
this file"; moved by this slice). Module graph: `Settings.tsx` → every section file; section files → `draft.ts`;
`Theme.tsx`, `NavbarLayout.tsx` → `ColorInput.tsx`; `Menus.tsx` → `Languages.tsx` (`languageName`). No section file
imports `Settings.tsx` (a DAG; OBSERVED from the generated import lines).

| File | Holds (old `Settings.tsx`) |
|---|---|
| `settings/draft.ts` | `SettingsDraft` and its doc comment (the comment stood displaced above `mailerLiteDraft`) |
| `settings/ColorInput.tsx` | `ColorInput` (used by `Theme.tsx` and `NavbarLayout.tsx`) |
| `settings/Identity.tsx` | `getRendererUrl`, the preview link; cards Site Identity, Company Details, Legal Links |
| `settings/NavbarLayout.tsx` | `HEADER_WIDTH_OPTIONS`, `PAGE_WIDTH_OPTIONS`, `withFooterKey`, `withHeaderKey`, the five header and footer control groups, `CategoryOption`; card Navbar & Layout |
| `settings/SchedulingSwitch.tsx` | card Scheduling (the switch and the time zone) |
| `settings/Commerce.tsx` | `COMMERCE_BAR_DESCRIPTION`, `COMMERCE_BAR_FALLBACK_NOTE`; cards Catalog, Commerce, Commerce Bar, Product Search, Order Celebration |
| `settings/Payments.tsx` | cards Digital Sales (Paddle), Payment Methods, Bank Transfer Details |
| `settings/UrlPrefixes.tsx` | card URL Prefixes (with the page's `updateUrlPrefix`, its only user) |
| `settings/Contact.tsx` | `withContactForSave`; cards Contact channels, Notifications |
| `settings/Menus.tsx` | `linksFor`, `withLinksFor`, `MenuLanguageSelect`, the page's seven link-list closures; cards Footer Links, Navigation Menu |
| `settings/Languages.tsx` | `localeStatus`, `withSiteLanguage`, `withCountry`, `languageName`, `draftLanguages`, `withLanguageAdded`, `withLanguageRemoved`, `LanguageListControls`; card Language & Country; the Country apply dialog |
| `settings/Integrations.tsx` | `mailerLiteDraft`, `MailerLiteCard`; cards Analytics, Identity (Google OAuth), Research |
| `settings/Privacy.tsx` | cards Cookie Consent (GDPR), Bot Protection (reCAPTCHA v3) |
| `settings/Theme.tsx` | `withThemeKey`, `ThemeKeySetter`, `EXTRA_FONT_WEIGHTS`, `TypographyDetails`, `ThemeColorDetails`, `ShapeAndCards`; cards Typography, the light/dark tab switch, the theme card (with the page's `applyPreset`, its only user), Interface, Page Background Effect |

`ServiceKeys` is already its own component (`components/ServiceKeys.tsx`) and is not moved.

## State and hook decisions (ruling 5)

- `config`, `loading`, `saving`, `error`, `secretsLoaded`, `mailerLiteStored`: page — load and save.
- The two `useEffect`s (load on tenant change; secrets once per load): page, unchanged.
- `pendingPackCode`: page — written by the Language & Country card, read by the Country apply dialog (two sections).
- `activeTab`: page — read by Typography, the tab switch, the theme card and Interface (through `updateTheme`).
- `customThemes`, `isSaveThemeOpen`, `newThemeName`: page. Only the theme card reads them and their initial values do
  not depend on the config, so ruling 5 allows a move; they stay because the page unmounts every section while
  `loading` is true (the logo upload sets it), and a state inside the card would then be reset (a custom theme saved in
  this visit would leave the preset list after a logo upload) — a lifetime change.
- `categories`: page — its value comes from the page's load effect.
- `linkLanguageChoice`: page — read by Footer Links and Navigation Menu (two sections).
- `LanguageListControls`' own `candidate` state: moves with its component, unchanged.

## Migration / deployment notes

- **Data migration:** none. No stored attribute, key, schema or default changes; the Save body of every proof state
  is byte-identical before and after (proof 1).
- **Deployment scope:** the admin static bundle only (`admin/dist`, uploaded by `infra/lib/admin-hosting.ts`
  `BucketDeployment` `DeployAdmin`, CloudFront invalidation `/*`). No Lambda, route, permission, table or
  renderer change. A normal stack deploy rebuilds the other bundles from unchanged sources.
- **Rollback:** revert the slice's commit, rebuild (`npm run build`) and deploy again; `DeployAdmin` replaces
  `index.html` and the invalidation serves the previous bundle. `prune: false` keeps the old hashed asset files in the
  bucket, so a browser that still holds either `index.html` loads a complete bundle. No data to restore.
- **Operator gates (NOT RUN by the builder):** at closeout, on staging in a real browser, the Settings screen shows
  every card, and one Save round trip on the test site succeeds.

## Definition of Done

- Every card, helper and declaration of the base `Settings.tsx` is in the file named by § *File map*; `Settings.tsx`
  holds the page only and re-exports every name it exported before.
- Proof 1: the 31 snapshot files are byte-identical to the baseline (hashes in § *Build record*).
- Proof 2: `Settings.test.ts`, `Settings.scheduling.test.ts` and `Leads.newsletter-1.test.ts` pass unedited.
- The five packet gates exit 0; docs updated (§ *Scope* item 4); the operator gates above pass.

## Evidence required

- EXECUTED by the builder: the baseline run on the untouched tree with its hashes; after each move step the admin
  typecheck, the snapshot test and the Settings tests; the negative controls; the five gates (§ *Build record*).
- OBSERVED by the operator before SHIPPED: the staging screen check and one Save round trip.

## Exit criterion

A new setting is added in one section file of at most about 400 lines plus, for a new card, one call in
`Settings.tsx`; Track B (the private commerce table) adds its settings in `settings/Commerce.tsx` or
`settings/Payments.tsx`.

## References

- `docs/ROADMAP.md`, order of work from 2026-11-27, row `refactor-settings-1`.
- `docs/slices/refactor-shared-1.md` (the first pure-move slice; same moves-only rule).
- `admin/ARCHITECTURE.md` § *Internal Structure* (`Settings.tsx`, `settings/`, `__markup__/`).
- `docs/testing-strategy.md` (test layers); `Settings.test.ts` (server-render captures, CAT-ADMIN-1).
- `docs/TECH-DEBT.md` § *Split Settings page into sections*.

## Proofs

1. **Markup and Save oracle (rulings 3 and 4)** — `admin/src/pages/Settings.markup.test.ts`, written and run on the
   untouched tree before any move. It mounts the real page in jsdom (as `Settings.scheduling.test.ts` does; no new
   library) with `@/lib/api` answering per state, waits for the load, and stores to
   `admin/src/pages/__markup__/refactor-settings-1/`: the page's DOM after the load, after each listed interaction
   (dark tab; Save Theme dialog → a custom theme listed and applied; Country apply dialog → Apply; the menu-language
   selector; MailerLite Disconnect), the PUT /settings body of Save, the request list, and a sweep (every enabled
   field changed by its position, every "Add…" button clicked, then the DOM and the Save body). States: `empty` (a new
   site, admin), `shop` (commerce, every optional section filled, admin, MailerLite stored, secrets merged, categories
   loaded), `lang` (Romanian default + two languages, an own menu for one, a rule message, categories failed),
   `catalog` (editor, separate interest-list address, a locale that falls back), `shop-bare` (commerce on, bar off, no
   bank transfer, empty link lists). Why jsdom and not the server render of `Settings.test.ts`: the server render runs
   no effect, so the MailerLite "stored" flag, the merged secrets, the loaded categories and the custom themes are out
   of its reach.
2. **Server-render captures** — `Settings.test.ts` (not edited) still compares two server renders byte for byte with
   `__markup__/settings.*.html`, which also pins the React `useId` paths.
3. **Imports (ruling 2)** — every importer of the page module keeps working without an edit (§ *Imports*).
4. **Gates** — § *Build record*.

## Imports (ruling 2)

Basis: `grep -rnE "pages/Settings|from ['\"]\.\.?/Settings['\"]"` over the repository's `*.ts`, `*.tsx`, `*.js`,
`*.mjs`, `*.json` (without `node_modules`, `dist`, `.git`, `.next`, `.open-next`), and `grep -rn "import(.*Settings"
admin/src` (no dynamic import) — EXECUTED 2026-11-27, deterministic text search. Importers:

| File | Imports |
|---|---|
| `admin/src/App.tsx` | default `SettingsPage` |
| `admin/src/pages/Settings.test.ts` | default + `localeStatus`, `withCountry`, `withSiteLanguage`, `withContactForSave`, `withThemeKey`, `withFooterKey`, `withHeaderKey`, `TypographyDetails`, `ThemeColorDetails`, `ShapeAndCards`, `FooterWidthControl`, `FooterColorControls`, `HeaderColorControls`, `HeaderTaglineAndCategoryBarControls`, `FooterBrandAndColumnsControls`, `HEADER_WIDTH_OPTIONS`, `PAGE_WIDTH_OPTIONS`, `LanguageListControls`, `MailerLiteCard`, `MenuLanguageSelect`, `languageName`, `withLanguageAdded`, `withLanguageRemoved`, `linksFor`, `withLinksFor` |
| `admin/src/pages/Settings.scheduling.test.ts` | default |
| `admin/src/pages/Leads.newsletter-1.test.ts` | `mailerLiteDraft` |
| `admin/src/pages/Settings.markup.test.ts` (this slice) | default |

`Settings.tsx` re-exports every name it exported before the slice (a superset of the list above): also
`ThemeKeySetter`, `EXTRA_FONT_WEIGHTS`, `CategoryOption`, `draftLanguages`, `SettingsDraft`,
`COMMERCE_BAR_DESCRIPTION`, `COMMERCE_BAR_FALLBACK_NOTE`, `ContactChannelsCard`.

## Abstractions introduced

- `linkEdits` (`Menus.tsx`, not exported): the page's seven link-list closures, moved unchanged into one function;
  users `FooterLinksCard`, `NavigationMenuCard`; axis: none (logic shared by two sections of one file); rejected:
  passing the seven closures from the page (keeps menu logic in the page) or one copy per card (duplicates three).
- `settings/ColorInput.tsx`: users `Theme.tsx` (palette, `ThemeColorDetails`) and `NavbarLayout.tsx` (header and footer
  colours); axis: none; rejected: `NavbarLayout.tsx` importing it from `Theme.tsx` (a layout file depending on the
  theme file for one field).
- `settings/draft.ts` and the 29 card components: mandated by ruling 1; each card has one user (one call in the page).
  Plain composition; no interface, no polymorphism, no context.

## Findings, not fixed

- **F-RS1-THEMES-NOT-LOADED.** `loadCustomThemes` runs only after a theme is saved or deleted (`grep -n
  loadCustomThemes` → the definition and two calls in `saveCurrentTheme` / `deleteTheme`; OBSERVED). The saved custom
  themes are never listed when the page opens; the owner sees them only after saving a new one in the same visit.
- **F-RS1-INTERFACE-READS-LIGHT.** The Interface card shows `config.theme.radius` / `config.theme.mode` but writes
  through `updateTheme`, which writes `darkTheme` on the dark tab (OBSERVED in the code): on the dark tab the field
  shows the light value while an edit changes the dark theme. Same class as review-0 R-CT-3 of CAT-THEME-1.
- **F-RS1-MODE-TODO.** The owner sees the label "Mode (TODO: implement it)" (Interface card; OBSERVED in the markup).
- **F-RS1-DUP-FONT-FIELDS.** The theme card's light-tab "Typography" group repeats the Heading and Body font inputs of
  the Typography card, with `value={activeConfig?.fontHeading}` without the `|| ""` the Typography card uses (an absent
  value leaves the input uncontrolled).
- **F-RS1-SETLINKLANGUAGE-NAME (false name).** `setLinkLanguage` sets `linkLanguageChoice`, not `linkLanguage`: the
  page derives `linkLanguage` from the choice and falls back to null when the chosen language left the list. Proposed
  rename: `setLinkLanguageChoice` (the page's state setter and the `setLinkLanguage` prop of `FooterLinksCard` /
  `NavigationMenuCard`; local to the admin, but this slice renames nothing).
- **F-RS1-STALE-MARKER.** The page keeps the comment `COUNTRY, LOCALE & CURRENCY — moved to general section (before
  GDPR)` at the old place of that card (a comment only; kept because comments between cards stay in the page).
- **F-RS1-RENDERER-COMMENT.** `renderer/test/unit/cat-variant-gallery-1-header-clearance.test.ts:151` cites
  "admin/src/pages/Settings.tsx, the two height selects"; they are in `settings/NavbarLayout.tsx` now. A comment in
  another package's test; not edited by this slice.
- `admin/src/pages/Settings_tsx_MAP.md` (git-ignored, generated by rmap) is stale (3 symbols, old line numbers); not
  edited (ruling 7).

## Deviations

- **Ruling 3 "commit the snapshots … as the baseline":** nothing is committed (the packet's "Do NOT commit"). The
  baseline is fixed by its sha256 list, recorded before the first move (below) and compared after every step; every
  post-baseline run used `CI=1` (Vitest then never writes a snapshot) and the files' hashes did not change. The 31
  files are untracked in the worktree; the reviewer re-runs `shasum -a 256` against the list.
- `ColorInput` gained `export` (it is now used from two files); it is not re-exported from `Settings.tsx` (it was not
  exported before).

## Build record

Builder `claude-opus-5-5`, 2026-11-27, base `31112cb`, tree clean at the start. Detailed log:
`.agent-manager/slices/REFACTOR-SETTINGS-1/build-progress.md` (git-ignored).

1. **Baseline (EXECUTED).** `Settings.markup.test.ts` written and run on the untouched `Settings.tsx`: 31 snapshot
   files written, 10 tests passed; two more runs with `CI=1`: 10/10, hashes unchanged. On the untouched tree
   `Settings.test.ts` + `Settings.scheduling.test.ts`: 72 tests passed; admin `tsc -b --noEmit --force`: exit 0.
2. **Moves (EXECUTED).** A throwaway generator regenerated `Settings.tsx` and `settings/*` from the base file with steps
   1..N applied (imports derived from each file's identifiers through the TypeScript AST); after EACH of the 14 steps
   (one file each, in the order of the file map, `Theme.tsx` last): admin `tsc -b --noEmit --force` exit 0; `CI=1
   vitest run` of `Settings.markup.test.ts`, `Settings.test.ts`, `Settings.scheduling.test.ts`,
   `Leads.newsletter-1.test.ts`: 85/85 passed; the 31 hashes identical to the baseline.
3. **Moves only (EXECUTED).** Multiset of trimmed non-empty lines, base `Settings.tsx` vs `Settings.tsx` + `settings/*`:
   the base lines not carried over are only the old import lines, the IIFE wrapper of the Language & Country card,
   the `{isAdmin && <Card>` / `</Card>}` ends of the Google OAuth card (the condition is at the call site) and `function
   ColorInput` (now `export function`). The added lines are only imports and re-exports (107), file headers (29),
   component doc lines (29), signatures (29), call sites (29), `return (` / `);` / `}` of the wrappers, the stripped
   `<Card>` / `</Card>` of the Google OAuth card, and the 6 lines of `linkEdits` (doc, signature, return) and its two
   destructurings.
4. **Negative controls (EXECUTED).** One placeholder byte changed in `Commerce.tsx` → 3 tests fail; the Bank Transfer
   IBAN key renamed in `Payments.tsx` → 2 sweep tests fail (the Save body); both reverted by regenerating; hashes
   unchanged.
5. **Gates (EXECUTED, exit status):** `npm run build` 0; `npm run typecheck` 0; `cd admin && npm run test:unit` 0 (33
   files, 499 tests); `cd packages/shared && npm test` 0 (33 files, 662 tests); `git diff --check` 0, and every new
   file checked with `git diff --no-index --check /dev/null <file>` (clean). Also `cd tools/mcp-server && npm test` 0
   (23 pass; no backend route changed). No dynamic `import(` in `Settings.tsx` or `settings/` (grep, none); the admin
   build emits one main chunk and the two small chunks of the plugins' existing dynamic import of `@amodx/effects`
   (INFERRED from the chunk names; no baseline build was compared).
6. **Iteration 1 (review-0 F-RS1-REVIEW-1, EXECUTED).** The spec lacked the required section "Migration / deployment
   notes" of `docs/documentation.md` § *Required Slice Sections*. Class: a required template section absent. Rule
   applied: every required section of that list is present — added Architectural boundaries, Migration / deployment
   notes, Definition of Done, Evidence required, Exit criterion, References. No code change. Re-verified on the
   unchanged code: the 31 hashes equal the list below (`shasum -a 256` vs the list); `CI=1` focused suite 85/85; gates
   `npm run build` 0, `npm run typecheck` 0, admin `test:unit` 0 (33 files, 499 tests), shared `npm test` 0 (33 files,
   662 tests), `git diff --check` 0, the 47 new files clean.
7. **NOT RUN:** the operator's staging check (closeout: the Settings screen in a real browser, every card present, one
   save round trip on the test site); `npm run lint` (not a gate of this packet).

Snapshot hashes (sha256, `admin/src/pages/__markup__/refactor-settings-1/`), the same before the first move and
after the last:

```
bf31a9e9bc61374446da66209eb52d5bbecc2b22e1281ebc4846979abe728ce4  catalog.loaded.html
df1c3720bfb9356d1b799cdf0a091a8e4e44055c05f4d78e191eb2f409588e17  catalog.requests.json
af2cc3aa4b7822ddebbb289de9ca474d3bf956110e891c9cfe576b5d6f916381  catalog.save.json
5655c11d83c55635d79e1c65876f967915f155cf1943ad1c765e456df1534b72  catalog.sweep.html
fcccd23e9fdaad231b998891e9aa88d07322c027aed2145d25e70b3be751f634  catalog.sweep.save.json
78711cedc65bef801fc5757583206bd09565affa805ae7042fdf73051723012c  empty.loaded.html
7606d77ed5eaf31ec4993159fe44a5744e5b0c31ec6579523a4904235582458d  empty.requests.json
e2b0a15353c9fa730c585fdf024a5deaceba7d7bc98c3e729b275a0f0878b320  empty.save.json
a8ae1f7b023953fed21733ff9138af77cd2ac3c78a582085e2f986bf5f5536cf  empty.sweep.html
8095f47ffb90e1e719a141be2a5d3a0eda6837589b32e16aa400605bc2bf9a5d  empty.sweep.save.json
ecd068fe9fe593c7b57bf50631ce4a0496c564c84894d7d279cab9f0623e39a2  lang.after-interactions.html
4b7532e4537155f7796967a8fbfd51134b35ecd5feefeddb87e1bd25d4144f02  lang.loaded.html
7606d77ed5eaf31ec4993159fe44a5744e5b0c31ec6579523a4904235582458d  lang.requests.json
08127714cca5703346dd14712f5b1c41e6c3c2003c81a713d3760343ee8e63d3  lang.save.json
f0db95ba2c0ba50621d51c26329d2095a25374b44d6491bc67ae4d712fcc656c  lang.sweep.html
214267917a71fc5d3d76b8f975e9d54fb1a6cc295d8f5fce5b7c4b1bb1269781  lang.sweep.save.json
1a21a35f5bdb41657afc6b0424dc4a743f220976e2cbe0f7c7da42235f5d9598  shop-bare.after-interactions.html
a3f3d6263e742048e4282a7e2446b18cdc0db65a0996455e453d9e2e469cb23a  shop-bare.loaded.html
7606d77ed5eaf31ec4993159fe44a5744e5b0c31ec6579523a4904235582458d  shop-bare.requests.json
b3e6ba1dc55ef43ddc9d22704e95b44098d5b5a5d1e2a3ad5b544f939a7e32fa  shop-bare.save.json
db97a18500f672e2acfdadb6742cfce82fec0db92ce597985835c457d3908a26  shop-bare.sweep.html
fb4df1a0c96fc35eefb334252c89940e89a317cae465b05a76dc47afb72b728b  shop-bare.sweep.save.json
de1b0a2767d1a076443e65229b3a49b33c648316ad3cb72497b00b59a42cc327  shop.after-interactions.html
32bb05912ac022870d2a726c1037d19ea4cb415f6214f856a70cae490639ba99  shop.country-dialog.html
a80dd12ac47e44a14c5153cc8ff06c2a9faa4829c35f01c36ed0d619fb256e08  shop.dark-tab.html
d6dfff3267bcfbf166d21c6ce53b46a429e07a12a1628995012963815bbef381  shop.loaded.html
a73b8d4236e1cfe5cb01ab08c949d399b9f74bdd18527f5692e3a4253e3f9886  shop.requests.json
6e36df7b3c77eae6f964cd39adb66c711b717d6f7fced73d89c2acc735b4c793  shop.save-theme-dialog.html
9ffb9566874a7bdd3fac5a9f5e02eb842ca4a182c52dc5f5681fb0c455e3aa47  shop.save.json
99888d3ed317520c10dff09a43c87f908f805ab71a44cda1dd8df43d0a38688f  shop.sweep.html
4aeed202fd4bd61772b437f6721689aab7ed07e88424ac65ef79556cb3f0da74  shop.sweep.save.json
```

## Closeout (operator, 2026-11-27)

- Relay: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, two cycles; review-1 `approved` (review-0 asked for the
  deployment, migration and rollback notes only).
- Operator's independent oracle: `Settings.tsx` of the commit before this slice (2,666 lines) put in place of the new
  one, `CI=1 npx vitest run src/pages/Settings.markup.test.ts` → exit 0, 10 of 10; the 31 capture files were not
  rewritten (one hash over all of them equal before and after); the new `Settings.tsx` put back (hash equal). The
  same test passes on the new page in the gate run. So the old and the new page produce the same 31 captures.
- Operator gates on the approved tree, each exit 0: build, typecheck, shared, plugins, renderer, serving,
  serving-bundle, admin unit, backend unit, infra, mcp, `git diff --check`; no change under `backend`, `infra`,
  `renderer`, `packages`, `tools`, a manifest, a lockfile or the two existing Settings test files.
- Staging diff (read before the deploy): 0 resources added, 0 removed, no IAM change; the admin bundle and the
  renderer rebuilt. Deploy: `AmodxStack-staging` succeeded.
- Staging proof, a real browser on the test site `cm1-commerce`: the 18 cards every site has are present; of the
  conditional cards, 9 are shown (Newsletter, Google OAuth, Research, Commerce Bar, Product Search, Order
  Celebration, Paddle, Payment Methods, Scheduling) and 2 are not (Catalog: the site is a shop; Bank Transfer
  Details: its condition is off). Save round trip through the screen: the changed Site Description is stored
  (PUT 200, read back by the API), then restored (PUT 200); no page error, no alert.
- Observation, not characterised: the FIRST Save through the screen in this proof also changed the stored
  `integrations` and `recaptcha` of the test site; a second complete run left the stored settings equal to the
  ones before it (except `updatedAt`). The Save bodies of the old and the new page are identical (the captures),
  so this is what Save did before this slice too. What a first Save writes there is not examined here.

