import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * CMRC-1B, test T5 (docs/slices/cmrc-1b.md § Proofs; docs/slices/cmrc-1.md § 5.6, § 5.7, § 5.9) — THE TRANSPORT of the
 * account pages' customer reads: `lib/customer-api.ts` through the REAL `callBackend` of `lib/api-client.ts`, with a
 * recorded `fetch`; then the two route files on top of it.
 *
 * What it proves:
 *  - each function sends ONE POST to its route with EXACTLY three headers (renderer key, tenant, content type) and a
 *    body built from its arguments only;
 *  - the answer mapping: a 200 answer → the value, deep-equal (null, numbers, nested maps); every other outcome →
 *    `CustomerApiError` with the route and the status — "nothing found" is a 200 answer, never an error;
 *  - THE IDENTITY RULE (PD-002) at the routes: without a session nothing is sent to the backend; with a session the
 *    email of the call is the session's and the tenant is the host's — a `?email=`, a body, `x-tenant-id`, `x-api-key`
 *    or a cookie of the BROWSER request is not forwarded and selects nothing;
 *  - the routes keep their answer shapes, and a backend failure is their 500, not an empty result.
 *
 * The answers per stored-data class are `cmrc-1-account-answers.test.ts` (which ran before and after the change);
 * what the backend does with the call is `backend/test/unit/cmrc-1-self-service.test.ts`.
 *
 * Credential-free: `AMODX_API_KEY` makes `getRendererKey` return without a Secrets Manager call. Mocked at the module
 * boundary: the tenant lookup by host and the session.
 */

const seam = vi.hoisted(() => ({ session: null as null | { user?: { email?: string | null } } }));
vi.mock("next-auth", () => ({ getServerSession: async () => seam.session }));
vi.mock("next-auth/providers/google", () => ({ default: (options: Record<string, unknown>) => ({ id: "google", ...options }) }));
const TENANT_BY_HOST: Record<string, { id: string }> = { "shop.example.test": { id: "tenant-shop" }, "other.example.test": { id: "tenant-other" } };
vi.mock("@/lib/dynamo", () => ({ getTenantConfig: async (host: string) => TENANT_BY_HOST[host] ?? null }));

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CustomerApiError, getCustomerOrders, getCustomerProfile } from "@/lib/customer-api";
import { GET as getOrders } from "@/app/api/account/orders/route";
import { GET as getProfile } from "@/app/api/profile/route";

type Call = { url: string; method: string | undefined; headers: Record<string, string>; body: unknown; cache: unknown };
let calls: Call[];
let reply: () => Response | Promise<Response>;
let logs: string[];

const jsonReply = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
    process.env.API_URL = "https://backend.example.test/";
    process.env.AMODX_API_KEY = "renderer-key";
    delete process.env.AMODX_API_KEY_SECRET;
    seam.session = null;
    calls = [];
    reply = jsonReply(200, { orders: [], profile: null });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string), cache: init.cache });
        return reply();
    }));
    logs = [];
    for (const method of ["log", "warn", "error"] as const) {
        vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => { logs.push(parts.map((p) => (p instanceof Error ? `${p.name}: ${p.message}` : String(p))).join(" ")); });
    }
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.API_URL;
    delete process.env.AMODX_API_KEY;
});

const READS = [
    ["getCustomerOrders", "/customer/order-history", (t: string, e: string) => getCustomerOrders(t, e)],
    ["getCustomerProfile", "/customer/profile-read", (t: string, e: string) => getCustomerProfile(t, e)],
] as const;

describe.each(READS)("CMRC-1B T5 — %s: the call", (_name, route, read) => {
    it("one POST to its route: exactly the renderer key, the tenant and the content type; the body is { email } as given", async () => {
        await read("tenant-shop", " Ana@Example.COM ");
        expect(calls).toEqual([{
            url: `https://backend.example.test${route}`,
            method: "POST",
            headers: { "x-api-key": "renderer-key", "x-tenant-id": "tenant-shop", "content-type": "application/json" },
            body: { email: " Ana@Example.COM " },   // not normalized here: one place holds that rule, the backend
            cache: "no-store",
        }]);
    });

    it.each([400, 401, 403, 404, 429, 500, 502, 503])("the backend answers %i → CustomerApiError { route, status } (not an empty result)", async (status) => {
        reply = jsonReply(status, { code: "any", orders: [], profile: null });
        const error = await read("tenant-shop", "sentinel.visitor@example.test").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CustomerApiError);
        expect({ route: (error as CustomerApiError).route, status: (error as CustomerApiError).status }).toEqual({ route, status });
        expect((error as Error).message).not.toContain("sentinel");
    });

    it("the call itself fails → CustomerApiError unreachable; the log has the route and the error's name, no email", async () => {
        reply = () => { throw new TypeError("connect ECONNREFUSED sentinel.visitor@example.test"); };
        const error = await read("tenant-shop", "sentinel.visitor@example.test").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CustomerApiError);
        expect((error as CustomerApiError).status).toBe("unreachable");
        expect(logs.filter((l) => l.includes("[backend-call]"))).toEqual([`[backend-call] backend call failed: ${route} TypeError`]);
        expect(logs.join("\n")).not.toContain("sentinel");
    });

    it("no API_URL, or no renderer key → CustomerApiError unreachable, and nothing is sent", async () => {
        delete process.env.API_URL;
        expect(((await read("tenant-shop", "ana@example.com").catch((e: unknown) => e)) as CustomerApiError).status).toBe("unreachable");
        process.env.API_URL = "https://backend.example.test";
        process.env.AMODX_API_KEY = "";
        expect(((await read("tenant-shop", "ana@example.com").catch((e: unknown) => e)) as CustomerApiError).status).toBe("unreachable");
        expect(calls).toEqual([]);
    });

    it.each([
        ["a body that is not JSON", () => new Response("<html>gateway</html>", { status: 200 })],
        ["JSON null", jsonReply(200, null)],
        ["a JSON list", jsonReply(200, [])],
        ["an object without the route's field", jsonReply(200, { code: "ok" })],
        ["the field as text", jsonReply(200, { orders: "none", profile: "none" })],
    ])("a 200 answer that is not the route's answer (%s) → CustomerApiError malformedAnswer", async (_case, answer) => {
        reply = answer;
        const error = await read("tenant-shop", "ana@example.com").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CustomerApiError);
        expect((error as CustomerApiError).status).toBe("malformedAnswer");
    });
});

describe("CMRC-1B T5 — the answer mapping: stored values come back deep-equal", () => {
    it("getCustomerOrders → the `orders` list as answered: numbers, text, null, absent fields, in the answered order", async () => {
        const orders = [
            { orderNumber: "PPB-0002", total: 80, status: "placed", createdAt: "2026-11-03T10:00:00.000Z", orderId: "o-2" },
            { orderNumber: "PPB-0001", total: "45.00", status: null, createdAt: "2026-11-01T10:00:00.000Z", orderId: "o-1" },
            { total: 0, orderId: "o-3" },
        ];
        reply = jsonReply(200, { orders });
        expect(await getCustomerOrders("tenant-shop", "ana@example.com")).toEqual(orders);
        reply = jsonReply(200, { orders: [] });
        expect(await getCustomerOrders("tenant-shop", "ana@example.com")).toEqual([]);
    });

    it("getCustomerProfile → the `profile` as answered: null stays null, a nested map stays, {} stays {}, none is null", async () => {
        const profile = { name: "Ana Test", phone: null, birthday: null, defaultAddress: { street: "1 Test Street", lines: ["a", 2, null], geo: { lat: 1.5 } } };
        reply = jsonReply(200, { profile });
        expect(await getCustomerProfile("tenant-shop", "ana@example.com")).toEqual(profile);
        reply = jsonReply(200, { profile: {} });
        expect(await getCustomerProfile("tenant-shop", "ana@example.com")).toEqual({});
        reply = jsonReply(200, { profile: null });
        expect(await getCustomerProfile("tenant-shop", "ana@example.com")).toBeNull();
    });
});

/** A browser request to `host`; `extra` = everything else the browser sends. */
const browser = (host: string, path: string, extra: { headers?: Record<string, string>; body?: unknown } = {}) => ({
    method: "GET",
    url: `https://${host}${path}`,
    nextUrl: new URL(`https://${host}${path}`),
    headers: new Headers({ host, ...extra.headers }),
    json: async () => extra.body,
    text: async () => JSON.stringify(extra.body ?? ""),
}) as never;

const ROUTES = [
    ["GET /api/account/orders", getOrders, "/api/account/orders", "/customer/order-history"],
    ["GET /api/profile", getProfile, "/api/profile", "/customer/profile-read"],
] as const;

describe.each(ROUTES)("CMRC-1B T5 — %s: the identity rule (PD-002)", (_name, handler, path, backendRoute) => {
    it.each([
        ["no session", null],
        ["a session without an email", { user: {} }],
        ["a session with an empty email", { user: { email: "" } }],
    ])("%s → 401, and NO backend call — also when the browser names a customer", async (_case, session) => {
        seam.session = session;
        const res = await handler(browser("shop.example.test", `${path}?email=ana@example.com`, {
            headers: { "x-customer-email": "ana@example.com", "x-api-key": "renderer-key", "x-tenant-id": "tenant-shop" },
            body: { email: "ana@example.com" },
        }));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "Unauthorized - please sign in" });
        expect(calls).toEqual([]);
    });

    it("an unknown host → 404, and no backend call", async () => {
        seam.session = { user: { email: "carla@example.com" } };
        expect((await handler(browser("nobody.example.test", path))).status).toBe(404);
        expect(calls).toEqual([]);
    });

    it("a session → ONE call: the session's email, the HOST's tenant, three headers. Nothing of the browser request is forwarded", async () => {
        seam.session = { user: { email: "carla@example.com" } };
        await handler(browser("shop.example.test", `${path}?email=ana@example.com&tenantId=tenant-other&orderId=o-1`, {
            headers: {
                "x-tenant-id": "tenant-other", "x-api-key": "a-key-from-the-browser", "x-customer-email": "ana@example.com",
                cookie: "next-auth.session-token=a-cookie-of-the-browser", authorization: "Bearer a-token-of-the-browser",
                "x-forwarded-for": "203.0.113.7", "content-type": "text/plain",
            },
            body: { email: "ana@example.com", tenantId: "tenant-other" },
        }));
        expect(calls).toEqual([{
            url: `https://backend.example.test${backendRoute}`,
            method: "POST",
            headers: { "x-api-key": "renderer-key", "x-tenant-id": "tenant-shop", "content-type": "application/json" },
            body: { email: "carla@example.com" },
            cache: "no-store",
        }]);
    });

    it("the tenant of the call follows the host, not the session and not the browser", async () => {
        seam.session = { user: { email: "carla@example.com" } };
        await handler(browser("other.example.test", path, { headers: { "x-tenant-id": "tenant-shop" } }));
        expect(calls.map((c) => c.headers["x-tenant-id"])).toEqual(["tenant-other"]);
    });
});

describe("CMRC-1B T5 — the routes keep their answer shapes", () => {
    beforeEach(() => { seam.session = { user: { email: "Carla@Example.com" } }; });

    it("orders: { orders, email } — the backend's list and the session's email text", async () => {
        const orders = [{ orderNumber: "PPB-0002", total: 80, status: "placed", createdAt: "2026-11-03T10:00:00.000Z", orderId: "o-2" }];
        reply = jsonReply(200, { orders });
        const res = await getOrders(browser("shop.example.test", "/api/account/orders"));
        expect({ status: res.status, body: await res.json() }).toEqual({ status: 200, body: { orders, email: "Carla@Example.com" } });
    });

    it("profile: the stored profile; {} when it holds none of the five attributes; { email } when there is no record", async () => {
        for (const [profile, expected] of [
            [{ name: "Carla Test", phone: null }, { name: "Carla Test", phone: null }],
            [{}, {}],
            [null, { email: "Carla@Example.com" }],
        ] as const) {
            reply = jsonReply(200, { profile });
            const res = await getProfile(browser("shop.example.test", "/api/profile"));
            expect({ status: res.status, body: await res.json() }).toEqual({ status: 200, body: expected });
        }
    });

    it.each([
        ["the backend answers 500", jsonReply(500, { code: "internal" })],
        ["the backend refuses the key (403)", jsonReply(403, { message: "Forbidden" })],
        ["the route does not exist yet (404 of the API gateway)", jsonReply(404, { message: "Not Found" })],
        ["the call fails", () => { throw new TypeError("network"); }],
    ])("%s → 500 with the route's fixed text — never an empty list or { email }", async (_case, answer) => {
        reply = answer;
        const orders = await getOrders(browser("shop.example.test", "/api/account/orders"));
        expect({ status: orders.status, body: await orders.json() }).toEqual({ status: 500, body: { error: "Failed to fetch orders" } });
        const profile = await getProfile(browser("shop.example.test", "/api/profile"));
        expect({ status: profile.status, body: await profile.json() }).toEqual({ status: 500, body: { error: "Failed to fetch profile" } });
        expect(logs.join("\n").toLowerCase()).not.toContain("carla@example.com");
    });
});

describe("CMRC-1B T5 — the moved backend call holds no address extraction (the source check of sched-1g-proxy.test.ts reads booking-proxy.ts only)", () => {
    it("api-client.ts and customer-api.ts: no viewerAddress, no x-forwarded-for / cloudfront-viewer-address / x-viewer-address in code", () => {
        for (const file of ["api-client.ts", "customer-api.ts"]) {
            const src = readFileSync(fileURLToPath(new URL(`../../src/lib/${file}`, import.meta.url)), "utf8");
            const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
            expect(code, file).not.toMatch(/viewerAddress|x-viewer-address|x-forwarded-for|cloudfront-viewer-address/i);
            expect(code.length, `control: ${file} was read`).toBeGreaterThan(200);
        }
    });
});
