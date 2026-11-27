import { describe, it, expect } from "vitest";
import {
    TenantConfigSchema, IntegrationsSchema, MailerLiteSettingsSchema, NewsletterPushSchema, NewsletterSubscriptionSchema,
    PopupSchema, LANGUAGE_PACKS, resolveLocaleStrings, newsletterTexts,
} from "../src/index.js";

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md) — the shared shapes: the MailerLite settings object that replaces the
 * unused boolean (ruling 8), the push state sum (ruling 4), the consent texts of the locale table (ruling 3), and the
 * popup's opt-in (scope item 5). Pure: no I/O.
 */

/** A tenant record as stored before NEWSLETTER-1: the admin Settings page saved the parsed integrations, so the stored
 *  object holds `mailerlite` as a boolean (the old default `false`, or `true` written by hand). */
const storedTenant = (mailerlite: unknown) => ({
    id: "t-nl", domain: "nl.example", name: "NL", plan: "Pro", status: "LIVE", createdAt: "2026-01-01T00:00:00.000Z",
    integrations: { contactEmail: "office@nl.example", paddle: { environment: "sandbox" }, analytics: { provider: "none" }, mailerlite, perplexity: false },
});

describe("NL-R8 — integrations.mailerlite: the settings object replaces the boolean; absent = off; no backfill", () => {
    for (const stored of [true, false]) {
        it(`a stored tenant holding mailerlite: ${stored} parses, with MailerLite absent (off), and its JSON holds no key`, () => {
            const parsed = TenantConfigSchema.parse(storedTenant(stored));
            expect(parsed.integrations.mailerlite).toBeUndefined();
            expect(Object.hasOwn(JSON.parse(JSON.stringify(parsed)).integrations, "mailerlite")).toBe(false);
            expect(parsed.integrations.contactEmail).toBe("office@nl.example");
        });
    }

    it("a tenant without the key parses with MailerLite absent", () => {
        const { mailerlite: _omitted, ...integrations } = storedTenant(undefined).integrations;
        expect(TenantConfigSchema.parse({ ...storedTenant(undefined), integrations }).integrations.mailerlite).toBeUndefined();
        expect(IntegrationsSchema.parse({}).mailerlite).toBeUndefined();
    });

    it("a stored settings object is kept (trimmed); a blank token or group id, null, or another shape is refused", () => {
        expect(TenantConfigSchema.parse(storedTenant({ apiToken: " tok ", groupId: "123" })).integrations.mailerlite).toEqual({ apiToken: "tok", groupId: "123" });
        for (const bad of [{ apiToken: "", groupId: "1" }, { apiToken: "t", groupId: "  " }, { apiToken: "t" }, null, "token", 1]) {
            expect(IntegrationsSchema.safeParse({ mailerlite: bad }).success, JSON.stringify(bad)).toBe(false);
        }
        expect(MailerLiteSettingsSchema.safeParse({ apiToken: "t", groupId: "g" }).success).toBe(true);
    });
});

describe("NL-R4 — the push state is a sum: NoSettings | Pending(attempt) | Sent(at, attempt) | Failed(reason, at, attempt)", () => {
    const at = "2026-11-27T10:00:00.000Z";
    it("each state carries exactly the data valid in it; every state an attempt writes names that attempt (finding NL1-R2)", () => {
        for (const ok of [
            { state: "NoSettings" }, { state: "Pending", attempt: "a1" }, { state: "Sent", at, attempt: "a1" },
            { state: "Failed", at, reason: { kind: "http", status: 401 }, attempt: "a1" },
            { state: "Failed", at, reason: { kind: "timeout" }, attempt: "a1" },
            { state: "Failed", at, reason: { kind: "network" }, attempt: "a1" },
        ]) expect(NewsletterPushSchema.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
        for (const bad of [
            { state: "Pending" },                                           // a pending state without its attempt
            { state: "Sent", attempt: "a1" },                               // a sent state without its time
            { state: "Sent", at },                                          // a sent state without its attempt
            { state: "Failed", at, attempt: "a1" },                          // a failure without its reason
            { state: "Failed", reason: { kind: "timeout" }, attempt: "a1" }, // a failure without its time
            { state: "Failed", at: "x", reason: { kind: "http" }, attempt: "a1" }, // an HTTP failure without its status
            { state: "Delivered", at: "x" },                                // no such state
            { sent: true, sentAt: null },                                   // the boolean-plus-nullable shape
        ]) expect(NewsletterPushSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    });

    it("a subscription is the consent (id, time, locale, non-empty text) plus one push state", () => {
        const consent = { id: "c1", at, locale: "de-DE", text: "Ja, ich möchte den Newsletter per E-Mail erhalten." };
        expect(NewsletterSubscriptionSchema.safeParse({ consent, push: { state: "Pending", attempt: "a1" } }).success).toBe(true);
        expect(NewsletterSubscriptionSchema.safeParse({ consent: { ...consent, text: "" }, push: { state: "NoSettings" } }).success).toBe(false);
        expect(NewsletterSubscriptionSchema.safeParse({ consent: { ...consent, id: "" }, push: { state: "NoSettings" } }).success).toBe(false);
        const { id: _id, ...withoutId } = consent;
        expect(NewsletterSubscriptionSchema.safeParse({ consent: withoutId, push: { state: "NoSettings" } }).success).toBe(false);
        expect(NewsletterSubscriptionSchema.safeParse({ consent, push: undefined }).success).toBe(false);
    });
});

describe("NL-R3 — the consent line comes from the tenant's locale table, never a hard-coded text", () => {
    const languages = Object.keys(LANGUAGE_PACKS).sort();

    it("every registered pack (en, ro, de, fr) has its own non-empty newsletter texts, and the resolver gives them for its locale", () => {
        expect(languages).toEqual(["de", "en", "fr", "ro"]);
        const consents = new Set<string>();
        for (const language of languages) {
            const site = LANGUAGE_PACKS[language].site;
            for (const key of ["newsletterEmail", "newsletterEmailPlaceholder", "newsletterConsent", "newsletterSubscribe", "newsletterSubscribing", "newsletterThanks"] as const) {
                expect(typeof site[key] === "string" && site[key]!.trim() !== "", `${language}.${key}`).toBe(true);
            }
            const t = newsletterTexts(resolveLocaleStrings({ locale: language }));
            expect(t.locale, language).toBe(resolveLocaleStrings({ locale: language }).locale);   // NL1-R3: the texts name their locale
            expect(t.consent, language).toBe(site.newsletterConsent);
            expect(t.subscribe, language).toBe(site.newsletterSubscribe);
            consents.add(t.consent);
        }
        expect(consents.size).toBe(languages.length);
        expect(newsletterTexts(resolveLocaleStrings({ locale: "es-ES" })).consent).toBe(LANGUAGE_PACKS.en.site.newsletterConsent);
    });

    it("the tenant's own consent line wins; a stored \"\" or blank one gives the language default (no box without a line)", () => {
        const own = "I want the Atelier letter.";
        expect(newsletterTexts(resolveLocaleStrings({ locale: "ro-RO", siteStrings: { newsletterConsent: own } })).consent).toBe(own);
        for (const blank of ["", "   "]) {
            expect(newsletterTexts(resolveLocaleStrings({ locale: "ro-RO", siteStrings: { newsletterConsent: blank } })).consent)
                .toBe(LANGUAGE_PACKS.ro.site.newsletterConsent);
        }
        // Pattern D for the other texts: a stored "" stays "" (as every block text).
        expect(newsletterTexts(resolveLocaleStrings({ locale: "en-US", siteStrings: { newsletterThanks: "" } })).thanks).toBe("");
        expect(newsletterTexts(resolveLocaleStrings({ locale: "fr-FR" })).failed).toBe(resolveLocaleStrings({ locale: "fr-FR" }).strings.site.formSubmissionFailed);
    });
});

describe("NL-S5 — the popup opt-in is optional; a stored popup parses without it", () => {
    const stored = { id: "p1", tenantId: "t", name: "News", type: "newsletter", createdAt: "x", updatedAt: "x" };
    it("absent stays absent; true and false are kept; anything else is refused", () => {
        expect(Object.hasOwn(PopupSchema.parse(stored), "collectEmail")).toBe(false);
        expect(PopupSchema.parse({ ...stored, collectEmail: true }).collectEmail).toBe(true);
        expect(PopupSchema.parse({ ...stored, collectEmail: false }).collectEmail).toBe(false);
        expect(PopupSchema.safeParse({ ...stored, collectEmail: "yes" }).success).toBe(false);
    });
});
