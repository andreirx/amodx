# VOUCHER-1 — a gift voucher is a product that issues a one-use code

Status: **PLANNED (draft 2026-11-20, not ratified)**. Track: commerce. Depends: `coupon-fix-1`, `pay-1`.

## Purpose

The school sells vouchers: for an amount of money, or for one named course. The buyer gets a document with a QR
code to give away. Today there are coupons (admin-made codes) and no way to sell one. No PDF or QR library is in
any `package.json` (search 2026-11-20).

## Scope

1. Product kind: `productType: "voucher"` with `voucher: Amount(value) | Course(productId)` — a sum type. The
   editor shows the voucher fields only for this kind.
2. Issue: a consumer of `ORDER_PAYMENT_CHANGED` (`pay-1`). On `paid`, for each voucher line and unit, create one
   coupon: random code, `usageLimit: 1`, `fixed_amount` of the value, or 100 % limited to the course product
   (`applicableProducts`); validity from a tenant setting (default 12 months). The codes are stored on the order
   line with a condition, so a repeated event issues nothing.
3. Delivery: a voucher page on the site at a secret address (`/voucher/<long random token>`): site design, the
   value or course, the code, a QR code that opens the site with the code applied, the valid-until date, and a
   print style sheet. The buyer's mail links it. The QR image is drawn by a small script on that page.
4. An amount voucher larger than the cart: the rest is lost (stated on the voucher page and in `docs/commerce.md`).
   Operator recommendation; a remaining balance is a stored-value system and a slice of its own.
5. Admin: issued vouchers on the order page (code, used or not).

## Decision inside the slice (operator, documented)

A printable page, not a PDF made on the server. Reward: no PDF library in a Lambda, the page follows the site
theme and language, the browser prints or saves it as PDF. Risk: the buyer must print from a browser. A server
PDF attached to the mail is a follow-up when the client says the page is not enough.

## Evidence taxonomy

Unpaid order → no code, no page. Paid → one code per unit. Event twice → the same codes. The page with a wrong
token → 404. A used code → refused at checkout by `coupon-fix-1`. A course voucher in a cart without that
course → refused. The voucher page is `noindex` and never cached at the edge.

## Non-scope

Remaining balance. Vouchers bought for a named recipient with a scheduled mail. "A second course free with the
first" (an admin-made coupon limited to a product covers it after `coupon-fix-1`).

## Exit criterion

A paid voucher order on staging yields a page with a QR code; the code pays for the named course once.
