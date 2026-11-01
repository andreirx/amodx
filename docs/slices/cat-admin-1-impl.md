# CAT-ADMIN-1-IMPL — the admin screens of a catalog site (IMPL record)

Status: **IMPLEMENTED** (2026-11-01). Code complete, review pending (`docs/documentation.md` § Status taxonomy).
Cycle 1 answers review-0 (`revise`): R-CA-1 (§ 3.1) and R-CA-2 (§ 3, MCP server).
Uncommitted on `main` at `3912c5d`.
Contract: the ratified design `docs/slices/cat-admin-1.md` §§ 4.1–4.6 and 4.8, under rulings CA-D1 = A and CA-D2 = A
(§ 10). § 4.7 (the page editor) is `cat-admin-2` and is not in this slice. Builder packet: operator, 2026-11-01.
Track F — Glam catalog. Vision tie: the admin now states the product's model — two site kinds fixed at creation, and
independent switches — instead of showing catalog controls in places built for a shop (design § 2). No stored data, no
backend route and no shared schema changes (guarantees 1 and 2 are not affected).
Maturity: admin catalog screens **PROTOTYPE** → **MATURE** after review and the operator's look at a staging catalog
tenant (not part of this slice).

Evidence labels: **EXECUTED** = a command run by the builder in this slice; **OBSERVED** = read in a file or in the
output of a command; **INFERRED** = a conclusion, not run.

---

## 1. What changed, per packet item (file:line on the working tree)

| # | Item | Change |
|---|---|---|
| 1 | Sidebar (§ 4.2, CA-D1) | `admin/src/components/layout/Sidebar.tsx`: kind group `:58` (`isCatalog ? "Catalog" : "Commerce"`); catalog entries `:63` Pricelist import → `/catalog-import`, `:64` Interest lists → `/forms/${INTEREST_FORM_ID}/submissions`; "Digital sales" group `:79` with Digital Products (every kind); "Liste de interes" removed from Engagement. Test `Sidebar.test.ts`: the content and commerce navs equal the `3912c5d` nav with the one move (`withDigitalSalesGroup`), the catalog nav exactly, group order, the two hrefs. |
| 2 | Create New Site (§ 4.1) | `Sidebar.tsx:188-217`: a `radiogroup` of two radios `name="site-kind"`, with the design's two sentences verbatim. The payload line `:130` is not edited: `{ name, domain, catalogMode: newCatalogMode }`. Test: `Sidebar.test.ts` "Create New Site". |
| 3 | Pricelist import page (§ 4.3) | `admin/src/pages/CatalogImport.tsx` (new, 28 lines): `:15` a non-catalog site → "This site is not a catalog." and no form; `:20` title; `:21-22` the two contract sentences; `:25` `GlamPricelistImport` mounted unchanged, `onImported` a no-op with a comment (no list on this page). Route `admin/src/App.tsx:44` (import), `:102` `catalog-import`. Test: `Products.test.ts` "Pricelist import page" (catalog + both non-catalog kinds). |
| 4 | Products (§ 4.4) | `admin/src/pages/Products.tsx`: subtitle by kind `:205-207`; catalog → "Import a pricelist" link `:330` instead of "Import CSV"; WooCommerce panel `:343` `!catalog && showImport`; the glam mount and its import removed. Test: `Products.test.ts` (non-catalog byte-equal; catalog subtitle, link, no WooCommerce, no "Adjust Prices"). |
| 5 | Settings (§ 4.5, CA-D2) | `admin/src/pages/Settings.tsx`: "Catalog" card `:673-683` (design text verbatim, no control) else the Commerce card unchanged; Product Search gate `:925` `commerceEnabled \|\| isCatalogMode(config)`; URL Prefixes: Cart `:1390`, Checkout `:1400`, Account `:1418` only on a non-catalog site; "Interest list" `:1436` only on a catalog, bound to `urlPrefixes.interest` through the same `updateUrlPrefix` as the others (no client validation exists for any prefix; the backend stores what it gets). Test: `Settings.test.ts` (non-catalog byte-equal ×2; catalog card; Product Search per kind; prefix fields per kind). |
| 6 | WP Migration (§ 4.6) | `admin/src/pages/Migration.tsx`: `catalog` `:23`; the sentence `:204`; Products step omitted `:256`; Pages heading `:309` "Step 2: Pages" on a catalog; the existing-media banner `:247-249` says "Step 2" on a catalog. Test: `Migration.test.ts` (new). |
| 7 | Interest lists (§ 4.8) | `admin/src/pages/FormSubmissions.tsx:119` the title "Interest lists" for `INTEREST_FORM_ID`; ordinary forms keep `<name> - Submissions`; doc comment `:39` names the new sidebar entry. Test: `FormSubmissions.test.ts` (title; ordinary form byte-equal). |
| 8 | Architecture + record | `admin/ARCHITECTURE.md`: "Site kinds and switches" (three sentences, after *Depends on*); file tree (`GlamPricelistImport.tsx` mount, `Products.tsx`, `CatalogImport.tsx`, `Settings.tsx`, `Migration.tsx`, `FormSubmissions.tsx`, `__markup__/`); routing rows `/catalog-import`, `/forms/:id/submissions`; the glam section's "mounted by". This file. |

Byte-equality fixtures (rule 2): `admin/src/pages/__markup__/` — `products.{content,commerce}.html`,
`settings.{content,commerce}.html`, `migration.{content,commerce}.html`, `form-submissions.ordinary.html`. Written by
the first run of the new tests (`toMatchFileSnapshot`) while the pages were still the `3912c5d` files (EXECUTED:
`git status --porcelain -uall` at that moment listed only test files and `__markup__/`); their SHA-1 sums were taken
then and are unchanged at the end (EXECUTED `shasum -c`, all 7 OK).

Not touched: `renderer/`, `backend/`, `packages/`, `infra/`, `tools/`, `GlamPricelistImport.tsx`,
`GlamProfileEditor.tsx`, the design, `catalog-mode-1.md`.

## 2. How the page tests work (no DOM in the admin's unit config)

The admin unit config is node-only (`admin/vitest.config.ts`); there is no jsdom and the slice adds no dependency. The
tests render the real pages with `react-dom/server` (the pattern `Sidebar.test.ts` already used). Server rendering
never runs effects, so a page that loads data shows its first state. Two test-only state seeds make the loaded state
visible; each is a `vi.mock("react")` that wraps the real `useState` and is described in the test file header:

- `Products.test.ts`, `FormSubmissions.test.ts`: `useState(true)` starts `false`. Basis (EXECUTED grep): in those two
  pages the only `true` initial state is `loading`; `GlamPricelistImport.tsx`, `GlamProfileEditor.tsx`,
  `glamPreview.ts` have none. Rendered state: loaded, empty list.
- `Settings.test.ts`: an empty-object initial state starts as the fixture config. Basis (EXECUTED grep
  `useState[^(]*({})`): in the Settings tree only `config` (`Settings.tsx:78`) has it.

Coverage limit (stated, not hidden): rows of a loaded product list or submission list are not rendered by these
tests; the slice does not change them. The Migration banner for "media already imported" (`:247-249`) is not
rendered either (its count is loaded by an effect); its non-catalog bytes are equal by construction (INFERRED: JSX
`{n} text` and `{n}{c ? a : text}` both compile to the two children `[n, text]`, so the server output is the same).

## 3. Oracles (packet § 3), last lines

| Oracle | Result | Label |
|---|---|---|
| `npm --prefix admin run typecheck` | exit 0 (`tsc -b --noEmit --force`, no output) | EXECUTED |
| `npm --prefix admin run test:unit` | `Test Files 11 passed (11)` / `Tests 208 passed (208)` | EXECUTED |
| `npm run build` (root) | exit 0; admin `✓ built in 4.84s`; last step `infra@0.1.0 build` `tsc` | EXECUTED |
| `npm --prefix packages/plugins test` | `Test Files 5 passed (5)` / `Tests 201 passed (201)` | EXECUTED |
| `npm --prefix renderer test` | `Test Files 22 passed (22)` / `Tests 362 passed (362)` | EXECUTED |
| `npm --prefix renderer run test:serving` | `# tests 91` `# pass 91` `# fail 0` | EXECUTED |
| `git diff --stat -- renderer backend packages infra tools docs/slices/cat-admin-1.md docs/slices/catalog-mode-1.md` | prints nothing | EXECUTED |
| `git grep -n "Liste de interes" -- admin/src` | prints nothing, exit 1 | EXECUTED |
| `git diff --check` | clean, exit 0 | EXECUTED |
| `git status --porcelain -uall` | only allocated paths (§ 1) | EXECUTED |

Before the page edits, the 10 new-behaviour tests were red and the 188 existing tests green (EXECUTED): the new tests
discriminate. `cd backend && npm test` was not run (packet).

MCP server (`CLAUDE.md` § Definition of Done: "run `cd tools/mcp-server && npm test` (route coverage); after a backend
route change refresh `routes.json`" — the test run is required on every change; only the `routes.json` refresh depends
on a backend route change). Cycle 1 (review-0 R-CA-2) corrects the cycle-0 text, which said the tests were required
only after a backend route change and did not run them.

| Check | Result | Label |
|---|---|---|
| `cd tools/mcp-server && npm test` (cycle 1, builder) | exit 0; route coverage `PASS: every call targets a live route; ARCHITECTURE.md tool count matches.`; tool shapes `# tests 13` `# pass 13` `# fail 0` | EXECUTED |
| the same command, review-0 (reviewer run) | route coverage passed, 13/13 tool-shape tests | OBSERVED (reviewer's record, not builder execution) |
| `routes.json` refresh | not needed: no backend route changed (`git diff --stat -- backend tools` prints nothing) | EXECUTED |

### 3.1 Preservation renders take no input from the environment (review-0 R-CA-1)

Defect class: a preservation render (a byte-equality test against a `3912c5d` capture) that reads an input the test
does not fix, so the result depends on the checkout's `.env*` files or the shell. The only such input was
`VITE_RENDERER_URL`: `Settings.tsx:71` reads `window.AMODX_CONFIG?.VITE_RENDERER_URL || import.meta.env.VITE_RENDERER_URL`
while it renders, and the test stubbed `window` as `{}`, so `admin/.env.local` supplied the origin found in both
Settings captures.

Rule: **every preservation render fixes every external input it reads; the test supplies the admin's runtime config
(`window.AMODX_CONFIG`, read before `import.meta.env`), and no capture is re-taken.** Applied: `Settings.test.ts`
stubs `window` as `{ AMODX_CONFIG: { VITE_RENDERER_URL: "https://d111wtnnjzzsb1.cloudfront.net" } }`, the value the
captures were taken with. Basis for "the only such input" (EXECUTED grep of `import.meta.env`, `AMODX_CONFIG`,
`new Date`, `toLocale`, `Intl.`, `localStorage`, `navigator` over the rendered pages and the components they mount;
every URL in the 7 captures traced): the other URLs are static placeholders or come from the fixture
(`https://undefined/api/auth/callback/google` is `config.domain`, absent in the fixture); no date is rendered; `Intl`
use is the pure locale check. `Products.test.ts`, `Migration.test.ts` and `FormSubmissions.test.ts` do not define
`window`, so a render-time read of `window` there throws instead of silently taking an environment value
(`Products.tsx:15` reads it only in a click handler).

| Check | Result | Label |
|---|---|---|
| `npm --prefix admin run test:unit` with `VITE_RENDERER_URL` from `admin/.env.local`, set empty, and set to `https://other.example.test` | `Tests 208 passed (208)` each time | EXECUTED |
| the shell value reaches the tests (throwaway probe printing `import.meta.env.VITE_RENDERER_URL`, deleted) | `.env.local` value, empty, `https://other…` respectively | EXECUTED |
| reviewer's reproduction: a throwaway copy of `Settings.test.ts` with the old `window = {}` stub, `VITE_RENDERER_URL=` (deleted) | `Tests 2 failed \| 18 passed (20)` — the two Settings byte-equality tests | EXECUTED |
| captures unchanged (`shasum -c` against the sums taken at capture) | 7/7 OK | EXECUTED |

## 4. Abstractions

None. No new module, interface, helper or component other than the page the design names (`CatalogImport.tsx`).

## 5. Local decisions (one line each)

- CatalogImport contract sentences: "Upload one producer sheet at a time." / "The next import of a sheet replaces the products it created, hand edits included." (§ 4.3 gives the content, not the words).
- "Import a pricelist" is a `<Link>` styled as the default `Button` (`asChild`); "Add Product" kept as it was.
- Create New Site: each radio shows the kind name in bold followed by " — " and the design sentence, so the sentence stays verbatim (lower-case start).
- WP Migration on a catalog: the existing subtitle stays and the design sentence follows it; Pages is renumbered "Step 2"; the media banner says "Step 2".
- Interest-list prefix input: label "Interest list", placeholder "/lista-mea" (= `URL_PREFIX_DEFAULTS.interest`), placed after Search.
- Sidebar icon for "Pricelist import": `Upload` (lucide, already a dependency).
- Fixture directory name `admin/src/pages/__markup__/`.

## 6. Deviations

- The CatalogImport tests live in `Products.test.ts` (a describe block for the page that "Import a pricelist" opens), not
  in a `CatalogImport.test.ts`: the allocation names new test files only for the byte-equality fixtures.
- None against a ratified assumption.

## 7. Findings (not fixed here)

- **F-CA-IMPL-1 (stale doc comment).** `admin/src/components/GlamPricelistImport.tsx:16` still says "Products → Import →
  'Listă de prețuri (glam)' … mounted by `pages/Products.tsx`". It is now mounted by `pages/CatalogImport.tsx`. The
  packet forbids editing that file (rule 4); correct it in the next slice that edits the file.
- **F-CA-IMPL-2 (copy says "commerce" on a catalog).** The URL Prefixes card's description ("Configure URL paths for
  commerce pages") and footnote ("commerce URLs") show unchanged on a catalog. The design (§ 4.5) changes only the
  fields; the text was left as it is.
- **F-CA-IMPL-3 (two active entries).** On `/forms/interest-list/submissions` both "Forms" and "Interest lists" show as
  active, because the sidebar marks every entry whose href is a prefix of the path (`Sidebar.tsx`, `isActive`). The
  same was true for "Liste de interes" before; not changed.
- **F-CA-IMPL-4 (test files are not type-checked).** `admin/tsconfig.app.json:34` excludes `src/**/*.test.ts`, so
  `npm --prefix admin run typecheck` does not check the tests (existing convention; vitest strips types).
- **F-CA-IMPL-5 (generated maps stale).** `admin/src/**/*_MAP.md` are generated by `rmap` ("do not hand-edit"); they
  describe the old `Sidebar.tsx` line numbers and have no entry for `CatalogImport.tsx` until the next `rmap` run.
- The design's § 7 oracle says "serving suite 6/6"; the suite has 91 tests today (EXECUTED). All passed.

## 8. Operator closeout (2026-11-01)

- Review: relay review 1 (Codex `gpt-6.1-sol`) approved after one revise (R-CA-1 test environment input, R-CA-2 the
  MCP evidence wording); no decision was escalated.
- Gates (OPERATOR-EXECUTED on the approved candidate, unchanged): the ten common gates exit 0; infra, renderer,
  backend, packages and tools untouched; design and earlier records untouched; no dependency line; no "Liste de
  interes" left in `admin/src` (grep exit 1); no trailing whitespace. The operator's allocation gate listed the
  seven `admin/src/pages/__markup__/*.html` captures because its regex guessed the directory name
  (`__fixtures__`); the packet's allocation ("new test files under `admin/src/pages/`") covers them — accepted.
- Staging: deployed from this tree (code only: 3 Lambda assets, the admin and renderer uploads, the admin config
  write; nothing added or removed). Renderer build `AcJAuGbLGFPJdMxx1n-qC` → `M1w166xT5AQB51TZ8dGXT`; the 51 CM1
  URLs text- and status-identical (no renderer source changed). The deployed admin bundle holds "Pricelist import",
  "Interest lists" and "Digital sales" and no "Liste de interes" (curl of `index-*.js`). A browser walk of the
  staging admin on a catalog tenant: NOT RUN (no catalog tenant exists on staging; the unit renders of each page per
  kind are the proof).
- Findings F-CA-IMPL-1 (stale comment in `GlamPricelistImport.tsx`) and F-CA-IMPL-2 (URL Prefixes copy says
  "commerce" on a catalog) go to the `cat-admin-2` packet. F-CA-IMPL-3/4/5 recorded, not scheduled.
