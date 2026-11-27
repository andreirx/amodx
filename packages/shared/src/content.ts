// Content and blocks: content status and access, inline rich text, the access policy, routes, the content item and comments.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";
import { ThemeSchema } from "./theme.js";

export const ContentStatus = z.enum(["Draft", "Published", "Archived"]);
export const AccessType = z.enum(["Public", "LoginRequired", "Group", "Purchase", "EmailGate"]);

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
    // BACKEND-CONTRACT-1 D2: nullable — the content API stores and returns `null` for a cleared
    // field, so what GET returns must validate on create/update. `null` = cleared, absent = unset.
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    seoKeywords: z.string().nullable().optional(),
    featuredImage: z.string().nullable().optional(),

    // CATEGORIZATION
    tags: z.array(z.string()).default([]),

    // comments default off
    commentsMode: CommentsMode.default("Hidden"),

    // Page-level Override
    // D2: nullable for the same round-trip reason; the enum is kept (null is "no override").
    schemaType: SchemaType.nullable().optional(), // e.g., Homepage might be SoftwareApplication, Blog might be Article

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

    // LANG-1 (docs/slices/lang-1.md § 5, § 6): the translation set the page belongs to — a random UUID made when two
    // pages are first linked, never a nodeId, never reused. WRITTEN ONLY BY THE BACKEND (rule C1): the content API
    // never takes it as input (create omits it; update's schema does not list it). Absent = in no set.
    translationKey: z.string().optional(),
});

export type ContentItem = z.infer<typeof ContentItemSchema>;

/**
 * LANG-1 (§ 5) — content API INPUT only (POST /content, PUT /content/{id}); never stored: the nodeId of a page whose
 * translation set this page joins; `null` = leave the set; absent = no change to the set.
 */
export const TranslationOfInputSchema = z.string().nullable().optional();

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
