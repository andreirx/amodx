import { z } from "zod";

// ==========================================
// 1. GLOBAL ENUMS & CONSTANTS
// ==========================================

export const ContentType = z.enum(["Page", "Post", "Folder", "FunnelStep", "Product"]);
export const ContentStatus = z.enum(["Draft", "Published", "Archived"]);
export const AccessType = z.enum(["Public", "LoginRequired", "Group", "Purchase"]);
export const WorkItemStatus = z.enum(["Draft", "PendingApproval", "Scheduled", "Completed", "Failed"]);
export const ContextType = z.enum(["Strategy", "Persona", "PainPoint", "BrandVoice", "Offer"]);

// ==========================================
// 2. ACCESS CONTROL (The Gatekeeper)
// ==========================================

export const AccessPolicySchema = z.object({
    type: AccessType,
    // If type == Group
    requiredGroups: z.array(z.string()).optional(),
    // If type == Purchase
    requiredProductId: z.string().optional(),
    // For price display in the UI if locked
    price: z.number().optional(),
    currency: z.string().default("USD"),
});

export type AccessPolicy = z.infer<typeof AccessPolicySchema>;

// ==========================================
// 3. SITE STRUCTURE (The Skeleton)
// ==========================================

// A "Node" is a permanent spot in the site tree (e.g., "The About Page")
export const NodeSchema = z.object({
    id: z.string(), // UUID
    tenantId: z.string(),
    parentId: z.string().nullable(), // Null for Root
    type: ContentType,
    title: z.string(),
    // Links to Strategy Context (e.g., "This page targets Angry Dads")
    contextTags: z.array(z.string()).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type Node = z.infer<typeof NodeSchema>;

// A "Route" maps a URL to a Node
export const RouteSchema = z.object({
    slug: z.string(), // "/services/plumbing"
    tenantId: z.string(),
    targetNodeId: z.string(),
    isRedirect: z.boolean().default(false),
    redirectTo: z.string().optional(), // If isRedirect is true
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
});

export type Route = z.infer<typeof RouteSchema>;

// ==========================================
// 4. CONTENT DATA (The Payload)
// ==========================================

// We use a Block-based editor (like Notion/Tiptap)
export const ContentBlockSchema = z.object({
    id: z.string(),
    type: z.string(), // "paragraph", "heading", "image", "hero", "form"
    content: z.any(), // The JSON data for the block
    settings: z.record(z.string(), z.any()).optional(), // Layout settings (color, width)
});

export const ContentItemSchema = z.object({
    id: z.string(), // UUID (Usually NodeID + Version)
    nodeId: z.string(),
    version: z.number(),
    status: ContentStatus,
    title: z.string(),
    slug: z.string().optional(),
    blocks: z.array(z.any()),
    accessPolicy: AccessPolicySchema.default({ type: "Public", currency: "USD" }),
    author: z.string(), // UserID
    createdAt: z.string(),
});

export type ContentItem = z.infer<typeof ContentItemSchema>;

// ==========================================
// 5. THE BRAIN (Strategy & Context)
// ==========================================

export const ContextItemSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    type: ContextType,
    name: z.string(), // e.g., "Angry Dad Persona"
    data: z.string(), // The text description or JSON string
    embeddingId: z.string().optional(), // Reference to Vector DB
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

export const TenantConfigSchema = z.object({
    id: z.string(), // e.g., "client-bob"
    domain: z.string(), // e.g., "dental-pros.com"
    name: z.string(),

    // THE NEW STATE MACHINE
    status: TenantStatus.default("LIVE"),

    plan: z.enum(["Free", "Pro", "Agency"]),

    // Infrastructure tracking (as discussed before)
    resources: z.object({
        distributionId: z.string().optional(),
        certificateArn: z.string().optional(),
        bucketFolder: z.string().optional(),
    }).optional(),

    // Visual Theme Config
    theme: z.object({
        mode: z.enum(["light", "dark"]).default("light"),
        primaryColor: z.string().default("#000000"),
        fontHeading: z.string().default("Inter"),
        fontBody: z.string().default("Inter"),
    }),

    integrations: z.object({
        stripe: z.boolean().default(false),
        mailerlite: z.boolean().default(false),
        perplexity: z.boolean().default(false),
    }),
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
