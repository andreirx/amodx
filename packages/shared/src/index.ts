import { z } from "zod";

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

// SINGLE SOURCE OF TRUTH for URL prefix defaults — do NOT duplicate these elsewhere
export const URL_PREFIX_DEFAULTS = {
    product: "/product",
    category: "/category",
    cart: "/cart",
    checkout: "/checkout",
    shop: "/shop",
    account: "/account",
} as const;

// Configurable URL prefixes per tenant (for i18n-friendly URLs)
export const UrlPrefixesSchema = z.object({
    product: z.string().default(URL_PREFIX_DEFAULTS.product),
    category: z.string().default(URL_PREFIX_DEFAULTS.category),
    cart: z.string().default(URL_PREFIX_DEFAULTS.cart),
    checkout: z.string().default(URL_PREFIX_DEFAULTS.checkout),
    shop: z.string().default(URL_PREFIX_DEFAULTS.shop),
    account: z.string().default(URL_PREFIX_DEFAULTS.account),
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
    currency: z.string().default("lei"),
});

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
});
export type LegalLinks = z.infer<typeof LegalLinksSchema>;

// ==========================================
// 7. INFRASTRUCTURE & SETTINGS
// ==========================================

export const TenantStatus = z.enum(["LIVE", "SUSPENDED", "OFF"]);
export const UserRole = z.enum(["GLOBAL_ADMIN", "CLIENT_ADMIN", "EDITOR"]);

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
});

// GDPR Cookie Consent Configuration
export const GDPRConfigSchema = z.object({
    headline: z.string().optional(),
    description: z.string().optional(),
    position: z.enum(["bottom", "top"]).default("bottom"),
    enabled: z.boolean().default(true),
});

export type GDPRConfig = z.infer<typeof GDPRConfigSchema>;

export const TenantConfigSchema = z.object({
    id: z.string(), // e.g., "client-bob"
    domain: z.string(), // e.g., "dental-pros.com"
    name: z.string(),

    // NEW FIELDS
    description: z.string().optional(), // SEO Meta + llms.txt intro
    header: HeaderConfigSchema.default({ showLogo: true, showTitle: true }),

    // GDPR Cookie Consent
    gdpr: GDPRConfigSchema.default({
        position: "bottom",
        enabled: true
    }),

    // Global Schema Settings
    schemaType: SchemaType.default("Organization"),

    // Assets & Nav
    logo: z.string().optional(),
    icon: z.string().optional(), // Favicon
    navLinks: z.array(LinkSchema).default([]),
    footerLinks: z.array(LinkSchema).default([]),

    // Commerce toggle — enables cart, checkout, orders flow. Products/categories/Paddle still work without it.
    commerceEnabled: z.boolean().default(false),

    // Commerce URL Prefixes (configurable per tenant for i18n)
    urlPrefixes: UrlPrefixesSchema.default(URL_PREFIX_DEFAULTS),

    // Quick Contact Widget
    quickContact: QuickContactSchema.optional(),

    // Top Bar (announcement bar above header)
    topBar: TopBarSchema.default({ show: false }),

    // Commerce Bar (utility bar above navbar: phone, social, cart, CTA)
    commerceBar: CommerceBarSchema.default({ enabled: false, socialLinks: [], currency: "lei" }),

    // Order email templates (configurable per status)
    orderEmailConfig: OrderEmailConfigSchema.default({ templates: {} }),

    // Enabled payment methods for commerce checkout
    enabledPaymentMethods: z.array(z.enum(["cash_on_delivery", "bank_transfer"])).default(["cash_on_delivery"]),

    // Default currency for commerce (products inherit this)
    currency: z.string().default("RON"),

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

    // Commerce Integration
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
    items: z.array(OrderItemSchema).min(1),
    subtotal: z.string(),
    shippingCost: z.string().default("0"),
    discount: z.string().default("0"),
    total: z.string(),
    currency: z.string().default("RON"),
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
    orderCount: z.number().default(0),
    totalSpent: z.string().default("0"),
    lastOrderDate: z.string().optional(),
    defaultAddress: ShippingAddressSchema.optional(),
    notes: z.string().default(""),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Customer = z.infer<typeof CustomerSchema>;

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

export const ReviewSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    productId: z.string(),
    source: z.enum(["google", "internal", "imported"]).default("internal"),
    authorName: z.string().min(1),
    rating: z.number().min(1).max(5),
    content: z.string().default(""),
    googleReviewId: z.string().optional(),
    status: z.enum(["approved", "pending", "hidden"]).default("pending"),
    createdAt: z.string(),
});
export type Review = z.infer<typeof ReviewSchema>;

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
