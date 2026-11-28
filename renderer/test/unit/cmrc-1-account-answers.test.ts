import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * CMRC-1B, requirement C5 (docs/slices/cmrc-1b.md § V1, § Proofs; docs/slices/cmrc-1.md § 5.2, § 5.6 "Input rule") —
 * WHAT THE TWO ACCOUNT ROUTES ANSWER, for every input class: `GET /api/account/orders` and `GET /api/profile`, status
 * and JSON body, from STORED ITEMS and a SESSION.
 *
 * This file was written and run on the code BEFORE cmrc-1b (the routes read DynamoDB themselves) and it passes,
 * unchanged, on the code AFTER it (the routes ask the backend). It can do that because it stands below both
 * transports:
 *
 *   stored items (one in-memory table)  ──►  the real route  ──►  status + body
 *
 *   before:  route → renderer DynamoDB document client ─────────────────────────────► the table
 *   after:   route → customer-api → callBackend → fetch → LOCAL BACKEND (below) ────► the table
 *
 * LOCAL BACKEND = the `fetch` stub of this file. It does what the API gateway does for one request: it refuses a call
 * without the renderer key (a STAND-IN for the authorizer: the real authorizer on the two route keys is proven in
 * backend/test/unit/cmrc-1-self-service.test.ts), finds the handler of the route, calls the REAL handler of
 * `backend/src/customers/self-service.ts` with the role `RENDERER`, and returns its answer. The handler's DynamoDB
 * client is the same in-memory table. On the code before cmrc-1b nothing calls `fetch`, so the stub is not reached and
 * the handler file is not loaded.
 *
 * Replaced at the module boundary, and nothing else: the DynamoDB document client (both the renderer's and the
 * backend's are made by `DynamoDBDocumentClient.from`, one hoisted SDK copy), the tenant lookup by host
 * (`getTenantConfig`), and the session (`getServerSession`). The session is the ONLY source of the customer's email.
 *
 * What this file does not prove: what the real DynamoDB answers (the table is `backend/test/unit/memory-table.ts`);
 * the real authorizer; the infrastructure. It asserts nothing about the transport — a test that names the transport
 * could not pass on both sides of the change (the transport is `cmrc-1-customer-api.test.ts`).
 */

const seam = vi.hoisted(() => ({
    send: async (_command: unknown): Promise<unknown> => { throw new Error("the table is not ready"); },
    session: null as null | { user?: { email?: string | null } },
}));

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    DynamoDBDocumentClient: { from: () => ({ send: (command: unknown) => seam.send(command) }) },
}));
vi.mock("next-auth", () => ({ getServerSession: async () => seam.session }));
vi.mock("next-auth/providers/google", () => ({ default: (options: Record<string, unknown>) => ({ id: "google", ...options }) }));

const TENANT_BY_HOST: Record<string, { id: string }> = {
    "shop.example.test": { id: "tenant-shop" },
    "other.example.test": { id: "tenant-other" },
};
vi.mock("@/lib/dynamo", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getTenantConfig: async (host: string) => TENANT_BY_HOST[host] ?? null,
}));

import { fileURLToPath } from "node:url";
import { MemoryTable } from "../../../backend/test/unit/memory-table";
import { GET as getOrders } from "@/app/api/account/orders/route";
import { GET as getProfile } from "@/app/api/profile/route";

const RENDERER_KEY = "renderer-key-of-this-test";
/**
 * The handler file, loaded only when `fetch` is called (it does not exist before cmrc-1b). An absolute path built from
 * this file's place: the test runner resolves a computed import path against the project root, not against this file.
 */
const BACKEND_HANDLERS = fileURLToPath(new URL("../../../backend/src/customers/self-service.ts", import.meta.url));
const ROUTE_HANDLER: Record<string, string> = {
    "POST /customer/order-history": "orderHistoryHandler",
    "POST /customer/profile-read": "profileReadHandler",
};

let table: MemoryTable;

/** One request as the API gateway handles it: credential → route → the real handler → its answer. */
async function localBackend(url: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const headers = Object.fromEntries(Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    if (headers["x-api-key"] !== RENDERER_KEY) return new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 });
    const handlerName = ROUTE_HANDLER[`${init.method ?? "GET"} ${new URL(String(url)).pathname}`];
    if (handlerName === undefined) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    const handlers = await import(/* @vite-ignore */ BACKEND_HANDLERS);
    const answer = await handlers[handlerName]({
        headers,
        body: init.body,
        requestContext: { authorizer: { lambda: { sub: "renderer", role: "RENDERER", tenantId: "ALL" } } },
    });
    return new Response(answer.body, { status: answer.statusCode, headers: answer.headers });
}

const SHOP = "TENANT#tenant-shop";
const OTHER = "TENANT#tenant-other";
const ADDRESS = { street: "1 Test Street", city: "Testville", county: "Test County", postalCode: "000000", country: "RO" };

beforeEach(() => {
    process.env.TABLE_NAME = "cmrc-1b-unit";
    process.env.API_URL = "https://backend.example.test";
    process.env.AMODX_API_KEY = RENDERER_KEY;
    delete process.env.AMODX_API_KEY_SECRET;

    table = new MemoryTable();
    table.pageSize = 2;   // four rows of one customer → two Query pages
    seam.send = (command) => table.send(command);
    seam.session = null;

    // The email → order rows as `orders/create.ts` writes them (orderNumber, total, status, createdAt, Type). Stored
    // out of date order on purpose; `o-2` and `o-3` have the same `createdAt`; `o-4` has no `orderNumber`; `o-3` has
    // its total as text (an older shape).
    for (const row of [
        { SK: "CUSTORDER#ana@example.com#o-1", orderNumber: "PPB-0001", total: 120.5, status: "placed", createdAt: "2026-11-01T10:00:00.000Z" },
        { SK: "CUSTORDER#ana@example.com#o-2", orderNumber: "PPB-0002", total: 80, status: "placed", createdAt: "2026-11-03T10:00:00.000Z" },
        { SK: "CUSTORDER#ana@example.com#o-3", orderNumber: "PPB-0003", total: "45.00", status: "placed", createdAt: "2026-11-03T10:00:00.000Z" },
        { SK: "CUSTORDER#ana@example.com#o-4", total: 10, status: "placed", createdAt: "2026-11-02T10:00:00.000Z" },
        { SK: "CUSTORDER#bob@example.com#o-9", orderNumber: "PPB-0009", total: 999, status: "placed", createdAt: "2026-11-04T10:00:00.000Z" },
    ]) table.put({ PK: SHOP, Type: "CustomerOrder", ...row });
    // The same address is a customer of another tenant too: never listed on the shop's host.
    table.put({ PK: OTHER, SK: "CUSTORDER#ana@example.com#o-77", Type: "CustomerOrder", orderNumber: "OTH-0077", total: 7, status: "placed", createdAt: "2026-11-05T10:00:00.000Z" });

    // Profiles. `ana`: every projected attribute and some that are not projected. `bob`: a record as the checkout
    // creates it for a guest without phone or address, reduced here to attributes outside the projection.
    table.put({ PK: SHOP, SK: "CUSTOMER#ana@example.com", Type: "Customer", email: "ana@example.com", name: "Ana Test", phone: null, birthday: null, defaultAddress: ADDRESS, orderCount: 4, totalSpent: 255.5, notes: "staff only" });
    table.put({ PK: SHOP, SK: "CUSTOMER#bob@example.com", Type: "Customer", orderCount: 1, totalSpent: 999 });
    table.put({ PK: SHOP, SK: "CUSTOMER#dan@example.com", Type: "Customer", name: "Dan Test", phone: "", birthday: "1990-01-31", defaultAddress: null });
    table.put({ PK: OTHER, SK: "CUSTOMER#ana@example.com", Type: "Customer", name: "Ana Of The Other Tenant", phone: "0000" });

    vi.stubGlobal("fetch", vi.fn(localBackend));
    for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.TABLE_NAME;
    delete process.env.API_URL;
    delete process.env.AMODX_API_KEY;
});

/** A browser request to a route of `host`. `extra` = what else the browser sends. */
const browser = (host: string, path: string, extra: { headers?: Record<string, string>; body?: unknown } = {}) => ({
    method: "GET",
    url: `https://${host}${path}`,
    nextUrl: new URL(`https://${host}${path}`),
    headers: new Headers({ host, ...extra.headers }),
    json: async () => extra.body,
    text: async () => JSON.stringify(extra.body ?? ""),
}) as never;

const signedIn = (email: string | null | undefined) => { seam.session = { user: { email } }; };
const answerOf = async (res: Response) => ({ status: res.status, text: await res.text() });

const ANA_ORDERS =
    '[{"orderNumber":"PPB-0002","total":80,"status":"placed","createdAt":"2026-11-03T10:00:00.000Z","orderId":"o-2"},' +
    '{"orderNumber":"PPB-0003","total":"45.00","status":"placed","createdAt":"2026-11-03T10:00:00.000Z","orderId":"o-3"},' +
    '{"total":10,"status":"placed","createdAt":"2026-11-02T10:00:00.000Z","orderId":"o-4"},' +
    '{"orderNumber":"PPB-0001","total":120.5,"status":"placed","createdAt":"2026-11-01T10:00:00.000Z","orderId":"o-1"}]';

describe("GET /api/account/orders — the answer for every input class", () => {
    it("a host without a tenant record → 404 Tenant not found", async () => {
        signedIn("ana@example.com");
        expect(await answerOf(await getOrders(browser("nobody.example.test", "/api/account/orders"))))
            .toEqual({ status: 404, text: '{"error":"Tenant not found"}' });
    });

    it.each([
        ["no session", () => { seam.session = null; }],
        ["a session without a user", () => { seam.session = {}; }],
        ["a session without an email", () => signedIn(undefined)],
        ["a session whose email is null", () => signedIn(null)],
        ["a session whose email is empty", () => signedIn("")],
    ])("an anonymous visitor (%s) → 401, and no item of a customer is read", async (_name, arrange) => {
        arrange();
        expect(await answerOf(await getOrders(browser("shop.example.test", "/api/account/orders"))))
            .toEqual({ status: 401, text: '{"error":"Unauthorized - please sign in"}' });
        expect(table.commands).toEqual([]);
    });

    it("a signed-in customer with no order → 200, an empty list and the session's email", async () => {
        signedIn("carla@example.com");
        expect(await answerOf(await getOrders(browser("shop.example.test", "/api/account/orders"))))
            .toEqual({ status: 200, text: '{"orders":[],"email":"carla@example.com"}' });
    });

    it("a customer with orders → 200: every page, newest first, equal dates in stored order, each stored value as it is, an absent attribute absent", async () => {
        signedIn("ana@example.com");
        expect(await answerOf(await getOrders(browser("shop.example.test", "/api/account/orders"))))
            .toEqual({ status: 200, text: `{"orders":${ANA_ORDERS},"email":"ana@example.com"}` });
    });

    it.each(["Ana@Example.COM", "  ana@example.com  ", "ａｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ"])(
        "the session's email in another form (%j) reads the same rows; the answer carries the session's own text", async (email) => {
            signedIn(email);
            expect(await answerOf(await getOrders(browser("shop.example.test", "/api/account/orders"))))
                .toEqual({ status: 200, text: `{"orders":${ANA_ORDERS},"email":${JSON.stringify(email)}}` });
        });

    it.each(["an a@example.com", "a#b@example.com", "ana@example.com#o-1", "not-an-email", "x".repeat(1000), " "])(
        "an email that matches no stored row (%j) is 'nothing found', not an error", async (email) => {
            signedIn(email);
            expect(await answerOf(await getOrders(browser("shop.example.test", "/api/account/orders"))))
                .toEqual({ status: 200, text: `{"orders":[],"email":${JSON.stringify(email)}}` });
        });

    it("the tenant is the host's: the same address on the other tenant's host gets that tenant's rows only", async () => {
        signedIn("ana@example.com");
        expect(await answerOf(await getOrders(browser("other.example.test", "/api/account/orders")))).toEqual({
            status: 200,
            text: '{"orders":[{"orderNumber":"OTH-0077","total":7,"status":"placed","createdAt":"2026-11-05T10:00:00.000Z","orderId":"o-77"}],"email":"ana@example.com"}',
        });
    });

    it("nothing the BROWSER sends selects the customer or the tenant: ?email=, a body, x-tenant-id, x-api-key are not read", async () => {
        signedIn("carla@example.com");   // carla has no order; bob and ana have
        const res = await getOrders(browser("shop.example.test", "/api/account/orders?email=bob@example.com&tenantId=tenant-other", {
            headers: { "x-tenant-id": "tenant-other", "x-api-key": "a-key-from-the-browser", "x-customer-email": "bob@example.com" },
            body: { email: "bob@example.com", tenantId: "tenant-other" },
        }));
        expect(await answerOf(res)).toEqual({ status: 200, text: '{"orders":[],"email":"carla@example.com"}' });
        // Every read that was made is in the shop's partition and under carla's key.
        const keysRead = table.commands.map((c) => JSON.stringify(c.input));
        expect(keysRead.length).toBeGreaterThan(0);
        for (const input of keysRead) {
            expect(input).toContain("TENANT#tenant-shop");
            expect(input).toContain("carla@example.com");
            expect(input).not.toContain("bob@example.com");
            expect(input).not.toContain("tenant-other");
        }
    });

    it("the read fails → 500 Failed to fetch orders (not an empty list)", async () => {
        signedIn("ana@example.com");
        table.failOn = () => true;
        expect(await answerOf(await getOrders(browser("shop.example.test", "/api/account/orders"))))
            .toEqual({ status: 500, text: '{"error":"Failed to fetch orders"}' });
    });
});

describe("GET /api/profile — the answer for every input class", () => {
    const profileOf = async (host: string, path = "/api/profile", extra = {}) => {
        const res = await getProfile(browser(host, path, extra));
        return { status: res.status, body: JSON.parse(await res.text()) };
    };

    it("a host without a tenant record → 404 Tenant not found", async () => {
        signedIn("ana@example.com");
        expect(await profileOf("nobody.example.test")).toEqual({ status: 404, body: { error: "Tenant not found" } });
    });

    it.each([
        ["no session", () => { seam.session = null; }],
        ["a session without an email", () => signedIn(undefined)],
        ["a session whose email is empty", () => signedIn("")],
    ])("an anonymous visitor (%s) → 401, and no item of a customer is read", async (_name, arrange) => {
        arrange();
        expect(await profileOf("shop.example.test")).toEqual({ status: 401, body: { error: "Unauthorized - please sign in" } });
        expect(table.commands).toEqual([]);
    });

    it("a signed-in customer without a stored record → 200 { email: the session's email }", async () => {
        signedIn("Carla@Example.com");
        expect(await profileOf("shop.example.test")).toEqual({ status: 200, body: { email: "Carla@Example.com" } });
    });

    // The key order of a stored item is whatever DynamoDB returns; the profile is compared by value, not by text.
    it("a stored record → 200: exactly its attributes among email, name, phone, birthday, defaultAddress; null stays null; nothing else", async () => {
        signedIn("ana@example.com");
        expect(await profileOf("shop.example.test")).toEqual({
            status: 200,
            body: { email: "ana@example.com", name: "Ana Test", phone: null, birthday: null, defaultAddress: ADDRESS },
        });
    });

    it("a record with an empty phone, a birthday and a null address → passed as stored; no email attribute → none in the answer", async () => {
        signedIn("dan@example.com");
        expect(await profileOf("shop.example.test")).toEqual({
            status: 200,
            body: { name: "Dan Test", phone: "", birthday: "1990-01-31", defaultAddress: null },
        });
    });

    it("a stored record with none of the five attributes → 200 {} (not { email })", async () => {
        signedIn("bob@example.com");
        expect(await profileOf("shop.example.test")).toEqual({ status: 200, body: {} });
    });

    it.each(["ANA@example.com", " ana@example.com ", "ａｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ"])("the session's email in another form (%j) reads the same record", async (email) => {
        signedIn(email);
        expect((await profileOf("shop.example.test")).body).toMatchObject({ name: "Ana Test", email: "ana@example.com" });
    });

    it.each(["an a@example.com", "a#b@example.com", "not-an-email", "x".repeat(1000), " "])(
        "an email that matches no stored record (%j) is 'nothing found': { email }, not an error", async (email) => {
            signedIn(email);
            expect(await profileOf("shop.example.test")).toEqual({ status: 200, body: { email } });
        });

    it("the tenant is the host's: the same address on the other tenant's host gets that tenant's record", async () => {
        signedIn("ana@example.com");
        expect(await profileOf("other.example.test")).toEqual({ status: 200, body: { name: "Ana Of The Other Tenant", phone: "0000" } });
    });

    it("nothing the BROWSER sends selects the customer or the tenant: ?email=, a body, x-tenant-id, x-api-key are not read", async () => {
        signedIn("carla@example.com");   // carla has no record; ana and bob have
        const got = await profileOf("shop.example.test", "/api/profile?email=ana@example.com", {
            headers: { "x-tenant-id": "tenant-other", "x-api-key": "a-key-from-the-browser" },
            body: { email: "ana@example.com" },
        });
        expect(got).toEqual({ status: 200, body: { email: "carla@example.com" } });
        const keysRead = table.commands.map((c) => JSON.stringify(c.input));
        expect(keysRead.length).toBeGreaterThan(0);
        for (const input of keysRead) {
            expect(input).toContain("TENANT#tenant-shop");
            expect(input).toContain("carla@example.com");
            expect(input).not.toContain("ana@example.com");
        }
    });

    it("the read fails → 500 Failed to fetch profile (not { email })", async () => {
        signedIn("ana@example.com");
        table.failOn = () => true;
        expect(await profileOf("shop.example.test")).toEqual({ status: 500, body: { error: "Failed to fetch profile" } });
    });
});
