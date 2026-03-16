/**
 * @amodx/effects — Root entry point
 *
 * Safe for ALL consumers (admin, renderer, third-party packages).
 * Contains NO GPU code, NO React components, NO shader strings.
 *
 * Exports:
 *   - EffectPipeline interface (for implementing new effects)
 *   - EffectMetadata interface (for describing effects)
 *   - PipelineConfig interface (for pipeline init)
 *   - EFFECT_LIST constant (for admin dropdowns)
 *   - detectGpuTier() (lazy, cached, SSR-safe)
 *   - prefersReducedMotion() (synchronous check)
 *   - isMobileDevice() (for pipeline complexity reduction)
 *
 * GPU components are in separate entry points:
 *   @amodx/effects/render      → EffectCanvas, GlowCanvas, PageEffectLayer
 *   @amodx/effects/celebration → CelebrationOverlay
 */

// Types
export type { EffectPipeline, EffectMetadata, PipelineConfig } from "./types.js";

// Re-export the shared GpuTier type for convenience
export type { GpuTier } from "@amodx/shared";

// Static metadata (no GPU code — just strings and arrays)
export { EFFECT_LIST } from "./metadata.js";

// Detection (lazy, cached, SSR-safe)
export { detectGpuTier, prefersReducedMotion, isMobileDevice } from "./detection.js";
