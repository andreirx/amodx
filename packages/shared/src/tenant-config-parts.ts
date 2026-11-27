// The parts of TenantConfigSchema that have no file of their own: nav links, contact, bars, reCAPTCHA, order e-mail templates, company and legal, integrations, header, footer, GDPR.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";
import { CssColorSchema } from "./theme.js";

// Helper for Navigation
export const LinkSchema = z.object({
    label: z.string(),
    href: z.string(),
    children: z.array(z.object({
        label: z.string(),
        href: z.string(),
    })).optional(), // dropdown sub-items
});

// Quick Contact widget config
export const QuickContactSchema = z.object({
    type: z.enum(["phone", "whatsapp", "email"]).default("phone"),
    value: z.string(),        // phone number, whatsapp number, or email
    label: z.string().optional(),
});

// CAT-QUOTE-1 (docs/slices/cat-quote-1.md § 3 item 1, CQ-D1 = A): the tenant's contact channels for visitors, one
// place for every site kind. Read by the catalog product page's "Request a quote" dialog; the Top Bar, the Commerce Bar
// and the Quick contact fall back to it only when their own field is empty. A number: trimmed, non-empty, only digits,
// "+", spaces and dashes, at least one digit. Unknown keys are refused (a new attribute: no stored data predates it).
const CONTACT_NUMBER_FORM = /^[0-9+ -]+$/;
export const ContactNumberSchema = z.string()
    .refine((v) => v.length > 0 && v.trim() === v, { message: "must be a non-empty text without leading or trailing spaces" })
    .refine((v) => CONTACT_NUMBER_FORM.test(v) && /[0-9]/.test(v), { message: "may hold only digits, \"+\", spaces and dashes, and at least one digit" });
export const ContactChannelsSchema = z.object({
    phone: ContactNumberSchema.optional(),
    whatsapp: ContactNumberSchema.optional(),
    email: z.string().email().optional(),
}).strict();
export type ContactChannels = z.infer<typeof ContactChannelsSchema>;

// Top Bar config
export const TopBarSchema = z.object({
    show: z.boolean().default(false),
    content: z.string().optional(),  // HTML or text for announcement
    quickContactPhone: z.string().optional(),
    quickContactEmail: z.string().optional(),
});

// Commerce Bar config (utility bar above navbar)
export const SocialLinkSchema = z.object({
    platform: z.enum(["facebook", "instagram", "tiktok", "youtube", "twitter", "linkedin", "pinterest"]),
    url: z.string(),
});

export const CommerceBarSchema = z.object({
    enabled: z.boolean().default(false),
    phone: z.string().optional(),
    whatsappNumber: z.string().optional(),
    socialLinks: z.array(SocialLinkSchema).default([]),
    ctaButton: z.object({
        text: z.string(),
        url: z.string(),
    }).optional(),
    // Formatting
    height: z.string().default("h-10"),
    fontSize: z.string().default("text-sm"),
    iconSize: z.string().default("h-5 w-5"),
});

// Search Bar config (dedicated search bar below navbar)
export const SearchBarSchema = z.object({
    enabled: z.boolean().default(false),
    placeholder: z.string().default("Search products..."),
});

// reCAPTCHA v3 configuration (bot protection for public forms)
// Deployment-level keys provide mandatory protection for all tenants.
// Tenant can override with own keys (siteKey + secretKey), but cannot disable.
// The `enabled` field is retained for backward compat but no longer controls activation.
// Resolution: tenant keys > deployment env vars > null (local dev only).
export const RecaptchaConfigSchema = z.object({
    enabled: z.boolean().default(false), // DEPRECATED — kept for backward compat, ignored by resolver
    siteKey: z.string().optional(),      // Public - used in frontend (overrides deployment key if set)
    secretKey: z.string().optional(),     // Private - used in backend verification (overrides deployment key if set)
    threshold: z.number().min(0).max(1).default(0.5), // Score threshold (0.0 = bot, 1.0 = human) — always per-tenant
});
export type RecaptchaConfig = z.infer<typeof RecaptchaConfigSchema>;

// --- ORDER EMAIL TEMPLATES ---

export const OrderEmailTemplateSchema = z.object({
    subject: z.string(),                        // "Order {{orderNumber}} — {{statusLabel}}"
    body: z.string(),                           // plain text with {{variables}}
    sendToCustomer: z.boolean().default(true),
    sendToAdmin: z.boolean().default(false),
    sendToProcessing: z.boolean().default(false),
});
export type OrderEmailTemplate = z.infer<typeof OrderEmailTemplateSchema>;

export const OrderEmailConfigSchema = z.object({
    templates: z.record(z.string(), OrderEmailTemplateSchema).default({}),
    // key = status name (e.g. "placed", "confirmed", "shipped")
});
export type OrderEmailConfig = z.infer<typeof OrderEmailConfigSchema>;

// --- COMPANY & LEGAL ---

export const CompanyDetailsSchema = z.object({
    legalName: z.string().optional(),        // "SC Povesti pe Biscuite SRL"
    cui: z.string().optional(),              // CUI/CIF tax ID
    tradeRegister: z.string().optional(),    // "J40/1234/2020"
    address: z.string().optional(),          // Full address
    phone: z.string().optional(),
    email: z.string().optional(),
});
export type CompanyDetails = z.infer<typeof CompanyDetailsSchema>;

export const LegalLinksSchema = z.object({
    termsUrl: z.string().optional(),         // Terms & Conditions page URL
    privacyUrl: z.string().optional(),       // Privacy Policy page URL
    anpcUrl: z.string().optional(),          // ANPC complaints link
    anpcSalUrl: z.string().optional(),       // ANPC SAL (online dispute) link
    termsLabel: z.string().optional(),
    privacyLabel: z.string().optional(),
    anpcLabel: z.string().optional(),
    anpcSalLabel: z.string().optional(),
});
export type LegalLinks = z.infer<typeof LegalLinksSchema>;

// ==========================================
// 7. INFRASTRUCTURE & SETTINGS
// ==========================================

/**
 * NEWSLETTER-1 — the site's MailerLite connection (docs/slices/newsletter-1.md, ruling 8). Both fields are required and
 * non-blank: a stored object therefore always holds a token, so an admin answer that shows `groupId` (the token removed)
 * tells the owner a token is stored. `groupId` is a string: MailerLite's documentation shows group ids as strings.
 */
export const MailerLiteSettingsSchema = z.object({
    apiToken: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
});
export type MailerLiteSettings = z.infer<typeof MailerLiteSettingsSchema>;

// Expanded Integrations
export const IntegrationsSchema = z.object({
    contactEmail: z.string().email().optional(),
    orderProcessingEmail: z.string().email().optional(), // receives order notifications (fulfillment team)

    googleAnalyticsId: z.string().optional(), // G-XXXXXXXX
    googleSearchConsoleId: z.string().optional(), // Verification Code

    // PADDLE INTEGRATION
    paddle: z.object({
        environment: z.enum(["sandbox", "production"]).default("sandbox"),
        clientToken: z.string().optional(), // Public Key for Frontend
        vendorId: z.string().optional(), // For classic or tracking
    }).default({ environment: "sandbox" }),

    // GOOGLE OAUTH (Comments/Identity)
    // We store these here so the Renderer can load them dynamically per tenant.
    google: z.object({
        clientId: z.string().optional(),
        clientSecret: z.string().optional(), // Stored in DB for V1.
    }).optional(),


    // Privacy Friendly (Umami/Plausible)
    // We store the script URL and the Website ID
    analytics: z.object({
        provider: z.enum(["none", "umami", "plausible", "custom"]).default("none"),
        url: z.string().optional(), // e.g. "https://analytics.myagency.com/script.js"
        websiteId: z.string().optional(), // UUID for Umami
    }).default({ provider: "none" }),

    // NEWSLETTER-1 (docs/slices/newsletter-1.md, ruling 8): the MailerLite connection of the site. Absent = off: a signup
    // is stored and nothing is sent. It replaces an unused boolean of the same name; a stored `true` or `false` parses
    // as absent (no backfill). `apiToken` is a secret: GET /settings and GET /settings/secrets never return it, the
    // renderer's `mapTenant` never maps this object (backend/src/tenant/settings.ts `redactSecrets`).
    mailerlite: z.preprocess((stored) => (typeof stored === "boolean" ? undefined : stored), MailerLiteSettingsSchema.optional()),
    perplexity: z.boolean().default(false),

    // BRAVE SEARCH (Local Research Stack)
    braveApiKey: z.string().optional(),

    // FACEBOOK PIXEL
    fbPixelId: z.string().optional(),

    // GOOGLE MY BUSINESS (Reviews)
    googlePlaceId: z.string().optional(),

    // BANK TRANSFER DETAILS (for checkout)
    bankTransfer: z.object({
        bankName: z.string().optional(),
        accountHolder: z.string().optional(),
        iban: z.string().optional(),
        swift: z.string().optional(),
        referencePrefix: z.string().optional(), // e.g. "PPB"
    }).optional(),
});

// New Header Config
export const HeaderConfigSchema = z.object({
    showLogo: z.boolean().default(true),
    showTitle: z.boolean().default(true),
    // Navbar height (Tailwind class, e.g. "h-16", "h-20", "h-28")
    navHeight: z.string().default("h-16"),
    navHeightScrolled: z.string().default("h-12"),
    // Logo height (Tailwind class, e.g. "h-12", "h-20", "h-28")
    logoHeight: z.string().default("h-12"),
    logoHeightScrolled: z.string().default("h-8"),
    // Title font size (Tailwind class)
    titleSize: z.string().default("text-xl"),
    titleSizeScrolled: z.string().default("text-lg"),
    // Content max width (Tailwind class: "max-w-7xl", "max-w-screen-2xl", "max-w-full")
    contentMaxWidth: z.string().default("max-w-7xl"),
    // Content page max width — constrains prose blocks, titles, comments (not full-bleed blocks)
    contentPageMaxWidth: z.string().default("max-w-4xl"),
    // HEADER-COLOURS-1: the navbar's own background and text colour, one value for the light and the dark theme; absent →
    // the theme's colours (the navbar before this slice, byte for byte). Same type and rule as the footer's colours. Read
    // by the renderer's `app/[siteId]/layout.tsx#headerColorStyle`; the Top Bar, Commerce Bar and Search Bar ignore them.
    backgroundColor: CssColorSchema.optional(),
    textColor: CssColorSchema.optional(),
    // SHOP-LOOK-1A (docs/slices/shop-look-1.md § 4.1): a short text beside the logo or title, inside the logo link; absent
    // or whitespace only → no element (the navbar before this slice, byte for byte).
    tagline: z.string().max(60).optional(),
    // SHOP-LOOK-1A (ruling SHOPLOOK-CATBAR = C): the categories of the header's second row, by id, in bar order. The
    // renderer reads each category's name and slug at render time and skips a hidden or missing one; absent, empty or no
    // id that resolves → no second row.
    categoryBarIds: z.array(z.string().min(1)).max(12).optional(),
});

// CAT-THEME-1 (§ 3 item 3): the footer's own width, a Tailwind class like `header.contentMaxWidth`; absent → the
// header's width (the footer used the header's width before this slice). The renderer compiles only the classes its
// sources name literally (Tailwind 4); the three new widths are in `renderer/src/lib/widths.ts`.
// BULK-PURGE-FOOTER-1 (Part B): the footer's own background and text colour, one value for the light and the dark
// theme; absent → the theme's colours (the footer before this slice, byte for byte). Read by the renderer's
// `app/[siteId]/layout.tsx` footer.
// SHOP-LOOK-1A (docs/slices/shop-look-1.md § 4.1): `brandText` (a text in its own first column) and `columns` (named link
// columns, each a heading and its links). Absent, blank or an empty list → today's footer, byte for byte. Links are raw
// `href`s, as `footerLinks`.
export const FooterConfigSchema = z.object({
    contentMaxWidth: z.string().optional(),
    backgroundColor: CssColorSchema.optional(),
    textColor: CssColorSchema.optional(),
    brandText: z.string().max(400).optional(),
    columns: z.array(z.strictObject({
        heading: z.string().min(1).max(40),
        links: z.array(z.strictObject({ label: z.string().min(1).max(60), href: z.string().min(1) })).max(12),
    })).max(4).optional(),
}).strict();

// GDPR Cookie Consent Configuration
export const GDPRConfigSchema = z.object({
    headline: z.string().optional(),
    description: z.string().optional(),
    denyAll: z.string().optional(),
    necessaryOnly: z.string().optional(),
    acceptAll: z.string().optional(),
    position: z.enum(["bottom", "top"]).default("bottom"),
    enabled: z.boolean().default(true),
});

export type GDPRConfig = z.infer<typeof GDPRConfigSchema>;
