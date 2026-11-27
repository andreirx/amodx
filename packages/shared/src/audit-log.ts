// The audit log entry (AuditLogSchema).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

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
