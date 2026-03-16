import { z } from 'zod';
import { BlockEffectConfigSchema, GlowEffectConfigSchema } from '@amodx/shared';

export const HeroSchema = z.object({
    headline: z.string().default("Welcome to AMODX"),
    subheadline: z.string().default("The operating system for modern agencies."),
    ctaText: z.string().default("Get Started"),
    ctaLink: z.string().default("/contact"),
    imageSrc: z.string().optional(),
    style: z.enum(["center", "split", "minimal"]).default("center"),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
    effect: BlockEffectConfigSchema.optional(),
    glow: GlowEffectConfigSchema.optional(),
});
