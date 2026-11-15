import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SHOP-LOOK-1A (docs/slices/shop-look-1a.md; design docs/slices/shop-look-1.md § 6.4) — `getActiveCategoriesByIds`, through the
 * real `renderer/src/lib/dynamo.ts`; only the DynamoDB document client is replaced by a stub that answers an exact-key
 * `GetCommand` from a list of stored items and applies the `ProjectionExpression` (with `ExpressionAttributeNames`) as
 * DynamoDB does. Any other command throws: an unmodelled read is a red test. Cases: 0, 1 and 12 ids; one missing; one
 * hidden; a category without a status; one `GetCommand` per id, with the stated key and projection; the order of `ids`.
 */

const store = vi.hoisted(() => ({ items: [] as Record<string, unknown>[], calls: [] as { name: string; input: any }[] }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    const project = (item: Record<string, unknown>, expression: string, names: Record<string, string>) =>
        Object.fromEntries(expression.split(",").map((s) => s.trim()).map((raw) => (raw.startsWith("#") ? names[raw] : raw))
            .filter((name) => Object.hasOwn(item, name)).map((name) => [name, item[name]]));
    return {
        ...real,
        DynamoDBDocumentClient: {
            from: () => ({
                send: async (c: any) => {
                    store.calls.push({ name: c.constructor.name, input: c.input });
                    if (c.constructor.name !== "GetCommand") throw new Error(`unmodelled ${c.constructor.name}`);
                    const item = store.items.find((i) => i.PK === c.input.Key.PK && i.SK === c.input.Key.SK);
                    return item ? { Item: c.input.ProjectionExpression ? project(item, c.input.ProjectionExpression, c.input.ExpressionAttributeNames) : { ...item } } : {};
                },
            }),
        },
    };
});

import { getActiveCategoriesByIds } from "@/lib/dynamo";

const category = (tenant: string, id: string, extra: Record<string, unknown> = {}) => ({
    PK: `TENANT#${tenant}`, SK: `CATEGORY#${id}`, TenantSlug: `${tenant}#${id}-slug`, id, tenantId: tenant, name: `Name ${id}`, slug: `${id}-slug`,
    description: `About ${id}`, imageLink: `https://img.test/${id}.jpg`, status: "active", sortOrder: 5, productCount: 3, seoTitle: "SEO", ...extra,
});
const shown = (id: string) => ({ id, name: `Name ${id}`, slug: `${id}-slug`, description: `About ${id}`, imageLink: `https://img.test/${id}.jpg` });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

beforeEach(() => { process.env.TABLE_NAME = "sl1a-unit"; store.items = []; store.calls = []; });
afterEach(() => { delete process.env.TABLE_NAME; });

describe("getActiveCategoriesByIds (§ 6.4)", () => {
    it("0 ids: no request, an empty list", async () => {
        store.items = [category("t1", "c1")];
        expect(await getActiveCategoriesByIds("t1", [])).toEqual([]);
        expect(store.calls).toEqual([]);
    });

    it("1 id: one GetCommand on TENANT#<tenant> / CATEGORY#<id> with the stated projection; the display fields, no status", async () => {
        store.items = [category("t1", "c1")];
        expect(await getActiveCategoriesByIds("t1", ["c1"])).toEqual([shown("c1")]);
        expect(store.calls).toEqual([{
            name: "GetCommand",
            input: {
                TableName: "sl1a-unit", Key: { PK: "TENANT#t1", SK: "CATEGORY#c1" },
                ProjectionExpression: "id, #n, slug, description, imageLink, #s", ExpressionAttributeNames: { "#n": "name", "#s": "status" },
            },
        }]);
    });

    it("12 ids: 12 GetCommands, one per id; the result keeps the order of ids, not the stored sort order", async () => {
        const twelve = ids(12);
        store.items = twelve.map((id, i) => category("t1", id, { sortOrder: 12 - i }));
        const order = [...twelve].reverse();
        expect(await getActiveCategoriesByIds("t1", order)).toEqual(order.map(shown));
        expect(store.calls.map((c) => c.name)).toEqual(Array(12).fill("GetCommand"));
        expect(store.calls.map((c) => c.input.Key.SK)).toEqual(order.map((id) => `CATEGORY#${id}`));
    });

    it("one missing id is skipped; the others keep their order", async () => {
        store.items = [category("t1", "c1"), category("t1", "c3")];
        expect(await getActiveCategoriesByIds("t1", ["c3", "c2", "c1"])).toEqual([shown("c3"), shown("c1")]);
        expect(store.calls).toHaveLength(3);
    });

    it("a hidden category is skipped, and so is one without a status (status not active)", async () => {
        store.items = [category("t1", "c1"), category("t1", "c2", { status: "hidden" }), category("t1", "c3", { status: undefined })];
        delete (store.items[2] as any).status;
        expect(await getActiveCategoriesByIds("t1", ["c1", "c2", "c3"])).toEqual([shown("c1")]);
        expect(store.calls).toHaveLength(3);
    });

    it("every id missing or hidden → an empty list", async () => {
        store.items = [category("t1", "c1", { status: "hidden" })];
        expect(await getActiveCategoriesByIds("t1", ["c1", "nope"])).toEqual([]);
    });

    it("tenant isolation: the key carries the request tenant; another tenant's category of the same id is not read", async () => {
        store.items = [category("t2", "c1")];
        expect(await getActiveCategoriesByIds("t1", ["c1"])).toEqual([]);
        expect(store.calls[0].input.Key).toEqual({ PK: "TENANT#t1", SK: "CATEGORY#c1" });
    });

    it("a category without a description or image: those keys are absent", async () => {
        const bare = category("t1", "c1");
        delete (bare as any).description; delete (bare as any).imageLink;
        store.items = [bare];
        expect(await getActiveCategoriesByIds("t1", ["c1"])).toEqual([{ id: "c1", name: "Name c1", slug: "c1-slug" }]);
    });

    it("no TABLE_NAME: throws, even for 0 ids (a read failure is never an empty result)", async () => {
        delete process.env.TABLE_NAME;
        await expect(getActiveCategoriesByIds("t1", [])).rejects.toThrow();
    });
});
