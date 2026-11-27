import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeleteCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { MemoryTable } from "./memory-table.js";

/**
 * STAY-1A (docs/slices/stay-1.md § 2, Build record; ruling 5) — the pair rule `dateOrder` at save: `POST /forms` and
 * `PUT /forms/{id}` refuse a rule that does not name two different date fields of the form (400, nothing written),
 * store a valid rule as `{ earlier, later }`, and `null` removes it. The real handlers, `requireRole` and
 * `withInvalidation` run against the in-memory table; a `TransactWriteCommand` (which the table does not implement) is
 * applied here item by item. `events.js` and the page purge of `revalidate.js` are replaced. Credential-free.
 */

const { holder, mockAudit } = vi.hoisted(() => ({ holder: { table: null as any, writes: [] as any[] }, mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({
    db: {
        send: async (cmd: any) => {
            if (cmd instanceof TransactWriteCommand) {
                holder.writes.push(cmd);
                for (const t of cmd.input.TransactItems ?? []) {
                    if (t.Put) holder.table.put(t.Put.Item);
                    if (t.Delete) await holder.table.send(new DeleteCommand(t.Delete));
                }
                return {};
            }
            if (cmd instanceof PutCommand) holder.writes.push(cmd);
            return holder.table.send(cmd);
        },
    },
    TABLE_NAME: "test-table",
}));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/revalidate.js", () => ({ purgeStoredPagesOfRequestTenant: async () => {} }));

import { handler as createForm } from "../../src/forms/create.js";
import { handler as updateForm } from "../../src/forms/update.js";

const ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const event = (body: unknown, id?: string) => ({
    headers: { "x-tenant-id": "t1" },
    pathParameters: id ? { id } : undefined,
    requestContext: { authorizer: { lambda: ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
}) as any;
const call = async (handler: any, e: any) => {
    const res = (await handler(e, {} as any, () => {})) as any;
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};

const FIELDS = [
    { id: "f-arr", label: "Arrival", type: "date", required: true, min: "today" },
    { id: "f-dep", label: "Departure", type: "date", required: false },
    { id: "f-name", label: "Name", type: "text", required: true },
];
const formWrites = () => holder.writes.filter((c) => c instanceof TransactWriteCommand
    || String(c.input.Item?.SK ?? "").startsWith("FORM#"));

let table: MemoryTable;
beforeEach(() => {
    table = new MemoryTable();
    holder.table = table;
    holder.writes = [];
    mockAudit.mockReset().mockResolvedValue(undefined);
});

describe("POST /forms — dateOrder", () => {
    it.each([
        [{ earlier: "f-arr", later: "f-gone" }, 'dateOrder.later: the form has no field with id "f-gone".'],
        [{ earlier: "f-arr", later: "f-name" }, 'dateOrder.later: the field "Name" is not a date field.'],
        [{ earlier: "f-arr", later: "f-arr" }, "dateOrder: earlier and later must be two different fields."],
        ["f-arr<f-dep", "dateOrder: must be { earlier, later }, two field ids."],
    ])("%j → 400 naming the problem; nothing written", async (dateOrder, error) => {
        const res = await call(createForm, event({ name: "Stay", fields: FIELDS, dateOrder }));
        expect(res).toEqual({ status: 400, body: { error } });
        expect(formWrites()).toEqual([]);
    });

    it("a valid rule → 201; stored as { earlier, later } only", async () => {
        const res = await call(createForm, event({ name: "Stay", fields: FIELDS, dateOrder: { earlier: "f-arr", later: "f-dep", extra: 1 } }));
        expect(res.status).toBe(201);
        expect(table.get("TENANT#t1", `FORM#${res.body.id}`)!.dateOrder).toEqual({ earlier: "f-arr", later: "f-dep" });
    });

    it("no rule, or null → 201 and no dateOrder key (today's item)", async () => {
        for (const body of [{ name: "Contact", fields: FIELDS }, { name: "Contact 2", fields: FIELDS, dateOrder: null }]) {
            const res = await call(createForm, event(body));
            expect(res.status).toBe(201);
            expect(Object.hasOwn(table.get("TENANT#t1", `FORM#${res.body.id}`)!, "dateOrder")).toBe(false);
        }
    });
});

describe("PUT /forms/{id} — dateOrder on the merged form", () => {
    const STORED = { PK: "TENANT#t1", SK: "FORM#f1", Type: "Form", id: "f1", tenantId: "t1", name: "Stay", slug: "stay", fields: FIELDS,
        dateOrder: { earlier: "f-arr", later: "f-dep" }, status: "active", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
    beforeEach(() => table.put(STORED));

    it("a new field list that drops a field the stored rule names → 400; the stored form unchanged", async () => {
        const res = await call(updateForm, event({ fields: FIELDS.filter((f) => f.id !== "f-dep") }, "f1"));
        expect(res).toEqual({ status: 400, body: { error: 'dateOrder.later: the form has no field with id "f-dep".' } });
        expect(formWrites()).toEqual([]);
        expect(table.get("TENANT#t1", "FORM#f1")).toEqual(STORED);
    });

    it("a field the rule names turned into text → 400", async () => {
        const res = await call(updateForm, event({ fields: FIELDS.map((f) => (f.id === "f-arr" ? { ...f, type: "text" } : f)) }, "f1"));
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('dateOrder.earlier: the field "Arrival" is not a date field.');
    });

    it("dateOrder: null → the rule is removed", async () => {
        const res = await call(updateForm, event({ dateOrder: null }, "f1"));
        expect(res.status).toBe(200);
        expect(Object.hasOwn(table.get("TENANT#t1", "FORM#f1")!, "dateOrder")).toBe(false);
    });

    it("a form without a date field and without a rule: an update is stored as before", async () => {
        const { dateOrder, ...dateless } = STORED;
        table.put({ ...dateless, SK: "FORM#f2", id: "f2", slug: "contact", fields: [FIELDS[2]] });
        const res = await call(updateForm, event({ name: "Contact" }, "f2"));
        expect(res.status).toBe(200);
        expect(table.get("TENANT#t1", "FORM#f2")!.name).toBe("Contact");
    });
});
