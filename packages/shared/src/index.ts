import { z } from "zod";

// Re-export the canonical email normalizer (PD-001 identity primitive, slice `fnd-1`).
// Every consumer that builds an email-keyed identity MUST derive it through this.
export { normalizeEmail } from "./normalizeEmail.js";

// Re-export media classification module
export {
    ALLOWED_IMAGE_MIMES, ALLOWED_VIDEO_MIMES, ALLOWED_UPLOAD_MIMES,
    MAX_UPLOAD_BYTES,
    classifyMedia, getAssetMime, matchesMediaFilter, validateUpload,
    type MediaKind, type UploadValidationResult,
} from "./media.js";

// ==========================================
// 1. GLOBAL ENUMS & CONSTANTS
// ==========================================

export const ContentStatus = z.enum(["Draft", "Published", "Archived"]);
export const AccessType = z.enum(["Public", "LoginRequired", "Group", "Purchase", "EmailGate"]);
export const WorkItemStatus = z.enum(["Draft", "PendingApproval", "Scheduled", "Completed", "Failed"]);
export const SignalStatus = z.enum(["New", "Drafted", "Replied", "Dismissed"]);
export const SignalSource = z.enum(["Reddit", "Twitter", "LinkedIn", "Web"]);

// Helper for Navigation
export const LinkSchema = z.object({
    label: z.string(),
    href: z.string(),
    children: z.array(z.object({
        label: z.string(),
        href: z.string(),
    })).optional(), // dropdown sub-items
});

// ==========================================
// 1b. INLINE RICH TEXT (Shape B)
// ==========================================
// Constrained inline content for plugin attributes that need bold/italic
// but not full block-level editing. Stored as an array of text segments.
// Deliberately framework-agnostic — no Tiptap vocabulary in storage.

export const InlineTextSegmentSchema = z.object({
    text: z.string().optional().default(""),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    br: z.boolean().optional(),   // line break — segment is { br: true }, text is ignored
});

export const InlineRichTextSchema = z.array(InlineTextSegmentSchema);

export type InlineTextSegment = z.infer<typeof InlineTextSegmentSchema>;

// Plugin block types that default to full-bleed (no wrapper) when blockWidth attr is absent.
// All other plugins default to "content" width (wrapped in contentPageMaxWidth).
export const FULL_BLEED_DEFAULTS = new Set(["cta", "testimonials", "carousel", "videoHero"]);

// SINGLE SOURCE OF TRUTH for URL prefix defaults — do NOT duplicate these elsewhere
export const URL_PREFIX_DEFAULTS = {
    product: "/product",
    category: "/category",
    cart: "/cart",
    checkout: "/checkout",
    shop: "/shop",
    account: "/account",
    search: "/search",
} as const;

// Configurable URL prefixes per tenant (for i18n-friendly URLs)
export const UrlPrefixesSchema = z.object({
    product: z.string().default(URL_PREFIX_DEFAULTS.product),
    category: z.string().default(URL_PREFIX_DEFAULTS.category),
    cart: z.string().default(URL_PREFIX_DEFAULTS.cart),
    checkout: z.string().default(URL_PREFIX_DEFAULTS.checkout),
    shop: z.string().default(URL_PREFIX_DEFAULTS.shop),
    account: z.string().default(URL_PREFIX_DEFAULTS.account),
    search: z.string().default(URL_PREFIX_DEFAULTS.search),
});

// Quick Contact widget config
export const QuickContactSchema = z.object({
    type: z.enum(["phone", "whatsapp", "email"]).default("phone"),
    value: z.string(),        // phone number, whatsapp number, or email
    label: z.string().optional(),
});

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

// ==========================================
// 2. ACCESS CONTROL (The Gatekeeper)
// ==========================================

export const AccessPolicySchema = z.object({
    type: AccessType.default("Public"),
    // If type == Group
    requiredGroups: z.array(z.string()).optional(),
    // If type == Purchase
    requiredProductId: z.string().optional(),
    price: z.number().optional(),
    currency: z.string().default("USD"),
});

export type AccessPolicy = z.infer<typeof AccessPolicySchema>;

// ==========================================
// 3. SITE STRUCTURE
// ==========================================

export const RouteSchema = z.object({
    slug: z.string(),
    tenantId: z.string(),
    targetNodeId: z.string(),
    isRedirect: z.boolean().default(false),
    redirectTo: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
});

export type Route = z.infer<typeof RouteSchema>;

// Expanded Theme Config
export const ThemeSchema = z.object({
    mode: z.enum(["light", "dark"]).default("light"),

    // Colors
    primaryColor: z.string().default("#000000"),
    primaryForeground: z.string().default("#ffffff"),

    secondaryColor: z.string().default("#ffffff"),
    secondaryForeground: z.string().default("#000000"),

    // backgrounds
    backgroundColor: z.string().default("#ffffff"),
    surfaceColor: z.string().default("#f4f4f5"), // Cards/Sidebars

    // Global Text
    textColor: z.string().default("#020817"),

    // Typography (We will load these from Google Fonts in the Renderer)
    fontHeading: z.string().default("Prata"),
    fontBody: z.string().default("Lato"),

    // UI Roundness
    radius: z.string().default("0.5rem"),
});

// Saved Theme Entity (Agency-wide assets)
export const SavedThemeSchema = z.object({
    id: z.string(),
    name: z.string(),
    theme: ThemeSchema, // The actual style values
    createdBy: z.string(),
    createdAt: z.string()
});

export type SavedTheme = z.infer<typeof SavedThemeSchema>;


// ==========================================
// 4. CONTENT DATA (The Payload)
// ==========================================

export const CommentsMode = z.enum(["Enabled", "Locked", "Hidden"]); // Locked = Read Only

// New Enum for Schema Types
export const SchemaType = z.enum([
    "Organization",
    "Corporation",
    "LocalBusiness",
    "SoftwareApplication",
    "Person",
    "Article",
    "WebPage"
]);

export const ContentItemSchema = z.object({
    id: z.string(),
    nodeId: z.string(),
    version: z.number(),
    status: ContentStatus.default("Draft"),

    title: z.string(),
    slug: z.string().optional(),

    // SEO
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    seoKeywords: z.string().optional(),
    featuredImage: z.string().optional(),

    // CATEGORIZATION
    tags: z.array(z.string()).default([]),

    // comments default off
    commentsMode: CommentsMode.default("Hidden"),

    // Page-level Override
    schemaType: SchemaType.optional(), // e.g., Homepage might be SoftwareApplication, Blog might be Article

    // PAGE OVERRIDES
    themeOverride: ThemeSchema.partial().optional(), // Allow partial overrides
    darkThemeOverride: ThemeSchema.partial().optional(),
    hideNav: z.boolean().default(false),
    hideFooter: z.boolean().default(false),
    hideSharing: z.boolean().default(false),

    // THE MEAT
    blocks: z.array(z.any()).default([]),

    // THE GATE
    accessPolicy: AccessPolicySchema.default({ type: "Public", currency: "USD" }),

    author: z.string(),
    authorEmail: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
    updatedBy: z.string().optional(),
});

export type ContentItem = z.infer<typeof ContentItemSchema>;

// NEW: The Comment Data Model

export const CommentSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    pageId: z.string(), // Links to ContentItem.id

    authorId: z.string().optional(),
    authorName: z.string(),
    authorEmail: z.string().email(), // Private (backend only)
    authorImage: z.string().optional(), // From Google

    content: z.string().min(1).max(2000),
    status: z.enum(["Approved", "Pending", "Spam"]).default("Approved"), // Auto-approve for now

    createdAt: z.string(),
});

export type Comment = z.infer<typeof CommentSchema>;

// ==========================================
// 5. THE BRAIN (Strategy & Context)
// ==========================================

// REFACTORED: No more strict "Strategy/Persona" types.
// Just structured documents with tags.
export const ContextItemSchema = z.object({
    id: z.string(),
    tenantId: z.string(),

    title: z.string(),
    blocks: z.array(z.any()).default([]), // Now uses Block Editor!

    tags: z.array(z.string()).default([]), // e.g. ["Persona", "Q1-2025"]

    embeddingId: z.string().optional(),
    createdBy: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
});

export type ContextItem = z.infer<typeof ContextItemSchema>;


// ==========================================
// 6. THE ENGINE (Work Items / Agents)
// ==========================================

export const WorkItemSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    type: z.enum(["SocialPost", "EmailBlast", "ResearchJob", "SiteAudit"]),
    status: WorkItemStatus,

    // What triggered this? (e.g., "Strategy Q1")
    contextRefs: z.array(z.string()).optional(),

    // The Input (e.g., "Research plumbing trends")
    inputPrompt: z.string().optional(),

    // The Draft (e.g., "Here are 5 tweets...")
    payload: z.any(),

    // The Result (e.g., "Posted to Twitter, ID: 12345")
    outputResult: z.any().optional(),

    createdAt: z.string(),
    scheduledFor: z.string().optional(), // ISO Date
});

export type WorkItem = z.infer<typeof WorkItemSchema>;

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

export const TenantStatus = z.enum(["LIVE", "SUSPENDED", "OFF"]);
export const UserRole = z.enum(["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"]);

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

    mailerlite: z.boolean().default(false),
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
});

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

// ==========================================
// GPU EFFECTS CONFIG (for @amodx/effects)
// ==========================================

// Capability tier detected at runtime by the effects package.
// 'none' means no WebGPU or prefers-reduced-motion — CSS fallback only.
export type GpuTier = 'hdr-edr' | 'hdr-srgb' | 'sdr' | 'none';

// Unified effect config — used for block backgrounds, button overlays, and page effects.
// type is z.string() not z.enum() — open for third-party effect types.
// overlayOpacity is only meaningful when applied as a button overlay (ignored for backgrounds).
export const EffectConfigSchema = z.object({
    type: z.string().default("none"),
    colors: z.array(z.string()).max(4).default([]),
    speed: z.number().min(-3).max(3).default(1),           // negative = reverse animation
    timeOffset: z.number().min(-100).max(100).default(0),  // scrub timeline; useful at speed=0 for frozen frames
    intensity: z.number().min(0).max(0.5).default(0.25),
    invertY: z.boolean().default(false),
    bgColor: z.string().optional(),   // hex color for background; undefined = shader default
    bands: z.number().min(2).max(32).optional(),  // aurora curtain count; undefined = 8
    overlayOpacity: z.number().min(0).max(1.0).default(0.85), // button base-fill opacity when effect active (0 = full effect, 1 = fully opaque)
});
export type EffectConfig = z.infer<typeof EffectConfigSchema>;

// Backward-compat aliases — existing code importing BlockEffectConfig still compiles.
// These are identical to EffectConfigSchema. Migrate consumers to EffectConfig over time.
/** @deprecated Use EffectConfigSchema */
export const BlockEffectConfigSchema = EffectConfigSchema;
/** @deprecated Use EffectConfig */
export type BlockEffectConfig = EffectConfig;

// Legacy glow config — kept for read-path backward compatibility.
// New code should use EffectConfigSchema with type: "glow".
// resolveButtonEffect() in plugin render components converts this format on read.
/** @deprecated Use EffectConfigSchema with type: "glow" */
export const GlowEffectConfigSchema = z.object({
    enabled: z.boolean().default(false),
    color: z.string().default("#6366f1"),
    intensity: z.number().min(0).max(0.5).default(0.25),
});
/** @deprecated Use EffectConfig */
export type GlowEffectConfig = z.infer<typeof GlowEffectConfigSchema>;

// Page-level ambient background effect (TenantConfig).
// Narrowed alias — same shape as EffectConfig but with hard intensity cap at 0.15.
// Full-viewport effects at higher intensity are overwhelming. The schema enforces this.
export const PageEffectConfigSchema = EffectConfigSchema.extend({
    speed: z.number().min(0.1).max(3.0).default(0.5),
    intensity: z.number().min(0).max(0.15).default(0.1),
});
export type PageEffectConfig = z.infer<typeof PageEffectConfigSchema>;

// Commerce UI Strings (i18n) - all optional, defaults applied at runtime
export const CommerceStringsSchema = z.object({
    // Product page
    description: z.string().optional(),         // "Description"
    addToCart: z.string().optional(),           // "Add to Cart"
    addedToCart: z.string().optional(),         // "Added to Cart!"
    viewCart: z.string().optional(),            // "View Cart"
    inStock: z.string().optional(),             // "In Stock"
    outOfStock: z.string().optional(),          // "Out of Stock"
    variantUnavailable: z.string().optional(),  // "Variant Unavailable"
    units: z.string().optional(),               // "units"

    // Cart page
    cart: z.string().optional(),                // "Cart"
    shoppingCart: z.string().optional(),        // "Shopping Cart"
    emptyCart: z.string().optional(),           // "Your cart is empty"
    emptyCartMessage: z.string().optional(),    // "Browse our products and add something you like."
    continueShopping: z.string().optional(),    // "Continue Shopping"
    orderSummary: z.string().optional(),        // "Order Summary"
    subtotal: z.string().optional(),            // "Subtotal"
    shipping: z.string().optional(),            // "Shipping"
    discount: z.string().optional(),            // "Discount"
    total: z.string().optional(),               // "Total"
    freeShipping: z.string().optional(),        // "Free"
    freeDeliveryFrom: z.string().optional(),    // "Free delivery from"
    addMoreForFreeDelivery: z.string().optional(), // "Add {amount} more for free delivery"
    minimumOrder: z.string().optional(),        // "Minimum order"
    proceedToCheckout: z.string().optional(),   // "Proceed to Checkout"

    // Coupon
    couponCode: z.string().optional(),          // "Coupon code"
    apply: z.string().optional(),               // "Apply"
    remove: z.string().optional(),              // "Remove"
    invalidCoupon: z.string().optional(),       // "Invalid coupon"

    // Checkout
    checkout: z.string().optional(),            // "Checkout"
    placeOrder: z.string().optional(),          // "Place Order"
    placingOrder: z.string().optional(),        // "Placing Order..."
    orderConfirmation: z.string().optional(),   // "Order Confirmation"
    contactInformation: z.string().optional(),  // "Contact Information"
    fullName: z.string().optional(),            // "Full Name"
    email: z.string().optional(),               // "Email"
    phone: z.string().optional(),               // "Phone"
    phonePlaceholder: z.string().optional(),    // "+40..."
    shippingAddress: z.string().optional(),     // "Shipping Address"
    shippingStreetAddress: z.string().optional(), // "Street Address" (under shipping section)
    streetAddress: z.string().optional(),       // "Street Address" (deprecated, use specific ones)
    billingStreetAddress: z.string().optional(), // "Street Address" (under billing section)
    city: z.string().optional(),                // "City"
    county: z.string().optional(),              // "County"
    selectCounty: z.string().optional(),        // "Select county..."
    postalCode: z.string().optional(),          // "Postal Code"
    deliveryNotes: z.string().optional(),       // "Delivery Notes"
    deliveryNotesPlaceholder: z.string().optional(), // "Apartment, floor, etc."
    paymentMethod: z.string().optional(),       // "Payment Method"
    cashOnDelivery: z.string().optional(),      // "Cash on Delivery"
    cashOnDeliveryDesc: z.string().optional(),  // "Pay when you receive your order"
    bankTransfer: z.string().optional(),        // "Bank Transfer"
    termsAgreement: z.string().optional(),      // "By placing your order, you agree to our terms and conditions."
    preferredDeliveryDate: z.string().optional(), // "Preferred Delivery Date"
    country: z.string().optional(),             // "Country"
    selectCountry: z.string().optional(),       // "Select country..."

    // Customer extras
    birthday: z.string().optional(),            // "Birthday"
    birthdayHint: z.string().optional(),        // "For a birthday surprise!"

    // Billing / Company (B2B) - generic labels, customizable per locale
    billingDetails: z.string().optional(),      // "Billing Details"
    firstName: z.string().optional(),           // "First Name"
    lastName: z.string().optional(),            // "Last Name"
    orderAsCompany: z.string().optional(),      // "Order as a company"
    companyName: z.string().optional(),         // "Company Name"
    taxId: z.string().optional(),               // "Tax ID" (CUI/CIF in Romania, EIN in US, etc.)
    taxIdPlaceholder: z.string().optional(),    // "e.g. 12345678"
    vatNumber: z.string().optional(),           // "VAT Number"
    vatNumberPlaceholder: z.string().optional(), // "e.g. RO12345678"
    registrationNumber: z.string().optional(),  // "Registration No." (Trade Register in Romania)
    registrationNumberPlaceholder: z.string().optional(), // "e.g. J40/1234/2020"
    useSameAsShipping: z.string().optional(),   // "Use same address for billing"
    billingAddress: z.string().optional(),      // "Billing Address"

    // Search
    searchButton: z.string().optional(),       // "Search"
    searchNoResults: z.string().optional(),    // "No products found"
    searchSearching: z.string().optional(),    // "Searching..."
    viewAllResults: z.string().optional(),     // "View all results"
    resultsFor: z.string().optional(),         // "Results for"
    searchProducts: z.string().optional(),     // "Search Products"

    // Account / Auth
    signIn: z.string().optional(),             // "Sign In"
    accountLabel: z.string().optional(),       // "Account"
});

export type CommerceStrings = z.infer<typeof CommerceStringsSchema>;

// Default commerce strings (English)
export const COMMERCE_STRINGS_DEFAULTS: Required<CommerceStrings> = {
    description: "Description",
    addToCart: "Add to Cart",
    addedToCart: "Added to Cart!",
    viewCart: "View Cart",
    inStock: "In Stock",
    outOfStock: "Out of Stock",
    variantUnavailable: "Variant Unavailable",
    units: "units",
    cart: "Cart",
    shoppingCart: "Shopping Cart",
    emptyCart: "Your cart is empty",
    emptyCartMessage: "Browse our products and add something you like.",
    continueShopping: "Continue Shopping",
    orderSummary: "Order Summary",
    subtotal: "Subtotal",
    shipping: "Shipping",
    discount: "Discount",
    total: "Total",
    freeShipping: "Free",
    freeDeliveryFrom: "Free delivery from",
    addMoreForFreeDelivery: "Add {amount} more for free delivery",
    minimumOrder: "Minimum order",
    proceedToCheckout: "Proceed to Checkout",
    couponCode: "Coupon code",
    apply: "Apply",
    remove: "Remove",
    invalidCoupon: "Invalid coupon",
    checkout: "Checkout",
    placeOrder: "Place Order",
    placingOrder: "Placing Order...",
    orderConfirmation: "Order Confirmation",
    contactInformation: "Contact Information",
    fullName: "Full Name",
    email: "Email",
    phone: "Phone",
    phonePlaceholder: "",
    shippingAddress: "Shipping Address",
    shippingStreetAddress: "",  // Empty = fallback to streetAddress
    streetAddress: "Street Address",
    billingStreetAddress: "",   // Empty = fallback to streetAddress
    city: "City",
    county: "County",
    selectCounty: "Select county...",
    postalCode: "Postal Code",
    deliveryNotes: "Delivery Notes",
    deliveryNotesPlaceholder: "Apartment, floor, etc.",
    paymentMethod: "Payment Method",
    cashOnDelivery: "Cash on Delivery",
    cashOnDeliveryDesc: "Pay when you receive your order",
    bankTransfer: "Bank Transfer",
    termsAgreement: "By placing your order, you agree to our terms and conditions.",
    preferredDeliveryDate: "Preferred Delivery Date",
    country: "Country",
    selectCountry: "Select country...",
    // Customer extras
    birthday: "Birthday",
    birthdayHint: "For a birthday surprise!",

    // Billing / Company (B2B) - generic defaults, customizable per locale
    billingDetails: "Billing Details",
    firstName: "First Name",
    lastName: "Last Name",
    orderAsCompany: "Order as a company",
    companyName: "Company Name",
    taxId: "Tax ID",
    taxIdPlaceholder: "",
    vatNumber: "VAT Number",
    vatNumberPlaceholder: "",
    registrationNumber: "Registration No.",
    registrationNumberPlaceholder: "",
    useSameAsShipping: "Use same address for billing",
    billingAddress: "Billing Address",

    // Search
    searchButton: "Search",
    searchNoResults: "No products found",
    searchSearching: "Searching...",
    viewAllResults: "View all results",
    resultsFor: "Results for",
    searchProducts: "Search Products",

    // Account / Auth
    signIn: "Sign In",
    accountLabel: "Account",
};

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

    // Commerce toggle — enables cart, checkout, orders flow. Products/categories/Paddle still work without it.
    commerceEnabled: z.boolean().default(false),

    // Customer profile settings
    askBirthdayOnAccount: z.boolean().default(true),  // Show birthday field on account page
    askBirthdayOnCheckout: z.boolean().default(true), // Show birthday field on checkout

    // Commerce URL Prefixes (configurable per tenant for i18n)
    urlPrefixes: UrlPrefixesSchema.default(URL_PREFIX_DEFAULTS),

    // Quick Contact Widget
    quickContact: QuickContactSchema.optional(),

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

    // Commerce UI strings (i18n)
    commerceStrings: CommerceStringsSchema.default({}),

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
        mailerlite: false,
        perplexity: false,
        contactEmail: ""
    }),

    createdAt: z.string(),
});

export type TenantConfig = z.infer<typeof TenantConfigSchema>;

// USER PROFILE SCHEMA (Stored in DynamoDB, linked to Cognito ID)
export const UserProfileSchema = z.object({
    id: z.string(), // Matches Cognito SUB
    email: z.string(),

    // Multi-tenancy linkage
    tenantId: z.string(), // "SYSTEM" for you, "client-bob" for Bob
    role: UserRole,

    firstName: z.string().optional(),
    lastName: z.string().optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// --- MEDIA ASSETS ---
// We don't just dump files in S3. We track them.
export const AssetSchema = z.object({
    id: z.string(), // UUID
    tenantId: z.string(),
    fileName: z.string(),
    fileType: z.string(), // mime type
    size: z.number(),
    s3Key: z.string(),
    publicUrl: z.string(), // The CloudFront URL
    uploadedBy: z.string(), // User ID
    createdAt: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

// --- CRM / LEADS ---
// People who gave us an email but don't have a login
export const LeadSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    email: z.string().email(),
    name: z.string().optional(),
    source: z.string().optional(), // e.g. "Footer Form", "Hero CTA"
    status: z.enum(["New", "Contacted", "Converted", "Archived"]).default("New"),
    data: z.record(z.string(), z.any()).optional(), // Custom form fields
    createdAt: z.string(),
});
export type Lead = z.infer<typeof LeadSchema>;

// --- TENANT MEMBERS (End Users) ---
// People who log in to the Client Site (not the Agency Admin)
export const TenantMemberSchema = z.object({
    id: z.string(), // Cognito SUB from the "End User Pool"
    tenantId: z.string(),
    email: z.string(),
    role: z.enum(["Member", "Subscriber", "VIP"]).default("Member"),
    createdAt: z.string(),
});
export type TenantMember = z.infer<typeof TenantMemberSchema>;

// --- AUDIT LOG ---
// The "Black Box" of the system
export const AuditLogSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    actorId: z.string(), // Who did it
    actorEmail: z.string().optional(),
    action: z.string(), // "CREATE_PAGE", "UPDATE_SETTINGS"
    entityId: z.string().optional(),   // <--- NEW: ID of the thing changed
    entityTitle: z.string().optional(),// <--- NEW: Human title of the thing changed
    resourceId: z.string().optional(),
    details: z.any().optional(), // Snapshot of change
    timestamp: z.string(),
    ipAddress: z.string().optional(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

// --- COMMERCE & PRODUCTS ---

export const ProductStatus = z.enum(["active", "archived", "draft"]);
export const Availability = z.enum(["in_stock", "out_of_stock", "preorder"]);
export const Condition = z.enum(["new", "refurbished", "used"]);

// Commerce Helper Schemas
export const VolumePricingTierSchema = z.object({
    minQuantity: z.number().int().min(1),
    price: z.string(), // price per unit at this tier
});
export type VolumePricingTier = z.infer<typeof VolumePricingTierSchema>;

export const PersonalizationOptionSchema = z.object({
    id: z.string(),
    label: z.string(),               // "Personalized text on cookie"
    type: z.enum(["text", "select"]),
    required: z.boolean().default(false),
    maxLength: z.number().optional(), // for text type
    options: z.array(z.string()).optional(), // for select type
    addedCost: z.string().default("0"),     // additional cost in product currency
});
export type PersonalizationOption = z.infer<typeof PersonalizationOptionSchema>;

export const ProductVariantSchema = z.object({
    id: z.string(),
    name: z.string(),                // "Weight" or "Size"
    options: z.array(z.object({
        value: z.string(),           // "250g", "500g"
        priceOverride: z.string().optional(),
        imageLink: z.string().optional(),
        availability: Availability.optional(),
    })),
});
export type ProductVariant = z.infer<typeof ProductVariantSchema>;

export const NutritionalValueSchema = z.object({
    label: z.string(),          // "Calories", "Fat", "Protein"
    value: z.string(),          // "250 kcal", "12g"
    dailyPercent: z.string().optional(),
});
export type NutritionalValue = z.infer<typeof NutritionalValueSchema>;

export const ProductSchema = z.object({
    id: z.string(),
    tenantId: z.string(),

    // Status
    status: ProductStatus.default("draft"),

    // Basic Data
    title: z.string().min(1),
    slug: z.string().default(""),              // URL-safe, auto-generated from title
    sku: z.string().optional(),               // Stock Keeping Unit (from WooCommerce/ERP)
    description: z.string().max(5000),         // Generic/short description
    longDescription: z.string().optional(),    // Detailed rich text (HTML from Tiptap)
    link: z.string().url().optional(),

    // Pricing
    price: z.string(),
    currency: z.string().default("USD"),
    salePrice: z.string().optional(),
    volumePricing: z.array(VolumePricingTierSchema).default([]),

    // Inventory
    availability: Availability.default("in_stock"),
    inventoryQuantity: z.number().int().optional(),

    // Availability by Date
    availableFrom: z.string().optional(),      // ISO date
    availableUntil: z.string().optional(),     // ISO date

    // Categorization
    brand: z.string().optional(),
    category: z.string().optional(),           // kept for backward compat
    categoryIds: z.array(z.string()).default([]),  // multi-category support
    condition: Condition.default("new"),
    tags: z.array(z.string()).default([]),

    // Filterable Attributes (weight, flavor, etc.)
    attributes: z.array(z.object({
        key: z.string(),
        value: z.string(),
    })).default([]),

    // Personalization
    personalizations: z.array(PersonalizationOptionSchema).default([]),

    // Variants
    variants: z.array(ProductVariantSchema).default([]),

    // Structured Tabs
    ingredients: z.string().optional(),
    nutritionalValues: z.array(NutritionalValueSchema).default([]),

    // Media
    imageLink: z.string().url(),
    additionalImageLinks: z.array(z.string().url()).default([]),

    // Product Type
    productType: z.enum(["physical", "digital"]).default("physical"),

    // Digital Commerce (Paddle)
    paymentLinkId: z.string().optional(),
    resourceId: z.string().optional(),

    // SEO
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),

    // Sorting & Weight
    sortOrder: z.number().default(0),
    weight: z.number().optional(), // grams, for shipping calc

    createdAt: z.string(),
    updatedAt: z.string(),
});

export type Product = z.infer<typeof ProductSchema>;

// --- CATEGORIES ---

export const CategorySchema = z.object({
    id: z.string(),
    tenantId: z.string(),

    name: z.string().min(1),
    slug: z.string().min(1),
    description: z.string().optional(),

    // Hierarchy
    parentId: z.string().nullable().default(null),
    sortOrder: z.number().default(0),

    // Display
    imageLink: z.string().optional(),

    // SEO
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),

    // State
    status: z.enum(["active", "hidden"]).default("active"),
    productCount: z.number().default(0),

    createdAt: z.string(),
    updatedAt: z.string(),
});

export type Category = z.infer<typeof CategorySchema>;

// --- DELIVERY CONFIG (per-tenant) ---

export const DeliveryConfigSchema = z.object({
    tenantId: z.string(),

    freeDeliveryThreshold: z.string().optional(),    // e.g. "150" RON
    flatShippingCost: z.string().default("15"),      // default shipping cost
    minimumOrderAmount: z.string().optional(),

    deliveryLeadDays: z.number().default(3),
    blockedDates: z.array(z.string()).default([]),   // YYYY-MM-DD specific blocked dates
    yearlyOffDays: z.array(z.string()).default([]),  // MM-DD recurring yearly (e.g. "12-25", "01-01")
    unblockedDates: z.array(z.string()).default([]), // YYYY-MM-DD forced available (overrides weekly/yearly)
    deliveryDaysOfWeek: z.array(z.number()).default([1, 2, 3, 4, 5]), // 0=Sun..6=Sat

    // Delivery zone restrictions
    restrictDeliveryZones: z.boolean().default(false),  // if true, only deliver to allowed zones
    allowedCountries: z.array(z.string()).default([]),  // e.g. ["Romania"]
    allowedCounties: z.array(z.string()).default([]),   // e.g. ["București", "Ilfov"] - empty = all counties in allowed countries

    // Checkout address configuration
    defaultCountry: z.string().default("Romania"),      // Default country in checkout form
    availableCountries: z.array(z.string()).default([]), // Countries shown in dropdown (empty = just default)
    availableCounties: z.array(z.string()).default([]),  // Counties shown in dropdown (empty = text input)

    updatedAt: z.string(),
});

export type DeliveryConfig = z.infer<typeof DeliveryConfigSchema>;

// --- ORDERS & CUSTOMERS ---

export const ShippingAddressSchema = z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    county: z.string().min(1),
    postalCode: z.string().default(""),
    country: z.string().default("Romania"),
    notes: z.string().default(""),
});
export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;

// Billing details for B2B / company orders (invoicing)
// Generic field names - labels are customized per tenant via commerceStrings
export const BillingDetailsSchema = z.object({
    // Individual name split for invoicing
    firstName: z.string().default(""),
    lastName: z.string().default(""),
    // Company fields (optional - for B2B)
    isCompany: z.boolean().default(false),
    companyName: z.string().default(""),
    taxId: z.string().default(""),              // Generic: CUI/CIF (RO), EIN (US), Company Number (UK), etc.
    vatNumber: z.string().default(""),          // Generic: VAT/TVA number (RO prefix for EU)
    registrationNumber: z.string().default(""), // Generic: Trade Register (RO J-number), Company House Number (UK), etc.
    // Billing address (can differ from shipping)
    useSameAsShipping: z.boolean().default(true),
    billingStreet: z.string().default(""),
    billingCity: z.string().default(""),
    billingCounty: z.string().default(""),
    billingPostalCode: z.string().default(""),
    billingCountry: z.string().default(""),
});
export type BillingDetails = z.infer<typeof BillingDetailsSchema>;

export const OrderItemSchema = z.object({
    productId: z.string(),
    productTitle: z.string(),
    productImage: z.string().default(""),
    productSlug: z.string().default(""),
    quantity: z.number().int().min(1),
    unitPrice: z.string(),
    totalPrice: z.string(),
    personalizations: z.array(z.object({
        label: z.string(),
        value: z.string(),
        addedCost: z.string().default("0"),
    })).default([]),
    selectedVariant: z.string().optional(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const StatusHistorySchema = z.object({
    status: z.string(),
    timestamp: z.string(),
    note: z.string().default(""),
});

export const OrderSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    orderNumber: z.string(),
    customerEmail: z.string().email(),
    customerName: z.string().min(1),
    customerPhone: z.string().default(""),
    shippingAddress: ShippingAddressSchema,
    billingDetails: BillingDetailsSchema.optional(), // B2B / company invoice details
    items: z.array(OrderItemSchema).min(1),
    subtotal: z.string(),
    shippingCost: z.string().default("0"),
    discount: z.string().default("0"),
    total: z.string(),
    currency: z.string().default("USD"),
    couponCode: z.string().optional(),
    couponDiscount: z.string().default("0"),
    paymentMethod: z.enum(["cash_on_delivery", "bank_transfer"]).default("cash_on_delivery"),
    paymentStatus: z.enum(["pending", "paid", "refunded"]).default("pending"),
    requestedDeliveryDate: z.string().optional(),
    estimatedDeliveryDate: z.string().optional(),
    trackingNumber: z.string().optional(),
    status: z.enum(["placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled"]).default("placed"),
    statusHistory: z.array(StatusHistorySchema).default([]),
    internalNotes: z.string().default(""),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

export const CustomerSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    email: z.string().email(),
    name: z.string().min(1),
    phone: z.string().default(""),
    birthday: z.string().optional(),           // YYYY-MM-DD format for birthday vouchers
    loyaltyPoints: z.number().default(0),      // Accumulated points from orders
    orderCount: z.number().default(0),
    totalSpent: z.string().default("0"),
    lastOrderDate: z.string().optional(),
    defaultAddress: ShippingAddressSchema.optional(),
    defaultBillingDetails: BillingDetailsSchema.optional(), // Save company details for repeat orders
    notes: z.string().default(""),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Customer = z.infer<typeof CustomerSchema>;

// --- ORDER INPUT VALIDATION (for public checkout API) ---

export const OrderItemInputSchema = z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
    selectedVariant: z.string().optional(),
    personalizations: z.array(z.object({
        id: z.string(),
        label: z.string(),
        value: z.string().max(500)
    })).optional()
});

export const OrderInputSchema = z.object({
    items: z.array(OrderItemInputSchema).min(1).max(50),
    customerEmail: z.string().email().max(254),
    customerName: z.string().min(1).max(200),
    customerPhone: z.string().max(30).optional(),
    customerBirthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    shippingAddress: ShippingAddressSchema.optional(),
    billingDetails: BillingDetailsSchema.optional(),
    paymentMethod: z.enum(["cod", "bank_transfer"]),
    requestedDeliveryDate: z.string().optional(),
    couponCode: z.string().max(50).optional(),
    recaptchaToken: z.string().min(1).optional(), // Optional for backwards compat, enforced in handler when enabled
});
export type OrderInput = z.infer<typeof OrderInputSchema>;

// --- COUPONS ---

export const CouponSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    code: z.string().min(1),
    type: z.enum(["percentage", "fixed_amount"]).default("percentage"),
    value: z.string(), // e.g. "10" for 10% or "25" for 25 RON
    minimumOrderAmount: z.string().default("0"),
    maximumDiscount: z.string().optional(), // cap for percentage coupons
    validFrom: z.string().optional(),
    validUntil: z.string().optional(),
    usageLimit: z.number().default(0), // 0 = unlimited
    usageCount: z.number().default(0),
    perCustomerLimit: z.number().default(0), // 0 = unlimited
    applicableCategories: z.array(z.string()).default([]),
    applicableProducts: z.array(z.string()).default([]),
    status: z.enum(["active", "expired", "disabled"]).default("active"),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Coupon = z.infer<typeof CouponSchema>;

// --- REVIEWS ---

/**
 * UTF-8 byte length of a string. `z.string().max(n)` bounds UTF-16 CODE UNITS, not bytes, so it
 * CANNOT enforce a byte-denominated limit: `"\u{1F600}".repeat(512)` is 1024 code units but 2048
 * UTF-8 bytes. `TextEncoder` is a standard global in Node 22 and every browser engine (shared is
 * consumed by both the backend and the Vite/Next front-ends), so it is safe to use here.
 */
const utf8ByteLength = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Predicate for a zod `.refine` that bounds a string by UTF-8 BYTES. Two current callers:
 * `ReviewImageSchema.assetKey` (S3's hard 1024-byte object-key limit) and `.alt` (the per-entry
 * size budget behind MAX_REVIEW_IMAGES). Rejected the simpler `z.string().max(n)` — it counts
 * code units, under-counts multibyte input, and would admit an over-limit S3 key (review-0 defect).
 */
const withinUtf8Bytes = (maxBytes: number) => (s: string): boolean => utf8ByteLength(s) <= maxBytes;

/**
 * Upper bound on photos carried INLINE on a single review record (D-REV-1, ratified).
 *
 * Ratified human ruling (2026-08-05, #2): review photos live in S3 — the review row holds
 * only bounded per-image METADATA, never bytes. So this constant bounds the ENTRY COUNT,
 * never the photo size (§ plan-reviews-import D-REV-1).
 *
 * What this constant bounds — and what it does NOT. It bounds ONLY the image-metadata
 * CONTRIBUTION to the review item, against the DynamoDB 400 KB item cap (409,600 bytes,
 * counted across PK + SK + every attribute name and value):
 *   Worst-case bytes per ReviewImage entry (all fields at their schema max):
 *     assetKey ≤ 1024 B  (S3's hard object-key limit; enforced in UTF-8 BYTES on the field below)
 *     alt      ≤ 1000 B  (enforced in UTF-8 BYTES on the field below)
 *     status   ≈   12 B  ("approved")
 *     width/height + per-key/map framing ≈ 80 B
 *   → ≈ 2.1 KB per entry. 12 × 2.1 KB ≈ 25 KB — the images add at most ~25 KB (< 7% of the
 *   cap). This does NOT by itself make the whole item "provably ≤ 400 KB": `content` and the
 *   other string fields on ReviewSchema are UNBOUNDED, so a pathological `content` could still
 *   blow the item regardless of this constant. Bounding image COUNT keeps the images' share of
 *   the item small, bounded, and predictable on every read/projection, and leaves > 370 KB of
 *   headroom for the body — it is not, and is not claimed to be, a whole-item size guarantee
 *   (bounding the review body is a separate concern this constant does not address).
 *
 * 12 also clears the demonstrated need (D-REV-1: realistic galleries are ~1–10 photos) with
 * headroom, without the cost of the rejected out-of-item option B (separate REVIEWIMG# rows).
 * Bytes never live in DynamoDB — photos live in S3; this bounds ENTRY COUNT, never photo size.
 */
export const MAX_REVIEW_IMAGES = 12;

/**
 * One photo attached to a review — METADATA ONLY (D-REV-1). `assetKey` is the S3 object key
 * of the re-hosted image that rev-2's importer writes; no image bytes ever live in DynamoDB.
 * Per-image `status` DEFAULTS to "pending": an imported/added photo is non-publishable until
 * a human approves it — the moderation gate governs the PUBLIC OBJECT, not merely the render
 * (ratified spine principle; D-REV-4 human-moderation model).
 *
 * `assetKey`/`alt` are bounded in UTF-8 BYTES (see `withinUtf8Bytes`) so the per-entry size in
 * the MAX_REVIEW_IMAGES budget above is a real byte bound, not an assumption — `z.string().max()`
 * would count UTF-16 code units and admit an over-limit S3 key for multibyte input.
 */
export const ReviewImageSchema = z.object({
    // S3 caps object keys at 1024 BYTES. `.max()` counts code units, so enforce the byte bound.
    assetKey: z
        .string()
        .min(1)
        .refine(withinUtf8Bytes(1024), { message: "assetKey exceeds S3's 1024-byte object-key limit" }),
    status: z.enum(["approved", "pending", "hidden"]).default("pending"),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    alt: z.string().refine(withinUtf8Bytes(1000), { message: "alt exceeds 1000 UTF-8 bytes" }).optional(),
});
export type ReviewImage = z.infer<typeof ReviewImageSchema>;

/**
 * A moderated review (System A — the DB-backed review store; see plan-reviews-import § 2.1).
 *
 * rev-1 adds three ratified fields ADDITIVELY — each defaults or is optional, so the three
 * NEW fields introduce no data migration (MEMORY: "all new fields have `.default()` for
 * backward compat"). Note the precise scope of that guarantee: adding defaulted/optional
 * fields cannot, on its own, break a stored row — but whether a given row parses OVERALL also
 * depends on its PRE-EXISTING fields (`source`, `googleReviewId`). Those are the reason for the
 * widenings in the BACKWARD-COMPAT NOTE below, and that note bounds exactly which pre-rev-1
 * rows are covered (the observed default-write shape — NOT every conceivable persisted row):
 *   • `scope` (D-REV-5, ratified narrowed-D: product|site only). Defaults to "product", so a
 *     stored product review with no `scope` attribute parses as product-scoped. Site-scope
 *     reviews (business-level Google/FB imports) are written by rev-2 under a DISJOINT sort
 *     key `SITEREVIEW#<id>` — chosen over `REVIEW#SITE#<id>` because it shares NO prefix with
 *     the existing `REVIEW#<productId>#<id>` namespace, so it provably cannot collide (a
 *     productId literally equal to "SITE" could otherwise alias). rev-1 defines the type; rev-2
 *     writes the key and rev-3's admin list must also query the `SITEREVIEW#` prefix.
 *   • `images` (D-REV-1) — inline metadata array, count-bounded by MAX_REVIEW_IMAGES.
 *   • `importBatchId` (D-REV-3) — reference to the immutable ImportBatch carrying the tenant's
 *     rights attestation. Set only on imported reviews (rev-2 populates it). Images inherit
 *     their batch from the parent review, so it is NOT duplicated per-image — one source of
 *     truth avoids divergent per-photo rights state.
 *
 * `productId` is now OPTIONAL at the field level and REQUIRED by refinement only when
 * scope === "product" (a site-scope review has no product). The refine runs AFTER defaults,
 * so an object with a productId and no scope is product-scoped and valid.
 *
 * BACKWARD-COMPAT NOTE (revise cycle, 2026-08-08): the pre-existing `source`/`googleReviewId`
 * fields required WIDENING the schema to match what `reviews/create.ts` actually persists,
 * because that write path bypasses Zod entirely (`JSON.parse(...) as Partial<Review>` is a
 * compile-time cast, not runtime validation — create.ts:31) and has, since inception, written
 * two DEFAULT-WRITE shapes the pre-rev-1 enum/optionality never admitted (the reviewer proved
 * this against the working tree):
 *   • `source: "manual"` when the caller OMITS `source` (`source || "manual"`, create.ts:57) —
 *     added to the enum below.
 *   • `googleReviewId: null` when the caller OMITS it (`googleReviewId || null`, create.ts:61) —
 *     `.nullable()` below.
 * SCOPE OF THE COMPAT GUARANTEE (do not over-read it): these two widenings admit the DEFAULT-WRITE
 * shape — the row create.ts emits when the caller supplies neither field, which is what a
 * first-party product review carries. They do NOT retroactively admit a row whose caller PASSED an
 * out-of-enum `source` (e.g. `source: "other"`), because the unvalidated write passes any truthy
 * `source` straight through (`source || "manual"`, create.ts:57); making such rows parse would
 * mean widening `source` to `z.string()`, which is BEYOND the ratified resolution and would erase
 * the enum's meaning. Rows like that are the write-path defect itself, not something rev-1 can
 * make well-typed without endorsing arbitrary sources. These widenings are compat, NOT an
 * endorsement of "manual"/null for new writes: the underlying defect (writes bypass the shared
 * contract — the shared-first rule violated historically) is F-REV1-x in docs/TECH-DEBT.md, and
 * fixing the WRITE path (validate-on-write, default→internal, which also closes the arbitrary-
 * `source` door going forward) is rev-2, not this slice. Schema-first here means the schema
 * describes the PERSISTED REALITY the handler actually produces by default.
 */
export const ReviewSchema = z
    .object({
        id: z.string(),
        tenantId: z.string(),
        scope: z.enum(["product", "site"]).default("product"),
        productId: z.string().optional(),
        // "manual" is a LEGACY member: `reviews/create.ts` has, since inception, persisted
        // `source: source || "manual"` (create.ts:57) — a value the pre-rev-1 enum never listed.
        // The enum is WIDENED (not the create path fixed) so those already-persisted rows parse;
        // widening the schema to describe PERSISTED REALITY is the backward-compat requirement.
        // "manual" MUST NOT be the default for NEW writes — the default stays "internal", and
        // rev-2 is to stop create.ts writing "manual" and validate-on-write (F-REV1-x, TECH-DEBT).
        source: z.enum(["google", "internal", "imported", "manual"]).default("internal"),
        authorName: z.string().min(1),
        rating: z.number().min(1).max(5),
        content: z.string().default(""),
        // `.nullable()`: `reviews/create.ts:61` persists `googleReviewId: googleReviewId || null`,
        // so a non-Google review has the attribute present and set to null. `.optional()` alone
        // rejects null; a legacy row would fail to parse. `.nullable().optional()` admits null,
        // absent, or a string — covering the `googleReviewId || null` the DEFAULT write produces
        // (null when the caller omits it, the string when supplied). It does NOT claim to admit a
        // non-string the unvalidated write could still emit if a caller passed one (e.g. a JSON
        // number) — that residual is the same write-path defect, F-REV1-x (fixed in rev-2).
        googleReviewId: z.string().nullable().optional(),
        importBatchId: z.string().optional(),
        images: z.array(ReviewImageSchema).max(MAX_REVIEW_IMAGES).default([]),
        status: z.enum(["approved", "pending", "hidden"]).default("pending"),
        createdAt: z.string(),
    })
    .refine((r) => r.scope !== "product" || (r.productId != null && r.productId.length > 0), {
        message: 'productId is required when scope is "product"',
        path: ["productId"],
    });
export type Review = z.infer<typeof ReviewSchema>;

/**
 * Immutable rights-attestation record (D-REV-3, ratified). Written ONCE by the importer
 * (rev-2) when a tenant imports a batch of reviews, and never mutated — imported review
 * photos are third-party content, so publication is gated on an explicit, recorded human
 * assertion that the tenant has the right to display them. rev-1 DEFINES the shape and the
 * reference (`ReviewSchema.importBatchId`); rev-2 writes it. Immutability is a write-once
 * storage property (rev-2 enforces it on the write path), not something a parse schema states.
 */
export const ImportBatchSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    attestedBy: z.string().min(1),        // actor identity (email) — CLAUDE.md audit-context rule
    attestedAt: z.string(),               // ISO-8601 timestamp of the attestation
    rightsBasis: z.string().min(1),       // the tenant's asserted basis to display the media
    legalTextVersion: z.string().min(1),  // version of the attestation wording shown at import time
});
export type ImportBatch = z.infer<typeof ImportBatchSchema>;

/**
 * Structured result of ONE bulk review import (rev-2b), returned by `POST /import/reviews` and
 * rendered by the admin import UI (the "Report as output surface" DoD).
 *
 * This is a RESPONSE DTO, not a persisted or re-parsed entity — it is BUILT by the backend
 * importer and CONSUMED by the admin (a documented backend→admin boundary crossing). Per the
 * clean-architecture directive, data crossing a boundary is a raw, simple structure: plain TS
 * types, no Zod. Nothing ever validates a report at runtime (there is no read path that parses
 * one back), so a schema would be dead weight — the type is the contract, shared as the single
 * source of truth so the admin renders the exact shape the importer emits.
 *
 * Concrete current users: producer = `backend/src/import/reviews.ts`; consumer = the admin
 * Reviews import dialog. Axis: NONE — this is a shared DTO, not an abstraction over variation.
 * Rejected alternative: a Zod schema (unearned — the report is never parsed/validated).
 */
export interface ReviewImportRowResult {
    /** 0-based index of the row in the source CSV/JSON, so a rejection is traceable to its line. */
    index: number;
    status: "accepted" | "rejected";
    /** Set when accepted: the id of the written review. */
    reviewId?: string;
    /** Set when accepted: which key namespace the review landed under. */
    scope?: "product" | "site";
    productId?: string;
    /** Count of images that passed the declared type+size stage gate and were attached to the accepted review (no byte-screen — D-REV-4 SUPERSEDED). */
    imagesAccepted?: number;
    /** Set when rejected: why the whole row was rejected (never silently skipped). */
    reason?: string;
}

/**
 * FULL per-image disposition in a bulk import (rev-2b, revise cycle #3). The deep-vertical output
 * surface is the COMPLETE disposition of every referenced photo — not only the failures: an
 * ACCEPTED image is a first-class entry carrying the PRIVATE staged `assetKey` and its staged byte
 * `size`, so the operator sees exactly what was staged, keyed to its row and ZIP entry. A REJECTED
 * image carries the reason it was dropped (missing from the ZIP, off the declared-type/size gate,
 * or belonging to a rejected row).
 *
 * MODERATION-ONLY pipeline (D-REV-4 SUPERSEDED 2026-08-08 — the automated byte-screen was dropped): there is no
 * decode step, so an accepted entry carries the staged BYTE size (`size`), not pixel dimensions —
 * width/height would require the decoder we deliberately removed. The staged original is the object
 * a human approves and promotes (rev-2a); the moderation gate is the content control.
 *
 * Modeled as a SUM TYPE on `status` — an image is accepted XOR rejected and each variant carries
 * DISJOINT valid data (accepted → assetKey + size; rejected → reason). This is the domain-modeling
 * rule (mutually-exclusive states as a sum type, each variant holding only the data valid in that
 * state); the rejected alternative — two parallel `accepted`/`rejected` arrays, or one struct with
 * a boolean + nullable assetKey/reason — is the defect-shaped type the directive forbids. Growth
 * axis: variants FIXED (accepted|rejected), so a discriminated union is the right dispatch — the
 * admin renders both by matching `status`.
 */
export type ReviewImportImageResult =
    | {
          status: "accepted";
          /** 0-based index of the owning row. */
          rowIndex: number;
          /** The ZIP entry name the row referenced. */
          entry: string;
          /** PRIVATE staged original key. Promotion to the public bucket is rev-2a's approval path. */
          assetKey: string;
          /** Staged byte size of the original (the true byte count, = the ZIP entry's length). */
          size: number;
      }
    | {
          status: "rejected";
          /** 0-based index of the owning row. */
          rowIndex: number;
          /** The ZIP entry name the row referenced. */
          entry: string;
          reason: string;
      };

export interface ReviewImportReport {
    /** The immutable ImportBatch this import wrote FIRST; every accepted review references it. */
    batchId: string;
    format: "csv" | "json";
    totalRows: number;
    accepted: number;
    rejected: number;
    /** Per-row outcome (accepted with ids, or rejected with a reason) — every row appears once. */
    rows: ReviewImportRowResult[];
    /**
     * FULL per-image disposition across all rows — every referenced photo appears once, accepted
     * (with `assetKey` + the staged original's BYTE size — no normalization exists post-D-REV-4) OR
     * rejected (with `reason`). The row result's `imagesAccepted` is the per-row rollup of the
     * accepted entries here.
     */
    images: ReviewImportImageResult[];
}

// --- POPUPS ---

export const PopupSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    name: z.string().min(1),
    type: z.enum(["announcement", "newsletter", "promotion", "custom"]).default("announcement"),
    headline: z.string().optional(),
    body: z.string().optional(),         // HTML content
    imageLink: z.string().optional(),
    ctaText: z.string().optional(),
    ctaLink: z.string().optional(),
    trigger: z.enum(["page_load", "exit_intent", "scroll", "time_delay"]).default("page_load"),
    triggerValue: z.string().default("0"),  // scroll %, seconds delay
    showOnPages: z.array(z.string()).default([]),  // empty = all pages
    showOncePerSession: z.boolean().default(true),
    status: z.enum(["active", "disabled"]).default("disabled"),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Popup = z.infer<typeof PopupSchema>;

// --- FORMS ---

export const FormFieldSchema = z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(["text", "email", "phone", "textarea", "select", "checkbox", "number"]),
    required: z.boolean().default(false),
    placeholder: z.string().optional(),
    options: z.array(z.string()).optional(), // for select type
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const FormDefinitionSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    name: z.string().min(1),
    slug: z.string().min(1),
    fields: z.array(FormFieldSchema).default([]),
    submitButtonText: z.string().default("Submit"),
    successMessage: z.string().default("Thank you! Your submission has been received."),
    notifyEmail: z.string().optional(),    // email to notify on submission
    status: z.enum(["active", "disabled"]).default("active"),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;

export const FormSubmissionSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    formId: z.string(),
    formName: z.string(),
    data: z.record(z.string(), z.any()),  // field label → value
    submitterEmail: z.string().optional(),
    status: z.enum(["new", "read", "archived"]).default("new"),
    createdAt: z.string(),
});
export type FormSubmission = z.infer<typeof FormSubmissionSchema>;

// --- SIGNALS (Outbound Lead Tracking) ---
export const SignalSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    source: SignalSource,
    url: z.string(),
    title: z.string(),
    contentSnapshot: z.string().max(5000),
    author: z.string().optional(),
    painScore: z.number().min(1).max(10),
    walletSignal: z.boolean(),
    analysis: z.string(),
    draftReply: z.string().optional(),
    status: SignalStatus.default("New"),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Signal = z.infer<typeof SignalSchema>;

type Theme = z.infer<typeof ThemeSchema>;

export const THEME_PRESETS: Record<string, Partial<Theme>> = {
    "standard": {
        primaryColor: "#000000",
        primaryForeground: "#ffffff",
        backgroundColor: "#ffffff",
        textColor: "#020817",
        surfaceColor: "#f4f4f5",
        fontHeading: "Inter",
        fontBody: "Inter",
        radius: "0.5rem"
    },
    "midnight": {
        primaryColor: "#6366f1", // Indigo 500
        primaryForeground: "#ffffff",
        backgroundColor: "#09090b", // Zinc 950
        textColor: "#fafafa", // Zinc 50
        surfaceColor: "#18181b", // Zinc 900
        secondaryColor: "#27272a", // Zinc 800
        secondaryForeground: "#fafafa",
        fontHeading: "Plus Jakarta Sans",
        fontBody: "Inter",
        radius: "0.75rem"
    },
    "editorial": {
        primaryColor: "#1c1917", // Stone 900
        primaryForeground: "#fafaf9",
        backgroundColor: "#fefce8", // Yellow 50 (Cream)
        textColor: "#1c1917",
        surfaceColor: "#f5f5f4", // Stone 100
        fontHeading: "Playfair Display",
        fontBody: "Lora",
        radius: "0rem"
    },
    "corporate": {
        primaryColor: "#0f172a", // Slate 900
        primaryForeground: "#f8fafc",
        backgroundColor: "#ffffff",
        textColor: "#334155", // Slate 700
        surfaceColor: "#f1f5f9", // Slate 100
        secondaryColor: "#e2e8f0",
        secondaryForeground: "#0f172a",
        fontHeading: "Lato",
        fontBody: "Lato",
        radius: "0.3rem"
    },
    "vibrant": {
        primaryColor: "#db2777", // Pink 600
        primaryForeground: "#ffffff",
        backgroundColor: "#ffffff",
        textColor: "#1f2937",
        surfaceColor: "#f3f4f6",
        fontHeading: "Poppins",
        fontBody: "Open Sans",
        radius: "1rem"
    }
};

// Country Packs
export * from "./country-packs/index.js";
