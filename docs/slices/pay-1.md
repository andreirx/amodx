# PAY-1 — "paid" becomes a real order transition, with an event

Status: **PLANNED (draft 2026-11-20, not ratified)**. Track: commerce. Depends: none. Prerequisite of `pay-2`,
`invoice-1`, `voucher-1`, `sched-1h`. Maturity target: PROTOTYPE.

## Purpose / risk retired

An order's payment state exists as a field and nothing manages it.

- Orders are created `paymentStatus: "pending"` (`backend/src/orders/create.ts:395`).
- The only writer is the generic field patch `PUT /orders/{id}`: `paymentStatus` is in its allowlist
  (`orders/update.ts:30-35`) and the value is not checked against the enum
  (`packages/shared/src/index.ts:1755`: `pending | paid | refunded`).
- The admin shows the state and has no control to change it (`admin/src/pages/OrderDetail.tsx:329-330`).
- No event is published on order creation or on a payment change (`orders/create.ts`, `orders/update.ts`: no
  `publishAudit`). The status route does publish (`orders/update-status.ts:81-88`).

Everything that must happen "when the money arrives" (invoice, voucher, a paid mark in a course roster) has no
moment to attach to.

## Scope

1. `PUT /orders/{id}/payment` `{paymentStatus, note?}` — admin roles of the status route. Allowed transitions as
   a table in shared code: `pending → paid`, `paid → refunded`, `pending → refunded` refused, same → same is a
   no-op 200. Conditional write on the previous state (two admins at once: one wins, the other gets 409).
2. `paymentStatus` leaves the allowlist of the generic patch (a request that sends it gets 400 naming the new
   route).
3. Event: a domain event `ORDER_PAYMENT_CHANGED` on the existing bus (`backend/src/lib/events.ts`), next to the
   audit entry (actor email, order number as title — Critical Rule 7). No consumer in this slice; `invoice-1`
   and `voucher-1` add theirs.
4. Admin: "Mark as paid" / "Mark as refunded" on the order page, with a confirmation. English text.
5. Customer mail "payment received" through the per-tenant template pattern (`order-email.ts`), EN + RO
   defaults in the language packs.
6. MCP route + `routes.json`.

## Non-scope

Online payment (`pay-2`). Partial payments. Refund execution at a processor.

## Evidence taxonomy

| Input | Expected |
|---|---|
| `pending → paid` | 200, one event, one audit entry, one mail |
| `paid → paid` | 200, no event, no mail |
| `paid → pending`, unknown value | 400 |
| two `pending → paid` at once | one 200, one 409, one event |
| generic patch with `paymentStatus` | 400, order unchanged (read back) |
| another tenant's order id | 404 |

## Deployment notes

Commerce freeze: this changes order handlers without moving data (human 2026-11-15: fix what can be fixed
now). Route registration in `infra/lib/api-commerce.ts` (gain: the owner can record a payment). When Track B's
`cmrc-4` lands, the write goes through `commerce-db.ts`; the transition table does not change.

## Exit criterion

An owner marks a bank-transfer order paid in the admin, the customer gets the mail, and the event is visible in
the audit trail.
