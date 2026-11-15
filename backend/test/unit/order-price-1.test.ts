import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * ORDER-PRICE-1 (docs/slices/order-price-1.md § 1 item 2, item 5) — the order handler charges the shared price rule.
 * Same style as `catalog-mode.test.ts`: the real `orders/create.ts`, the real shared `linePrice` and schema, the real
 * mail template code; mocked are `db.js` (`send`), the origin and reCAPTCHA helpers and the SES client. Credential-free.
 * Each row inspects the `TransactWriteCommand` that would reach DynamoDB (or that none is sent).
 */

const { ddbSend, sesSend, mockVerifyOrigin, mockResolveRecaptcha } = vi.hoisted(() => {
    // `create.ts` reads SES_FROM_EMAIL at import; set it so the confirmation mail (a reader of totalPrice) runs.
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

/** The custom "placed" template prints the item lines (the default one does not), so the mail row can read them. */
const TENANT = {
    PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", commerceEnabled: true, currency: "USD",
    orderEmailConfig: { templates: { placed: { subject: "Order {{orderNumber}}", body: "{{items}}\nSubtotal {{subtotal}}", sendToCustomer: true } } },
};
const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";

/** A stored product with the fields the price rule reads. */
const product = (id: string, extra: Record<string, any>) => ({
    PK: "TENANT#t1", SK: `PRODUCT#${id}`, id, title: `Product ${id.slice(-1)}`, price: "12.50",
    volumePricing: [], variants: [], personalizations: [], ...extra,
});
const SIZE_GROUP = { id: "g1", name: "Size", options: [{ value: "S" }, { value: "L", priceOverride: "20.00" }, { value: "XL" }] };
const COLOUR_GROUP = { id: "g2", name: "Colour", options: [{ value: "Red", priceOverride: "99.00" }] };

let products: Record<string, any> = {};
function mockDb(stored: Record<string, any>) {
    products = stored;
    ddbSend.mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) {
            const sk = String(cmd.input.Key?.SK);
            if (sk.startsWith("TENANT#")) return { Item: structuredClone(TENANT) };
            if (sk.startsWith("PRODUCT#")) {
                const p = products[sk.slice("PRODUCT#".length)];
                return { Item: p ? structuredClone(p) : undefined };
            }
            return {};
        }
        if (cmd instanceof UpdateCommand && cmd.input.Key?.SK === "COUNTER#ORDER") return { Attributes: { currentValue: 7 } };
        return {};
    });
}

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const transaction = () => commands().find((c) => c instanceof TransactWriteCommand) as TransactWriteCommand | undefined;
const storedOrder = () => transaction()!.input.TransactItems![0].Put!.Item!;

const body = (items: unknown[]) => ({ items, customerEmail: "buyer@example.com", customerName: "Buyer", paymentMethod: "cod" });
const orderEvent = (items: unknown[]) => ({
    headers: { "x-tenant-id": "t1", origin: "https://t1.test" },
    requestContext: { http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body(items)),
}) as any;
const call = async (items: unknown[]) => (await (createOrder as any)(orderEvent(items), {} as any, () => {})) as any;

beforeEach(() => {
    ddbSend.mockReset();
    sesSend.mockReset().mockResolvedValue({});
    mockVerifyOrigin.mockReset().mockResolvedValue(true);
    mockResolveRecaptcha.mockReset().mockReturnValue(null);
});

describe("ORDER-PRICE-1 — the server charges the shared rule", () => {
    it("price only, quantity 2 → unitPrice \"12.50\", totalPrice 25, subtotal 25", async () => {
        mockDb({ [P1]: product(P1, {}) });
        const res = await call([{ productId: P1, quantity: 2 }]);
        expect(res.statusCode).toBe(201);
        const item = storedOrder().items[0];
        expect(item.unitPrice).toBe("12.50");
        expect(item.totalPrice).toBe(25);
        expect(storedOrder().subtotal).toBe(25);
    });

    it("volume tiers: quantity 10 with a tier at 10 → the tier price is charged (was the plain price)", async () => {
        mockDb({ [P1]: product(P1, { price: "10.00", volumePricing: [{ minQuantity: 5, price: "9.00" }, { minQuantity: 10, price: "8.00" }] }) });
        const res = await call([{ productId: P1, quantity: 10 }]);
        expect(res.statusCode).toBe(201);
        expect(storedOrder().items[0]).toMatchObject({ unitPrice: "8.00", totalPrice: 80 });
        expect(storedOrder().subtotal).toBe(80);
    });

    it("one added cost \"5\", unit \"12.50\", quantity 2 → unitPrice \"17.50\", totalPrice 35 (never 25.001)", async () => {
        mockDb({ [P1]: product(P1, { personalizations: [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5" }] }) });
        const res = await call([{ productId: P1, quantity: 2, personalizations: [{ id: "engr", label: "Engraving", value: "AB" }] }]);
        expect(res.statusCode).toBe(201);
        const item = storedOrder().items[0];
        expect(item.unitPrice).toBe("17.50");
        expect(item.totalPrice).toBe(35);
        expect(item.personalizations).toEqual([{ id: "engr", label: "Engraving", value: "AB", addedCost: "5" }]);
    });

    it("personalization without id, with label (a cart saved before this slice) → accepted; cost added once", async () => {
        mockDb({ [P1]: product(P1, { personalizations: [
            { id: "gift", label: "Gift wrap", type: "text", required: false, addedCost: "3" },
            { id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5" },
        ] }) });
        // the exact item shape CheckoutPageView sent before this slice (addedCost is stripped by the schema)
        const res = await call([{ productId: P1, quantity: 2, personalizations: [{ label: "Engraving", value: "AB", addedCost: "5" }] }]);
        expect(res.statusCode).toBe(201);
        expect(storedOrder().items[0]).toMatchObject({ unitPrice: "17.50", totalPrice: 35 });
        expect(storedOrder().items[0].personalizations).toEqual([{ label: "Engraving", value: "AB", addedCost: "5" }]);
    });

    it("personalization with id → matched by id (the label sent differs from the stored one)", async () => {
        mockDb({ [P1]: product(P1, { personalizations: [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5" }] }) });
        const res = await call([{ productId: P1, quantity: 1, personalizations: [{ id: "engr", label: "Old label", value: "AB" }] }]);
        expect(res.statusCode).toBe(201);
        expect(storedOrder().items[0].unitPrice).toBe("17.50");
    });

    it("unmatched personalization → adds 0, as before", async () => {
        mockDb({ [P1]: product(P1, { personalizations: [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5" }] }) });
        const res = await call([{ productId: P1, quantity: 1, personalizations: [{ label: "Unknown", value: "x" }] }]);
        expect(res.statusCode).toBe(201);
        expect(storedOrder().items[0]).toMatchObject({ unitPrice: "12.50", totalPrice: 12.5 });
    });

    it("label \"Size: L\", group Size with L → option L's override", async () => {
        mockDb({ [P1]: product(P1, { variants: [SIZE_GROUP] }) });
        const res = await call([{ productId: P1, quantity: 2, selectedVariant: "Size: L" }]);
        expect(res.statusCode).toBe(201);
        expect(storedOrder().items[0]).toMatchObject({ unitPrice: "20.00", totalPrice: 40, selectedVariant: "Size: L" });
    });

    it("label \"Size: L, Colour: Red\" (two groups) → option L of the first group (the second group's override is ignored)", async () => {
        mockDb({ [P1]: product(P1, { variants: [SIZE_GROUP, COLOUR_GROUP] }) });
        const res = await call([{ productId: P1, quantity: 1, selectedVariant: "Size: L, Colour: Red" }]);
        expect(res.statusCode).toBe(201);
        expect(storedOrder().items[0].unitPrice).toBe("20.00");
    });

    it("label of an option without override → tier or base rule", async () => {
        mockDb({ [P1]: product(P1, { variants: [SIZE_GROUP] }) });
        const res = await call([{ productId: P1, quantity: 1, selectedVariant: "Size: S" }]);
        expect(res.statusCode).toBe(201);
        expect(storedOrder().items[0].unitPrice).toBe("12.50");
    });

    for (const [name, selectedVariant] of [["matches no option", "Size: M"], ["is absent", undefined], ["is empty", ""]] as const) {
        it(`label ${name}, and the group has an override → 400, no write`, async () => {
            mockDb({ [P1]: product(P1, { variants: [SIZE_GROUP] }) });
            const res = await call([{ productId: P1, quantity: 1, ...(selectedVariant !== undefined ? { selectedVariant } : {}) }]);
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body).error).toBe(`Variant selection not recognised for product: ${P1}`);
            expect(transaction()).toBeUndefined();
        });
    }

    it("label matches two options → 400, no write", async () => {
        const ambiguous = { id: "g1", name: "Size", options: [{ value: "L", priceOverride: "20" }, { value: "L, XL", priceOverride: "30" }] };
        mockDb({ [P1]: product(P1, { variants: [ambiguous] }) });
        const res = await call([{ productId: P1, quantity: 1, selectedVariant: "Size: L, XL" }]);
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe(`Variant selection not recognised for product: ${P1}`);
        expect(transaction()).toBeUndefined();
    });

    it("product without any priceOverride, any label → label not needed; order placed", async () => {
        const noOverride = { id: "g1", name: "Size", options: [{ value: "S" }, { value: "L" }] };
        mockDb({ [P1]: product(P1, { variants: [noOverride] }) });
        for (const selectedVariant of ["anything", undefined]) {
            ddbSend.mockClear();
            const res = await call([{ productId: P1, quantity: 1, ...(selectedVariant ? { selectedVariant } : {}) }]);
            expect(res.statusCode).toBe(201);
            expect(storedOrder().items[0].unitPrice).toBe("12.50");
        }
    });

    for (const [name, extra] of [
        ["price \"\"", { price: "" }],
        ["price \"abc\"", { price: "abc" }],
        ["price negative", { price: "-1" }],
        ["a tier price that does not parse", { volumePricing: [{ minQuantity: 1, price: "x" }] }],
        ["an added cost that does not parse", { personalizations: [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "five" }] }],
    ] as const) {
        it(`${name} → 400 with a named error, no write`, async () => {
            mockDb({ [P1]: product(P1, extra) });
            const res = await call([{ productId: P1, quantity: 1, personalizations: [{ id: "engr", label: "Engraving", value: "AB" }] }]);
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body).error).toBe(`Invalid price for product: ${P1}`);
            expect(transaction()).toBeUndefined();
        });
    }

    it("the server never reads a price or a cost from the request", async () => {
        mockDb({ [P1]: product(P1, { personalizations: [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5" }] }) });
        const res = await call([{ productId: P1, quantity: 1, unitPrice: "0.01", totalPrice: "0.01", personalizations: [{ id: "engr", label: "Engraving", value: "AB", addedCost: "0" }] }]);
        expect(res.statusCode).toBe(201);
        expect(storedOrder().items[0]).toMatchObject({ unitPrice: "17.50", totalPrice: 17.5 });
    });

    it("stored order: unitPrice string with two decimals; totalPrice number; subtotal their sum, rounded to cents; mail lines read it", async () => {
        mockDb({ [P1]: product(P1, { price: "0.10" }), [P2]: product(P2, { price: "0.20" }) });
        const res = await call([{ productId: P1, quantity: 1 }, { productId: P2, quantity: 1 }]);
        expect(res.statusCode).toBe(201);
        const order = storedOrder();
        expect(order.items.map((i: any) => [i.unitPrice, i.totalPrice])).toEqual([["0.10", 0.1], ["0.20", 0.2]]);
        expect(typeof order.items[0].unitPrice).toBe("string");
        expect(typeof order.items[0].totalPrice).toBe("number");
        expect(order.subtotal).toBe(0.3); // not 0.30000000000000004
        expect(order.total).toBe(0.3);
        // the confirmation mail (create.ts item lines) formats the stored totalPrice
        const mailBody: string = sesSend.mock.calls[0][0].input.Message.Body.Text.Data;
        expect(mailBody).toContain("Product 1 x1 — 0.10 USD");
        expect(mailBody).toContain("Product 2 x1 — 0.20 USD");
        expect(mailBody).toContain("Subtotal 0.30");
    });
});
