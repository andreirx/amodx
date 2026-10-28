import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * SERVICE-ACCOUNT-1 — the two routes that declare a scope admit a key; an undeclared route refuses it.
 *
 * Contexts as built by backend/src/auth/authorizer.ts. GET /products declares "catalog:read", GET /leads
 * declares "leads:read"; GET /audit declares nothing and is the control (handler-level deny by default; the
 * authorizer allowlist refuses it earlier — see service-key-authorizer.test.ts). A refusal is
 * 403 `{ error }` before any DynamoDB call. `db.js` mocked; credential-free.
 */

const { ddbSend } = vi.hoisted(() => ({ ddbSend: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));

import { handler as productsList } from "../../src/products/list.js";
import { handler as leadsList } from "../../src/leads/list.js";
import { handler as auditList } from "../../src/audit/list.js";

type Ctx = Record<string, string>;
const service = (scopes: string): Ctx => ({ sub: "service:k1", role: "SERVICE", tenantId: "t1", scopes, keyId: "k1" });
const EDITOR_T1: Ctx = { sub: "u1", email: "editor@t1.test", role: "EDITOR", tenantId: "t1" };

const run = async (handler: any, ctx: Ctx, header: string) =>
    (await handler({
        headers: { "x-tenant-id": header },
        requestContext: { authorizer: { lambda: ctx }, http: { sourceIp: "127.0.0.1" } },
    } as any, {} as any, () => {})) as any;

beforeEach(() => {
    ddbSend.mockReset();
    ddbSend.mockResolvedValue({ Items: [] });
});

describe("SERVICE-ACCOUNT-1 — scoped routes", () => {
    it("GET /products with SERVICE holding catalog:read, own tenant → 200, DynamoDB called", async () => {
        const res = await run(productsList, service("catalog:read"), "t1");
        expect(res.statusCode).toBe(200);
        expect(ddbSend).toHaveBeenCalledTimes(1);
        expect(ddbSend.mock.calls[0][0].input.ExpressionAttributeValues[":pk"]).toBe("TENANT#t1");
    });

    it("GET /products with SERVICE lacking catalog:read → 403, no DynamoDB call", async () => {
        const res = await run(productsList, service("leads:read"), "t1");
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/lacks scope catalog:read/);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("GET /products with SERVICE and a foreign x-tenant-id → 403, no DynamoDB call", async () => {
        const res = await run(productsList, service("catalog:read"), "t2");
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/bound to another tenant/);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("GET /leads with SERVICE holding leads:read → 200", async () => {
        const res = await run(leadsList, service("leads:read"), "t1");
        expect(res.statusCode).toBe(200);
        expect(ddbSend).toHaveBeenCalledTimes(1);
    });

    it("GET /leads with SERVICE lacking leads:read → 403", async () => {
        const res = await run(leadsList, service("catalog:read"), "t1");
        expect(res.statusCode).toBe(403);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("GET /audit with SERVICE holding both scopes → 403 (undeclared route)", async () => {
        const res = await run(auditList, service("catalog:read,leads:read"), "t1");
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/not available to service keys/);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("GET /products: EDITOR own tenant still 200; EDITOR foreign still 403 (now 403, not 500)", async () => {
        expect((await run(productsList, EDITOR_T1, "t1")).statusCode).toBe(200);
        ddbSend.mockClear();
        const foreign = await run(productsList, EDITOR_T1, "t2");
        expect(foreign.statusCode).toBe(403);
        expect(ddbSend).not.toHaveBeenCalled();
    });
});
