/**
 * LANG-1 (docs/slices/lang-1.md § 4, § 5, § 5.1) — the language of a page and the READ rule of the tenant's language
 * settings. Pure; imports NOTHING, so the renderer middleware can load this one built module
 * (`@amodx/shared/dist/languages.js`) without the rest of the package (§ 7.1, `lang-1b`).
 *
 * The rule (LANG1-LANG-SOURCE = A): the address states the language. A tenant has one default language (the language
 * subtag of its `locale`; this module does not compute it) and may list extra languages (`languages`). A page whose
 * address starts with `/<l>` or `/<l>/`, `<l>` in the list, is in language `<l>`; every other page is in the default
 * language. No item stores a language: it is derived at read time from the CURRENT address and the CURRENT list.
 */

/** A link of a menu or footer list, as `LinkSchema` (index.ts) describes it. Declared here: this module imports nothing. */
export type LanguageLink = { label: string; href: string; children?: { label: string; href: string }[] };

/** The language of one page. `default` = the tenant's default language; `extra` = a listed extra language. */
export type PageLanguage = { kind: "default" } | { kind: "extra"; subtag: string };

/** The tenant's language settings after the read rule: every value valid, nothing else kept. A DTO. */
export type LanguageSettings = {
    languages: string[];
    navLinksByLang: Record<string, LanguageLink[]>;
    footerLinksByLang: Record<string, LanguageLink[]>;
};

/** The form of a stored extra language that the read rule keeps (§ 5.1). The write rule (V1) is stricter. */
const SUBTAG_FORM = /^[a-z]{2,3}$/;

/** True for an object literal or a null-prototype object; false for arrays, `Set`, `Map`, class instances, null. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** `{ label, href }` when `value` is a plain object whose own `label` and `href` are strings; else null. */
function linkBase(value: unknown): { label: string; href: string } | null {
    if (!isPlainObject(value)) return null;
    const { label, href } = value;
    return typeof label === "string" && typeof href === "string" ? { label, href } : null;
}

/** A kept list entry: label and href, and `children` only when stored as an array (its bad entries dropped). */
function readLink(value: unknown): LanguageLink | null {
    const base = linkBase(value);
    if (base === null) return null;
    const children = (value as Record<string, unknown>).children;
    if (!Array.isArray(children)) return base;
    const kept: { label: string; href: string }[] = [];
    for (const child of children) {
        const link = linkBase(child);
        if (link !== null) kept.push(link);
    }
    return { ...base, children: kept };
}

/** One per-language map: a key kept when it is a kept language and its value is an array; bad entries dropped. */
function readLinkMap(raw: unknown, languages: readonly string[]): Record<string, LanguageLink[]> {
    const out: Record<string, LanguageLink[]> = {};
    if (!isPlainObject(raw)) return out;
    for (const language of languages) {
        if (!Object.prototype.hasOwnProperty.call(raw, language)) continue;
        const list = raw[language];
        if (!Array.isArray(list)) continue;
        const kept: LanguageLink[] = [];
        for (const entry of list) {
            const link = readLink(entry);
            if (link !== null) kept.push(link);
        }
        out[language] = kept;
    }
    return out;
}

/**
 * The ONE read rule for the stored `languages`, `navLinksByLang` and `footerLinksByLang` (§ 5.1). Input: a PLAIN record
 * (the DocumentClient form). Never throws; it drops what is invalid:
 *  - `languages` not an array → `[]`; an entry is kept when it is a string of 2-3 lowercase letters not kept before;
 *  - a map that is not a plain object → `{}`; a key is kept when it is a kept language and its value is an array; an
 *    entry is kept when it is a plain object with string `label` and `href`; `children` kept only as an array of such
 *    objects; an array whose entries are all dropped stays `[]`.
 * It does not take `locale` and does not decide the default language. Legacy `navLinks` / `footerLinks` are not read.
 */
export function readLanguageSettings(raw: unknown): LanguageSettings {
    const record = isPlainObject(raw) ? raw : {};
    const languages: string[] = [];
    if (Array.isArray(record.languages)) {
        for (const entry of record.languages) {
            if (typeof entry === "string" && SUBTAG_FORM.test(entry) && !languages.includes(entry)) languages.push(entry);
        }
    }
    return {
        languages,
        navLinksByLang: readLinkMap(record.navLinksByLang, languages),
        footerLinksByLang: readLinkMap(record.footerLinksByLang, languages),
    };
}

/**
 * The language of the page at `slug` (§ 5): the first path segment (`"/ro/x"` → `"ro"`, `"/ro"` → `"ro"`, `"/"` → none;
 * the segment after the first `/`, as the middleware splits a request path) is an extra language when it is in
 * `languages`; else the default language.
 */
export function pageLanguageOf(slug: string, languages: readonly string[]): PageLanguage {
    const first = slug.split("/")[1];
    return first !== undefined && first !== "" && languages.includes(first) ? { kind: "extra", subtag: first } : { kind: "default" };
}

/**
 * The language tag a page is advertised with (its `hreflang` value, § 8.4): an extra language → its subtag; the default
 * language → `defaultSubtag` (the caller passes `localeLanguageSubtag(locale)`). Two pages are "in the same language"
 * when these tags are equal (§ 5.3), so a default page and an extra page listed under the default subtag collide.
 */
export function languageTagOf(language: PageLanguage, defaultSubtag: string): string {
    switch (language.kind) {
        case "default": return defaultSubtag;
        case "extra": return language.subtag;
    }
}
