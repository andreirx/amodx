import { describe, it, expect, beforeEach, vi } from "vitest";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ImportTable, T } from "./import-paths-1-harness";

/**
 * IMPORT-PATHS-1 ruling 2 / scope 5 — the WooCommerce CSV import (import/woocommerce.ts) and a cell with a line break
 * inside quotes. The specification marked the defect INFERRED (the parser split the file on `\n` before it read
 * quotes, woocommerce.ts:117 on base 30421e3). This file was written and run against the unchanged parser FIRST
 * (it failed: the record evidence is in docs/slices/import-paths-1.md "Build record"), then the parser was changed.
 * Invented data. Run as the real handler against the in-memory table; mocked: `db.js`, audit, media map, CDN wrapper.
 */

const h = vi.hoisted(() => ({ table: null as any }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => h.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));
vi.mock("../../src/lib/media-map.js", () => ({ loadMediaMap: vi.fn(async () => new Map()) }));
vi.mock("../../src/lib/invalidate-cdn.js", () => ({ withInvalidation: (handler: any) => handler }));
vi.mock("../../src/lib/revalidate.js", () => ({ purgeStoredPagesOfRequestTenant: vi.fn() }));

import { handler } from "../../src/import/woocommerce.js";

let db: ImportTable;
const run = async (csvContent: string) => {
    const res = await (handler as any)({
        headers: { "x-tenant-id": "t1" },
        body: JSON.stringify({ csvContent }),
        requestContext: { authorizer: { lambda: { sub: "u1", email: "admin@t1.example.test", role: "TENANT_ADMIN", tenantId: "t1" } }, http: { sourceIp: "127.0.0.1" } },
    }, {}, () => {});
    return { statusCode: res.statusCode as number, body: JSON.parse(res.body) };
};
const products = () => db.commands.filter((c) => c instanceof PutCommand && String(c.input.Item.SK).startsWith("PRODUCT#")).map((c) => c.input.Item);

beforeEach(() => {
    db = new ImportTable();
    h.table = db;
    db.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1" });
});

describe("IP1-R2 — a quoted cell with a line break is one cell (ruling 2)", () => {
    it("IP1-R2-QUOTED-LINE-BREAK: LF inside quotes → two products, the description keeps its line break, the next row is whole", async () => {
        const csv = [
            "ID,Type,Name,Published,Description,Regular price",
            '1,simple,Vas mic,1,"Prima linie',
            'A doua linie, cu virgula",25',
            '2,simple,Vas mare,1,"Fara rand nou",40',
        ].join("\n");
        const res = await run(csv);
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ imported: 2, skipped: 0, errors: [] });
        expect(products().map((p) => [p.title, p.longDescription, p.price])).toEqual([
            ["Vas mic", "Prima linie\nA doua linie, cu virgula", "25"],
            ["Vas mare", "Fara rand nou", "40"],
        ]);
    });

    it("IP1-R2-CRLF: a Windows file (CRLF line ends, CRLF inside quotes) reads the same rows", async () => {
        const csv = [
            "ID,Type,Name,Published,Description,Regular price",
            '1,simple,Vas mic,1,"Prima linie',
            'A doua linie",25',
            '2,simple,Vas mare,1,Simplu,40',
            "",
        ].join("\r\n");
        const res = await run(csv);
        expect(res.body).toMatchObject({ imported: 2, skipped: 0 });
        expect(products().map((p) => [p.title, p.longDescription, p.price])).toEqual([
            ["Vas mic", "Prima linie\nA doua linie", "25"],
            ["Vas mare", "Simplu", "40"],
        ]);
    });

    it("IP1-R2-UNCHANGED: a file without quoted line breaks reads as before (escaped quote, empty cell, blank line, BOM)", async () => {
        const csv = "﻿" + [
            "ID,Type,Name,Published,Description,Regular price",
            '1,simple,"Vas ""mic""",1,,25',
            "",
            "2,simple,Vas mare,1,Simplu,40",
        ].join("\n");
        const res = await run(csv);
        expect(res.body).toMatchObject({ imported: 2, skipped: 0 });
        expect(products().map((p) => [p.title, p.longDescription, p.price])).toEqual([
            ['Vas "mic"', undefined, "25"],
            ["Vas mare", "Simplu", "40"],
        ]);
    });
});

describe("IP1-F6 — the product lookup counts only this tenant's product (review F-IP1-TENANT-LOOKUP)", () => {
    const row = (pk: string, id: string) => db.put({ PK: pk, SK: `PRODUCT#${id}`, TenantSlug: "t1#vas-mic", Type: "Product", id, slug: "vas-mic", title: "Vas mic", createdAt: "2025-01-01T00:00:00.000Z" });
    const csv = ["ID,Type,Name,Published,Regular price", "1,simple,Vas mic,1,25"].join("\n");

    it.each([
        ["a foreign row only", [["TENANT#t2", "foreign"]], null],
        ["an own row only", [["TENANT#t1", "own"]], "own"],
        ["both rows", [["TENANT#t2", "foreign"], ["TENANT#t1", "own"]], "own"],
    ])("IP1-F6-LOOKUP: %s", async (_what, rows, expected) => {
        for (const [pk, id] of rows as [string, string][]) row(pk, id);
        const { findProductBySlug } = await import("../../src/import/product-slug.js");
        const found = await findProductBySlug("t1", "vas-mic");
        expect(found?.id ?? null).toBe(expected);
    });

    it("IP1-F6-WOO: the WooCommerce import does not take a foreign row as the existing product: it creates its own, the foreign row unchanged", async () => {
        row("TENANT#t2", "foreign");
        const res = await run(csv);
        expect(res.body).toMatchObject({ imported: 1, updated: 0 });
        const written = products();
        expect(written).toHaveLength(1);
        expect(written[0].PK).toBe(T);
        expect(written[0].id).not.toBe("foreign");
        expect(db.get("TENANT#t2", "PRODUCT#foreign")).toMatchObject({ title: "Vas mic", createdAt: "2025-01-01T00:00:00.000Z" });
    });
});
