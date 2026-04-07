import { z } from 'zod';
import { InlineRichTextSchema } from '@amodx/shared';

export const VideoHeroSchema = z.object({
    headline: z.string().default(""),
    subheadline: z.string().default(""),
    subheadlineRich: InlineRichTextSchema.optional(),
    videoSrc: z.string().default(""),
    posterSrc: z.string().optional(),         // fallback image for loading/SSR
    ctaText: z.string().default(""),
    ctaLink: z.string().default("#"),
    overlayOpacity: z.number().min(0).max(1).default(0.4),
    overlayColorToken: z.enum(["auto", "black", "foreground", "primary", "muted", "accent"]).default("auto"),
    headlineColorToken: z.enum(["auto", "white", "foreground", "primary", "primary-foreground", "muted-foreground", "accent-foreground"]).default("auto"),
    subheadlineColorToken: z.enum(["auto", "white", "foreground", "primary", "primary-foreground", "muted-foreground", "accent-foreground"]).default("auto"),
    muted: z.boolean().default(true),
    loop: z.boolean().default(true),
    blockWidth: z.enum(["content", "wide", "full"]).default("full"),
});
