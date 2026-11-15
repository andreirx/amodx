import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * ORDER-CONFIRM-1 (docs/slices/order-confirm-1.md § 1 items 1-3, 6) — the order handler creates an order only with a
 * total the visitor saw. Same style as `order-price-1.test.ts`: the real `orders/create.ts`, the real shared schema,
 * price rule and comparison; mocked are `db.js` (`send`), the origin and reCAPTCHA helpers and the SES client.
 * Credential-free. Each `it` names the taxonomy row it binds; each refusal row checks that only reads were sent.
 */

const { ddbSend, sesSend, mockVerifyOrigin, mockResolveRecaptcha } = vi.hoisted(() => {
    process.env.SES_FROM_EMAIL = "shop@t1.test";
    return { ddbSend: vi.fn(), sesSend: vi.fn(), mockVerifyOrigin: vi.fn(), mockResolveRecaptcha: vi.fn() };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/tenant-verify.js", () => ({ verifyTenantFromOrigin: mockVerifyOrigin }));
vi.mock("../../src/lib/recaptcha.js", () => ({ resolveRecaptchaConfig: mockResolveRecaptcha, verifyRecaptcha: vi.fn() }));
vi.mock("@aws-sdk/client-ses", () => ({
    SESClient: class { send = sesSend; },
    SendEmailCommand: class { constructor(public input: any) {} },
}));

import { handler as createOrder } from "../../src/orders/create.js";

const TENANT = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", commerceEnabled: true, currency: "USD" };
const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";
const product = (id: string, extra: Record<string, any> = {}) => ({
    PK: "TENANT#t1", SK: `PRODUCT#${id}`, id, title: `Product ${id.slice(-1)}`, price: "25.00",
    volumePricing: [], variants: [], personalizations: [], ...extra,
});
const COUPON = { PK: "TENANT#t1", SK: "COUPON#cp1", id: "cp1", code: "TEN", status: "active", type: "percentage", value: "10", usageLimit: 0, usageCount: 0 };

type Stored = { products: Record<string, any>; delivery?: Record<string, any>; coupon?: Record<string, any>; tenant?: Record<string, any> };
function mockDb({ products, delivery, coupon, tenant }: Stored) {
    ddbSend.mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) {
            const sk = String(cmd.input.Key?.SK);
            if (sk.startsWith("TENANT#")) return { Item: structuredClone({ ...TENANT, ...tenant }) };
            if (sk.startsWith("PRODUCT#")) {
                const p = products[sk.slice("PRODUCT#".length)];
                return { Item: p ? structuredClone(p) : undefined };
            }
            if (sk === "DELIVERYCONFIG#default") return { Item: delivery ? structuredClone(delivery) : undefined };
            if (sk === "COUPONCODE#TEN") return { Item: coupon ? { couponId: "cp1" } : undefined };
            if (sk === "COUPON#cp1") return { Item: coupon ? structuredClone(coupon) : undefined };
            return {};
        }
        if (cmd instanceof UpdateCommand && cmd.input.Key?.SK === "COUNTER#ORDER") return { Attributes: { currentValue: 7 } };
        return {};
    });
}

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const transaction = () => commands().find((c) => c instanceof TransactWriteCommand) as TransactWriteCommand | undefined;
const storedOrder = () => transaction()!.input.TransactItems![0].Put!.Item!;
/** No write of any kind: every command sent is a read. */
const onlyReads = () => commands().every((c) => c instanceof GetCommand);

const orderEvent = (body: Record<string, unknown>) => ({
    headers: { "x-tenant-id": "t1", origin: "https://t1.test" },
    requestContext: { http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify({ customerEmail: "buyer@example.com", customerName: "Buyer", paymentMethod: "cash_on_delivery", ...body }),
}) as any;
const call = async (body: Record<string, unknown>) => (await (createOrder as any)(orderEvent(body), {} as any, () => {})) as any;
const ONE = [{ productId: P1, quantity: 3 }]; // 3 × 25.00 = 75

beforeEach(() => {
    ddbSend.mockReset();
    sesSend.mockReset().mockResolvedValue({});
    mockVerifyOrigin.mockReset().mockResolvedValue(true);
    mockResolveRecaptcha.mockReset().mockReturnValue(null);
});

describe("ORDER-CONFIRM-1 — the totals agree: the order is created as before", () => {
    it("expectedTotal equal to the server total → 201, order written as without the field (same order, same answer)", async () => {
        mockDb({ products: { [P1]: product(P1) } });
        const without = await call({ items: ONE });
        const orderWithout = structuredClone(storedOrder());
        ddbSend.mockClear();
        const withField = await call({ items: ONE, expectedTotal: 75 });
        expect(withField.statusCode).toBe(201);
        expect(without.statusCode).toBe(201);
        // The order id and the times differ per call; everything else is the same.
        const mask = (o: any) => ({ ...o, id: "", SK: "", createdAt: "", updatedAt: "", statusHistory: o.statusHistory.map((h: any) => ({ ...h, timestamp: "" })) });
        expect(mask(storedOrder())).toEqual(mask(orderWithout));
        expect(storedOrder().total).toBe(75);
        expect(Object.keys(JSON.parse(withField.body))).toEqual(["orderId", "orderNumber", "couponDiscount"]);
        expect(JSON.parse(withField.body)).toMatchObject({ orderNumber: "PPB-0007", couponDiscount: 0 });
    });

    for (const [name, expectedTotal, products] of [
        ["75", 75, { [P1]: product(P1) }],
        ["75.004", 75.004, { [P1]: product(P1) }],
        ["float noise (0.1 + 0.2 against a server total of 0.30)", 0.1 + 0.2, null],
    ] as const) {
        it(`equal after rounding: ${name} → 201`, async () => {
            const items = products ? ONE : [{ productId: P1, quantity: 1 }, { productId: P2, quantity: 1 }];
            mockDb({ products: products ?? { [P1]: product(P1, { price: "0.10" }), [P2]: product(P2, { price: "0.20" }) } });
            const res = await call({ items, expectedTotal });
            expect(res.statusCode).toBe(201);
            expect(transaction()).toBeDefined();
        });
    }

    it("no expectedTotal (a page loaded before this slice) → 201 as today, no comparison (the stored price differs from the cart's)", async () => {
        mockDb({ products: { [P1]: product(P1, { price: "30.00" }) } });
        const res = await call({ items: ONE });
        expect(res.statusCode).toBe(201);
        expect(storedOrder().total).toBe(90);
    });
});

describe("ORDER-CONFIRM-1 — the totals differ: 409 price-changed, nothing written", () => {
    it("product price raised after the cart was filled → 409 with the server figures; no UpdateCommand, no TransactWriteCommand", async () => {
        mockDb({ products: {
            [P1]: product(P1, { price: "30.00", personalizations: [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5" }] }),
            [P2]: product(P2, { price: "4.00", variants: [{ id: "g1", name: "Size", options: [{ value: "L", priceOverride: "6.00" }] }] }),
        }, delivery: { flatShippingCost: 10 } });
        const res = await call({ expectedTotal: 75, items: [
            { productId: P1, quantity: 2, personalizations: [{ id: "engr", label: "Engraving", value: "AB" }] },
            { productId: P2, quantity: 1, selectedVariant: "Size: L" },
        ] });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toEqual({
            code: "price-changed",
            error: "Prices have changed. Check the new total, then place the order again.",
            message: "Prices have changed. Check the new total, then place the order again.",
            total: 86, subtotal: 76, shippingCost: 10, couponDiscount: 0,
            items: [
                { productId: P1, quantity: 2, unitPrice: 35, totalPrice: 70 },
                { productId: P2, selectedVariant: "Size: L", quantity: 1, unitPrice: 6, totalPrice: 6 },
            ],
        });
        expect(commands().some((c) => c instanceof UpdateCommand)).toBe(false);
        expect(transaction()).toBeUndefined();
        expect(onlyReads()).toBe(true);
        expect(sesSend).not.toHaveBeenCalled();
    });

    it("product price lowered → 409 (the visitor also confirms a lower total)", async () => {
        mockDb({ products: { [P1]: product(P1, { price: "20.00" }) } });
        const res = await call({ items: ONE, expectedTotal: 75 });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ code: "price-changed", total: 60, subtotal: 60 });
        expect(onlyReads()).toBe(true);
    });

    it("delivery config changed (shipping cost 5 → 10) → 409 with the server's shippingCost", async () => {
        mockDb({ products: { [P1]: product(P1) }, delivery: { flatShippingCost: 10 } });
        const res = await call({ items: ONE, expectedTotal: 80 });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ shippingCost: 10, total: 85 });
        expect(onlyReads()).toBe(true);
    });

    it("delivery config changed (free-delivery threshold now 50) → 409 with the server's shippingCost 0", async () => {
        mockDb({ products: { [P1]: product(P1) }, delivery: { flatShippingCost: 10, freeDeliveryThreshold: 50 } });
        const res = await call({ items: ONE, expectedTotal: 85 });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ shippingCost: 0, total: 75 });
        expect(onlyReads()).toBe(true);
    });

    it("coupon no longer valid → 409 with the server's couponDiscount 0", async () => {
        mockDb({ products: { [P1]: product(P1) }, coupon: { ...COUPON, status: "inactive" } });
        const res = await call({ items: ONE, couponCode: "TEN", expectedTotal: 67.5 });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ couponDiscount: 0, total: 75 });
        expect(onlyReads()).toBe(true);
    });

    it("coupon discount changed (10% → 20%) → 409 with the server's couponDiscount", async () => {
        mockDb({ products: { [P1]: product(P1) }, coupon: { ...COUPON, value: "20" } });
        const res = await call({ items: ONE, couponCode: "TEN", expectedTotal: 67.5 });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ couponDiscount: 15, total: 60 });
        expect(onlyReads()).toBe(true);
        // The same coupon with the total the visitor now saw → created, and the coupon use is counted as before.
        ddbSend.mockClear();
        const again = await call({ items: ONE, couponCode: "TEN", expectedTotal: 60 });
        expect(again.statusCode).toBe(201);
        expect(transaction()!.input.TransactItems!.some((t: any) => t.Update?.Key?.SK === "COUPON#cp1")).toBe(true);
    });

    it("second press with the 409's total → 201 (one confirmation is enough when nothing changes again)", async () => {
        mockDb({ products: { [P1]: product(P1, { price: "30.00" }) }, delivery: { flatShippingCost: 10 } });
        const first = await call({ items: ONE, expectedTotal: 85 });
        expect(first.statusCode).toBe(409);
        const { total } = JSON.parse(first.body);
        ddbSend.mockClear();
        const second = await call({ items: ONE, expectedTotal: total });
        expect(second.statusCode).toBe(201);
        expect(storedOrder().total).toBe(100);
    });
});

describe("ORDER-CONFIRM-1 — the answer's message is the tenant's pricesChanged text (ruling OC1-TEXT = A)", () => {
    const RO_TEXT = "Prețurile s-au schimbat. Verifică noul total, apoi plasează din nou comanda.";
    const EN_TEXT = "Prices have changed. Check the new total, then place the order again.";
    const refusal = async (tenant: Record<string, any>) => {
        mockDb({ products: { [P1]: product(P1, { price: "30.00" }) }, tenant });
        const res = await call({ items: ONE, expectedTotal: 75 });
        expect(res.statusCode).toBe(409);
        expect(onlyReads()).toBe(true);
        return JSON.parse(res.body);
    };

    it("message: no locale, no override → the default (the en pack text); error stays English", async () => {
        const body = await refusal({});
        expect(body.message).toBe(EN_TEXT);
        expect(body.error).toBe(EN_TEXT);
    });

    it("message: tenant locale ro-RO → the ro pack text; error stays English", async () => {
        const body = await refusal({ locale: "ro-RO" });
        expect(body.message).toBe(RO_TEXT);
        expect(body.error).toBe(EN_TEXT);
    });

    it("message: a tenant override (Labels page, commerceStrings.pricesChanged) → the override, also on a ro-RO tenant", async () => {
        expect((await refusal({ commerceStrings: { pricesChanged: "Our prices moved. Please check." } })).message).toBe("Our prices moved. Please check.");
        expect((await refusal({ locale: "ro-RO", commerceStrings: { pricesChanged: "Prețuri noi." } })).message).toBe("Prețuri noi.");
    });

    it("message: a blank override (\"\" or spaces) → the pack text of the tenant's locale", async () => {
        expect((await refusal({ commerceStrings: { pricesChanged: "" } })).message).toBe(EN_TEXT);
        expect((await refusal({ locale: "ro-RO", commerceStrings: { pricesChanged: "   " } })).message).toBe(RO_TEXT);
    });

    it("the answer holds only the figures and the one text: exactly these keys", async () => {
        const body = await refusal({ commerceStrings: { pricesChanged: "x", other: "secret" }, name: "Tenant One" });
        expect(Object.keys(body).sort()).toEqual(["code", "couponDiscount", "error", "items", "message", "shippingCost", "subtotal", "total"]);
        expect(Object.keys(body.items[0]).sort()).toEqual(["productId", "quantity", "totalPrice", "unitPrice"]);
    });
});

describe("ORDER-CONFIRM-1 — expectedTotal not a valid amount: 400 input refusal", () => {
    for (const [name, expectedTotal] of [["negative", -1], ["a text", "75.00"], ["not a number (NaN, sent by JSON as null)", NaN]] as const) {
        it(`expectedTotal ${name} → 400, nothing read or written`, async () => {
            mockDb({ products: { [P1]: product(P1) } });
            const res = await call({ items: ONE, expectedTotal });
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body).error).toBe("Invalid input");
            expect(JSON.parse(res.body).details.fieldErrors).toHaveProperty("expectedTotal");
            expect(ddbSend).not.toHaveBeenCalled();
        });
    }
});
