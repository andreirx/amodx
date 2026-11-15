import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { MemoryTable } from "./memory-table.js";

/**
 * SMALL-FIXES-1 item A (docs/slices/small-fixes-1.md; cause: docs/slices/category-content-1.md finding F-2) —
 * `POST /categories` and `PUT /categories/{id}` answer a bad body with 400, in the shape of `content/create.ts`
 * (BACKEND-CONTRACT-1 D1): malformed JSON → 400 "Invalid JSON"; a schema refusal → 400 "Validation failed" + the zod
 * issues. On a 400 nothing is written and no cache call happens. A real server failure stays 500.
 *
 * The real handlers, `requireRole` and `withInvalidation` (with its CDN marker) run against the IN-MEMORY table of
 * memory-table.ts, so the marker write of `withInvalidation` is visible in `table.commands`. Only `db.js`,
 * `events.js` and the page purge calls of `revalidate.js` are replaced (spies). Credential-free.
 */

const { holder, mockAudit, mockRevalidate, mockPurge } = vi.hoisted(() => ({
    holder: { table: null as any }, mockAudit: vi.fn(), mockRevalidate: vi.fn(), mockPurge: vi.fn(),
}));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => holder.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/revalidate.js", () => ({
    revalidateTenantPaths: mockRevalidate, purgeStoredPagesOfRequestTenant: mockPurge, purgeStoredPagesOfDomains: async () => {},
}));

import { handler as createCategory } from "../../src/categories/create.js";
import { handler as updateCategory } from "../../src/categories/update.js";

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const STORED = {
    PK: "TENANT#t1", SK: "CATEGORY#c1", TenantSlug: "t1#boen", Type: "Category", id: "c1", tenantId: "t1",
    name: "Boen", slug: "boen", parentId: null, sortOrder: 0, status: "active", productCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

/** `rawBody` is sent as is (a string), so a test can send text that is not JSON. */
const event = (rawBody: string, id?: string) => ({
    headers: { "x-tenant-id": "t1" },
    pathParameters: id ? { id } : undefined,
    requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: rawBody,
}) as any;
const call = async (handler: any, e: any) => {
    const res = (await handler(e, {} as any, () => {})) as any;
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};

let table: MemoryTable;
const nonReads = () => table.commands.filter((c) => !(c instanceof GetCommand));

beforeEach(() => {
    table = new MemoryTable();
    holder.table = table;
    mockAudit.mockReset().mockResolvedValue(undefined);
    mockRevalidate.mockReset().mockResolvedValue(undefined);
    mockPurge.mockReset().mockResolvedValue(undefined);
});

describe("POST /categories — a bad body is the client's error (400)", () => {
    it("malformed JSON → 400 'Invalid JSON'; nothing sent to DynamoDB; no purge", async () => {
        const res = await call(createCategory, event("{not json"));
        expect(res).toEqual({ status: 400, body: { error: "Invalid JSON" } });
        expect(table.commands).toEqual([]);
        expect(mockPurge).not.toHaveBeenCalled();
    });
    it("a missing name → 400 'Validation failed' with the issue at name; nothing sent; no purge", async () => {
        const res = await call(createCategory, event(JSON.stringify({ slug: "boen" })));
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Validation failed");
        expect(res.body.issues.map((i: any) => i.path)).toContainEqual(["name"]);
        expect(table.commands).toEqual([]);
        expect(mockPurge).not.toHaveBeenCalled();
    });
    it("blocks not an array → 400 'Validation failed' with the issue at blocks; nothing sent; no purge", async () => {
        const res = await call(createCategory, event(JSON.stringify({ name: "Boen", slug: "boen", blocks: "not an array" })));
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Validation failed");
        expect(res.body.issues.map((i: any) => i.path)).toEqual([["blocks"]]);
        expect(table.commands).toEqual([]);
        expect(mockPurge).not.toHaveBeenCalled();
    });
    it("a valid body → 201 as before; the purge runs", async () => {
        const res = await call(createCategory, event(JSON.stringify({ name: "Boen", slug: "boen" })));
        expect(res.status).toBe(201);
        expect(res.body.slug).toBe("boen");
        expect(mockPurge).toHaveBeenCalledTimes(1);
    });
    it("DynamoDB fails on the write → 500 as before; no purge", async () => {
        table.failOn = (cmd) => cmd instanceof PutCommand;
        const res = await call(createCategory, event(JSON.stringify({ name: "Boen", slug: "boen" })));
        expect(res).toEqual({ status: 500, body: { error: "injected failure" } });
        expect(mockPurge).not.toHaveBeenCalled();
    });
});

describe("PUT /categories/{id} — a bad body is the client's error (400)", () => {
    beforeEach(() => table.put(STORED));

    it("malformed JSON → 400 'Invalid JSON'; nothing sent to DynamoDB; no purge", async () => {
        const res = await call(updateCategory, event("{not json", "c1"));
        expect(res).toEqual({ status: 400, body: { error: "Invalid JSON" } });
        expect(table.commands).toEqual([]);
        expect(mockRevalidate).not.toHaveBeenCalled();
    });
    it("blocks not an array (the F-2 staging case) → 400 'Validation failed' at blocks; nothing written; no purge", async () => {
        const res = await call(updateCategory, event(JSON.stringify({ blocks: "not an array" }), "c1"));
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Validation failed");
        expect(res.body.issues.map((i: any) => i.path)).toEqual([["blocks"]]);
        expect(nonReads()).toEqual([]);
        expect(table.get("TENANT#t1", "CATEGORY#c1")).toEqual(STORED);
        expect(mockRevalidate).not.toHaveBeenCalled();
    });
    it("an unknown status value → 400 'Validation failed' at status; nothing written; no purge", async () => {
        const res = await call(updateCategory, event(JSON.stringify({ status: "archived" }), "c1"));
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Validation failed");
        expect(res.body.issues.map((i: any) => i.path)).toEqual([["status"]]);
        expect(nonReads()).toEqual([]);
        expect(table.get("TENANT#t1", "CATEGORY#c1")).toEqual(STORED);
        expect(mockRevalidate).not.toHaveBeenCalled();
    });
    it("a valid body → 200 as before; the purge runs", async () => {
        const res = await call(updateCategory, event(JSON.stringify({ name: "Boen Floors" }), "c1"));
        expect(res.status).toBe(200);
        expect(table.get("TENANT#t1", "CATEGORY#c1")!.name).toBe("Boen Floors");
        expect(mockRevalidate).toHaveBeenCalledTimes(1);
    });
    it("an unknown id with a valid body → 404 as before", async () => {
        const res = await call(updateCategory, event(JSON.stringify({ name: "X" }), "missing"));
        expect(res.status).toBe(404);
    });
    it("DynamoDB fails on the read → 500 as before; nothing written; no purge", async () => {
        table.failOn = (cmd) => cmd instanceof GetCommand;
        const res = await call(updateCategory, event(JSON.stringify({ name: "Boen Floors" }), "c1"));
        expect(res).toEqual({ status: 500, body: { error: "injected failure" } });
        expect(nonReads()).toEqual([]);
        expect(mockRevalidate).not.toHaveBeenCalled();
    });
});
