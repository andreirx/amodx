import { describe, it, expect } from "vitest";
import { buildProductPayload } from "./ProductEditor";

/**
 * CATALOG-MODE-1 (cat-mode-1, cycle 2, CM1-COVERAGE) — the product editor's save body (`buildProductPayload`, the
 * pure function `ProductEditor.handleSave` sends). CM-D7 image absence on every site; no monetary key on a catalog
 * site (spec docs/slices/catalog-mode-1.md § 3.2.2, rows `ProductEditor.tsx:39–56`, `:47,117`, `:413`).
 */

const FORM = {
    title: "Rug", description: "d", price: "", salePrice: "", currency: "USD", imageLink: "",
    availability: "in_stock", volumePricing: [], personalizations: [],
    variants: [{ id: "g", name: "Format", options: [
        { value: "120x20", priceOverride: "", imageLink: "https://img.test/1.jpg", availability: "in_stock" },
        { value: "140x20", priceOverride: "", imageLink: "", availability: "in_stock" },
    ] }],
};

const MONETARY = ["price", "salePrice"];

describe("buildProductPayload — CM-D7 image absence (every site)", () => {
    it("create with an empty image: the imageLink key is omitted (never \"\", never null)", () => {
        const p = buildProductPayload(FORM, { isNew: true, storedImageLink: "", catalog: false });
        expect(p).not.toHaveProperty("imageLink");
    });

    it("update that cleared a stored image: imageLink is null (the removal instruction)", () => {
        const p = buildProductPayload(FORM, { isNew: false, storedImageLink: "https://img.test/old.jpg", catalog: true });
        expect(p.imageLink).toBeNull();
    });

    it("update of a product that never had an image: the key is omitted", () => {
        const p = buildProductPayload(FORM, { isNew: false, storedImageLink: "", catalog: true });
        expect(p).not.toHaveProperty("imageLink");
    });

    it("a set image is sent as is", () => {
        const p = buildProductPayload({ ...FORM, imageLink: "https://img.test/new.jpg" }, { isNew: false, storedImageLink: "x", catalog: false });
        expect(p.imageLink).toBe("https://img.test/new.jpg");
    });
});

describe("buildProductPayload — catalog site: no monetary key", () => {
    it("empty price and salePrice are dropped; no option carries priceOverride or availability; empty option images omitted", () => {
        const p = buildProductPayload(FORM, { isNew: true, storedImageLink: "", catalog: true });
        for (const key of MONETARY) expect(p).not.toHaveProperty(key);
        expect(p.volumePricing).toEqual([]);
        expect(p.personalizations).toEqual([]);
        expect(p.variants[0].options).toEqual([
            { value: "120x20", imageLink: "https://img.test/1.jpg" },
            { value: "140x20" },
        ]);
    });

    it("commerce site: the body is unchanged (empty salePrice and option fields still sent, as before)", () => {
        const p = buildProductPayload({ ...FORM, price: "10" }, { isNew: true, storedImageLink: "", catalog: false });
        expect(p.price).toBe("10");
        expect(p.salePrice).toBe("");
        expect(p.variants).toBe(FORM.variants);
    });
});
