# SETTINGS-FINDINGS-1 — the Settings screen defects recorded by `refactor-settings-1`

- **Status:** IMPLEMENTED 2026-11-27 — built, operator gates pending (§ *Migration / deployment notes*). The spec
  (§ *Causes*, § *Expected capture changes*) was written before the first fix.
- **Track:** maintenance (order of work from 2026-11-27, `docs/ROADMAP.md`: after `refactor-renderer-reads-1`, before
  `ci-lockfile-1` and Track B)
- **Depends:** `refactor-settings-1` (the split page, its findings and its 31 captures)
- **Source plan:** none. Ordered by the human, 2026-11-27 (verbatim: "add slices to fix the settings screen, github
  actions"). ROADMAP row `settings-findings-1`. The defects come from `docs/slices/refactor-settings-1.md` § *Findings,
  not fixed* and § *Closeout* (the last bullet). That record is CLOSED; this spec cites it and does not edit it.
- **Maturity:** the admin Settings screen stays at its current maturity (a defect fix changes no maturity level).

## Purpose / risk retired

A site owner opens Settings in the admin. Today four things on the screen are wrong: the saved themes are not listed
until a new one is saved in the same visit; on the dark tab the Interface card shows one value and an edit changes
another; a label reads "Mode (TODO: implement it)"; the heading and body font fields appear twice. One more effect was
seen and not explained: a first Save through the screen changed the stored `integrations` and `recaptcha` of a test
site. The risk retired: an owner trusts a screen that shows values it does not write, and a Save that changes stored
data the owner did not touch. After this slice the screen shows what it writes, and the first-Save effect is explained
with a reproduction and a judgement.

## Scope (one item per finding)

1. **F-RS1-THEMES-NOT-LOADED** — the saved themes are loaded when the page opens.
2. **F-RS1-INTERFACE-READS-LIGHT** — the Interface card shows the value it writes.
3. **F-RS1-MODE-TODO** — the Mode control is removed from the screen (the stored value and the schema stay).
4. **F-RS1-DUP-FONT-FIELDS** — one pair of font fields (the Typography card's).
5. **F-RS1-SETLINKLANGUAGE-NAME** — `setLinkLanguage` → `setLinkLanguageChoice` (page setter and the card prop).
6. **F-RS1-STALE-MARKER** — the stale comment is removed.
7. **First Save writes `integrations` and `recaptcha`** — characterised by a reproduction; judged; fixed only if a
   defect (§ *Item 7*).

## Non-scope

No change under `infra/`, `renderer/`, `packages/shared` schemas, any `package.json` or lockfile. A backend change only
for item 7 and only if the characterisation shows a defect there (it does not: § *Item 7*). The admin UI stays English.
No new UI library, no state-management change. The closed record `docs/slices/refactor-settings-1.md` is not edited.
The new findings of § *Findings* are recorded, not fixed.

## Causes (with evidence; OBSERVED in the code at base `760df57` unless labelled otherwise)

1. **Themes not loaded.** `loadCustomThemes` (`admin/src/pages/Settings.tsx:132-139`) has two callers only:
   `saveCurrentTheme` (`:170`) and `deleteTheme` (`:179`). The load effect (`:72-77`) calls `loadSettings` and
   `loadCategories` only. Basis: `grep -n loadCustomThemes` → the definition and those two calls.
   What `GET /themes` requires: the route has the default staff authorizer (`infra/lib/api.ts:902-906`, no
   `authorizer` override), and `listHandler` (`backend/src/themes/manage.ts:43-54`) calls no `requireRole`. So every
   staff role (`GLOBAL_ADMIN`, `TENANT_ADMIN`, `EDITOR`) may call it, and the theme card is shown to every role (no
   `isAdmin` condition at `Settings.tsx:371`). The fix loads the list for every role. A failed load keeps today's
   behaviour: `console.warn`, an empty list, no error on the page.
2. **Interface reads the light theme.** `InterfaceCard` (`admin/src/pages/settings/Theme.tsx:262-295`) reads
   `config.theme?.radius` (`:276-277`) and writes `updateTheme("radius", …)`; `updateTheme` (`Settings.tsx:183`) writes
   `darkTheme` on the dark tab (`withThemeKey`, `Theme.tsx:30-34`). What the renderer does with `darkTheme`: nothing.
   Basis: `grep -rn "darkTheme"` over `renderer/src`, `packages/shared/src`, `packages/plugins/src`,
   `packages/effects/src`, `backend/src`, `tools/mcp-server/src`, `admin/src`, `infra/lib` (deterministic text search,
   EXECUTED) → in `renderer/src` no hit; the only non-admin hits are the schema (`packages/shared/src/tenant-config.ts:169`),
   the PUT check (`backend/src/tenant/settings.ts:195`) and the MCP theme tool's write (`tools/mcp-server/src/tools/themes.ts:92`).
   Also `grep -rli "darktheme|dark_theme|prefers-color-scheme"` over `renderer/src` and `renderer/middleware.ts` → no
   hit. The renderer reads the radius from `theme` only: `renderer/src/app/[siteId]/layout.tsx:324-325`
   (`<ThemeInjector theme={config.theme} …>`), `renderer/src/components/ThemeInjector.tsx:56`
   (`sanitizeCssLength(theme.radius, "0.5rem")`), and `renderer/src/components/SitePage.tsx:411-414` (the page's
   `themeOverride` merged over `config.theme`). So a dark-tab radius is a stored value nothing reads.
   **Fix chosen** (the packet's rule "the fix that cannot store a value nothing reads"): the Interface card reads and
   writes `theme.radius` on both tabs — the value the renderer reads. Rejected: show and write `darkTheme.radius` on the
   dark tab (stores a dead value); hide the card on the dark tab (removes a working control from the dark tab).
3. **Mode TODO.** The label is at `Theme.tsx:281`; the select reads `config.theme?.mode` and writes
   `updateTheme("mode", …)` (`:282-289`). What reads `theme.mode`: nothing outside the admin's own writers. Basis:
   `grep -rnE "\.mode\b|\[['\"]mode['\"]\]|['\"]mode['\"]|\{[^}]*\bmode\b[^}]*\}\s*="` over the same eight trees
   (EXECUTED) → the hits are `Theme.tsx:284-285` (this control), `admin/src/pages/ContentEditor.tsx:634-635` (the page
   editor's own "Mode" control, which writes `themeOverride.mode`), and unrelated `mode` names (facets, the media picker,
   the scheduling dialog). `ThemeInjector.tsx` reads no `mode` (it is not in its reads, `:46-70`). The schema keeps
   `mode: z.enum(["light","dark"]).default("light")` (`packages/shared/src/theme.ts:44`). **Fix:** remove the label and
   the select from the screen. The draft keeps any stored `theme.mode`, so the Save body sends it back unchanged; the
   schema does not change; an old record keeps validating.
4. **Duplicate font fields.** The Typography card (`Theme.tsx:122-130`) and the theme card's light-tab group
   (`:247-254`) both read `activeConfig?.fontHeading` / `activeConfig?.fontBody` and both write
   `updateTheme("fontHeading" | "fontBody", e.target.value)`. On the dark tab the copy is not rendered
   (`activeTab === 'light' &&`); the Typography card reads `activeConfig` (`darkTheme || theme`) and writes through
   `updateTheme` (dark: `darkTheme`) — the same field as the light-tab copy would on that tab. So the two pairs read and
   write the same field on both tabs: the packet's STOP condition for this item does not hold. The copy lacks `|| ""`
   (an absent value leaves the input uncontrolled). **Fix:** remove the copy (label "Typography" and its two inputs).
5. **False name.** `const [linkLanguageChoice, setLinkLanguage] = useState…` (`Settings.tsx:67`); the setter is passed
   as `setLinkLanguage` to `FooterLinksCard` (`:302`) and `NavigationMenuCard` (`:316`); the cards declare the prop
   (`admin/src/pages/settings/Menus.tsx:121,161`) and pass it on as `setLanguage` to `MenuLanguageSelect` (`:132,175`).
   Basis: `grep -rn setLinkLanguage` over `admin/src`, `tools/mcp-server/src`, `packages`, `renderer/src`, `docs`, the
   root `*.md` (EXECUTED) → those 7 code lines and the closed record. **Fix:** rename the state setter and the two
   props to `setLinkLanguageChoice`. `MenuLanguageSelect`'s own prop `setLanguage` stays (it is called with a language
   of the list, so it sets that language; not a false name).
6. **Stale marker.** `Settings.tsx:286`: `{/* COUNTRY, LOCALE & CURRENCY — moved to general section (before GDPR) */}`.
   **Fix:** delete the line.
7. **First Save.** § *Item 7*.

## Item 7 — what a first Save writes (characterisation)

**The mechanism (from the code).**

- `GET /settings` answers the stored record minus `recaptcha.secretKey`, `integrations.google.clientSecret`,
  `integrations.braveApiKey`, `integrations.mailerlite.apiToken` (`redactSecrets`, `backend/src/tenant/settings.ts:265-282`).
- For an admin the page then calls `GET /settings/secrets` (`Settings.tsx:82-86`). That handler always answers all three
  fields, with `""` for an absent one (`backend/src/tenant/settings-secrets.ts:54-64`, `|| ""`).
- `loadSecrets` (`Settings.tsx:114-130`) merges the answer into the draft: `recaptcha = { ...prev.recaptcha,
  ...secrets.recaptcha }`, `integrations = { ...prev.integrations, ...secrets.integrations, google: { ...prev.google,
  ...secrets.google } }`. So for a site with no stored secret the draft gains `recaptcha.secretKey: ""`,
  `integrations.google: { clientSecret: "" }` (or `clientSecret: ""` in a stored `google`) and
  `integrations.braveApiKey: ""`.
- `save()` sends `withContactForSave(config)` (`Settings.tsx:147`; it changes only `contactChannels` and
  `interestListEmail`). No card writes a default on render (no `useEffect` in `settings/*.tsx`; `grep -n useEffect`).
- `PUT /settings` (`settings.ts:443-466`) deep-merges `integrations`, `integrations.google` and `recaptcha` over the
  stored ones, so the three `""` values are stored. The MailerLite rule (`mailerLiteSave`, `:293-303`) keeps the stored
  token when the page sends `{ groupId }` or nothing.
- A second Save: the page loads the same answers (the three fields are redacted again, which leaves an empty
  `integrations.google: {}`; the secrets answer is the same `""`), so it sends the same body, and nothing but the save
  metadata changes. This is the operator's observation of 2026-11-27.

**Reproduction.** Two unit tests with one file between them (no real system):

- admin, `Settings.markup.test.ts` § SETTINGS-FINDINGS-1, test "item 7": the record the tenant-create handler writes
  (`backend/src/tenant/create.ts:35-54`, restated through the same `TenantConfigSchema.parse`, then the transaction's
  `PK`/`SK`/`Domain`), served as the two GET answers; the real page loads it; Save with no edit. It stores the answers
  and the Save body in `admin/src/pages/__markup__/settings-findings-1/`.
- backend, `backend/test/unit/settings-findings-1.test.ts` (isolated: `db.js`, `events.js` and the stored-page purge
  `revalidate.js` are test doubles; under a synthetic revalidation and fast-lane configuration a guard records and
  refuses every `send` of `LambdaClient` — the only AWS SDK client the unmocked chain loads, by an import walk — and of
  `SecretsManagerClient` — the client behind the purge double —, and every `fetch`; each detector has a positive
  control; it covers no other client class — iterations 1 and 2, review-0 R1, review-1 R3): the real create handler on
  a test double writes the record;
  the real `GET /settings` and `GET /settings/secrets` must answer exactly what the admin test served (this pins the
  restatement); the real `PUT /settings` takes the admin test's Save body; the test lists every path that differs
  between the record before and after, with the kind of value (never a value of a secret).

**Result (EXECUTED).** The Save body equals the `GET /settings` answer plus exactly three paths, all from the secrets
merge: `integrations.braveApiKey` (empty string), `integrations.google` (an object `{ clientSecret: empty string }`),
`recaptcha.secretKey` (empty string). The record after the backend's update, compared with the record before:

| Path | Change | Kind |
|---|---|---|
| `integrations.braveApiKey` | added | empty string |
| `integrations.google` | added | object `{ clientSecret: empty string }` |
| `recaptcha.secretKey` | added | empty string |
| `updatedAt`, `updatedBy` | added | the save metadata the handler writes on every Save |

After it, `GET /settings` answers one more path: `integrations.google: {}` (`redactSecrets` deletes `clientSecret` and
keeps the object).

**Judgement: (a), a harmless normal form; not changed.**

- No value is lost: the redacted read answers the same, plus the empty object (test "judgement (a)").
- No secret is written where the redacted read can return it: the three paths are the ones `redactSecrets` deletes.
- No setting is switched: every reader treats `""` and `{}` as absent. `resolveRecaptchaConfig`
  (`backend/src/lib/recaptcha.ts:33`, `siteKey && secretKey`) resolves the same with and without a deployment key
  (asserted); the renderer's `hasOwnRecaptchaPair` (`renderer/src/lib/dynamo.ts:100-103`) requires `!== ""`; the
  research search refuses a falsy key (`backend/src/research/search.ts:48-49`); Google sign-in requires a truthy
  `clientId` and `clientSecret` (`renderer/src/app/api/auth/[...nextauth]/route.ts:21`); the profile routes read
  `|| ""`; the Google OAuth card reads `|| ""` (`admin/src/pages/settings/Integrations.tsx:168,183`).
- A second Save changes only `updatedAt` (asserted).
- Why no idempotency fix: no one-line, risk-free change exists. In the admin, `loadSecrets` would have to drop empty
  values in two nested merges (more than one line), and records already saved through the screen keep the `""` values
  anyway. In the backend, a change of the secrets answer or of what `PUT /settings` stores changes a route contract
  (the packet's STOP class), and the effect is not a defect. Recorded as F-SF1-FIRST-SAVE-EMPTY-SECRETS.
- The operator's gate "a Save with no change leaves the stored settings equal" holds on a site saved once through the
  screen (the test site of the closeout is one); on a site never saved through the screen, the first Save adds the
  three fields above.

## Expected capture changes (written before the fixes)

The 31 files under `admin/src/pages/__markup__/refactor-settings-1/` (`Settings.markup.test.ts`). The five states of
that test hold no stored theme, so item 1 adds a request and no markup there; the new regression tests pin the list.

| Item | Captures expected to change | The only expected difference |
|---|---|---|
| 1 | the 5 `*.requests.json` | one added line `"GET /themes"` in the load requests (after `"GET /categories"`) |
| 2 | none | (no state edits the radius on the dark tab; `shop.dark-tab.html` already shows `theme.radius`, which is what the card shows after the fix) |
| 3 | the 16 `*.html` | the removed `<div class="space-y-2">` with the label `Mode (TODO: implement it)` and its `<select>` (two options) |
| 3 | the 5 `*.sweep.save.json` | `theme.mode`: before, the sweep chose `"dark"` (the last option); after, the stored value (shop: `"light"`) or absent |
| 4 | the 15 `*.html` of the light tab (all but `shop.dark-tab.html`) | the removed `<div class="space-y-2 pt-2">` with the label `Typography` and its two inputs |
| 4 | the 5 `*.sweep.html`, the 5 `*.sweep.save.json` | the sweep gives each field a value from its DOM position: (a) `theme.fontHeading` / `theme.fontBody` keep the Typography card's values (before, the later copy overwrote them), shown in the two Typography inputs; (b) the Border Radius input is two positions earlier, so its value and the preview's `border-radius` change (`v<n>` → `v<n-2>`) |
| 5, 6 | none | |
| 7 | none (unless a fix; new files under `__markup__/settings-findings-1/`) | |

`Settings.test.ts` compares a server render with `__markup__/settings.content.html` / `settings.commerce.html`. Items 3
and 4 remove two groups from that render. Rule kept from that file (the captures are NOT re-taken): the comparison
removes from the CAPTURE text exactly those two groups, each exactly once, with a control that the comparison fails
without the removal.

## Architectural boundaries

- The admin is a client-only SPA; it talks to the backend through `apiRequest` only. This slice adds one request on
  page open (`GET /themes`, an existing route) and changes no route and no payload shape of `PUT /settings`.
- Module graph inside `admin/src/pages/`: unchanged (`Settings.tsx` → `settings/*`; no section file imports the page).
- Tenant isolation, the no-scan rule and the dependency rule: no backend, shared or infra code changes.

## Migration / deployment notes

- **Data migration:** none. No stored attribute, key, schema or default changes. A stored `theme.mode` or
  `darkTheme.radius` stays stored and is sent back unchanged by Save.
- **Deployment scope:** the admin static bundle only (`admin/dist`, uploaded by `infra/lib/admin-hosting.ts`
  `BucketDeployment` `DeployAdmin`, CloudFront invalidation `/*`).
- **Rollback:** revert the slice's commit, `npm run build`, deploy again; `DeployAdmin` replaces `index.html`. No data
  to restore.
- **Operator gates (NOT RUN by the builder):** on staging in a real browser on a test site: the saved themes are listed
  on open; the dark tab's Interface card shows the value it writes; no "TODO" label; one pair of font fields; a Save
  with no change leaves the stored settings equal (on a site already saved once through the screen — § *Item 7*).

## Definition of Done

- Items 1–6 fixed, each with a test (or, for 5 and 6, a named deterministic check) red before and green after.
- Item 7 characterised by the two tests; each differing path judged; a defect fixed at its cause with a regression test.
- The captures re-taken; every changed capture's diff holds only the lines of § *Expected capture changes*.
- Docs: `admin/ARCHITECTURE.md`, `docs/TECH-DEBT.md`, ROADMAP row, `CURRENT_SLICE.md`, this spec.
- Gates exit 0: `npm run build`; `npm run typecheck`; `cd admin && npm run test:unit`;
  `npm --prefix backend run test:unit`; `cd tools/mcp-server && npm test`; `git diff --check` (new files too).

## Evidence required

- EXECUTED by the builder: the red runs on the unfixed code and the green runs after each fix; the capture diffs; the
  gates (§ *Build record*).
- OBSERVED by the operator before SHIPPED: the staging checks of § *Migration / deployment notes*.

## Exit criterion

The Settings screen shows what each control writes; the first-Save effect is explained and pinned by a test, so a
later change to the Save path that changes stored data on an unchanged Save fails a test.

## Findings (new; not fixed by this slice; also in `docs/TECH-DEBT.md` § *settings-findings-1 residuals*)

- **F-SF1-DARK-THEME-UNREAD.** The renderer reads no `darkTheme` (§ *Causes* item 2). Every control of the dark tab
  stores values nothing renders, and its description "Applied when user system preference is Dark." is false.
- **F-SF1-THEME-WRITE-ROLES.** The saved themes are one library for the whole deployment (`PK: "SYSTEM"`,
  `SK: THEME#<id>`, `backend/src/themes/manage.ts:24-33`). That ownership is a DOCUMENTED contract:
  `tools/mcp-server/ARCHITECTURE.md:193` ("themes are global, not per tenant"), `docs/slices/mcp-sync-1.md:157-158`
  (`PK: SYSTEM`, "shared by all tenants"), and the `delete_theme` tool description
  (`tools/mcp-server/src/tools/themes.ts:106`, "Themes are SHARED by all tenants"). Not documented, and open: the
  permission policy of that library — `POST` and `DELETE /themes` call no `requireRole` (`manage.ts:10-40,57-70`), so
  every staff role (an `EDITOR` too) may add to it or delete any entry, also one saved from another site. Item 1 shows
  the library on page open (before, only after a save in the same visit); it changes neither ownership nor
  permissions. DECISION_REQUIRED `SF1-THEME-WRITE-ROLES` below.
- **F-SF1-FIRST-SAVE-EMPTY-SECRETS (harmless, not changed).** § *Item 7*.
- **F-SF1-PAGE-MODE (pre-existing).** The page editor's own "Mode" select (`admin/src/pages/ContentEditor.tsx:630-647`,
  `themeOverride.mode`, help text "Applies CSS class `.dark` if selected.") — nothing reads it. Not the Settings screen.
- **F-SF1-DARK-SAVE-THEME (pre-existing, INFERRED).** "Save Theme" on the dark tab of a site without `darkTheme` posts no
  `theme` (`Settings.tsx` `saveCurrentTheme`); `POST /themes` answers 400; the owner sees an alert.
- **F-SF1-DELETE-THEME-UNCAUGHT (pre-existing).** `deleteTheme` has no `try`: a refused delete is an unhandled
  rejection and the list is not reloaded.

DECISION_REQUIRED (not blocking this slice):
- ID: SF1-THEME-WRITE-ROLES
  PROBLEM: the theme library is shared by all tenants of the deployment by a documented contract (the three citations
  in F-SF1-THEME-WRITE-ROLES); this slice keeps it. What no document states is who may WRITE to that shared library:
  `POST` and `DELETE /themes` check no role, so any staff user (`EDITOR`, `TENANT_ADMIN`, `GLOBAL_ADMIN`) of any site
  can add an entry every site then lists, or delete an entry another site's owner saved.
  OPTIONS:
  - A. `POST` and `DELETE /themes` for `GLOBAL_ADMIN` only (the agency curates the shared library). Reward: an entry is
    removed only by the agency; ownership and the MCP contract unchanged (the MCP server uses the master key, which is
    `GLOBAL_ADMIN`). Risk: a site's own admin can no longer save a theme from the screen; a small backend slice, and the
    screen should then hide Save/Delete for other roles.
  - B. `POST` for `TENANT_ADMIN` and `GLOBAL_ADMIN`, `DELETE` for `GLOBAL_ADMIN` only. Reward: owners still save; only
    the agency deletes. Risk: the shared list can grow without curation; the same small slice.
  - C. Keep every staff role, and write the policy into `docs/database-patterns.md` next to the `SYSTEM` partition.
    Reward: no code. Risk: any editor can delete an entry other sites use (sites that applied it keep their colours:
    `apply_theme` copies the values).
  RECOMMENDED: B — it keeps the documented shared library and the owner's Save, and limits the destructive operation.
  BLOCKING_REASON: none for this slice (no route or ownership change is in scope). It blocks a claim that the theme
  library's write access is controlled.

## References

- `docs/slices/refactor-settings-1.md` § *Findings, not fixed*, § *Closeout* (closed record).
- `docs/ROADMAP.md`, order of work from 2026-11-27, row `settings-findings-1`.
- `admin/ARCHITECTURE.md` § *Internal Structure* (`Settings.tsx`, `settings/`, `__markup__/`).
- `docs/testing-strategy.md` (test layers); `docs/authentication-architecture.md` (secrets redaction).
- `docs/slices/cat-theme-1.md` (review-0 R-CT-3, the read-what-you-write rule of the theme card).

## Build record

Builder `claude-opus-5-5`, 2026-11-27, base `760df57`, tree clean at the start. Detailed log:
`.agent-manager/slices/SETTINGS-FINDINGS-1/build-progress.md` (git-ignored).

1. **Spec first (EXECUTED).** This file with § *Causes* and § *Expected capture changes*, before any code change.
2. **Baseline (EXECUTED).** On the untouched tree, `CI=1 npx vitest run` of `Settings.markup.test.ts`, `Settings.test.ts`,
   `Settings.scheduling.test.ts`, `Leads.newsletter-1.test.ts`: 4 files, 85 passed; the 31 capture hashes equal the
   list of `refactor-settings-1`.
3. **Regression tests, red (EXECUTED)** — `Settings.markup.test.ts` § SETTINGS-FINDINGS-1, on the unfixed code:
   - item 1 "the saved themes are listed when the page opens, for an admin and for an editor" → failed ("the stored
     theme is listed on open: expected undefined to be truthy"); item 1 "a refused theme load leaves the page working"
     → failed (no load, so no warning);
   - item 2 "on the dark tab the Border Radius field shows and writes theme.radius" → failed ("the field shows the
     value it wrote: expected '0.75rem' to be '1rem'");
   - item 3 "no Mode control and no TODO text; a stored theme.mode is sent back unchanged" → failed (text contains
     "TODO");
   - item 4 "one Heading and one Body font field, on each tab" → failed ("light: heading font fields … got 2").
4. **Item 7 (EXECUTED).** Admin test "item 7" wrote `__markup__/settings-findings-1/first-save.answers.json` and
   `first-save.save.json`; `backend/test/unit/settings-findings-1.test.ts`: 2 passed (§ *Item 7*). The first run of
   the judgement test failed on the empty `integrations.google: {}` of the redacted read; its readers were checked
   (§ *Item 7*) and the assertion states that one path.
5. **Fixes, green, one at a time (EXECUTED).** Fix 1 (`Settings.tsx` load effect calls `loadCustomThemes`) → item 1
   tests pass. Fix 2 (`InterfaceCard` writes `withThemeKey(prev, "light", "radius", …)` through `setConfig`) → item 2
   passes. Fix 3 (Mode label and select removed; the card no longer takes `updateTheme`) → item 3 passes. Fix 4 (the
   theme card's font group removed) → item 4 passes; 6 of 6. Fix 5: `setLinkLanguage` → `setLinkLanguageChoice` in
   `Menus.tsx` first → `tsc -b --noEmit --force` exit 2 with exactly two errors, `Settings.tsx(305,136)` and
   `(319,139)` (the two call sites); then the page → exit 0; `grep -rnw setLinkLanguage` over `admin/src`,
   `tools/mcp-server/src`, `packages`, `renderer/src` → no hit. Fix 6: `grep -c "moved to general section (before
   GDPR)" Settings.tsx` 1 → 0.
6. **Re-capture (EXECUTED).** Before: `CI=1` → 13 failed (the 10 oracle tests; `Settings.test.ts` content, commerce and
   its mutation controls), as listed. `Settings.test.ts`: the listed capture-text removal `SETTINGS_FINDINGS_1_REMOVED`
   (each group exactly once) and a control "with either listed removal left out, the comparison fails" → 65 passed.
   `npx vitest run src/pages/Settings.markup.test.ts -u` → 26 of the 31 files changed: the 16 `.html`, the 5
   `requests.json`, the 5 `sweep.save.json`; the 5 `save.json` did not change. Diff check (throwaway script
   `/tmp/SETTINGS-FINDINGS-1-diff/strict.py`, deleted at the end): from the HEAD text it removes exactly the Mode group
   and the font group, then token-diffs the rest against the new file and accepts only a changed `value="v<n>"`:
   STRICT PASS — every `.html` lost one Mode group and one font group (`shop.dark-tab.html`: the Mode group only); the
   5 `sweep.html` differ further only in the values of the Heading and Body inputs (the Typography card's own position,
   e.g. shop `v126`→`v99`, `v127`→`v100`) and of the Border Radius input (two positions earlier, `v131`→`v129`). The
   radius preview's `border-radius` did not change in the captures: jsdom drops the invalid CSS length `v<n>`, so it is
   not serialised (a subset of the expected list). JSON (`git diff`): `+ "GET /themes"` after `"GET /categories"` in
   the 5 `requests.json`; in the 5 `sweep.save.json` `fontHeading`, `fontBody`, `radius` values as above and `"mode":
   "dark"` removed (shop: `"mode": "light"`, the stored value). Then `CI=1`: 4 files, 92 passed; hashes unchanged.
7. **Gates (EXECUTED, exit status):** `npm run build` 0; `npm run typecheck` 0; `cd admin && npm run test:unit` 0
   (33 files, 506 tests); `npm --prefix backend run test:unit` 0 (94 files passed, 2 skipped; 2,453 tests passed,
   2 skipped); `cd tools/mcp-server && npm test` 0 (23 of 23; no route changed, `routes.json` not refreshed);
   `git diff --check` 0, and each new file with `git diff --no-index --check /dev/null <file>`: no diagnostic (that
   command exits 1 because a new file differs from `/dev/null`; the evidence is the empty output). The 31
   capture hashes were unchanged after the gate runs. No change under `infra/`, `renderer/`, `packages/`,
   `backend/src`, a `package.json` or a lockfile (`git status --short`).
8. **NOT RUN:** the operator's staging checks (§ *Migration / deployment notes*); `cd renderer && npm run
   test:serving` (no renderer change); `cd backend && npm test` (forbidden by the packet).
9. **Iteration 1 (review-0, EXECUTED).**
   - **R1 — the item-7 test was not isolated from the cache purge.** Class: a unit test whose handler chain keeps a
     real module that can reach a service outside the process, hidden by best-effort error handling. Rule applied:
     every module of the chain that can do external I/O is a test double, AND the test proves that nothing leaves —
     a synthetic `REVALIDATION_SECRET_NAME` / `RENDERER_URL` / `DEBOUNCE_FLUSH_FUNCTION_NAME` set before the modules
     load, and a guard on `Client.prototype.send` of `@smithy/smithy-client` and on `fetch` that records and refuses
     each call; every test ends with zero recorded calls. (This record first called that class "the base of every AWS
     SDK v3 client"; that was false — `LambdaClient` does not inherit it. Corrected in iteration 2, R3, step 10.)
     Red first: with the guard and the configuration but without the `revalidate.js` double, both item-7 tests failed
     with `{ sdk: 2 }` and
     `{ sdk: 3 }` (Secrets Manager reads by `lib/revalidate.ts`, refused by the guard; "Failed to fetch revalidation
     secret" logged and swallowed by the handler). Then `revalidate.js` mocked as in `catalog-mode.test.ts` → 3 of 3
     pass with zero escaped calls; the first test also asserts the purge double received `[["first.test"]]` (create)
     and `[["first.test", "first.test"]]` (save). Control test: the guard records and refuses one SDK call and one
     fetch. Every environment variable the test sets or deletes (`RECAPTCHA_SECRET_KEY` and the three synthetic ones)
     is restored after each test.
   - **R2 — the theme-library decision had a wrong premise.** It said that nothing states the shared-library
     semantics; `tools/mcp-server/ARCHITECTURE.md:193`, `docs/slices/mcp-sync-1.md:157-158` and the `delete_theme`
     tool description state it. Class: a claim that something is undocumented, made without a search of every
     workspace's docs and tool descriptions. Rule applied: a claim about whether a contract is documented cites the
     documents found (or the search basis when none is found). The finding is now F-SF1-THEME-WRITE-ROLES and the
     decision SF1-THEME-WRITE-ROLES: shared ownership is the documented contract and stays; only the undocumented
     write permission is open. Basis of the ID change: `grep -rn` of the old IDs over `docs`, `admin`,
     `CURRENT_SLICE.md` → no hit left.
10. **Iteration 2 (review-1 R3, EXECUTED) — the guard claimed more than it detected.** The iteration-1 guard patched
    `Client.prototype.send` of `@smithy/smithy-client` and claimed every AWS SDK call; its control used Secrets
    Manager only. Red (a static probe, no request sent): `SecretsManagerClient` inherits that class, `LambdaClient`
    does not. Class: an absence detector whose claimed coverage exceeds what a positive control proves. Rule applied:
    the guard is a list of concrete detectors, each claim names exactly that list, and every detector has a positive
    control. Coverage basis: an import walk (relative imports) from `tenant/create.ts`, `tenant/settings.ts`,
    `tenant/settings-secrets.ts` and `lib/recaptcha.ts`, skipping the three mocked modules, listed every `@aws-sdk/*`
    import other than `lib-dynamodb` (command classes only, sent through the mocked `db.js`): exactly
    `@aws-sdk/client-lambda` in `lib/invalidate-cdn.ts`. The guard now spies on `LambdaClient.prototype.send`,
    `SecretsManagerClient.prototype.send` (the client of `lib/revalidate.ts`, behind the purge double) and `fetch`.
    Controls: `enqueueEdgeInvalidation` through the real module-level client of `invalidate-cdn.ts` (fast-lane invoke,
    synthetic function name) → the Lambda detector counts 1; one direct Secrets Manager send → 1; one `fetch` → 1. The
    item-7 tests: 3 of 3 pass with `{ lambda: 0, secretsManager: 0, fetch: 0 }`. The guard covers no other client
    class; a client added to the chain later needs its own detector and control.

**Deviations.**
- Items 5 and 6 have no new test: a rename and a deleted comment change no behaviour. Their red/green proofs are
  deterministic checks named above (the compiler's error list for item 5; a `grep -c` for item 6). A permanent test
  that reads source text for a comment would add maintenance and prove nothing about the product.
- `Settings.test.ts` was edited (listed capture-text removal + control). The packet named only the markup captures;
  this file's captures pin the same screen, and its existing rule (captures not re-taken; listed edits) was applied.
- The backend test reads two JSON files of the admin workspace (data only, no code import, one direction:
  backend test → admin capture). Rejected: restating the Save body in the backend test (two copies, the link checked
  by nobody); importing backend handlers into the admin test (a code edge admin → backend).

**Abstractions introduced.** None in product code (fix 2 reuses `withThemeKey`). Test helpers only: `inputsShowing`
(markup test; four uses in the item 4 test; axis: none; rejected: the same query written four times);
`kindOf` / `differingPaths` (backend test; users: both item-7 tests; axis: none; rejected: printing values, which
the secrets rule forbids).

## Closeout (operator, 2026-11-28)

- Relay: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, three cycles; review-2 `approved` (R1, R2, R3 closed).
- Operator gates on the approved tree, each exit 0: build, typecheck, shared, plugins, renderer, serving,
  serving-bundle, admin unit, backend unit, infra, mcp, `git diff --check`; no change under `backend/src`, `infra`,
  `packages`, `renderer`, `tools`, a manifest or a lockfile.
- Staging diff (read before the deploy): 0 resources added, 0 removed, no IAM change; the admin bundle and the
  renderer rebuilt. Deploy: `AmodxStack-staging` succeeded.
- Staging proof, a real browser on the test site `cm1-commerce` (a theme added to the staging theme library through
  the API for the run and deleted after it): the saved theme is listed on open with no save in the visit; no "TODO"
  text; one pair of font fields (the Typography card's); the Interface card shows the stored radius on the light and
  on the dark tab; no "Mode" select; a Save with no change answers 200 and leaves the stored settings equal (except
  `updatedAt` / `updatedBy`); no page error, no alert; the added theme is deleted.
- Operator ruling SF1-THEME-WRITE-ROLES = B (the recommendation; the human's standing rule of 2026-11-27 is that the
  operator applies its recommendation and records it; the human may overrule): saving a theme for `TENANT_ADMIN` and
  `GLOBAL_ADMIN`, deleting for `GLOBAL_ADMIN` only. Not built here: ROADMAP row `theme-roles-1`.
- Put to the human, not decided: F-SF1-DARK-THEME-UNREAD (the dark tab stores values the site never renders).

