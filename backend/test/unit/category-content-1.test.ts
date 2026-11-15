import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { MemoryTable } from "./memory-table.js";

/**
 * CATEGORY-CONTENT-1 (docs/slices/category-content-1.md) — a category's `blocks` through the backend: the create and
 * update routes (rule 1, rule 6), the two list routes (rule 5) and the WooCommerce import (rule 6). The glam import's
 * row is in glam-import-handler.test.ts (it reuses that file's fixtures). The real handlers, `requireRole` and
 * `withInvalidation` run against the IN-MEMORY table of memory-table.ts; only `db.js`, `events.js` and the page purge
 * calls of `revalidate.js` are replaced. Credential-free.
 */

type Item = Record<string, any>;

const { holder, mockAudit, mockRevalidate } = vi.hoisted(() => ({
    holder: { table: null as any }, mockAudit: vi.fn(), mockRevalidate: vi.fn(),
}));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => holder.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/revalidate.js", () => ({
    revalidateTenantPaths: mockRevalidate, purgeStoredPagesOfRequestTenant: async () => {}, purgeStoredPagesOfDomains: async () => {},
}));

import { handler as createCategory } from "../../src/categories/create.js";
import { handler as updateCategory } from "../../src/categories/update.js";
import { handler as listCategories } from "../../src/categories/list.js";
import { handler as publicListCategories } from "../../src/categories/public-list.js";
import { handler as getCategory } from "../../src/categories/get.js";
import { handler as wooImport } from "../../src/import/woocommerce.js";

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const SYSTEM_TENANT = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "T1", domain: "t1.test", Domain: "t1.test", commerceEnabled: true };

const BLOCKS = [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Boen" }] },
    { type: "image", attrs: { src: "https://img.test/boen.jpg", alt: "Boen floors" } },
];
const STORED = (extra: Item = {}): Item => ({
    PK: "TENANT#t1", SK: "CATEGORY#c1", TenantSlug: "t1#boen", Type: "Category", id: "c1", tenantId: "t1",
    name: "Boen", slug: "boen", description: "Plain text.", parentId: null, sortOrder: 3, status: "active", productCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", blocks: BLOCKS, ...extra,
});
/** About 300 KB of page content: three such categories exceed DynamoDB's 1 MB Query page. */
const LARGE_BLOCKS = [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(300_000) }] }];

const event = (body: unknown, opts: { id?: string; path?: string } = {}) => ({
    headers: { "x-tenant-id": "t1" },
    pathParameters: opts.id ? { id: opts.id } : undefined,
    queryStringParameters: undefined,
    routeKey: opts.path ?? "PUT /categories/{id}",
    requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: body === undefined ? undefined : JSON.stringify(body),
}) as any;
const call = async (handler: any, e: any) => {
    const res = (await handler(e, {} as any, () => {})) as any;
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};

let table: MemoryTable;
const categoryPuts = () => table.commands.filter((c) => c instanceof PutCommand && String(c.input.Item?.SK).startsWith("CATEGORY#"));

beforeEach(() => {
    table = new MemoryTable();
    holder.table = table;
    table.put(SYSTEM_TENANT);
    mockAudit.mockReset().mockResolvedValue(undefined);
    mockRevalidate.mockReset().mockResolvedValue(undefined);
});

describe("POST /categories — blocks (rule 1)", () => {
    it("blocks sent → stored as sent", async () => {
        const res = await call(createCategory, event({ name: "Boen", slug: "boen", blocks: BLOCKS }, { path: "POST /categories" }));
        expect(res.status).toBe(201);
        expect(table.get("TENANT#t1", `CATEGORY#${res.body.id}`)!.blocks).toEqual(BLOCKS);
    });
    it("no blocks sent → the item has no blocks key (today's item)", async () => {
        const res = await call(createCategory, event({ name: "Boen", slug: "boen" }, { path: "POST /categories" }));
        expect(res.status).toBe(201);
        expect(Object.hasOwn(table.get("TENANT#t1", `CATEGORY#${res.body.id}`)!, "blocks")).toBe(false);
    });
    it("blocks not an array → refused by the content page's rule, nothing written", async () => {
        for (const blocks of ["<h2>x</h2>", { type: "paragraph" }, 3, null]) {
            const res = await call(createCategory, event({ name: "Boen", slug: "boen", blocks }, { path: "POST /categories" }));
            // The category routes answer a schema refusal with their existing 500 + the zod message (finding F-2).
            expect(res.status, JSON.stringify(blocks)).toBe(500);
            expect(res.body.error).toContain("blocks");
        }
        expect(categoryPuts()).toEqual([]);
    });
});

describe("PUT /categories/{id} — blocks (rules 1, 6)", () => {
    beforeEach(() => table.put(STORED()));

    it("a body without blocks keeps the stored blocks (the admin form before this slice, the MCP, any partial body)", async () => {
        const res = await call(updateCategory, event({ name: "Boen Floors", description: "New text." }, { id: "c1" }));
        expect(res.status).toBe(200);
        const stored = table.get("TENANT#t1", "CATEGORY#c1")!;
        expect(stored.blocks).toEqual(BLOCKS);
        expect(stored.name).toBe("Boen Floors");
        expect(res.body.blocks).toEqual(BLOCKS);
    });
    it("blocks: [] → stored as []", async () => {
        const res = await call(updateCategory, event({ blocks: [] }, { id: "c1" }));
        expect(res.status).toBe(200);
        expect(table.get("TENANT#t1", "CATEGORY#c1")!.blocks).toEqual([]);
    });
    it("new blocks → they replace the stored blocks (the editor sends the whole list)", async () => {
        const next = [{ type: "paragraph", content: [{ type: "text", text: "Only this." }] }];
        expect((await call(updateCategory, event({ blocks: next }, { id: "c1" }))).status).toBe(200);
        expect(table.get("TENANT#t1", "CATEGORY#c1")!.blocks).toEqual(next);
    });
    it("blocks not an array → refused, nothing written, the stored blocks kept", async () => {
        for (const blocks of ["x", { a: 1 }, null]) {
            const res = await call(updateCategory, event({ blocks }, { id: "c1" }));
            expect(res.status, JSON.stringify(blocks)).toBe(500);
            expect(res.body.error).toContain("blocks");
        }
        expect(categoryPuts()).toEqual([]);
        expect(table.get("TENANT#t1", "CATEGORY#c1")!.blocks).toEqual(BLOCKS);
    });
    it("the refresh: a save purges the category page by the same call as a description change", async () => {
        await call(updateCategory, event({ description: "Changed." }, { id: "c1" }));
        await call(updateCategory, event({ blocks: [] }, { id: "c1" }));
        expect(mockRevalidate.mock.calls).toEqual([["t1", "category", ["boen", "boen"]], ["t1", "category", ["boen", "boen"]]]);
    });
});

describe("GET /categories/{id} — the editor's read carries blocks", () => {
    it("the stored blocks are in the answer", async () => {
        table.put(STORED());
        const res = await call(getCategory, event(undefined, { id: "c1", path: "GET /categories/{id}" }));
        expect(res.status).toBe(200);
        expect(res.body.blocks).toEqual(BLOCKS);
    });
});

describe("the list routes carry no blocks and follow every page (rule 5)", () => {
    beforeEach(() => {
        for (const n of [1, 2, 3, 4]) {
            table.put(STORED({ SK: `CATEGORY#c${n}`, TenantSlug: `t1#cat-${n}`, id: `c${n}`, slug: `cat-${n}`, name: `Cat ${n}`, blocks: LARGE_BLOCKS }));
        }
        // DynamoDB's page limit counts the stored item: about three of these per 1 MB page. One item per page here.
        table.pageSize = 1;
    });
    for (const [name, handler, path] of [
        ["GET /categories", listCategories, "GET /categories"],
        ["GET /public/categories", publicListCategories, "GET /public/categories"],
    ] as const) {
        it(`${name}: every category, none with blocks`, async () => {
            const res = await call(handler, event(undefined, { path }));
            expect(res.status).toBe(200);
            expect(res.body.items.map((c: Item) => c.id).sort()).toEqual(["c1", "c2", "c3", "c4"]);
            for (const c of res.body.items) expect(Object.hasOwn(c, "blocks")).toBe(false);
            expect(JSON.stringify(res.body).length).toBeLessThan(2_000);
            const queries = table.commands.filter((c) => c instanceof QueryCommand);
            expect(queries).toHaveLength(4);
            for (const q of queries) expect(q.input.ProjectionExpression).not.toContain("blocks");
        });
    }
});

describe("POST /import/woocommerce — an existing category keeps its blocks (rule 6)", () => {
    const CSV = [
        "Name,Slug,Regular price,Categories,Published,Type",
        "Oak Plank,oak-plank,10,Boen,1,simple",
    ].join("\n") + "\n";
    const woo = () => call(wooImport, event({ csvContent: CSV }, { path: "POST /import/woocommerce" }));

    it("the category at CATEGORY#<slug> exists with blocks → matched, not written; blocks kept", async () => {
        table.put(STORED({ SK: "CATEGORY#boen", id: "boen" }));
        const res = await woo();
        expect(res.status).toBe(200);
        expect(res.body.categoriesCreated ?? 0).toBe(0);
        expect(categoryPuts()).toEqual([]);
        expect(table.get("TENANT#t1", "CATEGORY#boen")!.blocks).toEqual(BLOCKS);
        expect(table.all("PRODUCT#").map((p) => p.categoryIds)).toEqual([["boen"]]);
    });

    it("written between the import's Get and its Put (the race) → the Put is refused by its condition; blocks kept", async () => {
        table.put(STORED({ SK: "CATEGORY#boen", id: "boen" }));
        // The Get answers "absent" once: the category is created by someone else after this read.
        const send = table.send.bind(table);
        let hidden = false;
        table.send = async (cmd: any) => {
            if (!hidden && cmd instanceof GetCommand && cmd.input.Key?.SK === "CATEGORY#boen") { hidden = true; table.commands.push(cmd); return { Item: undefined }; }
            return send(cmd);
        };
        const res = await woo();
        expect(hidden).toBe(true);
        const puts = categoryPuts();
        expect(puts).toHaveLength(1);
        expect(puts[0].input.ConditionExpression).toBe("attribute_not_exists(SK)");
        expect(table.get("TENANT#t1", "CATEGORY#boen")!.blocks).toEqual(BLOCKS);
        expect(table.get("TENANT#t1", "CATEGORY#boen")!.name).toBe("Boen");
        // The row fails (reported), as a refused glam category does; importing again matches the category.
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toContain("Oak Plank");
    });

    it("an absent category is still created (today's behaviour)", async () => {
        const res = await woo();
        expect(res.status).toBe(200);
        expect(table.get("TENANT#t1", "CATEGORY#boen")).toMatchObject({ id: "boen", slug: "boen", name: "Boen" });
        expect(Object.hasOwn(table.get("TENANT#t1", "CATEGORY#boen")!, "blocks")).toBe(false);
    });
});
