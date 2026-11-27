// Strategy context items (the brain) and work items (the engine).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

export const WorkItemStatus = z.enum(["Draft", "PendingApproval", "Scheduled", "Completed", "Failed"]);

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
