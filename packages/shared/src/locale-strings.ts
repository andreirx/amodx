import type { CatalogStrings, CommerceStrings, CountText, LocaleStrings, PluralTexts, ResolvedPart, SiteStrings } from "./index.js";
import { EN_LANGUAGE_PACK } from "./language-packs/en.js";
import { LANGUAGE_PACKS } from "./language-packs/index.js";
import type { CompletePart, LanguagePack } from "./language-packs/types.js";

/**
 * LOCALE-1 — the one resolution of the tenant locale table (docs/slices/locale-1.md § 3.3, § 5).
 * Pure: no I/O, no clock, no environment. Users: the renderer (layout, SitePage, mapTenant), the admin Labels and
 * Settings pages, and the backend PUT /settings validation (the cookie/legal key list, the plural categories).
 */

/**
 * LOCALE-1B (§ 16.2 item 6) — the six plural categories of Unicode CLDR, the closed set `Intl.PluralRules.select`
 * returns. A count key's texts are keyed by these; a language uses a subset (`pluralCategoriesOf`). A new language
 * adds its categories in its pack file only: no code names a language's categories.
 */
export const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const satisfies readonly Intl.LDMLPluralRule[];
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

/** The plural categories `language` uses, in CLDR order (`Intl.PluralRules`): English `one`, `other`; Romanian `one`,
 *  `few`, `other`. The admin Labels page offers one input per category; the RO pack test requires each. */
export function pluralCategoriesOf(language: string): PluralCategory[] {
    const used = new Set<string>(new Intl.PluralRules(language).resolvedOptions().pluralCategories);
    return PLURAL_CATEGORIES.filter((category) => used.has(category));
}

/**
 * The text of a count key for the count `n` (§ 16.2 item 6, packet rule 3), in this order: the form of the category
 * `Intl.PluralRules(language)` selects for `n`; else the language's `other`; else English — the English form of the
 * category `Intl.PluralRules("en")` selects for `n` (English rules, because English supplies the text), else the
 * English `other` (always present). Returns the template; the caller fills `{n}` and the other placeholders with
 * `fillTemplate`.
 */
export function selectPluralText(value: CountText, n: number): string {
    return value.forms[new Intl.PluralRules(value.language).select(n)]
        ?? value.forms.other
        ?? value.english[new Intl.PluralRules("en").select(n)]
        ?? value.english.other;
}

/**
 * The nine site keys whose ONLY stored location is a field of `gdpr` or `legalLinks` (§ 4.1). The resolver reads
 * them from there with today's `||` rule (a non-empty string wins); it never reads them from `siteStrings`, and
 * PUT /settings refuses `siteStrings` that contain them. The Labels page writes them back to these fields.
 */
export const COOKIE_AND_LEGAL_LABEL_LOCATIONS = {
    cookieHeadline: { attribute: "gdpr", field: "headline" },
    cookieDescription: { attribute: "gdpr", field: "description" },
    cookieDenyAll: { attribute: "gdpr", field: "denyAll" },
    cookieNecessaryOnly: { attribute: "gdpr", field: "necessaryOnly" },
    cookieAcceptAll: { attribute: "gdpr", field: "acceptAll" },
    legalTermsLabel: { attribute: "legalLinks", field: "termsLabel" },
    legalPrivacyLabel: { attribute: "legalLinks", field: "privacyLabel" },
    legalConsumerProtectionLabel: { attribute: "legalLinks", field: "anpcLabel" },
    legalDisputeResolutionLabel: { attribute: "legalLinks", field: "anpcSalLabel" },
} as const satisfies Partial<Record<keyof LocaleStrings["site"], { attribute: "gdpr" | "legalLinks"; field: string }>>;
export type CookieOrLegalLabelKey = keyof typeof COOKIE_AND_LEGAL_LABEL_LOCATIONS;

const FALLBACK_LOCALE = "en-US";

/**
 * The tenant's `locale` as a safe BCP 47 base name (§ 3.3). Never throws. Steps: not a string → en-US; trim, `_` → `-`;
 * canonicalise (a throw → en-US); keep language-script-region only (Unicode extensions such as `-u-nu-arab` are
 * dropped, so a stored value cannot switch the digit system); a locale the runtime cannot format → en-US.
 * Idempotent: a normalised value normalises to itself.
 */
export function normalizeLocale(raw: unknown): string {
    if (typeof raw !== "string") return FALLBACK_LOCALE;
    const value = raw.trim().replace(/_/g, "-");
    let base: string;
    try {
        const canonical = Intl.getCanonicalLocales(value)[0];
        if (canonical === undefined) return FALLBACK_LOCALE;
        base = new Intl.Locale(canonical).baseName;
    } catch {
        return FALLBACK_LOCALE;
    }
    return Intl.DateTimeFormat.supportedLocalesOf([base]).length > 0 ? base : FALLBACK_LOCALE;
}

/** The registered pack for a normalised locale's language subtag; English when none is registered (§ 3.3). */
function packFor(locale: string): LanguagePack {
    const language = new Intl.Locale(locale).language;
    return Object.prototype.hasOwnProperty.call(LANGUAGE_PACKS, language) ? LANGUAGE_PACKS[language] : EN_LANGUAGE_PACK;
}

/** The raw tenant fields the resolver reads, exactly as stored (`TenantConfig` fits). Anything may be malformed. */
export type LocaleStringsInput = {
    locale?: unknown;
    commerceStrings?: unknown;
    catalogStrings?: unknown;
    siteStrings?: unknown;
    gdpr?: unknown;
    legalLinks?: unknown;
};

export type ResolvedLocaleStrings = {
    /** `normalizeLocale(input.locale)` — the only locale a formatter may receive (§ 3.2 item 5). */
    locale: string;
    /** The language subtag whose pack supplied layer 2 (`"en"` when none is registered). */
    language: string;
    /** Layers 1 + 2 + 3: what a reader shows. */
    strings: LocaleStrings;
    /** Layers 1 + 2: the language default — the fallback of the pattern-F reader sites (§ 5.2) and the admin placeholders. */
    defaults: LocaleStrings;
};

/** `obj[key]` when `obj` is a plain object that owns `key` with a string value; else undefined (§ 5.1 layer 3). */
function ownString(obj: unknown, key: string): string | undefined {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined;
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
}

/** The own string texts of a stored or packed count value, per plural category; anything else is ignored. */
function ownPluralTexts(obj: unknown, key: string): PluralTexts {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj) || !Object.prototype.hasOwnProperty.call(obj, key)) return {};
    const value = (obj as Record<string, unknown>)[key];
    const out: PluralTexts = {};
    for (const category of PLURAL_CATEGORIES) {
        const text = ownString(value, category);
        if (text !== undefined) out[category] = text;
    }
    return out;
}

/**
 * One count key (§ 16.2 item 6, § 3.3). `forms` = the texts of the text language: the pack's, then the tenant's, per
 * category — every form either has is kept (a partial tenant override included). `english` = the English texts, the
 * last fallback. Which form a count gets is decided at selection (`selectPluralText`).
 */
function countText(english: PluralTexts & { other: string }, pack: PluralTexts, tenant: PluralTexts, language: string): CountText {
    return { language, forms: { ...pack, ...tenant }, english: { ...english } };
}

/**
 * Layers 1-3 for one part. A text key: the English string, the pack's string where it has one (`defaults`), the
 * tenant's own string where it has one, a stored `""` included (`strings`, § 4.1). A count key: `countText`.
 * Only the keys of the English part are read; unknown stored keys are ignored (§ 2.4).
 */
function resolvePart<T extends object>(english: CompletePart<T>, pack: Partial<T>, overrides: unknown, language: string): { defaults: ResolvedPart<T>; strings: ResolvedPart<T> } {
    const defaults: Record<string, string | CountText> = {};
    const strings: Record<string, string | CountText> = {};
    for (const [key, value] of Object.entries(english)) {
        if (typeof value === "string") {
            const packed = ownString(pack, key);
            const languageDefault = packed !== undefined ? packed : value;
            const own = ownString(overrides, key);
            defaults[key] = languageDefault;
            strings[key] = own !== undefined ? own : languageDefault;
        } else {
            const englishForms = value as PluralTexts & { other: string };
            const packForms = ownPluralTexts(pack, key);
            defaults[key] = countText(englishForms, packForms, {}, language);
            strings[key] = countText(englishForms, packForms, ownPluralTexts(overrides, key), language);
        }
    }
    return { defaults: defaults as ResolvedPart<T>, strings: strings as ResolvedPart<T> };
}

/**
 * The tenant's locale table (§ 5.1). Per key, lowest layer first: the EN pack (complete by type); the pack of the
 * text language, where it has the key; the tenant override — an own string property of `commerceStrings` /
 * `catalogStrings` / `siteStrings`, or for the nine cookie/legal keys a NON-EMPTY string of their `gdpr` /
 * `legalLinks` field (never `siteStrings`). A count key resolves per plural category (`countText`). Non-string and
 * unknown stored values are ignored. Never throws. `countryCode` is not an input: country facts do not select texts
 * (§ 3.2 item 3).
 */
export function resolveLocaleStrings(input: LocaleStringsInput): ResolvedLocaleStrings {
    const locale = normalizeLocale(input.locale);
    const pack = packFor(locale);
    const commerce = resolvePart<CommerceStrings>(EN_LANGUAGE_PACK.commerce, pack.commerce, input.commerceStrings, pack.language);
    const catalog = resolvePart<CatalogStrings>(EN_LANGUAGE_PACK.catalog, pack.catalog, input.catalogStrings, pack.language);
    const { defaults: siteDefaults, strings: site } = resolvePart<SiteStrings>(EN_LANGUAGE_PACK.site, pack.site, input.siteStrings, pack.language);
    const defaults: LocaleStrings = { commerce: commerce.defaults, catalog: catalog.defaults, site: siteDefaults };
    for (const [key, location] of Object.entries(COOKIE_AND_LEGAL_LABEL_LOCATIONS)) {
        const stored = ownString(input[location.attribute], location.field);
        site[key as CookieOrLegalLabelKey] = stored ? stored : defaults.site[key as CookieOrLegalLabelKey];
    }
    return {
        locale,
        language: pack.language,
        strings: { commerce: commerce.strings, catalog: catalog.strings, site },
        defaults,
    };
}

/**
 * Replaces each `{name}` of `template` with `String(values[name])` (§ 5.1). A placeholder without a value stays as
 * written, so a missing value is visible instead of silently empty.
 */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole);
}
