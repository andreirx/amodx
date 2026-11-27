// Product categories (CategorySchema).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";
import { ContentItemSchema } from "./content.js";

// --- CATEGORIES ---

export const CategorySchema = z.object({
    id: z.string(),
    tenantId: z.string(),

    name: z.string().min(1),
    slug: z.string().min(1),
    description: z.string().optional(),

    // Hierarchy
    parentId: z.string().nullable().default(null),
    sortOrder: z.number().default(0),

    // Display
    imageLink: z.string().optional(),

    // SEO
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),

    // CATEGORY-CONTENT-1: the category page's own content, drawn after the title block and before the product list.
    // The type and the rule of a content page's `blocks` (the same schema, `ContentItemSchema.shape.blocks`) WITHOUT
    // its `[]` default: zod 4 applies a default inside `.partial()` too, so a default here would make every
    // `PUT /categories/{id}` body without `blocks` write `blocks: []` over the stored content. Absent = no content.
    blocks: ContentItemSchema.shape.blocks.unwrap().optional(),

    // State
    status: z.enum(["active", "hidden"]).default("active"),
    productCount: z.number().default(0),

    createdAt: z.string(),
    updatedAt: z.string(),
});

export type Category = z.infer<typeof CategorySchema>;
