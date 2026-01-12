import { z } from 'zod';

export const PostGridSchema = z.object({
    headline: z.string().default("Latest Updates"),
    filterTag: z.string().default(""), // If empty, show all
    limit: z.number().default(6),
    showImages: z.boolean().default(true),
    // NEW: Layout option
    layout: z.enum(["grid", "list"]).default("list"),
    columns: z.enum(["2", "3"]).default("3")
});
