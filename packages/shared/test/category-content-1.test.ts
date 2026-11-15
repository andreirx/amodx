import { describe, it, expect } from "vitest";
import { CategorySchema, ContentItemSchema } from "../src/index.js";

/**
 * CATEGORY-CONTENT-1 (docs/slices/category-content-1.md) — `Category.blocks`: the type and the rule of a content page's
 * `blocks`, optional, with no default. The routes validate with `CategorySchema.omit(...)` (create) and
 * `.omit(...).partial()` (update); both forms are checked here. Pure.
 */

const CATEGORY = {
    id: "c1", tenantId: "t1", name: "Boen", slug: "boen",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
const ROUTE_OMIT = { id: true, tenantId: true, createdAt: true, updatedAt: true, productCount: true } as const;
const createInput = CategorySchema.omit(ROUTE_OMIT);
const updateInput = CategorySchema.omit(ROUTE_OMIT).partial();
const contentBlocks = ContentItemSchema.shape.blocks;
const BLOCKS = [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Boen" }] },
    { type: "image", attrs: { src: "https://img.test/boen.jpg", alt: "Boen" } },
];
const NOT_ARRAYS = ["x", 1, {}, { type: "paragraph" }, true];

describe("Category.blocks (CATEGORY-CONTENT-1 rule 1)", () => {
    it("absent stays absent: no default on the item, on create, or on update", () => {
        expect(Object.hasOwn(CategorySchema.parse(CATEGORY), "blocks")).toBe(false);
        expect(Object.hasOwn(createInput.parse({ name: "Boen", slug: "boen" }), "blocks")).toBe(false);
        // The update body without `blocks` must not carry a value that would replace the stored one.
        expect(Object.hasOwn(updateInput.parse({ name: "Boen" }), "blocks")).toBe(false);
    });

    it("an array of blocks is accepted as sent, on create and update; [] is kept as []", () => {
        expect(createInput.parse({ name: "Boen", slug: "boen", blocks: BLOCKS }).blocks).toEqual(BLOCKS);
        expect(updateInput.parse({ blocks: BLOCKS }).blocks).toEqual(BLOCKS);
        expect(updateInput.parse({ blocks: [] }).blocks).toEqual([]);
    });

    it("the content page's rule: exactly what the content schema accepts and refuses", () => {
        for (const value of [BLOCKS, [], ...NOT_ARRAYS, null]) {
            const content = contentBlocks.safeParse(value).success;
            expect(updateInput.safeParse({ blocks: value }).success, JSON.stringify(value)).toBe(content);
            expect(createInput.safeParse({ name: "Boen", slug: "boen", blocks: value }).success, JSON.stringify(value)).toBe(content);
        }
    });

    it("a value that is not an array is refused, naming the field", () => {
        for (const value of NOT_ARRAYS) {
            const r = updateInput.safeParse({ blocks: value });
            expect(r.success).toBe(false);
            expect(r.error!.issues[0].path).toEqual(["blocks"]);
        }
    });
});
