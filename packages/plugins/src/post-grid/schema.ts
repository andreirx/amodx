import { z } from 'zod';

export const PostGridSchema = z.object({
    headline: z.string().default("Latest Updates"),
    filterTag: z.string().default(""), // If empty, show all
    limit: z.number().default(6),
    showImages: z.boolean().default(true),
    // NEW: Layout option
    layout: z.enum(["grid", "list"]).default("list"),
    columns: z.enum(["2", "3"]).default("3"),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
    // SHOP-LOOK-1D (docs/slices/shop-look-1.md § 4.2): optional, no default — absent draws today's HTML (§ 4).
    eyebrow: z.string().optional(),          // small label above the headline; blank = absent
    asideText: z.string().optional(),        // the side panel: a text,
    asideQuote: z.string().optional(),       // a quote,
    asideButtonText: z.string().optional(),  // and a button (shown when its text is not blank)
    asideButtonLink: z.string().optional(),
});
