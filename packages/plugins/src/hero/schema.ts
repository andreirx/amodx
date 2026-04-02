import { z } from 'zod';
import { EffectConfigSchema, InlineRichTextSchema } from '@amodx/shared';

export const HeroSchema = z.object({
    headline: z.string().default("Welcome to AMODX"),
    subheadline: z.string().default("The operating system for modern agencies."),
    // Shape B inline rich text — additive field, does not replace subheadline.
    // Render: prefer subheadlineRich if present, else fall back to subheadline.
    // Editor: migration-on-edit writes both fields simultaneously.
    subheadlineRich: InlineRichTextSchema.optional(),
    ctaText: z.string().default("Get Started"),
    ctaLink: z.string().default("/contact"),
    imageSrc: z.string().optional(),
    style: z.enum(["center", "split", "minimal"]).default("center"),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
    effect: EffectConfigSchema.optional(),
    buttonEffect: EffectConfigSchema.optional(),
});
