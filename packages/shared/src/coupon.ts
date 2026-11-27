import { z } from "zod";
import type { Coupon } from "./coupon-schema.js";

/**
 * COUPON-FIX-1 (docs/slices/coupon-fix-1.md § 2 rules 1-2, § 6): THE coupon rule. Users: the order handler
 * (`backend/src/orders/create.ts`, the authority) and the advisory pre-check (`backend/src/coupons/public-validate.ts`).
 * Pure: no I/O, the clock is an argument, money is whole cents.
 *
 * Money rule (ruling CF1-MONEY-PRESERVATION = B): every coupon money text (`value` of a fixed coupon,
 * `maximumDiscount`, `minimumOrderAmount`) is read with `parseFloat` and converted to whole cents, rounded half up,
 * when it is read; a percentage discount is the percent of the covered sum in cents, rounded half up; every comparison
 * is in cents.
 *
 * The per-customer limit is checked here only when the caller passes the customer's use count (the order handler
 * reads the counter item). The order transaction's conditional write stays the authority for a race (rule 6).
 */

/** The coupon fields the rule reads, as stored. Fields the schema defaults may be absent on an old item. */
export type CouponRuleRecord = Pick<Coupon, "status" | "type" | "value"> &
    Partial<Pick<Coupon,
        "minimumOrderAmount" | "maximumDiscount" | "validFrom" | "validUntil" | "usageLimit" | "usageCount"
        | "perCustomerLimit" | "applicableProducts" | "applicableCategories">>;

/** One cart line as the rule sees it. Both callers fill `categoryIds` from the stored product, never the request. */
export interface CouponCartLine {
    productId: string;
    categoryIds: readonly string[];
    /** The line total in whole cents. */
    lineTotalCents: number;
}

/** Why a coupon does not apply. Closed: each value is one check of `evaluateCoupon`, in the order it runs them. */
export type CouponRefusal =
    | "not-active" | "not-yet-valid" | "expired" | "usage-limit" | "customer-limit" | "below-minimum" | "no-covered-line";

export type CouponOutcome =
    | { applies: true; discountCents: number; coveredLineIndexes: number[] }
    | { applies: false; reason: CouponRefusal };

/**
 * One line of the coupon pre-check request (`POST /public/coupons/validate`, ruling CF1-PRECHECK-LINES = B): the
 * cart's own figures. `lineTotal` is the line total the cart shows; it is advisory — the order handler prices every
 * line itself. Any other field (for example `categoryIds`) is dropped by the parse.
 */
export const CouponPrecheckItemSchema = z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1),
    lineTotal: z.number().min(0),
});
export type CouponPrecheckItem = z.infer<typeof CouponPrecheckItemSchema>;

/** The most lines a pre-check request may carry (the order request's own maximum). */
export const COUPON_PRECHECK_MAX_LINES = 50;

/**
 * Whole cents of an amount, rounded half up after the float-noise guard of `roundToCents` (so 0.1 + 0.2 → 30,
 * 1.005 → 101, 0.145 → 15). NaN stays NaN.
 */
export function amountInCents(amount: number): number {
    return Math.round(Number((amount * 100).toPrecision(15)));
}

const COUPON_TYPES: Record<Coupon["type"], true> = { percentage: true, fixed_amount: true };

/**
 * True when a stored `type` is one of the schema's coupon types. A record whose type fails this is a coupon that does
 * not apply (§ 6 "Unknown coupon type"); callers test it BEFORE `evaluateCoupon`, which throws on such a type.
 * The `Record` above fails to compile when the schema's enum gains a type.
 */
export function isCouponType(type: unknown): type is Coupon["type"] {
    return typeof type === "string" && Object.prototype.hasOwnProperty.call(COUPON_TYPES, type);
}

/**
 * The coupon rule. The checks run in this order; the first that fails is the `reason`:
 * 1. `status` is `active`;
 * 2. `validFrom` / `validUntil`: compared as text with `now.toISOString()`, as before this slice (`now` equal to either
 *    bound is inside the range);
 * 3. `usageLimit` > 0 and `usageCount` ≥ `usageLimit` → `usage-limit` (absent counts as 0);
 * 4. only when `customerUseCount` is given: `perCustomerLimit` > 0 and `customerUseCount` ≥ it → `customer-limit`.
 *    Absent = the customer is unknown (the pre-check) and this limit is not checked;
 * 5. `minimumOrderAmount` (in cents) is compared with the WHOLE subtotal (the sum of every line);
 * 6. covered lines: no product and no category limit → every line; else a line whose `productId` is in
 *    `applicableProducts` OR one of whose `categoryIds` is in `applicableCategories`. None → `no-covered-line`.
 * Discount, on the sum of the covered lines only: `percentage` → `value` percent of it, rounded half up, then capped
 * by `maximumDiscount` (in cents) when that is > 0; `fixed_amount` → `value` (in cents). Never more than the covered
 * lines' sum. Throws when `coupon.type` is not a schema type (see `isCouponType`).
 */
export function evaluateCoupon(
    coupon: CouponRuleRecord, lines: readonly CouponCartLine[], now: Date, customerUseCount?: number,
): CouponOutcome {
    if (coupon.status !== "active") return { applies: false, reason: "not-active" };

    const nowIso = now.toISOString();
    if (coupon.validFrom && nowIso < coupon.validFrom) return { applies: false, reason: "not-yet-valid" };
    if (coupon.validUntil && nowIso > coupon.validUntil) return { applies: false, reason: "expired" };

    const usageLimit = coupon.usageLimit || 0;
    const usageCount = coupon.usageCount || 0;
    if (usageLimit > 0 && usageCount >= usageLimit) return { applies: false, reason: "usage-limit" };

    const perCustomerLimit = coupon.perCustomerLimit || 0;
    if (customerUseCount !== undefined && perCustomerLimit > 0 && customerUseCount >= perCustomerLimit) {
        return { applies: false, reason: "customer-limit" };
    }

    const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const minimumCents = amountInCents(parseFloat(coupon.minimumOrderAmount ?? "") || 0);
    if (subtotalCents < minimumCents) return { applies: false, reason: "below-minimum" };

    const products = coupon.applicableProducts ?? [];
    const categories = coupon.applicableCategories ?? [];
    const limited = products.length > 0 || categories.length > 0;
    const coveredLineIndexes: number[] = [];
    lines.forEach((line, i) => {
        const covered = !limited
            || products.includes(line.productId)
            || line.categoryIds.some((id) => categories.includes(id));
        if (covered) coveredLineIndexes.push(i);
    });
    if (coveredLineIndexes.length === 0) return { applies: false, reason: "no-covered-line" };

    const coveredCents = coveredLineIndexes.reduce((sum, i) => sum + lines[i].lineTotalCents, 0);
    const value = parseFloat(coupon.value);
    let discountCents: number;
    switch (coupon.type) {
        case "percentage": {
            discountCents = Math.round(Number((value * coveredCents / 100).toPrecision(15)));
            const maximumCents = coupon.maximumDiscount ? amountInCents(parseFloat(coupon.maximumDiscount)) : 0;
            if (maximumCents > 0 && discountCents > maximumCents) discountCents = maximumCents;
            break;
        }
        case "fixed_amount":
            discountCents = amountInCents(value);
            break;
        default: {
            // Unreachable for callers that test `isCouponType` first (both callers do).
            const unknownType: never = coupon.type;
            throw new Error(`Unknown coupon type: ${String(unknownType)}`);
        }
    }
    if (discountCents > coveredCents) discountCents = coveredCents;
    return { applies: true, discountCents, coveredLineIndexes };
}
