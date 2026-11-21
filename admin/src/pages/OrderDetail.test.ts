import { describe, it, expect, vi } from "vitest";

/*
 * PAY-1 (docs/slices/pay-1.md § 2 item 5) — the order page's payment control. PURE-LOGIC tests (no markup capture):
 * `paymentAction` chooses the button the Payment card renders, `paymentErrorText` the text the page alerts after a
 * failed change. Replaced: the tenant context and Amplify (imported by the page and by `@/lib/api`).
 */
vi.mock("@/context/TenantContext", () => ({ useTenant: () => ({ currentTenant: null }) }));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));

import { paymentAction, paymentErrorText } from "./OrderDetail";
import { ApiError } from "@/lib/api";

describe("paymentAction — which button shows in each state", () => {
    it("pending → 'Mark as paid' (next: paid); the confirmation promises no email delivery (ruling R3)", () => {
        const a = paymentAction("pending")!;
        expect(a.next).toBe("paid");
        expect(a.label).toBe("Mark as paid");
        expect(a.confirmText).toBe(
            "Mark this order as paid? The Paid email follows your Email Templates settings. A failed email does not undo the payment change.",
        );
    });

    it("absent (undefined: an order written without the field) → as pending", () => {
        expect(paymentAction(undefined)).toEqual(paymentAction("pending"));
    });

    it("null is not absent: no button (the server refuses a stored null, ruling R2)", () => {
        expect(paymentAction(null)).toBeNull();
    });

    it("paid → 'Mark as refunded' (next: refunded), with a confirmation text", () => {
        const a = paymentAction("paid")!;
        expect(a.next).toBe("refunded");
        expect(a.label).toBe("Mark as refunded");
        expect(a.confirmText).toContain("refunded");
    });

    it("refunded → no button; a stored value outside the enum → no button", () => {
        expect(paymentAction("refunded")).toBeNull();
        expect(paymentAction("PAID")).toBeNull();
    });
});

describe("paymentErrorText — the 409 text shown", () => {
    it("409 refused: the server's reason, as it is", () => {
        const e = new ApiError(409, { error: "A paid order cannot go back to pending.", paymentStatus: "paid" }, "API Error (409): A paid order cannot go back to pending.");
        expect(paymentErrorText(e)).toBe("A paid order cannot go back to pending.");
    });

    it("409 race: the server's 'read the order again' text", () => {
        const e = new ApiError(409, { error: "The payment state changed; read the order again." }, "API Error (409): The payment state changed; read the order again.");
        expect(paymentErrorText(e)).toBe("The payment state changed; read the order again.");
    });

    it("another status, or a 409 without a JSON reason: the error message with a prefix", () => {
        expect(paymentErrorText(new ApiError(400, { error: "bad" }, "API Error (400): bad"))).toBe("Failed to update payment: API Error (400): bad");
        expect(paymentErrorText(new ApiError(409, null, "API Error (409): Conflict"))).toBe("Failed to update payment: API Error (409): Conflict");
        expect(paymentErrorText(new Error("Network down"))).toBe("Failed to update payment: Network down");
    });
});
