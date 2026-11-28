// The tracking page formats its dates with the server's time zone; pin it before any Date is made (as
// locale-1d-server-render.test.ts), so the capture does not depend on the machine.
process.env.TZ = "UTC";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * CMRC-1L, requirement C5 for the order pages (docs/slices/cmrc-1l.md § V1, § V2, § Proofs; docs/slices/cmrc-1.md
 * § 5.2 C5, § 5.9 T11) — WHAT THE ORDER CONFIRMATION PAGE AND THE ORDER TRACKING PAGE RENDER, for every state, from
 * STORED ITEMS and a PAGE ADDRESS.
 *
 * This file was written and run on the code BEFORE cmrc-1l (the page reads DynamoDB itself); the markup of every state
 * was written then to `cmrc-1-order-pages-before.json` (capture mode: `CMRC_1L_CAPTURE=<file>`). On the code AFTER it
 * (the page asks the backend) the same file passes: every state's markup is BYTE-EQUAL to the capture. It can do that
 * because it stands below both transports:
 *
 *   stored items (one in-memory table)  ──►  the real SitePage  ──►  static markup
 *
 *   before:  SitePage → renderer DynamoDB document client ─────────────────────────────────► the table
 *   after:   SitePage → customer-api → callBackend → fetch → LOCAL BACKEND (below) ────────► the table
 *
 * LOCAL BACKEND = the `fetch` stub of this file (the pattern of cmrc-1-account-answers.test.ts). It refuses a call
 * without the renderer key (a STAND-IN for the authorizer; the real authorizer on the route key is proven in
 * backend/test/unit/cmrc-1-self-service-auth.test.ts), calls the REAL handler of
 * `backend/src/customers/self-service.ts` with the role `RENDERER`, and returns its answer. On the code before
 * cmrc-1l nothing calls `fetch` for an order, so the stub is not reached and the handler is not loaded.
 *
 * Replaced at the module boundary, and nothing else: the DynamoDB document client, the tenant lookup
 * (`getTenantConfig`), Next's runtime-coupled modules, and the client components — the two of the confirmation view
 * print their props as JSON (so what crosses to the browser is in the capture), the others are not reached.
 *
 * The second part, THE FIELD PIN: which fields of the order object the two views READ. A recorder around the order
 * (a Proxy) notes every property read; the union over the three order shapes must be exactly the 17 fields of the
 * backend's `OrderView`, and no view may enumerate the object (a spread would read every attribute).
 *
 * What this file does NOT compare: the HTTP status and headers of the page; the layout around the page (navbar,
 * footer); the RSC flight payload and hydration; CSS. Those are the serving suites (`npm run test:serving`), whose
 * rows `loc1-*` and `cm1-*` request the order pages with and without an order. It does not prove the real DynamoDB
 * (the table is backend/test/unit/memory-table.ts), the real authorizer, or the infrastructure.
 */

const seam = vi.hoisted(() => ({ send: async (_command: unknown): Promise<unknown> => { throw new Error("the table is not ready"); } }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    DynamoDBDocumentClient: { from: () => ({ send: (command: unknown) => seam.send(command) }) },
}));

const BANK = { bankName: "Test Bank", accountHolder: "Shop Of The Test SRL", iban: "RO00TEST0000000000000000", swift: "TESTRO22" };
const { TENANTS } = vi.hoisted(() => {
    const base = { status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {}, commerceEnabled: true, catalogMode: false };
    return {
        TENANTS: {
            "shop.example.test": { ...base, id: "tenant-shop", name: "Shop", domain: "shop.example.test", celebrationEnabled: true },
            "ro.example.test": { ...base, id: "tenant-ro", name: "Magazin", domain: "ro.example.test", locale: "ro-RO", currency: "RON" },
            "other.example.test": { ...base, id: "tenant-other", name: "Other", domain: "other.example.test" },
        } as Record<string, Record<string, unknown>>,
    };
});
vi.mock("@/lib/dynamo", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getTenantConfig: async (host: string) => (TENANTS[host] ? { ...TENANTS[host], integrations: { bankTransfer: BANK } } : null),
}));
vi.mock("next/navigation", () => ({
    permanentRedirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    usePathname: () => "/",
}));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn(async () => null) }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
const { probe } = vi.hoisted(() => ({
    probe: (tag: string) => (props: any) => (globalThis as any).__react.createElement(tag, { "data-props": JSON.stringify(props) }),
}));
(globalThis as any).__react = React;
// The two client components of the confirmation view: their props are what the browser receives.
vi.mock("@/components/FBPurchaseEvent", () => ({ FBPurchaseEvent: probe("fb-purchase-probe") }));
vi.mock("@/components/CelebrationWrapper", () => ({ CelebrationWrapper: probe("celebration-probe") }));
// Not reached by the order pages.
vi.mock("@/components/CartPageView", () => ({ CartPageView: () => null }));
vi.mock("@/components/CheckoutPageView", () => ({ CheckoutPageView: () => null }));
vi.mock("@/components/AccountPageView", () => ({ AccountPageView: () => null }));
vi.mock("@/components/AddToCartButton", () => ({ AddToCartButton: () => null }));
vi.mock("@/components/ProductImageGallery", () => ({ ProductImageGallery: () => null }));
vi.mock("@/components/SearchBar", () => ({ SearchBar: () => null }));

import { MemoryTable } from "../../../backend/test/unit/memory-table";
import { SitePage } from "@/components/SitePage";
import { ConfirmationPageView, OrderTrackingView } from "@/components/site-page/order-views";

const BEFORE_FILE = fileURLToPath(new URL("./cmrc-1-order-pages-before.json", import.meta.url));
const CAPTURE = process.env.CMRC_1L_CAPTURE;
const RENDERER_KEY = "renderer-key-of-this-test";
/** The handler file, loaded only when `fetch` is called (an absolute path: a computed import is resolved against the project root). */
const BACKEND_HANDLERS = fileURLToPath(new URL("../../../backend/src/customers/self-service.ts", import.meta.url));
const ROUTE_HANDLER: Record<string, string> = { "POST /customer/order-lookup": "orderLookupHandler" };

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

const ADDRESS = { street: "1 Test Street", city: "Testville", county: "Test County", postalCode: "000000", country: "RO" };
/** Attributes of a stored order that NO order page shows: each must stay out of the page. */
const NEVER_SHOWN = {
    Type: "Order", updatedAt: "2026-11-02T09:00:00.000Z", internalNotes: "staff only — sentinel-internal",
    billingDetails: { companyName: "Sentinel Billing SRL", taxId: "RO-sentinel" }, couponCode: "SENTINEL10", couponId: "c-sentinel", couponDiscount: 5,
    requestedDeliveryDate: "2026-11-09", deliveryNotes: "sentinel-delivery-note",
};
/**
 * The stored orders. `o-bank`: as `orders/create.ts` writes one today (numbers for the amounts, `null` for an absent
 * phone, variant and image; `couponDiscount`, never `discount`; no tracking number). `o-cod`: the older / fixture shape
 * (amounts as text, `discount`), after the admin's status updates (a history with a `null` note and a text note, a
 * tracking number, an estimated delivery date). `o-min`: an item with almost nothing — absent stays absent.
 */
function orders(tenant: string) {
    const pk = `TENANT#${tenant}`;
    return [
        {
            PK: pk, SK: "ORDER#o-bank", tenantId: tenant, ...NEVER_SHOWN,
            id: "o-bank", orderNumber: "PPB-0001", status: "placed", customerEmail: "ana@example.com", customerName: "Ana Test", customerPhone: null,
            currency: "RON", createdAt: "2026-11-01T10:00:00.000Z", paymentMethod: "bank_transfer", shippingAddress: ADDRESS,
            items: [
                { productId: "p-1", productTitle: "Oak Plank", quantity: 2, unitPrice: "80.00", totalPrice: 160, selectedVariant: null, personalizations: [], imageLink: null },
                { productId: "p-2", productTitle: "Rug <b>&amp;</b> \"Mat\"", quantity: 1, unitPrice: "45.50", totalPrice: 45.5, selectedVariant: "Blue", personalizations: [], imageLink: "https://cdn.example.test/rug.jpg" },
            ],
            subtotal: 205.5, shippingCost: 0, total: 200.5,
            statusHistory: [{ status: "placed", timestamp: "2026-11-01T10:00:00.000Z", note: "Order placed" }],
        },
        {
            PK: pk, SK: "ORDER#o-cod", tenantId: tenant, ...NEVER_SHOWN,
            id: "o-cod", orderNumber: "PPB-0002", status: "shipped", customerEmail: "ana@example.com", customerName: "Ana Test", customerPhone: "+40 700 000 000",
            currency: "RON", createdAt: "2026-11-02T08:30:00.000Z", paymentMethod: "cash_on_delivery", shippingAddress: { ...ADDRESS, street: "2 Test Street" },
            estimatedDeliveryDate: "2026-11-06", trackingNumber: "AWB-0002",
            items: [{ productId: "p-1", productTitle: "Oak Plank", quantity: 1, unitPrice: "80.00", totalPrice: "85.00", selectedVariant: null,
                personalizations: [{ label: "Monogram", value: "AB", addedCost: "5.00" }, { label: "Colour", value: "Red" }], imageLink: null }],
            subtotal: "85.00", shippingCost: "10.00", discount: "5.00", total: "90.00",
            statusHistory: [
                { status: "placed", timestamp: "2026-11-02T08:30:00.000Z", note: "Order placed" },
                { status: "confirmed", timestamp: "2026-11-02T09:00:00.000Z", note: null },
                { status: "shipped", timestamp: "2026-11-03T14:15:00.000Z", note: "AWB-0002" },
                { status: "on_hold", timestamp: "2026-11-03T15:00:00.000Z" },
            ],
        },
        { PK: pk, SK: "ORDER#o-min", id: "o-min", orderNumber: "PPB-0003", customerEmail: "ana@example.com", internalNotes: "sentinel-internal" },
        // A stored email that is not in normalized form (no writer stores one): reached by no request.
        { PK: pk, SK: "ORDER#o-caps", id: "o-caps", orderNumber: "PPB-0004", customerEmail: "Ana@Example.com", status: "placed" },
    ];
}

beforeEach(() => {
    process.env.TABLE_NAME = "cmrc-1l-unit";
    process.env.API_URL = "https://backend.example.test";
    process.env.AMODX_API_KEY = RENDERER_KEY;
    delete process.env.AMODX_API_KEY_SECRET;

    table = new MemoryTable();
    seam.send = (command) => table.send(command);
    for (const item of [...orders("tenant-shop"), ...orders("tenant-ro")]) table.put(item);
    // The same email is a customer of another tenant too; that tenant's order id is unknown to the shop.
    table.put({ PK: "TENANT#tenant-other", SK: "ORDER#o-foreign", id: "o-foreign", orderNumber: "OTH-0077", customerEmail: "ana@example.com", status: "placed", total: 7, currency: "EUR" });

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

const SHOP = "shop.example.test";
type State = { host?: string; slug: string[]; query: Record<string, string>; reads: [string, string] | null; look: string };
const confirm = (query: Record<string, string>, reads: State["reads"], look: string, host = SHOP): State => ({ host, slug: ["checkout", "confirmation"], query, reads, look });
const track = (id: string, query: Record<string, string>, reads: State["reads"], look: string, host = SHOP): State => ({ host, slug: ["checkout", id], query, reads, look });
const ANA = "ana@example.com";
const key = (tenant: string, id: string): [string, string] => [`TENANT#${tenant}`, `ORDER#${id}`];

/**
 * Every state of docs/slices/cmrc-1l.md § V1. `reads`: the ONE item key the state reads, or `null` when the page must
 * read nothing. `look`: a text only that look has (the four looks of the two pages).
 */
const STATES: Record<string, State> = {
    // S1 — the order is shown.
    "confirm/shown-bank": confirm({ id: "o-bank", email: ANA }, key("tenant-shop", "o-bank"), "Order Confirmed!"),
    "confirm/shown-cod": confirm({ id: "o-cod", email: ANA }, key("tenant-shop", "o-cod"), "Order Confirmed!"),
    "confirm/shown-min": confirm({ id: "o-min", email: ANA }, key("tenant-shop", "o-min"), "Order Confirmed!"),
    "confirm/shown-email-as-typed": confirm({ id: "o-bank", email: "  Ana@Example.COM " }, key("tenant-shop", "o-bank"), "Order Confirmed!"),
    "confirm/shown-email-fullwidth": confirm({ id: "o-bank", email: "ａｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ" }, key("tenant-shop", "o-bank"), "Order Confirmed!"),
    "confirm/shown-ro": confirm({ id: "o-cod", email: ANA }, key("tenant-ro", "o-cod"), "PPB-0002", "ro.example.test"),
    "track/shown-bank": track("o-bank", { email: ANA }, key("tenant-shop", "o-bank"), "Status History"),
    "track/shown-cod": track("o-cod", { email: ANA }, key("tenant-shop", "o-cod"), "Tracking Number:"),
    "track/shown-min": track("o-min", { email: ANA }, key("tenant-shop", "o-min"), "Order PPB-0003"),
    "track/shown-email-as-typed": track("o-cod", { email: "\tANA@EXAMPLE.COM\n" }, key("tenant-shop", "o-cod"), "Tracking Number:"),
    "track/shown-ro": track("o-cod", { email: ANA }, key("tenant-ro", "o-cod"), "AWB-0002", "ro.example.test"),
    // S2 — no order requested: nothing is read.
    "confirm/no-query": confirm({}, null, "Thank you for your order!"),
    "confirm/id-only": confirm({ id: "o-bank" }, null, "Thank you for your order!"),
    "confirm/email-only": confirm({ email: ANA }, null, "Thank you for your order!"),
    "confirm/empty-email": confirm({ id: "o-bank", email: "" }, null, "Thank you for your order!"),
    "confirm/empty-id": confirm({ id: "", email: ANA }, null, "Thank you for your order!"),
    "track/no-email": track("o-cod", {}, null, "Order Not Found"),
    "track/empty-email": track("o-cod", { email: "" }, null, "Order Not Found"),
    // S3 — no such order.
    "confirm/absent-id": confirm({ id: "o-none", email: ANA }, key("tenant-shop", "o-none"), "Thank you for your order!"),
    "track/absent-id": track("o-none", { email: ANA }, key("tenant-shop", "o-none"), "Order Not Found"),
    // S4 — the order of another tenant.
    "confirm/other-tenant": confirm({ id: "o-foreign", email: ANA }, key("tenant-shop", "o-foreign"), "Thank you for your order!"),
    "track/other-tenant": track("o-foreign", { email: ANA }, key("tenant-shop", "o-foreign"), "Order Not Found"),
    // S5 — the email is not equal to the stored one.
    "confirm/email-not-equal": confirm({ id: "o-bank", email: "bob@example.com" }, key("tenant-shop", "o-bank"), "Thank you for your order!"),
    "confirm/email-shorter": confirm({ id: "o-bank", email: "ana@example.co" }, key("tenant-shop", "o-bank"), "Thank you for your order!"),
    "track/email-not-equal": track("o-cod", { email: "bob@example.com" }, key("tenant-shop", "o-cod"), "Order Not Found"),
    "confirm/stored-email-not-normalized": confirm({ id: "o-caps", email: "Ana@Example.com" }, key("tenant-shop", "o-caps"), "Thank you for your order!"),
    "track/stored-email-not-normalized": track("o-caps", { email: "ana@example.com" }, key("tenant-shop", "o-caps"), "Order Not Found"),
    // S6 — a malformed link.
    "confirm/email-with-space": confirm({ id: "o-bank", email: "an a@example.com" }, key("tenant-shop", "o-bank"), "Thank you for your order!"),
    "confirm/email-blank": confirm({ id: "o-bank", email: " " }, key("tenant-shop", "o-bank"), "Thank you for your order!"),
    "confirm/email-not-an-address": confirm({ id: "o-bank", email: "not-an-email" }, key("tenant-shop", "o-bank"), "Thank you for your order!"),
    "confirm/id-with-hash": confirm({ id: "o-bank#x", email: ANA }, key("tenant-shop", "o-bank#x"), "Thank you for your order!"),
    "confirm/long-values": confirm({ id: "x".repeat(600), email: `${"y".repeat(600)}@example.com` }, key("tenant-shop", "x".repeat(600)), "Thank you for your order!"),
    "track/email-with-space": track("o-cod", { email: "an a@example.com" }, key("tenant-shop", "o-cod"), "Order Not Found"),
    "track/id-with-hash": track("o-cod#x", { email: ANA }, key("tenant-shop", "o-cod#x"), "Order Not Found"),
};

const page = (s: State) => SitePage({ siteId: s.host ?? SHOP, slug: s.slug, preview: false, basePath: "", sessionToken: null, query: s.query, cacheable: false });
const markupOf = async (s: State) => renderToStaticMarkup(await page(s) as any);
/** The keys of the DynamoDB reads the table saw (the command's other fields belong to the transport). */
const keysRead = () => table.commands.map((c) => [c.constructor.name, c.input.Key?.PK, c.input.Key?.SK]);

if (CAPTURE) {
    describe("[cmrc-1l] capture of the order pages (run on the code BEFORE the slice)", () => {
        it("writes the static markup of every state", async () => {
            const states: Record<string, string> = {};
            for (const [name, state] of Object.entries(STATES)) {
                table.commands.length = 0;
                states[name] = await markupOf(state);
            }
            writeFileSync(CAPTURE, JSON.stringify({ commit: process.env.CMRC_1L_COMMIT ?? "", timeZone: process.env.TZ, states }, null, 2) + "\n");
        });
    });
} else {
    const before = JSON.parse(readFileSync(BEFORE_FILE, "utf8")) as { commit: string; timeZone: string; states: Record<string, string> };

    describe("CMRC-1L — the order pages render what they rendered before the slice (C5)", () => {
        it("the capture holds exactly the states of this file, taken at UTC", () => {
            expect(Object.keys(before.states).sort()).toEqual(Object.keys(STATES).sort());
            expect(before.timeZone).toBe("UTC");
            expect(before.commit).toMatch(/^[0-9a-f]{7,40}$/);
        });

        it.each(Object.entries(STATES))("%s: the markup is byte-equal to the capture; the page reads exactly its one item, or nothing", async (name, state) => {
            const markup = await markupOf(state);
            expect(markup).toBe(before.states[name]);
            expect(keysRead()).toEqual(state.reads === null ? [] : [["GetCommand", ...state.reads]]);
        });

        it.each(Object.entries(STATES))("%s: the capture itself shows the look the state must have (the oracle is not empty or wrong)", (name, state) => {
            const html = before.states[name];
            expect(html).toContain(state.look);
            const looks = ["Order Confirmed!", "Thank you for your order!", "Order Not Found"];
            // A state's page has exactly one of the three English headings (the RO tenant has none of them).
            if (state.host !== "ro.example.test") expect(looks.filter((l) => html.includes(l)).length).toBe(name.startsWith("track/shown") ? 0 : 1);
        });

        it("the email in another written form shows the SAME page as the stored form", () => {
            expect(before.states["confirm/shown-email-as-typed"]).toBe(before.states["confirm/shown-bank"]);
            expect(before.states["confirm/shown-email-fullwidth"]).toBe(before.states["confirm/shown-bank"]);
            expect(before.states["track/shown-email-as-typed"]).toBe(before.states["track/shown-cod"]);
        });

        it("'no order requested', 'not found', 'another tenant', 'email not equal' and a malformed link are ONE page per page kind: a visitor cannot tell them apart", () => {
            const group = (prefix: string) => Object.entries(before.states)
                .filter(([name]) => name.startsWith(prefix) && !name.includes("/shown")).map(([, html]) => html);
            expect(group("confirm/").length).toBe(15);
            expect(new Set(group("confirm/")).size).toBe(1);
            expect(group("track/").length).toBe(8);
            expect(new Set(group("track/")).size).toBe(1);
        });

        it("no page shows an attribute outside the views: internal notes, billing details, coupon, the stored email", () => {
            for (const [name, html] of Object.entries(before.states)) {
                expect(html, name).not.toMatch(/sentinel|SENTINEL|ana@example\.com|Ana@Example/);
            }
        });

        it("the client components of the confirmation get the order id, the total as a number, the currency and { id, quantity } per item — never the order", async () => {
            const html = await markupOf(STATES["confirm/shown-bank"]);
            const props = (tag: string) => [...html.matchAll(new RegExp(`<${tag} data-props="([^"]*)"`, "g"))]
                .map((m) => JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")));
            expect(props("fb-purchase-probe")).toEqual([{ orderId: "o-bank", value: 200.5, currency: "RON", items: [{ id: "p-1", quantity: 2 }, { id: "p-2", quantity: 1 }] }]);
            expect(props("celebration-probe")).toEqual([{}]);
        });

        it("S7 — the read fails: the render fails (nothing is shown as 'not found'), for both pages", async () => {
            table.failOn = () => true;
            await expect(page(STATES["confirm/shown-bank"])).rejects.toThrow();
            table.failOn = () => true;
            await expect(page(STATES["track/shown-cod"])).rejects.toThrow();
            table.failOn = () => true;
            await expect(page(STATES["track/absent-id"])).rejects.toThrow();
        });
    });

    describe("CMRC-1L — the field pin: what the two views READ from the order object", () => {
        /** The 17 fields of `OrderView` (docs/slices/cmrc-1.md § 5.6), written here as an independent statement. */
        const ORDER_VIEW_FIELDS = ["createdAt", "currency", "customerName", "customerPhone", "discount", "estimatedDeliveryDate", "id", "items", "orderNumber",
            "paymentMethod", "shippingAddress", "shippingCost", "status", "statusHistory", "subtotal", "total", "trackingNumber"];

        /** `order` behind a recorder: every top-level property read by name; any enumeration of the object. */
        function recorded(order: Record<string, unknown>) {
            const read = new Set<string>();
            const enumerated: string[] = [];
            const proxy = new Proxy(order, {
                get(target, property, receiver) { if (typeof property === "string") read.add(property); return Reflect.get(target, property, receiver); },
                has(target, property) { enumerated.push(`in:${String(property)}`); return Reflect.has(target, property); },
                ownKeys(target) { enumerated.push("ownKeys"); return Reflect.ownKeys(target); },
                getOwnPropertyDescriptor(target, property) { enumerated.push(`descriptor:${String(property)}`); return Reflect.getOwnPropertyDescriptor(target, property); },
            });
            return { proxy, read, enumerated };
        }
        const CONFIG = { ...TENANTS[SHOP], integrations: { bankTransfer: BANK } };
        const PROPS = { config: CONFIG, prefixes: {}, basePath: "" };

        it("over the three stored order shapes, the views read exactly the 17 OrderView fields — none more, none less — and never enumerate the order", () => {
            const read = new Set<string>();
            const perView: Record<string, string[]> = {};
            for (const order of orders("tenant-shop").slice(0, 3)) {
                for (const [viewName, view] of [["confirmation", ConfirmationPageView], ["tracking", OrderTrackingView]] as const) {
                    const r = recorded(order);
                    renderToStaticMarkup(view({ order: r.proxy, ...PROPS }) as any);
                    expect(r.enumerated, `${viewName} of ${order.id}`).toEqual([]);
                    for (const field of r.read) read.add(field);
                    perView[viewName] = [...new Set([...(perView[viewName] ?? []), ...r.read])].sort();
                }
            }
            expect([...read].sort()).toEqual(ORDER_VIEW_FIELDS);
            expect(perView.confirmation).toEqual(["currency", "customerName", "customerPhone", "discount", "estimatedDeliveryDate", "id", "items", "orderNumber",
                "paymentMethod", "shippingAddress", "shippingCost", "subtotal", "total"]);
            expect(perView.tracking).toEqual(["createdAt", "currency", "items", "orderNumber", "status", "statusHistory", "total", "trackingNumber"]);
        });

        it("the recorder sees a read through destructuring and an enumeration (the pin can fail)", () => {
            const r = recorded({ id: "o", secret: "s" });
            const { secret } = r.proxy as { secret: string };
            expect(secret).toBe("s");
            expect([...r.read]).toEqual(["secret"]);
            expect({ ...r.proxy }).toEqual({ id: "o", secret: "s" });
            expect(r.enumerated).toContain("ownKeys");
        });
    });
}
