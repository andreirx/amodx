import { z } from 'zod';
import { EffectConfigSchema, InlineRichTextSchema } from '@amodx/shared';

// The text colour tokens of the hero (resolved by `resolveTextClass`, `common/resolveCoverColorTokens.ts`). One enum for
// the three fields that take a text colour: the cover headline, the cover subheadline and the headline accent.
const HeroTextColorToken = z.enum(["auto", "white", "foreground", "primary", "primary-foreground", "muted-foreground", "accent-foreground"]);

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
    style: z.enum(["center", "split", "minimal", "cover"]).default("center"),
    overlayOpacity: z.number().min(0).max(1).default(0.5),  // cover mode: overlay opacity
    // Cover mode color tokens — semantic IDs resolved to CSS at render time.
    // "auto" preserves current defaults (black overlay, white text).
    overlayColorToken: z.enum(["auto", "black", "foreground", "primary", "muted", "accent"]).default("auto"),
    headlineColorToken: HeroTextColorToken.default("auto"),
    subheadlineColorToken: HeroTextColorToken.default("auto"),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
    effect: EffectConfigSchema.optional(),
    buttonEffect: EffectConfigSchema.optional(),
    // SHOP-LOOK-1B (docs/slices/shop-look-1.md § 4.2). Every field optional, no default: absent (or null, as Tiptap
    // stores a cleared attribute) renders today's HTML (§ 4). Blank texts render as absent.
    eyebrow: z.string().optional(),                          // small pill label above the headline; every style
    headlineAccent: z.string().optional(),                   // second tone inside the <h1>, after the headline; every style
    headlineAccentColorToken: HeroTextColorToken.optional(), // read only with headlineAccent; absent/auto → text-primary
    secondaryCtaText: z.string().optional(),                 // outline button beside the first; center, split, cover
    secondaryCtaLink: z.string().optional(),
    stats: z.array(z.object({ value: z.string().max(12), label: z.string().max(40) })).max(4).optional(), // center, split, cover
    buttonShape: z.enum(["rounded", "pill"]).optional(),     // pill → both buttons rounded-full
    splitPanel: z.enum(["plain", "inverse"]).optional(),     // inverse → dark text panel; style split only (§ 6.5)
});
