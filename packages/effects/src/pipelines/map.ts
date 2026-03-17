/**
 * Static pipeline factory map — manually maintained.
 *
 * This is the effects equivalent of RENDER_MAP in @amodx/plugins.
 * When adding a new effect:
 *   1. Create the pipeline class in this directory
 *   2. Create the shader in ../shaders/
 *   3. Add an entry to PIPELINE_MAP below
 *   4. Add metadata to ../metadata.ts
 */

import type { EffectPipeline } from "../types.js";
import { AuroraPipeline } from "./aurora.js";
import { PlasmaPipeline } from "./plasma.js";
import { CausticsPipeline } from "./caustics.js";
import { GlowPipeline } from "./glow.js";
import { CellularPipeline } from "./cellular.js";
import { CloudsPipeline } from "./clouds.js";
import { ConfettiPipeline } from "./confetti.js";
import { Aurora2Pipeline } from "./aurora2.js";
import { FractalsPipeline } from "./fractals.js";
import { FirePipeline } from "./fire.js";
import { BubblesPipeline } from "./bubbles.js";

/**
 * Maps effect type key -> pipeline factory.
 * Factory creates a fresh instance per EffectCanvas mount.
 */
export const PIPELINE_MAP: Record<string, () => EffectPipeline> = {
    aurora:   () => new AuroraPipeline(),
    plasma:   () => new PlasmaPipeline(),
    caustics: () => new CausticsPipeline(),
    glow:     () => new GlowPipeline(),
    cellular: () => new CellularPipeline(),
    clouds:   () => new CloudsPipeline(),
    confetti: () => new ConfettiPipeline(),
    aurora2:  () => new Aurora2Pipeline(),
    fractals: () => new FractalsPipeline(),
    fire:     () => new FirePipeline(),
    bubbles:  () => new BubblesPipeline(),
};

/**
 * Create an effect pipeline instance by type key.
 * Returns null if the key is not registered (unknown effect type).
 */
export function createEffect(key: string): EffectPipeline | null {
    const factory = PIPELINE_MAP[key];
    return factory ? factory() : null;
}
