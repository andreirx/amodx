# PAY-2 — online card payment at checkout

Status: **PLANNED (draft 2026-11-20, not ratified) — DECISION REQUIRED (PAY-PROVIDER)**. Track: commerce.
Depends: `pay-1`. This file is a specification stub: the provider's API is read at specification time, not from
memory.

## The problem

The checkout offers cash on delivery and bank transfer only
(`packages/shared/src/index.ts:1229`: `enabledPaymentMethods`). A course buyer expects to pay by card and get
the seat at once. `docs/TECH-DEBT.md` § "Netopia Payments (future)" records the intent: redirect to a hosted
payment page after order creation, a webhook sets the order paid.

## Decision PAY-PROVIDER (the human's)

| Option | Reward | Risk |
|---|---|---|
| A. Netopia | Romanian processor, RON settlement, the one already named in the debt list; hosted page keeps card data off AMODX | its API, test environment and signature scheme must be verified at specification time |
| B. Stripe | well documented, strong test tooling | account and settlement terms for a Romanian school must be confirmed by the client |
| C. Both behind one port | each tenant chooses | an interface with one implementation at first: not earned until a second tenant asks |

Recommendation: A, written as one module; a port is added when a second processor is named.

## Scope (shape, to be completed in the specification)

1. Payment method `card` in the tenant's enabled methods and the checkout; per-tenant processor credentials in
   the tenant settings, redacted like the existing secrets (`backend/src/tenant/settings.ts:182-196`).
2. After the order is written (`pending`), the server creates the payment at the processor and answers the
   redirect address. The amount is the server's total; the browser never sends an amount to the processor.
3. Webhook route: signature verified (the Paddle webhook skips verification — `backend/src/webhooks/paddle.ts:18`
   — and is not a model), idempotent by the processor's payment id, tenant and order taken from the
   server-created reference, then the `pending → paid` transition of `pay-1`.
4. Return page: shows the order state read from the server; never trusts the return parameters.
5. Abandoned payment: the order stays `pending`; a seat held by `sched-1` follows that track's hold rule.

## Evidence taxonomy (minimum)

Webhook with a bad signature → 401, nothing written. Same webhook twice → one transition. Amount in the
webhook different from the order total → no transition, an audit entry. Webhook for another tenant's order
reference → refused.

## Non-scope

Stored cards, subscriptions, refunds through the processor, instalments.

## Exit criterion

A visitor pays for a course by card on staging in the processor's test environment and the order becomes paid
with no admin action.
