// FINDINGS-1 Part 3 (docs/slices/findings-1.md) — `getProductById` / `getProductBySlug` (src/lib/dynamo.ts) do not
// return `resourceId`, and `getProductBySlug` accepts only an item of the asked tenant's partition (the check of
// backend/src/products/public-get.ts, SETTINGS-KEYS-1B). Every other stored field is returned unchanged.
// No AWS, no network: the document client's `send` is replaced by a fixed answer per command.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ answer: (_c: any): any => ({}) }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    return { ...real, DynamoDBDocumentClient: { from: () => ({ send: async (c: any) => store.answer(c) }) } };
});

import { getProductById, getProductBySlug } from "@/lib/dynamo";

const T = "t1";
const STORED = {
    PK: `TENANT#${T}`, SK: "PRODUCT#p1", TenantSlug: `${T}#ring`, Type: "Product", tenantId: T,
    id: "p1", status: "active", title: "Ring", slug: "ring", description: "Gold ring", price: "100", currency: "EUR",
    paymentLinkId: "pri_1", resourceId: "r-secret-file", importSource: "glam:p/sheet",
};
const { resourceId: _r, ...STORED_WITHOUT_FILE } = STORED;

beforeEach(() => { process.env.TABLE_NAME = "findings-1-unit"; });
afterEach(() => { delete process.env.TABLE_NAME; });

describe("FINDINGS-1 Part 3 — getProductById", () => {
    it("returns the stored item without resourceId; every other field unchanged", async () => {
        store.answer = (c) => (c.constructor.name === "GetCommand" ? { Item: structuredClone(STORED) } : {});
        expect(await getProductById(T, "p1")).toEqual(STORED_WITHOUT_FILE);
    });

    it("no item → null, as before", async () => {
        store.answer = () => ({});
        expect(await getProductById(T, "p1")).toBeNull();
    });
});

describe("FINDINGS-1 Part 3 — getProductBySlug", () => {
    const slugQuery = (items: any[]) => (c: any) =>
        c.constructor.name === "QueryCommand" && c.input.IndexName === "GSI_Slug" ? { Items: structuredClone(items) } : {};

    it("returns the tenant's product without resourceId; every other field unchanged", async () => {
        store.answer = slugQuery([STORED]);
        expect(await getProductBySlug(T, "ring")).toEqual(STORED_WITHOUT_FILE);
    });

    it("an index hit from another partition (PK not TENANT#<tenantId>) is not the product → null", async () => {
        store.answer = slugQuery([{ ...STORED, PK: "TENANT#t2" }]);
        expect(await getProductBySlug(T, "ring")).toBeNull();
        store.answer = slugQuery([{ ...STORED, PK: "SYSTEM", SK: "PRODUCT#poisoned" }]);
        expect(await getProductBySlug(T, "ring")).toBeNull();
    });

    it("a foreign hit before the tenant's own product → the tenant's own product", async () => {
        store.answer = slugQuery([{ ...STORED, PK: "TENANT#t2", title: "Foreign" }, STORED]);
        expect(await getProductBySlug(T, "ring")).toEqual(STORED_WITHOUT_FILE);
    });

    it("an unavailable product → null, as before", async () => {
        store.answer = slugQuery([{ ...STORED, availableUntil: "2000-01-01" }]);
        expect(await getProductBySlug(T, "ring")).toBeNull();
    });
});
