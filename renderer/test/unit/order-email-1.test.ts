import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ORDER-EMAIL-1 (docs/slices/order-email-1.md) — `getOrderForCustomer`, through the real `renderer/src/lib/dynamo.ts`;
 * only the DynamoDB document client is replaced by a stub that answers an exact-key `GetCommand` from a list of stored
 * items (the pattern of `shop-look-1a-read.test.ts`). Any other command throws: an unmodelled read is a red test.
 * The order handler stores `customerEmail` as `normalizeEmail(typed)` (`backend/src/orders/create.ts`); the
 * confirmation and tracking pages give the email as the visitor typed it. The read compares the stored value with
 * `normalizeEmail(email)` of the request side only.
 */

const store = vi.hoisted(() => ({ items: [] as Record<string, unknown>[], calls: [] as { name: string; input: any }[] }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    return {
        ...real,
        DynamoDBDocumentClient: {
            from: () => ({
                send: async (c: any) => {
                    store.calls.push({ name: c.constructor.name, input: c.input });
                    if (c.constructor.name !== "GetCommand") throw new Error(`unmodelled ${c.constructor.name}`);
                    const item = store.items.find((i) => i.PK === c.input.Key.PK && i.SK === c.input.Key.SK);
                    return item ? { Item: { ...item } } : {};
                },
            }),
        },
    };
});

import { getOrderForCustomer } from "@/lib/dynamo";

const order = (tenant: string, id: string, customerEmail: string) => ({
    PK: `TENANT#${tenant}`, SK: `ORDER#${id}`, id, orderNumber: "PPB-0001", customerEmail, total: 42,
    internalNotes: "staff only",
});
const shown = (tenant: string, id: string, customerEmail: string) => {
    const { internalNotes, ...rest } = order(tenant, id, customerEmail);
    return rest;
};

beforeEach(() => { process.env.TABLE_NAME = "oe1-unit"; store.items = []; store.calls = []; });
afterEach(() => { delete process.env.TABLE_NAME; });

describe("getOrderForCustomer — stored ana@example.com (normalized at order time)", () => {
    beforeEach(() => { store.items = [order("t1", "o1", "ana@example.com")]; });

    it("one GetCommand on TENANT#<tenant> / ORDER#<id>", async () => {
        await getOrderForCustomer("t1", "o1", "ana@example.com");
        expect(store.calls).toEqual([{ name: "GetCommand", input: { TableName: "oe1-unit", Key: { PK: "TENANT#t1", SK: "ORDER#o1" } } }]);
    });

    it("the same email → the order, without internalNotes", async () => {
        const got = await getOrderForCustomer("t1", "o1", "ana@example.com");
        expect(got).toEqual(shown("t1", "o1", "ana@example.com"));
        expect(got).not.toHaveProperty("internalNotes");
    });

    for (const typed of ["Ana@Example.com", "ANA@EXAMPLE.COM", " ana@example.com ", "\tAna@Example.com\n"]) {
        it(`capitals or edge whitespace (${JSON.stringify(typed)}) → the order`, async () => {
            expect(await getOrderForCustomer("t1", "o1", typed)).toEqual(shown("t1", "o1", "ana@example.com"));
        });
    }

    for (const typed of ["ana＠example.com", "Ａna@Example.com"]) {
        it(`a fullwidth form that normalizeEmail folds to the stored value (${JSON.stringify(typed)}) → the order`, async () => {
            expect(await getOrderForCustomer("t1", "o1", typed)).toEqual(shown("t1", "o1", "ana@example.com"));
        });
    }

    for (const typed of ["other@example.com", "Other@Example.com", "", "ana@example.co", "an a@example.com"]) {
        it(`an email of another customer or no email (${JSON.stringify(typed)}) → null`, async () => {
            expect(await getOrderForCustomer("t1", "o1", typed)).toBeNull();
        });
    }

    it("no such order id → null", async () => {
        expect(await getOrderForCustomer("t1", "o2", "ana@example.com")).toBeNull();
    });

    it("the same order id under another tenant → null (the key holds the tenant)", async () => {
        expect(await getOrderForCustomer("t2", "o1", "ana@example.com")).toBeNull();
        expect(store.calls[0].input.Key).toEqual({ PK: "TENANT#t2", SK: "ORDER#o1" });
    });
});

describe("getOrderForCustomer — a stored email that is not in normalized form (the current writer makes none)", () => {
    // Only the request side is normalized (packet § 1: do not widen without evidence). A stored value that
    // normalizeEmail would change is therefore not reached by any request — before the slice it was reached by the
    // exact same text only. Pinned so that a wider match is a deliberate, visible change.
    it("stored Ana@Example.com (no writer ever stored capitals): the same text → null (was: the order); the lower-case text → null (as before)", async () => {
        store.items = [order("t1", "o1", "Ana@Example.com")];
        expect(await getOrderForCustomer("t1", "o1", "Ana@Example.com")).toBeNull();
        expect(await getOrderForCustomer("t1", "o1", "ana@example.com")).toBeNull();
    });

    it("stored ' ana@example.com ' (lower case, not trimmed): the same text → null (was: the order)", async () => {
        store.items = [order("t1", "o1", " ana@example.com ")];
        expect(await getOrderForCustomer("t1", "o1", " ana@example.com ")).toBeNull();
    });
});
