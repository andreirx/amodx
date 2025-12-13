import { z } from 'zod';

export const HeroSchema = z.object({
    headline: z.string().default("Welcome to AMODX"),
    subheadline: z.string().default("The operating system for modern agencies."),
    ctaText: z.string().default("Get Started"),
    ctaLink: z.string().default("/contact"),
    imageSrc: z.string().optional(),
    style: z.enum(["center", "split", "minimal"]).default("center"),
});
