// CAT-IMPORT-PROFILE-1B — units of `src/catalog-listing.ts` (design docs/slices/cat-import-profile-1.md § 5.2, § 5.5
// "for the shared rule"). The base behaviour is pinned by the 1b golden; these rows state the rule case by case.
// The renderer runs the same fixture through `getCatalogListing` (renderer/test/unit/catalog-listing.test.ts).
import { describe, expect, it } from "vitest";
import { URL_PREFIX_DEFAULTS } from "../src/index";
import { catalogListing, catalogListingPath, isProductAvailable, utcDay } from "../src/catalog-listing";

const TODAY = "2026-10-31";
const p = (id: string, fields: Record<string, unknown> = {}) => ({ id, status: "active", categoryIds: ["c1"], sortOrder: 0, ...fields });

describe("utcDay — the UTC calendar day", () => {
    it("is the UTC date, not the local one", () => {
        expect(utcDay(new Date("2026-10-31T23:59:59.999Z"))).toBe("2026-10-31");
        expect(utcDay(new Date("2026-11-01T00:00:00.000Z"))).toBe("2026-11-01");
        expect(utcDay(new Date("2026-10-31T23:30:00-02:00"))).toBe("2026-11-01");
    });
});

describe("isProductAvailable — the window [availableFrom, availableUntil], both inclusive, on the UTC day", () => {
    it.each([
        [{}, true],
        [{ availableFrom: "2026-11-01" }, false],
        [{ availableFrom: "2026-10-31" }, true],
        [{ availableUntil: "2026-10-30" }, false],
        [{ availableUntil: "2026-10-31" }, true],
        [{ availableFrom: "2026-10-01", availableUntil: "2026-12-01" }, true],
        [{ availableFrom: "", availableUntil: "" }, true],
    ])("%j → %s", (window, expected) => {
        expect(isProductAvailable(window, TODAY)).toBe(expected);
    });
});

describe("catalogListing — § 5.5 membership fixture (the shared-rule rows)", () => {
    const items = [
        p("kept-active"),
        p("kept-draft", { status: "draft" }),
        p("kept-legacy", { status: undefined }),
        p("starts-tomorrow", { availableFrom: "2026-11-01" }),
        p("ended-yesterday", { availableUntil: "2026-10-30" }),
        p("other-category", { categoryIds: ["c2"] }),
        p("archived", { status: "archived" }),
        p("no-category-array", { categoryIds: "c1" }),
    ];
    it("shop: active and available only — the legacy product without status is NOT on the shop", () => {
        expect(catalogListing(items, undefined, TODAY).map((x) => x.id)).toEqual(["kept-active", "no-category-array", "other-category"]);
    });
    it("category: active or status-less, available, `categoryIds` an array holding the id — the legacy product IS listed", () => {
        expect(catalogListing(items, "c1", TODAY).map((x) => x.id)).toEqual(["kept-active", "kept-legacy"]);
        expect(catalogListing(items, "c2", TODAY).map((x) => x.id)).toEqual(["other-category"]);
        expect(catalogListing(items, "missing", TODAY)).toEqual([]);
    });
    it("order: sortOrder (absent = 0), ties by id in code-unit order, whatever the input order", () => {
        const unordered = [p("b", { sortOrder: 1 }), p("Z"), p("a"), p("c", { sortOrder: -1 }), p("d", { sortOrder: undefined })];
        expect(catalogListing(unordered, undefined, TODAY).map((x) => x.id)).toEqual(["c", "Z", "a", "d", "b"]);
        expect(catalogListing([...unordered].reverse(), undefined, TODAY).map((x) => x.id)).toEqual(["c", "Z", "a", "d", "b"]);
    });
    it("returns the same item objects, in a new array; the input is not reordered", () => {
        const input = [p("b"), p("a")];
        const out = catalogListing(input, undefined, TODAY);
        expect(out[0]).toBe(input[1]);
        expect(input.map((x) => x.id)).toEqual(["b", "a"]);
    });
    it("facetModes and every other field pass through untouched", () => {
        const withModes = p("m", { facetModes: { attributes: [{ key: "k", mode: "never" }] } });
        expect(catalogListing([withModes], undefined, TODAY)[0]).toBe(withModes);
    });
});

describe("catalogListingPath — the public path the renderer passes to the facet panel (§ 5.2)", () => {
    it("default prefixes: /shop and /category/<slug>", () => {
        expect(catalogListingPath(URL_PREFIX_DEFAULTS, undefined)).toBe("/shop");
        expect(catalogListingPath(URL_PREFIX_DEFAULTS, "boen")).toBe("/category/boen");
    });
    it("custom prefixes are followed (/magazin, /categorie)", () => {
        const custom = { ...URL_PREFIX_DEFAULTS, shop: "/magazin", category: "/categorie" };
        expect(catalogListingPath(custom, undefined)).toBe("/magazin");
        expect(catalogListingPath(custom, "boen")).toBe("/categorie/boen");
    });
    it("an empty shop prefix falls back to the renderer's literal \"/magazin\" (kept as it was; see the 1b record)", () => {
        expect(catalogListingPath({ ...URL_PREFIX_DEFAULTS, shop: "" }, undefined)).toBe("/magazin");
    });
});
