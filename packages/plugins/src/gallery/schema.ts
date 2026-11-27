import { z } from 'zod';

/**
 * GALLERY-1 (docs/slices/gallery-1.md, scope item 2) — one photo of the `gallery` block. `src` = the large photo (the
 * tile's link and the viewer's photo); `thumb` = an optional smaller file for the tile, written by tools (the editor does
 * not ask for it; ruling 6), absent → the tile uses `src`; `alt` = the photo's description ("" = none; never the file
 * name); `caption` = optional text under the photo in the viewer; `width`/`height` = the photo's size in pixels, optional.
 */
export const GalleryItemSchema = z.object({
    src: z.string(),
    thumb: z.string().optional(),
    alt: z.string().default(""),
    caption: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
});

/**
 * GALLERY-1 — the `gallery` block: a grid of photo tiles; each tile links to its large photo, and with script the
 * viewer opens it. A new block with no stored instances, so its attributes carry ordinary defaults. The backend does not
 * validate block attributes (`blocks: z.array(z.any())`), so this schema holds for the editor and the MCP description,
 * not for stored data: the render component checks every stored item again (`GalleryRender.tsx`). The visitor texts of
 * the viewer are NOT attributes: they come from the tenant's locale table through the renderer's server pass
 * (`prepareBlocks`, `_gallery`).
 */
export const GalleryBlockSchema = z.object({
    items: z.array(GalleryItemSchema).default([]),
    columns: z.enum(["2", "3", "4"]).default("3"),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
