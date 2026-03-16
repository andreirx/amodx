/**
 * Static pipeline factory map — manually maintained.
 *
 * This is the effects equivalent of RENDER_MAP in @amodx/plugins.
 * When adding a new effect:
 *   1. Create the pipeline class in this directory
 *   2. Create the shader in ../shaders/
 *   3. Add an entry to PIPELINE_MAP below
 *   4. Add metadata to ../metadata.ts
 *
 * Imported only by render-side code (EffectCanvas, GlowCanvas, etc.).
 * Never imported by the root entry — admin bundles don't see this.
 */

import type { EffectPipeline } from "../types.js";

// --- Pipeline imports (add new pipelines here) ---
// import { AuroraPipeline } from "./aurora.js";
// import { PlasmaPipeline } from "./plasma.js";
// import { CausticsPipeline } from "./caustics.js";
// import { GlowPipeline } from "./glow.js";
// import { ConfettiPipeline } from "./confetti.js";

/**
 * Maps effect type key → pipeline factory.
 * Factory creates a fresh instance per EffectCanvas mount.
 *
 * Pipelines are currently stubbed — uncomment imports and entries
 * as each effect is implemented.
 */
export const PIPELINE_MAP: Record<string, () => EffectPipeline> = {
    // aurora:   () => new AuroraPipeline(),
    // plasma:   () => new PlasmaPipeline(),
    // caustics: () => new CausticsPipeline(),
    // glow:     () => new GlowPipeline(),
    // confetti: () => new ConfettiPipeline(),
};

/**
 * Create an effect pipeline instance by type key.
 * Returns null if the key is not registered (unknown effect type).
 */
export function createEffect(key: string): EffectPipeline | null {
    const factory = PIPELINE_MAP[key];
    return factory ? factory() : null;
}
