# CAT-ADMIN-2-IMPL — the page editor on a catalog site (IMPL record)

Status: **IMPLEMENTED** (2026-11-01). Code complete, review pending (`docs/documentation.md` § Status taxonomy).
Uncommitted on `main` at `f175e89`.
Contract: the ratified design `docs/slices/cat-admin-1.md` § 4.7 (F-5), § 5, § 7 row `cat-admin-2`, § 10; plus the
findings F-CA-IMPL-1 and F-CA-IMPL-2 of `docs/slices/cat-admin-1-impl.md` § 7. Builder packet: operator, 2026-11-01.
Track F — Glam catalog. Vision tie: a catalog author can now put a category showcase on a page and link a product or
a category from the text editor, as a shop author can; the block offer follows the site kind that the admin already
states (design § 3), not a commerce switch that a catalog never has. No stored data, no backend route, no shared
schema and no renderer byte changes.
Maturity: plugin `offeredOn` + toolbar rule **PROTOTYPE** → **MATURE** after review and the operator's look at a
staging catalog tenant (not part of this slice).

Evidence labels: **EXECUTED** = a command run by the builder in this slice; **OBSERVED** = read in a file or in the
output of a command; **INFERRED** = a conclusion, not run.

---

## 1. What changed, per packet item (file:line on the working tree)

| # | Item | Change |
|---|---|---|
| 1 | Plugin definition (rule 2) | `packages/plugins/src/types.ts:13-16`: `commerce?: boolean` replaced by `offeredOn?: readonly ("commerce" \| "catalog")[]` (absent or empty = every site; read by the admin only). `category-showcase/index.ts:14` `['commerce', 'catalog']`; `reviews-carousel/index.ts:14` `['commerce']`. Projection `packages/plugins/src/admin.ts:53` `offeredOn: p.offeredOn ?? []`. Test `packages/plugins/test/offeredOn.test.ts` (new): the two lists per key, every other registered block `[]`, the projection's keys are exactly `icon, key, label, offeredOn`. |
| 2 | Toolbar rule (rule 3) | `admin/src/components/editor/Toolbar.tsx:12` import `isCatalogMode`; `:14` `PluginListItem` (the projection's element type); `:22-28` `offeredPlugins(list, tenant)`: kind = `"catalog"` by `isCatalogMode`, else `"commerce"` by `commerceEnabled`, else none; a block is kept when its `offeredOn` is empty or holds the kind. `:38` the component calls it (the two lines `:21-22` of `f175e89`, including the `as any` cast, are gone). Test `admin/src/components/editor/Toolbar.test.ts` (new), over the real registry: content (`{}`, both flags false, `null` tenant), commerce, catalog, catalog + `commerceEnabled`. |
| 3 | Autolink (rule 4) | `admin/src/components/layout/AdminLayout.tsx:16` import; `:47` `currentTenant?.commerceEnabled \|\| isCatalogMode(currentTenant)`; `:82` dependencies `[currentTenant?.commerceEnabled, currentTenant?.catalogMode]`; comments `:29`, `:45-46`. Paths `:57` `/product/`, `:66` `/category/` unchanged (finding F-CA2-1). |
| 4 | F-CA-IMPL-1 (rule 5) | `admin/src/components/GlamPricelistImport.tsx:16`: the doc comment now says "the pricelist import form (catalog sites only; mounted by `pages/CatalogImport.tsx` since CAT-ADMIN-1)". One comment line; no code line (EXECUTED `git diff -U0`: one `-`/`+` pair, both ` * ` comment lines). |
| 5 | F-CA-IMPL-2 (rule 5) | `admin/src/pages/Settings.tsx:1372-1374` the URL Prefixes description and `:1452-1454` the footnote: on a catalog "catalog pages" / "catalog URLs", else the old string; JSX comment `:1367-1368`. Test `admin/src/pages/Settings.test.ts:156-162` (catalog: both catalog sentences, no "commerce pages" / "commerce URLs"). Non-catalog: the existing captures, not regenerated. |
| 6 | Architecture + record | `packages/plugins/ARCHITECTURE.md:21-23` (`getPluginList()` shape and `offeredOn`), `:248` (Tests table row for the new suite — a ripple of the new file); `admin/ARCHITECTURE.md:187-190` (the toolbar filter and the autolink gate). This file. |

How the non-catalog Settings markup stays byte-equal: each text is ONE string expression per kind
(`{isCatalogMode(config) ? "…catalog…" : "…commerce…"}`). React server output of a single string child is the
escaped string, the same as for the static JSX text it replaces. A split text (`for {kind} pages`) would emit three
text nodes with `<!-- -->` separators and change the bytes. EXECUTED: the 7 captures under
`admin/src/pages/__markup__/` pass and are unmodified (`shasum -c` 7/7 OK after the run; `git status --porcelain --
admin/src/pages/__markup__` empty).

Not touched: `renderer/`, `backend/`, `infra/`, `tools/`, `packages/shared`, the design, `catalog-mode-1.md`,
`cat-admin-1-impl.md`. The renderer renders every registered block from `RENDER_LOADERS` and never read the flag
(design § 5; EXECUTED here: `git grep -n "offeredOn\|commerce: true" -- renderer/src` exit 1).

## 2. Oracles (packet § 3), last lines

| Oracle | Result | Label |
|---|---|---|
| `npm --prefix "$R" run build` (root) | exit 0; admin `✓ built in 5.56s`; last step `infra@0.1.0 build` `tsc` | EXECUTED |
| `npm --prefix "$R" run typecheck` | exit 0; last step `infra@0.1.0 typecheck` `tsc --noEmit` | EXECUTED |
| `npm --prefix "$R/admin" run typecheck` | exit 0 (`tsc -b --noEmit --force`, no output) | EXECUTED |
| `npm --prefix "$R/packages/shared" test` | `Test Files 11 passed (11)` / `Tests 248 passed (248)` | EXECUTED |
| `npm --prefix "$R/packages/plugins" test` | `Test Files 6 passed (6)` / `Tests 204 passed (204)` (was 5 / 201: +3 new) | EXECUTED |
| `npm --prefix "$R/renderer" test` | `Test Files 22 passed (22)` / `Tests 362 passed (362)` | EXECUTED |
| `npm --prefix "$R/renderer" run test:serving` | `# tests 91` `# pass 91` `# fail 0` | EXECUTED |
| `npm --prefix "$R/admin" run test:unit` | `Test Files 12 passed (12)` / `Tests 214 passed (214)` (was 11 / 208: +5 toolbar, +1 Settings) | EXECUTED |
| `npm --prefix "$R/backend" run test:unit` | `Test Files 44 passed \| 1 skipped (45)` / `Tests 1192 passed \| 1 skipped (1193)` | EXECUTED |
| `npm --prefix "$R/tools/mcp-server" test` | `PASS: every call targets a live route; ARCHITECTURE.md tool count matches.`; `# tests 13` `# pass 13` `# fail 0` | EXECUTED |
| `git diff --check` | exit 0, no output | EXECUTED |
| `git diff --stat -- renderer backend infra tools docs/slices/cat-admin-1.md docs/slices/cat-admin-1-impl.md docs/slices/catalog-mode-1.md` | prints nothing | EXECUTED |
| `git grep -n "commerce: true\|\.commerce\b" -- packages/plugins/src admin/src/components/editor` | prints nothing, exit 1 | EXECUTED |
| `git grep -n "commerce: true" -- packages/plugins/src` (design § 7 oracle) | prints nothing, exit 1 | EXECUTED |
| `git status --porcelain -uall` | only the allocated paths of § 1 (11 modified, 2 new tests) + this file | EXECUTED |
| no dependency line | `git diff --stat -- '*package.json' '*package-lock.json'` prints nothing | EXECUTED |

`$R` = `/Users/apple/Documents/APLICATII BIJUTERIE/amodx`. `cd backend && npm test` was not run (packet).
`routes.json` not refreshed: no backend route changed.

Design § 7 oracle "a catalog toolbar lists the showcase and not the carousel": `Toolbar.test.ts` "catalog site: the
showcase, not the carousel" (EXECUTED, pass) — on the pure rule over the real registry, not a rendered toolbar
(packet rule 3).

Discrimination of the new tests (INFERRED, not run against `f175e89`): at `f175e89` the projection has `commerce` and
no `offeredOn`, so the plugins test's key assertion and per-key lists fail, and `offeredPlugins` does not exist; the
old rule (`!p.commerce || commerceEnabled`) hides the showcase on a catalog, which the catalog case rejects.

## 3. Coverage limits (stated)

- The autolink gate (`AdminLayout.tsx:47`) has no unit test: it runs inside a `useCallback` called from an effect, and
  the admin's node tests render with `react-dom/server`, which runs no effect. The packet asks no test for it; adding
  a seam only for this one-line condition is not earned. Basis for the behaviour: typecheck, the two list handlers
  have no kind gate (OBSERVED: `grep -n "commerceEnabled\|isCatalogMode" backend/src/products/list.ts
  backend/src/categories/list.ts` exit 1), and a tenant switch reloads the page (`TenantContext.tsx`
  `selectTenant` → `window.location.reload()`), so the dependency list only matters within one tenant session.
- The Toolbar component is not rendered (needs a tiptap editor); the rule it calls is tested.
- A browser walk of the editor on a catalog tenant: NOT RUN (no catalog tenant on staging, per the cat-admin-1
  closeout; no browser run in this slice).

## 4. Abstractions

- `PluginDefinition.offeredOn` — what: a list of site kinds on the plugin definition; current users: the two plugin
  declarations (`category-showcase`, `reviews-carousel`), the projection `getPluginList()`, and `offeredPlugins` in
  `Toolbar.tsx`; axis: the site kinds a block applies to (fixed set of two, `"commerce"` / `"catalog"` — a closed
  union, variants fixed); rejected: a second boolean `catalog?: boolean` (two flags with an unstated relation).
  (Design § 4.7, ratified; restated here.)
- `offeredPlugins(list, tenant)` — what: the inserter's rule as a pure exported function in `Toolbar.tsx`; current
  users: `Toolbar` (`:38`) and `Toolbar.test.ts`; axis: none — it is a test seam, needed because the Toolbar cannot
  render without a tiptap editor in the node test config (packet rule 3); rejected: the inline filter in the
  component (untestable without a DOM + tiptap harness, which the admin does not have and the slice may not add).
- `PluginListItem` (`Toolbar.tsx:14`) — a local type alias `ReturnType<typeof getPluginList>[number]` so the rule's
  parameter is the projection's own type; no new exported type in `@amodx/plugins`; rejected: exporting a list-item
  type from the package (a new public type for one reader).

## 5. Local decisions (one line each)

- The projection normalizes an absent `offeredOn` to `[]` (`admin.ts:53`), so the toolbar sees one representation of "every site" (as the old `commerce ?? false`).
- The rule lives in `Toolbar.tsx` (allocated) and its test is `Toolbar.test.ts` next to it (allocation: "a new test file next to it").
- Function name `offeredPlugins` (the packet's suggestion); "no kind" is `null`.
- `commerceEnabled` is read by truthiness, as the old `(currentTenant as any)?.commerceEnabled ?? false` did; the `as any` cast is removed (the context's `Tenant` type has both flags).
- The rule test uses the real registry, not a synthetic list, so it is also the design's "catalog toolbar" oracle.
- Settings: whole-string ternary per kind (byte-equality reason in § 1); the placeholders `/produs` … stay as they are.
- GlamPricelistImport comment kept to one line (no line shift for any file:line reference to that file).

## 6. Deviations

- `packages/plugins/ARCHITECTURE.md` has two edits, not one sentence: the `getPluginList()` sentence (the packet's
  sentence) and one Tests-table row for the new suite (a ripple: the table lists every suite of the package).
- None against a ratified assumption.

## 7. Findings (not fixed here)

- **F-CA2-1 (autolink paths ignore the URL prefixes; packet rule 4).** `AdminLayout.tsx:57,66` build `/product/<slug>`
  and `/category/<slug>`. The defaults are the same (`packages/shared/src/index.ts:92-93`), but a tenant can change
  them in Settings → URL Prefixes (e.g. `/produs`); then every suggested product or category link points to a path
  the site does not serve (INFERRED from the code; not run). Pre-existing on commerce sites; now also reachable on a
  catalog.
- **F-CA2-2 (hidden products are suggested).** The autolink lists every product the admin `GET /products` returns,
  including hidden ones; on a catalog, imported products start hidden until an image arrives (design § 3). A link to
  a hidden product leads to a page the visitor cannot see (INFERRED; the public behaviour for hidden products was not
  checked in this slice). Same as on commerce sites today.
- **F-CA2-3 (hook order in Toolbar, pre-existing).** `Toolbar.tsx:36` `if (!editor) return null;` comes before the
  `useState` calls (`:40` onward). If one Toolbar instance renders first with `editor === null` and later with an
  editor, React sees more hooks than before and throws (INFERRED from the Rules of Hooks; not reproduced — whether
  `BlockEditor` ever passes `null` then an editor to the same instance was not checked). Not touched: outside the
  rule-3 lines.
- **F-CA2-4 (non-component export in a component file).** `offeredPlugins` is exported from `Toolbar.tsx`. Vite's
  React plugin cannot fast-refresh a module that also exports a non-component; on an edit of that file in
  `npm run dev` it invalidates the module and the update goes to its importers (development only; no effect on the
  build). `admin/eslint.config.js:4` imports `eslint-plugin-react-refresh`, which exists to warn about this;
  `npm run lint` is not a gate and was NOT RUN. Chosen because the allocation names `Toolbar.tsx` + a test file only.

## 8. Operator closeout (2026-11-01)

- Review: relay review 0 (Codex `gpt-6.1-sol`) approved at the first cycle; no finding, no decision escalated.
- Gates (OPERATOR-EXECUTED on the approved candidate, unchanged): the ten common gates exit 0; infra, renderer,
  backend and tools untouched; the design and earlier records untouched; no dependency line; every changed path
  inside the allocation; the plugin `commerce` flag has no reader left (grep exit 1); no trailing whitespace.
- Staging: deployed from this tree (code only: 3 Lambda assets, the admin and renderer uploads, the admin config
  write; nothing added or removed). Renderer build `M1w166xT5AQB51TZ8dGXT` → `JbiMn8xs3jZFnWpSUXFug`; the 51 CM1
  URLs text- and status-identical. The deployed admin bundle holds `offeredOn` and the "catalog pages" / "catalog
  URLs" copy (curl of `index-*.js`). A browser walk on a catalog tenant: NOT RUN (none on staging).
