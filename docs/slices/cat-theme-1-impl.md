# CAT-THEME-1-IMPL — the theme details the glam catalog design needs (IMPL record)

Status: **IMPLEMENTED** (2026-11-02, round 1) — code complete, review pending; two decisions are open for the human
(§ 6: CT-IMPL-NAV-DEFAULT, CT-IMPL-EDITORIAL-TARGETS) and each is built in its byte-preserving / minimal reading, which is
reversible. Uncommitted on `main` at `0865ac6`.
- 2026-11-02 (round 2): review 0 → escalate; operator rulings ~10:40Z: both decisions = A (as built), R-CT-1..4 corrected,
  R-CT-5 oracle corrected by the operator, F-CT-5 closed. Round 2 is § 9; gates § 9.4.
Contract: the ratified spec `docs/slices/cat-theme-1.md` (§ 3 items 1–7, § 4 CT-D1 = A, CT-D2 = B, § 6 the width
ruling). Builder packet: operator, 2026-11-01 (with its premise correction: the muted and hairline colours are the
injector's constants, not framework defaults).
Track F — Glam catalog. Vision tie: a tenant can give its site the glam catalog look (a nav font, extra weights, a
lighter heading, muted and hairline colours, the "editorial" shape, landscape cards with a category line, wider pages
and a separate footer width) from Settings, with no code per tenant — and no live site changes until its owner sets a
field (`docs/VISION.md`: products, not MVPs; production sensitivity is real).
Maturity: theme details **PROTOTYPE** → **MATURE** after review and a staging check on a real catalog tenant.

Evidence labels: **EXECUTED** = a command run by the builder in this slice; **OBSERVED** = read in a file or in the
output of a command; **INFERRED** = a conclusion, not run.

---

## 1. Every new field: name, default, where it is read

All are optional with NO default in the schema (absent = the rendering before the slice, byte for byte). Schema:
`packages/shared/src/index.ts` `ThemeSchema` / `FooterConfigSchema`; `themeOverride: ThemeSchema.partial()` takes the
eight theme fields automatically with the same rules (shared test "a page themeOverride …"; § 7 item 4 for what a page
override does with them).

| Field | Type / rule | Absent = | Read by (renderer) | Admin control |
|---|---|---|---|---|
| `theme.fontNav` | string (renderer: `sanitizeFontFamily`) | the nav keeps its font today (the body font) — see CT-IMPL-NAV-DEFAULT | `ThemeInjector` (third family, `--font-nav`); `layout.tsx` → Navbar `navFont` (class `font-[family-name:var(--font-nav)]` on the desktop items and the mobile menu) | Typography → Nav Font |
| `theme.fontWeights` | int[] each 100–900 | request `400;700` | `ThemeInjector`: request = `400;700` ∪ list, ascending, for every family | Typography → Additional Weights (checkboxes 100, 200, 300, 500, 600, 800, 900) |
| `theme.headingWeight` | int 100–900 | no rule | `ThemeInjector`: `h1…h6 { font-weight: N }` | Typography → Heading Weight |
| `theme.mutedColor` | `CssColorSchema` | `#64748b` (the injector's constant) | `ThemeInjector` `--muted-foreground` | Theme card → Palette → Muted Text |
| `theme.borderColor` | `CssColorSchema` | `#e2e8f0` (the injector's constant) | `ThemeInjector` `--border` and `--input` (D-1) | Theme card → Palette → Hairlines |
| `theme.shape` | `"default"` \| `"editorial"` | `"default"` = today | `ThemeInjector`, `layout.tsx`, `SitePage.tsx` (§ 3) | Theme card (light tab) → Shape |
| `theme.cardImage` | `"square"` \| `"landscape"` | square | `SitePage.tsx` `cardThemeProps` → `ProductCard` (`h-[245px]` instead of `aspect-square`) | Theme card → Cards → image |
| `theme.cardCategoryLine` | boolean | off | `SitePage.tsx`: the first category's name under the card title (shop, category, search) | Theme card → Cards → checkbox |
| `footer.contentMaxWidth` | string (Tailwind class), `FooterConfigSchema` strict | the header's width (`layout.tsx`, the rule before the slice) | `layout.tsx` footer; `lib/dynamo.ts` `mapTenant` copies `footer` | Navbar & Layout → Footer Width ("Same as header" → `footer: {}`) |
| width lists | + `max-w-[1440px]`, `max-w-[1600px]` (header/footer; `max-w-[1920px]` was already there), + 1440 / 1600 / 1920 (pages) | — | compiled because `renderer/src/lib/widths.ts` names them | `HEADER_WIDTH_OPTIONS`, `PAGE_WIDTH_OPTIONS` |

Backend: `backend/src/tenant/settings.ts` `themeAttributesError` checks, as sent and before any read, the eight new
fields on `theme` and `darkTheme` (objects only; the older theme fields stay unvalidated) and `footer` → 400 naming the
field (`theme.fontWeights.1: …`), nothing read or written. Tests `backend/test/unit/cat-theme-settings.test.ts` (7).

## 2. How live sites keep their bytes (hard rule 1)

- **Rule applied everywhere:** every new output is a conditional segment that is `""` when the field is absent (the
  `<style>` text, the font URL), a class string that is the old string when absent, or a conditional spread
  (`{...(x ? { prop: true } : {})}`) for a client component's props (an `undefined` prop would travel as `"$undefined"`).
- **The defect class found while building (closed by one rule).** Serving run 0 (EXECUTED, rows still on `quote-1`):
  95/99 — `cm1-identity-commerce`, `cm1-identity-content`, `loc1-diff-quote-1`, `loc1-flight-controls` failed on every
  listing page: my `{categoryName && <p>}` added a child slot to the card's `Link` (a client element; its children
  travel in the payload by position: `false` / `"$undefined"`). Rule: **a theme option may change an element's
  attributes or replace one child by another in the same slot; it never adds a child slot.** The category line now
  shares the title's slot (`{categoryName ? <>{title}<p/></> : title}`). Run 1 (EXECUTED): 99/99 on the unchanged rows —
  no byte of any live fixture moved.
- **Proof against the slice's own start capture.** `locale-1/theme-1/before/` (from `0865ac6`, § 5) with
  `expected-diff.json` listing NOTHING for any of the 81 en-US URLs; `loc1-subjects` requires every list to be `[]`;
  `loc1-diff-theme-1` passes; `cm1-identity-*`: 32 × "same", 0 × "DIFF" (EXECUTED, final runs). `cm1-byte-identity/
  baseline/` was NOT re-captured (no byte moved). The RO copies: no text change (`theme-1/ro-expected.json`).
- **The stylesheet** gets new rules (the new classes), so its content-hash name changes on every page; masked by CM1-A1
  and accepted by the category-4 raw rule since F-CQ-3 (cat-quote-1). No other row compares the name.
- **Admin** (no renderer byte): § 3 last table row; captures § 5.

## 3. The editorial shape — every rule (CT-D1 = A)

| Rule (spec § 3 item 4/6, packet rule 2) | Where | Mechanism | Proof (row `ct1-editorial`) |
|---|---|---|---|
| no shadows | `ThemeInjector` `EDITORIAL_CSS` | `*, ::before, ::after { --tw-shadow: 0 0 #0000 !important }` — every `shadow*` utility paints `var(--tw-shadow)`; rings paint `--tw-ring-shadow` and stay (OBSERVED in the compiled CSS: `.shadow-lg{--tw-shadow:…;box-shadow:…,var(--tw-shadow)}`, `focus-visible:ring-2{--tw-ring-shadow:…}`). Covers the gallery arrows (`shadow`) and the quick contact (`shadow-lg`) with no edit there | rule in `<style>`; absent at `0865ac6` |
| 1 px hairline separators | `SitePage.tsx` `ProductAttributes` | each `dt`/`dd` `py-2 border-b` (1 px, `--border` = borderColor) — CT-IMPL-EDITORIAL-TARGETS | `<dt class="text-muted-foreground py-2 border-b">` |
| section spacing widened | `ThemeInjector` (`--section-gap: 6rem`); `SitePage.tsx` content-page `<main>` and the shop / category / search `<main>`s | `py-[var(--section-gap)]` instead of `py-12` (3rem) | `/about`, `/shop`, `/category/floors` wrappers |
| "↗" after nav links and buttons | Navbar (`linkArrows`), CommerceBar (`ctaArrow`) set `data-theme-arrow`; `ThemeInjector` `[data-theme-arrow]::after, [data-quote-request]::after { content: " \2197" }` | CSS generated content — never DOM text, so the extraction and the text comparator are unaffected; the quote button is `QuoteRequest.tsx`'s existing `data-quote-request` (cat-quote-1 D-10 left its arrow here; file unchanged) | marker on exactly Shop, About, Contact; rule in `<style>`; unit test `cat-theme-1.test.ts` (every Navbar element, the CTA) |
| 3 px primary top border on the header | `layout.tsx` sticky wrapper | `border-t-[3px] border-primary` | wrapper class; compiled rule |
| footer on the surface colour | `layout.tsx` | `bg-muted` (`--muted` = surfaceColor) instead of `bg-muted/30` | footer class |
| spec table key column 50 % | `SitePage.tsx` `ProductAttributes` | `grid-cols-2` instead of `grid-cols-[auto_1fr]` | `<dl class="grid grid-cols-2 gap-x-6 text-sm border-t">` |

Positive controls: each asserted string is absent from the `0865ac6` capture of the same URL (base ignores the fields);
`loc1-diff-theme-1` adds five refusals — each editorial class or marker put into a tenant without the field is reported.

## 4. Local decisions (naming and detail; one line each)

- **D-1** `borderColor` sets `--border` AND `--input` (both were the same constant `#e2e8f0`; an input border is a hairline).
- **D-2 (deviation from the packet's wording)** `WIDTH_CLASSES` (`renderer/src/lib/widths.ts`) is read by NO runtime
  code: Tailwind 4 compiles from the files it scans, not from imports, so the packet's "a list that the layout reads"
  would add a read with no behaviour. Its user is the Tailwind scanner (EXECUTED: `@tailwindcss/oxide` Scanner on
  `widths.ts` alone yields the three classes).
  - 2026-11-02 (round 2): STANDS (operator R-CT-5: the packet's "a list that the layout reads" was a wrong mechanism claim;
    `widths.ts` is the one source of the three literals).
- **D-3** The nav font is set on the two item containers (desktop items, mobile menu), not on each link; the site title
  keeps its font.
- **D-4** Arrow targets: desktop simple links, dropdown items, the contact button (desktop and mobile), the Commerce Bar
  CTA, the catalog quote button. Not: the logo, dropdown toggles, account / sign-in links, widgets, pagination, plugin
  buttons (`packages/plugins` not allocated). CT-IMPL-EDITORIAL-TARGETS.
  - 2026-11-02 (round 2): RATIFIED (CT-IMPL-EDITORIAL-TARGETS = A) as THIS slice's target list; further targets are a
    follow-up after the human sees the editorial look on the real tenant.
- **D-5** Hairlines: the spec table rows only (the one place spec § 2 calls "hairline rows"). CT-IMPL-EDITORIAL-TARGETS.
  - 2026-11-02 (round 2): RATIFIED (= A). `borderColor` already recolours every existing border (`--border`), so the
    design's other separators take the hairline colour through it.
- **D-6** Section gap 6rem (today `py-12` = 3rem); the product page's `<main>` keeps `py-12` (a detail page, not a
  listing or a content page).
- **D-7** Landscape = a fixed `h-[245px]` cover (spec: "245 px cover = landscape").
- **D-8** Category line = the name of `categoryIds[0]` found among the tenant's categories; the category and search
  routes call `getAllCategories` only when the line is on (the shop already reads them); a missing first category →
  no line.
- **D-9** Fixtures `loc1-theme-editorial` (copy of the CM1 catalog) and `loc1-theme-footer` carry `locale: "en-US"`
  written out, so they are not en-US subjects (the rule is "no `locale`"; the CQ1 / LOC1E precedent).
- **D-10** Admin controls are native elements or `Input` (no React `useId`), each group the last child of its parent;
  weights as checkboxes of the multiples of 100 (the schema accepts any integer 100–900); clearing removes the key.
- **D-11** `THEME_PRESETS` is typed `ThemePreset` (the older string fields): the admin build failed in
  `ContentEditor.tsx` (not allocated), which merges a preset into `Record<string, string>` (EXECUTED: root build exit 2,
  TS2345 "fontWeights … number[] not assignable to string"); presets never hold the new fields.
- **D-12** The colour rule moved unchanged from `renderer/src/lib/sanitize.ts` to shared `isCssColor`; `sanitizeCssColor`
  calls it; `PUT /settings` uses it through `CssColorSchema`.
  - 2026-11-02 (round 2): SUPERSEDED by R-CT-2 (§ 9.1). The moved regexes were an injection-safety filter, not a colour
    grammar (`#12345`, `#1234567`, `rgba(1,2,3,...)` passed), so the name `isCssColor` overstated them. `sanitize.ts` is
    back to its `0865ac6` bytes (the filter keeps its job and its name `sanitizeCssColor`); shared `isCssColor` is now a
    grammar.
- **D-13** Invalid stored values are ignored by the injector (sanitized like the existing fields: a bad colour → the
  constant, a bad font → no nav font, a bad weight → dropped) — unit test.
- **D-14** The footer select reuses `HEADER_WIDTH_OPTIONS` (the footer's list = the header's + "Same as header").

## 5. Captures (DoD steps 1 and 6)

- **`theme-1/before/` (EXECUTED).** Worktree `/tmp/CAT-THEME-1-base` at `0865ac6`; `node_modules` cloned; `packages/shared`,
  `effects`, `plugins` built there (no `fontNav` in its shared `dist`, none in its injector or `mapTenant`);
  `harness.mjs`, `ddb-stub.mjs`, `cm1-byte-identity.mjs`, `no-dotenv.cjs`, `locale-1/extract.mjs` byte-identical in both
  trees (`diff -q`); this tree's `fixtures.mjs` and `locale-1/proof.mjs` copied in. A throwaway script (not committed)
  built and served the base renderer with the suite's harness and captured `EN_US_REQUESTS` + `LOC1_REQUESTS` +
  `CQ1_REQUESTS` + `CT1_REQUESTS`: build `RziaiUf9XfYzE-mJXkGuR`, 151 captures (200: 141, 307: 8, 404: 2), stub
  `unhandled` = `[]`. Consistency (EXECUTED): the 81 en-US URLs of `quote-1/before/` (29a2282) against `theme-1/before/`
  under `quote-1/expected-diff.json` → 0 problems.
- **Admin `__markup__/settings.{content,commerce}.html` — RE-TAKEN ONCE from the base commit (packet rule 4; EXECUTED).**
  In the same worktree: a throwaway copy of `0865ac6`'s own `Settings.test.ts` (its mocks, fixtures and `renderSettings`)
  plus one writer test; the base run passed 30/30 (its own preservation rows included, so the re-take = the 3912c5d
  capture + exactly the cat-quote-1 additions). Never from the candidate. `Settings.test.ts` now compares the page minus
  exactly the four groups (`TypographyDetails`, `ThemeColorDetails`, `ShapeAndCards`, `FooterWidthControl`, each its own
  render, each once); the cat-quote-1 exclusions are gone because the re-take holds those additions. Controls: one
  attribute, one text, one Commerce Bar attribute, one byte next to a removed group — each reported.
- Worktree, scripts and temp captures removed at the end (§ 8).

## 6. Decisions and findings

DECISION_REQUIRED:
- ID: CT-IMPL-NAV-DEFAULT
  QUESTION: When a tenant sets no nav font, which font do the nav links use? The spec (§ 3 item 1) and the human's
  words say "absent → the heading font". But today the nav links use the BODY font (`Navbar.tsx` sets no font family;
  the body rule applies — OBSERVED), and hard rule 1 / spec § 3 say "defaults = today's bytes". The two cannot both hold.
  OPTIONS:
  - A (BUILT) — absent → the nav keeps the body font, exactly as today. REWARD: zero bytes and zero visible change on
    every live site; a tenant that wants the heading font on its nav types the heading font's name into Nav Font. RISK:
    the default the human named is not the default; the admin hint says "Empty: the body font, as today".
  - B — absent → the heading font for every tenant (the Navbar always uses `var(--font-nav, var(--font-heading))`).
    REWARD: the human's stated default. RISK: every page of every live tenant changes (one class on the nav containers,
    a ledger row on every URL, a re-capture of `cm1-byte-identity/baseline/`), and every live site's nav switches font
    the day this deploys — a visible change nobody asked the tenants about.
  RECOMMENDED: A (reversible: B is one class and one ledger row later).
  BLOCKING_REASON: not blocking for the rest of the slice; only the default of an absent field depends on it.
  RULED 2026-11-02 (~10:40Z, operator under the human's overnight delegation; reversible): A — absent → the body font,
  today's bytes. B (one class, one ledger row) goes to the human with its effect (every live nav changes font on deploy).
  The admin's Nav Font placeholder says "Leave empty to keep the body font".

DECISION_REQUIRED:
- ID: CT-IMPL-EDITORIAL-TARGETS
  QUESTION: Which elements get the editorial "hairline separators" and the "↗"? The design list (glamCRM session,
  2026-11-01) is not in the repository; the spec and packet say "where the design names them".
  OPTIONS:
  - A (BUILT) — hairlines on the spec table rows; arrows on the nav text links, dropdown items, contact button, Commerce
    Bar CTA and the catalog quote button (D-4, D-5). REWARD: every named element covered inside the allocated files;
    each is one class or marker. RISK: the design may name more (plugin CTA / hero buttons, facet groups, listing card
    separators).
  - B — the human/operator names the further elements; a follow-up adds them (plugin buttons need `packages/plugins`).
    REWARD: matches the design exactly. RISK: one more slice.
  RECOMMENDED: A now, B on demand.
  BLOCKING_REASON: not blocking; CSS-only additions later.
  RULED 2026-11-02 (~10:40Z, operator): A — D-4 / D-5 are this slice's target list (sub-bullets there).

Findings (no change made; for the operator / human):

- **F-CT-1 (pre-existing, visible on deploy): the admin offers width classes the renderer never compiled.** OBSERVED in
  the candidate's compiled stylesheet: no rule for `max-w-[1700px]`, `max-w-screen-xl`, `max-w-screen-2xl`,
  `max-w-full`; `git grep` at `0865ac6` (exit 1): no renderer or plugin source named `max-w-[1920px]` either. So a tenant
  that chose "Full HD (1920px)" (or 1700 / Screen XL / Screen 2XL / Full) got NO max-width — full width. **After this
  slice, a live tenant that stored `max-w-[1920px]` gets a 1920 px cap** (visible only on screens wider than 1920 px;
  HTML bytes unchanged). I did not read production data (rule 7). Proposed: before the deploy, the operator lists live
  tenants' `header.contentMaxWidth` / `contentPageMaxWidth`; a follow-up adds the other offered classes to
  `WIDTH_CLASSES` or drops them from the lists.
  - 2026-11-02 (round 2): to the human, with the follow-up proposal `WIDTH-OPTIONS-1` (one shared list for the admin
    options, the renderer's compiled classes and the backend's validation).
- **F-CT-2 (pre-existing): Tailwind compiles class names from test files.** EXECUTED (`@tailwindcss/oxide` Scanner, base
  `renderer/`): 1389 files scanned, including `test/serving-contract/fixtures.mjs` and every captured `.body` file. So
  production CSS holds classes named only by tests, and the base worktree compiled 1440 / 1920 from my copied fixtures.
  Consequence: "the class compiles" can be true for a test-only reason (why D-2 checks `widths.ts` alone). Proposed (needs
  a ruling — it changes every page's stylesheet): `@source not "../../test";` in `globals.css`.
  - 2026-11-02 (round 2): to the human, follow-up `TAILWIND-SOURCES-1`.
- **F-CT-3 (wording): "Site Width (Header/Footer)"** (Navbar & Layout) now describes the footer's DEFAULT only. Kept (the
  preservation rows pin the existing label). Proposed: "Site Width (Header; footer by default)".
- **F-CT-4 (limit): a page `themeOverride` with the new fields** is accepted by the schema; only what the injector emits
  applies there (colours, fonts, heading weight, section-gap value, the no-shadow and quote-arrow rules). The class-level
  effects (nav font class, arrow markers, header border, footer colour, cards, spec table, wrappers) read the TENANT
  theme. Documented debt.
- **F-CT-5 (INFERRED risk): a weight a family does not have.** The Google Fonts css2 API may answer the whole request
  with an error when a listed weight does not exist for a family (not verified — no network in the gates). Only
  tenants that add weights are exposed; the admin hint names the 400/700 rule.
  - 2026-11-02 (round 2): CLOSED by the operator's live checks (2026-11-02): `css2?family=Martel+Sans:wght@500` → 400 (no
    such weight), but `…:wght@300;400;500;600;700` → 200 with the 4 existing faces, and the two-family request of the glam
    list → 200 with 9 faces. A missing weight is dropped silently whenever the family has ANY requested weight; `400;700`
    is always requested, so the loader is safe.

## 7. Abstractions introduced (one line each)

- `isCssColor` / `CssColorSchema` (shared) — users: renderer `sanitizeCssColor`, `ThemeSchema` colour fields (PUT
  /settings); axis: none (one rule both sides of the route); rejected: a second copy of the regexes.
  - 2026-11-02 (round 2): users now `ThemeSchema` colour fields (PUT /settings) only; the renderer's `sanitizeCssColor` is
    its own `0865ac6` filter again (R-CT-2, D-12). Rejected alternative: the safety filter under a new shared name — it has
    one caller, the renderer.
- `FontWeightSchema` (shared) — users: `fontWeights` items, `headingWeight`; rejected: the rule written twice.
- `FooterConfigSchema` (shared) — users: `TenantConfigSchema.footer`, the backend `footer` check; rejected: an inline
  object the backend could not reuse.
- `ThemePreset` (shared type) — user: `THEME_PRESETS`; rejected: editing `ContentEditor.tsx` (not allocated).
- `WIDTH_CLASSES` (renderer `lib/widths.ts`) — user: the Tailwind scanner (build time); rejected: the literals in the
  layout (the packet allocated a lib source; D-2).
- `ThemeDetailsSchema` + `themeAttributesError` (backend, local) — user: the PUT handler; axis: none; rejected: a full
  `ThemeSchema` parse (would refuse stored legacy themes).
- `isFontWeight`, `EDITORIAL_CSS` (ThemeInjector, local); `isEditorial`, `cardCategoriesOf`, `cardThemeProps`
  (SitePage, local; 4 / 2 / 3 call sites) — rejected: the expressions repeated inline.
- `TypographyDetails`, `ThemeColorDetails`, `ShapeAndCards`, `FooterWidthControl`, `HEADER_WIDTH_OPTIONS`,
  `PAGE_WIDTH_OPTIONS`, `EXTRA_FONT_WEIGHTS`, `ThemeKeySetter` (admin, exported) — users: `SettingsPage` and the
  exact-exclusion seam of `Settings.test.ts` (the header list also by the footer select); rejected: inline JSX (the test
  could then remove the controls only by a markup search).
- Test helpers: `CT1` / `CT1_THEME` / `CT1_REQUESTS`, `ct1Set`, `ct1Page`, `shows`, `cq1BeforeSet` — the CQ1 pattern.
- No new module boundary, dependency, interface or infra. No dispatch abstraction (the shape is a closed enum read by
  three `=== "editorial"` checks).

## 8. Gates and oracles (EXECUTED on the final tree, in this order; logs temporary; results also in `build-progress.md`)

Run twice: a first full set, then — after the last code change (the spec-table classes collapsed into one JSX, § 4) — the
whole set again, with the same results. `cm1-identity-*` in the final runs: 32 × "same", 0 × "DIFF".

| Check | Command | Result | Label |
|---|---|---|---|
| 1 | `npm --prefix "<repo>" run build` | exit 0 | EXECUTED |
| 2 | `npm --prefix "<repo>" run typecheck` | exit 0 | EXECUTED |
| 3 | `npm --prefix "<repo>/packages/shared" test` | exit 0, 281 tests (273 + 8) | EXECUTED |
| 4 | `npm --prefix "<repo>/packages/plugins" test` | exit 0, 204 tests | EXECUTED |
| 5 | `npm --prefix "<repo>/renderer" test` | exit 0, 398 tests (389 + 8 `cat-theme-1.test.ts` + 1 map-tenant row) | EXECUTED |
| 6 | `npm --prefix "<repo>/renderer" run test:serving`, 6 consecutive runs | exit 0 six times, 101 pass / 0 fail each (99 + `ct1-editorial`, `ct1-footer-width`) | EXECUTED |
| 7 | `npm --prefix "<repo>/admin" run test:unit` | exit 0, 236 tests (232 + 4) | EXECUTED |
| 8 | `npm --prefix "<repo>/backend" run test:unit` | exit 0, 1239 passed, 1 skipped (1232 + 7) | EXECUTED |
| 9 | `npm --prefix "<repo>/tools/mcp-server" test` | exit 0, 13 pass / 0 fail | EXECUTED |
| 10 | `git -C "<repo>" diff --check` | exit 0 | EXECUTED |
| O-1 | `git diff --stat -- infra backend/src/import docs/slices/cat-theme-1.md docs/slices/locale-1.md` | empty | EXECUTED |
| O-2 | `git status --porcelain -uall` | only allocated paths: 22 modified, 7 untracked files + 153 under `theme-1/before/` | EXECUTED |
| O-3 | `git ls-files -z --others --exclude-standard \| grep -zv '\.body$' \| xargs -0 grep -c -E '[[:space:]]+$'` | 0 in every file (grep exit 1) | EXECUTED |
| O-4 | `git status --porcelain -- tools/mcp-server` (`routes.json` unchanged) | empty | EXECUTED |
| O-5 | `git -C "<repo>" grep -n "max-w-\[1440px\]" -- renderer/src` | prints NOTHING while `widths.ts` is untracked: `git grep` searches tracked files only. Same command with `--untracked`: `renderer/src/lib/widths.ts:13:…` (exit 0). After the operator's commit the literal command prints that line. (2026-11-02, round 2: the operator corrected the oracle to the `--untracked` form, R-CT-5; round 1's "all checks pass" was wrong for this oracle as written) | EXECUTED |
| — | `cd backend && npm test` | NOT RUN (packet: never; real staging DynamoDB) | NOT RUN |
| — | real browser (fonts load, ↗ visible, shadows gone, widths collapse on a phone) | NOT RUN: no browser in the gates; the CSS mechanisms are proven on the compiled stylesheet and the served HTML | NOT RUN |

## 9. Round 2 (2026-11-02, after review 0 and the operator rulings of ~10:40Z)

Defect classes and the one rule that closes each (review-0 closure rule: validate every supported input representation,
bind controls to the state they modify, test guarantees against existing consumers):

### 9.1 What changed (file and symbol on the working tree)

| Ruling | Class → rule | Change | Tests |
|---|---|---|---|
| R-CT-1 | a validator that checks one of two representations → **check every representation the reader accepts** | `backend/src/tenant/settings.ts` `themeObjectOf`: `theme` / `darkTheme` as an object, or a JSON string parsed for the check only (the body is stored as sent); a string that does not parse to an object keeps today's behaviour | `backend/test/unit/cat-theme-settings.test.ts` (10): every bad new field (incl. the review's colours) → 400 naming the field, nothing read or written, for object AND string, `theme` AND `darkTheme`; a valid string stored unchanged; non-object strings stored as sent |
| R-CT-2 | a name that claims more than the code checks → **a grammar named `isCssColor`; the safety filter keeps its old name and job** | shared `isCssColor` (hex 3/4/6/8; `rgb`/`rgba`/`hsl`/`hsla` exact arity, r g b 0–255, h 0–360, s l 0–100 %, alpha `0`/`1`/`0.5`/`.5`/`1.0`; the 23 names, any case — local decision: the renderer's list kept, so every accepted value also passes the renderer filter); `renderer/src/lib/sanitize.ts` byte-identical to `0865ac6` | shared `theme-details.test.ts` (9): the review's counterexamples, arity, ranges, alpha; backend as above |
| R-CT-3 | a control that reads one state and writes another → **every theme control reads the theme `updateTheme` writes** | `admin/src/pages/Settings.tsx`: `withThemeKey` (the page's write, moved out unchanged); the Typography card's Heading, Body and `TypographyDetails` read `activeConfig` (the two pre-existing inputs had the same mismatch — fixed by the same rule; the light tab, which the captures render, reads the same values as before); `ShapeAndCards` reads `activeConfig` (light tab only, so the same) | `Settings.test.ts` (35): a connected render with different light / dark values shows each tab's values (heading, body, nav font, weights, heading weight) and the dark group equals its own render; the write rule; preservation rows unchanged |
| R-CT-4 | a guarantee tested against the mechanism → **test it against every consumer of the guaranteed effect** | `ThemeInjector` `EDITORIAL_CSS`: + `--tw-drop-shadow: initial !important` (inventory, EXECUTED `git grep` over `renderer/src` and `packages/plugins/src`: the only shadow mechanisms are `shadow*` → `--tw-shadow` and `drop-shadow-*` → `--tw-drop-shadow` in hero / video-hero; no inline or text shadows) | serving row `ct1-no-shadows` (fixture `/hero`, cover hero, on the editorial tenant and on the default-shape control tenant); unit `cat-theme-1.test.ts` rule text |
| R-CT-5 | — | oracle corrected by the operator (`--untracked`); D-2 stands | § 9.4 |
| CT-IMPL-NAV-DEFAULT = A | — | the Nav Font placeholder "Leave empty to keep the body font" | `Settings.test.ts` |

### 9.2 The real-browser check of R-CT-4 (EXECUTED once; not a gate)

Throwaway script (`/tmp/CAT-THEME-1-scripts/browser.mjs`, removed) with the repo's `playwright` and the cached Chromium,
on the renderer's compiled stylesheet (inlined; the first attempt linked it by `file://`, it did not load, and the
no-rule control showed `none` too — so that run was discarded). Computed values:

| Element | no rule (default shape) | round-1 rule | round-2 rule |
|---|---|---|---|
| hero `h1.drop-shadow-lg` `filter` | `drop-shadow(rgba(0,0,0,0.15) 0px 4px 4px)` | same (shadow stays) | `none` |
| subheadline `.drop-shadow-md` `filter` | `drop-shadow(rgba(0,0,0,0.12) 0px 3px 3px)` | same | `none` |
| `.drop-shadow-lg` + `--tw-blur: blur(2px)` | `blur(2px) drop-shadow(…)` | same | `blur(2px)` (unrelated filter kept) |
| `.shadow-lg` `box-shadow` (last layer) | `rgba(0,0,0,0.1) 0px 10px 15px -3px, …` | transparent | transparent |
| focused `input.focus:ring-2` `box-shadow` | `rgb(0,0,0) 0px 0px 0px 2px` among layers | same | same (ring kept) |

CI has no browser and the renderer has no browser dependency, so the committed proof is the CSS-level row
`ct1-no-shadows` (it fails on the round-1 rule, asserted in the row).

### 9.3 Local decisions (round 2, one line each)

- **D-15** `--tw-drop-shadow: initial` (not `drop-shadow(0 0 #0000)`): it restores the "never set" state of Tailwind's
  registered variable, so the `filter` list loses only the shadow and gains no extra filter (§ 9.2).
- **D-16** The `/hero` fixture pages are outside `CT1_REQUESTS` (not in `before/`): they are new pages, read only by
  `ct1-no-shadows`, so the `0865ac6` capture set stays as taken.
- **D-17** The colour grammar keeps the renderer's 23 names (not the 148 CSS names), so a stored value never falls back
  in the renderer.
- Abstractions (round 2): `themeObjectOf` (backend, local) — user: `themeAttributesError`; axis: the two stored theme
  representations; rejected: two inline branches. `withThemeKey` (admin, exported) — users: the page's `updateTheme`, the
  write-rule test; rejected: the closure only (untestable without a DOM). `shadowConsumers` / `forcedShadows` (serving
  row helpers) — user: `ct1-no-shadows`.
- **D-18** The Settings test seeds the theme tab by the existing `useState` wrapper (`seed.tab`, the page's only
  `useState("light")`); react-dom/server runs no events, so the write side is tested through `withThemeKey`, which the
  page's `updateTheme` calls with the same tab.

### 9.4 Gates and oracles — round 2 (EXECUTED on the final tree, in this order)

| Check | Command | Result | Label |
|---|---|---|---|
| 1 | `npm --prefix "<repo>" run build` | exit 0 | EXECUTED |
| 2 | `npm --prefix "<repo>" run typecheck` | exit 0 | EXECUTED |
| 3 | `npm --prefix "<repo>/packages/shared" test` | exit 0, 282 tests (round 1: 281; the colour tests became 3) | EXECUTED |
| 4 | `npm --prefix "<repo>/packages/plugins" test` | exit 0, 204 tests | EXECUTED |
| 5 | `npm --prefix "<repo>/renderer" test` | exit 0, 398 tests | EXECUTED |
| 6 | `npm --prefix "<repo>/renderer" run test:serving`, 6 consecutive runs | exit 0 six times, 102 pass / 0 fail each (101 + `ct1-no-shadows`); `cm1-identity-*` 32 × "same", 0 × "DIFF"; `loc1-subjects` 81 URLs, each listing nothing | EXECUTED |
| 7 | `npm --prefix "<repo>/admin" run test:unit` | exit 0, 238 tests (236 + 2) | EXECUTED |
| 8 | `npm --prefix "<repo>/backend" run test:unit` | exit 0, 1242 passed, 1 skipped (1239 + 3) | EXECUTED |
| 9 | `npm --prefix "<repo>/tools/mcp-server" test` | exit 0, 13 pass / 0 fail | EXECUTED |
| 10 | `git -C "<repo>" diff --check` | exit 0 (run last, after every edit) | EXECUTED |
| O-1 | `git diff --stat -- infra backend/src/import docs/slices/cat-theme-1.md docs/slices/locale-1.md` | empty | EXECUTED |
| O-2 | `git status --porcelain -uall` | only allocated paths (`renderer/src/lib/sanitize.ts` no longer modified) | EXECUTED |
| O-3 | `git ls-files -z --others --exclude-standard \| grep -zv '\.body$' \| xargs -0 grep -c -E '[[:space:]]+$'` | 0 in every file | EXECUTED |
| O-4 | `git status --porcelain -- tools/mcp-server` | empty (`routes.json` unchanged) | EXECUTED |
| O-5 (corrected, R-CT-5) | `git -C "<repo>" grep --untracked -n "max-w-\[1440px\]" -- renderer/src` | `renderer/src/lib/widths.ts:13:…` (exit 0) | EXECUTED |
| — | `cd backend && npm test` | NOT RUN (packet: never) | NOT RUN |
| — | real browser on a served page | the R-CT-4 computed styles were checked once in Chromium (§ 9.2, not a gate); fonts, arrows and widths on a phone: NOT RUN (staging, operator) | NOT RUN |

## 10. Operator closeout (2026-11-02 ~12:50Z; staging only — no prod deploy overnight, human's rule)

- Review: round 1 → escalate (CT-IMPL-NAV-DEFAULT, CT-IMPL-EDITORIAL-TARGETS, R-CT-1..5); round 2 → approved; decision
  review all-converged (2/2); both decisions = A, ratified by the operator under the human's overnight delegation
  (`.agent-manager/slices/CAT-THEME-1/human-ratification.md`; reversible — the heading-font nav default B is a one-class
  question for the human). Operator oracle defect recorded (R-CT-5: `git grep` without `--untracked`); the packet's "a
  list the layout reads" mechanism claim withdrawn.
- Operator gate run (`glam/theme-gates.log`, bare exit codes): build, typecheck, shared 282, plugins 204, renderer 398,
  serving 102/102, admin 238, backend 1242 (+1 skipped), MCP 13, `git diff --check` — all exit 0; infra/spec/dependency
  blocks empty; allocation `(none)`; whitespace none; the width literal at `renderer/src/lib/widths.ts:13` (exit 0).
- `cdk diff -c stage=staging`: code-only (41 Lambda assets, two bucket deployments, admin runtime config; the three
  pre-existing `Description` encoding lines); no resource added or removed, no IAM.
- Staging (build `0uY20H-6ZKQdDbyKt0vJS` → `0fZip-BiHNyp45jzN82uG`): the 51 CM1 URLs text- and status-identical (0
  differences). On `glam-staging` (`glam/theme-staging-out/`): `PUT /settings` with `theme.headingWeight: 950` → 400
  `theme.headingWeight: Too big: expected number to be <=900`, nothing written; then the glam design list stored (Noto
  Sans heading/body with weights [300,500,600], Martel Sans nav, headingWeight 300, #A42945 / #232323 / #686262 /
  #E4DFDF / #F5F3F3, radius 0, shape editorial, landscape cards + category line; header `max-w-[1920px]`, pages
  `max-w-[1600px]`, footer `max-w-[1440px]`). Server HTML: `--font-nav: 'Martel Sans'`; the fonts link
  `Noto+Sans:wght@300;400;500;600;700&family=Martel+Sans:wght@300;400;500;600;700`; `--muted-foreground: #686262`,
  `--border: #E4DFDF`; `h1…h6 { font-weight: 300 }`; `--section-gap`, `--tw-shadow: 0 0 #0000`, `--tw-drop-shadow:
  initial`; 2 arrow markers; the 3 px primary header border; the footer on `bg-muted`; the spec table `grid-cols-2`;
  shop cards `h-[245px]` ×18 with no `aspect-square`; the home page carries 1600 (pages), 1920 (header), 1440 (footer).
  Headless Chromium (Playwright 1.57, `glam/theme-browser.mjs`; screenshots `theme-staging-out/{shop,product}-{1920,390}.png`):
  at 1920 px header 1920 / footer 1440 wide, at 390 px all three 390 (collapse as today); the arrow-marked nav link
  "Contact ↗" computed in "Martel Sans"; headings at weight 300; `--muted-foreground` #686262, `--border` #E4DFDF; every
  box-shadow is Tailwind's transparent zero except Google's reCAPTCHA badge (third-party); card images 1.54:1 at 1920 px
  (245 px fixed height; 0.65:1 at 390 px — the design's fixed height on a narrow column, the human judges).
- Findings for the human (morning): F-CT-1 (uncompiled admin widths; a stored 1920 becomes capped on deploy — list
  live tenants' widths first; follow-up `WIDTH-OPTIONS-1`), F-CT-2 (Tailwind scans test `.body` captures into the
  production stylesheet; follow-up `TAILWIND-SOURCES-1`), CT-IMPL-NAV-DEFAULT B (heading-font default = every live nav
  changes font). NEW, outside this slice: **F-GLAM-ENTITY** — the glamCRM CSVs (both `enriched/` and `catalog/`) carry
  the literal text `&#215;` where the source had `×` (e.g. `CHAIRMAT ECOPRO 1.6 TRANSPARENT 90&#215;118`); amodx stores
  and renders the cell faithfully, so the facet labels and option values show `&#215;`. Owner: the glamCRM pipeline
  (fix at the source); the amodx question is whether the importer should decode HTML entities in text cells (a
  product decision, not taken here). The staging reCAPTCHA badge shows "Invalid domain for site key" (staging domain
  not registered; known since cat-interest-1).
