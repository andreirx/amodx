import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * ORDER-CHECKOUT-1 (docs/slices/order-checkout-1.md § 1 items 1-2) — the order handler accepts the payment values the
 * checkout sends ("cash_on_delivery", "bank_transfer"), refuses any other, stores the value as it arrives, and answers
 * the order id as `orderId` (the field the checkout reads for the confirmation address). Same style as
 * `order-price-1.test.ts`: the real `orders/create.ts` and the real shared schema; mocked are `db.js` (`send`), the
 * origin and reCAPTCHA helpers and the SES client. SES_FROM_EMAIL is not set, so no mail is built. Credential-free.
 */

const { ddbSend, mockVerifyOrigin, mockResolveRecaptcha } = vi.hoisted(() => ({
    ddbSend: vi.fn(), mockVerifyOrigin: vi.fn(), mockResolveRecaptcha: vi.fn(),
}));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/tenant-verify.js", () => ({ verifyTenantFromOrigin: mockVerifyOrigin }));
vi.mock("../../src/lib/recaptcha.js", () => ({ resolveRecaptchaConfig: mockResolveRecaptcha, verifyRecaptcha: vi.fn() }));
vi.mock("@aws-sdk/client-ses", () => ({
    SESClient: class { send = vi.fn(); },
    SendEmailCommand: class { constructor(public input: any) {} },
}));

import { handler as createOrder } from "../../src/orders/create.js";

const TENANT = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", commerceEnabled: true, currency: "USD" };
const P1 = "c0000000-0000-4000-8000-000000000001";
const PRODUCT = { PK: "TENANT#t1", SK: `PRODUCT#${P1}`, id: P1, title: "Rug", price: "12.50", volumePricing: [], variants: [], personalizations: [] };

beforeEach(() => {
    ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) {
            const sk = String(cmd.input.Key?.SK);
            if (sk.startsWith("TENANT#")) return { Item: structuredClone(TENANT) };
            if (sk === `PRODUCT#${P1}`) return { Item: structuredClone(PRODUCT) };
            return {};
        }
        if (cmd instanceof UpdateCommand && cmd.input.Key?.SK === "COUNTER#ORDER") return { Attributes: { currentValue: 7 } };
        return {};
    });
    mockVerifyOrigin.mockReset().mockResolvedValue(true);
    mockResolveRecaptcha.mockReset().mockReturnValue(null);
});

const ABSENT = Symbol("absent");
/** An order body with one valid line; `paymentMethod` is left out when `ABSENT`. */
const body = (paymentMethod: unknown) => ({
    items: [{ productId: P1, quantity: 1 }], customerEmail: "buyer@example.com", customerName: "Buyer",
    ...(paymentMethod === ABSENT ? {} : { paymentMethod }),
});
const call = async (paymentMethod: unknown) => (await (createOrder as any)({
    headers: { "x-tenant-id": "t1", origin: "https://t1.test" },
    requestContext: { http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body(paymentMethod)),
}, {} as any, () => {})) as any;
const transaction = () => ddbSend.mock.calls.map((c) => c[0]).find((c) => c instanceof TransactWriteCommand) as TransactWriteCommand | undefined;
const storedOrder = () => transaction()!.input.TransactItems![0].Put!.Item!;

describe("ORDER-CHECKOUT-1 — the payment values of the checkout", () => {
    for (const method of ["cash_on_delivery", "bank_transfer"]) {
        it(`"${method}" → 201; the stored order holds "${method}"; the answer's orderId is the stored order id`, async () => {
            const res = await call(method);
            expect(res.statusCode).toBe(201);
            expect(storedOrder().paymentMethod).toBe(method);
            const answer = JSON.parse(res.body);
            expect(Object.keys(answer).sort()).toEqual(["couponDiscount", "orderId", "orderNumber"]);
            expect(answer.orderId).toBe(storedOrder().id);
        });
    }

    for (const [name, method] of [["\"cod\" (the old input value)", "cod"], ["another text (\"card\")", "card"], ["no paymentMethod field", ABSENT]] as const) {
        it(`${name} → 400 "Invalid input", the details name paymentMethod, no database call`, async () => {
            const res = await call(method);
            expect(res.statusCode).toBe(400);
            const answer = JSON.parse(res.body);
            expect(answer.error).toBe("Invalid input");
            expect(Object.keys(answer.details.fieldErrors)).toEqual(["paymentMethod"]);
            expect(ddbSend).not.toHaveBeenCalled(); // the schema runs before the tenant read (create.ts)
        });
    }
});
