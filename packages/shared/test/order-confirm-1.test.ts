// ORDER-CONFIRM-1 (docs/slices/order-confirm-1.md § 1 items 1-2) — the order request's `expectedTotal` and the one
// comparison in whole cents. Each `it` names the taxonomy row it binds. Pure: no I/O.
import { describe, expect, it } from "vitest";
import { OrderInputSchema, sameAmountInCents } from "../src/index";

const BASE = {
    items: [{ productId: "c0000000-0000-4000-8000-000000000001", quantity: 1 }],
    customerEmail: "buyer@example.com", customerName: "Buyer", paymentMethod: "cash_on_delivery",
};

describe("ORDER-CONFIRM-1 — sameAmountInCents", () => {
    it("equal after rounding: 75 / 75.004 / float noise (0.1 + 0.2 vs 0.3) → equal", () => {
        expect(sameAmountInCents(75, 75)).toBe(true);
        expect(sameAmountInCents(75, 75.004)).toBe(true);
        expect(sameAmountInCents(0.1 + 0.2, 0.3)).toBe(true);
        expect(sameAmountInCents(12.5 + 7.45 - 0.95, 19)).toBe(true);
    });

    it("one cent apart, raised or lowered → not equal", () => {
        expect(sameAmountInCents(75, 75.01)).toBe(false);
        expect(sameAmountInCents(75, 74.99)).toBe(false);
        expect(sameAmountInCents(75, 75.005)).toBe(false); // 75.005 rounds half up to 75.01
    });
});

describe("ORDER-CONFIRM-1 — OrderInputSchema.expectedTotal", () => {
    it("no expectedTotal → accepted (a page loaded before this slice)", () => {
        const parsed = OrderInputSchema.safeParse(BASE);
        expect(parsed.success).toBe(true);
        expect(parsed.data?.expectedTotal).toBeUndefined();
    });

    it("0 and 75.5 → accepted as numbers", () => {
        for (const expectedTotal of [0, 75.5]) {
            expect(OrderInputSchema.safeParse({ ...BASE, expectedTotal }).data?.expectedTotal).toBe(expectedTotal);
        }
    });

    for (const [name, expectedTotal] of [
        ["negative", -0.01], ["a text", "75.00"], ["not a number (NaN)", NaN], ["infinite", Infinity], ["null", null],
    ] as const) {
        it(`expectedTotal ${name} → refused`, () => {
            const parsed = OrderInputSchema.safeParse({ ...BASE, expectedTotal });
            expect(parsed.success).toBe(false);
            expect(parsed.error?.flatten().fieldErrors).toHaveProperty("expectedTotal");
        });
    }
});
