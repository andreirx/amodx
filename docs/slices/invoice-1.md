# INVOICE-1 — an invoice is issued in SmartBill when an order is paid

Status: **PLANNED (draft 2026-11-20, not ratified)**. Track: commerce. Depends: `pay-1`. Specification stub: the
SmartBill API (endpoints, authentication, series, VAT fields, e-Factura behaviour) is read at specification
time.

## Purpose

The school issues invoices by hand. Nothing in AMODX talks to an invoicing service (search 2026-11-20:
`smartbill|oblio|e-factura` in backend, shared, renderer, admin, infra — no hit). The customer's billing details
are already collected (`BillingDetailsSchema`, `packages/shared/src/index.ts:1745`) and the tenant's company
details exist (`:1244`).

## Scope

1. Tenant settings: SmartBill account identifier, token, invoice series, VAT rate default; the token redacted on
   read like the other secrets (`backend/src/tenant/settings.ts:182-196`). An on/off switch, default off.
2. A consumer of `ORDER_PAYMENT_CHANGED` (`pay-1`): on `pending → paid`, build the invoice from the stored order
   (lines, the totals the server computed, coupon discount as SmartBill expects it, customer or company
   billing details) and create it. Idempotent: the invoice number and series are written on the order with a
   condition "no invoice yet"; a second event creates nothing.
3. Failure: the order keeps `invoice: Failed(reason, at)`; the admin order page shows it with a "Try again"
   button. A failed invoice never blocks the paid state. `invoice` is a sum type:
   `None | Issued(series, number, url) | Failed(reason, at)`.
4. Admin order page: the invoice number and a link. Customer mail "payment received" gains the link.
5. `paid → refunded`: no automatic reversal invoice in this slice; the admin page says so.

## Evidence taxonomy

Settings absent or switch off → no call. Valid → one invoice, number stored. Event delivered twice → one
invoice. SmartBill refuses (bad series, missing fiscal code of a company) → `Failed` with SmartBill's text, the
order still paid. Timeout → `Failed`, retry safe.

## Decision inside the slice (operator, documented)

Invoice at payment, not at order: a bank-transfer order that is never paid gets no invoice. A pro-forma at
order time is a follow-up when a client asks.

## Non-scope

Other invoicing services (a port is added when a second one is named). Reversal invoices. Stock sync.

## Exit criterion

An order marked paid on staging produces one invoice in a SmartBill test company and the admin page links it.
