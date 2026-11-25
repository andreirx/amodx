import { describe, it, expect, vi } from "vitest";

/*
 * SCHED-1D1 — the scheduling screen's save payloads (docs/slices/sched-1.md § 4.1, § 6.5 point 4, § 11.1). PURE-LOGIC
 * tests (no markup), as OrderDetail.test.ts: what the page sends to PUT /settings, and the text it shows for a refusal.
 * Replaced: the tenant and auth contexts and Amplify (imported by the page and by `@/lib/api`).
 */
vi.mock("@/context/TenantContext", () => ({ useTenant: () => ({ currentTenant: null }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ userRole: "TENANT_ADMIN" }) }));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));

import { settingsFormOf, settingsPayload, editableTemplates, templatesPayload, schedulingErrorText, needsContactAddressWarning, type EmailTemplate } from "./Scheduling";
import { ApiError } from "@/lib/api";

const KEYS = ["hold", "confirmed", "cancelled", "moved", "reminder", "weekAhead"] as const;
const tpl = (k: string, over: Partial<EmailTemplate> = {}): EmailTemplate =>
    ({ subject: `S ${k}`, body: `B ${k}`, sendToCustomer: k !== "weekAhead", sendToAdmin: k === "weekAhead" || k === "confirmed", ...over });
const DEFAULTS = Object.fromEntries(KEYS.map((k) => [k, tpl(k)])) as Record<(typeof KEYS)[number], EmailTemplate>;

describe("settingsFormOf — the form from the stored attribute", () => {
    it("absent → the § 4.1 defaults and no time zone; stored values are shown", () => {
        expect(settingsFormOf(undefined)).toEqual({ timezone: "", holdMinutes: "30", changeCutoffHours: "24", reminderHours: "24", bookingHorizonWeeks: "8" });
        expect(settingsFormOf({ timezone: "Europe/Bucharest", bookingHorizonWeeks: 12 })).toMatchObject({ timezone: "Europe/Bucharest", bookingHorizonWeeks: "12", holdMinutes: "30" });
    });
});

describe("settingsPayload — the PUT /settings body of the settings card", () => {
    const form = settingsFormOf({ timezone: "Europe/Bucharest" });

    it("only scheduling, with numbers; never the on/off switch (SCHED-MENU-1; audit still carries no ip, § 6.5 point 4)", () => {
        const p = settingsPayload(form);
        expect(p).toEqual({ ok: true, body: {
            scheduling: { timezone: "Europe/Bucharest", holdMinutes: 30, changeCutoffHours: 24, reminderHours: 24, bookingHorizonWeeks: 8 },
        } });
        if (p.ok) expect(Object.keys(p.body)).toEqual(["scheduling"]);
    });

    it("the enabled site's settings cannot clear its time zone (§ 4.1); switching off belongs to Settings", () => {
        const noZone = { ...form, timezone: "  " };
        expect(settingsPayload(noZone)).toEqual({ ok: false, error: "scheduling.timezone: a time zone is required when scheduling is enabled." });
    });

    it("the § 4.5 ranges are checked with the shared schema, naming the field (D14 values: 0, 53, 2.5, blank)", () => {
        for (const weeks of ["0", "53", "2.5", ""]) {
            const p = settingsPayload({ ...form, bookingHorizonWeeks: weeks });
            expect({ weeks, ok: p.ok }).toEqual({ weeks, ok: false });
            if (!p.ok) expect(p.error).toMatch(/^scheduling\.bookingHorizonWeeks: /);
        }
        for (const weeks of ["1", "52"]) expect(settingsPayload({ ...form, bookingHorizonWeeks: weeks }).ok).toBe(true);
        const badZone = settingsPayload({ ...form, timezone: "Mars/Olympus" });
        expect(badZone.ok).toBe(false);
        if (!badZone.ok) expect(badZone.error).toMatch(/^scheduling\.timezone: /);
        const hold = settingsPayload({ ...form, holdMinutes: "4" });
        expect(hold.ok).toBe(false);
    });
});

describe("templatesPayload — the PUT /settings body of the templates card", () => {
    it("no change → an empty override record (every key follows its default)", () => {
        expect(templatesPayload(editableTemplates(DEFAULTS, {}), DEFAULTS)).toEqual({ schedulingEmailConfig: { templates: {} } });
    });

    it("only the changed keys are sent, with both flags; the body names schedulingEmailConfig only", () => {
        const edited = editableTemplates(DEFAULTS, {});
        edited.cancelled = { ...edited.cancelled, body: "Custom" };
        edited.hold = { ...edited.hold, sendToAdmin: true };
        const p = templatesPayload(edited, DEFAULTS);
        expect(Object.keys(p)).toEqual(["schedulingEmailConfig"]);
        expect(p.schedulingEmailConfig.templates).toEqual({
            cancelled: { subject: "S cancelled", body: "Custom", sendToCustomer: true, sendToAdmin: false },
            hold: { subject: "S hold", body: "B hold", sendToCustomer: true, sendToAdmin: true },
        });
    });

    it("weekAhead is sent without sendToCustomer (no customer, § 11.1); sendToAdmin: false turns the mail off", () => {
        const edited = editableTemplates(DEFAULTS, {});
        edited.weekAhead = { ...edited.weekAhead, sendToAdmin: false };
        expect(templatesPayload(edited, DEFAULTS).schedulingEmailConfig.templates).toEqual({
            weekAhead: { subject: "S weekAhead", body: "B weekAhead", sendToAdmin: false },
        });
        // A change of the hidden flag alone is not a change.
        const hidden = editableTemplates(DEFAULTS, {});
        hidden.weekAhead = { ...hidden.weekAhead, sendToCustomer: true };
        expect(templatesPayload(hidden, DEFAULTS).schedulingEmailConfig.templates).toEqual({});
    });

    it("a stored override shows in the editor; reset to the default removes it from the next save", () => {
        const stored = { confirmed: tpl("confirmed", { subject: "Yes {{ref}}" }) };
        const edited = editableTemplates(DEFAULTS, stored);
        expect(edited.confirmed.subject).toBe("Yes {{ref}}");
        expect(templatesPayload(edited, DEFAULTS).schedulingEmailConfig.templates).toHaveProperty("confirmed");
        edited.confirmed = { ...DEFAULTS.confirmed };
        expect(templatesPayload(edited, DEFAULTS).schedulingEmailConfig.templates).toEqual({});
    });
});

describe("schedulingErrorText — the text shown for a refusal", () => {
    it("resourceInUse names the counts; removal in progress and busy have their own text; another refusal shows the server's reason", () => {
        expect(schedulingErrorText(new ApiError(409, { code: "resourceInUse", error: "x", activeBookings: 2 }, "API Error (409): x")))
            .toContain("2 future booking(s)");
        expect(schedulingErrorText(new ApiError(409, { code: "resourceRemovalInProgress", error: "x" }, "m"))).toContain("in progress");
        expect(schedulingErrorText(new ApiError(503, { code: "busy", error: "x" }, "m"))).toContain("busy");
        expect(schedulingErrorText(new ApiError(400, { error: "scheduling.timezone: a time zone is required when scheduling is enabled." }, "m")))
            .toBe("scheduling.timezone: a time zone is required when scheduling is enabled.");
        expect(schedulingErrorText(new Error("Network down"))).toBe("Network down");
    });
});

describe("needsContactAddressWarning — SCHED-1G3: the warning that owner mails are not sent", () => {
    it("scheduling on: absent, empty string or not a string → warn; a set address → no warning", () => {
        expect(needsContactAddressWarning(true, undefined)).toBe(true);
        expect(needsContactAddressWarning(true, "")).toBe(true);
        expect(needsContactAddressWarning(true, null)).toBe(true);
        expect(needsContactAddressWarning(true, 5)).toBe(true);
        expect(needsContactAddressWarning(true, "owner@client-site.test")).toBe(false);
    });
    it("scheduling off: never a warning (no mail is due)", () => {
        expect(needsContactAddressWarning(false, undefined)).toBe(false);
        expect(needsContactAddressWarning(false, "")).toBe(false);
        expect(needsContactAddressWarning(false, "owner@client-site.test")).toBe(false);
    });
});
