import { z } from 'zod';

export const CategoryShowcaseSchema = z.object({
    categoryId: z.string().default(""),
    categoryName: z.string().default(""),
    categorySlug: z.string().default(""),
    limit: z.number().min(1).max(12).default(4),
    columns: z.enum(["2", "3", "4"]).default("4"),
    showPrice: z.boolean().default(true),
    ctaText: z.string().default("View All Products"),
});
