import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * TENANT-BIND-1 — five authenticated list/delete handlers bind the caller to the tenant it names.
 *
 * The HTTP API authorizer only proves the caller is SOMEONE; the tenant binding is
 * `requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], x-tenant-id)` (backend/src/auth/policy.ts):
 * the token tenant must equal the header, GLOBAL_ADMIN passes with no tenant check, and a role outside the
 * list (CUSTOMER, RENDERER) is refused. A refusal is 403 `{ error }` and happens before any DynamoDB call.
 *
 * Caller classes the rows stand for (contexts as built by backend/src/auth/authorizer.ts):
 * - EDITOR / TENANT_ADMIN of t1  → an admin-SPA user (admin Cognito pool, custom:role + custom:tenantId)
 * - GLOBAL_ADMIN, tenantId "ALL" → the MCP server / master key ("system-robot")
 * - CUSTOMER of t1               → a public-pool (storefront customer) token
 *
 * Credential-free: `db.js` is mocked; `@aws-sdk/lib-dynamodb` command classes stay real (they only
 * hold their `input`, no network).
 */

const { ddbSend } = vi.hoisted(() => ({ ddbSend: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));

import { handler as leadsList } from "../../src/leads/list.js";
import { handler as leadsDelete } from "../../src/leads/delete.js";
import { handler as auditList } from "../../src/audit/list.js";
import { handler as signalsList } from "../../src/signals/list.js";
import { handler as assetsList } from "../../src/assets/list.js";

type Ctx = { sub: string; role: string; tenantId: string; email?: string };

const EDITOR_T1: Ctx = { sub: "u1", email: "editor@t1.test", role: "EDITOR", tenantId: "t1" };
const TENANT_ADMIN_T1: Ctx = { sub: "u2", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const GLOBAL_ADMIN: Ctx = { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" };
const CUSTOMER_T1: Ctx = { sub: "c1", email: "buyer@t1.test", role: "CUSTOMER", tenantId: "t1" };

// [file under test, handler, extra event fields]
const HANDLERS = [
    ["leads/list.ts", leadsList, {}],
    ["leads/delete.ts", leadsDelete, { pathParameters: { email: "lead%40t.test" } }],
    ["audit/list.ts", auditList, {}],
    ["signals/list.ts", signalsList, {}],
    ["assets/list.ts", assetsList, {}],
] as const;

function event(ctx: Ctx, header: string | undefined, extra: object) {
    return {
        headers: header === undefined ? {} : { "x-tenant-id": header },
        requestContext: { authorizer: { lambda: ctx }, http: { sourceIp: "127.0.0.1" } },
        ...extra,
    } as any;
}

/** The partition key of the one DynamoDB command sent (Query → :pk value, Delete → Key.PK). */
function sentPk(): string {
    const input = ddbSend.mock.calls[0][0].input;
    return input.Key?.PK ?? input.ExpressionAttributeValues?.[":pk"];
}

beforeEach(() => {
    ddbSend.mockReset();
    ddbSend.mockResolvedValue({ Items: [] });
});

describe.each(HANDLERS)("TENANT-BIND-1 — %s", (name, handler, extra) => {
    const run = async (ctx: Ctx, header: string | undefined) =>
        (await handler(event(ctx, header, extra), {} as any, () => {})) as any;

    it(`${name}: EDITOR of t1 with header t1 → authorised (DynamoDB called, status 200)`, async () => {
        const res = await run(EDITOR_T1, "t1");
        expect(res.statusCode).toBe(200);
        expect(ddbSend).toHaveBeenCalledTimes(1);
        expect(sentPk()).toBe("TENANT#t1");
    });

    it(`${name}: EDITOR of t1 with header t2 → 403, no DynamoDB call`, async () => {
        const res = await run(EDITOR_T1, "t2");
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/Access Denied/);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it(`${name}: TENANT_ADMIN of t1 with header t2 → 403, no DynamoDB call`, async () => {
        const res = await run(TENANT_ADMIN_T1, "t2");
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/Access Denied/);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it(`${name}: GLOBAL_ADMIN with header t2 → authorised (DynamoDB called)`, async () => {
        const res = await run(GLOBAL_ADMIN, "t2");
        expect(res.statusCode).toBe(200);
        expect(ddbSend).toHaveBeenCalledTimes(1);
        expect(sentPk()).toBe("TENANT#t2");
    });

    it(`${name}: CUSTOMER (public pool) with header t1 → 403, no DynamoDB call`, async () => {
        const res = await run(CUSTOMER_T1, "t1");
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/Access Denied: Role 'CUSTOMER'/);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it(`${name}: no x-tenant-id → 400, no DynamoDB call`, async () => {
        const res = await run(EDITOR_T1, undefined);
        expect(res.statusCode).toBe(400);
        expect(ddbSend).not.toHaveBeenCalled();
    });
});
