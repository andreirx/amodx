import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ORDER-EMAIL-1 (docs/slices/order-email-1.md), after CMRC-1L (docs/slices/cmrc-1l.md § Proofs, T6) — the rule: the
 * confirmation and tracking pages give the email AS THE VISITOR TYPED IT, and the order is found when its
 * `normalizeEmail` form equals the stored `customerEmail` (the order handler stores the normalized form).
 *
 * Before CMRC-1L `getOrderForCustomer` read DynamoDB in the renderer and this file held both halves of the rule. Now
 * the read is in the backend, so the rule has two places and this file proves the RENDERER half only:
 *
 *   renderer (this file): `getOrderForCustomer` of `@/lib/customer-api` FORWARDS the email and the order id unchanged
 *     — it does not normalize, trim or lower-case (one place holds that rule) — and returns `null` for the backend's
 *     "not found";
 *   backend: the comparison `stored customerEmail === normalizeEmail(email)`, with every stored-form case this file
 *     had before — `backend/test/unit/cmrc-1-order-lookup.test.ts`, "the email rule".
 *
 * Both halves together, from stored items to the page: `cmrc-1-order-pages.test.ts`.
 *
 * The backend is a recorded `fetch`; the real `callBackend` runs (credential-free: `AMODX_API_KEY`).
 */

import { getOrderForCustomer } from "@/lib/customer-api";

type Call = { url: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
let reply: () => Response;

const order = { id: "o1", orderNumber: "PPB-0001", total: 42 };
const found = () => new Response(JSON.stringify({ order }), { status: 200 });
const notFound = () => new Response(JSON.stringify({ code: "notFound" }), { status: 404 });

beforeEach(() => {
    process.env.API_URL = "https://backend.example.test";
    process.env.AMODX_API_KEY = "renderer-key";
    delete process.env.AMODX_API_KEY_SECRET;
    calls = [];
    reply = found;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
        return reply();
    }));
    for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.API_URL;
    delete process.env.AMODX_API_KEY;
});

describe("getOrderForCustomer — the renderer forwards the email as typed; the backend holds the normalizeEmail rule", () => {
    for (const typed of ["ana@example.com", "Ana@Example.com", "ANA@EXAMPLE.COM", " ana@example.com ", "\tAna@Example.com\n", "ana＠example.com", "Ａna@Example.com"]) {
        it(`${JSON.stringify(typed)} → ONE call with that exact text, the order id and the tenant; the answered order is returned`, async () => {
            expect(await getOrderForCustomer("t1", "o1", typed)).toEqual(order);
            expect(calls).toEqual([{
                url: "https://backend.example.test/customer/order-lookup",
                headers: { "x-api-key": "renderer-key", "x-tenant-id": "t1", "content-type": "application/json" },
                body: { orderId: "o1", email: typed },
            }]);
        });
    }

    for (const typed of ["other@example.com", "ana@example.co", "an a@example.com"]) {
        it(`an email the backend does not match (${JSON.stringify(typed)}) → null, after one call that carries it unchanged`, async () => {
            reply = notFound;
            expect(await getOrderForCustomer("t1", "o1", typed)).toBeNull();
            expect(calls.map((c) => c.body)).toEqual([{ orderId: "o1", email: typed }]);
        });
    }

    it("no such order id → null", async () => {
        reply = notFound;
        expect(await getOrderForCustomer("t1", "o2", "ana@example.com")).toBeNull();
        expect(calls[0].body).toEqual({ orderId: "o2", email: "ana@example.com" });
    });

    it("the same order id under another tenant: the call names THAT tenant (the backend's key holds the tenant) → null", async () => {
        reply = notFound;
        expect(await getOrderForCustomer("t2", "o1", "ana@example.com")).toBeNull();
        expect(calls[0].headers["x-tenant-id"]).toBe("t2");
    });
});
