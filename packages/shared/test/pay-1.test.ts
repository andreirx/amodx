// PAY-1 (docs/slices/pay-1.md § 2 item 1) — the payment-state rule `paymentTransition`. Binds the taxonomy row
// "rule: every pair of the 3 × 3 states". Pure: no I/O.
import { describe, expect, it } from "vitest";
import { paymentTransition, PaymentStatusSchema, OrderSchema, type PaymentStatus } from "../src/index";

const STATES = PaymentStatusSchema.options;

/** The ratified table: [from, to] → kind. Every pair is listed; the test checks the list is complete. */
const TABLE: Record<`${PaymentStatus}→${PaymentStatus}`, "apply" | "no-op" | "refused"> = {
    "pending→pending": "no-op",
    "pending→paid": "apply",
    "pending→refunded": "refused",
    "paid→pending": "refused",
    "paid→paid": "no-op",
    "paid→refunded": "apply",
    "refunded→pending": "refused",
    "refunded→paid": "refused",
    "refunded→refunded": "no-op",
};

describe("PAY-1 rule — every pair of the 3 × 3 states", () => {
    it("the enum is exactly pending, paid, refunded and the order schema uses it", () => {
        expect(STATES).toEqual(["pending", "paid", "refunded"]);
        expect(OrderSchema.shape.paymentStatus.parse(undefined)).toBe("pending");
        expect(() => OrderSchema.shape.paymentStatus.parse("PAID")).toThrow();
    });

    for (const from of STATES) for (const to of STATES) {
        const expected = TABLE[`${from}→${to}`];
        it(`${from} → ${to}: ${expected}`, () => {
            const out = paymentTransition(from, to);
            expect(out.kind).toBe(expected);
            if (out.kind === "refused") expect(out.reason.length).toBeGreaterThan(0);
            else expect(Object.keys(out)).toEqual(["kind"]);
        });
    }

    it("counts: two apply, three no-op, four refused", () => {
        const kinds = STATES.flatMap((f) => STATES.map((t) => paymentTransition(f, t).kind));
        expect(kinds.filter((k) => k === "apply")).toHaveLength(2);
        expect(kinds.filter((k) => k === "no-op")).toHaveLength(3);
        expect(kinds.filter((k) => k === "refused")).toHaveLength(4);
    });

    it("a record without paymentStatus counts as pending", () => {
        for (const to of STATES) expect(paymentTransition(undefined, to)).toEqual(paymentTransition("pending", to));
    });

    it("the refusal texts", () => {
        expect(paymentTransition("pending", "refunded")).toEqual({ kind: "refused", reason: "Only a paid order can be refunded." });
        expect(paymentTransition("paid", "pending")).toEqual({ kind: "refused", reason: "A paid order cannot go back to pending." });
        expect(paymentTransition("refunded", "paid")).toEqual({ kind: "refused", reason: "A refunded order cannot change its payment state." });
        expect(paymentTransition("refunded", "pending")).toEqual({ kind: "refused", reason: "A refunded order cannot change its payment state." });
    });
});
