import { describe, it, expect, vi } from "vitest";

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md) — the admin's pure parts: the Leads page's words for each push state and
 * its reading of a lead's subscription (ruling 4, ruling 10), and the Settings card's reading of the MailerLite
 * connection (ruling 7: the token is write-only; ruling 8: the retired boolean is no connection).
 */
vi.mock("@/context/TenantContext", () => ({ useTenant: () => ({ tenants: [], currentTenant: null }) }));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));

import { newsletterPushText, subscriptionOf } from "./Leads";
import { mailerLiteDraft } from "./Settings";

describe("Leads — newsletterPushText: one wording per state and reason", () => {
    it("every state and every failure reason has its own words", () => {
        const at = "2026-11-27T10:00:00.000Z";
        const texts = [
            newsletterPushText({ state: "NoSettings" }),
            newsletterPushText({ state: "Pending", attempt: "a1" }),
            newsletterPushText({ state: "Sent", at, attempt: "a1" }),
            newsletterPushText({ state: "Failed", at, reason: { kind: "http", status: 401 }, attempt: "a1" }),
            newsletterPushText({ state: "Failed", at, reason: { kind: "http", status: 422 }, attempt: "a1" }),
            newsletterPushText({ state: "Failed", at, reason: { kind: "http", status: 429 }, attempt: "a1" }),
            newsletterPushText({ state: "Failed", at, reason: { kind: "http", status: 503 }, attempt: "a1" }),
            newsletterPushText({ state: "Failed", at, reason: { kind: "timeout" }, attempt: "a1" }),
            newsletterPushText({ state: "Failed", at, reason: { kind: "network" }, attempt: "a1" }),
        ];
        expect(new Set(texts).size).toBe(texts.length);
        expect(texts[0]).toMatch(/not connected/);
        expect(texts[1]).toMatch(/Send again/);              // Pending is visible and actionable (operator ruling on NL1-R4)
        expect(texts[3]).toMatch(/API token \(401\)/);
        expect(texts[4]).toMatch(/unsubscribed there \(422\)/);
        expect(texts[6]).toBe("Failed: MailerLite answered 503");
    });
});

describe("Leads — subscriptionOf: the `newsletter` of GET /leads, or null", () => {
    it("a valid subscription is read; none, or a malformed one, is null (no column content, no button)", () => {
        const newsletter = { consent: { id: "c1", at: "2026-11-27T10:00:00.000Z", locale: "en-US", text: "Yes." }, push: { state: "Pending", attempt: "a1" } };
        expect(subscriptionOf({ newsletter })).toEqual(newsletter);
        for (const bad of [undefined, null, {}, { consent: newsletter.consent }, { ...newsletter, push: { state: "Sent", attempt: "a1" } }, { ...newsletter, push: { state: "Pending" } }]) {
            expect(subscriptionOf({ newsletter: bad }), JSON.stringify(bad)).toBeNull();
        }
    });
});

describe("Settings — mailerLiteDraft: the connection as the card edits it", () => {
    it("the object of GET /settings (no token) → its group id and an empty token field; absent, null and the retired boolean → none", () => {
        expect(mailerLiteDraft({ groupId: "112233" })).toEqual({ groupId: "112233", apiToken: "" });
        expect(mailerLiteDraft({ groupId: "112233", apiToken: "typed" })).toEqual({ groupId: "112233", apiToken: "typed" });
        for (const none of [undefined, null, true, false, "x", []]) expect(mailerLiteDraft(none), JSON.stringify(none)).toBeNull();
    });
});
