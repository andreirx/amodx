/**
 * Static effect metadata — manually maintained.
 *
 * This is the effects equivalent of the plugins REGISTRY array.
 * When adding a new effect:
 *   1. Add an entry here
 *   2. Add a pipeline factory in pipelines/map.ts
 *   3. Add a shader in shaders/
 *
 * This file is imported by the ROOT entry point (@amodx/effects),
 * which means admin bundles can import it without pulling in GPU code.
 */

import type { EffectMetadata } from "./types.js";

export const EFFECT_LIST: EffectMetadata[] = [
    {
        key: "aurora",
        label: "Aurora Borealis",
        description: "Flowing bands of color using noise-based animation",
        defaultColors: ["#6366f1", "#8b5cf6", "#06b6d4"],
        scopes: ["background"],
    },
    {
        key: "plasma",
        label: "Plasma Globe",
        description: "Electric arcs with mouse-reactive attractors and HDR bloom",
        defaultColors: ["#7c3aed", "#ec4899", "#6366f1"],
        scopes: ["background", "glow"],
    },
    {
        key: "caustics",
        label: "Water Caustics",
        description: "Underwater light patterns using Voronoi noise",
        defaultColors: ["#06b6d4", "#3b82f6"],
        scopes: ["background"],
    },
    {
        key: "glow",
        label: "HDR Glow",
        description: "Pulsating bloom that exceeds sRGB on capable displays",
        defaultColors: ["#6366f1"],
        scopes: ["glow"],
    },
    {
        key: "confetti",
        label: "Confetti",
        description: "Celebration particles with gravity, rotation, and fade",
        defaultColors: ["#f59e0b", "#ef4444", "#6366f1", "#10b981"],
        scopes: ["celebration"],
    },
];
