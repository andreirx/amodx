// GPU effect configuration (for @amodx/effects).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

// ==========================================
// GPU EFFECTS CONFIG (for @amodx/effects)
// ==========================================

// Capability tier detected at runtime by the effects package.
// 'none' means no WebGPU or prefers-reduced-motion — CSS fallback only.
export type GpuTier = 'hdr-edr' | 'hdr-srgb' | 'sdr' | 'none';

// Unified effect config — used for block backgrounds, button overlays, and page effects.
// type is z.string() not z.enum() — open for third-party effect types.
// overlayOpacity is only meaningful when applied as a button overlay (ignored for backgrounds).
export const EffectConfigSchema = z.object({
    type: z.string().default("none"),
    colors: z.array(z.string()).max(4).default([]),
    speed: z.number().min(-3).max(3).default(1),           // negative = reverse animation
    timeOffset: z.number().min(-100).max(100).default(0),  // scrub timeline; useful at speed=0 for frozen frames
    intensity: z.number().min(0).max(0.5).default(0.25),
    invertY: z.boolean().default(false),
    bgColor: z.string().optional(),   // hex color for background; undefined = shader default
    bands: z.number().min(2).max(32).optional(),  // aurora curtain count; undefined = 8
    overlayOpacity: z.number().min(0).max(1.0).default(0.85), // button base-fill opacity when effect active (0 = full effect, 1 = fully opaque)
});
export type EffectConfig = z.infer<typeof EffectConfigSchema>;

// Backward-compat aliases — existing code importing BlockEffectConfig still compiles.
// These are identical to EffectConfigSchema. Migrate consumers to EffectConfig over time.
/** @deprecated Use EffectConfigSchema */
export const BlockEffectConfigSchema = EffectConfigSchema;
/** @deprecated Use EffectConfig */
export type BlockEffectConfig = EffectConfig;

// Legacy glow config — kept for read-path backward compatibility.
// New code should use EffectConfigSchema with type: "glow".
// resolveButtonEffect() in plugin render components converts this format on read.
/** @deprecated Use EffectConfigSchema with type: "glow" */
export const GlowEffectConfigSchema = z.object({
    enabled: z.boolean().default(false),
    color: z.string().default("#6366f1"),
    intensity: z.number().min(0).max(0.5).default(0.25),
});
/** @deprecated Use EffectConfig */
export type GlowEffectConfig = z.infer<typeof GlowEffectConfigSchema>;

// Page-level ambient background effect (TenantConfig).
// Narrowed alias — same shape as EffectConfig but with hard intensity cap at 0.15.
// Full-viewport effects at higher intensity are overwhelming. The schema enforces this.
export const PageEffectConfigSchema = EffectConfigSchema.extend({
    speed: z.number().min(0.1).max(3.0).default(0.5),
    intensity: z.number().min(0).max(0.15).default(0.1),
});
export type PageEffectConfig = z.infer<typeof PageEffectConfigSchema>;
