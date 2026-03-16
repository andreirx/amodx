/**
 * HDR Glow shader — pulsating bloom for CTA buttons.
 *
 * Technique: Distance from button edge → glow falloff curve.
 * On HDR-EDR displays, output exceeds 1.0 — the display renders
 * this as physically brighter pixels, creating a real bloom effect
 * that CSS box-shadow cannot achieve.
 *
 * Desktop: glow intensifies toward pointer, arcs (midpoint displacement)
 * connect from button edge to cursor.
 * Mobile: slow time-based pulse.
 */

export const GLOW_SHADER = /* wgsl */ `
// Glow shader — stub
// Will contain button glow + optional arc rendering.
`;
