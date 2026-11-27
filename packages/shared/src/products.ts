// Products: the product enums, the product parts, ProductSchema and the gallery rule deriveGallery.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";
import { FacetModesSchema, ImportLabelsSchema } from "./glam-import-profile.js";

// --- COMMERCE & PRODUCTS ---

export const ProductStatus = z.enum(["active", "archived", "draft"]);
export const Availability = z.enum(["in_stock", "out_of_stock", "preorder"]);
export const Condition = z.enum(["new", "refurbished", "used"]);

// Commerce Helper Schemas
export const VolumePricingTierSchema = z.object({
    minQuantity: z.number().int().min(1),
    price: z.string(), // price per unit at this tier
});
export type VolumePricingTier = z.infer<typeof VolumePricingTierSchema>;

export const PersonalizationOptionSchema = z.object({
    id: z.string(),
    label: z.string(),               // "Personalized text on cookie"
    type: z.enum(["text", "select"]),
    required: z.boolean().default(false),
    maxLength: z.number().optional(), // for text type
    options: z.array(z.string()).optional(), // for select type
    addedCost: z.string().default("0"),     // additional cost in product currency
});
export type PersonalizationOption = z.infer<typeof PersonalizationOptionSchema>;

export const ProductVariantSchema = z.object({
    id: z.string(),
    name: z.string(),                // "Weight" or "Size"
    options: z.array(z.object({
        value: z.string(),           // "250g", "500g"
        priceOverride: z.string().optional(),
        imageLink: z.string().optional(),
        availability: Availability.optional(),
        // CAT-IMPORT-GALLERY-1 (CIG-D1 = A): the option's other images (the glam import's column 13), after
        // `imageLink`. Optional: every stored product stays valid; the importer stores it only when non-empty.
        additionalImageLinks: z.array(z.string()).optional(),
    })),
});
export type ProductVariant = z.infer<typeof ProductVariantSchema>;

/**
 * CAT-IMPORT-GALLERY-1 (docs/slices/cat-import-gallery-1.md § 3 item 2) — the ONE product-gallery derivation of an
 * imported product, from its variant options: walk the options in order and, for each, its `imageLink` then its
 * `additionalImageLinks`; keep each address once (first occurrence). The first address is the product `imageLink`
 * (absent when there is none — the key is then not written, CM-D7); the rest, in order, are `additionalImageLinks`.
 * For options without `additionalImageLinks` this is the § 3.4 rule of CATALOG-MODE-1 unchanged. Pure.
 * Callers: backend `lib/catalog-product.ts` `withDerivedGallery` (every product write of an imported product: create,
 * update, the glam import), `import/glam/map.ts` (the import plan), `import/glam-images.ts` (the image copy rewrite).
 */
export function deriveGallery(
    options: readonly { readonly imageLink?: string; readonly additionalImageLinks?: readonly string[] }[],
): { imageLink?: string; additionalImageLinks: string[] } {
    const images: string[] = [];
    for (const option of options) {
        for (const url of [option.imageLink, ...(option.additionalImageLinks ?? [])]) {
            if (url !== undefined && !images.includes(url)) images.push(url);
        }
    }
    return images.length > 0 ? { imageLink: images[0], additionalImageLinks: images.slice(1) } : { additionalImageLinks: [] };
}

export const NutritionalValueSchema = z.object({
    label: z.string(),          // "Calories", "Fat", "Protein"
    value: z.string(),          // "250 kcal", "12g"
    dailyPercent: z.string().optional(),
});
export type NutritionalValue = z.infer<typeof NutritionalValueSchema>;

export const ProductSchema = z.object({
    id: z.string(),
    tenantId: z.string(),

    // Status
    status: ProductStatus.default("draft"),

    // Basic Data
    title: z.string().min(1),
    slug: z.string().default(""),              // URL-safe, auto-generated from title
    sku: z.string().optional(),               // Stock Keeping Unit (from WooCommerce/ERP)
    description: z.string().max(5000),         // Generic/short description
    longDescription: z.string().optional(),    // Detailed rich text (HTML from Tiptap)
    link: z.string().url().optional(),

    // Pricing
    // CATALOG-MODE-1 (CM-D1 b): optional in the schema; the product write boundary (backend
    // lib/catalog-product.ts) requires it on every non-catalog tenant and refuses it on a catalog tenant.
    price: z.string().optional(),
    currency: z.string().default("USD"),
    salePrice: z.string().optional(),
    volumePricing: z.array(VolumePricingTierSchema).default([]),

    // Inventory
    availability: Availability.default("in_stock"),
    inventoryQuantity: z.number().int().optional(),

    // Availability by Date
    availableFrom: z.string().optional(),      // ISO date
    availableUntil: z.string().optional(),     // ISO date

    // Categorization
    brand: z.string().optional(),
    category: z.string().optional(),           // kept for backward compat
    categoryIds: z.array(z.string()).default([]),  // multi-category support
    condition: Condition.default("new"),
    tags: z.array(z.string()).default([]),

    // Filterable Attributes (weight, flavor, etc.)
    attributes: z.array(z.object({
        key: z.string(),
        value: z.string(),
    })).default([]),

    // Personalization
    personalizations: z.array(PersonalizationOptionSchema).default([]),

    // Variants
    variants: z.array(ProductVariantSchema).default([]),

    // Structured Tabs
    ingredients: z.string().optional(),
    nutritionalValues: z.array(NutritionalValueSchema).default([]),

    // Media
    // CATALOG-MODE-1 (CM-D7 a): absence is the omitted key — never "" (refused by .url()) and never null in
    // storage. Required on non-catalog tenants by the write boundary; PUT /products/{id} reads
    // `imageLink: null` as "remove the stored image".
    imageLink: z.string().url().optional(),
    additionalImageLinks: z.array(z.string().url()).default([]),

    // Product Type
    productType: z.enum(["physical", "digital"]).default("physical"),

    // Digital Commerce (Paddle)
    paymentLinkId: z.string().optional(),
    resourceId: z.string().optional(),

    // SEO
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),

    // Sorting & Weight
    sortOrder: z.number().default(0),
    weight: z.number().optional(), // grams, for shipping calc

    // CATALOG-MODE-1: written only by the catalog importer (CAT-IMPORT-1), e.g. "glam:<producer>/<sheet>".
    // The authoring routes omit it from their parsed input, so they can never set, change or remove it.
    importSource: z.string().optional(),
    // CAT-IMPORT-PROFILE-1 (§ 3.2, § 3.4): importer-owned, omitted from the authoring input like `importSource`, so
    // an admin edit keeps them and cannot set them. `facetModes` = the modes the renderer applies to this product's
    // facet values; `importProfileRevision` = the revision of the producer's import profile this product was
    // written with (absent = written without a profile).
    facetModes: FacetModesSchema.optional(),
    importProfileRevision: z.number().int().positive().optional(),
    // CDL-1 (docs/slices/catalog-data-labels-1.md § 4.6): importer-owned like `importSource` — the four attribute keys
    // the glam import wrote the file columns under (the site labels or the file's labels, the owner's choice). Absent
    // = written before cdl-1 or by hand: read as `IMPORT_LABELS_WITHOUT_MARKER`.
    importLabels: ImportLabelsSchema.optional(),

    createdAt: z.string(),
    updatedAt: z.string(),
});

export type Product = z.infer<typeof ProductSchema>;
