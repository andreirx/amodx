# LOYALTY-1 — a discount level by the amount a customer has spent

Status: **PLANNED (draft 2026-11-20, not ratified)**. Track: commerce. Depends: `cmrc-4` (the customer record
moves to the commerce-private table in Track B; built before, the reads are written twice).

## Purpose

The school wants returning students rewarded by what they spent. Today each order adds one point per currency
unit and the total spent to the customer record (`backend/src/orders/create.ts:417-458`, `:451`); the account
page shows the points when above zero (`renderer/src/components/AccountPageView.tsx:301-304`). Nothing uses them.

## Scope

1. Tenant setting `loyaltyLevels: {name, fromTotalSpent, discountPercent}[]`, empty by default (empty = today's
   behaviour, byte for byte).
2. One pure function: customer total spent → level. The order handler applies the level's discount as its own
   line in the totals, after coupons; the signed-in checkout shows it (the server answers it; the browser does
   not compute it).
3. Rule: only paid orders count. Today `totalSpent` rises when the order is placed. With `pay-1`, the counters
   move to the `pending → paid` transition and go back on `paid → refunded`.
4. Account page: the level name and the next level's threshold, through the locale table.
5. Admin: levels editor in commerce settings; the customer page shows the level.

## Decisions inside the slice (operator, documented)

Levels by total spent, a percent discount. Points stay as they are and are not spent. A points currency that
customers spend is a different system with balance, expiry and reversal rules; it is not proposed.

## Evidence taxonomy

No levels → totals unchanged. Total spent exactly at a threshold → that level. Coupon and level together → the
documented order, never below zero. Not signed in → no level. A refunded order lowers the total and can lower
the level.

## Exit criterion

A signed-in customer above a threshold sees the level discount in the checkout total and is charged that total.
