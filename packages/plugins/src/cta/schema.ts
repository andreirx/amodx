import { z } from 'zod';
import { BlockEffectConfigSchema, GlowEffectConfigSchema } from '@amodx/shared';

export const CtaSchema = z.object({
    headline: z.string().default("Ready to get started?"),
    subheadline: z.string().default("Join the Founder's Circle today."),
    buttonText: z.string().default("Get Access"),
    buttonLink: z.string().default("/pricing"),
    style: z.enum(["simple", "card", "band"]).default("simple"),
    blockWidth: z.enum(["content", "wide", "full"]).default("full"),
    effect: BlockEffectConfigSchema.optional(),
    glow: GlowEffectConfigSchema.optional(),
});
