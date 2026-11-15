import { z } from 'zod';

/**
 * SHOP-LOOK-1C (docs/slices/shop-look-1.md § 4.2) — the `categoryGrid` block: tall tiles of owner-picked categories
 * (`categoryIds`, in tile order) and optional pill links under the grid (`chips`). A new block with no stored instances,
 * so its attributes carry ordinary defaults (§ 4). The backend does not validate block attributes (`blocks:
 * z.array(z.any())`), so the limits here hold for the editor and the MCP description, not for stored data: the server
 * pass reads at most 12 ids (renderer `prepareBlocks`).
 */
export const CategoryGridSchema = z.object({
    eyebrow: z.string().default(""),
    headline: z.string().default(""),
    categoryIds: z.array(z.string()).max(12).default([]),
    columns: z.enum(["2", "3", "4"]).default("4"),
    ctaText: z.string().default(""),
    chips: z.array(z.object({ label: z.string(), href: z.string() })).max(12).default([]),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
