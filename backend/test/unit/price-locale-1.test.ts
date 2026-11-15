import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * PRICE-LOCALE-1 (docs/slices/price-locale-1.md § 1 items 2-3, 5) — the order handler and the bulk price change read a
 * stored price text by the TENANT's locale (the tenant item, never the request). Same harness as
 * `order-price-1.test.ts`: the real handlers and the real shared parser; mocked are `db.js` (`send`), the origin and
 * reCAPTCHA helpers, SES, the audit event and the stored-page purge. Credential-free.
 */

const { ddbSend, sesSend, mockVerifyOrigin, mockResolveRecaptcha, mockAudit, mockPurge } = vi.hoisted(() => {
    process.env.SES_FROM_EMAIL = "shop@t1.test";
    return { ddbSend: vi.fn(), sesSend: vi.fn(), mockVerifyOrigin: vi.fn(), mockResolveRecaptcha: vi.fn(), mockAudit: vi.fn(), mockPurge: vi.fn() };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/tenant-verify.js", () => ({ verifyTenantFromOrigin: mockVerifyOrigin }));
vi.mock("../../src/lib/recaptcha.js", () => ({ resolveRecaptchaConfig: mockResolveRecaptcha, verifyRecaptcha: vi.fn() }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/revalidate.js", () => ({ purgeStoredPagesOfTenant: mockPurge, purgeStoredPagesOfRequestTenant: vi.fn() }));
vi.mock("../../src/lib/invalidate-cdn.js", () => ({ withInvalidation: (h: any) => h }));
vi.mock("@aws-sdk/client-ses", () => ({
    SESClient: class { send = sesSend; },
    SendEmailCommand: class { constructor(public input: any) {} },
}));

import { handler as createOrder } from "../../src/orders/create.js";
import { handler as bulkPrice } from "../../src/products/bulk-price.js";

const P1 = "c0000000-0000-4000-8000-000000000001";
const tenant = (locale?: string) => ({
    PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", commerceEnabled: true, currency: "RON",
    ...(locale !== undefined ? { locale } : {}),
});
const product = (extra: Record<string, any>) => ({
    PK: "TENANT#t1", SK: `PRODUCT#${P1}`, id: P1, title: "Product 1", price: "12,50",
    volumePricing: [], variants: [], personalizations: [], categoryIds: [], ...extra,
});

let tenantItem: Record<string, any> = tenant();
let stored: Record<string, any> = product({});
beforeEach(() => {
    ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) {
            const sk = String(cmd.input.Key?.SK);
            if (sk.startsWith("TENANT#")) return { Item: structuredClone(tenantItem) };
            if (sk === `PRODUCT#${P1}`) return { Item: structuredClone(stored) };
            return {};
        }
        if (cmd instanceof QueryCommand) return { Items: [structuredClone(stored)] };
        if (cmd instanceof UpdateCommand && cmd.input.Key?.SK === "COUNTER#ORDER") return { Attributes: { currentValue: 7 } };
        return {};
    });
    sesSend.mockReset().mockResolvedValue({});
    mockVerifyOrigin.mockReset().mockResolvedValue(true);
    mockResolveRecaptcha.mockReset().mockReturnValue(null);
    mockAudit.mockReset();
    mockPurge.mockReset();
});

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const transaction = () => commands().find((c) => c instanceof TransactWriteCommand) as TransactWriteCommand | undefined;

const orderEvent = (items: unknown[], extraHeaders: Record<string, string> = {}) => ({
    headers: { "x-tenant-id": "t1", origin: "https://t1.test", ...extraHeaders },
    requestContext: { http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify({ items, customerEmail: "buyer@example.com", customerName: "Buyer", paymentMethod: "cash_on_delivery" }),
}) as any;
const order = async (items: unknown[], extraHeaders?: Record<string, string>) =>
    (await (createOrder as any)(orderEvent(items, extraHeaders), {} as any, () => {})) as any;

describe("PRICE-LOCALE-1 — the order handler reads the price by the tenant item's locale", () => {
    it("tenant ro-RO, product 12,50, added cost 5,5, quantity 2 → stored unitPrice \"18.00\", totalPrice 36", async () => {
        tenantItem = tenant("ro-RO");
        stored = product({ personalizations: [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5,5" }] });
        const res = await order([{ productId: P1, quantity: 2, personalizations: [{ id: "engr", label: "Engraving", value: "AB" }] }]);
        expect(res.statusCode).toBe(201);
        const item = transaction()!.input.TransactItems![0].Put!.Item!.items[0];
        expect(item.unitPrice).toBe("18.00");
        expect(item.totalPrice).toBe(36);
        expect(transaction()!.input.TransactItems![0].Put!.Item!.subtotal).toBe(36);
    });

    it("tenant en-US, product 12,50 → 400, no write", async () => {
        tenantItem = tenant("en-US");
        stored = product({});
        const res = await order([{ productId: P1, quantity: 1 }]);
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe(`Invalid price for product: ${P1}`);
        expect(transaction()).toBeUndefined();
        expect(commands().some((c) => c instanceof PutCommand)).toBe(false);
    });

    it("tenant with no locale (the en-US default), product 12,50 → 400, no write", async () => {
        tenantItem = tenant();
        stored = product({});
        expect((await order([{ productId: P1, quantity: 1 }])).statusCode).toBe(400);
        expect(transaction()).toBeUndefined();
    });

    it("the server stays the authority: a locale in the request (header, body) is ignored — en-US tenant still refuses 12,50", async () => {
        tenantItem = tenant("en-US");
        stored = product({});
        const items = [{ productId: P1, quantity: 1, locale: "ro-RO" }];
        const res = await order(items, { "accept-language": "ro-RO", "x-locale": "ro-RO" });
        expect(res.statusCode).toBe(400);
        expect(transaction()).toBeUndefined();
    });

    it("tenant ro-RO, point prices (12.50, tier 10.00 at 5) → the same stored values as an en-US tenant", async () => {
        const results: unknown[] = [];
        for (const locale of ["ro-RO", "en-US"]) {
            tenantItem = tenant(locale);
            stored = product({ price: "12.50", volumePricing: [{ minQuantity: 5, price: "10.00" }] });
            ddbSend.mockClear();
            expect((await order([{ productId: P1, quantity: 5 }])).statusCode).toBe(201);
            const o = transaction()!.input.TransactItems![0].Put!.Item!;
            results.push({ unitPrice: o.items[0].unitPrice, totalPrice: o.items[0].totalPrice, subtotal: o.subtotal });
        }
        expect(results[0]).toEqual({ unitPrice: "10.00", totalPrice: 50, subtotal: 50 });
        expect(results[1]).toEqual(results[0]);
    });
});

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const bulkEvent = (body: unknown) => ({
    headers: { "x-tenant-id": "t1" },
    requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
}) as any;
const bulk = async (body: unknown) => {
    const res = (await (bulkPrice as any)(bulkEvent(body), {} as any, () => {})) as any;
    return { statusCode: res.statusCode, body: JSON.parse(res.body) };
};
const writtenProduct = () => commands().find((c) => c instanceof PutCommand && c.input.Item?.SK === `PRODUCT#${P1}`)?.input.Item;

describe("PRICE-LOCALE-1 — the bulk price change reads the price by the tenant's locale", () => {
    it("bulk price +10 %, ro-RO, price 12,50 → new price from 12.5 (13.75), not from 12 (13.20); written in machine form", async () => {
        tenantItem = tenant("ro-RO");
        stored = product({ price: "12,50" });
        const preview = await bulk({ percent: 10 });
        expect(preview.statusCode).toBe(200);
        expect(preview.body.preview).toEqual([{ id: P1, title: "Product 1", oldPrice: "12,50", newPrice: "13.75", currency: undefined }]);

        ddbSend.mockClear();
        const applied = await bulk({ percent: 10, dryRun: false });
        expect(applied.body.count).toBe(1);
        expect(writtenProduct()!.price).toBe("13.75");
    });

    it("ro-RO, salePrice 9,99 with applyToSalePrice → new sale price from 9.99 (10.99)", async () => {
        tenantItem = tenant("ro-RO");
        stored = product({ price: "12,50", salePrice: "9,99" });
        const preview = await bulk({ percent: 10, applyToSalePrice: true });
        expect(preview.body.preview[0]).toMatchObject({ oldSalePrice: "9,99", newSalePrice: "10.99" });
    });

    it("en-US, price 12,50 → skipped (before: read as 12 and a new price 13.20 written)", async () => {
        tenantItem = tenant("en-US");
        stored = product({ price: "12,50" });
        const preview = await bulk({ percent: 10 });
        expect(preview.body).toEqual({ preview: [], count: 0 });
    });

    it("en-US and ro-RO, price 12.50 → the same preview (13.75) as before", async () => {
        for (const locale of ["en-US", "ro-RO", undefined]) {
            tenantItem = tenant(locale);
            stored = product({ price: "12.50" });
            expect((await bulk({ percent: 10 })).body.preview[0].newPrice).toBe("13.75");
        }
    });

    it("the tenant item is read with its key (no scan): GetCommand SYSTEM / TENANT#t1", async () => {
        tenantItem = tenant("ro-RO");
        await bulk({ percent: 10 });
        const get = commands().find((c) => c instanceof GetCommand);
        expect(get!.input.Key).toEqual({ PK: "SYSTEM", SK: "TENANT#t1" });
    });
});
