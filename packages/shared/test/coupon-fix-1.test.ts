// COUPON-FIX-1 (docs/slices/coupon-fix-1.md § 2 rules 1-2) — the coupon rule `evaluateCoupon`. Each `it` names the
// taxonomy row it binds. Pure: no I/O.
import { describe, expect, it } from "vitest";
import { evaluateCoupon, amountInCents, isCouponType, CouponPrecheckItemSchema, type CouponCartLine, type CouponRuleRecord } from "../src/index";

const NOW = new Date("2026-11-21T12:00:00.000Z");
const base: CouponRuleRecord = { status: "active", type: "percentage", value: "10", usageLimit: 0, usageCount: 0 };
const line = (productId: string, lineTotalCents: number, categoryIds: string[] = []): CouponCartLine =>
    ({ productId, categoryIds, lineTotalCents });
const A = line("A", 5000, ["cat-a"]);
const B = line("B", 2500, ["cat-b"]);

/** The discount arithmetic of orders/create.ts before this slice (whole subtotal), for the golden rows. */
function discountBeforeSlice(coupon: CouponRuleRecord, subtotal: number): number {
    const value = parseFloat(coupon.value);
    let d = 0;
    if (coupon.type === "percentage") {
        d = (value / 100) * subtotal;
        const max = coupon.maximumDiscount ? parseFloat(coupon.maximumDiscount) : 0;
        if (max > 0 && d > max) d = max;
    } else if (coupon.type === "fixed_amount") d = value;
    if (d > subtotal) d = subtotal;
    return Math.round(d * 100) / 100;
}

describe("COUPON-FIX-1 rule — each reason of the union", () => {
    it("not-active: status disabled / expired", () => {
        expect(evaluateCoupon({ ...base, status: "disabled" }, [A], NOW)).toEqual({ applies: false, reason: "not-active" });
        expect(evaluateCoupon({ ...base, status: "expired" }, [A], NOW)).toEqual({ applies: false, reason: "not-active" });
    });
    it("not-yet-valid / expired, and the boundary dates equal to validFrom / validUntil apply", () => {
        expect(evaluateCoupon({ ...base, validFrom: "2026-11-21T12:00:00.001Z" }, [A], NOW)).toEqual({ applies: false, reason: "not-yet-valid" });
        expect(evaluateCoupon({ ...base, validUntil: "2026-11-21T11:59:59.999Z" }, [A], NOW)).toEqual({ applies: false, reason: "expired" });
        expect(evaluateCoupon({ ...base, validFrom: NOW.toISOString() }, [A], NOW).applies).toBe(true);
        expect(evaluateCoupon({ ...base, validUntil: NOW.toISOString() }, [A], NOW).applies).toBe(true);
    });
    it("usage-limit: usageCount == usageLimit refuses; one below applies; limit 0 or absent is unlimited", () => {
        expect(evaluateCoupon({ ...base, usageLimit: 1, usageCount: 1 }, [A], NOW)).toEqual({ applies: false, reason: "usage-limit" });
        expect(evaluateCoupon({ ...base, usageLimit: 2, usageCount: 1 }, [A], NOW).applies).toBe(true);
        expect(evaluateCoupon({ ...base, usageLimit: 0, usageCount: 99 }, [A], NOW).applies).toBe(true);
        const { usageLimit: _l, usageCount: _c, ...noUsage } = base;
        expect(evaluateCoupon(noUsage, [A], NOW).applies).toBe(true);
    });
    it("below-minimum: the whole subtotal is under minimumOrderAmount; equal applies", () => {
        expect(evaluateCoupon({ ...base, minimumOrderAmount: "75.01" }, [A, B], NOW)).toEqual({ applies: false, reason: "below-minimum" });
        expect(evaluateCoupon({ ...base, minimumOrderAmount: "75" }, [A, B], NOW).applies).toBe(true);
    });
    it("no-covered-line: limited to product A, cart B only", () => {
        expect(evaluateCoupon({ ...base, applicableProducts: ["A"] }, [B], NOW)).toEqual({ applies: false, reason: "no-covered-line" });
    });
    it("checks run in the documented order: a disabled, expired, used-up coupon reports not-active", () => {
        expect(evaluateCoupon({ ...base, status: "disabled", validUntil: "2020-01-01", usageLimit: 1, usageCount: 1 }, [A], NOW))
            .toEqual({ applies: false, reason: "not-active" });
    });
});

describe("COUPON-FIX-1 rule — customer-limit (§ 6, finding 1)", () => {
    const once = { ...base, perCustomerLimit: 1 };
    it("customerUseCount at the limit → customer-limit; below → applies", () => {
        expect(evaluateCoupon(once, [A], NOW, 1)).toEqual({ applies: false, reason: "customer-limit" });
        expect(evaluateCoupon(once, [A], NOW, 0).applies).toBe(true);
    });
    it("customerUseCount absent (the pre-check: customer unknown) → the per-customer limit is not checked", () => {
        expect(evaluateCoupon(once, [A], NOW).applies).toBe(true);
    });
    it("perCustomerLimit 0 or absent → no per-customer limit, whatever the count", () => {
        expect(evaluateCoupon({ ...base, perCustomerLimit: 0 }, [A], NOW, 99).applies).toBe(true);
        expect(evaluateCoupon(base, [A], NOW, 99).applies).toBe(true);
    });
    it("runs after usage-limit and before below-minimum", () => {
        expect(evaluateCoupon({ ...once, usageLimit: 1, usageCount: 1 }, [A], NOW, 1)).toEqual({ applies: false, reason: "usage-limit" });
        expect(evaluateCoupon({ ...once, minimumOrderAmount: "1000" }, [A], NOW, 1)).toEqual({ applies: false, reason: "customer-limit" });
    });
});

describe("COUPON-FIX-1 — isCouponType (§ 6 unknown coupon type)", () => {
    it("the two schema types → true; anything else → false; evaluateCoupon throws on an unknown type", () => {
        expect(isCouponType("percentage")).toBe(true);
        expect(isCouponType("fixed_amount")).toBe(true);
        for (const t of ["percent", "fixed", "", undefined, null, 5, "toString", "__proto__"]) expect(isCouponType(t)).toBe(false);
        expect(() => evaluateCoupon({ ...base, type: "bogus" as any }, [A], NOW)).toThrow("Unknown coupon type: bogus");
    });
});

describe("COUPON-FIX-1 — CouponPrecheckItemSchema (CF1-PRECHECK-LINES = B)", () => {
    it("productId, quantity, lineTotal; a request categoryIds is dropped", () => {
        expect(CouponPrecheckItemSchema.parse({ productId: "p", quantity: 2, lineTotal: 12.5, categoryIds: ["x"] }))
            .toEqual({ productId: "p", quantity: 2, lineTotal: 12.5 });
    });
    it("refuses a missing or negative lineTotal, a non-integer or zero quantity, NaN", () => {
        for (const bad of [{ productId: "p", quantity: 1 }, { productId: "p", quantity: 1, lineTotal: -1 },
            { productId: "p", quantity: 1.5, lineTotal: 1 }, { productId: "p", quantity: 0, lineTotal: 1 },
            { productId: "p", quantity: 1, lineTotal: NaN }, { productId: "", quantity: 1, lineTotal: 1 }]) {
            expect(CouponPrecheckItemSchema.safeParse(bad).success).toBe(false);
        }
    });
});

describe("COUPON-FIX-1 — money rule CF1-MONEY-PRESERVATION = B: one witness per class of changed outcome", () => {
    it("percentage tie: 50% of 0.29 → 15 cents (old float code: 0.14)", () => {
        expect(evaluateCoupon({ ...base, value: "50" }, [line("A", 29)], NOW)).toMatchObject({ discountCents: 15 });
        expect(discountBeforeSlice({ ...base, value: "50" }, 0.29)).toBe(0.14);
    });
    it("fixed value with a third decimal: \"0.145\" → 15 cents (old: 0.14)", () => {
        const fixed = { ...base, type: "fixed_amount" as const, value: "0.145" };
        expect(evaluateCoupon(fixed, [A], NOW)).toMatchObject({ discountCents: 15 });
        expect(discountBeforeSlice(fixed, 50)).toBe(0.14);
    });
    it("cap with a third decimal: maximumDiscount \"0.145\" → 15 cents (old: 0.14)", () => {
        const capped = { ...base, value: "50", maximumDiscount: "0.145" };
        expect(evaluateCoupon(capped, [A], NOW)).toMatchObject({ discountCents: 15 });
        expect(discountBeforeSlice(capped, 50)).toBe(0.14);
    });
    it("minimum with a third decimal: subtotal 1.00, minimumOrderAmount \"1.004\" → applies (old: did not apply)", () => {
        expect(evaluateCoupon({ ...base, minimumOrderAmount: "1.004" }, [line("A", 100)], NOW).applies).toBe(true);
        expect(1.0 >= parseFloat("1.004")).toBe(false); // the old comparison `subtotal >= minimumOrderAmount`
        expect(evaluateCoupon({ ...base, minimumOrderAmount: "1.005" }, [line("A", 100)], NOW)).toEqual({ applies: false, reason: "below-minimum" });
    });
});

describe("COUPON-FIX-1 rule — coupon without limits: totals equal to today's (golden per type)", () => {
    it("percentage golden: 10% of 75.00 → 750 cents, every line covered", () => {
        const out = evaluateCoupon(base, [A, B], NOW);
        expect(out).toEqual({ applies: true, discountCents: 750, coveredLineIndexes: [0, 1] });
        expect(750 / 100).toBe(discountBeforeSlice(base, 75));
    });
    it("fixed_amount golden: 12.50 off 75.00 → 1250 cents", () => {
        const fixed = { ...base, type: "fixed_amount" as const, value: "12.50" };
        expect(evaluateCoupon(fixed, [A, B], NOW)).toEqual({ applies: true, discountCents: 1250, coveredLineIndexes: [0, 1] });
        expect(1250 / 100).toBe(discountBeforeSlice(fixed, 75));
    });
    it("percentage with float noise in the old arithmetic: 50% of 0.29 is 14.5 cents → 15 cents (old code: 14 cents; recorded deviation)", () => {
        const out = evaluateCoupon({ ...base, value: "50" }, [line("A", 29)], NOW);
        expect(out).toEqual({ applies: true, discountCents: 15, coveredLineIndexes: [0] });
        expect(discountBeforeSlice({ ...base, value: "50" }, 0.29)).toBe(0.14);
    });
});

describe("COUPON-FIX-1 rule — limits and caps on the covered lines", () => {
    it("limited to product A; cart A + B → discount on A's line only", () => {
        expect(evaluateCoupon({ ...base, applicableProducts: ["A"] }, [A, B], NOW))
            .toEqual({ applies: true, discountCents: 500, coveredLineIndexes: [0] });
    });
    it("limited to category cat-b → B's line (product OR category)", () => {
        expect(evaluateCoupon({ ...base, applicableProducts: ["X"], applicableCategories: ["cat-b"] }, [A, B], NOW))
            .toEqual({ applies: true, discountCents: 250, coveredLineIndexes: [1] });
    });
    it("fixed amount larger than the covered lines → capped at the covered sum", () => {
        expect(evaluateCoupon({ ...base, type: "fixed_amount", value: "40", applicableProducts: ["B"] }, [A, B], NOW))
            .toEqual({ applies: true, discountCents: 2500, coveredLineIndexes: [1] });
    });
    it("percentage with maximumDiscount on the covered lines → capped", () => {
        expect(evaluateCoupon({ ...base, value: "50", maximumDiscount: "10", applicableProducts: ["A"] }, [A, B], NOW))
            .toEqual({ applies: true, discountCents: 1000, coveredLineIndexes: [0] });
    });
    it("minimum met by the whole cart, covered lines below it → applies", () => {
        expect(evaluateCoupon({ ...base, minimumOrderAmount: "60", applicableProducts: ["B"] }, [A, B], NOW))
            .toEqual({ applies: true, discountCents: 250, coveredLineIndexes: [1] });
    });
});

describe("COUPON-FIX-1 — amountInCents", () => {
    it("rounds half up after the float-noise guard; NaN stays NaN", () => {
        expect(amountInCents(0.1 + 0.2)).toBe(30);
        expect(amountInCents(1.005)).toBe(101);
        expect(amountInCents(75)).toBe(7500);
        expect(amountInCents(NaN)).toBeNaN();
    });
});
