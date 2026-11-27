# GALLERY-1 — a photo gallery block with a viewer

> Copied 2026-11-18 from `satulbanului/docs/amodx-slices/gallery-1.md` (draft written by the satulbanului session). This copy is the one to edit.
> Not ratified. Its `file:line` evidence comes from one read-only pass on `main` at `3388999`; a builder reads each again.

Status: **IMPLEMENTED 2026-11-27** — built, operator gates pending (ratified by the human 2026-11-27; operator rulings 1–9 in the builder packet; see § *Build record*). Track: new, `gallery`. Depends: none. Source plan: none (this file).
Maturity target: PROTOTYPE.

## Purpose / risk retired

A tenant cannot show a set of photos. There is no gallery, image-grid or lightbox block: the registry holds
`image` (one picture, plain `<img>`, `packages/plugins/src/image/`) and `carousel` (cards with title, text, link).
The reviews block opens a photo in a new tab and says so: "lightbox-free, phase 1"
(`ReviewsCarouselRender.tsx:121-145`). A guesthouse, a restaurant, a builder or a salon sells by photos.

## Scope

1. New plugin `packages/plugins/src/gallery/`: `schema.ts`, `index.ts`, `GalleryEditor.tsx`, `GalleryRender.tsx`.
   Follow `category-grid/` (the newest block) file by file.
2. Attributes: `items: {src, thumb?, alt, caption?, width?, height?}[]`, `columns: 2|3|4`, `blockWidth`.
   `thumb` absent → `src` is used for the tile. `width`/`height` present → the tile reserves its space (no
   layout shift).
3. Render (server-safe): a grid of `<a href={src}><img src={thumb ?? src} loading="lazy" alt></a>`. Without
   script every tile is a plain link to the large photo, so the page works and is indexable.
4. Viewer: one small client component, native `<dialog>`, previous / next, Escape, swipe, counter, caption;
   focus returns to the tile. No library. Colours from the theme variables only (Critical Rule 6). Texts
   (Close, Previous, Next) through the site part of the locale table (`strings`, rule of `locale-1c`), EN + RO.
5. Editor: pick several media-library images in one step, reorder, alt and caption per photo.
6. Register in `admin.ts` (REGISTRY), `render.ts` (RENDER_LOADERS), `tools/mcp-server/src/index.ts` (block shape);
   tests `packages/plugins/test/{offeredOn,renderLoaders}.test.ts`; a fixture page in
   `renderer/test/serving-contract/fixtures.mjs`; `docs/block-types.md`; `packages/plugins/ARCHITECTURE.md`.

## Non-scope

Image resizing or format conversion (parked: OPENNEXT1-IMAGE). `next/image`. Albums, folders, bulk upload.
Using the viewer in `reviewsCarousel` or `ProductImageGallery` (a follow-up when a second caller asks: the
viewer component is written so that it takes a plain list, but it is not moved to a shared place in this slice).

## Architectural boundaries

Plugin split entry (Critical Rule 1): the viewer is imported only by `GalleryRender.tsx`; nothing from
`admin/` or `renderer/`. No backend route, no schema in `packages/shared` beyond what a block needs, no `infra/`.
The block needs no server data, so `BlockEditor.tsx:103` and `SitePage.tsx:925` are not touched.

## Evidence taxonomy (bind one test to each row)

| `items` | Expected |
|---|---|
| absent / empty | the block renders nothing; no empty frame |
| valid, with `thumb` and sizes | grid; tile uses `thumb`; link points to `src`; `width`/`height` on the `<img>` |
| valid, without `thumb` | tile uses `src` |
| item with empty or non-string `src` | that item is dropped; the others render |
| `src` with a scheme other than `https:` or a root-relative path | dropped (same guard idea as `videoSource.ts`) |
| `alt` absent | `alt=""`, never the file name |

## Migration / deployment notes

Additive. No existing page holds the block, so no page of a live tenant changes: the serving-contract suite
must show zero changed captures apart from the new fixture. Deploy: plugins → admin → renderer builds, staging
first. Rollback: redeploy the previous build; pages that already hold the block then show the unknown-block
fallback, so remove the probe page before a rollback.

## Definition of Done

The repository gates of `badge-case-1.md` § 6 (build, typecheck, plugins, shared, renderer, serving, admin unit,
backend unit, mcp-server, `git diff --check`) exit 0. Staging: one page with 30 photos read in Chromium at
1280 px and 390 px — viewer opens, steps, closes with Escape, focus returns; with script disabled every tile
opens the photo.

## Exit criterion

A tenant owner builds a 30-photo gallery in the editor in one sitting and a visitor can page through it on a phone.

## References

`packages/plugins/src/category-grid/`, `docs/plugin-architecture.md`, `docs/block-types.md`,
`docs/slices/locale-1c.md` (block texts), `docs/slices/rev-4-renderer-gallery.md:29-32`.

## Build record (2026-11-27, builder `claude-opus-5-5`, base `main` at `1ee85f3`)

Status IMPLEMENTED: code complete; the operator gates (repository gates again, staging deploy, a 30-photo page in a real
browser at 1280 px and 390 px with and without script) are pending. The two decisions of iteration 0 are ruled; the
outcome is § *Revision 1 (after review-0)* below.

### Corrected references (ruling 1; read again on `1ee85f3`)

| Specification (`3388999`) | Today |
|---|---|
| `ReviewsCarouselRender.tsx:121-145` ("lightbox-free, phase 1") | same lines: the comment at 121-129, the photo links at 130-146 |
| `BlockEditor.tsx:103` (no server data → not touched) | 103-104 is the `categoryGrid` injection; this slice adds `storage.gallery.pickManyFn` (ruling 5) |
| `SitePage.tsx:925` (not touched) | `prepareBlocks` at 898; one `gallery` branch after the `newsletter` branch (984), texts only (ruling 2) |
| "follow `category-grid/` (the newest block)" | the newest blocks are `newsletter` (NEWSLETTER-1) and `category-grid`: files, columns enum and up/down helpers follow `category-grid`; the visitor texts follow `newsletter` (`_newsletter` → `_gallery`) |
| "`tools/mcp-server/src/index.ts` (block shape)" | the shape is `GALLERY_BLOCK_SHAPE` in `tools/mcp-server/src/tool-shapes.ts`, referenced from `BLOCK_SCHEMAS`: `index.ts` starts the server when imported, so only there can a test bind the shape to the plugin schema |
| Scope 1 "four files" | five: the viewer is its own client file `GalleryViewer.tsx` (ruling 3) |
| `docs/slices/rev-4-renderer-gallery.md:29-32` | 29-32 still say "lightbox-free (plain <a> to full image is fine for phase 1)" |

### What was built (file → purpose → requirement)

- `packages/shared/src/{index.ts, language-packs/{en,ro,de,fr}.ts, locale-strings.ts}` — six site keys `galleryViewer`,
  `galleryClose`, `galleryPrevious`, `galleryNext`, `galleryCounter` (`{n}`, `{total}`), `galleryPhoto` (`{n}`) and
  `galleryTexts(resolved)` (every text non-blank: a blank override gives the language default) — ruling 2.
- `packages/plugins/src/gallery/schema.ts` — `GalleryItemSchema`, `GalleryBlockSchema` — scope 2, ruling 6.
- `packages/plugins/src/gallery/GalleryRender.tsx` — the server-rendered grid, `galleryAddress`, the stored-item checks —
  scope 3, taxonomy rows 1-6, rulings 7, 8, 9.
- `packages/plugins/src/gallery/GalleryViewer.tsx` — the client viewer (native `<dialog>`) — scope 4, rulings 3, 8, 9.
- `packages/plugins/src/gallery/{GalleryEditor.tsx, index.ts}`, `src/admin.ts`, `src/render.ts` — editor and
  registration (REGISTRY, lazy `RENDER_LOADERS` entry) — scope 5-6, rulings 4, 5.
- `admin/src/components/MediaPicker.tsx`, `admin/src/components/editor/BlockEditor.tsx` — the picker's multi-select mode
  through the same injection — ruling 5. `admin/src/pages/Labels.tsx` — inputs for the six keys — ruling 2.
- `renderer/src/components/SitePage.tsx` — one `prepareBlocks` branch: `_gallery` = `galleryTexts(resolved)`; a stored
  block without an attrs object is skipped (a tool can write `{ type }` alone; without the check the page would throw).
- `tools/mcp-server/src/{tool-shapes.ts, index.ts}` — the block shape (accepts `thumb`, sizes), `add_block` type, one tip.
- Tests and fixture: below. Docs: `docs/block-types.md`, `docs/plugin-architecture.md`, `packages/plugins/ARCHITECTURE.md`,
  `packages/shared/ARCHITECTURE.md`, `renderer/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`, `docs/ROADMAP.md`,
  `CURRENT_SLICE.md`, `docs/TECH-DEBT.md`.

### Evidence (each row bound to a named test)

| Row / ruling | Test (file → case) |
|---|---|
| Taxonomy 1: items absent / empty → nothing | `packages/plugins/test/galleryBlock.test.ts` → "row 1 — items absent / empty / not a list" |
| Taxonomy 2: thumb + sizes | same → "row 2 — valid, with thumb and sizes"; serving `(gallery-1-page)` (built site) |
| Taxonomy 3: no thumb → src | same → "row 3 — valid, without thumb" |
| Taxonomy 4: empty / non-string src dropped | same → "row 4 — an item with an empty or non-string src" |
| Taxonomy 5: other scheme / not root-relative dropped | same → "row 5 — src with a scheme other than https:" and "the address rule"; serving `(gallery-1-page)` (`javascript:` item absent) |
| Taxonomy 6: alt absent → `alt=""` | same → "row 6 — alt absent" |
| Ruling 2: texts from the locale table, page language, template rule | `packages/shared/test/gallery-1.test.ts`; `renderer/test/unit/gallery-1-site-page.test.ts` (en, ro + override, `/de/…`); `galleryBlock.test.ts` → "Romanian page…", "fillLocaleTemplate … gives exactly the text of @amodx/shared fillTemplate" (the copy kept by the stop condition of ruling C, revision 1); `gallery-1-client.test.ts` → "ruling 2: a Romanian page"; coverage `renderer/test/serving-contract/locale-1/gallery-1/coverage.json` |
| Ruling 3: server render = first browser render | `renderer/test/unit/gallery-1-client.test.ts` → "ruling 3: server render without window/document…" (both React error channels empty, server nodes kept) |
| Ruling 4: no page without the block moves | `npm run test:serving` 176/176 with no capture changed; serving `(gallery-1-page)` (the gallery chunk is named by no page, only by the loader map); `packages/plugins/test/renderLoaders.test.ts` (24 loaders; no runtime import of `@amodx/shared`, barrel or deep path — revision 1) |
| Ruling 5: several photos in one pick, reorder | `admin/src/components/editor/galleryPicker.test.ts` (real BlockEditor + real MediaPicker; single pick of the image block unchanged; existing tests untouched) |
| Ruling 8: accessibility | `galleryBlock.test.ts` → accessible names, 44 px buttons, polite counter, no motion class; `gallery-1-client.test.ts` → focus returns, keys, swipe; browser proof below |
| Ruling 9 (as narrowed by GALLERY1-TILE-FILES = A, revision 1) | (a) `galleryBlock.test.ts` → "ruling 9 (a): the closed viewer holds no image"; (b) `gallery-1-client.test.ts` → "a tap on tile 3 opens the viewer there…" and "Next / Previous buttons…" (the photo shown + only the next one fetched ahead); (c) `galleryBlock.test.ts` → "ruling 9 (c): 30 tiles WITH thumb"; (d) `galleryBlock.test.ts` → "ruling 9 (d), NO page-load guarantee: 30 tiles WITHOUT thumb"; serving `(gallery-1-page)` asserts (a), (c), (d) on the built site; browser numbers below |

Mutation checks (EXECUTED, each restored): `https?:` in the address rule → 2 red; the built viewer reading `window` during
render → the hydration row red; the attrs check removed from `prepareBlocks` → 1 red; reversed pick order → 1 red;
`"gallery"` removed from the `add_block` enum → 1 red.

Browser proof (EXECUTED, throwaway script, not committed: the real build + `next start` against the serving stubs, headless
Chromium, fixture `GL1`, the image host unreachable so every photo request is observed and fails): at 390 × 844 and
1280 × 800 a click on tile 3 opens a `:modal` dialog named "Photo viewer", focus on Close, counter "3 of 30", photo
`large-3.jpg` and its caption; the three buttons 44 × 44, all inside the viewport (390: Close 338-382 / 8-52, Previous
8-52 / 408-452, Next 338-382 / 408-452); opening requested exactly `large-3.jpg` and `large-4.jpg`; Tab: Previous → Next →
the browser (no page element outside the dialog) → Close; ArrowRight / ArrowLeft step; a CDP touch swipe to the left steps
forward; Escape closes, focus on tile 3, no photo left in the dialog; computed transitions with reduced motion: none.
Without script a tap on tile 3 navigates to `large-3.jpg`. On load: every tile file within Chromium's lazy distance is
requested — 30 of 30 (headless default), 28 of 30 under 4G emulation (grid 342-2333 px, viewport 844 px); no large photo
of a tile that has a `thumb`. Console: only the next-auth session message, which the tenant's home page without the block
also shows (the stub has no auth).

### Abstractions (one line each)

- `galleryTexts` (shared) — users: renderer `prepareBlocks` (producer), the plugin (reader of the shape), the tests and the
  serving row (expected values); axis: none new — it is the boundary DTO of ruling 2, the same mechanism as `newsletterTexts`;
  rejected: building the six fields inline in `SitePage.tsx` (the shape would have no single definition).
- `MediaPicker` props union `onSelect | onSelectMany` and `BlockEditor` `PickRequest` sum — users: image + hero (one),
  gallery (many); axis: variants fixed (two pick modes), exhaustive by type; rejected: a boolean `multiple` with a
  callback whose type depends on it (a defect-shaped type).
- `GALLERY_BLOCK_SHAPE` in `tool-shapes.ts` — users: `BLOCK_SCHEMAS` and its test; axis: a test seam (`index.ts` cannot be
  imported by a test); rejected: the literal in `index.ts` with no test.
- `ViewerPhoto` + `GalleryViewer` taking a plain list — users: the gallery only; no axis claimed (the spec's Non-scope
  names the second caller as a follow-up); it is the component's props, not a shared module.

### Local decisions (decided, one line each)

- No `_gallery` (no server pass) → the block draws nothing (as `newsletter`, `categoryGrid`): no English text on a page in
  another language.
- Every tile is a 4:3 crop (`object-cover`): it keeps its space with or without sizes; sizes, when both are positive
  integers, go on the tile and the viewer `<img>`.
- The steps wrap around; the caption is shown in the viewer only; Close is first in the dialog (the browser focuses it).
- The editor reuses `withItemMoved` / `withoutItem` from `category-grid/CategoryGridEditor.tsx`.
- The Romanian, German and French texts are the builder's proposal (en: "Photo viewer", "Close", "Previous photo",
  "Next photo", "{n} of {total}", "Photo {n}"; ro: "Vizualizare fotografii", "Închide", "Fotografia anterioară",
  "Fotografia următoare", "{n} din {total}", "Fotografia {n}"; de: "Fotoansicht", "Schließen", "Vorheriges Foto",
  "Nächstes Foto", "{n} von {total}", "Foto {n}"; fr: "Visionneuse de photos", "Fermer", "Photo précédente",
  "Photo suivante", "{n} sur {total}", "Photo {n}"); a reader of each language approves them.

### Decisions of iteration 0 (as written then; ruled after review-0 — see § *Revision 1*)

**GALLERY1-TEMPLATE-IMPORT.** Problem: ruling 2 wants the counter and the tile name built with the locale table's template
rule (`fillTemplate` of `@amodx/shared`). Importing it in the gallery's render modules made 11 serving rows of pages
WITHOUT the block fail (ruling 4): the stylesheet link and one script of every page moved from the `[siteId]` segment to
the root segment of the RSC payload. Bisected in a worktree of `1ee85f3` (EXECUTED, 175 rows each run): baseline 175 pass;
shared changes only 175 pass; the gallery's class strings only 175 pass; the full gallery with the barrel import 11 fail;
the full gallery with a local copy of the rule 175 pass. No other module the render entry loads imports a runtime value
from the barrel (OBSERVED). Applied PROVISIONALLY: option B.

| Option | What | Reward | Risk |
|---|---|---|---|
| A — barrel import, re-capture the baselines | `import { fillTemplate } from "@amodx/shared"` | one definition, the literal ruling 2 | every page of every tenant changes in its payload (ruling 4 broken); every baseline re-captured and reviewed; production-wide change for an additive block |
| **B — test-bound copy (applied)** | `fillLocaleTemplate` in `GalleryViewer.tsx`; `galleryBlock.test.ts` requires the same output as `fillTemplate` (table incl. missing placeholders and `$&` values); `renderLoaders.test.ts` keeps every render module on `import type` (closes the class) | no page moves (176/176); no new module or edge; 3 lines | two definitions of the placeholder syntax; the binding test catches drift only for the cases it lists |
| C — one small shared module, deep import | move `PLACEHOLDER`, `fillTemplate`, `templatePlaceholders` to `packages/shared/src/template.ts` (re-exported as today); the plugin imports `@amodx/shared/dist/template.js` (the renderer already deep-imports `dist/languages.js`) | one definition; small chunk | a new module in shared and a deep `dist/` path in plugins; not yet proven against ruling 4 (needs one serving run); touches code the backend uses (`templatePlaceholders` in PUT /settings) |
| D — deep import of `dist/locale-strings.js` | no new module | one definition | pulls all four language packs into the gallery chunk; not yet proven against ruling 4 |

Recommended: B now; C if the operator wants one definition (one serving run decides whether it holds ruling 4).

**GALLERY1-TILE-FILES.** Problem: ruling 9 says a 30-photo gallery must not load 30 large photos on page load. The tiles
carry `loading="lazy"`, but the browser loads every lazy image within its distance of the viewport (Chromium on 4G
≈ 1,250 px): on a phone 28 of the 30 tiles load at once (measured above). A tile with `thumb` loads the small file; a tile
without `thumb` uses `src` (taxonomy row 3), which is the large photo. The editor never writes `thumb` (ruling 6) and the
media library holds no smaller file, so a gallery built in the editor loads about 28 large photos on a phone.

| Option | Reward | Risk |
|---|---|---|
| A — accept for this slice; tools (MCP, a future WordPress gallery import that has WordPress's sized files) write `thumb` | no new scope; the named client's 1,100 photos come by tool | editor-built galleries stay heavy on phones until B |
| B — a follow-up slice: a smaller file made at upload (resizing) and written as `thumb` | small tiles for every gallery | image resizing is this slice's Non-scope (OPENNEXT1-IMAGE parked); backend/infra work |
| C — tiles beyond the first screen get their photo only after script (observer) | fewer files on load | without script those tiles show no photo and the photos are not in the HTML (against scope 3 and the indexing goal) |
| D — a "show more" step after N tiles | fewer files on load | a visible behaviour change nobody asked for; the hidden photos need script |

Recommended: A for this slice, B as the follow-up slice.

### Findings and deferred debt (not fixed here)

- `newsletter` is in neither the MCP `BLOCK_SCHEMAS` nor the `add_block` type list (`tools/mcp-server/src/index.ts`), so a
  tool cannot add it with `add_block`.
- Stale counts: `docs/block-types.md` line 3 "18 custom plugins" and the MCP `get_block_schemas` text "18 plugins + 2
  builtins" (24 plugins now). Proposed: correct both; not applied (the MCP text is a tool response other agents read).
- `docs/plugin-architecture.md` and `packages/plugins/ARCHITECTURE.md` § *Adding a New Plugin* say `src/blocks/<name>/`;
  the code uses `src/<name>/`. Rename of the doc text proposed, not applied.
- Residuals of this slice: `docs/TECH-DEBT.md` § *gallery-1 residuals* (the provisional copy, a gallery nested in another
  block draws nothing, no scroll lock behind the viewer, the proposed translations, no sizes from the editor).

### Gates of iteration 0 (EXECUTED 2026-11-27 on the iteration-0 tree, in the packet's order; logs were in `/tmp/GALLERY-1-gates/`)

`npm run build` exit 0 · `npm run typecheck` exit 0 (8 workspaces) · `cd packages/shared && npm test` 32 files / 615 ·
`cd packages/plugins && npm test` 14 / 384 · `cd renderer && npm test` 66 / 956 · `npm run test:serving` 176 / 176 (no
capture changed) · `npm run test:serving-bundle` 61 / 61 (the gallery row is in the `next`-only block, as the newsletter
row) · `cd admin && npm run test:unit` 29 / 464 · `npm --prefix backend run test:unit` 88 files + 2 skipped (golden
capture files) / 2294 + 2 skipped · `cd tools/mcp-server && npm test` route coverage + 19 / 19 · `git diff --check` clean
(and the new files). `routes.json` not refreshed: no backend route changed.

### Revision 1 (after review-0, 2026-11-27)

Operator rulings: GALLERY1-TEMPLATE-IMPORT = C (with a stop condition), GALLERY1-TILE-FILES = A (ruling 9 narrowed, a
follow-up slice), and four corrections.

**Ruling C — applied, measured, stop condition met (EXECUTED).** Applied as ruled: `packages/shared/src/template.ts`
(the placeholder regex, `fillTemplate`, `templatePlaceholders`; no import), re-exported by `locale-strings.ts` (barrel
unchanged); both gallery modules imported `fillTemplate` from `@amodx/shared/dist/template.js`; the copy and its parity
test deleted. Result of `npm run test:serving`: 165/176 — the SAME 11 rows as the barrel import of iteration 0:
`cm1-identity-commerce`, `cm1-identity-content`, `loc1-diff-cdl-2`, `loc1e-category-controls`, `loc1-flight-controls`,
`cq1-quote-channels`, `cq1-bars-own`, `ct1-footer-width`, `loc1e-404-document`, `sched1g-preserve`,
`sched1g-root-sibling-controls`. Same mechanism, OBSERVED on content `/about`: the stylesheet link sits in the root segment
of the RSC payload instead of the `[siteId]` segment. Attribution run: `template.ts` and its re-export kept, the gallery
back on the copy → 176/176, so the runtime import is the cause, not the shared change. As ruled, I stopped: the
parity-tested copy `fillLocaleTemplate` is restored; no baseline was re-captured. `template.ts` then had no user besides
`locale-strings.ts`, so its three definitions went back into `locale-strings.ts` unchanged (diff of that file against
`1ee85f3`: the 33 added lines of `galleryTexts` only) and the stale `dist/template.*` outputs were deleted. The class rule
in `packages/plugins/test/renderLoaders.test.ts` now covers both measured forms: no module reachable from `RENDER_LOADERS`
imports a runtime value from `@amodx/shared`, by the barrel OR by any deep path; a positive control for each; no path is
permitted (a new one needs its own serving proof first). Why any runtime `@amodx/shared` module in a lazy render chunk
moves the shell is not understood (Turbopack chunk placement — INFERRED, not investigated further).

**Ruling A — ruling 9 narrowed for this slice.** (a) the closed viewer holds no image; (b) an open viewer loads the photo
shown and the next one; (c) a tile with `thumb` loads the small file; (d) a tile without `thumb` loads the large file with
native lazy loading — NO page-load guarantee is claimed for (d). Bound tests: the Evidence row "Ruling 9" above; the serving
row asserts (a), (c) and (d) on the built site (15 of GL1's 30 tiles are case (d)). Measured numbers (iteration 0 browser
proof): 30 of 30 tile files requested on load at the default connection, 28 of 30 under 4G emulation. Follow-up slice
`gallery-thumbs-1` (ROADMAP row added; `docs/TECH-DEBT.md` § *gallery-1 residuals*). No script-deferred tiles, no "show
more".

**Corrections.**
1. Loading claims separated (no viewer image while closed ≠ no large tile image) in `GalleryViewer.tsx`, `GalleryRender.tsx`
   (a new "Tile loading" paragraph), the serving row (comment, title, assertions, log line), `packages/plugins/ARCHITECTURE.md`
   (gallery section and test table), `docs/block-types.md`, `renderer/ARCHITECTURE.md`. No text states that the page loads
   no large photo.
2. `packages/plugins/ARCHITECTURE.md` test table: the loader count pinned by `renderLoaders.test.ts` is 24 (was "22").
3. Execution order, as it happened (iteration 0; `build-progress.md` records these steps): the packet's order was schema
   and render with tests → viewer → locale texts → editor and picker → registration → serving fixture → docs. I did: (1) the
   locale texts in `packages/shared` FIRST (the render needs the `GalleryTexts` type); (2) schema, render, viewer, editor and
   the `admin.ts` / `render.ts` registration in ONE step, tested together by `galleryBlock.test.ts`; (3) the viewer's
   browser test (renderer jsdom); (4) the server-pass branch in `SitePage.tsx` and its test; (5) the admin picker; (6) the
   MCP registration; (7) the serving fixture (where the template finding and its bisect came up); (8) the browser proof;
   (9) the docs. The progress notes were written per these steps, not per the packet's steps.
4. Full gate list re-run on the final tree, below.

**Gates of revision 1 (EXECUTED 2026-11-27, final tree, packet order).** `npm run build` exit 0 · `npm run typecheck` exit 0
(8 workspaces) · `cd packages/shared && npm test` exit 0, 32 files / 615 · `cd packages/plugins && npm test` exit 0,
14 / 386 · `cd renderer && npm test` exit 0, 66 / 956 · `npm run test:serving` exit 0, 176 / 176, no existing capture file
changed · `npm run test:serving-bundle` exit 0, 61 / 61 · `cd admin && npm run test:unit` exit 0, 29 / 464 ·
`npm --prefix backend run test:unit` exit 0, 88 files + 2 skipped / 2294 + 2 skipped · `cd tools/mcp-server && npm test`
exit 0, route coverage + 19 / 19 · `git diff --check` exit 0 (new files checked too).

## Closeout 2026-11-27 — ON STAGING

Builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`, two cycles, approved (review-1).

**Operator rulings after review-0.** GALLERY1-TEMPLATE-IMPORT = C with a stop condition; the condition was met (the
narrow import moved the same 11 serving rows), so the test-bound copy of the template rule stays (debt, `docs/TECH-DEBT.md`).
GALLERY1-TILE-FILES = A: ruling 9 is narrowed; a tile without `thumb` loads the large file with native lazy loading and
no page-load guarantee is claimed. Follow-up: `gallery-thumbs-1`.

Operator-executed on the final tree:

| Check | Result |
|---|---|
| Gate script (build, typecheck, shared, plugins, renderer, serving, serving-bundle, admin unit, backend unit, infra, MCP, `git diff --check`) | every exit 0; no manifest, lockfile, backend or infra path changed |
| Staging diff, read before the deploy | code updates only (87 functions, the renderer and admin bundles); no resource added or removed; no permission change |
| Staging deploy | `AmodxStack-staging` success line present |
| A 30-photo page on the test site, real browser, 1280 px and 390 px, with script | 30 tiles, each a link to its large photo; 3 and 2 columns, no sideways scroll; a click opens the viewer at "3 of 30" with the photo loaded inside the screen; the viewer has a name, focus on Close, three buttons of at least 44 px inside the screen; caption shown; arrow keys and Next step; Escape closes, focus returns to the tile, the closed viewer holds no image; no page error, no hydration error |
| The same page at 390 px without script | 30 tiles; a tap opens the large photo itself |
| Tile files requested on page load (no `thumb`) | 30 of 30 at both widths — the measured limit that `gallery-thumbs-1` removes |
| Cleanup | every table item the run added is deleted; the test site's key set equals the one before |

**Not verified on staging.** The editor's multi-select picker in a real browser (unit and integration tests only; the
deployed admin bundle holds the gallery editor). The Romanian, German and French viewer texts on a page of that language
(unit and serving tests only); the texts are a proposal and wait for a reader of each language.

Module maturity: `gallery` plugin PROTOTYPE.
