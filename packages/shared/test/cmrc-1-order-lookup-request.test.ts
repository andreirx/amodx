// CMRC-1L (docs/slices/cmrc-1l.md; docs/slices/cmrc-1.md § 5.6 D3) — `OrderLookupRequestSchema`, the request body of
// POST /customer/order-lookup (a structure check only), and `ORDER_VIEW_FIELDS`, the attributes of an order that the
// route may answer. Pure: no I/O.
import { describe, expect, it } from "vitest";
import { ORDER_VIEW_FIELDS, OrderLookupRequestSchema } from "../src/index";

const accepts = (value: unknown) => OrderLookupRequestSchema.safeParse(value).success;

describe("CMRC-1L — OrderLookupRequestSchema: exactly { orderId, email }, each a non-empty string", () => {
    it("accepts the shape the renderer builds, and returns both values unchanged (no trim, no case change)", () => {
        expect(OrderLookupRequestSchema.parse({ orderId: " O-1 ", email: " Ana@Example.COM " })).toEqual({ orderId: " O-1 ", email: " Ana@Example.COM " });
    });

    it.each([
        ["an email with a space", { orderId: "o-1", email: "an a@example.com" }],
        ["an email that is one space", { orderId: "o-1", email: " " }],
        ["text that is not an address", { orderId: "o-1", email: "not-an-email" }],
        ["an order id with '#'", { orderId: "o-1#x", email: "ana@example.com" }],
        ["an order id that is not a UUID", { orderId: "confirmare", email: "ana@example.com" }],
        ["long values", { orderId: "x".repeat(1000), email: "y".repeat(1000) }],
    ])("has no format rule and no length bound: %s is accepted (the read then finds nothing)", (_name, value) => {
        expect(accepts(value)).toBe(true);
    });

    it.each([
        ["no field", {}],
        ["no order id", { email: "ana@example.com" }],
        ["no email", { orderId: "o-1" }],
        ["an empty order id", { orderId: "", email: "ana@example.com" }],
        ["an empty email", { orderId: "o-1", email: "" }],
        ["a number as the order id", { orderId: 7, email: "ana@example.com" }],
        ["null as the email", { orderId: "o-1", email: null }],
        ["a list as the email", { orderId: "o-1", email: ["ana@example.com"] }],
        ["an extra field", { orderId: "o-1", email: "ana@example.com", tenantId: "t1" }],
        ["not an object", "o-1"],
        ["a list instead of an object", [{ orderId: "o-1", email: "ana@example.com" }]],
        ["null instead of an object", null],
    ])("refuses %s", (_name, value) => {
        expect(accepts(value)).toBe(false);
    });
});

describe("CMRC-1L — ORDER_VIEW_FIELDS: the 17 attributes of an order that the order pages read", () => {
    it("is exactly this list (docs/slices/cmrc-1.md § 5.6; docs/platform-decisions.md PD-002, amendment of 2026-11-28)", () => {
        expect([...ORDER_VIEW_FIELDS]).toEqual([
            "id", "orderNumber", "createdAt", "currency", "customerName", "customerPhone", "discount", "estimatedDeliveryDate", "items",
            "paymentMethod", "shippingAddress", "shippingCost", "status", "statusHistory", "subtotal", "total", "trackingNumber",
        ]);
        expect(new Set(ORDER_VIEW_FIELDS).size).toBe(17);
    });

    it.each(["customerEmail", "internalNotes", "billingDetails", "couponCode", "couponDiscount", "PK", "SK", "tenantId"])(
        "does not hold %s", (attribute) => {
            expect((ORDER_VIEW_FIELDS as readonly string[]).includes(attribute)).toBe(false);
        });
});
