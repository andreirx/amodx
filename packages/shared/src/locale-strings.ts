import type { CatalogStrings, CommerceStrings, CountText, ImportLabels, LocaleStrings, PluralTexts, ResolvedPart, SiteStrings } from "./index.js";
import { EN_LANGUAGE_PACK } from "./language-packs/en.js";
import { LANGUAGE_PACKS } from "./language-packs/index.js";
import type { BookingStrings, CompletePart, LanguagePack } from "./language-packs/types.js";

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

/**
 * LOCALE-1E — the language subtag of the tenant's normalised locale (`"en-US"` → `"en"`, `"ro-RO"` → `"ro"`,
 * `"de-DE"` → `"de"`; absent or malformed → `"en"`, the § 3.3 fallback). The language the page content is written in,
 * for the `<html lang>` attribute. NOT `ResolvedLocaleStrings.language`, which is the language of the selected PACK
 * (`"en"` for an `es-ES` tenant, because no `es` pack exists). Never throws.
 */
export function localeLanguageSubtag(raw: unknown): string {
    return new Intl.Locale(normalizeLocale(raw)).language;
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
 * LOCALE-1C (§ 5.3, § 6.1; ruling LOCALE1-BLOCK-TEXTS = A) — the site keys a block renderer reads (`packages/plugins`
 * `*Render.tsx`): the fixed chrome of § 6.1 that is the same in every block instance, plus the two form texts the lead
 * and contact blocks share with `DynamicForm` / the checkout (`formSubmissionFailed`, `errorTryAgain`). Order = the
 * order of the `strings` prop in the RSC payload.
 */
export const BLOCK_SITE_KEYS = [
    "formSubmissionFailed", "errorTryAgain",
    "contactSendFailed", "contactSent", "contactSentDetail", "contactName", "contactEmail", "contactMessage", "contactSending",
    "leadUnlocked", "leadFileReady", "leadDownload", "leadEmail", "leadEmailPlaceholder", "leadUnlocking",
    "heroNoImage", "imageAltFallback", "videoTitle", "videoBackgroundTitle", "noImage", "noImageCaps", "carouselView",
    "codeCopy", "codeCopied", "reviewsReadMore", "reviewsShowLess", "postsEmpty", "postsLoadFailed",
] as const satisfies readonly (keyof SiteStrings)[];

/**
 * What `RenderBlocks` gives every block renderer as its `strings` prop (§ 5.3): a plain DTO of resolved texts — the
 * block keys of the site part, the category showcase's texts of the commerce part, and the tenant's locale for the two
 * date formatters of § 3.4. Every text is shown exactly as resolved (§ 5.2 pattern D: a stored "" renders empty),
 * except the two keys of `BLOCK_FALLBACK_KEYS`.
 */
export type BlockStrings = { [K in (typeof BLOCK_SITE_KEYS)[number]]: string } & {
    showcaseEmpty: string;
    /** The showcase's stock overlay text. ABSENT on a catalog site: CATALOG-MODE-1 (§ 3.2.6) lets no stock text reach
     *  a catalog page, its RSC payload included (the plugin never shows the overlay there). */
    outOfStock?: string;
    /** The tenant's normalised locale, present ONLY for a tenant that is not en-US (§ 16.2 item 4). Its absence means an
     *  en-US tenant: the post grid then keeps the runtime default; a reviews carousel without its own non-empty `locale`
     *  attribute formats `"en-US"` (LOCALE-REVIEWS-DATE-1, the human's ruling on finding F-LOCALE-REVIEWS-DATE). */
    dateLocale?: string;
};

/**
 * LOCALE-1C (operator ruling LOCALE1C-IFRAME-NAMES = A, 2026-11-01): the named exceptions to the direct-render rule of
 * § 5.2 among the block keys — pattern F, as `signIn` / `accountLabel` in `locale-1d`: a stored "" gives the language
 * default. They are the accessible names of the video and video-hero iframes (the vid-2 / vid-3 contract: the name is
 * never empty), so an empty override must not remove the name.
 */
export const BLOCK_FALLBACK_KEYS = ["videoTitle", "videoBackgroundTitle"] as const satisfies readonly (typeof BLOCK_SITE_KEYS)[number][];

/** The `strings` of every block on a page of this tenant (§ 5.3). `catalogMode`: the tenant is a catalog site. */
export function blockStrings(resolved: ResolvedLocaleStrings, { catalogMode }: { catalogMode: boolean }): BlockStrings {
    const out = Object.fromEntries(BLOCK_SITE_KEYS.map((key) => [key, resolved.strings.site[key]])) as BlockStrings;
    for (const key of BLOCK_FALLBACK_KEYS) out[key] = resolved.strings.site[key] || resolved.defaults.site[key];
    out.showcaseEmpty = resolved.strings.commerce.showcaseEmpty;
    if (!catalogMode) out.outOfStock = resolved.strings.commerce.outOfStock;
    if (resolved.locale !== FALLBACK_LOCALE) out.dateLocale = resolved.locale;
    return out;
}

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md, ruling 3) — the visitor texts of the newsletter form (the `newsletter`
 * block and a newsletter popup that collects addresses), from the tenant's locale table. Every text as resolved
 * (pattern D), except `consent`: a stored "" or blank override gives the language default (pattern F), because a box
 * with no line beside it records no informed consent. Users: the renderer's server pass (`_newsletter` of the block),
 * the backend's public popups answer, and the lead write, which stores `consent` only when the browser sent exactly this
 * text — so the page, the popup and the stored evidence can never disagree on the rule.
 */
export type NewsletterTexts = {
    /** The normalised locale these texts were resolved for (NL1-R3): the browser sends it with the consent line, and the
     *  backend checks the pair (locale, line) — a line alone does not identify its locale. */
    locale: string;
    email: string;
    emailPlaceholder: string;
    consent: string;
    subscribe: string;
    subscribing: string;
    thanks: string;
    failed: string;
};

export function newsletterTexts(resolved: ResolvedLocaleStrings): NewsletterTexts {
    const s = resolved.strings.site;
    return {
        locale: resolved.locale,
        email: s.newsletterEmail,
        emailPlaceholder: s.newsletterEmailPlaceholder,
        consent: s.newsletterConsent.trim() || resolved.defaults.site.newsletterConsent,
        subscribe: s.newsletterSubscribe,
        subscribing: s.newsletterSubscribing,
        thanks: s.newsletterThanks,
        failed: s.formSubmissionFailed,
    };
}

/**
 * GALLERY-1 (docs/slices/gallery-1.md, ruling 2) — the visitor texts of the `gallery` block's photo viewer and tiles,
 * from the tenant's locale table in the page's language. Every text is non-blank: a stored "" or blank override gives the
 * language default (pattern F), because each one is an accessible name (the dialog, the three buttons, a tile whose photo
 * has no description) or the position the viewer announces. `counter` keeps `{n}` and `{total}`, `photo` keeps `{n}`;
 * the plugin fills them with `fillTemplate`. User: the renderer's server pass (`_gallery` of the block).
 */
export type GalleryTexts = {
    /** The dialog's accessible name. */
    viewer: string;
    close: string;
    previous: string;
    next: string;
    /** The position in the viewer: a template with `{n}` and `{total}`. */
    counter: string;
    /** A tile's accessible name when its photo has no description: a template with `{n}`. */
    photo: string;
};

export function galleryTexts(resolved: ResolvedLocaleStrings): GalleryTexts {
    const s = resolved.strings.site;
    const d = resolved.defaults.site;
    const nonBlank = (own: string, languageDefault: string) => own.trim() || languageDefault;
    return {
        viewer: nonBlank(s.galleryViewer, d.galleryViewer),
        close: nonBlank(s.galleryClose, d.galleryClose),
        previous: nonBlank(s.galleryPrevious, d.galleryPrevious),
        next: nonBlank(s.galleryNext, d.galleryNext),
        counter: nonBlank(s.galleryCounter, d.galleryCounter),
        photo: nonBlank(s.galleryPhoto, d.galleryPhoto),
    };
}

/**
 * CDL-1 (docs/slices/catalog-data-labels-1.md § 3.3, § 3.5) — the catalog texts the backend WRITES into products or
 * MAILS to the site owner, in the tenant's language with its overrides. Every text is non-empty: a stored override
 * that is "" or only whitespace gives the language default (LOCALE-1 pattern F), because an empty attribute key is
 * dropped by the product page and the facets, and an empty mail line says nothing. A non-blank override is used
 * trimmed. `siteLabels` = the four attribute keys of the file columns 0, 6, 7, 8 ("Use the site labels");
 * `variantName` = the option name written when the import request gives none (both label choices); `interestMail` =
 * the subject and lines of the interest-list mail (`{name}`, `{n}`, `{date}` filled by the caller).
 * Users: the glam import handler (`backend/src/import/glam-pricelist.ts`) and the interest route
 * (`backend/src/interest/public.ts`).
 */
export type CatalogServerTexts = {
    siteLabels: ImportLabels;
    variantName: string;
    interestMail: { subject: string; intro: string; products: string; sentAt: string; name: string; email: string; phone: string; message: string };
};

export function catalogServerTexts(resolved: ResolvedLocaleStrings): CatalogServerTexts {
    const s = resolved.strings.catalog;
    const d = resolved.defaults.catalog;
    const nonBlank = (own: string, languageDefault: string) => own.trim() || languageDefault;
    return {
        siteLabels: {
            collection: nonBlank(s.importCollectionAttribute, d.importCollectionAttribute),
            unit: nonBlank(s.importUnitAttribute, d.importUnitAttribute),
            packaging: nonBlank(s.importPackagingAttribute, d.importPackagingAttribute),
            minimumOrder: nonBlank(s.importMinimumOrderAttribute, d.importMinimumOrderAttribute),
        },
        variantName: nonBlank(s.importVariantName, d.importVariantName),
        interestMail: {
            subject: nonBlank(s.interestMailSubject, d.interestMailSubject),
            intro: nonBlank(s.interestMailIntro, d.interestMailIntro),
            products: nonBlank(s.interestMailProducts, d.interestMailProducts),
            sentAt: nonBlank(s.interestMailSentAt, d.interestMailSentAt),
            name: nonBlank(s.interestName, d.interestName),
            email: nonBlank(s.interestEmail, d.interestEmail),
            phone: nonBlank(s.interestPhone, d.interestPhone),
            message: nonBlank(s.interestMessage, d.interestMessage),
        },
    };
}

/** The `{name}` placeholder form that `fillTemplate` fills. One definition, so a check of placeholders and the filling
 *  can never disagree about what a placeholder is. */
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/**
 * Replaces each `{name}` of `template` with `String(values[name])` (§ 5.1). A placeholder without a value stays as
 * written, so a missing value is visible instead of silently empty.
 */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
    return template.replace(PLACEHOLDER, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole);
}

/**
 * SCHED-LABELS-1 — the names of the `{placeholders}` of `text` that `fillTemplate` would fill, each once, in order of
 * first appearance (`"{ref} at {time}, {ref}"` → `["ref", "time"]`). Users: the `bookingStrings` check of PUT /settings
 * (a site text must keep exactly the placeholders of the standard text) and the admin Labels page (it lists the
 * placeholders each booking text must keep).
 */
export function templatePlaceholders(text: string): string[] {
    return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/**
 * SCHED-LABELS-1 — the 98 text keys of the hosted booking pages, derived from the English pack (complete by type), so
 * the list is never written twice. The keys of the `bookingStrings` tenant attribute (`BookingStringsSchema`), of the
 * admin "Booking" Labels section and of the renderer's booking texts.
 */
export const BOOKING_TEXT_KEYS = Object.keys(EN_LANGUAGE_PACK.booking) as (keyof BookingStrings)[];

/**
 * SCHED-LABELS-1 — the STANDARD booking texts of `language` (layers 1 + 2): the English text of every key, replaced by
 * the text of the `language` pack where that pack has a non-empty one; English for a language without a pack. No
 * tenant layer: the renderer adds the tenant's `bookingStrings` (`renderer/src/lib/booking-text.ts`, which owns the
 * rule of WHEN they apply); the admin Labels page shows these texts as the placeholders of its Booking inputs.
 */
export function bookingStandardTexts(language: string): CompletePart<BookingStrings> {
    const own = Object.prototype.hasOwnProperty.call(LANGUAGE_PACKS, language) ? LANGUAGE_PACKS[language].booking ?? {} : {};
    const out = { ...EN_LANGUAGE_PACK.booking };
    for (const key of BOOKING_TEXT_KEYS) {
        const value = own[key];
        if (typeof value === "string" && value !== "") out[key] = value;
    }
    return out;
}
