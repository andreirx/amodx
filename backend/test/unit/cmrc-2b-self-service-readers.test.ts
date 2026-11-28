import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * CMRC-2B (docs/slices/cmrc-2b.md § Proofs) — the three renderer-key reads of `src/customers/self-service.ts`
 * (`POST /customer/order-history`, `/customer/profile-read`, `/customer/order-lookup`) are not frozen: with
 * `COMMERCE_WRITE_FREEZE_TENANTS` naming the tenant, each still reads its stored item and answers 200 with it.
 * (The seven other readers are proven over the CMRC-1A command trace in `cmrc-2b-write-freeze.test.ts`.)
 * The real handlers over the in-memory table; `db.js` is the one replaced module, as in `cmrc-1-self-service.test.ts`.
 */

const seam = vi.hoisted(() => ({ send: async (_command: unknown): Promise<unknown> => { throw new Error("the table is not ready"); } }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (command: unknown) => seam.send(command) }, TABLE_NAME: "main-table-of-the-test" }));

import { MemoryTable } from "./memory-table.js";
import { orderHistoryHandler, orderLookupHandler, profileReadHandler } from "../../src/customers/self-service.js";

const PK = "TENANT#t1";
const RENDERER = { sub: "renderer", role: "RENDERER", tenantId: "ALL" };
const event = (body: unknown): never => ({
    headers: { "content-type": "application/json", "x-tenant-id": "t1" },
    body: JSON.stringify(body),
    requestContext: { authorizer: { lambda: RENDERER } },
}) as never;

let table: MemoryTable;
beforeEach(() => {
    table = new MemoryTable();
    seam.send = (command) => table.send(command);
    table.put({ PK, SK: "CUSTORDER#ana@example.com#o-1", orderNumber: "PPB-0001", total: 10, status: "placed", createdAt: "2026-11-01T00:00:00.000Z" });
    table.put({ PK, SK: "CUSTOMER#ana@example.com", email: "ana@example.com", name: "Ana", phone: "0700000000" });
    table.put({ PK, SK: "ORDER#o-1", id: "o-1", orderNumber: "PPB-0001", customerEmail: "ana@example.com", status: "placed", total: 10 });
    vi.stubEnv("COMMERCE_WRITE_FREEZE_TENANTS", "t1");
    for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const bodyOf = (res: { statusCode?: number; body?: string }) => ({ status: res.statusCode, body: JSON.parse(res.body as string) });

describe("CMRC-2B — the /customer/* reads answer a frozen tenant", () => {
    it("the tenant is listed in this file's runs", () => {
        expect(process.env.COMMERCE_WRITE_FREEZE_TENANTS).toBe("t1");
    });

    it("POST /customer/order-history → 200 with the stored row", async () => {
        const answer = bodyOf(await orderHistoryHandler(event({ email: "ana@example.com" }), {} as never, () => {}) as never);
        expect(answer.status).toBe(200);
        expect(answer.body.orders).toEqual([{ orderNumber: "PPB-0001", total: 10, status: "placed", createdAt: "2026-11-01T00:00:00.000Z", orderId: "o-1" }]);
        expect(table.commands.map((c) => c.constructor.name)).toEqual(["QueryCommand"]);
    });

    it("POST /customer/profile-read → 200 with the stored profile", async () => {
        const answer = bodyOf(await profileReadHandler(event({ email: "ana@example.com" }), {} as never, () => {}) as never);
        expect(answer.status).toBe(200);
        expect(answer.body.profile).toMatchObject({ name: "Ana", phone: "0700000000" });
        expect(table.commands.map((c) => c.constructor.name)).toEqual(["GetCommand"]);
    });

    it("POST /customer/order-lookup → 200 with the stored order", async () => {
        const answer = bodyOf(await orderLookupHandler(event({ orderId: "o-1", email: "ana@example.com" }), {} as never, () => {}) as never);
        expect(answer.status).toBe(200);
        expect(answer.body.order).toMatchObject({ id: "o-1", orderNumber: "PPB-0001", status: "placed", total: 10 });
        expect(table.commands.map((c) => c.constructor.name)).toEqual(["GetCommand"]);
    });
});
