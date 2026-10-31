import { describe, it, expect } from "vitest";
import {
    COMMERCE_STRINGS_DEFAULTS, CommerceStringsSchema, CatalogStringsSchema, SiteStringsSchema, EN_PACK, RO_PACK,
    EN_LANGUAGE_PACK, RO_LANGUAGE_PACK, LANGUAGE_PACKS, COOKIE_AND_LEGAL_LABEL_LOCATIONS,
    normalizeLocale, resolveLocaleStrings, fillTemplate, type LanguagePack,
} from "../src/index.js";

/**
 * LOCALE-1A — the shared checks of docs/slices/locale-1.md § 10 row `locale-1a`: EN pack complete, RO pack covers
 * every shipped key, layer order, the § 3.3 locale cases, non-string values ignored, the nine cookie/legal keys never
 * read from `siteStrings`, `fillTemplate`; plus § 16.2 item 3 (a new language = one pack + its registration).
 * Imports the TS source (`../src/index.js`), as schemas.test.ts does. Pure: no clock, no I/O.
 */

const keys = (o: object) => Object.keys(o).sort();
const SITE_KEYS = keys(SiteStringsSchema.shape);

describe("the language packs", () => {
    it("the EN pack has exactly the schema keys of every part (completeness is also a compile-time fact)", () => {
        expect(keys(EN_LANGUAGE_PACK.commerce)).toEqual(keys(CommerceStringsSchema.shape));
        expect(keys(EN_LANGUAGE_PACK.catalog)).toEqual(keys(CatalogStringsSchema.shape));
        expect(keys(EN_LANGUAGE_PACK.site)).toEqual(SITE_KEYS);
        for (const v of [...Object.values(EN_LANGUAGE_PACK.site), ...Object.values(EN_LANGUAGE_PACK.commerce)]) expect(typeof v).toBe("string");
    });

    it("locale-1a ships 51 site keys and no catalog key (the 1a allocation; 1b adds the catalog keys)", () => {
        expect(SITE_KEYS).toHaveLength(51);
        expect(keys(CatalogStringsSchema.shape)).toEqual([]);
    });

    it("COMMERCE_STRINGS_DEFAULTS is the EN pack's commerce part: 77 keys, today's values", () => {
        expect(COMMERCE_STRINGS_DEFAULTS).toBe(EN_LANGUAGE_PACK.commerce);
        expect(Object.keys(COMMERCE_STRINGS_DEFAULTS)).toHaveLength(77);
        expect(COMMERCE_STRINGS_DEFAULTS.addToCart).toBe("Add to Cart");
        expect(COMMERCE_STRINGS_DEFAULTS.addMoreForFreeDelivery).toBe("Add {amount} more for free delivery");
        expect(COMMERCE_STRINGS_DEFAULTS.shippingStreetAddress).toBe("");
    });

    it("the EN cookie and legal values are the chain the layout rendered before 1a (field || EN country pack || literal)", () => {
        expect(EN_LANGUAGE_PACK.site.cookieHeadline).toBe(EN_PACK.gdpr.headline);
        expect(EN_LANGUAGE_PACK.site.cookieHeadline).toBe("We value your privacy");
        expect(EN_LANGUAGE_PACK.site.cookieDescription).toBe("We use cookies to enhance your browsing experience and analyze our traffic. Choose your preference below.");
        expect(EN_LANGUAGE_PACK.site.cookieDenyAll).toBe("Deny All");
        expect(EN_LANGUAGE_PACK.site.cookieNecessaryOnly).toBe("Necessary Only");
        expect(EN_LANGUAGE_PACK.site.cookieAcceptAll).toBe("Accept All");
        expect(EN_LANGUAGE_PACK.site.legalTermsLabel).toBe("Terms & Conditions");
        expect(EN_LANGUAGE_PACK.site.legalPrivacyLabel).toBe("Privacy Policy");
        expect(EN_LANGUAGE_PACK.site.legalConsumerProtectionLabel).toBe("Consumer Protection");
        expect(EN_LANGUAGE_PACK.site.legalDisputeResolutionLabel).toBe("Dispute Resolution");
    });

    it("the RO pack covers every site key, and every commerce key except the two whose English value is the empty fallback", () => {
        expect(keys(RO_LANGUAGE_PACK.site)).toEqual(SITE_KEYS);
        for (const v of Object.values(RO_LANGUAGE_PACK.site)) expect(typeof v === "string" && v.length > 0).toBe(true);
        const missing = keys(CommerceStringsSchema.shape).filter((k) => typeof (RO_LANGUAGE_PACK.commerce as any)[k] !== "string");
        expect(missing).toEqual(["billingStreetAddress", "shippingStreetAddress"]);
    });

    it("the RO pack reads its commerce, cookie and legal values from the RO country pack (one copy, § 3.2 item 2)", () => {
        expect(RO_LANGUAGE_PACK.commerce).toBe(RO_PACK.defaultStrings);
        expect(RO_LANGUAGE_PACK.site.cookieAcceptAll).toBe(RO_PACK.gdpr.acceptAll);
        expect(RO_LANGUAGE_PACK.site.legalTermsLabel).toBe(RO_PACK.legal.termsLabel);
    });

    it("the registry holds en and ro, each under its own language subtag", () => {
        expect(keys(LANGUAGE_PACKS)).toEqual(["en", "ro"]);
        for (const [language, pack] of Object.entries(LANGUAGE_PACKS)) expect(pack.language).toBe(language);
        expect(LANGUAGE_PACKS.ro.defaultLocale).toBe("ro-RO");
        expect(LANGUAGE_PACKS.en.defaultLocale).toBe("en-US");
    });
});

describe("normalizeLocale (§ 3.3; inputs of § 12 E20)", () => {
    const cases: [unknown, string][] = [
        ["ro-RO", "ro-RO"], ["ro_RO", "ro-RO"], ["ro-ro", "ro-RO"], ["RO", "ro"], ["en-GB", "en-GB"], [" ro-RO ", "ro-RO"],
        ["", "en-US"], ["xx-YY", "en-US"], ["en_US", "en-US"], ["de-DE", "de-DE"], ["123", "en-US"],
        ["ro-RO-u-nu-arab", "ro-RO"], [undefined, "en-US"], [null, "en-US"], [42, "en-US"], [{}, "en-US"],
    ];
    for (const [raw, expected] of cases) {
        it(`${JSON.stringify(raw) ?? "undefined"} → ${expected}`, () => expect(normalizeLocale(raw)).toBe(expected));
    }

    it("is idempotent", () => {
        for (const [raw] of cases) expect(normalizeLocale(normalizeLocale(raw))).toBe(normalizeLocale(raw));
    });

    it("the normalised value never throws in a date formatter, where the raw value did", () => {
        const d = new Date("2026-10-31T12:00:00Z");
        expect(() => d.toLocaleDateString("ro_RO")).toThrow(RangeError);
        expect(d.toLocaleDateString(normalizeLocale("ro_RO"), { timeZone: "UTC" })).toBe("31.10.2026");
    });
});

describe("resolveLocaleStrings — layers, language, mismatch (§ 5.1, § 3.3)", () => {
    it("a missing locale → en-US and the English texts", () => {
        const r = resolveLocaleStrings({});
        expect(r.locale).toBe("en-US");
        expect(r.language).toBe("en");
        expect(r.strings.site.breadcrumbHome).toBe("Home");
        expect(r.strings.commerce.addToCart).toBe("Add to Cart");
        expect(r.strings).toEqual(r.defaults);
    });

    it("layer order: EN < language pack < tenant override, per key", () => {
        const r = resolveLocaleStrings({ locale: "ro-RO", siteStrings: { navContact: "Scrie-ne aici" }, commerceStrings: { addToCart: "Pune în coș" } });
        expect(r.defaults.site.breadcrumbHome).toBe("Acasă");                      // layer 2
        expect(r.strings.site.navContact).toBe("Scrie-ne aici");                     // layer 3
        expect(r.defaults.site.navContact).toBe("Contact");                           // the default stays visible
        expect(r.strings.commerce.addToCart).toBe("Pune în coș");
        expect(r.strings.commerce.shippingStreetAddress).toBe("");                    // RO lacks it → layer 1
    });

    it("a stored \"\" is an override of an ordinary key (pattern D renders it empty)", () => {
        const r = resolveLocaleStrings({ siteStrings: { paginationNext: "" } });
        expect(r.strings.site.paginationNext).toBe("");
        expect(r.defaults.site.paginationNext).toBe("Next");
    });

    it("non-string stored values, unknown keys, prototype keys and non-object attributes are ignored", () => {
        const r = resolveLocaleStrings({
            siteStrings: { navContact: 7, navViewAll: null, notAKey: "x", toString: "y" } as any,
            commerceStrings: ["Add"] as any,
            gdpr: "corrupt",
        });
        expect(r.strings.site.navContact).toBe("Contact");
        expect(r.strings.site.navViewAll).toBe("View All");
        expect(r.strings.site).not.toHaveProperty("notAKey");
        expect(r.strings.commerce.addToCart).toBe("Add to Cart");
        expect(r.strings.site.cookieHeadline).toBe("We value your privacy");
        const inherited = Object.create({ navContact: "inherited" });
        expect(resolveLocaleStrings({ siteStrings: inherited }).strings.site.navContact).toBe("Contact");
    });

    it("the nine cookie/legal keys come only from gdpr/legalLinks, non-empty wins, never from siteStrings", () => {
        const nine = Object.keys(COOKIE_AND_LEGAL_LABEL_LOCATIONS);
        expect(nine).toHaveLength(9);
        const fromSite = Object.fromEntries(nine.map((k) => [k, "FROM SITE STRINGS"]));
        const r = resolveLocaleStrings({
            locale: "ro-RO",
            siteStrings: fromSite,
            gdpr: { headline: "Cookie-uri", acceptAll: "", enabled: true },
            legalLinks: { termsLabel: "Termeni", anpcLabel: "", termsUrl: "/t" },
        });
        for (const k of nine) expect((r.strings.site as any)[k]).not.toBe("FROM SITE STRINGS");
        expect(r.strings.site.cookieHeadline).toBe("Cookie-uri");
        expect(r.strings.site.cookieAcceptAll).toBe(RO_PACK.gdpr.acceptAll);                  // "" falls through (||)
        expect(r.strings.site.legalTermsLabel).toBe("Termeni");
        expect(r.strings.site.legalConsumerProtectionLabel).toBe(RO_PACK.legal.consumerProtectionLabel);
        expect(r.strings.site.cookieDescription).toBe(RO_PACK.gdpr.description);
    });

    it("country and language are independent: countryCode RO + locale en-GB → English texts, en-GB dates", () => {
        const tenant = { countryCode: "RO", locale: "en-GB" };
        const r = resolveLocaleStrings(tenant);
        expect(r.locale).toBe("en-GB");
        expect(r.strings.site.breadcrumbHome).toBe("Home");
        expect(new Date("2026-10-31T12:00:00Z").toLocaleDateString(r.locale, { timeZone: "UTC" })).toBe("31/10/2026");
    });

    it("countryCode EN + locale ro-RO → Romanian texts, ro-RO dates", () => {
        const tenant = { countryCode: "EN", locale: "ro-RO" };
        const r = resolveLocaleStrings(tenant);
        expect(r.language).toBe("ro");
        expect(r.strings.site.breadcrumbHome).toBe("Acasă");
        expect(new Date("2026-10-31T12:00:00Z").toLocaleDateString(r.locale, { timeZone: "UTC" })).toBe("31.10.2026");
    });

    it("a language without a pack (de-DE) → German dates, English texts", () => {
        const r = resolveLocaleStrings({ locale: "de-DE" });
        expect(r.locale).toBe("de-DE");
        expect(r.language).toBe("en");
        expect(r.strings.site.paginationNext).toBe("Next");
    });

    it("a malformed locale (ro_RO, \" ro-RO \") still selects Romanian; garbage selects English; nothing throws", () => {
        expect(resolveLocaleStrings({ locale: "ro_RO" }).strings.site.breadcrumbHome).toBe("Acasă");
        expect(resolveLocaleStrings({ locale: " ro-RO " }).locale).toBe("ro-RO");
        expect(resolveLocaleStrings({ locale: "123" }).strings.site.breadcrumbHome).toBe("Home");
    });

    it("returns fresh objects: mutating a result does not change the packs", () => {
        const r = resolveLocaleStrings({ locale: "ro-RO" });
        r.strings.site.breadcrumbHome = "changed";
        r.defaults.commerce.addToCart = "changed";
        expect(RO_LANGUAGE_PACK.site.breadcrumbHome).toBe("Acasă");
        expect(resolveLocaleStrings({ locale: "ro-RO" }).strings.site.breadcrumbHome).toBe("Acasă");
        expect(resolveLocaleStrings({}).defaults.commerce.addToCart).toBe("Add to Cart");
    });
});

describe("a new language is one pack file + its registration (§ 16.2 item 3)", () => {
    it("a throwaway pack registered in this test only: its keys resolve, a missing key falls back to English", () => {
        const XX: LanguagePack = {
            language: "fr", name: "French (test only)", defaultLocale: "fr-FR",
            commerce: { addToCart: "Ajouter au panier" }, catalog: {}, site: { breadcrumbHome: "Accueil" },
        };
        expect(Object.prototype.hasOwnProperty.call(LANGUAGE_PACKS, "fr")).toBe(false);
        expect(resolveLocaleStrings({ locale: "fr-FR" }).strings.site.breadcrumbHome).toBe("Home");
        LANGUAGE_PACKS.fr = XX;                                   // the registration: one entry
        try {
            const r = resolveLocaleStrings({ locale: "fr-FR" });
            expect(r.language).toBe("fr");
            expect(r.strings.site.breadcrumbHome).toBe("Accueil");
            expect(r.strings.commerce.addToCart).toBe("Ajouter au panier");
            expect(r.strings.site.paginationNext).toBe("Next");       // the pack lacks it → English
            expect(r.strings.commerce.checkout).toBe("Checkout");
        } finally {
            delete LANGUAGE_PACKS.fr;
        }
        expect(resolveLocaleStrings({ locale: "fr-FR" }).strings.site.breadcrumbHome).toBe("Home");
    });
});

describe("fillTemplate (§ 5.1)", () => {
    it("fills every placeholder with String(value)", () => {
        expect(fillTemplate("Page {page} of {total}", { page: 2, total: 5 })).toBe("Page 2 of 5");
        expect(fillTemplate("© {year} {name}. All rights reserved.", { year: 2026, name: "Acme" })).toBe("© 2026 Acme. All rights reserved.");
        expect(fillTemplate("{a}{a}", { a: "x" })).toBe("xx");
    });
    it("leaves an unknown placeholder as written; text without placeholders is unchanged", () => {
        expect(fillTemplate("Add {amount} more", {})).toBe("Add {amount} more");
        expect(fillTemplate("No placeholders here.", { x: 1 })).toBe("No placeholders here.");
        expect(fillTemplate("{toString}", {})).toBe("{toString}");
    });
});
