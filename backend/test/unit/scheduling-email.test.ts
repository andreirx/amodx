import { describe, it, expect } from "vitest";
import {
    SCHEDULING_EMAIL_KEYS, defaultSchedulingTemplates, resolveTemplate, renderSchedulingMail, storedOverrides,
} from "../../src/lib/scheduling-email.js";

/**
 * SCHED-1D1 — row D13, the module part (docs/slices/sched-1.md § 11.1, § 17.3): the seven keys have defaults, an
 * override is used, an absent override falls back to the default, `weekAhead` defaults to `sendToAdmin: true`.
 * The route part (GET /scheduling/admin/email-templates) and the PUT /settings part are in
 * scheduling-admin.test.ts and scheduling-settings.test.ts. Pure; no AWS.
 */

describe("D13 scheduling-email — the seven keys of § 11.1", () => {
    it("D13 exactly the seven keys, each with a non-empty subject and body", () => {
        expect([...SCHEDULING_EMAIL_KEYS]).toEqual(["hold", "confirmed", "cancelled", "moved", "unplaced", "reminder", "weekAhead"]);
        const defaults = defaultSchedulingTemplates();
        expect(Object.keys(defaults).sort()).toEqual([...SCHEDULING_EMAIL_KEYS].sort());
        for (const key of SCHEDULING_EMAIL_KEYS) {
            expect(defaults[key].subject.length, key).toBeGreaterThan(0);
            expect(defaults[key].body.length, key).toBeGreaterThan(0);
        }
    });

    it("D13 recipients of § 11.1: weekAhead → admin only (sendToAdmin: true); confirmed and cancelled carry an owner copy; the rest customer only", () => {
        const d = defaultSchedulingTemplates();
        expect(d.weekAhead).toMatchObject({ sendToCustomer: false, sendToAdmin: true });
        expect(d.confirmed).toMatchObject({ sendToCustomer: true, sendToAdmin: true });
        expect(d.cancelled).toMatchObject({ sendToCustomer: true, sendToAdmin: true });
        for (const key of ["hold", "moved", "unplaced", "reminder"] as const) {
            expect(d[key], key).toMatchObject({ sendToCustomer: true, sendToAdmin: false });
        }
    });

    it("D13 every link-carrying mail of § 11.1 has {{link}}; cancelled has none; weekAhead has {{plannerLink}} and {{summary}}", () => {
        const d = defaultSchedulingTemplates();
        for (const key of ["hold", "confirmed", "moved", "unplaced", "reminder"] as const) expect(d[key].body, key).toContain("{{link}}");
        expect(d.cancelled.body).not.toContain("{{link}}");
        expect(d.weekAhead.body).toContain("{{plannerLink}}");
        expect(d.weekAhead.body).toContain("{{summary}}");
        expect(d.confirmed.body).toContain("{{groupLink}}");
    });

    it("D13 an override replaces subject and body; an absent sendTo flag keeps the default's; a present one wins", () => {
        const custom = { subject: "S {{ref}}", body: "B {{customerName}}" };
        expect(resolveTemplate("cancelled", { cancelled: custom })).toEqual({ ...custom, sendToCustomer: true, sendToAdmin: true });
        expect(resolveTemplate("weekAhead", { weekAhead: { ...custom, sendToAdmin: false } }))
            .toEqual({ ...custom, sendToCustomer: false, sendToAdmin: false });
    });

    it("D13 absent override → the default", () => {
        expect(resolveTemplate("hold", {})).toEqual(defaultSchedulingTemplates().hold);
        expect(resolveTemplate("weekAhead", { hold: { subject: "x", body: "y" } })).toEqual(defaultSchedulingTemplates().weekAhead);
    });

    it("D13 stored overrides: absent → {}; valid → the record; malformed (no subject) → null (storedDataInvalid)", () => {
        expect(storedOverrides(undefined)).toEqual({});
        expect(storedOverrides({ templates: { weekAhead: { subject: "a", body: "b" } } })).toEqual({ weekAhead: { subject: "a", body: "b" } });
        expect(storedOverrides({ templates: { weekAhead: { body: "b" } } })).toBeNull();
        expect(storedOverrides({ templates: { notAKey: { subject: "a", body: "b" } } })).toBeNull();
    });

    it("renders every {{variable}}; an unknown placeholder is left as written", () => {
        const out = renderSchedulingMail({ subject: "Booking {{ref}}", body: "Hi {{customerName}} {{unknown}}", sendToCustomer: true, sendToAdmin: false },
            { ref: "B-1A2B3C4D", customerName: "Ana" });
        expect(out).toEqual({ subject: "Booking B-1A2B3C4D", body: "Hi Ana {{unknown}}" });
    });
});
