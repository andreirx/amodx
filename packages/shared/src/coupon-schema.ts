// Coupons: the stored coupon record (CouponSchema). The coupon RULE is coupon.ts.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

// --- COUPONS ---

export const CouponSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    code: z.string().min(1),
    type: z.enum(["percentage", "fixed_amount"]).default("percentage"),
    value: z.string(), // e.g. "10" for 10% or "25" for 25 RON
    minimumOrderAmount: z.string().default("0"),
    maximumDiscount: z.string().optional(), // cap for percentage coupons
    validFrom: z.string().optional(),
    validUntil: z.string().optional(),
    usageLimit: z.number().default(0), // 0 = unlimited
    usageCount: z.number().default(0),
    perCustomerLimit: z.number().default(0), // 0 = unlimited
    applicableCategories: z.array(z.string()).default([]),
    applicableProducts: z.array(z.string()).default([]),
    status: z.enum(["active", "expired", "disabled"]).default("active"),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Coupon = z.infer<typeof CouponSchema>;
