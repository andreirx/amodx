// The glam import profile (CAT-IMPORT-PROFILE-1) and the import labels a product carries (CDL-1).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

// --- GLAM IMPORT PROFILE (CAT-IMPORT-PROFILE-1, docs/slices/cat-import-profile-1.md § 3.2) ---
// One per tenant and producer. It crosses the admin ↔ API ↔ MCP boundary and is stored as written. Every object is
// STRICT (§ 3.3 item 1): an unknown key, enum value or version fails the parse; a parse never strips, so an importer
// never applies only part of a stored profile.

/**
 * The filter modes the renderer applies to one product's facet values (§ 2.6). `key` = a STORED attribute key (a
 * label, or one of the four column keys). Absence of a key = automatic (the repeat rule); `variant` absent = automatic.
 */
export const FacetModesSchema = z.strictObject({
    variant: z.literal("never").optional(),
    attributes: z.array(z.strictObject({ key: z.string().min(1), mode: z.enum(["always", "never"]) })).default([]),
});
export type FacetModes = z.infer<typeof FacetModesSchema>;

/**
 * What one spec key of the file becomes (§ 2.4). `attribute`: every line with this key gives `{ key: label, value }`
 * (split on "," when `split` is "comma"). `prose-only`: reviewed, not an attribute; its lines stay in the prose. A key
 * the profile does not list is not extracted either (it is reported as "not reviewed").
 */
export const SpecKeyRuleSchema = z.discriminatedUnion("action", [
    z.strictObject({ key: z.string().min(1), action: z.literal("attribute"), label: z.string().min(1), split: z.enum(["none", "comma"]) }),
    z.strictObject({ key: z.string().min(1), action: z.literal("prose-only") }),
]);
export type SpecKeyRule = z.infer<typeof SpecKeyRuleSchema>;

export const GlamImportProfileSchema = z.strictObject({
    version: z.literal(1),
    /** What one product is (§ 2.1). `trailing-number`: a last all-digit name token is removed from the name. */
    grouping: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("as-is") }),
        z.strictObject({ kind: z.literal("trailing-number"), label: z.enum(["removed-token", "format-column"]) }),
    ]),
    /** Where the collection comes from (§ 2.3): column 0, or the value of one spec key (fallback: the sheet name). */
    collection: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("column") }),
        z.strictObject({ kind: z.literal("spec"), key: z.string().min(1) }),
    ]),
    specKeys: z.array(SpecKeyRuleSchema),
    facetModes: FacetModesSchema,
    /**
     * CAT-IMAGE-GATE-1 (docs/slices/cat-image-gate-1.md § 3 item 1): `true` = every product the import writes is
     * published at once (`status: "active"`), with or without an image. Absent or `false` = every product starts
     * hidden (`status: "draft"`) and the image copy publishes it when one of its images is copied. Optional, so a
     * profile stored before this member still parses; `version` stays 1. Absent and `false` mean the same.
     */
    publishWithoutImages: z.boolean().optional(),
});
export type GlamImportProfile = z.infer<typeof GlamImportProfileSchema>;

/**
 * CDL-1 (docs/slices/catalog-data-labels-1.md § 4.6) — the four attribute keys one glam import wrote the file columns
 * 0, 6, 7 and 8 under (the product member `importLabels`). Strict, four non-empty strings: a stored value of another
 * shape is malformed, and a reader treats a malformed value as absent (operator ruling, cdl-1 packet § 1).
 */
export const ImportLabelsSchema = z.strictObject({
    collection: z.string().min(1),
    unit: z.string().min(1),
    packaging: z.string().min(1),
    minimumOrder: z.string().min(1),
});
export type ImportLabels = z.infer<typeof ImportLabelsSchema>;

/**
 * CDL-1 § 4.6 — the labels of a product WITHOUT a valid `importLabels` member: the four Romanian words the glam importer
 * wrote before cdl-1 (it wrote no others). Fixed history, not a language default: an edit of the RO pack must not
 * change how an old product is read. Readers: the interest list's collection lookup (backend `interest/public.ts`) and
 * the import dry run's `otherLabels` (backend `import/glam-pricelist.ts`).
 */
export const IMPORT_LABELS_WITHOUT_MARKER: ImportLabels = {
    collection: "colecție",
    unit: "unitate",
    packaging: "împachetare",
    minimumOrder: "comandă minimă",
};
