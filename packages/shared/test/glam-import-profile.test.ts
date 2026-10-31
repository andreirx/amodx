import { describe, it, expect } from "vitest";
import { FacetModesSchema, GlamImportProfileSchema, ProductSchema } from "../src/index.js";

/**
 * CAT-IMPORT-PROFILE-1 (docs/slices/cat-import-profile-1.md § 3.2, § 3.3) — the profile crosses admin ↔ API ↔ MCP and
 * is stored as written. Pinned here: every object is STRICT (an importer never applies part of a profile), and the
 * two importer-owned product members.
 */

const DEFAULT = { version: 1, grouping: { kind: "as-is" }, collection: { kind: "column" }, specKeys: [], facetModes: { attributes: [] } };

describe("GlamImportProfileSchema", () => {
    it("accepts the default profile and every variant of the sums", () => {
        expect(GlamImportProfileSchema.parse(DEFAULT)).toEqual(DEFAULT);
        expect(GlamImportProfileSchema.safeParse({
            ...DEFAULT,
            grouping: { kind: "trailing-number", label: "removed-token" },
            collection: { kind: "spec", key: "Collection" },
            specKeys: [{ key: "Wood", action: "attribute", label: "Esență", split: "comma" }, { key: "Dimensions (mm)", action: "prose-only" }],
            facetModes: { variant: "never", attributes: [{ key: "colecție", mode: "always" }] },
        }).success).toBe(true);
    });

    it.each([
        ["unknown top-level key", { ...DEFAULT, extra: 1 }],
        ["version 2", { ...DEFAULT, version: 2 }],
        ["unknown grouping kind", { ...DEFAULT, grouping: { kind: "regex" } }],
        ["label on as-is grouping (a member valid only in another variant)", { ...DEFAULT, grouping: { kind: "as-is", label: "removed-token" } }],
        ["label on a prose-only rule", { ...DEFAULT, specKeys: [{ key: "W", action: "prose-only", label: "x" }] }],
        ["unknown facet mode", { ...DEFAULT, facetModes: { attributes: [{ key: "k", mode: "auto" }] } }],
        ["unknown member of facetModes", { ...DEFAULT, facetModes: { attributes: [], producer: "never" } }],
        ["empty spec key", { ...DEFAULT, specKeys: [{ key: "", action: "prose-only" }] }],
    ])("refuses (strict, never strips): %s", (_n, value) => {
        expect(GlamImportProfileSchema.safeParse(value).success).toBe(false);
    });

    it("CAT-IMAGE-GATE-1: publishWithoutImages is optional — a profile stored before it parses unchanged (absent = off); a non-boolean is refused", () => {
        // An old stored profile: no member, no default inserted (the parse never adds a key, so the stored text and the
        // parsed value stay equal — the importer reads absence as false).
        const old = GlamImportProfileSchema.parse(DEFAULT);
        expect(old).toEqual(DEFAULT);
        expect("publishWithoutImages" in old).toBe(false);
        expect(GlamImportProfileSchema.parse({ ...DEFAULT, publishWithoutImages: true })).toEqual({ ...DEFAULT, publishWithoutImages: true });
        expect(GlamImportProfileSchema.parse({ ...DEFAULT, publishWithoutImages: false })).toEqual({ ...DEFAULT, publishWithoutImages: false });
        expect(GlamImportProfileSchema.safeParse({ ...DEFAULT, publishWithoutImages: "yes" }).success).toBe(false);
        expect(GlamImportProfileSchema.safeParse({ ...DEFAULT, version: 2, publishWithoutImages: true }).success).toBe(false);
    });

    it("FacetModesSchema: attributes default to [] (absence of a key = automatic; no 'auto' value exists)", () => {
        expect(FacetModesSchema.parse({})).toEqual({ attributes: [] });
        expect(FacetModesSchema.safeParse({ attributes: [], variant: "always" }).success).toBe(false);
    });
});

describe("ProductSchema importer-owned members (CAT-IMPORT-PROFILE-1 § 3.2)", () => {
    const product = { id: "p", tenantId: "t", title: "T", description: "d", createdAt: "x", updatedAt: "x" };
    it("facetModes and importProfileRevision are optional; the revision is a positive integer", () => {
        expect(ProductSchema.safeParse(product).success).toBe(true);
        expect(ProductSchema.safeParse({ ...product, facetModes: { variant: "never" }, importProfileRevision: 2 }).success).toBe(true);
        expect(ProductSchema.safeParse({ ...product, importProfileRevision: 0 }).success).toBe(false);
        expect(ProductSchema.safeParse({ ...product, importProfileRevision: 1.5 }).success).toBe(false);
    });
});
