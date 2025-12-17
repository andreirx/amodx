import { z } from "zod";

// ==========================================
// 1. GLOBAL ENUMS & CONSTANTS
// ==========================================

export const ContentStatus = z.enum(["Draft", "Published", "Archived"]);
export const AccessType = z.enum(["Public", "LoginRequired", "Group", "Purchase", "EmailGate"]);
export const WorkItemStatus = z.enum(["Draft", "PendingApproval", "Scheduled", "Completed", "Failed"]);

// Helper for Navigation
export const LinkSchema = z.object({
    label: z.string(),
    href: z.string(),
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

// ==========================================
// 4. CONTENT DATA (The Payload)
// ==========================================

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

    // THE MEAT
    blocks: z.array(z.any()).default([]), // Tiptap JSON

    // THE GATE
    accessPolicy: AccessPolicySchema,

    author: z.string(),
    authorEmail: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
    updatedBy: z.string().optional(),
});

export type ContentItem = z.infer<typeof ContentItemSchema>;

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

// ==========================================
// 7. INFRASTRUCTURE & SETTINGS
// ==========================================

export const TenantStatus = z.enum(["LIVE", "SUSPENDED", "OFF"]);
export const UserRole = z.enum(["GLOBAL_ADMIN", "CLIENT_ADMIN", "EDITOR"]);

// Expanded Theme Config
export const ThemeSchema = z.object({
    mode: z.enum(["light", "dark"]).default("light"),

    // Colors
    primaryColor: z.string().default("#000000"),
    secondaryColor: z.string().default("#ffffff"),
    backgroundColor: z.string().default("#ffffff"),
    surfaceColor: z.string().default("#f4f4f5"), // Cards/Sidebars

    // Typography (We will load these from Google Fonts in the Renderer)
    fontHeading: z.string().default("Playfair Display"),
    fontBody: z.string().default("Lato"),

    // UI Roundness
    radius: z.string().default("0.5rem"),
});

// Expanded Integrations
export const IntegrationsSchema = z.object({
    contactEmail: z.string().email().optional(),

    googleAnalyticsId: z.string().optional(), // G-XXXXXXXX
    googleSearchConsoleId: z.string().optional(), // Verification Code

    // Privacy Friendly (Umami/Plausible)
    // We store the script URL and the Website ID
    analytics: z.object({
        provider: z.enum(["none", "umami", "plausible", "custom"]).default("none"),
        url: z.string().optional(), // e.g. "https://analytics.myagency.com/script.js"
        websiteId: z.string().optional(), // UUID for Umami
    }).default({ provider: "none" }),

    stripePublicKey: z.string().optional(),
    mailerlite: z.boolean().default(false),
    perplexity: z.boolean().default(false),
});

// New Header Config
export const HeaderConfigSchema = z.object({
    showLogo: z.boolean().default(true),
    showTitle: z.boolean().default(true),
});

export const TenantConfigSchema = z.object({
    id: z.string(), // e.g., "client-bob"
    domain: z.string(), // e.g., "dental-pros.com"
    name: z.string(),

    // NEW FIELDS
    description: z.string().optional(), // SEO Meta + llms.txt intro
    header: HeaderConfigSchema.default({ showLogo: true, showTitle: true }),

    // NEW: Assets & Nav
    logo: z.string().optional(),
    icon: z.string().optional(), // Favicon
    navLinks: z.array(LinkSchema).default([]),
    footerLinks: z.array(LinkSchema).default([]),

    // THE NEW STATE MACHINE
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
        secondaryColor: "#ffffff",
        backgroundColor: "#ffffff",
        surfaceColor: "#f4f4f5",
        fontHeading: "Playfair Display",
        fontBody: "Lato",
        radius: "0.5rem"
    }),
    integrations: IntegrationsSchema.default({
        googleAnalyticsId: "",
        googleSearchConsoleId: "",
        stripePublicKey: "",
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
    action: z.string(), // "CREATE_PAGE", "UPDATE_SETTINGS"
    resourceId: z.string().optional(),
    details: z.any().optional(), // Snapshot of change
    timestamp: z.string(),
    ipAddress: z.string().optional(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;
