# SHOP-LOOK-1A — header and footer of the reference look (implementation record)

Status: **BUILT** (2026-11-15, builder), uncommitted, awaiting review. Start: `main` at `2188b11`, tree clean. All
oracles of the packet's § 4 pass on the final tree (§ 7): serving contract 115 / 115 (113 existing rows unchanged + 2
new `sl1a-*` rows). Maturity: the four settings and the site key are **PROTOTYPE** until the operator's staging run
(Operator closeout, below).

## 1. The requirement

The ratified design `docs/slices/shop-look-1.md`, row `shop-look-1a` of § 9, with the rulings of § 17 (SHOPLOOK-CATBAR =
**C**: the owner picks categories by id, in a chosen order, up to 12; label and link are read from each category at render
time). The governing rule (§ 4): **absent = today's bytes**. Options A and B of the category bar are not built.

What a visitor sees with each field set:

- `header.tagline` — a small uppercase text after the site name (or after the logo, when the name is hidden), inside the
  logo link; hidden on a phone (below 640 px).
- `header.categoryBarIds` — a second header row of category links, in the stored order, inside the sticky header; one
  line that scrolls sideways on a phone. A hidden or deleted category is not shown. Its accessible name is the site text
  `navCategoryBarLabel` ("Categories" / "Categorii").
- `footer.brandText` — a text in the first footer column (line breaks kept).
- `footer.columns` — up to 4 named link columns after the brand text, then the footer's existing columns (company
  details, "Links", "Legal"). One column on a phone, two from 640 px, all in one row from 1024 px.

## 2. What changed (file:line on the final tree)

| File | Change | Serves |
|---|---|---|
| `packages/shared/src/index.ts:630`, `:634` | `HeaderConfigSchema` + `tagline` (`max(60)`), `categoryBarIds` (`array(min(1)).max(12)`), both `.optional()`, no default | § 4.1 |
| `packages/shared/src/index.ts:646-655` | `FooterConfigSchema` (strict) + `brandText` (`max(400)`), `columns` (`max(4)` strict objects: `heading` 1-40, `links` `max(12)` strict `{ label 1-60, href ≥ 1 }`) | § 4.1 |
| `packages/shared/src/index.ts:1117`; `language-packs/en.ts:354`, `ro.ts:345` | site key `navCategoryBarLabel`, LAST in the schema and the packs ("Categories" / "Categorii") | § 5 |
| `backend/src/tenant/settings.ts:144`, `:154`, `:161` | `HeaderColorsSchema` renamed `HeaderCheckedKeysSchema` (§ 4.1 last paragraph; local, one file, no persisted reference — `git grep` finds the old name only in two slice records); it picks `tagline` and `categoryBarIds` too. The footer keys are checked by the strict `FooterConfigSchema` as before | § 4.1 |
| `renderer/src/lib/dynamo.ts:339-363` | `getActiveCategoriesByIds(tenantId, ids)` | § 6.4 |
| `renderer/src/app/[siteId]/layout.tsx:98-103` | `FOOTER_LG_COLUMNS`: the literal `lg:grid-cols-1` … `-8` classes | § 6.2 |
| `renderer/src/app/[siteId]/layout.tsx:205-259` | `tagline`, `barIds`, `barLinks` (the read only when ids are stored), `brandText`, `footerColumns`; today's three footer columns as `companyColumn`, `linksColumn`, `legalColumn` (the same element values as before) | § 6.3 |
| `renderer/src/app/[siteId]/layout.tsx:374-375` | `<Navbar>` + `tagline`, `categoryBar` by conditional spread | § 6.3 rule 2 |
| `renderer/src/app/[siteId]/layout.tsx:394-427` | the footer's one grid slot: new grid when brand text or columns, else today's grid element | § 6.3 rule 1 |
| `renderer/src/components/Navbar.tsx:45-46`, `:91-102`, `:151-155`, `:251-264` | props `tagline`, `categoryBar`; the tagline `<span>`; the second row `<nav aria-label>` | § 3, § 6.2 |
| `admin/src/pages/Settings.tsx:174-188`, `:220-232` | `isStored`; `withFooterKey` and `withHeaderKey` take the new keys ("" or an empty list removes the key) | taxonomy "admin" |
| `admin/src/pages/Settings.tsx:251-347` | `CategoryOption`; `HeaderTaglineAndCategoryBarControls` (Tagline; Category Bar: pick, up, down, remove); `FooterBrandAndColumnsControls` (Footer Brand Text; Footer Columns) | packet § 1 item 4 |
| `admin/src/pages/Settings.tsx:459`, `:468`, `:496-504`, `:1018`, `:1022` | the categories state and `loadCategories` (GET /categories); both groups in the existing fragment slot of "Navbar & Layout" (first and last) | packet § 1 item 4 |
| `admin/src/pages/Labels.tsx:367` | "Category bar (screen readers)" input, beside `navToggleMenu` | § 5 |
| tests | `packages/shared/test/shop-look-1a.test.ts` (new), `packages/shared/test/locale-strings.test.ts` (key count + the tail key); `backend/test/unit/shop-look-1a-settings.test.ts` (new); `admin/src/pages/Settings.test.ts` (two more excluded groups, two more mutation controls, a new `describe`), `admin/src/pages/Labels.test.ts` (site key count); `renderer/test/unit/shop-look-1a-read.test.ts` (new), `renderer/test/unit/shop-look-1a-layout.test.ts` (new); `renderer/test/serving-contract/fixtures.mjs:812-851`, `:900` (`SL1A`), `contract.test.mjs:2974-3083` (rows `sl1a-*`); `renderer/test/serving-contract/locale-1/shop-look-1a/coverage.json` (new) | |
| docs | `packages/shared/ARCHITECTURE.md`, `backend/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, this file | |

No infra change, no `package.json` change, no new dependency, no backend route (the MCP `routes.json` is unchanged). MCP:
no tool describes header, footer or navigation settings (`grep -n "server.tool(" tools/mcp-server/src/index.ts` for
setting, theme, nav, footer, header or config: only the delivery and theme tools), so no MCP text changed.

## 3. Taxonomy → tests (all EXECUTED, pass)

| Field | Absent | Present, valid | Present, malformed |
|---|---|---|---|
| `header.tagline` | no element, no prop, no read; HTML and footer equal to the base tenant — unit `shop-look-1a-layout.test.ts` "[content\|commerce\|catalog] no new field …"; serving: every existing capture row unchanged (`cm1-identity-*`, `loc1-diff-cdl-2`, `loc1e-*`, `cq1-*`, `ct1-*`, `hc1-*`) | the trimmed text in a `<span>` after the title inside the logo link, the only HTML change — unit "[kind] present: the trimmed text …", "with the title hidden …"; serving `sl1a-header-footer` | 61 characters, a number, `null` → 400 `header.tagline: …` — backend `shop-look-1a-settings.test.ts` "a tagline over 60 …"; shared `shop-look-1a.test.ts` "tagline: up to 60 …"; whitespace only → drawn as absent — unit "[kind] blank and empty values …", serving `sl1a-blank-as-absent` |
| `header.categoryBarIds` | no second row, no read (`getActiveCategoriesByIds` not called) — unit "[kind] no new field …" | links in the stored order on the category path, `<nav aria-label>` inside the header `<nav>` — unit "[kind] present: one read …", "the tenant's own category path …"; read `shop-look-1a-read.test.ts` (0, 1, 12 ids; order; key and projection; one `GetCommand` per id); serving `sl1a-header-footer` (ids: active, hidden, `rugs`, missing → "SL1A Tiles", "Rugs") | 13 ids, an empty id, a non-text id, not an array → 400 naming `header.categoryBarIds[.n]` — backend "over 12 ids …"; shared "categoryBarIds: …"; a missing or hidden id → skipped — read "one missing id …", "a hidden category …", unit "a skipped id …"; every id skipped → no row, no prop — unit "a skipped id …", serving `sl1a-blank-as-absent` |
| `footer.brandText` | today's footer — unit "[kind] no new field …" | the text first in the new grid — unit "[kind] present: one grid element …", "brand text alone …"; serving `sl1a-header-footer` | 401 characters → 400 `footer.brandText: …` — backend "brandText over 400 …"; shared "brandText: …"; whitespace only → drawn as absent — unit "[kind] blank …", serving `sl1a-blank-as-absent` |
| `footer.columns` | today's footer — unit "[kind] no new field …" | the named columns after the brand text, then today's columns byte for byte, `lg:grid-cols-N` = columns drawn — unit "[kind] present …", "the lg column count …"; serving `sl1a-header-footer` | 5 columns, 13 links, an empty heading, an empty label or href, an unknown key in a column or a link, not an array → 400 naming the field — backend "a bad column …", "the footer stays strict …"; shared "columns refused: …"; an empty list → drawn as absent — unit "[kind] blank …", serving `sl1a-blank-as-absent` |
| old stored `header` / `footer` (no new key) | read unchanged: shared "an old stored header …", "… an old stored footer …"; PUT accepts and writes them as sent: backend "old stored headers unchanged …", "valid values … with the older footer keys"; rendered unchanged: unit "[kind] no new field (no header, an old header, an old footer) …" | — | — |
| admin: clear a field | the key is removed (not `""`, not `[]`): `Settings.test.ts` "tagline: set → … cleared or whitespace only → the key removed …", "category bar: … removing the last one removes the key", "footer brand text: … cleared …", "footer columns: … removing the last column removes the key …" | — | — |

Also tested: the new key in the Labels page and its scope (`Labels.test.ts`, the "one input per key" rows); the locale
coverage rule for `navCategoryBarLabel` (`renderer/test/unit/locale-coverage.test.ts` reads
`locale-1/shop-look-1a/coverage.json`); the compiled stylesheet holds every new class (row `sl1a-header-footer`).

## 4. Byte identity

**Absent → today's bytes, every site kind.** Proved by the rows that compare with captures taken before this slice,
unchanged and passing: `cm1-identity-commerce`, `cm1-identity-content`, `loc1-diff-cdl-2` (the en-US subjects, catalog
included), `loc1-text-*`, `loc1e-*`, `cq1-*`, `ct1-*`, `bpf1-*`, `hc1-*`, `cf1-*`, `cm1-catalog-*`. No capture or
expectation file changed (`git status -- renderer/test/serving-contract`: only `contract.test.mjs` and `fixtures.mjs`
modified, one new `coverage.json`). How: the Navbar gets the new data only by conditional spread; the footer's new grid
replaces today's grid element in its one slot, and today's three columns are the same element values in both branches.

**Set tenant vs twin.** Row `sl1a-header-footer`, on `/`, `/shop` and `/product/variant-rug`: in the HTML, the tagline
`<span>`, the bar `<nav>` and the footer grid are the only differences (the HTML with these three put back equals the
twin's, byte for byte); in the payload, the two props `tagline` and `categoryBar` and the footer grid element are the
only differences (compared as resolved trees, with a control that the unsubstituted payloads differ).

**Blank values.** Row `sl1a-blank-as-absent`: HTML byte-equal to the twin; payload equal as a resolved tree.

**Why the payload is compared resolved, not as sorted rows (OBSERVED, first serving run).** For a tenant that stores bar
ids, the layout awaits `getActiveCategoriesByIds`; that changes the order in which the RSC encoder gives row ids (`$L15` vs
`$L20`) though the content is equal. Tenants without ids do not await, so their bytes are unchanged (the capture rows
above). Finding F-SL1A-ROW-IDS (§ 8).

**Controls (EXECUTED, each restored).**

| Mutation | Result |
|---|---|
| layout passes `tagline={tagline}` unconditionally | unit: 6 tests fail; serving: 11 rows fail — `cm1-identity-commerce`, `cm1-identity-content`, `loc1-diff-cdl-2`, `loc1e-category-controls`, `loc1-flight-controls`, `cq1-quote-channels`, `cq1-bars-own`, `ct1-footer-width`, `loc1e-404-document`, `sl1a-*` |
| layout always takes the new footer grid | unit: 6 tests fail |
| backend header check without `tagline`, `categoryBarIds` (the base pick) | backend: the 2 refusal tests fail |

## 5. Read cost as built

`getActiveCategoriesByIds`: one `GetCommand` per stored id (≤ 12), on `PK = TENANT#<request tenant>`, `SK = CATEGORY#<id>`,
projection `id, #n, slug, description, imageLink, #s`, sent in parallel; no pagination; no request when no ids are
stored. Called once per uncached render of a tenant that stores ids; a cached page (ISR HIT) reads nothing. No scan, no
Query. A hidden (`status` not `active`, also a missing status) or missing category is skipped.

## 6. Abstractions (one line each)

- `getActiveCategoriesByIds` (dynamo.ts) — users: the header bar now, the `categoryGrid` block of `shop-look-1c` next; axis:
  none; rejected: `getAllCategories` (paginates over every category, no `description`) — the operator's line.
- `companyColumn`, `linksColumn`, `legalColumn` (layout.tsx, local constants) — users: the two grid branches (2); axis:
  none; rejected: writing the three columns twice (≈ 40 lines of duplicated JSX).
- `FOOTER_LG_COLUMNS` (layout.tsx) — a literal table, because Tailwind compiles only literal classes; rejected: a built
  class string (`lg:grid-cols-${n}`), which Tailwind cannot see.
- Navbar props `tagline`, `categoryBar` — the server-to-client DTO (plain strings); user: the layout (1); rejected: the
  label in the shared `strings` prop (every site's payload would change, § 5).
- `isStored` (Settings.tsx) — users: `withHeaderKey`, `withFooterKey` (2); rejected: two copies of the empty test.
- `HeaderTaglineAndCategoryBarControls`, `FooterBrandAndColumnsControls`, `CategoryOption` (Settings.tsx) — exported so
  the capture test removes exactly these groups (the HEADER-COLOURS-1 procedure); user: the page (1); rejected: placing
  the controls in the Site Identity and Footer Links cards (new siblings there would change React `useId` ids and the
  captured bytes of the rest of the page).
- Test-only: fixtures `SL1A`, `SL1A_HEADER`, `SL1A_FOOTER`; contract helpers `sl1aPage`, `sl1aResolved`, `between`.

Local decisions (not asked): the bar is left-aligned to the header width (§ 6.2 allows centred or left-aligned); the bar
links take the nav font when the theme sets one, and no editorial arrows; the brand text keeps line breaks
(`whitespace-pre-line`); a footer column with no links shows its heading; the admin removes a whitespace-only tagline or
brand text (the renderer draws it as absent anyway).

## 7. Gates (each run bare; exit code printed by `echo $?`; EXECUTED on the final tree)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run build` (root) | 0 | |
| 2 | `npm run typecheck` (root) | 0 | |
| 3 | `cd packages/shared && npm test` | 0 | 348 / 348 |
| 4 | `cd backend && npm run test:unit` | 0 | 1384 / 1384 (+1 skipped) |
| 5 | `cd admin && npm run test:unit` | 0 | 291 / 291 |
| 6 | `cd renderer && npm test` | 0 | 528 / 528 |
| 7 | `cd renderer && npm run test:serving` | 0 | 115 / 115; no capture or expectation file changed |
| 8 | `cd packages/plugins && npm test` | 0 | 204 / 204 |
| 9 | `cd tools/mcp-server && npm test` | 0 | 17 / 17 (no route change; `routes.json` unchanged) |
| 10 | `git diff --check` | 0 | new files: no trailing whitespace (`grep -c " $"` = 0 each) |
| 11 | `git status --porcelain -uall` | — | only paths of the packet's allocation list (§ 8, item 1 for one nested path) |

Oracle 12 — every reader of `config.header` / `config.footer` and every literal construction, search stated:
`git grep -n -E "\.(header|footer)([^a-zA-Z_]|$)" -- packages/shared/src packages/plugins/src backend/src admin/src
renderer/src tools/mcp-server/src infra/lib scripts` and `git grep -n -E "(header|footer)\s*:\s*\{|HeaderConfigSchema|
FooterConfigSchema|showLogo|contentPageMaxWidth"` over the same trees (tests excluded from the list below; the search
is textual, so a reader that renames the object, e.g. `const h = config.header`, is found at that line):

- Literal constructions: `packages/shared/src/index.ts:1146-1153` (the `header` default of `TenantConfigSchema`; holds
  no new key — absent stays absent); `renderer/src/lib/dynamo.ts:135` (`mapTenant`: `item.header || { showLogo, showTitle }`;
  `:150` `footer: item.footer || undefined`). Both copy stored values whole: the new keys pass with no whitelist line.
  No backend, MCP or script code builds a `header` or `footer` value (the searches above find none).
- Readers: `renderer/src/app/[siteId]/layout.tsx:203-217`, `:323`, `:335`, `:353-364`, `:393` (the new keys at
  `:209-217` only); `renderer/src/components/SitePage.tsx:355`, `:470`, `:491`, `:512`, `:643`, `:685-686`, `:1000`,
  `:1064`, `:1504`, `:1509`, `:1555`, `:1560`, `:1603`, `:1655`, `:1774` (widths and nav heights only; none reads a new
  key); `admin/src/pages/Settings.tsx:184`, `:195`, `:213-214`, `:226`, `:244-245`, `:263`, `:276`, `:306`, `:316`,
  `:668`, `:771`, `:789`, `:864-968`; `backend/src/tenant/settings.ts:159-161`.

## 8. Findings

1. **Allocation, one nested path.** `renderer/test/serving-contract/locale-1/shop-look-1a/coverage.json` (new). The
   locale coverage rule (`renderer/test/unit/locale-coverage.test.ts`) fails gate 6 for a site key that no slice
   allocates; this file allocates `navCategoryBarLabel` (precedent: `locale-1/cdl-1/coverage.json`). Read as inside the
   allocation `renderer/test/*`; listed here so the reviewer can decide.
2. **Existing tests whose pinned counts moved (ripple of the new key, not weakened):** `packages/shared/test/locale-strings.test.ts`
   (site keys 52 + 26 → 52 + 26 + 1, and the tail list), `admin/src/pages/Labels.test.ts` (site section 43 + 26 →
   43 + 26 + 1, and the key is in it).
3. **F-SL1A-ROW-IDS (new, accepted).** A tenant that stores bar ids gets a payload whose RSC row ids are numbered in a
   different order than the same page without the read; the content is equal (§ 4). No existing tenant stores ids. A
   later row that compares such a tenant's payload must use the resolved comparison.
4. **F-SL1A-NAME (name vs contract).** `getActiveCategoriesByIds` returns only categories whose `status` is `active`, in the
   order of the ids; the name does not say "active". The design and the operator named it; the contract is in its doc
   comment. A rename (e.g. `getActiveCategoriesByIds`) would touch `shop-look-1c` too: not applied, raised for decision.
5. **Mobile menu over the bar (INFERRED, from the classes).** The phone menu panel is `absolute` at `top-<navHeight>`, so
   when it opens it covers the category bar (it already covers the page under the header). Check on staging at 390 px.
6. **Admin save of an incomplete column.** "Add Column" and "Add Link" add empty fields; a save with an empty heading,
   label or URL is refused by PUT /settings (400 naming the field, shown at the top of the page). The admin does not
   block the save itself. Prototype behaviour.
7. **Deploy order (design § 11.2) holds:** backend before admin — the old strict footer check refuses `brandText` and
   `columns`.
8. Historical records keep the old name `HeaderColorsSchema` (`docs/slices/header-colours-1.md:71`, `:121`;
   `docs/slices/shop-look-1.md:239`): records of their time, not changed.

## 9. Design lines that moved

None. Every line the packet's reading list cites was printed with `sed -n` on `2188b11` and holds the cited text
(shared `index.ts:607`, `:636`, `:1009`, `:1157-1158`; `settings.ts:140`, `:155`, `:157`; `dynamo.ts:135`, `:148`,
`:150`, `:228`, `:329`; `layout.tsx:294`, `:308`, `:330`, `:348`, `:350`; `Navbar.tsx:90`, `:122`, `:206`;
`BlockEditor.tsx:92`; `Labels.tsx:366`, `:385`; `Settings.tsx:902`, `:1395`; `categories/create.ts:54`;
`contract.test.mjs:1151`, `:2811`; `revalidate.ts:211`, `:270`). `LOC1_SLICE` is still `cdl-2`.

## Operator closeout

(left empty for the operator: staging screenshots at desktop and 390 px; the twin tenant's `/` HTML equal before and
after the deploy; the warm-page check of design § 17.2 — on a warm page that shows the bar, change a category's slug and
delete a category, and record what the bar shows and what its link returns at about 10 seconds, about 15 minutes, and
after the tenant-wide clear.)

**Review.** One build, one review, verdict approved; the decision pass converged on both items. Builder
`claude-opus-5-5`; reviewer `claude-sonnet-5-5` (the fallback: the Codex reviewer was out on its usage limit; human
directive 2026-11-15). Same provider family for both roles; not cross-vendor independence.

**Operator rulings.** SL1A-NESTED-COVERAGE: accepted (the `cdl-1` precedent). SL1A-NAME: renamed after the review, a
mechanical edit by the operator: `getCategoriesByIds` → `getActiveCategoriesByIds` (the function returns active
categories only). The design `docs/slices/shop-look-1.md` keeps the old name in its text; `shop-look-1c` uses the new
one. Not changed: a failed category read fails the page render, as every other layout read does (a page without its
bar must not be stored as a good page); the backend accepts a repeated id (the admin picker prevents it).

**Operator gates (2026-11-15, on the tree after the rename).** Build, typecheck, shared, plugins, renderer, serving,
admin unit, backend unit, MCP, `git diff --check`: each exit 0. Protected paths, allocation, existing captures,
trailing whitespace: no line.

**Staging (deployed 2026-11-15; diff read first, the usual shape).** Tenant `cm1-commerce`, two probe categories.

| Check | Result |
|---|---|
| tagline over 60 characters; 13 bar ids; a footer column with an unknown key; 5 columns | each refused, 400, with the field named |
| tagline, bar ids (one of no category) and footer saved; the other header and footer keys | saved; kept |
| home page | tagline beside the title; bar = the two categories in the stored order, the unknown id skipped; footer with the brand text and three named columns |
| another tenant (`cm1-content`) | no tagline, no bar, no brand text |
| Chromium 1400 px and 390 px | no horizontal page scroll; below `sm` the tagline is hidden, the bar is a second row. Screenshots checked by the operator |

**Warm-page check (`shop-look-1.md` § 17.2).** The home page was requested without a cache-busting query (the copy a
visitor gets) and with one, at 10 s, 60 s, 5, 10, 15 and 17 minutes.

| Event | The bar on the warm page | The addresses |
|---|---|---|
| slug of one category changed | the new link at the 10 s sample and at every later one | old address 404, new address 200, from 10 s |
| one category deleted | the link gone at the 10 s sample and at every later one | its address 404 from 10 s |

On staging no stale bar link was seen. Limit of this evidence: the staging site is served at the CloudFront address
under `/_site/<tenant>/`, not at a tenant domain, so it does not prove the edge behaviour of a production domain. The
design's stated limit (a stale link for up to about 15 minutes, the nightly flush if a step fails) stays the
contract. After the run the settings were put back and the probe categories deleted.

Prod deploy: the human's.
