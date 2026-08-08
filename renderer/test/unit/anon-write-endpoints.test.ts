import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * STATIC-1 — WIRING test: each anonymous write proxy actually enforces the STATIC-1
 * same-origin barrier, in BOTH directions and PER ENDPOINT.
 *
 * `origin-guard.test.ts` proves the decision function is correct. This proves each route
 * (a) short-circuits a cross-site / opaque-origin write to 403 BEFORE it derives a tenant,
 * attaches the RENDERER key, or hits the backend, and (b) lets a same-origin write flow
 * through to the proxy. A route that forgot to call the guard would pass (a)'s "accepted"
 * leg but fail its "rejected" leg — that is the regression this file catches.
 *
 * Downstream is mocked at the module boundary so no AWS/network is touched: the guard runs
 * before any of it, so the cross-site case never even reaches these mocks.
 */

vi.mock("@/lib/dynamo", () => ({
    getTenantConfig: vi.fn(async () => ({ id: "t1" })),
}));
vi.mock("@/lib/api-client", () => ({
    getRendererKey: vi.fn(async () => "renderer-key"),
}));
// `leads` enriches from the referral cookie via next/headers.
vi.mock("next/headers", () => ({
    cookies: vi.fn(async () => ({ get: () => undefined })),
}));

const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
    }),
);

const ENDPOINTS = [
    { name: "consent", load: () => import("@/app/api/consent/route") },
    { name: "contact", load: () => import("@/app/api/contact/route") },
    { name: "leads", load: () => import("@/app/api/leads/route") },
];

// A minimal req: the routes touch only `req.headers.get(...)` and `req.json()`.
const fakeReq = (headers: Record<string, string>, body: Record<string, unknown> = {}) =>
    ({ headers: new Headers(headers), json: async () => body }) as any;

const CROSS_SITE = {
    host: "acme.test",
    "x-forwarded-host": "acme.test",
    origin: "null",
    "sec-fetch-site": "cross-site",
};
const FIRST_PARTY = {
    host: "acme.test",
    origin: "https://acme.test",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
};

beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env.API_URL = "https://backend.test";
    fetchMock.mockClear();
});

describe.each(ENDPOINTS)("POST /api/$name — STATIC-1 barrier", ({ load }) => {
    it("REJECTS a cross-site / opaque-origin write with 403 and never reaches the backend", async () => {
        const { POST } = await load();
        const res = await POST(fakeReq(CROSS_SITE));
        expect(res.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled(); // guarded before any proxy hop
    });

    it("ACCEPTS a same-origin first-party write and proxies it to the backend", async () => {
        const { POST } = await load();
        const res = await POST(fakeReq(FIRST_PARTY, { name: "x", email: "a@b.test" }));
        expect(res.status).not.toBe(403);
        expect(fetchMock).toHaveBeenCalledTimes(1); // flowed through the guard to the proxy
    });
});
