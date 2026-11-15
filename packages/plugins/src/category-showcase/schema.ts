import { z } from 'zod';

export const CategoryShowcaseSchema = z.object({
    categoryId: z.string().default(""),
    categoryName: z.string().default(""),
    categorySlug: z.string().default(""),
    limit: z.number().min(1).max(12).default(4),
    columns: z.enum(["2", "3", "4"]).default("4"),
    showPrice: z.boolean().default(true),
    ctaText: z.string().default("View All Products"),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
    // SHOP-LOOK-1D (docs/slices/shop-look-1.md § 4.2, § 7): optional, no default — absent draws today's HTML (§ 4).
    eyebrow: z.string().optional(),                    // small label above the category name; blank = absent
    badgeTags: z.array(z.string()).max(10).optional(), // the tags that act as badges, in precedence order (§ 7.4)
    showCategoryLabel: z.boolean().optional(),         // the name of the product's first category, above the title
    showDescription: z.boolean().optional(),           // the product's short text, two lines at most (§ 7.2)
    showRating: z.boolean().optional(),                // average and count of the approved reviews (§ 7.3)
});
