import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * CMRC-1B, test T4 (docs/slices/cmrc-1b.md § Proofs; docs/slices/cmrc-1.md § 5.6, § 5.7, § 5.9) — the two handlers of
 * `src/customers/self-service.ts`: `orderHistoryHandler` (POST /customer/order-history, D1) and `profileReadHandler`
 * (POST /customer/profile-read, D2). The REAL handlers over an in-memory table (`memory-table.ts`); `db.js` is the one
 * replaced module. Credential-free.
 *
 * What it proves, per route:
 *  - WHO: the roles RENDERER and GLOBAL_ADMIN pass; every other caller gets 403 and NO DynamoDB command is sent;
 *  - WHICH TENANT: the partition of every command is `TENANT#<x-tenant-id>`;
 *  - INPUT: a body that is not exactly `{ email: non-empty string }` → 400 with path and message, no request text in
 *    the answer, no command; an email that matches nothing is "nothing found", after the same read;
 *  - THE READ: the command is exactly the one the renderer sent before CMRC-1B (the expected inputs are written here
 *    as literals — this file is the independent statement of the command and of the stored key format);
 *  - VALUE: each stored attribute comes back unchanged; an absent attribute is absent;
 *  - FAILURE: a DynamoDB error → 500 `{ code: "internal" }`; the log line has the route and the error's name only.
 *
 * What it does not prove: the real DynamoDB (the table is a test double); the authorizer (the next file,
 * `cmrc-1-self-service-auth.test.ts`); that the renderer sends the session's email (renderer tests).
 */

const seam = vi.hoisted(() => ({ send: async (_command: unknown): Promise<unknown> => { throw new Error("the table is not ready"); } }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (command: unknown) => seam.send(command) }, TABLE_NAME: "main-table-of-the-test" }));

import { MemoryTable } from "./memory-table.js";
import { orderHistoryHandler, profileReadHandler } from "../../src/customers/self-service.js";

const TABLE = "main-table-of-the-test";
const RENDERER = { sub: "renderer", role: "RENDERER", tenantId: "ALL" };
const ADDRESS = { street: "1 Test Street", city: "Testville", county: "Test County", postalCode: "000000", country: "RO" };

type Handler = typeof orderHistoryHandler;
const ROUTES: [string, Handler, unknown][] = [
    ["POST /customer/order-history", orderHistoryHandler, { orders: [] }],
    ["POST /customer/profile-read", profileReadHandler, { profile: null }],
];

/** An API gateway event: `auth` is what the authorizer passed; `body` is sent as given when it is a string. */
const event = (parts: { auth?: unknown; tenant?: string | null; body?: unknown } = {}): never => ({
    headers: { "content-type": "application/json", ...(parts.tenant === null ? {} : { "x-tenant-id": parts.tenant ?? "t1" }) },
    body: parts.body === undefined ? JSON.stringify({ email: "ana@example.com" }) : typeof parts.body === "string" ? parts.body : JSON.stringify(parts.body),
    requestContext: { authorizer: { lambda: "auth" in parts ? parts.auth : RENDERER } },
}) as never;

const answerOf = (res: Awaited<ReturnType<Handler>>) => ({ status: res.statusCode, body: JSON.parse(res.body as string) });

let table: MemoryTable;
let logs: string[];
const sent = () => table.commands.map((c) => ({ command: c.constructor.name, input: c.input }));

beforeEach(() => {
    table = new MemoryTable();
    seam.send = (command) => table.send(command);
    logs = [];
    for (const method of ["log", "warn", "error"] as const) {
        vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => { logs.push(parts.map(String).join(" ")); });
    }
});
afterEach(() => vi.restoreAllMocks());

describe.each(ROUTES)("CMRC-1B T4 — %s: who may call", (_route, handler, nothingFound) => {
    it.each([
        ["the renderer key", RENDERER],
        ["the master key (GLOBAL_ADMIN, which requireRole always admits)", { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" }],
    ])("%s → 200", async (_name, auth) => {
        expect(answerOf(await handler(event({ auth })))).toEqual({ status: 200, body: nothingFound });
        expect(sent()).toHaveLength(1);
    });

    it.each([
        ["a tenant admin of the same tenant", { sub: "u1", role: "TENANT_ADMIN", tenantId: "t1" }],
        ["an editor of the same tenant", { sub: "u2", role: "EDITOR", tenantId: "t1" }],
        ["a signed-in customer of the same tenant", { sub: "u3", role: "CUSTOMER", tenantId: "t1", email: "ana@example.com" }],
        ["a service key of the same tenant", { sub: "k1", role: "SERVICE", tenantId: "t1", scopes: "catalog:read,leads:read", keyId: "k1" }],
        ["a caller without a role (treated as EDITOR)", { sub: "u4", tenantId: "t1" }],
        ["an anonymous caller", { sub: "anonymous" }],
        ["a role written in another letter case", { sub: "renderer", role: "renderer", tenantId: "ALL" }],
        ["no authorizer context", undefined],
    ])("%s → 403 forbidden, and nothing is read", async (_name, auth) => {
        const res = await handler(event({ auth }));
        expect(answerOf(res)).toEqual({ status: 403, body: { code: "forbidden" } });
        expect(sent()).toEqual([]);
    });

    it("a refused caller learns nothing about the request: a malformed body and a missing tenant are still 403", async () => {
        const res = await handler(event({ auth: { sub: "u1", role: "TENANT_ADMIN", tenantId: "t1" }, tenant: null, body: "{not json" }));
        expect(answerOf(res)).toEqual({ status: 403, body: { code: "forbidden" } });
        expect(sent()).toEqual([]);
    });

    it("the answer is never stored: Cache-Control no-store, JSON", async () => {
        const ok = await handler(event());
        const refused = await handler(event({ auth: { sub: "anonymous" } }));
        for (const res of [ok, refused]) {
            expect(res.headers).toEqual({ "Content-Type": "application/json", "Cache-Control": "no-store" });
        }
    });
});

describe.each(ROUTES)("CMRC-1B T4 — %s: the request structure (a failure here is a renderer defect)", (_route, handler) => {
    it("no x-tenant-id → 400 missingTenant, and nothing is read", async () => {
        expect(answerOf(await handler(event({ tenant: null })))).toEqual({ status: 400, body: { code: "missingTenant" } });
        expect(answerOf(await handler(event({ tenant: "" })))).toEqual({ status: 400, body: { code: "missingTenant" } });
        expect(sent()).toEqual([]);
    });

    it("no body, or a body that is not JSON → 400 malformedRequest; the body's text is not in the answer", async () => {
        const noBody = await handler({ headers: { "x-tenant-id": "t1" }, requestContext: { authorizer: { lambda: RENDERER } } } as never);
        expect(answerOf(noBody)).toEqual({ status: 400, body: { code: "malformedRequest", issues: [{ path: "", message: "The body is not JSON." }] } });
        const notJson = await handler(event({ body: '{"email":"sentinel.visitor@example.test",' }));
        expect(answerOf(notJson)).toEqual({ status: 400, body: { code: "malformedRequest", issues: [{ path: "", message: "The body is not JSON." }] } });
        expect(notJson.body).not.toContain("sentinel");
        expect(sent()).toEqual([]);
    });

    it.each([
        ["field absent", {}, "email"],
        ["an empty string", { email: "" }, "email"],
        ["a number", { email: 12345678 }, "email"],
        ["null", { email: null }, "email"],
        ["a list", { email: ["sentinel@example.test"] }, "email"],
        ["an object", { email: { address: "sentinel@example.test" } }, "email"],
        ["an extra field", { email: "ana@example.com", sentinelField: "sentinel-value" }, ""],
        ["an extra tenant id", { email: "ana@example.com", tenantId: "sentinel-tenant" }, ""],
        ["JSON that is a string", JSON.stringify("sentinel@example.test"), ""],
        ["JSON that is a list", [{ email: "sentinel@example.test" }], ""],
        ["JSON null", "null", ""],
    ])("%s → 400 malformedRequest with the path; no request text in the answer; nothing is read", async (_name, body, path) => {
        const res = await handler(event({ body }));
        const got = answerOf(res);
        expect(got.status).toBe(400);
        expect(got.body.code).toBe("malformedRequest");
        expect(got.body.issues.map((i: { path: string }) => i.path)).toEqual([path]);
        expect(got.body.issues.every((i: { message: unknown }) => typeof i.message === "string" && i.message !== "")).toBe(true);
        expect(Object.keys(got.body).sort()).toEqual(["code", "issues"]);
        expect(res.body).not.toMatch(/sentinel|12345678/i);
        expect(sent()).toEqual([]);
    });
});

describe("CMRC-1B T4 — D1 POST /customer/order-history: the read and the answer", () => {
    /** The Query the renderer's getCustomerOrders sent before CMRC-1B, for tenant t1 and ana@example.com. */
    const queryOf = (tenant: string, email: string, exclusiveStartKey?: unknown) => ({
        command: "QueryCommand",
        input: {
            TableName: TABLE,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenant}`, ":sk": `CUSTORDER#${email}#` },
            ProjectionExpression: "orderNumber, #total, #s, createdAt, SK",
            ExpressionAttributeNames: { "#s": "status", "#total": "total" },
            ExclusiveStartKey: exclusiveStartKey,
        },
    });
    const row = (tenant: string, email: string, id: string, attributes: Record<string, unknown>) =>
        table.put({ PK: `TENANT#${tenant}`, SK: `CUSTORDER#${email}#${id}`, Type: "CustomerOrder", ...attributes });

    it("sends exactly the Query of before: the customer's index rows of the tenant, the five projected names, reserved words aliased", async () => {
        await orderHistoryHandler(event());
        expect(sent()).toEqual([queryOf("t1", "ana@example.com")]);
    });

    it("the tenant is the x-tenant-id header: another tenant's rows of the same address are not read", async () => {
        row("t1", "ana@example.com", "o-1", { orderNumber: "PPB-0001", total: 1, status: "placed", createdAt: "2026-11-01T00:00:00.000Z" });
        row("t2", "ana@example.com", "o-2", { orderNumber: "OTH-0002", total: 2, status: "placed", createdAt: "2026-11-02T00:00:00.000Z" });
        const got = answerOf(await orderHistoryHandler(event({ tenant: "t2" })));
        expect(got.body.orders.map((o: { orderId: string }) => o.orderId)).toEqual(["o-2"]);
        expect(sent()).toEqual([queryOf("t2", "ana@example.com")]);
    });

    it.each(["Ana@Example.COM", "  ana@example.com  ", "ａｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ"])("%j reads the same key as ana@example.com (normalizeEmail, PD-001)", async (email) => {
        await orderHistoryHandler(event({ body: { email } }));
        expect(sent()).toEqual([queryOf("t1", "ana@example.com")]);
    });

    it.each([
        ["an a@example.com", "an a@example.com"],
        ["a#b@example.com", "a#b@example.com"],
        ["not-an-email", "not-an-email"],
        ["x".repeat(1000), "x".repeat(1000)],
        ["nobody@example.com", "nobody@example.com"],
        [" ", ""],
    ])("input rule: %j matches nothing → 200 { orders: [] }, after the same read (no format check, no length bound)", async (email, normalized) => {
        row("t1", "ana@example.com", "o-1", { orderNumber: "PPB-0001", total: 1, status: "placed", createdAt: "2026-11-01T00:00:00.000Z" });
        expect(answerOf(await orderHistoryHandler(event({ body: { email } })))).toEqual({ status: 200, body: { orders: [] } });
        expect(sent()).toEqual([queryOf("t1", normalized)]);
    });

    it("the rows of ana@example.com are not those of ana@example.com.au", async () => {
        row("t1", "ana@example.com.au", "o-9", { orderNumber: "PPB-0009", total: 9, status: "placed", createdAt: "2026-11-01T00:00:00.000Z" });
        expect(answerOf(await orderHistoryHandler(event())).body).toEqual({ orders: [] });
    });

    it("reads every page; newest createdAt first; equal dates keep the stored (sort-key) order", async () => {
        table.pageSize = 2;
        row("t1", "ana@example.com", "o-1", { orderNumber: "PPB-0001", total: 1, status: "placed", createdAt: "2026-11-01T10:00:00.000Z" });
        row("t1", "ana@example.com", "o-2", { orderNumber: "PPB-0002", total: 2, status: "placed", createdAt: "2026-11-03T10:00:00.000Z" });
        row("t1", "ana@example.com", "o-3", { orderNumber: "PPB-0003", total: 3, status: "placed", createdAt: "2026-11-03T10:00:00.000Z" });
        row("t1", "ana@example.com", "o-4", { orderNumber: "PPB-0004", total: 4, status: "placed", createdAt: "2026-11-02T10:00:00.000Z" });
        row("t1", "ana@example.com", "o-5", { orderNumber: "PPB-0005", total: 5, status: "placed", createdAt: "2026-11-04T10:00:00.000Z" });
        const got = answerOf(await orderHistoryHandler(event()));
        expect(got.body.orders.map((o: { orderId: string }) => o.orderId)).toEqual(["o-5", "o-2", "o-3", "o-4", "o-1"]);
        expect(sent()).toEqual([
            queryOf("t1", "ana@example.com"),
            queryOf("t1", "ana@example.com", { PK: "TENANT#t1", SK: "CUSTORDER#ana@example.com#o-2" }),
            queryOf("t1", "ana@example.com", { PK: "TENANT#t1", SK: "CUSTORDER#ana@example.com#o-4" }),
        ]);
    });

    it("value rule: each stored value unchanged, in the key order orderNumber, total, status, createdAt, orderId; absent stays absent; no other attribute", async () => {
        row("t1", "ana@example.com", "o-1", { orderNumber: "PPB-0001", total: 120.5, status: "placed", createdAt: "2026-11-04T10:00:00.000Z", internalNote: "never in the answer" });
        row("t1", "ana@example.com", "o-2", { orderNumber: "PPB-0002", total: "45.00", status: null, createdAt: "2026-11-03T10:00:00.000Z" });
        row("t1", "ana@example.com", "o-3", { total: 0, createdAt: "2026-11-02T10:00:00.000Z" });
        const res = await orderHistoryHandler(event());
        expect(res.body).toBe(
            '{"orders":[' +
            '{"orderNumber":"PPB-0001","total":120.5,"status":"placed","createdAt":"2026-11-04T10:00:00.000Z","orderId":"o-1"},' +
            '{"orderNumber":"PPB-0002","total":"45.00","status":null,"createdAt":"2026-11-03T10:00:00.000Z","orderId":"o-2"},' +
            '{"total":0,"createdAt":"2026-11-02T10:00:00.000Z","orderId":"o-3"}]}',
        );
    });

    it("the order id is the text after the last '#' of the sort key, also when the email holds '#'", async () => {
        row("t1", "a#b@example.com", "0b1c2d3e-uuid", { createdAt: "2026-11-01T00:00:00.000Z" });
        const got = answerOf(await orderHistoryHandler(event({ body: { email: "a#b@example.com" } })));
        expect(got.body).toEqual({ orders: [{ createdAt: "2026-11-01T00:00:00.000Z", orderId: "0b1c2d3e-uuid" }] });
    });
});

describe("CMRC-1B T4 — D2 POST /customer/profile-read: the read and the answer", () => {
    /** The GetItem the renderer's getCustomerProfile sent before CMRC-1B. */
    const getOf = (tenant: string, email: string) => ({
        command: "GetCommand",
        input: {
            TableName: TABLE,
            Key: { PK: `TENANT#${tenant}`, SK: `CUSTOMER#${email}` },
            ProjectionExpression: "email, #n, phone, birthday, defaultAddress",
            ExpressionAttributeNames: { "#n": "name" },
        },
    });
    const customer = (tenant: string, email: string, attributes: Record<string, unknown>) =>
        table.put({ PK: `TENANT#${tenant}`, SK: `CUSTOMER#${email}`, Type: "Customer", ...attributes });

    it("sends exactly the GetItem of before: the customer's key in the tenant, the five projected names, `name` aliased", async () => {
        await profileReadHandler(event());
        expect(sent()).toEqual([getOf("t1", "ana@example.com")]);
    });

    it("the tenant is the x-tenant-id header: the same address in another tenant is another record", async () => {
        customer("t1", "ana@example.com", { name: "Ana Of T1" });
        customer("t2", "ana@example.com", { name: "Ana Of T2" });
        expect(answerOf(await profileReadHandler(event({ tenant: "t2" }))).body).toEqual({ profile: { name: "Ana Of T2" } });
        expect(sent()).toEqual([getOf("t2", "ana@example.com")]);
    });

    it.each(["Ana@Example.COM", "  ana@example.com  ", "ａｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ"])("%j reads the same key as ana@example.com (normalizeEmail, PD-001)", async (email) => {
        await profileReadHandler(event({ body: { email } }));
        expect(sent()).toEqual([getOf("t1", "ana@example.com")]);
    });

    it.each([
        ["an a@example.com", "an a@example.com"],
        ["a#b@example.com", "a#b@example.com"],
        ["not-an-email", "not-an-email"],
        ["x".repeat(1000), "x".repeat(1000)],
        ["nobody@example.com", "nobody@example.com"],
        [" ", ""],
    ])("input rule: %j matches nothing → 200 { profile: null }, after the same read", async (email, normalized) => {
        customer("t1", "ana@example.com", { name: "Ana Test" });
        expect(answerOf(await profileReadHandler(event({ body: { email } })))).toEqual({ status: 200, body: { profile: null } });
        expect(sent()).toEqual([getOf("t1", normalized)]);
    });

    it("value rule: null stays null, a map stays a map, an empty text stays; attributes outside the projection are not answered", async () => {
        customer("t1", "ana@example.com", {
            email: "ana@example.com", name: "Ana Test", phone: null, birthday: null, defaultAddress: ADDRESS,
            orderCount: 3, totalSpent: 250.5, notes: "staff only", defaultBillingDetails: { companyName: "Never Answered SRL" },
        });
        expect(answerOf(await profileReadHandler(event())).body).toEqual({
            profile: { email: "ana@example.com", name: "Ana Test", phone: null, birthday: null, defaultAddress: ADDRESS },
        });
        customer("t1", "dan@example.com", { name: "Dan Test", phone: "", birthday: "1990-01-31", defaultAddress: null });
        expect(answerOf(await profileReadHandler(event({ body: { email: "dan@example.com" } }))).body).toEqual({
            profile: { name: "Dan Test", phone: "", birthday: "1990-01-31", defaultAddress: null },
        });
    });

    it("a stored record with none of the five attributes → { profile: {} }, not null", async () => {
        customer("t1", "ana@example.com", { orderCount: 1, totalSpent: 10 });
        const res = await profileReadHandler(event());
        expect(res.body).toBe('{"profile":{}}');
    });
});

describe.each(ROUTES)("CMRC-1B T4 — %s: a DynamoDB failure", (route, handler) => {
    it("→ 500 { code: internal }; the log line has the route and the error's NAME only — no message, no email, no body", async () => {
        seam.send = async () => {
            throw Object.assign(new Error("request for sentinel.visitor@example.test on table/main-table-of-the-test failed"), { name: "ProvisionedThroughputExceededException" });
        };
        const res = await handler(event({ body: { email: "sentinel.visitor@example.test" } }));
        expect(answerOf(res)).toEqual({ status: 500, body: { code: "internal" } });
        expect(res.headers).toEqual({ "Content-Type": "application/json", "Cache-Control": "no-store" });
        expect(logs).toEqual([`[customer-self-service] ${route} failed ProvisionedThroughputExceededException`]);
        expect(res.body).not.toContain("sentinel");
    });

    it("a request that succeeds or is refused writes no log line", async () => {
        await handler(event({ body: { email: "sentinel.visitor@example.test" } }));
        await handler(event({ auth: { sub: "anonymous" }, body: { email: "sentinel.visitor@example.test" } }));
        await handler(event({ body: { email: "sentinel.visitor@example.test", extra: 1 } }));
        expect(logs).toEqual([]);
    });
});
