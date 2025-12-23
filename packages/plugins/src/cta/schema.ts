import { z } from 'zod';

export const CtaSchema = z.object({
    headline: z.string().default("Ready to get started?"),
    subheadline: z.string().default("Join the Founder's Circle today."),
    buttonText: z.string().default("Get Access"),
    buttonLink: z.string().default("/pricing"),
    style: z.enum(["simple", "card", "band"]).default("simple"),
});
