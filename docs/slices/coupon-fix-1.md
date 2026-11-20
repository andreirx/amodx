# COUPON-FIX-1 — the coupon limits are enforced when the order is written

Status: **PLANNED (draft 2026-11-20, not ratified)**. Track: commerce. Depends: none. Prerequisite of
`voucher-1`. Defect fixes on existing code; no new feature.

## The defects

Schema: `CouponSchema`, `packages/shared/src/index.ts:2041-2059`.

1. **Per-customer limit.** `perCustomerLimit` is stored and read nowhere (search of `backend/src` and
   `renderer/src`, 2026-11-20). A "once per customer" coupon works without limit.
2. **Product and category limits.** `applicableProducts` and `applicableCategories` are checked only in the
   pre-check the cart calls (`backend/src/coupons/public-validate.ts:119-140`). The order handler does not check
   them (`orders/create.ts:279-305`), so a direct order request applies a course-A coupon to any cart.
3. **Usage limit under load.** The count is raised inside the order transaction without a condition
   (`orders/create.ts:462-473`). Two orders at the same moment both pass `usageCount < usageLimit`
   (`:285`) and a limit of 1 is used twice. (INFERRED from the code; the slice proves it with a test first.)

## Scope

1. One pure function in shared code, "is this coupon valid for this cart and this customer, and what is the
   discount", used by the pre-check and by the order handler. The discount applies to the lines the coupon
   covers, not to the whole cart, when a product or category limit is set.
2. Usage count: the update in the order transaction gets the condition `usageLimit = 0 OR usageCount <
   usageLimit`; a failed condition cancels the order write and answers the coupon refusal.
3. Per-customer limit: a counter item per coupon and normalized email, raised in the same transaction with its
   own condition.
4. The refusal texts go through the tenant's locale table.

## Evidence taxonomy

| Case | Expected |
|---|---|
| coupon limited to product A, cart with A and B | discount on A's lines only; equal in pre-check and order |
| coupon limited to product A, cart with B only | refused in both |
| `usageLimit: 1`, two orders at once | one order written, one refused, `usageCount` = 1 |
| `perCustomerLimit: 1`, same email twice | second refused; another email accepted |
| a coupon with no limits | totals byte-equal to today's (the existing order tests pass unchanged) |

## Deployment notes

Order totals of existing shops change only for coupons that carry a product or category limit; today no live
commerce tenant exists. Records the rule in `docs/commerce.md`. `order-confirm-1` already makes the checkout
show the server's total when it differs.

## Exit criterion

The three rows above that fail today pass, and no other order test changes.
