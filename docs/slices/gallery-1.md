# GALLERY-1 — a photo gallery block with a viewer

> Copied 2026-11-18 from `satulbanului/docs/amodx-slices/gallery-1.md` (draft written by the satulbanului session). This copy is the one to edit.
> Not ratified. Its `file:line` evidence comes from one read-only pass on `main` at `3388999`; a builder reads each again.

Status: **PLANNED (draft, not ratified)**. Track: new, `gallery`. Depends: none. Source plan: none (this file).
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
