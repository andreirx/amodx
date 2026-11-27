// Popups: PopupSchema.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

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
    // NEWSLETTER-1 (scope item 5): exactly `true` on a popup of type "newsletter" = the popup shows the email field and
    // the consent box and stores the signup. Absent (every stored popup) or any other type = the popup draws as before.
    collectEmail: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Popup = z.infer<typeof PopupSchema>;
