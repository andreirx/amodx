import { describe, it, expect } from "vitest";
import { normalizeSlug } from "../../src/lib/slug.js";

/** BACKEND-CONTRACT-1 D3 — the one content-slug normaliser (create + update). */
describe("normalizeSlug", () => {
    it("lowercases, hyphenates whitespace, adds the leading slash: 'My Page' → /my-page", () => {
        expect(normalizeSlug("My Page")).toBe("/my-page");
    });

    it("underscore → dash, strips invalid chars, collapses dashes: '/A_B--C!' → /a-b-c", () => {
        expect(normalizeSlug("/A_B--C!")).toBe("/a-b-c");
    });

    it("leaves an already-normal nested slug unchanged: '/already/ok'", () => {
        expect(normalizeSlug("/already/ok")).toBe("/already/ok");
    });

    it("strips a trailing dash: 'trailing-' → /trailing", () => {
        expect(normalizeSlug("trailing-")).toBe("/trailing");
    });

    it("keeps repeated leading slashes ('//a' → //a) — characterises unchanged, ratified behaviour", () => {
        expect(normalizeSlug("//a")).toBe("//a");
    });
});
