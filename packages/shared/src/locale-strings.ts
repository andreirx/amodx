import type { LocaleStrings } from "./index.js";
import { EN_LANGUAGE_PACK } from "./language-packs/en.js";
import { LANGUAGE_PACKS } from "./language-packs/index.js";
import type { LanguagePack } from "./language-packs/types.js";

/**
 * LOCALE-1 — the one resolution of the tenant locale table (docs/slices/locale-1.md § 3.3, § 5).
 * Pure: no I/O, no clock, no environment. Users: the renderer (layout, SitePage, mapTenant), the admin Labels and
 * Settings pages, and the backend PUT /settings validation (the cookie/legal key list).
 */

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

/** Layers 1 + 2 for one part: every key of the English part, the pack's string where it has one. */
function languageDefaults<T extends object>(english: T, pack: Partial<NoInfer<T>>): T {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(english)) {
        const own = ownString(pack, key);
        out[key] = own !== undefined ? own : (value as string);
    }
    return out as T;
}

/** Layer 3 for one part: the tenant's own string value of a key wins (a stored `""` included, § 4.1). */
function withOverrides<T extends object>(defaults: T, overrides: unknown): T {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(defaults)) {
        const own = ownString(overrides, key);
        out[key] = own !== undefined ? own : (value as string);
    }
    return out as T;
}

/**
 * The tenant's locale table (§ 5.1). Per key, lowest layer first: the EN pack (complete by type); the pack of the
 * text language, where it has the key; the tenant override — an own string property of `commerceStrings` /
 * `catalogStrings` / `siteStrings`, or for the nine cookie/legal keys a NON-EMPTY string of their `gdpr` /
 * `legalLinks` field (never `siteStrings`). Non-string and unknown stored values are ignored. Never throws.
 * `countryCode` is not an input: country facts do not select texts (§ 3.2 item 3).
 */
export function resolveLocaleStrings(input: LocaleStringsInput): ResolvedLocaleStrings {
    const locale = normalizeLocale(input.locale);
    const pack = packFor(locale);
    const defaults: LocaleStrings = {
        commerce: languageDefaults(EN_LANGUAGE_PACK.commerce, pack.commerce),
        catalog: languageDefaults(EN_LANGUAGE_PACK.catalog, pack.catalog),
        site: languageDefaults(EN_LANGUAGE_PACK.site, pack.site),
    };
    const site = withOverrides(defaults.site, input.siteStrings);
    for (const [key, location] of Object.entries(COOKIE_AND_LEGAL_LABEL_LOCATIONS)) {
        const stored = ownString(input[location.attribute], location.field);
        site[key as CookieOrLegalLabelKey] = stored ? stored : defaults.site[key as CookieOrLegalLabelKey];
    }
    return {
        locale,
        language: pack.language,
        strings: {
            commerce: withOverrides(defaults.commerce, input.commerceStrings),
            catalog: withOverrides(defaults.catalog, input.catalogStrings),
            site,
        },
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
