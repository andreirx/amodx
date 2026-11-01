# LOCALE-1C — block chrome through the tenant locale table (record)

Status: **BUILT 2026-11-01, revised in iterations 1 and 2** for the operator rulings after review 0 (§ 13) (builder;
uncommitted, for review); no open decision. Slice
row `locale-1c` of `docs/slices/locale-1.md` § 10, under the human rulings of § 16 (they win over §§ 3.4, 8, 10, 11) and
the operator decision **LOCALE1-BLOCK-TEXTS = A** (packet 2026-11-01): block chrome goes to the site part of the table;
author fields stay; an existing block field wins over the key; no block schema change, no editor change, no stored
per-block copies. Start: `main` at `0c0dbc8`, tree clean (EXECUTED). On top of `locale-1a` (`4e98f98`), `locale-1b`
(`959f288`), `cmrc-counties-1` (`92adbba`) and `locale-1d` (`0c0dbc8`). Maturity of the resolution module: **PROTOTYPE**
(since this slice every visitor text surface reads the table; promotion is the operator's call).

What the slice does, in one paragraph: the site part of the tenant locale table gets the 26 block-chrome keys of § 6.1
and the commerce part `showcaseEmpty` (§ 6.2). The server page resolves them once per request with the new shared
function `blockStrings` and gives them to `RenderBlocks` as one `strings` prop; `RenderBlocks` hands that object to
every block, and down to blocks nested in lists and quotes. The eleven block renderers with fixed texts (contact, lead
magnet, hero, image, video, video hero, carousel, category showcase, code block, reviews carousel, post grid) read their
texts from it; a text the author writes in the block (success message, image alt, video caption, hero headline) still
wins. The post grid's dates take the tenant's locale for a non-en-US tenant; the reviews carousel keeps a present
`locale` attribute raw and keeps `"ro-RO"` for an en-US tenant. Admin Labels gets a "Content Blocks" card. **en-US
tenants render the same visible text** on all 81 captured en-US URLs and in every client-only block state (jsdom, markup
equal to a `0c0dbc8` capture); their bytes differ only by the one category-2 prop on the 16 pages that render blocks.
A Romanian site's blocks turn Romanian (exact strings in § 4).

## 1. Changes, per item (file:line in the candidate tree)

| Item | File:line | What |
|---|---|---|
| 26 site keys | `packages/shared/src/index.ts:928-956` (end of `SiteStringsSchema`) | § 6.1 block rows, schema order = § 6.1 order |
| `showcaseEmpty` | `index.ts:803` (end of `CommerceStringsSchema`, after the 80 keys of 1d) | § 6.2 |
| EN / RO values | `packages/shared/src/language-packs/en.ts`, `ro.ts` (after `items` and after `errorTryAgain`; header comments) | EN = the literal each renderer showed at `0c0dbc8`; RO = § 6.1 / § 6.2 column (§ 5) |
| `blockStrings` | `packages/shared/src/locale-strings.ts:189-226` (`BLOCK_SITE_KEYS`, `BlockStrings`, `blockStrings`); re-exported `index.ts:14-15` | the `strings` DTO of every block (§ 6) |
| Shared tests | `packages/shared/test/locale-strings.test.ts` (allocation 78 site / 179 commerce keys; describe "LOCALE-1C: the block-chrome keys and blockStrings") | |
| Admin Labels | `admin/src/pages/Labels.tsx:431-470` card "Content Blocks" (26 inputs, Site section); `:81` `showcaseEmpty` in `PRODUCT_PAGE_KEYS`, input `:590`; Site section description | § 7.1; Reset as before |
| Admin test | `admin/src/pages/Labels.test.ts` (site 69, product 29; the 1c Reset case; iteration 1: visibility per tenant kind, the showcase section's save and Reset) | |
| Admin showcase section | `admin/src/pages/Labels.tsx` `SECTION_KEYS.showcase`, `visibleSections`, section "Product showcase block" | content-only tenants (§ 13, ruling 4) |
| Renderers | `packages/plugins/src/{contact,lead-magnet,hero,image,video,video-hero,carousel,category-showcase,code-block,reviews-carousel,post-grid}/*Render.tsx` | `strings: BlockStrings` required (type-only import); no English fallback (§ 13, rulings 1 and 5) |
| Registry type | `packages/plugins/src/types.ts` (`PluginDefinition.renderComponent` takes `strings: BlockStrings`; type-only import) | § 13, ruling 5; the only file the compiler needed (the 11 `src/*/index.ts` and the 9 renderers without texts compile unchanged) |
| Iframe names | `packages/shared/src/locale-strings.ts` `BLOCK_FALLBACK_KEYS` + one line in `blockStrings` | pattern F for `videoTitle`, `videoBackgroundTitle` (§ 13, ruling 2) |
| Plugin tests | `packages/plugins/test/{videoPlugin,videoHeroPlugin,reviewsCarousel}.test.ts` | pass an en-US tenant's `blockStrings` (§ 13, ruling 1; allocation extended) |
| Showcase probe | `renderer/test/serving-contract/cm1-showcase-dom.mjs` | passes `blockStrings` with the case's catalog mode (§ 13) |
| Renderer wiring | `renderer/src/components/RenderBlocks.tsx:23-26` (`RenderChildren` passes `strings`), `:72-75` (core list/quote blocks), `:93` (required prop), `:142` (to every block); `renderer/src/components/SitePage.tsx:627` (`resolved` kept), `:792-793` | packet rule 4 |
| Unit tests | `renderer/test/unit/locale-1c-blocks-client.test.ts` (jsdom, 15 states) + `locale-1c-blocks-client-before.json` (`0c0dbc8`); `locale-coverage.test.ts` (requires `1c`) | § 3 |
| Fixtures | `renderer/test/serving-contract/fixtures.mjs:293-315` (`blockChromeBlocks`, 11 blocks, one nested in a blockquote), `:543` (the `cm1-content` home) | D1 |
| Proof | `renderer/test/serving-contract/locale-1/1c/{before/,expected-diff.json,ro-expected.json,coverage.json}` | § 3 |
| Rows | `contract.test.mjs`: `loc1-*` read `1c/` (`LOC1_SLICE`); `loc1-diff-1c` (replaces `loc1-diff-1d`) with new bound mutations; titles `0c0dbc8` | § 3 |
| Strict baseline | `cm1-byte-identity/baseline/` re-captured (build `25M5RsxZn_R6mKAmoBrRG`); `cm1-byte-identity/README.md` history row | § 8.5 rule 4 |
| Docs | `packages/shared/ARCHITECTURE.md`, `packages/plugins/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, `renderer/test/serving-contract/README.md`, this file | |

Pre-edit call-site search (packet § 4, EXECUTED): `git grep -n '<RenderBlocks'` over all tracked files →
`renderer/src/components/SitePage.tsx:790` (the content branch) and `renderer/src/components/RenderBlocks.tsx:24` (the
`RenderChildren` recursion); `renderer/test/unit/locale-1a-server-render.test.ts:51` mocks it. All allocated. Consumers of
the block renderers (`git grep` for `RENDER_LOADERS` / `@amodx/plugins/render`): `RenderBlocks` only, plus the four suites
of `packages/plugins/test/` (not allocated; they render blocks without `strings`). Basis: deterministic text search; a
computed import would escape it (none seen). `backend/src/tenant/settings.ts` was not changed: its limits (200 entries,
500 units, 32 KB) hold for 69 stored site keys (OBSERVED in code).

## 2. Oracles (EXECUTED 2026-11-01, iteration 3, in the packet's order, on the final code)

| # | Command | Exit | Last lines |
|---|---|---|---|
| 1 | `npm --prefix "…/amodx" run build` | 0 | `> tsc` |
| 2 | `npm --prefix "…/amodx" run typecheck` | 0 | `> tsc --noEmit` |
| 3 | `npm --prefix "…/packages/shared" test` | 0 | `Tests 248 passed (248)` |
| 4 | `npm --prefix "…/packages/plugins" test` | 0 | `Tests 201 passed (201)` |
| 5 | `npm --prefix "…/renderer" test` | 0 | `Test Files 22 passed (22)` / `Tests 362 passed (362)` |
| 6 | `npm --prefix "…/renderer" run test:serving` | 0 | `# tests 91` / `# pass 91` / `# fail 0` |
| 7 | `npm --prefix "…/admin" run test:unit` | 0 | `Tests 180 passed (180)` |
| 8 | `npm --prefix "…/backend" run test:unit` | 0 | `Tests 1192 passed \| 1 skipped (1193)` |
| 9 | `npm --prefix "…/tools/mcp-server" test` | 0 | `# pass 13` / `# fail 0` |
| 10 | `git -C "…/amodx" diff --check` | 0 | (no output) |
| + | `git -C "…/amodx" diff --stat -- infra docs/slices/locale-1.md docs/slices/locale-1a.md docs/slices/locale-1b.md docs/slices/locale-1d.md docs/slices/cmrc-counties-1.md` | 0 | prints nothing |
| + | `git -C "…/amodx" diff --name-only \| grep -E "package(-lock)?\.json$"` | 1 | prints nothing (no dependency change) |
| + | `git -C "…/amodx" status --porcelain -uall` | 0 | only allocated paths (packet § 4) |
| + | untracked non-`.body` files: `grep -nE "[[:space:]]+$"` | 1 | no hit |
| + | `npm --prefix "…/renderer" run test:serving`, 6 consecutive runs after gate 6 | 0 × 6 | 91/91 each |

`…` = `/Users/apple/Documents/APLICATII BIJUTERIE`. Never run: `cd backend && npm test`.

Serving lines of this slice (gate 6): `(loc1-subjects) 8 subjects, 81 URLs …; RO copies 58 URLs`; `(loc1-text-content) 10
HTML URLs, 155 extracted items, all equal` (every other subject all equal); `(loc1-diff-1c)` every URL its listed
differences; `(loc1-ro-content) 14 URLs, 12 text changes … {"L-RO-1":12}`; `(loc1-ro-commerce) 25 URLs, 2 text changes …
{"L-RO-2":2}`; `(loc1-ro-catalog) 19 URLs, 1 text changes … {"L-RO-1":1}`; `cm1-identity-commerce` / `-content` 32 × `same`.

## 3. Proof (§ 8.5; packet hard rules 1-4)

- **Start-commit capture** (EXECUTED): `renderer/test/serving-contract/locale-1/1c/before/` — 139 responses (the 81 en-US
  URLs of `EN_US_REQUESTS` and the 58 URLs of the three RO copies), from `0c0dbc8` in the worktree `/tmp/LOCALE-1C-before`
  (removed), built with that commit's shared/effects/plugins, served with THIS tree's `fixtures.mjs` (`harness.mjs`,
  `no-dotenv.cjs`, `ddb-stub.mjs`, `cm1-byte-identity.mjs`, `locale-1/proof.mjs`, `locale-1/extract.mjs` byte-identical,
  `diff -q`). Build `Z_QfK6OXXmzVCY_LjS9Eh`; stub `unhandled` = `[]`; statuses 200 × 129, 307 × 8, 404 × 2.
  Procedure (EXECUTED; the throwaway scripts were deleted after use):

  ```bash
  git worktree add --detach /tmp/LOCALE-1C-before 0c0dbc8
  cp -cR node_modules /tmp/LOCALE-1C-before/node_modules      # and renderer, packages/plugins, packages/shared node_modules (APFS clones)
  (cd /tmp/LOCALE-1C-before && npm run build -w packages/shared && npm run build -w packages/effects && npm run build -w packages/plugins)
  cp <tree>/renderer/test/serving-contract/fixtures.mjs /tmp/LOCALE-1C-before/renderer/test/serving-contract/
  # script, run from /tmp/LOCALE-1C-before/renderer: harness.mjs startStubs → buildRenderer → startRenderer;
  # proof.mjs captureRequests over [...EN_US_REQUESTS, ...LOC1_REQUESTS]; cm1-byte-identity.mjs writeCaptures(<tree>/…/1c/before)
  # the block states, same worktree (the test file copied in; extract.mjs and vitest.config.ts identical, diff -q):
  LOCALE_1C_CAPTURE=<tree>/renderer/test/unit/locale-1c-blocks-client-before.json LOCALE_1C_COMMIT=0c0dbc8 npx vitest run test/unit/locale-1c-blocks-client.test.ts
  git worktree remove --force /tmp/LOCALE-1C-before
  ```
  The same capture mode run in THIS tree (scratch file) gave byte-identical states (EXECUTED, `cmp`).
- **en-US visible text**: rows `loc1-text-<subject>` — equal to `before/` on every HTML URL of every subject (zero ledger
  rows), dates included: the `iso-a` post grid keeps the runtime default; the content home's reviews carousel (no
  `locale` attribute) keeps `31 octombrie 2026` (F-LOCALE-REVIEWS-DATE, unchanged).
- **en-US bytes**: row `loc1-diff-1c`, `1c/expected-diff.json` — category 2 only, every URL listed, none excluded. By rule:
  every page that renders content blocks (`SitePage`'s content branch) lists ONE difference, `RenderBlocks` prop `strings`
  — value `blockStrings` (28 site keys, `showcaseEmpty`, `outOfStock`) on the non-catalog subjects, `blockStringsCatalog`
  (no `outOfStock`) on the catalog subjects: `fixture-tenant` `/`, `/published`, `/d4-page`; `wk` `/index.php`; `iso-a`
  `/`, `/about`, `/listed-post`; `iso-b` `/about`; `commerce` `/`, `/about`, `/stale-showcase`; `content` `/`, `/about`;
  `catalog` `/`, `/about`, `/stale-showcase` (16 URLs). Every other URL (65): `[]`. No category 1: each block text is one
  whole text node as before. Comparison = the `1b` one, unchanged (CM1-A1 plus the ruled resolved-tree payload
  comparison). Bound mutations in the row (all reported): each listed entry dropped; a ghost entry; one HTML byte; a block
  text changed inside the prop; a block label left in Romanian in the HTML; the non-catalog value (with the stock text)
  listed on the catalog home; the prop listed on a product page without blocks; one order-page text byte.
- **RO copies**: rows `loc1-ro-*` against each copy's own capture in `before/`; every item's `from` is the EN pack value,
  `to` the RO pack value (§ 4). The content home lists `codeCopy` TWICE: the second is the code block nested in a
  blockquote — the proof that `strings` reaches nested blocks (`RenderChildren`).
- **Client-only block states** (`renderer/test/unit/locale-1c-blocks-client.test.ts`, jsdom; the blocks through
  `@amodx/plugins/render`, i.e. what `RenderBlocks` loads): 15 states — contact form idle / sending, sent with the default
  detail and with the block's own `successMessage`, the four failures (error answer without text → `contactSendFailed`;
  with a server text → as sent; thrown without message → `errorTryAgain`; thrown with one → its message); the same for the
  lead magnet (`formSubmissionFailed`), its idle / unlocking / unlocked states; the server-rendered blocks (hero without
  image, image alt with and without the block's alt, video and video-hero titles with and without the author field, both
  carousel styles without images); code block Copy → Copied!; reviews Read more → Show less; the seven reviews `locale`
  attribute cases; post grid loading, `API 500`, thrown with and without message, empty (fetched and prefetched), dates in
  list and grid layout; category showcase without image and out of stock, empty, and on a catalog site (no overlay).
  Oracle 1 (en-US): the markup after every step equals `locale-1c-blocks-client-before.json` (from `0c0dbc8`); the post
  grid date of an en-US tenant and the `xx-YY` reviews case (both the runtime default) are tokenised on both sides and
  checked against the runtime default; a failed fetch still reads `API 500`; `strings` is required by the typed contract
  and omitting it is unsupported (no English fallback, no runtime validation): the YouTube video and code-block fixtures
  rendered without it throw a `TypeError` (iteration 2 wording, review R5; the drift check of the removed fallbacks is
  gone). Oracle 2 (RO): every visible
  change is a declared key (EN → RO) or the declared RO post date, and every declared key is shown. Dates (packet hard
  rule 1): en-US tenant — absent attribute `31 octombrie 2026`, `ro-RO` same, `en-US` `October 31, 2026`,
  `ro-RO-u-nu-arab` `٣١ octombrie ٢٠٢٦`, `ro_RO` and `""` the raw date string, `xx-YY` the runtime default; ro-RO tenant
  identical (absent = its locale `ro-RO`); de-DE tenant: absent → `31. Oktober 2026`, the present cases unchanged.
  § 5.2 pattern D, EN and RO: absent → language default, `""` → empty (never another text: an empty `contactSendFailed` /
  `formSubmissionFailed` / `errorTryAgain` shows no error line, an empty `postsLoadFailed` still shows the error box and
  never "No posts found."), `"X"` → X; a server text passes through. Direct readers checked (one per block, iteration 1
  closes review-0 R3): `contactName`, `codeCopy`, `imageAltFallback` (block alt wins), `outOfStock`, `showcaseEmpty`,
  `postsEmpty`, `heroNoImage`, `noImage` (carousel), `reviewsReadMore`; lead magnet through `formSubmissionFailed`.
  Pattern F (ruling 2): `videoTitle`, `videoBackgroundTitle` — absent → default, `""` → default (never an empty iframe
  name), `"X"` → X, the author's caption / headline wins; EN and RO.
  Mocked: `fetch`, the clipboard, element heights, and `swiper/react` (D6).
- **Bound mutations of the unit test** (EXECUTED, each file restored from a saved copy): the literal `"Copy"` left in the
  code block → 3 failures; the old error chain in the contact block (`err.message || errorTryAgain`) → 2; a reviews
  carousel without attribute on an en-US tenant following its locale (L-ALL-2) → 7; a drifted fallback text in the post
  grid → 2; restored → 56/56. Iteration 1 (EXECUTED, restored, then 44/44): the F line removed from `blockStrings` → 2
  failures in the block test and 1 in the shared test; the hero's `"No Image"` literal put back → 3.
- **Coverage** (§ 16.2 item 5): `1c/coverage.json` maps the 30 allocated keys (26 new site keys, `site.formSubmissionFailed`
  and `site.errorTryAgain` at their new block readers, `commerce.showcaseEmpty` new, `commerce.outOfStock` at its new
  reader) to the named jsdom states and, where server-rendered, to captured URLs; `locale-coverage.test.ts` checks it.
  No 1c key is a count key; no check is props-only.
- **Strict baseline advanced** (§ 8.5 rule 4, EXECUTED): after `loc1-diff-1c` passed (first serving run: 89/91, only
  `cm1-identity-commerce` / `-content`, on exactly the 5 commerce/content pages with blocks), `baseline/` was re-captured.
  Reasons: `1c/expected-diff.json`, and the fixture change (D1) — EXECUTED: the previous `baseline/` and `1c/before/` are
  CM1-A1-equal on all 32 commerce/content URLs except content `/`.

## 4. Ledger rows that occurred (exact strings)

- **en-US: none** (zero rows, § 3). Excluded by § 16.2 item 4: L-ALL-2 (the reviews carousel keeps `ro-RO` on en-US
  sites — finding F-LOCALE-REVIEWS-DATE, the human's decision); L-ALL-1 does not reach an en-US tenant (the post grid
  keeps the runtime default).
- **L-RO-1** (new keys; captured on `loc1-ro-content` `/` unless named): `Name` → `Nume`, `Message` → `Mesaj` (`Email` is
  the same), placeholder `name@example.com` → `nume@exemplu.ro`, alt `Image` → `Imagine`, title `Embedded video` → `Video
  încorporat`, title `Background video` → `Video de fundal`, `No Image` → `Fără imagine` (hero), `No image` → `Fără
  imagine` (carousel; and the showcase on `loc1-ro-catalog` `/`), `NO IMAGE` → `FĂRĂ IMAGINE`, `View` → `Vezi`, `Copy` →
  `Copiază` (twice). Client-only (jsdom): `Sending...` → `Se trimite...`, `Message Sent!` → `Mesaj trimis!`, `We'll get back
  to you shortly.` → `Îți răspundem în curând.`, `Failed to send message` → `Mesajul nu a putut fi trimis`, `Unlocking...` →
  `Se deblochează...`, `Unlocked!` → `Deblocat!`, `Your file is ready.` → `Fișierul tău este gata.`, `Download Now` →
  `Descarcă acum`, `Copied!` → `Copiat!`, `Read more` → `Citește mai mult`, `Show less` → `Arată mai puțin`, `No posts
  found.` → `Nu s-au găsit articole.`, `API 500` → `Eroare API 500`, `No products found in this category.` → `Nu s-au găsit
  produse în această categorie.`.
- **L-RO-2** (an existing key at a new place, a literal before): the showcase overlay `Out of Stock` → `Stoc epuizat`
  (`loc1-ro-commerce` `/` and `/stale-showcase`); client-only: the lead magnet's `Submission failed` → `Trimiterea a eșuat`,
  the contact and lead `Something went wrong. Please try again.` → `A apărut o eroare. Încearcă din nou.`.
- **L-RO-6 / L-ALL-1** (dates, RO tenant): the post grid date `31.10.2026` (was the browser default). The reviews carousel:
  no change for a ro-RO tenant.

## 5. Romanian text table — for the operator's approval before the prod deploy (§ 16.2 item 4)

The RO column is the "RO" column of § 6.1 / § 6.2 (no register amendment needed: no value uses "ca să" or "Ceva nu a
funcționat"). A changed value is edited in `packages/shared/src/language-packs/ro.ts` and in the two tests that pin it
(`packages/shared/test/locale-strings.test.ts` `SITE_1C`; the serving `1c/ro-expected.json` for the captured ones).

| # | Key | EN (today) | RO (proposed) | Where |
|---|---|---|---|---|
| 1 | `site.contactSendFailed` | Failed to send message | Mesajul nu a putut fi trimis | contact block, error answer without text |
| 2 | `site.contactSent` | Message Sent! | Mesaj trimis! | contact block, sent |
| 3 | `site.contactSentDetail` | We'll get back to you shortly. | Îți răspundem în curând. | contact block, sent (block field `successMessage` wins) |
| 4 | `site.contactName` | Name | Nume | contact block label |
| 5 | `site.contactEmail` | Email | Email | contact block label |
| 6 | `site.contactMessage` | Message | Mesaj | contact block label |
| 7 | `site.contactSending` | Sending... | Se trimite... | contact block button while sending |
| 8 | `site.leadUnlocked` | Unlocked! | Deblocat! | lead magnet, success |
| 9 | `site.leadFileReady` | Your file is ready. | Fișierul tău este gata. | lead magnet, success |
| 10 | `site.leadDownload` | Download Now | Descarcă acum | lead magnet, success |
| 11 | `site.leadEmail` | Email | Email | lead magnet label (screen readers) |
| 12 | `site.leadEmailPlaceholder` | name@example.com | nume@exemplu.ro | lead magnet input |
| 13 | `site.leadUnlocking` | Unlocking... | Se deblochează... | lead magnet button while sending |
| 14 | `site.heroNoImage` | No Image | Fără imagine | hero (split) without image |
| 15 | `site.imageAltFallback` | Image | Imagine | image alt when the block has none |
| 16 | `site.videoTitle` | Embedded video | Video încorporat | video iframe title without caption |
| 17 | `site.videoBackgroundTitle` | Background video | Video de fundal | video-hero iframe title without headline |
| 18 | `site.noImage` | No image | Fără imagine | carousel card, category showcase |
| 19 | `site.noImageCaps` | NO IMAGE | FĂRĂ IMAGINE | coverflow carousel |
| 20 | `site.carouselView` | View | Vezi | coverflow carousel |
| 21 | `site.codeCopy` | Copy | Copiază | code block |
| 22 | `site.codeCopied` | Copied! | Copiat! | code block |
| 23 | `site.reviewsReadMore` | Read more | Citește mai mult | reviews carousel |
| 24 | `site.reviewsShowLess` | Show less | Arată mai puțin | reviews carousel |
| 25 | `site.postsEmpty` | No posts found. | Nu s-au găsit articole. | post grid |
| 26 | `site.postsLoadFailed` | API {status} | Eroare API {status} | post grid, browser fetch failed |
| 27 | `commerce.showcaseEmpty` | No products found in this category. | Nu s-au găsit produse în această categorie. | category showcase |

Existing keys at new readers (values unchanged): `commerce.outOfStock` Out of Stock → Stoc epuizat; `site.formSubmissionFailed`
Submission failed → Trimiterea a eșuat; `site.errorTryAgain` → A apărut o eroare. Încearcă din nou.

## 6. Abstractions introduced (one line each)

- `BlockStrings` / `blockStrings` / `BLOCK_SITE_KEYS` (shared) — users: `SitePage` (builds it), the eleven renderers
  (`Pick` of the type), `RenderBlocks` (prop type), the tests; axis: block keys added per block (fixed variants,
  operations grow); rejected: passing the whole site part (78 keys into every page payload) or a key list per block in
  the renderer (eleven lists in a file that cannot see the plugins).
- `PostsLoadFailure` (sum type, `PostGridRender.tsx`) — users: the post grid's fetch and its error box; axis: none (two
  failure kinds, exhaustive `switch`); rejected: one `error` string tested by truthiness (an empty table text would hide
  the error box and show "No posts found.", the 1d R1 class).
- `failedWithoutText` (local flag, contact and lead blocks) — users: their error line; rejected: `err.error || <text>`
  then `message || errorTryAgain` (tests a translated text, the 1d R1 class).
- `BLOCK_FALLBACK_KEYS` (shared) — users: `blockStrings`, the shared test; axis: none (names the two pattern-F keys of
  ruling 2); rejected: two unnamed `||` lines (the exception set would be implicit).
- `visibleSections(settings)` (admin `Labels.tsx`) — users: the page's section gates, `Labels.test.ts`; a test seam for
  "visibility per tenant kind" (ruling 4) in a node-only test file; rejected: three inline conditions (untestable).
- The `EN_FALLBACK` objects of the first build were removed (ruling 1).
- Capture mode `LOCALE_1C_CAPTURE` — users: the one start-commit capture (and a reviewer who re-runs it); rejected:
  hand-written "today's markup" (the 1d precedent).

## 7. Deviations from the design, and local decisions (one line each)

- **D1** Fixture: the `cm1-content` home holds 11 blocks (`blockChromeBlocks`), so that § 10's visible output
  ("`loc1-ro-content` blocks in Romanian") is captured; no prefetch path (no stub change); the review date is midday UTC
  (time-zone-free capture, the 1d D7 lesson). This changes the strict baseline of content `/` (README row).
- **D2** The block jsdom test lives in `renderer/test/unit/` (allocated), not under `packages/plugins/src/**` (the packet's
  location): the plugins vitest config runs only `test/**` in a node environment, the package has no jsdom dependency
  (adding one is a dependency change), and a test file under `src/` would be compiled into `dist/` by `tsc`.
- **D3** The renderers import `BlockStrings` as a TYPE only (a runtime import changes the client chunk layout,
  F-LOCALE1C-CHUNK-SPLIT); no English fallback (ruling 1); the prop is required in the registry type (ruling 5).
- **D4** The post grid fills `{status}` with `split/join` (every occurrence, as `fillTemplate` does): a consequence of D3
  (no runtime import of `fillTemplate`);
  the 1d D13 precedent.
- **D5** `showcaseEmpty` (a commerce-part key) has its Labels input in "Product pages & search" (a section edits one
  stored home; the Site group holds site keys only), not in the Site group's new card.
- **D6** The jsdom test mocks `swiper/react` with pass-through containers: it is bound to the monorepo root's React copy
  (19.2.3), which the renderer's react-dom (19.2.0) cannot render in vitest ("null dispatcher", EXECUTED); the carousel's
  own cards are real, and the real swiper markup of both styles is in the serving capture of the content home.
- **D7** The contact and lead blocks choose their error text by the server's answer (`failedWithoutText`), the post grid
  by the failure kind (`PostsLoadFailure`): the 1d R1 rule (a branch never tests a translated text).
- **D8** `RenderBlocks` passes `strings` to core blocks too, and `RenderChildren` forwards it, so a plugin block inside a
  list item or a quote gets the same texts (the fixture's nested code block proves it).
- **D9** On a catalog site `blockStrings` omits `outOfStock`: rows `cm1-catalog-listings` / `cm1-catalog-showcase-stale`
  forbid "Out of Stock" anywhere in a catalog page's body (CATALOG-MODE-1 § 3.2.6), and the overlay never shows there.
- **D10** The § 10 row's "L-ALL-2 on a fixture page" and "seven attribute cases (L-ALL-2P)" are re-stated under § 16.2
  item 4: L-ALL-2 is not applied; the seven cases are checked for en-US, ro-RO and de-DE tenants (§ 3).

## 8. Findings

- **F-LOCALE-REVIEWS-DATE** (the human's decision, NOT decided here): a reviews carousel without a `locale` attribute
  shows Romanian dates (`31 octombrie 2026`) on English sites; kept by § 16.2 item 4. The block schema has no `locale`
  field, so every editor-made block is in this case. Changing it = one line in `ReviewsCarouselRender.tsx` (`"ro-RO"` →
  the tenant's locale) and an en-US ledger row.
- **F-LOCALE1C-IFRAME-TITLE-EMPTY** — CLOSED in iteration 1 by ruling LOCALE1C-IFRAME-NAMES = A (§ 13): both keys are
  pattern F in `blockStrings`; the source comments now state why the name is never empty.
- **F-LOCALE1C-SHOWCASE-LABELS** — CLOSED in iteration 1 by ruling R4 (§ 13): content-only tenants get the "Product
  showcase block" section; one input per key for every tenant kind (`Labels.test.ts`).
- **F-LOCALE1C-POSTGRID-TZ** (pre-existing, OBSERVED): the `iso-a` fixture post (`createdAt` midnight UTC) is rendered on the
  server with the runtime default, so the immutable captures since `1a` hold `2/1/2026` for the capturing machine's time
  zone; a run west of UTC renders `1/31/2026` and the `loc1-text-iso-a` row would fail there. Not changed (fixture data of
  earlier slices).
- **F-LOCALE1C-CHUNK-SPLIT** (EXECUTED): any runtime import of a `@amodx/shared` module in a block renderer makes the
  bundler split the shared package (with zod) into its own client chunk, loaded by every page — basis of D3 and § 9.

## 9. Decisions

**LOCALE1C-FALLBACK — resolved: A** (operator, § 13 ruling 1). The first build's interim (option B, one English fallback
object per renderer) is removed. The analysis that led to the decision stays in F-LOCALE1C-CHUNK-SPLIT and § 13.

**LOCALE1C-REGISTRY-TYPE — resolved: A** (operator, § 13 ruling 5). The problem, as it was raised in iteration 1: each
plugin's `src/<plugin>/index.ts` assigns its renderer to `PluginDefinition.renderComponent`, typed `React.FC<{ attrs: any;
tenantId?: string }>` in `src/types.ts`, so with `strings` required in a renderer `tsc` refused all eleven assignments
(TS2322, EXECUTED); iteration 1 therefore kept `strings?:` in the type with a runtime guard in each renderer. Iteration 2:
`renderComponent` takes a required `strings: BlockStrings` (type-only import); the eleven renderers declare it required
and the guards are gone. Of the twenty registry entries (`RENDER_LOADERS`), eleven renderers read `strings`; the nine
others (pricing, cta, features, testimonials, columns, table, html, faq, markdown) have no fixed texts and ignore the prop
(a component with fewer props satisfies the type). Files the compiler made me touch: none beyond `src/types.ts` and the
eleven renderers (`npm run typecheck`, every workspace, admin included, exit 0).

## 10. Repeat runs and cleanup

6 consecutive serving runs after gate 6 (EXECUTED in the first build and again in iterations 1, 2 and 3): each exit 0, `# pass 91` /
`# fail 0`. Removed after use (first build):
`/tmp/LOCALE-1C-before` (worktree), `/tmp/LOCALE-1C-cand`, `/tmp/LOCALE-1C-exp1`, `/tmp/LOCALE-1C-exp2`,
`/tmp/LOCALE-1C-scripts`; iteration 1: `/tmp/LOCALE-1C-mut`, `/tmp/LOCALE-1C-gates`; iterations 2 and 3: `/tmp/LOCALE-1C-gates`.

## 11. Operator's staging checklist (Layer 2) and the human's pre-deploy step

Deploy order (§ 4.5): admin → renderer (no backend change). Rollback: renderer first.

1. Admin to staging: Labels shows the "Content Blocks" card; placeholders are the English texts.
2. Renderer to staging. Layer 2 extraction (`locale-1/proof.mjs` `extractVisibleText`) of the 51 CM1 URLs against a capture
   taken before the deploy: **all text-identical** (no staging fixture has blocks with chrome on the server except the
   showcases; their texts are equal in English).
3. RO evidence needs a RO staging tenant (none exists): Layer 2 stays EN-only; RO is proven by `loc1-ro-*` and the jsdom
   states.
4. **Human / operator, before the prod renderer deploy:** approve or amend the table of § 5; decide, separately,
   F-LOCALE-REVIEWS-DATE.

## 12. Not done here

`docs/ROADMAP.md` and `CURRENT_SLICE.md` (not allocated; the operator updates them at closeout). No browser end-to-end
run (no allocated E2E target covers the blocks; the jsdom states are the client proof with mocked I/O). Money stays
`toFixed(2)` + currency code (§ 3.2 item 5, deferred). `locale-1e` (`<html lang>`) not started.

## 13. Operator rulings after review 0 (2026-11-01 ~14:30Z, under the human's delegation; dated, reversible) — iteration 1

| Ruling / finding | Class of defect | Rule now in the tree |
|---|---|---|
| 1. **LOCALE1C-FALLBACK = A** (review-0 R1) | a second copy of a text kept as a fallback for a caller that should not exist | a block renderer has ONE source of text, its `strings` prop, required by the typed contract (iteration 2, ruling 5); omitting it is unsupported and there is no English fallback (no runtime validation — review R5). The eleven `EN_FALLBACK` objects and their drift check are deleted. Every caller that renders a changed renderer alone passes an en-US tenant's `blockStrings` — found by `git grep` for `RENDER_LOADERS`, `@amodx/plugins/render` and the eleven renderer names over all tracked files: `packages/plugins/test/videoPlugin.test.ts`, `videoHeroPlugin.test.ts`, `reviewsCarousel.test.ts` (allocation extended; assertions unchanged — the same English titles and non-empty-name checks) and `renderer/test/serving-contract/cm1-showcase-dom.mjs` (allocated; it passes the case's catalog mode, so its positive controls still show "Out of Stock"). `packages/plugins/test/renderLoaders.test.ts` only loads modules (no change). Still no runtime import of a language pack (option C rejected). Iteration 2 (ruling 5): the prop is required in the TYPE too (`src/types.ts`), the guards are gone |
| 2. **LOCALE1C-IFRAME-NAMES = A** (review-0 R2) | a text that carries an accessibility guarantee rendered under the direct rule, so a stored `""` removes the guarantee | the named exceptions to § 5.2's direct-render rule among the block keys are `BLOCK_FALLBACK_KEYS` = `videoTitle`, `videoBackgroundTitle`: pattern F inside `blockStrings` (`strings.k || defaults.k`, as `signIn` / `accountLabel` in `locale-1d`); every registered pack's value is non-empty (shared test); the two source comments state this. Tested: empty override in EN and RO for both renderers |
| 3. **R3** (review-0 R3) | a block reader without a preservation case | one direct-reader case per block (absent / `""` / custom, EN and RO): Hero `heroNoImage`, Carousel `noImage`, Reviews carousel `reviewsReadMore` added; Video and Video hero under ruling 2 |
| 4. **R4** (review-0 R4) | a text a tenant renders but cannot edit | `visibleSections(settings)` decides the Labels sections per tenant kind; a content-only tenant gets "Product showcase block" (`showcaseEmpty`, `outOfStock`, stored in `commerceStrings`); for content-only, commerce, catalog and commerce + catalog tenants each key has at most one input (`Labels.test.ts`), save and Reset tested |

Iteration-1 evidence: § 2 (the ten gates re-run in order on the final code) and § 10 (6 consecutive serving runs). The
first gate-6 run of iteration 1 failed exactly row `cm1-catalog-showcase-dom` (the probe rendered the showcase without
`strings`; the showcase reads its texts, and iteration 1's interim guard threw); after the probe passed `blockStrings` the row passed. No byte of any capture changed:
`blockStrings` gives the same values to a tenant without overrides, so `1c/expected-diff.json`, `1c/ro-expected.json`
and `cm1-byte-identity/baseline/` are unchanged.

### Ruling 5 (2026-11-01 ~14:40Z, after the second review 0) — iteration 2

| Ruling | Class of defect | Rule now in the tree |
|---|---|---|
| 5. **LOCALE1C-REGISTRY-TYPE = A** | a contract enforced at run time that the type declares optional (type and contract disagree) | the registry type states the contract: `PluginDefinition.renderComponent` (`packages/plugins/src/types.ts`) takes a required `strings: BlockStrings` (type-only import, no runtime import); the eleven renderers declare it required; the interim guards are removed. The compiler now checks every registration (`npm run typecheck`, every workspace, exit 0); no other file needed a change. The jsdom case is now "the YouTube video and code-block fixtures rendered without `strings` throw a TypeError (no English fallback)" (review R5: the claim is narrowed to the two tested fixtures; omission is unsupported, not validated) |

Iteration-2 evidence: § 2 (the ten gates re-run in order) and § 10 (6 consecutive serving runs). No capture changed.

### Review R5 (revision iteration after ruling 5) — iteration 3

| Finding | Class of defect | Rule now in the tree |
|---|---|---|
| R5: three artifacts claimed that a block given no `strings` always throws; after the guards were removed, the reviewer rendered a direct-video URL, a captioned YouTube iframe and an image without `src` without `strings` (OBSERVED in the review) | a runtime guarantee claimed for what only the TYPE enforces | every statement about omitting `strings` says: required by the typed contract, omission unsupported, no English fallback, no runtime validation; a runtime outcome is claimed only for the fixtures a test runs. Applied in `packages/plugins/ARCHITECTURE.md`, § 3, the § 13 ruling-1 and ruling-5 rows, the iteration-1 evidence note, and the jsdom case, renamed "the YouTube video and code-block fixtures rendered without `strings` throw a TypeError (no English fallback)" (assertions unchanged; no file referenced the old title — `git grep`). No guard restored, no code changed |


## 14. Operator closeout (2026-11-01, under the human's delegation of 2026-10-31)

- Review: relay review 1 (Codex `gpt-6.1-sol`) approved; rulings LOCALE1C-FALLBACK = A, LOCALE1C-IFRAME-NAMES = A and
  LOCALE1C-REGISTRY-TYPE = A were the operator's (§ 13), each dated and reversible.
- Gates (OPERATOR-EXECUTED on the approved candidate, unchanged): the ten common gates exit 0; infra, spec and earlier
  records untouched; no dependency line; every changed path inside the extended allocation; no trailing whitespace in
  untracked non-capture files. Serving suite: 6 consecutive runs exit 0 (the gate run plus 5 more).
- Romanian table (§ 5): APPROVED unchanged. Every row reads naturally and keeps the informal register of the earlier
  tables.
- Staging (Layer 2): deployed from this tree (code-only diff: 41 Lambda code assets, 3 nested-stack template URLs,
  renderer and admin asset uploads; nothing added or removed). Build `cyVphmM7bSeGqE8HXDNEW` → `AcJAuGbLGFPJdMxx1n-qC`;
  51 of 51 CM1 URLs text-identical, status-identical.
- Left to the human: the prod deploy (admin → renderer) and finding F-LOCALE-REVIEWS-DATE (§ 8).
