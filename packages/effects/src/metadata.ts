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
        scopes: ["background", "button"],
    },
    {
        key: "plasma",
        label: "Plasma Globe",
        description: "Electric arcs with mouse-reactive attractors and HDR bloom",
        defaultColors: ["#7c3aed", "#ec4899", "#6366f1"],
        scopes: ["background", "button"],
    },
    {
        key: "caustics",
        label: "Water Caustics",
        description: "Underwater light patterns using Voronoi noise",
        defaultColors: ["#06b6d4", "#3b82f6"],
        scopes: ["background", "button"],
    },
    {
        key: "cellular",
        label: "Cellular Noise",
        description: "Animated Voronoi cells with glowing edges and colored interiors",
        defaultColors: ["#06b6d4", "#8b5cf6", "#ec4899"],
        scopes: ["background", "button"],
    },
    {
        key: "clouds",
        label: "Clouds",
        description: "Organic flowing patterns via domain-warped fractal noise",
        defaultColors: ["#1e3a5f", "#6366f1", "#06b6d4", "#f0f9ff"],
        scopes: ["background", "button"],
    },
    {
        key: "glow",
        label: "HDR Caustics",
        description: "Domain-warped caustic light patterns with specular tracking",
        defaultColors: ["#6366f1"],
        scopes: ["background", "button"],
    },
    {
        key: "confetti",
        label: "Confetti",
        description: "Celebration particles with gravity, rotation, and fade",
        defaultColors: ["#f59e0b", "#ef4444", "#6366f1", "#10b981"],
        scopes: ["celebration"],
    },
];
