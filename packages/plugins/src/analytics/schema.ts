import { z } from 'zod';

export const AnalyticsSchema = z.object({
    provider: z.enum(['google-analytics', 'plausible', 'custom']),
    trackingId: z.string().min(1),
    domain: z.string().optional(),
    customScript: z.string().optional(),
});

export type AnalyticsAttrs = z.infer<typeof AnalyticsSchema>;
