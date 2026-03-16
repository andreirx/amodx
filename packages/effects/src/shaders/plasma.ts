/**
 * Plasma Globe shader — electric arcs with HDR bloom.
 *
 * Technique: Midpoint displacement for arc geometry (same algorithm as
 * ZapEngine's electric_arc.rs), rendered as line segments with distance-field
 * glow. Arcs attracted toward pointer position.
 *
 * Tier adjustments:
 *   - HDR-EDR: arc core at 6.4x luminance (blooms beyond white)
 *   - Mobile: fewer arc segments, time-based drift instead of pointer tracking
 */

export const PLASMA_SHADER = /* wgsl */ `
// Plasma shader — stub
// Will contain midpoint displacement arc rendering.
`;
