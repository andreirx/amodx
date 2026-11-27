// TenantConfigSchema, the tenant status, the write rule of the language settings and isCatalogMode.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";
import { normalizeLocale, localeLanguageSubtag } from "./locale-strings.js";
import { pageLanguageOf, type PageLanguage } from "./languages.js";
import { SchedulingSettingsSchema, SchedulingEmailConfigSchema } from "./scheduling.js";
import { SchemaType } from "./content.js";
import { ThemeSchema } from "./theme.js";
import { PageEffectConfigSchema } from "./effects.js";
import { URL_PREFIX_DEFAULTS, UrlPrefixesSchema, urlPrefixesOf } from "./url-prefixes.js";
import { CommerceStringsSchema, CatalogStringsSchema, SiteStringsSchema, BookingStringsSchema } from "./locale-table.js";
import {
    LinkSchema, QuickContactSchema, ContactChannelsSchema, TopBarSchema, CommerceBarSchema, SearchBarSchema,
    RecaptchaConfigSchema, OrderEmailConfigSchema, CompanyDetailsSchema, LegalLinksSchema, IntegrationsSchema,
    HeaderConfigSchema, FooterConfigSchema, GDPRConfigSchema,
} from "./tenant-config-parts.js";

export const TenantStatus = z.enum(["LIVE", "SUSPENDED", "OFF"]);

export const TenantConfigSchema = z.object({
    id: z.string(), // e.g., "client-bob"
    domain: z.string(), // e.g., "dental-pros.com"
    name: z.string(),

    // NEW FIELDS
    description: z.string().optional(), // SEO Meta + llms.txt intro
    header: HeaderConfigSchema.default({
        showLogo: true, showTitle: true,
        navHeight: "h-16", navHeightScrolled: "h-12",
        logoHeight: "h-12", logoHeightScrolled: "h-8",
        titleSize: "text-xl", titleSizeScrolled: "text-lg",
        contentMaxWidth: "max-w-7xl",
        contentPageMaxWidth: "max-w-4xl",
    }),
    // CAT-THEME-1: the footer's width; absent on every existing tenant (→ the header's width).
    footer: FooterConfigSchema.optional(),

    // GDPR Cookie Consent
    gdpr: GDPRConfigSchema.default({
        position: "bottom",
        enabled: true
    }),

    // Hide social sharing buttons globally (can still be overridden per-page)
    hideSocialSharing: z.boolean().default(false),

    // Home page slug mapping (e.g., "/home" makes / show the /home page content)
    homePageSlug: z.string().optional(),

    // Global Schema Settings
    schemaType: SchemaType.default("Organization"),

    // Assets & Nav
    logo: z.string().optional(),
    icon: z.string().optional(), // Favicon
    navLinks: z.array(LinkSchema).default([]),
    footerLinks: z.array(LinkSchema).default([]),
    // LANG-1 (docs/slices/lang-1.md § 5): the menu and footer list of each EXTRA language; a language without a key
    // uses `navLinks` / `footerLinks`. Optional, no default: a tenant without them parses as before. Checked on save by
    // `languageSettingsProblem` (V5); read by `readLanguageSettings` (never through this schema).
    navLinksByLang: z.record(z.string(), z.array(LinkSchema)).optional(),
    footerLinksByLang: z.record(z.string(), z.array(LinkSchema)).optional(),

    // Commerce toggle — enables cart, checkout, orders flow. Products/categories/Paddle still work without it.
    commerceEnabled: z.boolean().default(false),

    // SCHED-1A (docs/slices/sched-1.md § 4.1): scheduling settings. OPTIONAL with no default here, so a tenant saved
    // before the slice parses exactly as before. Absent `schedulingEnabled` = off; inside `scheduling` the schema
    // fills its own defaults (holdMinutes 30, changeCutoffHours 24, reminderHours 24, bookingHorizonWeeks 8).
    schedulingEnabled: z.boolean().optional(),
    scheduling: SchedulingSettingsSchema.optional(),
    schedulingEmailConfig: SchedulingEmailConfigSchema.optional(),

    // CATALOG-MODE-1 (CM-D11): a catalog site shows products without any price, availability or ordering
    // control. Chosen ONLY at POST /tenants and never changed online (PUT /settings refuses a change);
    // mutually exclusive with commerceEnabled. Read it through isCatalogMode(), never directly.
    catalogMode: z.boolean().default(false),

    // Customer profile settings
    askBirthdayOnAccount: z.boolean().default(true),  // Show birthday field on account page
    askBirthdayOnCheckout: z.boolean().default(true), // Show birthday field on checkout

    // Commerce URL Prefixes (configurable per tenant for i18n)
    urlPrefixes: UrlPrefixesSchema.default(URL_PREFIX_DEFAULTS),

    // Quick Contact Widget
    quickContact: QuickContactSchema.optional(),

    // CAT-QUOTE-1: the visitor contact channels (Settings → Contact channels); absent = none set.
    contactChannels: ContactChannelsSchema.optional(),
    // CAT-QUOTE-1 § 3 item 4: where interest lists are e-mailed; absent = `integrations.contactEmail` (no platform fallback).
    interestListEmail: z.string().email().optional(),

    // Top Bar (announcement bar above header)
    topBar: TopBarSchema.default({ show: false }),

    // Commerce Bar (utility bar above navbar: phone, social, cart, CTA)
    commerceBar: CommerceBarSchema.default({ enabled: false, socialLinks: [], height: "h-10", fontSize: "text-sm", iconSize: "h-5 w-5" }),

    // Search Bar (dedicated product search bar below navbar)
    searchBar: SearchBarSchema.default({ enabled: false, placeholder: "Search products..." }),

    // GPU Effects — page-level ambient background (aurora, particles, etc.)
    // Defaults to type "none" — zero impact on existing sites.
    pageEffect: PageEffectConfigSchema.default({ type: "none", colors: [], speed: 0.5, timeOffset: 0, intensity: 0.1, invertY: false, overlayOpacity: 0.85 }),

    // Order confirmation celebration confetti — opt-in, default off
    celebrationEnabled: z.boolean().default(false),

    // reCAPTCHA v3 bot protection for public forms
    recaptcha: RecaptchaConfigSchema.default({ enabled: false, threshold: 0.5 }),

    // Order email templates (configurable per status)
    orderEmailConfig: OrderEmailConfigSchema.default({ templates: {} }),

    // Enabled payment methods for commerce checkout
    enabledPaymentMethods: z.array(z.enum(["cash_on_delivery", "bank_transfer"])).default(["cash_on_delivery"]),

    // Default currency for commerce (products inherit this)
    currency: z.string().default("USD"),

    // Country pack & locale
    countryCode: z.string().default("EN"),
    locale: z.string().default("en-US"),
    // LANG-1 (docs/slices/lang-1.md § 4, § 5): the EXTRA languages (bare subtags, e.g. ["ro"]); the default language is
    // the subtag of `locale`. Pages under `/<l>/` are in language `<l>`. Optional, no default: absent = one language.
    languages: z.array(z.string()).optional(),

    // Commerce UI strings (i18n) — the commerce part of the locale table (LOCALE-1 § 4.1)
    commerceStrings: CommerceStringsSchema.default({}),
    // LOCALE-1: the catalog and site parts of the locale table; absent = no override (§ 4.1)
    catalogStrings: CatalogStringsSchema.optional(),
    siteStrings: SiteStringsSchema.optional(),
    // SCHED-LABELS-1: the booking-page texts of the site; absent = no override (BookingStringsSchema)
    bookingStrings: BookingStringsSchema.optional(),

    // Company details (footer, invoices)
    companyDetails: CompanyDetailsSchema.default({}),

    // Legal links (ANPC, T&C, Privacy)
    legalLinks: LegalLinksSchema.default({}),

    // DRAFT-LIVE STATE MACHINE
    status: TenantStatus.default("LIVE"),

    plan: z.enum(["Free", "Pro", "Agency"]),

    // Infrastructure tracking (as discussed before)
    resources: z.object({
        distributionId: z.string().optional(),
        certificateArn: z.string().optional(),
        bucketFolder: z.string().optional(),
    }).optional(),

    theme: ThemeSchema.default({
        mode: "light",
        primaryColor: "#000000",
        primaryForeground: "#ffffff",
        secondaryColor: "#ffffff",
        secondaryForeground: "#000000",
        backgroundColor: "#ffffff",
        surfaceColor: "#f4f4f5",
        textColor: "#020817",
        fontHeading: "Prata",
        fontBody: "Lato",
        radius: "0.5rem"
    }),
    darkTheme: ThemeSchema.optional(),

    integrations: IntegrationsSchema.default({
        googleAnalyticsId: "",
        googleSearchConsoleId: "",
        paddle: { environment: "sandbox", clientToken: "", vendorId: "" },
        google: { clientId: "", clientSecret: "" },
        analytics: { provider: "none" },
        perplexity: false,
        contactEmail: ""
    }),

    createdAt: z.string(),
});

export type TenantConfig = z.infer<typeof TenantConfigSchema>;

const LANGUAGE_SUBTAG_FORM = /^[a-z]{2,3}$/;
const LinkListSchema = z.array(LinkSchema);

/** The first path segment of a URL prefix (`"/produs"` → `"produs"`, `"/ro/shop"` → `"ro"`; leading slashes ignored). */
function firstSegmentOf(prefix: string): string {
    return prefix.replace(/^\/+/, "").split("/")[0];
}

/**
 * LANG-1 (docs/slices/lang-1.md § 5.2) — the WRITE rule of the language settings, V1-V6. Called with the MERGED settings
 * (the stored item with the request body over it), so it also refuses a change of `locale`, `urlPrefixes` or
 * `homePageSlug` that breaks the stored list. Returns a message that names the field, or null when valid. A record
 * without `languages`, `navLinksByLang` and `footerLinksByLang` is always valid (nothing is checked; V6 needs languages).
 *  V1 `languages` is an array of bare language subtags: 2-3 lowercase letters that `normalizeLocale` keeps unchanged.
 *  V2 no entry twice.  V3 no entry equals the default subtag (`localeLanguageSubtag(locale)`).
 *  V4 no entry equals the first segment of a URL prefix (`urlPrefixesOf`), nor `api`.
 *  V5 every key of `navLinksByLang` / `footerLinksByLang` is a listed language; each value is a `LinkSchema` list.
 *  V6 with a non-empty list, a non-empty `homePageSlug` is a default-language address (it is served at `/`).
 */
export function languageSettingsProblem(input: {
    languages?: unknown; locale?: unknown; urlPrefixes?: unknown;
    navLinksByLang?: unknown; footerLinksByLang?: unknown; homePageSlug?: unknown;
}): string | null {
    const languages: string[] = [];
    if (input.languages !== undefined) {
        if (!Array.isArray(input.languages)) return "languages: must be a list of language codes, for example [\"ro\"].";
        for (const entry of input.languages) {
            const shown = JSON.stringify(entry)?.slice(0, 40) ?? String(entry);
            if (typeof entry !== "string" || !LANGUAGE_SUBTAG_FORM.test(entry) || normalizeLocale(entry) !== entry) {
                return `languages: ${shown} is not a language code (two or three lowercase letters of a known language, for example "ro").`;
            }
            if (languages.includes(entry)) return `languages: "${entry}" is listed twice.`;
            languages.push(entry);
        }
        const defaultSubtag = localeLanguageSubtag(input.locale);
        if (languages.includes(defaultSubtag)) {
            return `languages: "${defaultSubtag}" is the default language of the site (from the locale); list only the other languages.`;
        }
        const prefixes = urlPrefixesOf(input.urlPrefixes);
        for (const language of languages) {
            if (language === "api") return `languages: "api" is a reserved address and cannot be a language.`;
            const key = (Object.keys(prefixes) as (keyof typeof prefixes)[]).find((k) => firstSegmentOf(prefixes[k]) === language);
            if (key !== undefined) {
                return `languages: "${language}" is the start of the URL prefix ${key} ("${prefixes[key]}"); change the prefix or choose another language.`;
            }
        }
    }
    for (const field of ["navLinksByLang", "footerLinksByLang"] as const) {
        const map = input[field];
        if (map === undefined) continue;
        if (map === null || typeof map !== "object" || Array.isArray(map)) return `${field}: must be an object of link lists per language.`;
        for (const [key, value] of Object.entries(map)) {
            if (!languages.includes(key)) return `${field}: "${key.slice(0, 40)}" is not in the site's languages.`;
            const parsed = LinkListSchema.safeParse(value);
            if (!parsed.success) {
                const issue = parsed.error.issues[0];
                return `${[field, key, ...issue.path.map(String)].join(".")}: ${issue.message}`;
            }
        }
    }
    if (languages.length > 0 && typeof input.homePageSlug === "string" && input.homePageSlug !== "") {
        return homePageProblem(input.homePageSlug, pageLanguageOf(input.homePageSlug, languages));
    }
    return null;
}

/** V6: the home page is served at `/`, a default-language address. Every arm returns (a new variant does not compile). */
function homePageProblem(homePageSlug: string, language: PageLanguage): string | null {
    switch (language.kind) {
        case "default": return null;
        case "extra": return `homePageSlug: "${homePageSlug}" is a page in "${language.subtag}"; the home page (/) must be a page in the default language.`;
    }
}

/**
 * CATALOG-MODE-1 — the ONE predicate for "this tenant is a catalog site" (no price, no availability, no
 * ordering). Every surface that behaves differently for a catalog tenant asks this; none re-derives it.
 * An absent flag (every tenant created before the flag existed) is not catalog.
 */
export function isCatalogMode(config: { catalogMode?: unknown } | null | undefined): boolean {
    return config?.catalogMode === true;
}
