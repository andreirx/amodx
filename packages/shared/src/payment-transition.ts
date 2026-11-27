import type { PaymentStatus } from "./orders-and-customers.js";

/**
 * PAY-1 (docs/slices/pay-1.md): THE payment-state rule. User: `backend/src/orders/update.ts` (PUT /orders/{id} with
 * `paymentStatus`). Pure: no I/O.
 *
 * Allowed: pending → paid, paid → refunded. The same state again is a no-op. Every other pair is refused:
 * paid → pending, pending → refunded, refunded → anything else. `previous` absent (an order record written without
 * the field) counts as `pending`.
 *
 * Every one of the 3 × 3 pairs has its own arm; there is no catch-all. A new payment state makes the `never`
 * checks below fail to compile, so the new pairs must be decided here.
 */
export type PaymentTransition =
    | { kind: "apply" }
    | { kind: "no-op" }
    | { kind: "refused"; reason: string };

const APPLY: PaymentTransition = { kind: "apply" };
const NO_OP: PaymentTransition = { kind: "no-op" };
const refused = (reason: string): PaymentTransition => ({ kind: "refused", reason });

const NOT_PAID = "Only a paid order can be refunded.";
const NO_GOING_BACK = "A paid order cannot go back to pending.";
const FINAL = "A refunded order cannot change its payment state.";

function unreachable(value: never): never {
    throw new Error(`Unknown payment state: ${String(value)}`);
}

export function paymentTransition(previous: PaymentStatus | undefined, requested: PaymentStatus): PaymentTransition {
    const from: PaymentStatus = previous ?? "pending";
    switch (from) {
        case "pending":
            switch (requested) {
                case "pending": return NO_OP;
                case "paid": return APPLY;
                case "refunded": return refused(NOT_PAID);
                default: return unreachable(requested);
            }
        case "paid":
            switch (requested) {
                case "pending": return refused(NO_GOING_BACK);
                case "paid": return NO_OP;
                case "refunded": return APPLY;
                default: return unreachable(requested);
            }
        case "refunded":
            switch (requested) {
                case "pending": return refused(FINAL);
                case "paid": return refused(FINAL);
                case "refunded": return NO_OP;
                default: return unreachable(requested);
            }
        default: return unreachable(from);
    }
}
