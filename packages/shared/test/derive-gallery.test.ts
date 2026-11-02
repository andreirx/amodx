// CAT-IMPORT-GALLERY-1 — units of `deriveGallery` (src/index.ts; docs/slices/cat-import-gallery-1.md § 3 item 2) and
// of the option schema's `additionalImageLinks` (CIG-D1 = A).
import { describe, expect, it } from "vitest";
import { ProductVariantSchema, deriveGallery } from "../src/index";

const img = (n: number) => `https://img.test/${n}.jpg`;

describe("deriveGallery — option images, then each option's extras, in option order, each address once", () => {
    it("no image at all → no imageLink key, empty additionalImageLinks", () => {
        expect(deriveGallery([])).toEqual({ additionalImageLinks: [] });
        const derived = deriveGallery([{}, { additionalImageLinks: [] }]);
        expect(derived).toEqual({ additionalImageLinks: [] });
        expect("imageLink" in derived).toBe(false);
    });

    it("options without extras: the CATALOG-MODE-1 § 3.4 rule (first option image, then the other distinct ones)", () => {
        expect(deriveGallery([{}, { imageLink: img(1) }, { imageLink: img(2) }, { imageLink: img(1) }]))
            .toEqual({ imageLink: img(1), additionalImageLinks: [img(2)] });
    });

    it("each option gives its imageLink then its additionalImageLinks; repeats keep the first position", () => {
        expect(deriveGallery([
            { imageLink: img(1), additionalImageLinks: [img(2), img(3)] },
            { imageLink: img(4), additionalImageLinks: [img(3), img(5)] },
            { imageLink: img(2) },
        ])).toEqual({ imageLink: img(1), additionalImageLinks: [img(2), img(3), img(4), img(5)] });
    });

    it("an option with extras and no imageLink contributes its extras in place", () => {
        expect(deriveGallery([{ additionalImageLinks: [img(7)] }, { imageLink: img(1) }]))
            .toEqual({ imageLink: img(7), additionalImageLinks: [img(1)] });
    });
});

describe("ProductVariantSchema — the option's additionalImageLinks", () => {
    const group = (option: Record<string, unknown>) => ({ id: "g", name: "Format", options: [option] });
    it("is optional (a stored option without it stays valid) and kept when present", () => {
        expect(ProductVariantSchema.parse(group({ value: "A", imageLink: img(1) })).options[0]).toEqual({ value: "A", imageLink: img(1) });
        expect(ProductVariantSchema.parse(group({ value: "A", additionalImageLinks: [img(2)] })).options[0])
            .toEqual({ value: "A", additionalImageLinks: [img(2)] });
    });
    it("is a list of strings", () => {
        expect(ProductVariantSchema.safeParse(group({ value: "A", additionalImageLinks: img(2) })).success).toBe(false);
        expect(ProductVariantSchema.safeParse(group({ value: "A", additionalImageLinks: [2] })).success).toBe(false);
    });
});
