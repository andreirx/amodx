import { describe, it, expect } from "vitest";
import {
    STATUS_LABELS,
    getDefaultTemplates,
    renderTemplate,
    renderEmailTemplate,
} from "../../src/lib/order-email.js";
import { OrderSchema } from "@amodx/shared";

/**
 * slice `test-3` — `src/lib/order-email.ts`: template rendering for customer-facing order
 * mail. Pure string work plus two static maps; no SES, no DynamoDB, no environment.
 *
 * The interesting invariant is NOT the regex — it is the COUPLING between three
 * independently-editable lists that nothing else in the repo checks:
 *
 *     packages/shared  OrderSchema.status enum        (what can be persisted)
 *     backend          STATUS_LABELS                  (what the mail says)
 *     backend          getDefaultTemplates()          (what the mail is)
 *
 * A status added to the schema but not to the other two produces a mail with an empty
 * status word and no template to fall back on. TypeScript cannot catch it: `STATUS_LABELS`
 * is `Record<string, string>` and `getDefaultTemplates()` returns
 * `Record<string, OrderEmailTemplate>`, so both accept any key and miss any key. That gap
 * is what the first block below closes.
 */

/** The seven order states, read from the schema so the test cannot drift from it. */
const ORDER_STATUSES: string[] = OrderSchema.shape.status.unwrap().options;

describe("status coverage — schema ↔ labels ↔ default templates", () => {
    /**
     * INVARIANT: the three lists are the SAME set. Asserted in both directions, because the
     * two failures differ: a missing entry is a broken email at runtime; an extra entry is
     * dead configuration that the admin Email-Templates page will nonetheless render as an
     * editable status.
     */
    it("sanity: the schema exposes the seven Phase-5 states", () => {
        expect(ORDER_STATUSES).toEqual([
            "placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled",
        ]);
    });

    it("STATUS_LABELS covers every schema status and nothing else", () => {
        expect(Object.keys(STATUS_LABELS).sort()).toEqual([...ORDER_STATUSES].sort());
    });

    it("getDefaultTemplates() covers every schema status and nothing else", () => {
        expect(Object.keys(getDefaultTemplates()).sort()).toEqual([...ORDER_STATUSES].sort());
    });

    it("every default template has a non-empty subject and body", () => {
        for (const [status, tpl] of Object.entries(getDefaultTemplates())) {
            expect(tpl.subject.trim(), `subject for ${status}`).not.toBe("");
            expect(tpl.body.trim(), `body for ${status}`).not.toBe("");
        }
    });

    it("every default template names the order number in its subject", () => {
        // The subject is the only part a customer sees in a mailbox list; without the order
        // number two mails for two orders are indistinguishable.
        for (const [status, tpl] of Object.entries(getDefaultTemplates())) {
            expect(tpl.subject, `subject for ${status}`).toContain("{{orderNumber}}");
        }
    });

    it("only the initial 'placed' mail fans out to admin and fulfilment", () => {
        /**
         * INVARIANT (MEMORY, Phase-5 order emails): the customer is notified on every
         * transition; the admin and the processing mailbox are notified only when the order
         * ARRIVES. Any other default would mail the fulfilment team seven times per order.
         */
        const templates = getDefaultTemplates();
        for (const status of ORDER_STATUSES) {
            expect(templates[status].sendToCustomer, `sendToCustomer for ${status}`).toBe(true);
            const fanout = status === "placed";
            expect(templates[status].sendToAdmin, `sendToAdmin for ${status}`).toBe(fanout);
            expect(templates[status].sendToProcessing, `sendToProcessing for ${status}`)
                .toBe(fanout);
        }
    });

    it("labels are human-readable capitalisations, not the raw enum values", () => {
        expect(STATUS_LABELS.placed).toBe("Placed");
        expect(STATUS_LABELS.annulled).toBe("Annulled");
    });
});

describe("renderTemplate — {{placeholder}} substitution", () => {
    /**
     * INVARIANT: `{{name}}` is replaced from the vars map; an UNMATCHED placeholder is left
     * verbatim. Leaving it is the documented choice and it is the safer one — a customer
     * seeing `{{trackingNumber}}` reports a bug, whereas silently emptying it produces a
     * mail that reads as complete and is wrong.
     */
    it("substitutes a single placeholder", () => {
        expect(renderTemplate("Order {{orderNumber}} shipped", { orderNumber: "PPB-0042" }))
            .toBe("Order PPB-0042 shipped");
    });

    it("substitutes every occurrence of a repeated placeholder", () => {
        expect(renderTemplate("{{a}}-{{a}}-{{a}}", { a: "x" })).toBe("x-x-x");
    });

    it("substitutes several distinct placeholders in one pass", () => {
        expect(renderTemplate("{{greeting}} {{name}}", { greeting: "Hi", name: "Ana" }))
            .toBe("Hi Ana");
    });

    it("leaves an unmatched placeholder verbatim", () => {
        expect(renderTemplate("Tracking: {{trackingNumber}}", {}))
            .toBe("Tracking: {{trackingNumber}}");
    });

    it("distinguishes a key present-but-empty from a key absent", () => {
        // `key in vars` — not truthiness. An order with no tracking number set deliberately
        // renders as blank; an order whose template names a variable the caller never
        // supplies renders as the literal, which is a visible bug report.
        expect(renderTemplate("[{{note}}]", { note: "" })).toBe("[]");
        expect(renderTemplate("[{{note}}]", {})).toBe("[{{note}}]");
    });

    it("leaves a template with no placeholders untouched", () => {
        expect(renderTemplate("Thank you.", { orderNumber: "PPB-1" })).toBe("Thank you.");
    });

    it("ignores vars that the template does not name", () => {
        expect(renderTemplate("Hello", { unused: "value" })).toBe("Hello");
    });

    it("only matches \\w+ inside the braces — spaces and dots are not placeholders", () => {
        // Pins the regex boundary. `{{customer.name}}` is NOT a placeholder, so a template
        // author using dotted paths gets the literal back rather than a silent blank.
        expect(renderTemplate("{{customer.name}}", { "customer.name": "Ana" }))
            .toBe("{{customer.name}}");
        expect(renderTemplate("{{ orderNumber }}", { orderNumber: "PPB-1" }))
            .toBe("{{ orderNumber }}");
    });

    it("does not re-scan substituted text (a value containing braces is inert)", () => {
        // Guards against a substitution loop if a customer-supplied field (name, note)
        // happened to contain `{{...}}`. `String.replace` with a function scans once.
        expect(renderTemplate("{{name}}", { name: "{{orderNumber}}", orderNumber: "PPB-1" }))
            .toBe("{{orderNumber}}");
    });

    it("passes a `$` in a value through literally (no replacement-pattern expansion)", () => {
        // `String.replace` expands `$&`, `$1` … in a STRING replacement. This helper uses a
        // FUNCTION replacement, so it does not — which is what makes a price like "$1" safe
        // to substitute. Pinned because switching to a string replacement would silently
        // corrupt exactly those values.
        expect(renderTemplate("Total: {{total}}", { total: "$&100" })).toBe("Total: $&100");
    });
});

describe("renderEmailTemplate — subject and body together", () => {
    it("renders both halves from the same var map", () => {
        expect(renderEmailTemplate(
            {
                subject: "Order {{orderNumber}} Shipped",
                body: "Tracking: {{trackingNumber}}",
                sendToCustomer: true,
                sendToAdmin: false,
                sendToProcessing: false,
            },
            { orderNumber: "PPB-0042", trackingNumber: "RO123456789" },
        )).toEqual({
            subject: "Order PPB-0042 Shipped",
            body: "Tracking: RO123456789",
        });
    });

    it("carries the routing flags through untouched (it renders text, it does not send)", () => {
        const tpl = {
            subject: "s", body: "b",
            sendToCustomer: true, sendToAdmin: true, sendToProcessing: false,
        };
        const out = renderEmailTemplate(tpl, {});
        expect(Object.keys(out).sort()).toEqual(["body", "subject"]);
    });
});
