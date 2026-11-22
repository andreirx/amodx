import { describe, it, expect } from "vitest";
import { LANGUAGE_PACKS, readLanguageSettings, resolveLocaleStrings } from "@amodx/shared";
import {
    parseSiteSegment, siteSegmentFor, carriesSiteSegmentSeparator, firstPageSegmentOf, isLanguageShaped, segmentLanguage,
    localeInputFor,
} from "@/lib/site-segment";

/**
 * LANG-1B (docs/slices/lang-1.md § 7.1, § 7.2, § 8.2) — the internal first segment `<host>~<lang>`: write, read, the wire
 * refusal of the separator, the page-language rule of the layout and the resolver input. Pure; no I/O.
 */

describe("LANG-1B site segment — write and read", () => {
    it("L1B-SEGMENT: siteSegmentFor writes <id>~<lang>; parseSiteSegment reads it back; no language → the id itself", () => {
        expect(siteSegmentFor("x.ro", "ro")).toBe("x.ro~ro");
        expect(siteSegmentFor("x.ro", undefined)).toBe("x.ro");
        expect(parseSiteSegment("x.ro~ro")).toEqual({ host: "x.ro", language: "ro" });
        expect(parseSiteSegment("x.ro")).toEqual({ host: "x.ro" });
        expect(Object.hasOwn(parseSiteSegment("x.ro"), "language")).toBe(false);
        // Split at the FIRST separator; an empty language is no language.
        expect(parseSiteSegment("x.ro~ro~de")).toEqual({ host: "x.ro", language: "ro~de" });
        expect(parseSiteSegment("x.ro~")).toEqual({ host: "x.ro" });
        // A tenant id on a by-id path.
        expect(parseSiteSegment("tenant-1~ro")).toEqual({ host: "tenant-1", language: "ro" });
    });

    it("L1B-TILDE-WIRE: the separator is detected literally and percent-encoded in any depth; other values pass", () => {
        for (const raw of ["a~b.test", "a%7Eb.test", "a%7eb.test", "a%257Eb.test", "a%25257eb.test", "id~ro", "id%7Ero"]) {
            expect(carriesSiteSegmentSeparator(raw), raw).toBe(true);
        }
        for (const raw of ["a.b.test", "fixture-tenant", "x.ro", "a%7", "a%E0%A4%A", "100%", ""]) {
            expect(carriesSiteSegmentSeparator(raw), raw).toBe(false);
        }
    });

    it("L1B-TILDE-WIRE (revision 1, R-LANG1B-03): any depth — beyond four rounds — and a malformed escape elsewhere does not hide it", () => {
        // The review's cases: five and six rounds of `%25`.
        for (const raw of ["t1%2525257Ero", "t1%252525257Ero", "a%252525257Eb.test", `a%${"25".repeat(40)}7Eb.test`]) {
            expect(carriesSiteSegmentSeparator(raw), raw).toBe(true);
        }
        // Mixed with malformed escapes (the first form returned false for `id%7Ero%ZZ`), and digits that are themselves
        // encoded: `%25%37%45` → `%7E` → `~`; `%%37E` → `%7E` → `~`; `%7%45` → `%7E` → `~`.
        for (const raw of ["id%7Ero%ZZ", "%ZZid%257Ero", "id%E0%A4%A%7E", "a%25%37%45b", "a%%37Eb", "a%7%45b"]) {
            expect(carriesSiteSegmentSeparator(raw), raw).toBe(true);
        }
        // Controls: escapes that decode to other characters, malformed ones alone, a lone `%`.
        for (const raw of ["a%2Eb.test", "a%257Db.test", "id%ZZ", "id%7", "id%%", "%25%37", "a%7Fb"]) {
            expect(carriesSiteSegmentSeparator(raw), raw).toBe(false);
        }
        // Linear: a long nested value is decided quickly (each decoded escape removes two characters).
        const long = `a%${"25".repeat(20_000)}7Eb`;
        const t = Date.now();
        expect(carriesSiteSegmentSeparator(long)).toBe(true);
        expect(carriesSiteSegmentSeparator("x".repeat(100_000))).toBe(false);
        expect(Date.now() - t).toBeLessThan(1000);
    });

    it("L1B-FIRST-SEGMENT: the first segment as the page body receives it (decoded once)", () => {
        expect(firstPageSegmentOf("/ro/despre")).toBe("ro");
        expect(firstPageSegmentOf("/ro")).toBe("ro");
        expect(firstPageSegmentOf("/")).toBe("");
        expect(firstPageSegmentOf("")).toBeUndefined();
        expect(firstPageSegmentOf("/r%6F/x")).toBe("ro");
        expect(firstPageSegmentOf("/r%256F/x")).toBe("r%6F"); // once, as Next decodes a route parameter
        expect(firstPageSegmentOf("/%E0%A4%A/x")).toBe("%E0%A4%A"); // malformed: as written
    });

    it("L1B-FIRST-SEGMENT (revision 1, R-LANG1B-01): an encoded slash stays encoded and does not split the segment — the page body receives `ro%2Fdespre` (OBSERVED, both targets); a double-encoded one is decoded once", () => {
        for (const path of ["/ro%2Fdespre", "/ro%2fdespre", "/r%6F%2Fdespre", "/r%6F%2fdespre/x"]) {
            expect(firstPageSegmentOf(path), path).toBe("ro%2Fdespre");
            expect(isLanguageShaped(firstPageSegmentOf(path)), path).toBe(false);
        }
        expect(firstPageSegmentOf("/ro%252Fdespre")).toBe("ro%2Fdespre");
        expect(firstPageSegmentOf("/ro%5Cdespre")).toBe("ro\\despre");
        // Control: the same language with a real slash is a language segment.
        expect(isLanguageShaped(firstPageSegmentOf("/ro/despre"))).toBe(true);
    });

    it("L1B-LANGUAGE-SHAPED: exactly the values the language READ rule keeps (decided by that rule, so no drift)", () => {
        const cases = ["ro", "en", "deu", "r", "roma", "RO", "r1", "_b", "", "ro ", "api", "abc"];
        for (const value of cases) {
            expect(isLanguageShaped(value), value).toBe(readLanguageSettings({ languages: [value] }).languages.length === 1);
        }
        expect(isLanguageShaped("ro")).toBe(true);
        expect(isLanguageShaped("products")).toBe(false);
        expect(isLanguageShaped("_booking")).toBe(false);
        expect(isLanguageShaped(undefined)).toBe(false);
    });
});

describe("LANG-1B site segment — the page language of the layout and the resolver input", () => {
    it("L1B-SEGMENT-LANGUAGE: kept only when the tenant's own list holds it; else the default language", () => {
        expect(segmentLanguage({ host: "x.ro", language: "ro" }, ["ro"])).toEqual({ kind: "extra", subtag: "ro" });
        expect(segmentLanguage({ host: "x.ro", language: "xx" }, ["ro"])).toEqual({ kind: "default" });
        expect(segmentLanguage({ host: "x.ro", language: "ro" }, [])).toEqual({ kind: "default" });
        expect(segmentLanguage({ host: "x.ro" }, ["ro"])).toEqual({ kind: "default" });
    });

    it("L1B-LOCALE-INPUT: the default language passes the tenant record itself; an extra language its pack without overrides", () => {
        const config = { id: "t", locale: "en-US", siteStrings: { footerLinksHeading: "Our links" } } as any;
        expect(localeInputFor(config, { kind: "default" })).toBe(config);
        expect(localeInputFor(config, { kind: "extra", subtag: "ro" })).toEqual({ locale: "ro" });
        // Effect: the RO pack's text, not the tenant's (default-language) override; the default language keeps the override.
        expect(resolveLocaleStrings(localeInputFor(config, { kind: "default" })).strings.site.footerLinksHeading).toBe("Our links");
        const ro = resolveLocaleStrings(localeInputFor(config, { kind: "extra", subtag: "ro" }));
        expect(ro.strings.site.footerLinksHeading).toBe(resolveLocaleStrings({ locale: "ro-RO" }).strings.site.footerLinksHeading);
        expect(ro.strings.site.footerLinksHeading).not.toBe("Our links");
        // A language without a pack gets the English pack (the resolver's rule).
        expect(Object.prototype.hasOwnProperty.call(LANGUAGE_PACKS, "es")).toBe(false);   // precondition: es has no pack
        expect(resolveLocaleStrings(localeInputFor(config, { kind: "extra", subtag: "es" })).strings.site.footerLinksHeading)
            .toBe(resolveLocaleStrings({ locale: "en-US" }).strings.site.footerLinksHeading);
        // lang-1d: an extra language with a pack (fr) gets its pack by the same call, without the tenant's override.
        const fr = resolveLocaleStrings(localeInputFor(config, { kind: "extra", subtag: "fr" }));
        expect(fr.language).toBe("fr");
        expect(fr.strings.site.footerLinksHeading).toBe(LANGUAGE_PACKS.fr.site.footerLinksHeading);
    });
});
