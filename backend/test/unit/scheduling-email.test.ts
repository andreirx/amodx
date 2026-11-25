import { describe, it, expect } from "vitest";
import {
    SCHEDULING_EMAIL_KEYS, defaultSchedulingTemplates, resolveTemplate, renderSchedulingMail, storedOverrides,
} from "../../src/lib/scheduling-email.js";

/**
 * SCHED-1D1 — row D13, the module part (docs/slices/sched-1.md § 11.1, § 17.3): the six keys have defaults, an
 * override is used, an absent override falls back to the default, `weekAhead` defaults to `sendToAdmin: true`.
 * The route part (GET /scheduling/admin/email-templates) and the PUT /settings part are in
 * scheduling-admin.test.ts and scheduling-settings.test.ts. Pure; no AWS.
 * SCHED-GROUPS-REMOVE-1 row G6 (stored tenant mail data of the removed group shape) is the last describe block.
 */

describe("D13 scheduling-email — the six keys of § 11.1", () => {
    it("D13 exactly the six keys, each with a non-empty subject and body", () => {
        expect([...SCHEDULING_EMAIL_KEYS]).toEqual(["hold", "confirmed", "cancelled", "moved", "reminder", "weekAhead"]);
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
        for (const key of ["hold", "moved", "reminder"] as const) {
            expect(d[key], key).toMatchObject({ sendToCustomer: true, sendToAdmin: false });
        }
    });

    it("D13 every link-carrying mail of § 11.1 has {{link}}; cancelled has none; weekAhead has {{plannerLink}} and {{summary}}", () => {
        const d = defaultSchedulingTemplates();
        for (const key of ["hold", "confirmed", "moved", "reminder"] as const) expect(d[key].body, key).toContain("{{link}}");
        expect(d.cancelled.body).not.toContain("{{link}}");
        expect(d.weekAhead.body).toContain("{{plannerLink}}");
        expect(d.weekAhead.body).toContain("{{summary}}");
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
        const out = renderSchedulingMail("hold", { subject: "Booking {{ref}}", body: "Hi {{customerName}} {{unknown}}", sendToCustomer: true, sendToAdmin: false },
            { ref: "B-1A2B3C4D", customerName: "Ana" });
        expect(out).toEqual({ subject: "Booking B-1A2B3C4D", body: "Hi Ana {{unknown}}" });
    });
});

/**
 * SCHED-GROUPS-REMOVE-1 row G6 — stored tenant mail data of the removed group shape. A tenant may have saved, before the
 * removal, an override of the group mail key `unplaced`, or an override (edited from a default) that names the two group
 * variables. Rule: on read it keeps the meaning it had for an appointment; no scheduling route answers 500 because of it.
 */
describe("G6 stored mail data of the removed group shape", () => {
    it("G6 a stored override of the retired key `unplaced` is ignored; the other overrides are kept; any other unknown key is still storedDataInvalid", () => {
        const stored = { templates: { unplaced: { subject: "u", body: "v" }, hold: { subject: "a", body: "b" } } };
        expect(storedOverrides(stored)).toEqual({ hold: { subject: "a", body: "b" } });
        expect(storedOverrides({ templates: { unplaced: { subject: "u", body: "v" } } })).toEqual({});
        expect(storedOverrides({ templates: { unplaced: { subject: "u", body: "v" }, notAKey: { subject: "a", body: "b" } } })).toBeNull();
        expect(stored.templates.unplaced).toEqual({ subject: "u", body: "v" }); // the stored value is not changed by the read
    });

    it("G6 a stored override of a booking mail that names {{courseName}} or {{groupLink}} renders them as \"\" (what they were in every booking mail)", () => {
        const template = { subject: "{{ref}}{{courseName}}", body: "{{serviceName}}{{courseName}}, {{when}}.\n{{groupLink}}\n", sendToCustomer: true, sendToAdmin: false };
        expect(renderSchedulingMail("confirmed", template, { ref: "B-1", serviceName: "Consult", when: "2026-12-07 09:00 (Europe/Bucharest)" }))
            .toEqual({ subject: "B-1", body: "Consult, 2026-12-07 09:00 (Europe/Bucharest).\n\n" });
    });

    it("G6 the retired variables render as \"\" in every booking mail and stay as written in the weekly mail, as before the removal (review SGR-R2)", () => {
        const template = { subject: "S {{courseName}}", body: "Appointment summary|{{groupLink}}|{{courseName}}", sendToCustomer: true, sendToAdmin: true };
        for (const key of ["hold", "confirmed", "cancelled", "moved", "reminder"] as const) {
            expect(renderSchedulingMail(key, template, {}), key).toEqual({ subject: "S ", body: "Appointment summary||" });
        }
        expect(renderSchedulingMail("weekAhead", template, {})).toEqual({ subject: "S {{courseName}}", body: "Appointment summary|{{groupLink}}|{{courseName}}" });
    });

    it("G6 every appointment default renders exactly as the pre-slice default (the texts at c79b3d9, group variables \"\")", () => {
        // The five appointment defaults as they were before SCHED-GROUPS-REMOVE-1 (backend/src/lib/scheduling-email.ts at c79b3d9).
        const before: Record<"hold" | "confirmed" | "cancelled" | "moved" | "reminder", { subject: string; body: string }> = {
            hold: {
                subject: "Please confirm your booking {{ref}}",
                body: "Hello {{customerName}},\n\nWe are holding your booking {{ref}}: {{serviceName}}{{courseName}}, {{when}}.\n\n" +
                    "Please confirm it by opening this link before {{expiresAt}}:\n{{link}}\n\n" +
                    "If you did not ask for this booking, ignore this email. The booking expires if it is not confirmed.\n\n{{siteName}}",
            },
            confirmed: {
                subject: "Booking {{ref}} confirmed",
                body: "Hello {{customerName}},\n\nYour booking {{ref}} is confirmed: {{serviceName}}{{courseName}}, {{when}}.\n{{groupLink}}\n\n" +
                    "To see, move or cancel your booking, open this link:\n{{link}}\n\n{{siteName}}",
            },
            cancelled: {
                subject: "Booking {{ref}} cancelled",
                body: "Hello {{customerName}},\n\nYour booking {{ref}} ({{serviceName}}{{courseName}}, {{when}}) is cancelled.\n\n" +
                    "If you have questions, please contact us.\n\n{{siteName}}",
            },
            moved: {
                subject: "Booking {{ref}} moved",
                body: "Hello {{customerName}},\n\nYour booking {{ref}} has moved. It is now: {{serviceName}}{{courseName}}, {{when}}.\n\n" +
                    "To see, move or cancel your booking, open this link:\n{{link}}\n\n{{siteName}}",
            },
            reminder: {
                subject: "Reminder: booking {{ref}}, {{when}}",
                body: "Hello {{customerName}},\n\nThis is a reminder of your booking {{ref}}: {{serviceName}}{{courseName}}, {{when}}.\n\n" +
                    "To see, move or cancel your booking, open this link:\n{{link}}\n\n{{siteName}}",
            },
        };
        // The variables an appointment mail had before (the senders passed "" for the two group variables) and has now.
        const vars = {
            ref: "B-1A2B3C4D", customerName: "Ana", serviceName: "Consult", when: "2026-12-07 09:00 (Europe/Bucharest)",
            expiresAt: "2026-12-01 12:30 (Europe/Bucharest)", link: "https://x.example/_booking/manage#t=abc", siteName: "Atelier",
        };
        const d = defaultSchedulingTemplates();
        for (const key of Object.keys(before) as (keyof typeof before)[]) {
            const old = renderSchedulingMail(key, { ...d[key], ...before[key] }, { ...vars, courseName: "", groupLink: "" });
            expect(renderSchedulingMail(key, d[key], vars), key).toEqual(old);
        }
    });
});
