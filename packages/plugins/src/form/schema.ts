import { z } from 'zod';

/**
 * SHOP-LOOK-1E (record docs/slices/shop-look-1e.md) — the `form` block: one custom form of the tenant (admin Forms),
 * chosen by its slug, optionally with a label, a headline and a text above it, optionally inside a bordered card. A new
 * block with no stored instances, so its attributes carry ordinary defaults (design docs/slices/shop-look-1.md § 4).
 * The backend does not validate block attributes (`blocks: z.array(z.any())`): the form's fields are never stored in
 * the block — the renderer's server pass reads the form by `formSlug` on each render (`prepareBlocks`, `_form`).
 */
export const FormBlockSchema = z.object({
    formSlug: z.string().default(""),
    eyebrow: z.string().default(""),
    headline: z.string().default(""),
    text: z.string().default(""),
    card: z.boolean().default(false),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
