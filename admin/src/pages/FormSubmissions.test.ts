import { describe, it, expect } from "vitest";
import { interestItemRows, isMissingSystemForm, submissionsBackTarget } from "./FormSubmissions";

/**
 * CAT-INTEREST-1 — the submissions page's pure parts (slice docs/slices/cat-interest-1.md § 2.7; spec
 * docs/slices/catalog-mode-1.md § 3.5 "the `items` column needs a list renderer", "the back button … points
 * elsewhere for this id").
 */

describe("interestItemRows — an interest list's items as product-editor links", () => {
    it("one row per item: the server-recorded title, the option, a link to /products/<id>", () => {
        expect(interestItemRows("interest-list", "items", [
            { productId: "p1", title: "Oak Plank", slug: "oak-plank", optionValue: "140x20", imageLink: "https://img.test/1.jpg" },
            { productId: "p2", title: "Ash Plank", slug: "ash-plank" },
        ])).toEqual([
            { key: "p1#140x20#0", title: "Oak Plank", optionValue: "140x20", href: "/products/p1" },
            { key: "p2##1", title: "Ash Plank", href: "/products/p2" },
        ]);
    });

    it("two options of one product stay two rows with distinct keys", () => {
        const rows = interestItemRows("interest-list", "items", [{ productId: "p", title: "Rug", optionValue: "red" }, { productId: "p", title: "Rug", optionValue: "blue" }])!;
        expect(rows.map((r) => r.optionValue)).toEqual(["red", "blue"]);
        expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    });

    it("a non-list value of the items field → null; malformed entries are skipped", () => {
        for (const v of ["text", 3, true, undefined, null, { productId: "p" }]) expect(interestItemRows("interest-list", "items", v)).toBeNull();
        expect(interestItemRows("interest-list", "items", [null, "x", { title: "no id" }, { productId: "p9" }])).toEqual([
            { key: "p9##0", title: "p9", href: "/products/p9" },
        ]);
    });

    it("the id is URL-encoded into the editor link", () => {
        expect(interestItemRows("interest-list", "items", [{ productId: "a/b", title: "T" }])![0].href).toBe("/products/a%2Fb");
    });
});

describe("submissionsBackTarget — where the back buttons go", () => {
    it("a user form → its editor, as before", () => {
        expect(submissionsBackTarget("f-123", true)).toBe("/forms/f-123");
        expect(submissionsBackTarget("f-123", false)).toBe("/forms/f-123");
    });

    it("the interest list → never the editor: the previous page, or the dashboard when opened directly", () => {
        expect(submissionsBackTarget("interest-list", true)).toBe(-1);
        expect(submissionsBackTarget("interest-list", false)).toBe("/");
    });
});

describe("preservation: the item renderer touches ONLY the interest list's items field (review-0 F6)", () => {
    const LIST = [{ productId: "p1", title: "Oak" }];
    it("an array in an ordinary form's field keeps its existing cell (null → String(value) as before)", () => {
        expect(interestItemRows("f-123", "items", LIST)).toBeNull();
        expect(interestItemRows("f-123", "tags", ["a", "b"])).toBeNull();
    });
    it("another field of the interest list is not an item list either", () => {
        expect(interestItemRows("interest-list", "message", LIST)).toBeNull();
    });
});

describe("isMissingSystemForm — only not-found of the interest list means \"no submissions yet\" (review-0 F6)", () => {
    it("404 on the interest-list definition → true", () => {
        expect(isMissingSystemForm("interest-list", new Error("API Error (404): Form not found"))).toBe(true);
    });
    it("any other failure of that read stays an error (500, network, session)", () => {
        for (const e of [new Error("API Error (500): boom"), new TypeError("Failed to fetch"), new Error("Session expired. Please login again."), "404"]) {
            expect(isMissingSystemForm("interest-list", e)).toBe(false);
        }
    });
    it("a 404 for an ordinary form stays an error", () => {
        expect(isMissingSystemForm("f-123", new Error("API Error (404): Form not found"))).toBe(false);
    });
});
