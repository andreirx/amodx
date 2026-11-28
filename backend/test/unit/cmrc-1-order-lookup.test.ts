import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * CMRC-1L, the D3 rows of test T4 (docs/slices/cmrc-1l.md § Proofs; docs/slices/cmrc-1.md § 5.6, § 5.7, § 5.9) —
 * `orderLookupHandler` of `src/customers/self-service.ts`: POST /customer/order-lookup, the read of the order
 * confirmation and tracking pages. The REAL handler over an in-memory table (`memory-table.ts`); `db.js` is the one
 * replaced module. Credential-free. (The two account routes of the same file: `cmrc-1-self-service.test.ts`.)
 *
 * What it proves:
 *  - WHO: the roles RENDERER and GLOBAL_ADMIN pass; every other caller gets 403 and NO DynamoDB command is sent;
 *  - WHICH TENANT: the partition of the command is `TENANT#<x-tenant-id>`;
 *  - INPUT: a body that is not exactly `{ orderId, email }` (two non-empty strings) → 400 with path and message, no
 *    request text in the answer, no command; a value that matches nothing is 404 `notFound`, after the read;
 *  - THE EMAIL RULE: the order is answered only when the stored `customerEmail` is strictly equal to
 *    `normalizeEmail(email)` — the cases the renderer's `getOrderForCustomer` had before CMRC-1L (ORDER-EMAIL-1),
 *    among them a stored email that is not in normalized form;
 *  - ONE "not found": no order, another tenant's order and an unequal email give the SAME answer, byte for byte;
 *  - THE ANSWER: exactly the 17 `OrderView` fields that the stored item has — never `customerEmail`, `internalNotes`,
 *    `billingDetails`, `PK`, `SK` — each value unchanged; absent stays absent; `null` stays `null`;
 *  - FAILURE: a DynamoDB error → 500 `{ code: "internal" }`; the log line has the route and the error's name only.
 *
 * What it does not prove: the real DynamoDB (the table is a test double: it honours the projection as written); the
 * authorizer (`cmrc-1-self-service-auth.test.ts`); what the renderer sends (renderer tests).
 */

const seam = vi.hoisted(() => ({ send: async (_command: unknown): Promise<unknown> => { throw new Error("the table is not ready"); } }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (command: unknown) => seam.send(command) }, TABLE_NAME: "main-table-of-the-test" }));

import { MemoryTable } from "./memory-table.js";
import { DYNAMO_RESERVED_WORDS } from "../../src/lib/dynamo-reserved-words.js";
import { orderLookupHandler } from "../../src/customers/self-service.js";

const TABLE = "main-table-of-the-test";
const ROUTE = "POST /customer/order-lookup";
const RENDERER = { sub: "renderer", role: "RENDERER", tenantId: "ALL" };
const NOT_FOUND = { status: 404, body: { code: "notFound" } };

/** The 17 fields, written here as an independent statement of the list (docs/slices/cmrc-1.md § 5.6). */
const VIEW_FIELDS = ["id", "orderNumber", "createdAt", "currency", "customerName", "customerPhone", "discount", "estimatedDeliveryDate", "items",
    "paymentMethod", "shippingAddress", "shippingCost", "status", "statusHistory", "subtotal", "total", "trackingNumber"];
const PROJECTED = [...VIEW_FIELDS, "customerEmail"];

/** An API gateway event: `auth` is what the authorizer passed; `body` is sent as given when it is a string. */
const event = (parts: { auth?: unknown; tenant?: string | null; body?: unknown } = {}): never => ({
    headers: { "content-type": "application/json", ...(parts.tenant === null ? {} : { "x-tenant-id": parts.tenant ?? "t1" }) },
    body: parts.body === undefined ? JSON.stringify({ orderId: "o-1", email: "ana@example.com" }) : typeof parts.body === "string" ? parts.body : JSON.stringify(parts.body),
    requestContext: { authorizer: { lambda: "auth" in parts ? parts.auth : RENDERER } },
}) as never;

const answerOf = (res: Awaited<ReturnType<typeof orderLookupHandler>>) => ({ status: res.statusCode, body: JSON.parse(res.body as string) });

/** The GetItem of D3 for one tenant and order id: the key, the 18 projected names, every name aliased. */
const getOf = (tenant: string, orderId: string) => ({
    command: "GetCommand",
    input: {
        TableName: TABLE,
        Key: { PK: `TENANT#${tenant}`, SK: `ORDER#${orderId}` },
        ProjectionExpression: PROJECTED.map((name) => `#${name}`).join(", "),
        ExpressionAttributeNames: Object.fromEntries(PROJECTED.map((name) => [`#${name}`, name])),
    },
});

const ADDRESS = { street: "1 Test Street", city: "Testville", county: "Test County", postalCode: "000000", country: "RO" };
/** What an order page shows of a stored order. */
const VIEW = {
    id: "o-1", orderNumber: "PPB-0001", createdAt: "2026-11-01T10:00:00.000Z", currency: "RON", customerName: "Ana Test", customerPhone: null,
    items: [{ productId: "p-1", productTitle: "Oak Plank", quantity: 2, unitPrice: "80.00", totalPrice: 160, selectedVariant: null, personalizations: [], imageLink: null }],
    paymentMethod: null, shippingAddress: null, shippingCost: 0, status: "placed",
    statusHistory: [{ status: "placed", timestamp: "2026-11-01T10:00:00.000Z", note: "Order placed" }, { status: "confirmed", timestamp: "2026-11-02T10:00:00.000Z", note: null }],
    subtotal: 160, total: 160,
};
/** Attributes of a stored order that the route never answers. */
const NEVER_ANSWERED = {
    Type: "Order", tenantId: "t1", updatedAt: "2026-11-02T10:00:00.000Z", internalNotes: "staff only", couponCode: "TEN", couponId: "c-1", couponDiscount: 5,
    billingDetails: { companyName: "Never Answered SRL" }, requestedDeliveryDate: "2026-11-09", deliveryNotes: "ring twice",
};

let table: MemoryTable;
let logs: string[];
const sent = () => table.commands.map((c) => ({ command: c.constructor.name, input: c.input }));
const store = (tenant: string, orderId: string, attributes: Record<string, unknown>) =>
    table.put({ PK: `TENANT#${tenant}`, SK: `ORDER#${orderId}`, ...attributes });

beforeEach(() => {
    table = new MemoryTable();
    seam.send = (command) => table.send(command);
    store("t1", "o-1", { ...VIEW, ...NEVER_ANSWERED, customerEmail: "ana@example.com" });
    logs = [];
    for (const method of ["log", "warn", "error"] as const) {
        vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => { logs.push(parts.map(String).join(" ")); });
    }
});
afterEach(() => vi.restoreAllMocks());

describe(`CMRC-1L T4 — ${ROUTE}: who may call`, () => {
    it.each([
        ["the renderer key", RENDERER],
        ["the master key (GLOBAL_ADMIN, which requireRole always admits)", { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" }],
    ])("%s → 200 with the order", async (_name, auth) => {
        expect(answerOf(await orderLookupHandler(event({ auth })))).toEqual({ status: 200, body: { order: VIEW } });
        expect(sent()).toHaveLength(1);
    });

    it.each([
        ["a tenant admin of the same tenant", { sub: "u1", role: "TENANT_ADMIN", tenantId: "t1" }],
        ["an editor of the same tenant", { sub: "u2", role: "EDITOR", tenantId: "t1" }],
        ["the signed-in customer who placed the order", { sub: "u3", role: "CUSTOMER", tenantId: "t1", email: "ana@example.com" }],
        ["a service key of the same tenant", { sub: "k1", role: "SERVICE", tenantId: "t1", scopes: "catalog:read,leads:read", keyId: "k1" }],
        ["a caller without a role (treated as EDITOR)", { sub: "u4", tenantId: "t1" }],
        ["an anonymous caller", { sub: "anonymous" }],
        ["a role written in another letter case", { sub: "renderer", role: "renderer", tenantId: "ALL" }],
        ["no authorizer context", undefined],
    ])("%s → 403 forbidden, and nothing is read", async (_name, auth) => {
        expect(answerOf(await orderLookupHandler(event({ auth })))).toEqual({ status: 403, body: { code: "forbidden" } });
        expect(sent()).toEqual([]);
    });

    it("a refused caller learns nothing about the request: a malformed body and a missing tenant are still 403", async () => {
        const res = await orderLookupHandler(event({ auth: { sub: "u1", role: "TENANT_ADMIN", tenantId: "t1" }, tenant: null, body: "{not json" }));
        expect(answerOf(res)).toEqual({ status: 403, body: { code: "forbidden" } });
        expect(sent()).toEqual([]);
    });

    it("the answer is never stored: Cache-Control no-store, JSON — for 200, 404, 403 and 400", async () => {
        const answers = [
            await orderLookupHandler(event()),
            await orderLookupHandler(event({ body: { orderId: "o-none", email: "ana@example.com" } })),
            await orderLookupHandler(event({ auth: { sub: "anonymous" } })),
            await orderLookupHandler(event({ body: {} })),
        ];
        expect(answers.map((a) => a.statusCode)).toEqual([200, 404, 403, 400]);
        for (const res of answers) expect(res.headers).toEqual({ "Content-Type": "application/json", "Cache-Control": "no-store" });
    });
});

describe(`CMRC-1L T4 — ${ROUTE}: the request structure (a failure here is a renderer defect)`, () => {
    it("no x-tenant-id → 400 missingTenant, and nothing is read", async () => {
        expect(answerOf(await orderLookupHandler(event({ tenant: null })))).toEqual({ status: 400, body: { code: "missingTenant" } });
        expect(answerOf(await orderLookupHandler(event({ tenant: "" })))).toEqual({ status: 400, body: { code: "missingTenant" } });
        expect(sent()).toEqual([]);
    });

    it("no body, or a body that is not JSON → 400 malformedRequest; the body's text is not in the answer", async () => {
        const noBody = await orderLookupHandler({ headers: { "x-tenant-id": "t1" }, requestContext: { authorizer: { lambda: RENDERER } } } as never);
        expect(answerOf(noBody)).toEqual({ status: 400, body: { code: "malformedRequest", issues: [{ path: "", message: "The body is not JSON." }] } });
        const notJson = await orderLookupHandler(event({ body: '{"orderId":"sentinel-order","email":"sentinel.visitor@example.test",' }));
        expect(answerOf(notJson)).toEqual({ status: 400, body: { code: "malformedRequest", issues: [{ path: "", message: "The body is not JSON." }] } });
        expect(notJson.body).not.toContain("sentinel");
        expect(sent()).toEqual([]);
    });

    it.each([
        ["both fields absent", {}, ["orderId", "email"]],
        ["the order id absent (the body of the two account routes)", { email: "sentinel@example.test" }, ["orderId"]],
        ["the email absent", { orderId: "sentinel-order" }, ["email"]],
        ["an empty order id", { orderId: "", email: "sentinel@example.test" }, ["orderId"]],
        ["an empty email", { orderId: "sentinel-order", email: "" }, ["email"]],
        ["a number as the order id", { orderId: 12345678, email: "sentinel@example.test" }, ["orderId"]],
        ["null as the email", { orderId: "sentinel-order", email: null }, ["email"]],
        ["a list as the email", { orderId: "sentinel-order", email: ["sentinel@example.test"] }, ["email"]],
        ["an object as the order id", { orderId: { id: "sentinel-order" }, email: "sentinel@example.test" }, ["orderId"]],
        ["an extra field", { orderId: "o-1", email: "ana@example.com", sentinelField: "sentinel-value" }, [""]],
        ["an extra tenant id", { orderId: "o-1", email: "ana@example.com", tenantId: "sentinel-tenant" }, [""]],
        ["JSON that is a string", JSON.stringify("sentinel-order"), [""]],
        ["JSON that is a list", [{ orderId: "sentinel-order", email: "sentinel@example.test" }], [""]],
        ["JSON null", "null", [""]],
    ])("%s → 400 malformedRequest with the path; no request text in the answer; nothing is read", async (_name, body, paths) => {
        const res = await orderLookupHandler(event({ body }));
        const got = answerOf(res);
        expect(got.status).toBe(400);
        expect(got.body.code).toBe("malformedRequest");
        expect(got.body.issues.map((i: { path: string }) => i.path)).toEqual(paths);
        expect(got.body.issues.every((i: { message: unknown }) => typeof i.message === "string" && i.message !== "")).toBe(true);
        expect(Object.keys(got.body).sort()).toEqual(["code", "issues"]);
        expect(res.body).not.toMatch(/sentinel|12345678/i);
        expect(sent()).toEqual([]);
    });
});

describe(`CMRC-1L T4 — ${ROUTE}: the read`, () => {
    it("sends exactly one GetItem: the order's key in the tenant, the 17 view fields and customerEmail, EVERY name aliased", async () => {
        await orderLookupHandler(event());
        expect(sent()).toEqual([getOf("t1", "o-1")]);
    });

    it("no bare name is in the projection, so no reserved word can be (items, status and total are reserved)", async () => {
        await orderLookupHandler(event());
        const { ProjectionExpression, ExpressionAttributeNames } = sent()[0].input;
        expect(ProjectionExpression.split(", ").every((token: string) => token.startsWith("#"))).toBe(true);
        expect(Object.values(ExpressionAttributeNames)).toEqual(PROJECTED);
        // The control of this row: the list does hold reserved words, so an unaliased projection would be refused.
        expect(PROJECTED.filter((name) => DYNAMO_RESERVED_WORDS.has(name.toUpperCase()))).toEqual(["items", "status", "total"]);
    });

    it("the tenant is the x-tenant-id header: the same order id under another tenant is another item", async () => {
        store("t2", "o-1", { id: "o-1", orderNumber: "OTH-0001", customerEmail: "ana@example.com" });
        expect(answerOf(await orderLookupHandler(event({ tenant: "t2" }))).body).toEqual({ order: { id: "o-1", orderNumber: "OTH-0001" } });
        expect(sent()).toEqual([getOf("t2", "o-1")]);
    });

    it("the order id is used as given (no trim, no case change): ' o-1 ' and 'O-1' are other keys", async () => {
        expect(answerOf(await orderLookupHandler(event({ body: { orderId: " o-1 ", email: "ana@example.com" } })))).toEqual(NOT_FOUND);
        expect(answerOf(await orderLookupHandler(event({ body: { orderId: "O-1", email: "ana@example.com" } })))).toEqual(NOT_FOUND);
        expect(sent()).toEqual([getOf("t1", " o-1 "), getOf("t1", "O-1")]);
    });
});

describe(`CMRC-1L T4 — ${ROUTE}: the email rule (exactly the renderer read it replaces; ORDER-EMAIL-1)`, () => {
    it.each(["ana@example.com", "Ana@Example.com", "ANA@EXAMPLE.COM", " ana@example.com ", "\tAna@Example.com\n", "ana＠example.com", "Ａna@Example.com", "ａｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ"])(
        "%j is the stored ana@example.com after normalizeEmail → the order", async (email) => {
            expect(answerOf(await orderLookupHandler(event({ body: { orderId: "o-1", email } })))).toEqual({ status: 200, body: { order: VIEW } });
            expect(sent()).toEqual([getOf("t1", "o-1")]);
        });

    it.each(["other@example.com", "Other@Example.com", "ana@example.co", "ana@example.com.au", "an a@example.com", "a#b@example.com", "not-an-email", " ", "x".repeat(1000)])(
        "%j is not the stored email → 404 notFound, after the same read (no format check, no length bound)", async (email) => {
            expect(answerOf(await orderLookupHandler(event({ body: { orderId: "o-1", email } })))).toEqual(NOT_FOUND);
            expect(sent()).toEqual([getOf("t1", "o-1")]);
        });

    it("a stored email that is not in normalized form is reached by NO request: only the request side is normalized", async () => {
        store("t1", "o-caps", { id: "o-caps", customerEmail: "Ana@Example.com" });
        store("t1", "o-space", { id: "o-space", customerEmail: " ana@example.com " });
        for (const [orderId, email] of [["o-caps", "Ana@Example.com"], ["o-caps", "ana@example.com"], ["o-space", " ana@example.com "], ["o-space", "ana@example.com"]]) {
            expect(answerOf(await orderLookupHandler(event({ body: { orderId, email } }))), `${orderId} ${JSON.stringify(email)}`).toEqual(NOT_FOUND);
        }
    });

    it("a stored order without customerEmail, or with one that is not text, is reached by no request", async () => {
        store("t1", "o-none", { id: "o-none", orderNumber: "PPB-0009" });
        store("t1", "o-null", { id: "o-null", customerEmail: null });
        store("t1", "o-list", { id: "o-list", customerEmail: ["ana@example.com"] });
        for (const orderId of ["o-none", "o-null", "o-list"]) {
            expect(answerOf(await orderLookupHandler(event({ body: { orderId, email: "ana@example.com" } }))), orderId).toEqual(NOT_FOUND);
        }
    });
});

describe(`CMRC-1L T4 — ${ROUTE}: ONE "not found"`, () => {
    it("no such order, another tenant's order, an unequal email, a malformed email and an order id with '#' give the same answer, byte for byte", async () => {
        store("t2", "o-foreign", { id: "o-foreign", customerEmail: "ana@example.com" });
        const requests: [string, { orderId: string; email: string }][] = [
            ["no such order", { orderId: "o-none", email: "ana@example.com" }],
            ["another tenant's order (asked on t1)", { orderId: "o-foreign", email: "ana@example.com" }],
            ["an unequal email", { orderId: "o-1", email: "bob@example.com" }],
            ["a malformed email", { orderId: "o-1", email: "an a@example.com" }],
            ["an order id with '#'", { orderId: "o-1#x", email: "ana@example.com" }],
            ["an order id that names another key family", { orderId: "x#CUSTOMER", email: "ana@example.com" }],
        ];
        const answers = [];
        for (const [, body] of requests) answers.push(await orderLookupHandler(event({ body })));
        expect(answers.map((a) => a.statusCode)).toEqual(requests.map(() => 404));
        expect(new Set(answers.map((a) => a.body))).toEqual(new Set(['{"code":"notFound"}']));
        expect(new Set(answers.map((a) => JSON.stringify(a.headers))).size).toBe(1);
        // Each is ONE GetItem on the key built from the request as given, in the caller's tenant.
        expect(sent()).toEqual(requests.map(([, body]) => getOf("t1", body.orderId)));
        expect(logs).toEqual([]);
    });
});

describe(`CMRC-1L T4 — ${ROUTE}: the answer`, () => {
    it("exactly the view fields the stored item has, in the list's order — never customerEmail, internalNotes, billingDetails, coupon, PK, SK", async () => {
        const res = await orderLookupHandler(event());
        const { order } = JSON.parse(res.body as string);
        expect(Object.keys(order)).toEqual(VIEW_FIELDS.filter((field) => field in VIEW));
        for (const attribute of ["customerEmail", "PK", "SK", ...Object.keys(NEVER_ANSWERED)]) expect(order).not.toHaveProperty(attribute);
        expect(res.body).not.toMatch(/ana@example\.com|staff only|Never Answered|ring twice|TENANT#/);
    });

    it("value rule: null stays null (phone, payment method, address, a history note, a variant, an image); numbers and text stay as stored; absent stays absent", async () => {
        const { order } = answerOf(await orderLookupHandler(event())).body;
        expect(order).toEqual(VIEW);
        for (const absent of ["trackingNumber", "discount", "estimatedDeliveryDate"]) expect(order).not.toHaveProperty(absent);
        expect([order.customerPhone, order.paymentMethod, order.shippingAddress, order.statusHistory[1].note, order.items[0].selectedVariant, order.items[0].imageLink])
            .toEqual([null, null, null, null, null, null]);
        expect([order.subtotal, order.total, order.shippingCost, order.items[0].totalPrice, order.items[0].unitPrice]).toEqual([160, 160, 0, 160, "80.00"]);
    });

    it("every one of the 17 fields is answered when stored — also amounts stored as text and admin-written values of any JSON type", async () => {
        const full = {
            ...VIEW, customerPhone: "+40 700 000 000", discount: "5.00", estimatedDeliveryDate: { from: "2026-11-05", to: "2026-11-07" }, paymentMethod: "cash_on_delivery",
            shippingAddress: ADDRESS, shippingCost: "10.00", subtotal: "85.00", total: "90.00", trackingNumber: 123456,
        };
        store("t1", "o-full", { ...full, ...NEVER_ANSWERED, id: "o-full", customerEmail: "ana@example.com" });
        const { order } = answerOf(await orderLookupHandler(event({ body: { orderId: "o-full", email: "ana@example.com" } }))).body;
        expect(order).toEqual({ ...full, id: "o-full" });
        expect(Object.keys(order)).toEqual(VIEW_FIELDS);
    });

    it("an order with none of the 17 fields → { order: {} }, a 200 (the page then renders its order view with nothing in it, as before)", async () => {
        store("t1", "o-bare", { customerEmail: "ana@example.com", internalNotes: "staff only" });
        const res = await orderLookupHandler(event({ body: { orderId: "o-bare", email: "ana@example.com" } }));
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe('{"order":{}}');
    });

    it("the answer does not depend on the projection being honoured: a table that returns the WHOLE item still gives the 17 fields only", async () => {
        seam.send = async () => ({ Item: { PK: "TENANT#t1", SK: "ORDER#o-1", ...VIEW, ...NEVER_ANSWERED, customerEmail: "ana@example.com" } });
        const res = await orderLookupHandler(event());
        expect(answerOf(res)).toEqual({ status: 200, body: { order: VIEW } });
        expect(res.body).not.toMatch(/staff only|Never Answered|ana@example\.com|TENANT#/);
    });
});

describe(`CMRC-1L T4 — ${ROUTE}: a DynamoDB failure`, () => {
    it("→ 500 { code: internal }; the log line has the route and the error's NAME only — no message, no email, no order id", async () => {
        seam.send = async () => {
            throw Object.assign(new Error("request for sentinel-order of sentinel.visitor@example.test on table/main-table-of-the-test failed"), { name: "ProvisionedThroughputExceededException" });
        };
        const res = await orderLookupHandler(event({ body: { orderId: "sentinel-order", email: "sentinel.visitor@example.test" } }));
        expect(answerOf(res)).toEqual({ status: 500, body: { code: "internal" } });
        expect(res.headers).toEqual({ "Content-Type": "application/json", "Cache-Control": "no-store" });
        expect(logs).toEqual([`[customer-self-service] ${ROUTE} failed ProvisionedThroughputExceededException`]);
        expect(res.body).not.toContain("sentinel");
    });

    it("a request that succeeds, is not found or is refused writes no log line", async () => {
        await orderLookupHandler(event());
        await orderLookupHandler(event({ body: { orderId: "sentinel-order", email: "sentinel.visitor@example.test" } }));
        await orderLookupHandler(event({ auth: { sub: "anonymous" }, body: { orderId: "sentinel-order", email: "sentinel.visitor@example.test" } }));
        await orderLookupHandler(event({ body: { orderId: "sentinel-order", email: "sentinel.visitor@example.test", extra: 1 } }));
        expect(logs).toEqual([]);
    });
});
