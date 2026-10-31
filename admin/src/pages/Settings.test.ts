import { describe, it, expect } from "vitest";
import { localeStatus, withCountry, withSiteLanguage } from "./Settings";

/**
 * LOCALE-1A — the "Language & Country" card of Settings (docs/slices/locale-1.md § 3.5, § 7.2; review-0 R3, R4).
 * Expected values are the ratified behaviour written out, not computed by the resolver: Site language writes the
 * pack's default locale; the country Apply writes `countryCode` and `currency` only; the help line states the date
 * locale and the text language; a present value that falls back to en-US shows the warning.
 */

describe("Site language (§ 3.5)", () => {
    it("Romanian writes locale ro-RO; English writes en-US; no other field changes", () => {
        const config = { id: "t1", locale: "en-US", countryCode: "RO", currency: "RON", commerceStrings: { addToCart: "x" } };
        expect(withSiteLanguage(config, "ro")).toEqual({ ...config, locale: "ro-RO" });
        expect(withSiteLanguage({ ...config, locale: "ro-RO" }, "en")).toEqual({ ...config, locale: "en-US" });
    });
});

describe("Country Apply (§ 7.2: country facts only, never texts)", () => {
    it("RO → countryCode RO and currency RON; locale, texts, gdpr and legal links untouched", () => {
        const config = {
            id: "t1", locale: "en-US", countryCode: "EN", currency: "USD",
            commerceStrings: { addToCart: "Add" }, siteStrings: { navContact: "Contact" },
            gdpr: { enabled: true, headline: "H" }, legalLinks: { termsLabel: "T", termsUrl: "/t" },
        };
        expect(withCountry(config, "RO")).toEqual({ ...config, countryCode: "RO", currency: "RON" });
        expect(withCountry({ ...config, countryCode: "RO", currency: "RON" }, "EN")).toEqual({ ...config, countryCode: "EN", currency: "USD" });
    });
});

describe("Locale (advanced): the help line and the fallback warning (§ 3.5; review-0 R4)", () => {
    const cases: [unknown, string, string, boolean][] = [
        // stored value, "Dates:", "Texts:", warning
        [undefined, "en-US", "English", false],          // absent: the documented default, no warning
        ["en-US", "en-US", "English", false],
        ["ro-RO", "ro-RO", "Romanian", false],
        ["ro_RO", "ro-RO", "Romanian", false],
        ["en-GB", "en-GB", "English", false],
        ["de-DE", "de-DE", "English", false],             // a language without a pack: German dates, English texts
        ["en_US", "en-US", "English", false],             // a spelling of en-US: not a fallback
        ["", "en-US", "English", true],                   // present but blank → falls back → warning
        ["   ", "en-US", "English", true],
        ["xx-YY", "en-US", "English", true],
        ["123", "en-US", "English", true],
    ];
    for (const [stored, dates, texts, warning] of cases) {
        it(`${JSON.stringify(stored) ?? "absent"} → Dates: ${dates}. Texts: ${texts}.${warning ? " + warning" : ""}`, () => {
            const s = localeStatus(stored);
            expect(s.dates).toBe(dates);
            expect(s.languageName).toBe(texts);
            expect(s.fallbackWarning).toBe(warning);
        });
    }
});
