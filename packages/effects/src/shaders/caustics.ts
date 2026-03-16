/**
 * Water Caustics shader — underwater light patterns.
 *
 * Technique: Voronoi noise with animated cell centers, creating
 * bright caustic lines where Voronoi edges overlap. Simple and
 * performant — single pass, no compute shader needed.
 *
 * Tier adjustments:
 *   - HDR: brighter caustic lines
 *   - Mobile: fewer Voronoi cells
 */

export const CAUSTICS_SHADER = /* wgsl */ `
// Caustics shader — stub
// Will contain Voronoi-based water caustics.
`;
