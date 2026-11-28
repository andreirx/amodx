// CMRC-1B (docs/slices/cmrc-1b.md; docs/slices/cmrc-1.md § 5.6) — `CustomerSelfRequestSchema`, the request body of
// POST /customer/order-history and POST /customer/profile-read: a structure check only. Pure: no I/O.
import { describe, expect, it } from "vitest";
import { CustomerSelfRequestSchema } from "../src/index";

const accepts = (value: unknown) => CustomerSelfRequestSchema.safeParse(value).success;

describe("CMRC-1B — CustomerSelfRequestSchema: exactly { email: non-empty string }", () => {
    it("accepts the shape the renderer builds, and returns the email unchanged (no trim, no case change)", () => {
        expect(CustomerSelfRequestSchema.parse({ email: " Ana@Example.COM " })).toEqual({ email: " Ana@Example.COM " });
    });

    it.each(["an a@example.com", "a#b@example.com", "not-an-email", "x".repeat(1000), " "])(
        "has no format rule and no length bound: %j is accepted (the read then finds nothing)", (email) => {
            expect(accepts({ email })).toBe(true);
        });

    it.each([
        ["no field", {}],
        ["an empty string", { email: "" }],
        ["a number", { email: 7 }],
        ["null", { email: null }],
        ["a list", { email: ["ana@example.com"] }],
        ["an extra field", { email: "ana@example.com", tenantId: "t1" }],
        ["an extra field next to a valid email (an order id)", { email: "ana@example.com", orderId: "o-1" }],
        ["not an object", "ana@example.com"],
        ["a list instead of an object", [{ email: "ana@example.com" }]],
        ["null instead of an object", null],
    ])("refuses %s", (_name, value) => {
        expect(accepts(value)).toBe(false);
    });
});
