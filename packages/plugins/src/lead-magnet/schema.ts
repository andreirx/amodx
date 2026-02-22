import { z } from 'zod';

export const LeadMagnetSchema = z.object({
    headline: z.string().default("Unlock Resource"),
    description: z.string().default("Enter your email to download."),
    buttonText: z.string().default("Unlock"),
    // This ID comes from your Resources Page in Admin
    resourceId: z.string().default(""),
    tags: z.string().default("lead-magnet"),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
