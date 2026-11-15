# CAT-VARIANT-GALLERY-1 — catalog product page: one picture picker (implementation record)

Status: IMPLEMENTED (2026-11-15, builder iteration 2, after review-0, the operator rulings CVG1-TEXT-REMOVAL = A and
CVG1-HEADER-CLEARANCE = fix, and review-1), uncommitted, awaiting review. Start: `main` at `27fa7ca`, tree clean. All
eight gates pass (§ 7): `npm run test:serving` exit 0, 107 / 107 rows. Rule 6 is also proven in Chromium for a header
whose height depends on its content (§ 3.1, `test/interest-e2e/cvg1-pinned.spec.mjs`, 2 / 2).
Track: catalog. Maturity: `ProductImageGallery` stays mature (a client component with a stable 3-prop contract; the
new props are optional). The serving proof instrument (`locale-1/extract.mjs` `textChanges`) gains one optional,
exact input (listed removals); with no list it is unchanged.

## 1. Human direction (2026-11-15, verbatim — the requirement)

> "on the catalog site a product with mmultiple colors shows photos below the preview image and versions to the
> right, and they are THE SAME, and worse they behave differently - clicking the ones below will change the preview
> but clicking those on the right will NOT. can we just keep ONE like the one on the right with the variants, and
> clicking will change the preview? and if there's too many variants we scroll them but pin the preview image on the
> left so it doesn't scroll."

## 2. Root cause (the packet's § 0, re-verified on `27fa7ca`)

- **Same pictures.** `deriveGallery` (`packages/shared/src/index.ts:1336-1346`) builds the product gallery of an
  imported product from its variant options' pictures. So the gallery thumbnails repeat the variant tiles by design.
- **Different behaviour.** `ProductImageGallery` held its own `activeIndex`; only its own thumbnails and arrows changed
  it. The variant tiles are `CatalogVariantPresenter`: server-rendered native radios named `catalog-option-<group id>`.
  Nothing connected the two.
- **The option pictures reach the page (rule 3 is implementable).** `getProductBySlug` queries `GSI_Slug`
  (`renderer/src/lib/dynamo.ts:245-259`), whose projection is `ALL` (`infra/lib/database.ts:51`), and the item goes
  unchanged to `ProductPageView` (`SitePage.tsx:366-405`). So `variants[].options[].additionalImageLinks` arrive.
  OBSERVED (code read; the serving fixture `oak-plank` has no option `additionalImageLinks`, so no served page proves it).

## 3. What changed

| File:line (candidate) | Change | Serves |
|---|---|---|
| `renderer/src/components/ProductImageGallery.tsx:6-21` | `GalleryOption` (file-local type), `NO_OPTIONS` (a stable empty default, so the effect does not re-run on every render), `SITE_HEADER_SELECTOR` (the layout's sticky header, which the gallery measures; § 3.1), `picturesOf` (an option's `imageLink` then its `additionalImageLinks`, each address once; `null` without `imageLink`) | rules 2-4, 6 |
| `ProductImageGallery.tsx:58-69` | With `pinnedTop`, after hydration: `measuredTop` = the header's `getBoundingClientRect().height` + 1rem, followed by a `ResizeObserver` (disconnected on unmount). No header found, or no `ResizeObserver` → nothing measured | rule 6 (review-1) |
| `ProductImageGallery.tsx:45-84` | Optional props `optionGroupName`, `options`, `pinnedTop`. `optionPicker` = a group name is given AND an option has an `imageLink`. In picker mode the shown pictures are the chosen option's pictures, or `[mainImage]` when nothing is chosen; the whole gallery (`additionalImages`) is not used. One `useEffect` reads the checked radio and follows the document `change` event (the `InterestToggle` pattern); it re-runs when the options change (another product), so nothing carries over. A `change` to an option without a picture is ignored | rules 1-5 |
| `ProductImageGallery.tsx:89` | With `pinnedTop`: class `space-y-3 md:sticky md:self-start` and `style={{ top: measuredTop ?? pinnedTop }}` (the server HTML holds `pinnedTop`); without it: class `space-y-3`, no `style` (as before). Below `md` the element is not positioned, so `top` has no effect | rule 6 |
| `renderer/src/components/SitePage.tsx:949-952` | `firstOptionGroup(product)`: the first group with options and its radio name `catalog-option-<id \|\| 0>` — the one rule the presenter's readers share | rules 1-2 |
| `SitePage.tsx:957-968` | `interestToggleProps` reads `firstOptionGroup` (same output: `find` = `filter()[0]`; `options` is non-empty there, so `\|\| []` was dead) | preservation |
| `SitePage.tsx:969-995` | `pinnedGalleryTop(config)` → `calc(<rem>rem + <px>px)`: the server value — the tallest header with a ONE-LINE Top Bar + 1rem (§ 3.1) | rule 6 (CVG1-HEADER-CLEARANCE) |
| `SitePage.tsx:997-1017` | `catalogGalleryProps(product, config)`: `pinnedTop` and, with a group, its name and each option's `value` / `imageLink` / `additionalImageLinks` (only the keys the option holds) | rules 1-6 |
| `SitePage.tsx:1113` | The gallery gets `{...(catalog ? catalogGalleryProps(product, config) : {})}` — a commerce page passes the same three props as before | rule 8 |
| `renderer/ARCHITECTURE.md` | One paragraph "Product page gallery on a catalog site" | docs |
| `renderer/test/unit/cat-variant-gallery-1-client.test.ts` | 12 rows, jsdom, the real component: 8 picker rows (a hand-built radio group) + 4 measurement rows (a header element with a set height, a recording `ResizeObserver`) | taxonomy, rule 6 |
| `renderer/test/unit/cat-variant-gallery-1-server-render.test.ts` | 6 rows, the real `SitePage` + real gallery (server render) | rules 1, 5, 6, 8 |
| `renderer/test/unit/cat-variant-gallery-1-header-clearance.test.ts` | 3 rows: 252 header configurations, header measured from the real layout + real Navbar; per configuration `SITE_HEADER_SELECTOR` finds exactly the sticky header (§ 3.1) | rule 6 |
| `renderer/test/interest-e2e/cvg1-pinned.spec.mjs` | 2 rows in Chromium (the hermetic harness of `facets.spec.mjs`): a three-line Top Bar; an announcement that wraps at 800px and not at 1600px (§ 3.1) | rule 6 (review-1) |
| `renderer/test/serving-contract/fixtures.mjs:709-740` | `CVG1`: two catalog copies with a `locale` (not en-US subjects, in no `before/`), each with `/product/many-colours` (48 picture options); read only by the spec above | rule 6 (review-1) |
| `renderer/test/unit/cat-variant-gallery-1-cases.ts`, `cat-variant-gallery-1-before.json` | The three commerce-shaped prop sets and their markup, captured ONCE from the `27fa7ca` gallery | rule 8 |
| `renderer/test/serving-contract/locale-1/extract.mjs:65-97` | `textChanges(from, to, removed = [])` — listed removals (§ 6.1) | CVG1-TEXT-REMOVAL = A |
| `renderer/test/serving-contract/locale-1/proof.mjs:203-228` | `textMismatches(..., removed = () => [])` passes a URL's listed removals to `textChanges` | CVG1-TEXT-REMOVAL = A |
| `renderer/test/serving-contract/locale-1/variant-gallery-1/` | `before/` (153 files, immutable, from `27fa7ca`), `expected-diff.json`, `ro-expected.json` (§ 6) | rule 8, gate 4 |
| `renderer/test/serving-contract/contract.test.mjs` | The current set moves to `variant-gallery-1`; rows changed and added (§ 6.3) | gate 4 |
| `renderer/test/serving-contract/README.md`, `renderer/test/unit/cat-theme-1.test.ts` (one comment) | The row table (every current-set description moved to `variant-gallery-1` / `27fa7ca`, every theme-1 mention marked historical or kept where the ct1 rows still read it; review-1 finding 2), the recorded run count, and a comment that named the old current-set row | docs (ripple) |

Decisions taken locally (one line each):

- **No new component.** The gallery takes optional props (packet § 2). `firstOptionGroup` has two current callers
  (`interestToggleProps`, `catalogGalleryProps`); it keeps the group-name rule, which must match the presenter, in one
  place. Rejected: a third copy of `catalog-option-${group.id || 0}`.
- **`pinnedTop` is a prop, not a wrapper `<div>` in `SitePage`.** A wrapper would hold an empty grid cell when the
  gallery renders nothing (no `imageLink`), which moves the info column to the right. With a prop, that case is as before.
- **No option chosen → the product picture alone (no arrows, no counter).** Arrows over the whole gallery would be a
  second picker that does not move the radio — the defect the human reported.
- **The option's picture list is de-duplicated** (`new Set`), as `deriveGallery` does for the product gallery.
- **Picker rule in the component, not at the call site.** `catalogGalleryProps` passes the group for every catalog
  product with options; the component decides picker mode. One rule; rule 5 is testable in jsdom. Cost: F-3.
- **Two-stage `top` (review-1).** The server value stays as the `top` before hydration and without JavaScript (a
  sticky element without `top` would not pin at all); the browser's measurement replaces it, because only the browser
  knows a content-dependent height. Rejected: counting `<br>` on the server (it cannot know wrapping), and constraining
  the Top Bar to one line (the Top Bar is shared with commerce, and supported content would be cut).
- **Removals ride on the category-3 entry that causes them** (`textRemoved` on the gallery-subtree entry), so a listed
  removal is tied to a listed HTML change. Rejected: a new top-level entry category.

### 3.1 Header clearance (ruling CVG1-HEADER-CLEARANCE)

The sticky site header (`app/[siteId]/layout.tsx:225`) has, at `md` and up (OBSERVED in code):

| Part | Present when | Height |
|---|---|---|
| top border `border-t-[3px]` | `theme.shape === "editorial"` (`layout.tsx:166`) | 3px |
| Top Bar (`TopBar.tsx:13`, `text-xs py-2`) | `topBar.show` | 2rem (line height 1rem + 2 × 0.5rem), one line |
| Commerce Bar | `commerceBar.enabled && commerceEnabled` | never on a catalog site: catalogMode excludes commerceEnabled (CM-D11, `packages/shared/src/index.ts:1109-1112`) |
| Navbar (`Navbar.tsx:111-113`) | always | 1px border + `h-<n>` = n × 0.25rem: `navHeight` (admin h-12 … h-36) before 20px of scroll, `navHeightScrolled` (admin h-10 … h-24) after (`Navbar.tsx:93`); absent → `h-16` / `h-12` |

The `top` has two stages.

1. **Server value** (the HTML; before hydration; without JavaScript), `pinnedGalleryTop`: Top Bar (ONE line) + the
   TALLER Navbar state + 1rem gap, in rem; plus the borders, in px. The taller state clears the header whatever the
   scroll position. The rem part scales with the visitor's root font size as the header does; a single px value would
   not. An unreadable height (not `h-<n>`) counts as `h-36`.
2. **Browser value** (after hydration), `ProductImageGallery`: the header's rendered height
   (`SITE_HEADER_SELECTOR` → `getBoundingClientRect().height`) + 1rem, followed by a `ResizeObserver`. This covers what
   no configuration value can know (review-1): a Top Bar with `<br>` (allowed by `sanitizeInlineHtml`) or text that
   wraps at the window's width, the visitor's font size, the Navbar's current state.

Server values (stage 1):

| Configuration | Header (tallest) | Gallery `top` |
|---|---|---|
| default (no Top Bar, not editorial, h-16 / h-12) | 4rem + 1px (65px) | `calc(5rem + 1px)` (81px) |
| Top Bar + editorial, default heights | 6rem + 4px (100px) | `calc(7rem + 4px)` (116px) |
| Top Bar + editorial + navHeight h-36 | 11rem + 4px (180px) | `calc(12rem + 4px)` (196px) |

Test (`cat-variant-gallery-1-header-clearance.test.ts`, EXECUTED): for each of 252 configurations (editorial × Top Bar ×
9 navHeight × 7 navHeightScrolled, "absent" included) it renders the REAL layout and measures its sticky header part by
part from the classes (a part it does not know fails the row), mounts the REAL Navbar in jsdom and scrolls it past 20px
for the scrolled height, reads the gallery's `top` from the real catalog product page, and requires top = the taller
header + exactly 1rem, borders equal. Controls: round 0's fixed `top-24` (6rem) is under the header in some
configurations (row 2); mutations of `pinnedGalleryTop` — the Top Bar term dropped, the unscrolled height ignored —
each fail row 1 (EXECUTED, restored). The same test binds stage 2's selector to the real layout: per configuration,
`SITE_HEADER_SELECTOR` finds exactly one element, the sticky wrapper (`sticky top-0 z-50`, with the editorial border
class when set) that holds the Navbar.

Stage 2 — jsdom (`cat-variant-gallery-1-client.test.ts`, EXECUTED): the top is the header height + 1rem (65px →
`calc(65px + 1rem)`); a taller header (161px: a three-line Top Bar and a 96px bar) and a shorter one (113px: the window
got wider) move it; the editorial header is found; no header or no `ResizeObserver` → the server value stays; without
`pinnedTop` nothing is measured and the root has no `style`; unmount disconnects the observer.

Stage 2 — Chromium (`test/interest-e2e/cvg1-pinned.spec.mjs`, run alone and in the full browser suite, EXECUTED). The
page is `/product/many-colours` (48 tiles); the row scrolls 40px past the gallery's pin point and waits until the gallery
is stuck and the layout is still. Geometry from `getBoundingClientRect` / `getComputedStyle`:

| Row | Window | Top Bar | Header bottom | Gallery top | Server value (stage 1) |
|---|---|---|---|---|---|
| `cvg1-pinned-breaks` (two `<br>`, `h-24` / `h-24`) | 800 × 600 | 64px (3 lines) | 161px | 177px (= header + 1rem) | 145px — 16px UNDER the header |
| `cvg1-pinned-wrap` (editorial, `h-12` / `h-12`, ≈ 200-character announcement) | 800 × 600 | 48px (2 lines) | 100px | 116px (= header + 1rem) | 100px — no gap |
| same page, window widened | 1600 × 900 | 32px (1 line) | 84px | 100px (= header + 1rem) | — |

The server-value column is the positive control: stage 1 alone would not satisfy rule 6 on these pages, so the rows
prove stage 2. Mutation (EXECUTED): with the `style` reading `pinnedTop` only (stage 2 ignored), both browser rows and
two jsdom rows fail; restored.

## 4. Taxonomy → tests (all EXECUTED, pass)

Client rows: `renderer/test/unit/cat-variant-gallery-1-client.test.ts`. Server rows: `…-server-render.test.ts`.

| Option picture data | Expected | Binding test |
|---|---|---|
| option has `imageLink` only | choose → preview is that picture; no thumbnails | `[option with imageLink only] …` |
| option has `imageLink` + `additionalImageLinks` | choose → preview is its `imageLink`; thumbnails = its pictures; a thumbnail click changes the preview | `[option with imageLink + additionalImageLinks] …` (also: arrows walk them; a repeated address shown once; another option restarts) |
| option has no `imageLink` | choose → preview unchanged | `[option without imageLink] …` |
| no option chosen | preview = product `imageLink`; no whole-gallery thumbnail row | `[no option chosen] …`; server `[cvg1-server] with picture options: …` |
| product without options | gallery as today | `[product without options] …`; `[options without any picture] …`; server `[cvg1-server] without options: …` |
| same instance re-rendered for another product | no picture carries over | `[same instance, another product] …` |
| (extra) a `change` in another radio group | ignored | `a change in another radio group does not change the preview` |
| (rule 6) pinned below the header | clears every header configuration, and a header whose height depends on its content | `[cvg1-header] every supported header configuration (252) …` + its control rows; client `[measured] …`, `[server value] …`, `[commerce] …`; browser `(cvg1-pinned-breaks)`, `(cvg1-pinned-wrap)` |
| commerce byte identity (rule 8) | gallery markup = before | `[cvg1-server] threePictures / onePicture / noPicture: byte-identical to the 27fa7ca capture`; `[cvg1-server] a commerce product page holds the gallery markup of before, unchanged and unpinned` |

Mutation (EXECUTED, round 0): with `optionPicker` forced to `false`, 5 of the 8 client rows fail.

## 5. Commerce byte identity

- Unit (EXECUTED): the gallery's server markup for the three-prop calls equals the `27fa7ca` capture byte for byte;
  a commerce product page contains it, with no `md:sticky` and no `style`.
- Serving (EXECUTED): `cm1-identity-commerce` and `cm1-identity-content` pass (CM1-A1 against `cm1-byte-identity/
  baseline/`; the baseline is NOT re-captured — no commerce or content byte changed).
- Serving (EXECUTED): `loc1-subjects` + `loc1-diff-variant-gallery-1` — of the 81 en-US subject URLs only the 13
  catalog product pages list entries; every commerce, content and other URL lists nothing and is byte-equal to `27fa7ca`.

## 6. Serving contract (ruling CVG1-TEXT-REMOVAL = A)

### 6.1 The instrument

`textChanges(from, to, removed = [])` (`locale-1/extract.mjs`): each listed removal `{ kind, text, position }` must be
EXACTLY the item at `position` of the before extraction (same kind, same text), else it throws "listed removal does not
match"; listed items are taken out of `from`, then the old strict comparison runs (lengths, kinds, changes). So:
an unlisted removal → length mismatch; a listed removal that did not happen → length mismatch; another text, kind or
position → mismatch. Every caller that passes no list (the locale-1c/1d unit tests, the other rows) is unchanged.
`textMismatches` takes the URL's listed removals as a fifth argument (default none).

### 6.2 This slice's set `locale-1/variant-gallery-1/` (EXECUTED)

- `before/`: worktree `/tmp/CAT-VARIANT-GALLERY-1-base` at `27fa7ca`, `node_modules` cloned, `packages/shared`, `effects`,
  `plugins` built there; the suite files (`harness.mjs`, `ddb-stub.mjs`, `cm1-byte-identity.mjs`, `no-dotenv.cjs`,
  `fixtures.mjs`) byte-identical in both trees (`cmp`); the base renderer source differs only in the two changed files.
  A throwaway script (`capture-base.mjs`, kept in the gitignored `.agent-manager/slices/CAT-VARIANT-GALLERY-1/`) built
  and served it with the suite's harness and captured `EN_US_REQUESTS` + `LOC1_REQUESTS` + `CQ1_REQUESTS` +
  `CT1_REQUESTS`: build `XnClRLIOtYVMusYBJY59j`, 151 captures (200: 141, 307: 8, 404: 2), stub `unhandled` = `[]`.
  Worktree removed.
- Consistency (EXECUTED): the 81 en-US URLs of `theme-1/before/` (`0865ac6`) against the new `before/` under
  `theme-1/expected-diff.json` (nothing listed) → 0 problems. The proof chain 0865ac6 → 27fa7ca is unbroken.
- `expected-diff.json` and `ro-expected.json`: derived by `gen.mjs` (kept with the scripts) and written only after every
  URL checked with 0 problems under the suite's own `checkExpected` and `textChanges`. Row id `CVG1-GALLERY`; element
  `[project]/renderer/src/components/ProductImageGallery.tsx#ProductImageGallery`.

| URL (en-US) | Category 2 (added props) | Category 3 (HTML) | Listed removals |
|---|---|---|---|
| catalog `/product/oak-plank` | `pinnedTop: "calc(5rem + 1px)"`; `optionGroupName: "catalog-option-format"`; `options` (3 options, `imageLink` each) | (a) gallery subtree 1931 → 305 bytes: the root gets `md:sticky md:self-start` + `style="top:calc(5rem + 1px)"`; the two arrows, the counter `1 / 3` and the 3-thumbnail row are gone. (b) `<head>` image preloads `oak-1, oak-2, oak-3` → `oak-1` (249 → 83 bytes) | `text "1 / 3"` at position 20 (on entry a) |
| catalog `/product/legacy-plank` | `pinnedTop` | gallery root class + `style` (256 → 309 bytes) | — |
| catalog `/product/ash-plank` | `pinnedTop` | none (no `imageLink`: no gallery) | — |
| cip1b-catalog `stejar-mixt`, `frasin-mixt`, `covor-arc`, `covor-shell` | `pinnedTop`; `optionGroupName`; `options` (no option has a picture → not a picker) | none | — |
| cip1b-catalog `nuc-fara-fisa`, `placa-nod`, `placa-nod-doi`, `lemn-x-unu`, `lemn-x-doi`, `lemn-x-trei` | `pinnedTop` | none | — |
| every other en-US URL (68) | — | — | — |

RO copies (`ro-expected.json`): `roCatalog /product/oak-plank` — one `removed` item, `text "1 / 3"` at 20; every other
RO URL nothing. `cq1RoNone` (read by `cq1-quote-channels` against `quote-1/before/`, `29a2282`): `/product/oak-plank` —
the same five entries; `/product/ash-plank` — `pinnedTop`.

### 6.3 Rows whose expectation this slice adds or changes

| Row | Change |
|---|---|
| all `loc1-*` | Read the current set `variant-gallery-1/` (`LOC1_SLICE`, `LOC1_START = "27fa7ca"`) |
| `loc1-subjects` | "every URL lists nothing" → a URL lists something only if it is a catalog-mode subject's product page; each such page lists `pinnedTop`; every entry is row CVG1-GALLERY, a gallery prop (`pinnedTop`, `optionGroupName`, `options`) or a category-3 HTML change |
| `loc1-text-<subject>`, `loc1-text-mutation` | Pass the URL's listed removals (`removedTexts`) |
| `loc1-diff-theme-1` → `loc1-diff-variant-gallery-1` | Renamed (it now proves against `27fa7ca`); oak-plank precondition "lists nothing" → "lists only CVG1-GALLERY, exact under its list"; new controls: the ghost with the real list, and each of the 5 listed entries left out is reported |
| `loc1-ro-content` / `-commerce` / `-catalog` | Accept `removed: true` items (row CVG1-GALLERY, kind + text + position only) |
| `cq1-quote-channels` | `roNone` pages: CQ1_LINK + the `cq1RoNone` entries |
| `ct1-editorial`, `ct1-no-shadows`, `ct1-footer-width` | Read `theme-1/before/` explicitly (`ct1BeforeSet`): they pin cat-theme-1's changes against ITS start `0865ac6`, as the cq1 rows read `quote-1/`. Their assertions are unchanged |
| NEW `cvg1-text-removal-unlisted` | The counter removal without its entry, and a second unlisted removal (the h1 title taken out), are reported |
| NEW `cvg1-text-removal-missing` | The real list against the unchanged `27fa7ca` page, and a listed removal on legacy-plank (no removal there), are reported |
| NEW `cvg1-text-removal-wrong-text` | The entry with text `1 / 4`, kind `@alt`, position 19 — each reported, each with the reason "listed removal does not match"; the real entry leaves no change |

Instrument mutation (EXECUTED): with the kind/text check removed from `textChanges`, the suite fails exactly
`cvg1-text-removal-wrong-text`; restored. `theme-1/` files: unchanged (`git status`: nothing under `theme-1/`).

## 7. Gates (exit codes printed by `echo $?`, never through a pipe; final fresh run, EXECUTED)

| # | Command | Expected | Actual |
|---|---|---|---|
| 1 | `npm run build` (repo root) | 0 | 0 |
| 2 | `npm run typecheck` (repo root) | 0 | 0 |
| 3 | `cd renderer && npm test` | 0 | 0 — 28 files, 419 tests |
| 4 | `cd renderer && npm run test:serving` | 0 | 0 — 107 / 107 |
| 5 | `cd packages/shared && npm test` | 0 | 0 — 14 files, 285 tests |
| 6 | `git diff --check` | 0 | 0 |
| 7 | `git status --porcelain -uall` | only allocated paths | `renderer/src/components/` (2), `renderer/test/` (unit, interest-e2e, serving-contract incl. `fixtures.mjs` and 153 files of `variant-gallery-1/before/`), `renderer/ARCHITECTURE.md`, `docs/slices/cat-variant-gallery-1.md` |
| 8 | `git diff --name-only` | no commerce component | none of `AddToCartButton.tsx`, `CartPageView.tsx`, `CheckoutPageView.tsx`, `AccountPageView.tsx`, `CommerceBar.tsx` |
| + | `cd tools/mcp-server && npm test` | 0 | 0 |
| + | `cd renderer && npx playwright test -c test/interest-e2e/playwright.config.mjs cvg1-pinned` | 0 | 0 — 2 / 2 |
| + | `cd renderer && npm run test:interest-e2e` (the whole browser suite) | — | 1 — `cvg1-pinned` 2 / 2 and `facets` 1 / 1 pass; 3 `interest.spec.mjs` rows fail (F-9: the SAME 3 rows fail on a clean `27fa7ca` worktree, same messages) |

## 8. Rulings applied

- **CVG1-TEXT-REMOVAL = A** (operator, 2026-11-15): own set, exact listed removals, `textChanges` strict without a
  list, theme-1 untouched, three negative-control rows — § 6.
- **CVG1-HEADER-CLEARANCE = fix**: offset derived on the server from the header configuration; per-configuration test
  — § 3.1. Review-1 (the Top Bar's height depends on its content): the browser measurement of stage 2, with jsdom and
  Chromium rows — § 3.1.

## 9. Findings

- **F-1 (rule 3, data).** No serving fixture has an option with `additionalImageLinks`; rule 3 is proven by the jsdom
  rows only. The data path is OBSERVED in code (§ 2), not on a served page.
- **F-2 (header before hydration).** Closed for JavaScript-enabled visitors by stage 2 (review-1; § 3.1, EXECUTED in
  Chromium). Residual: in the server HTML, before hydration and without JavaScript, the `top` assumes a one-line Top Bar,
  so a page whose Top Bar has two or more lines pins the gallery with less than 1rem, or under the header, until the
  scripts run. Pinning takes effect only after the visitor scrolls, normally after hydration. OBSERVED (the server
  values in § 3.1).
- **F-3 (payload).** Picture-less option groups (the `cip1b-catalog` products) pass `optionGroupName` and `options` to
  the gallery although it does not use them. A few hundred bytes per such page.
- **F-4 (pre-existing, not changed).** Outside picker mode the gallery's `activeIndex` is not reset when the same
  instance gets another product's pictures. Commerce behaviour; rule 8 forbids changing it here.
- **F-5 (pre-existing, not changed).** A product without `imageLink` renders no gallery, even if its options have
  pictures. Imported products always have one (`deriveGallery`).
- **F-6 (short viewports).** A pinned square preview (≈ 528 px at `max-w-6xl`) plus a thumbnail row can be taller than a
  laptop viewport below the header; its bottom is reachable only at the end of the info column. With tall headers
  (h-36 + Top Bar) the visible space is smaller still. INFERRED; not measured.
- **F-7 (refresh edge).** A router refresh of the same product re-reads the checked radio; if that option has no
  picture, the preview goes back to the product picture. INFERRED.
- **F-8 (build type-check).** `next build` type-checks `renderer/test/unit/*.ts`; a type error in a unit test fails the
  serving build. Found and fixed in this round (the header-clearance test). OBSERVED.
- **F-9 (pre-existing, not changed).** `npm run test:interest-e2e`: 3 rows of `interest.spec.mjs` expect Romanian texts
  ("Colecția Herringbone", "nu mai este în catalog") on the en-US catalog fixture, which shows English since LOCALE-1B.
  The same 3 rows fail on a clean `27fa7ca` worktree with the same messages (EXECUTED). `CURRENT_SLICE.md` § Known-open
  lists "stale playwright specs". The interest list is out of this slice's scope.

## 10. What a visitor sees (a product with eight colours, INFERRED from the markup and the jsdom rows)

- **Before.** Left: the preview (colour 1), arrows, a counter `1 / N` and a five-column grid of every colour picture
  (the same pictures as the tiles). Right: eight colour tiles. Clicking a grid thumbnail changes the preview; clicking a
  tile only marks the tile. Scrolling down the tiles scrolls the preview away.
- **After.** Left: the preview (the product picture, colour 1), no grid, no arrows, no counter. Right: the eight tiles.
  Clicking a tile shows that colour's picture; if that colour has more pictures, small thumbnails of that colour only
  appear under the preview, with arrows and a counter. From the `md` width up, the preview stays in view 1rem under the
  header (whatever its configured height, and also when the announcement bar takes several lines) while the tiles and
  the details scroll. Below `md` the page is stacked as
  before.

## 11. Not run / could not determine

- The pinned layout is checked in Chromium only for the two content-dependent headers of § 3.1; the 252 configurations
  of stage 1 are measured from the rendered classes (Tailwind v4 scale), not from a browser layout. No browser check of a
  tile click (jsdom rows only). No other browser engine.
- Staging check: operator (§ 12).

## 12. Operator closeout


Operator, 2026-11-15. Review-2 approved (reviewer `gpt-6.1-sol`, builder `claude-opus-5-5`, three cycles).

- **Gates (operator run on the approved tree, log kept outside the repository):** build 0, typecheck 0, shared 0,
  plugins 0, renderer 0, serving 0, admin unit 0, backend unit 0, MCP 0, `git diff --check` 0. No path outside
  `renderer/` and this record changed. No earlier slice's capture set changed.
- **Staging diff before the deploy (`infra/deploy.sh staging diff`):** renderer code only (three renderer functions
  and the renderer assets), plus the known lines (admin runtime config id, nested-stack descriptions). No IAM,
  parameter or new resource.
- **Staging deploy:** `infra/deploy.sh staging`, completed.
- **Staging browser check (Chromium, 1400 × 800, tenant `cm1-catalog`, product `alpod-organic-skirtings-k58c-orca`,
  36 options, all pictured):** the page answers 200; the pinned gallery is present; no whole-gallery thumbnail row;
  choosing the tile `#4` changes the preview to that option's picture; the thumbnail row shows only for an option with
  several pictures; after a scroll of 484 px the gallery's top edge is 16 px under the header's bottom edge
  (header bottom 49, gallery top 65). Gallery height 528, row height 1716.
- **Observation, not a defect:** on a product whose right column is shorter than the preview (8 options at this
  width), the preview is the tallest element of the row, so there is nothing to pin and it scrolls with the page.
- **Not checked on staging:** the tenant `glam-staging` has no product with more than two pictured options (all its
  products are drafts), so the check ran on `cm1-catalog`. A phone-width browser check was not run (the stacked layout
  is covered by the class rule `md:` and the unit rows only).
