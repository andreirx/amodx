// Signals (outbound lead tracking): the signal enums and SignalSchema.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

export const SignalStatus = z.enum(["New", "Drafted", "Replied", "Dismissed"]);
export const SignalSource = z.enum(["Reddit", "Twitter", "LinkedIn", "Web"]);

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
