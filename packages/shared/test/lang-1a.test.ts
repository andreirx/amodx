import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
    readLanguageSettings, pageLanguageOf, languageTagOf, languageSettingsProblem,
    TenantConfigSchema, ContentItemSchema, TranslationOfInputSchema, URL_PREFIX_DEFAULTS,
} from "../src/index";

/**
 * LANG-1A (docs/slices/lang-1.md § 5, § 11) — the pure rules of `packages/shared`: the read rule of the language settings
 * (`readLanguageSettings`, § 5.1), the page-language derivation (`pageLanguageOf`, § 5), the tag used to compare two
 * pages' languages (`languageTagOf`, § 5.3), and the write rule V1-V6 (`languageSettingsProblem`, § 5.2). The handler
 * rows of the same rules (a 400 from PUT /settings) are in backend/test/unit/lang-1a-settings.test.ts.
 */

describe("readLanguageSettings (§ 5.1)", () => {
    it("L1A-READ-SETTINGS-ABSENT: a record without the fields (and a non-record) → [], {}, {}", () => {
        for (const raw of [{}, { locale: "ro-RO", navLinks: [{ label: "x", href: "/" }] }, undefined, null, "x", 5, []]) {
            expect(readLanguageSettings(raw), JSON.stringify(raw)).toEqual({ languages: [], navLinksByLang: {}, footerLinksByLang: {} });
        }
    });

    it("L1A-READ-SETTINGS-VALID: a valid record is returned as stored (children kept)", () => {
        const raw = {
            languages: ["ro", "de"],
            navLinksByLang: { ro: [{ label: "Acasă", href: "/ro", children: [{ label: "Echipa", href: "/ro/echipa" }] }] },
            footerLinksByLang: { de: [{ label: "Kontakt", href: "/de/kontakt" }], ro: [] },
        };
        expect(readLanguageSettings(raw)).toEqual(raw);
    });

    it("L1A-READ-SETTINGS-MALFORMED: languages not an array → []; bad entries dropped, first one wins", () => {
        expect(readLanguageSettings({ languages: "ro" }).languages).toEqual([]);
        expect(readLanguageSettings({ languages: [null, "RO", "ro", "ro", 5] }).languages).toEqual(["ro"]);
        expect(readLanguageSettings({ languages: ["de", "abcd", "d", "_book", "fr", "de"] }).languages).toEqual(["de", "fr"]);
        expect(readLanguageSettings({ languages: new Set(["ro"]) }).languages).toEqual([]);
    });

    it("L1A-READ-SETTINGS-MALFORMED: a map that is an array, null, a Set or a string → {}", () => {
        for (const map of [[], null, new Set(["ro"]), "ro", 7]) {
            const out = readLanguageSettings({ languages: ["ro"], navLinksByLang: map, footerLinksByLang: map });
            expect(out.navLinksByLang).toEqual({});
            expect(out.footerLinksByLang).toEqual({});
        }
    });

    it("L1A-READ-SETTINGS-MALFORMED: a key not in languages and a value that is not an array are dropped", () => {
        const out = readLanguageSettings({
            languages: ["ro"],
            navLinksByLang: { fr: [{ label: "x", href: "/fr" }], ro: { label: "x", href: "/ro" } },
            footerLinksByLang: { RO: [], ro: [{ label: "a", href: "/ro/a" }] },
        });
        expect(out.navLinksByLang).toEqual({});
        expect(out.footerLinksByLang).toEqual({ ro: [{ label: "a", href: "/ro/a" }] });
    });

    it("L1A-READ-SETTINGS-MALFORMED: entries null and {label: 1} dropped; children not an array removed; a bad child dropped; nothing thrown", () => {
        const out = readLanguageSettings({
            languages: ["ro"],
            navLinksByLang: {
                ro: [
                    null,
                    { label: 1 },
                    { label: "Acasă", href: "/ro" },
                    { label: "Despre", href: "/ro/despre", children: "x" },
                    { label: "Meniu", href: "/ro/m", children: [null, { label: "Unu", href: "/ro/1" }, { label: "Doi" }, { label: "Trei", href: "/ro/3", extra: true }] },
                    { label: "Extra", href: "/ro/e", target: "_blank" },
                ],
            },
            footerLinksByLang: { ro: [null, 5] },
        });
        expect(out.navLinksByLang.ro).toEqual([
            { label: "Acasă", href: "/ro" },
            { label: "Despre", href: "/ro/despre" },
            { label: "Meniu", href: "/ro/m", children: [{ label: "Unu", href: "/ro/1" }, { label: "Trei", href: "/ro/3" }] },
            { label: "Extra", href: "/ro/e" },
        ]);
        expect(out.footerLinksByLang).toEqual({ ro: [] });
    });

    it("L1A-READ-SETTINGS-MALFORMED: the menu of lang1c-menu-malformed-entries reads as one link", () => {
        const out = readLanguageSettings({ languages: ["ro"], navLinksByLang: { ro: [null, { label: 1 }, { label: "Acasă", href: "/ro" }] } });
        expect(out.navLinksByLang.ro).toEqual([{ label: "Acasă", href: "/ro" }]);
    });
});

describe("pageLanguageOf and languageTagOf (§ 5, § 5.3)", () => {
    it("L1A-PAGE-LANGUAGE: the first segment states the language only when it is listed", () => {
        const langs = ["ro", "de"];
        expect(pageLanguageOf("/ro/x", langs)).toEqual({ kind: "extra", subtag: "ro" });
        expect(pageLanguageOf("/ro", langs)).toEqual({ kind: "extra", subtag: "ro" });
        expect(pageLanguageOf("/ro/", langs)).toEqual({ kind: "extra", subtag: "ro" });
        expect(pageLanguageOf("/", langs)).toEqual({ kind: "default" });
        expect(pageLanguageOf("", langs)).toEqual({ kind: "default" });
        expect(pageLanguageOf("/fr/x", langs)).toEqual({ kind: "default" });
        expect(pageLanguageOf("/romania", langs)).toEqual({ kind: "default" });
        expect(pageLanguageOf("/ro/x", [])).toEqual({ kind: "default" });
        expect(pageLanguageOf("//ro/x", langs)).toEqual({ kind: "default" });
    });

    it("L1A-PAGE-LANGUAGE: the tag of a default page is the default subtag; of an extra page its subtag", () => {
        expect(languageTagOf({ kind: "default" }, "en")).toBe("en");
        expect(languageTagOf({ kind: "extra", subtag: "ro" }, "en")).toBe("ro");
        // A stored list that names the default subtag (only a table edit makes it): both pages carry the same tag.
        expect(languageTagOf(pageLanguageOf("/en/x", ["en"]), "en")).toBe(languageTagOf(pageLanguageOf("/x", ["en"]), "en"));
    });
});

describe("languageSettingsProblem (§ 5.2, V1-V6)", () => {
    const base = { locale: "en-US", urlPrefixes: URL_PREFIX_DEFAULTS };

    it("L1A-SETTINGS-NO-LANGS: a record without the fields is valid; V6 is not checked without languages", () => {
        expect(languageSettingsProblem({})).toBeNull();
        expect(languageSettingsProblem({ ...base, homePageSlug: "/en/home" })).toBeNull();
        expect(languageSettingsProblem({ ...base, languages: [], homePageSlug: "/en/home" })).toBeNull();
    });

    it("L1A-LANGS-VALID: valid lists, maps and a default-language homePageSlug", () => {
        expect(languageSettingsProblem({ ...base, languages: ["ro", "de", "fr"] })).toBeNull();
        expect(languageSettingsProblem({ locale: "ro-RO", languages: ["en"], homePageSlug: "/acasa" })).toBeNull();
        expect(languageSettingsProblem({
            ...base, languages: ["ro"],
            navLinksByLang: { ro: [{ label: "Acasă", href: "/ro", children: [{ label: "Echipa", href: "/ro/echipa" }] }] },
            footerLinksByLang: { ro: [] },
        })).toBeNull();
    });

    it("L1A-LANGS-REFUSED: V1 not an array, uppercase, unknown, malformed entries", () => {
        for (const languages of ["ro", null, { ro: true }]) {
            expect(languageSettingsProblem({ ...base, languages }), JSON.stringify(languages)).toMatch(/^languages: /);
        }
        for (const entry of ["RO", "xx", "eng", "r", "_book", 5, null, "ro-RO"]) {
            expect(languageSettingsProblem({ ...base, languages: [entry] }), JSON.stringify(entry)).toMatch(/^languages: .* is not a language code/);
        }
    });

    it("L1A-LANGS-REFUSED: V2 twice, V3 the default subtag, V4 a URL-prefix segment and api", () => {
        expect(languageSettingsProblem({ ...base, languages: ["ro", "ro"] })).toBe('languages: "ro" is listed twice.');
        expect(languageSettingsProblem({ ...base, languages: ["en"] })).toMatch(/^languages: "en" is the default language/);
        expect(languageSettingsProblem({ locale: "ro-RO", languages: ["ro"] })).toMatch(/^languages: "ro" is the default language/);
        // Absent or malformed locale → the default is "en" (localeLanguageSubtag).
        expect(languageSettingsProblem({ languages: ["en"] })).toMatch(/^languages: "en" is the default language/);
        expect(languageSettingsProblem({ ...base, urlPrefixes: { ...URL_PREFIX_DEFAULTS, shop: "/de/shop" }, languages: ["de"] }))
            .toBe('languages: "de" is the start of the URL prefix shop ("/de/shop"); change the prefix or choose another language.');
        expect(languageSettingsProblem({ ...base, urlPrefixes: { product: "/ro" }, languages: ["ro"] })).toMatch(/URL prefix product/);
        // "api": the runtime cannot format it, so V1 already refuses it (EXECUTED: normalizeLocale("api") = "en-US").
        expect(languageSettingsProblem({ ...base, languages: ["api"] })).toMatch(/^languages: "api" is not a language code/);
    });

    it("L1A-BYLANG-REFUSED: V5 a key not in languages, a value that is not a link list, a map that is not an object", () => {
        expect(languageSettingsProblem({ ...base, languages: ["ro"], navLinksByLang: { de: [] } })).toBe('navLinksByLang: "de" is not in the site\'s languages.');
        expect(languageSettingsProblem({ ...base, navLinksByLang: { ro: [] } })).toBe('navLinksByLang: "ro" is not in the site\'s languages.');
        expect(languageSettingsProblem({ ...base, languages: ["ro"], footerLinksByLang: { ro: [{ label: 1, href: "/" }] } })).toMatch(/^footerLinksByLang\.ro\.0\.label: /);
        expect(languageSettingsProblem({ ...base, languages: ["ro"], footerLinksByLang: { ro: "x" } })).toMatch(/^footerLinksByLang\.ro: /);
        expect(languageSettingsProblem({ ...base, languages: ["ro"], navLinksByLang: [] })).toMatch(/^navLinksByLang: must be an object/);
        expect(languageSettingsProblem({ ...base, languages: ["ro"], navLinksByLang: null })).toMatch(/^navLinksByLang: must be an object/);
    });

    it("L1A-LANGS-HOMEPAGE-REFUSED: V6 a homePageSlug under a listed prefix (the merged settings), control without languages", () => {
        expect(languageSettingsProblem({ ...base, languages: ["en"], locale: "ro-RO", homePageSlug: "/en/home" })).toMatch(/^homePageSlug: /);
        expect(languageSettingsProblem({ ...base, languages: ["ro"], homePageSlug: "/ro" })).toMatch(/^homePageSlug: /);
        expect(languageSettingsProblem({ ...base, languages: ["ro"], homePageSlug: "/romania" })).toBeNull();
        expect(languageSettingsProblem({ ...base, languages: ["ro"], homePageSlug: "" })).toBeNull();
        expect(languageSettingsProblem({ ...base, homePageSlug: "/ro/home" })).toBeNull();
    });
});

describe("schemas — the new fields are optional and change no existing record (preservation)", () => {
    const inputs = JSON.parse(readFileSync(new URL("./fixtures/lang-1a-existing-records.json", import.meta.url), "utf8"));
    const head = JSON.parse(readFileSync(new URL("./fixtures/lang-1a-head-parse-4cb6b96.json", import.meta.url), "utf8"));

    it("L1A-PRESERVE-RECORDS: an existing tenant (en-US, ro-RO) and content item parse exactly as at HEAD 4cb6b96, less the retired `integrations.mailerlite: false` default (NEWSLETTER-1 ruling 8), and read back unchanged from JSON", () => {
        for (const name of ["tenantEn", "tenantRo"] as const) {
            const parsed = TenantConfigSchema.parse(inputs[name]);
            // NEWSLETTER-1 (ruling 8): the unused boolean `integrations.mailerlite` (default false) is replaced by an
            // optional settings object, absent = off. The capture at 4cb6b96 stays as captured; its one retired key is removed here.
            const { mailerlite: retired, ...integrations } = head[name].integrations;
            expect(retired, `${name}: the capture holds the retired default`).toBe(false);
            expect(parsed, name).toEqual({ ...head[name], integrations });
            for (const key of ["languages", "navLinksByLang", "footerLinksByLang"]) expect(Object.hasOwn(parsed, key), `${name}.${key}`).toBe(false);
            // The stored record (JSON) parses to the same output. (Not a re-parse of the OUTPUT: the schema's own default
            // `integrations.contactEmail: ""` fails its `.email()` check — pre-existing, outside this slice.)
            expect(TenantConfigSchema.parse(JSON.parse(JSON.stringify(inputs[name]))), `${name} round-trip`).toEqual(parsed);
        }
        const content = ContentItemSchema.parse(inputs.contentItem);
        expect(content).toEqual(head.contentItem);
        expect(Object.hasOwn(content, "translationKey")).toBe(false);
        expect(ContentItemSchema.parse(JSON.parse(JSON.stringify(content)))).toEqual(content);
    });

    it("L1A-PRESERVE-RECORDS: the fields are accepted when present; translationOf input takes a string, null or nothing", () => {
        const tenant = TenantConfigSchema.parse({ ...inputs.tenantEn, languages: ["ro"], navLinksByLang: { ro: [] }, footerLinksByLang: {} });
        expect(tenant.languages).toEqual(["ro"]);
        expect(ContentItemSchema.parse({ ...inputs.contentItem, translationKey: "k" }).translationKey).toBe("k");
        expect(TranslationOfInputSchema.safeParse("n-2").success).toBe(true);
        expect(TranslationOfInputSchema.safeParse(null).success).toBe(true);
        expect(TranslationOfInputSchema.safeParse(undefined).success).toBe(true);
        expect(TranslationOfInputSchema.safeParse(5).success).toBe(false);
    });
});
