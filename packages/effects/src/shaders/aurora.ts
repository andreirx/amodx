/**
 * Aurora Borealis shader — flowing bands of color using layered noise.
 *
 * Technique: Fragment shader with multiple octaves of simplex noise,
 * scrolling at different speeds and directions to create flowing curtains.
 * Color is interpolated between config colors based on noise value.
 *
 * Tier adjustments:
 *   - HDR-EDR: output values >1.0 for bloom effect
 *   - Mobile: reduce octave count from 5→2
 *
 * Uniforms:
 *   time       - elapsed seconds
 *   resolution - canvas pixel dimensions
 *   pointer    - normalized mouse position (ignored on mobile)
 *   color0..3  - up to 4 configurable colors
 *   speed      - animation speed multiplier
 *   intensity  - brightness multiplier
 *   glowMult   - tier-based glow multiplier
 *   octaves    - noise octave count (5 desktop, 2 mobile)
 */

export const AURORA_SHADER = /* wgsl */ `
// Aurora shader — stub
// Will contain vertex + fragment entry points.
// Placeholder until implementation.

struct Uniforms {
    time: f32,
    resolution: vec2f,
    pointer: vec2f,
    speed: f32,
    intensity: f32,
    glow_mult: f32,
    octaves: f32,
    color0: vec3f,
    _pad0: f32,
    color1: vec3f,
    _pad1: f32,
    color2: vec3f,
    _pad2: f32,
    color3: vec3f,
    _pad3: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

// Fullscreen triangle (3 vertices, no vertex buffer needed)
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32(i32(vi) - 1);
    let y = f32(i32(vi & 1u) * 2 - 1);
    out.position = vec4f(x, y, 0.0, 1.0);
    out.uv = vec2f(x, y) * 0.5 + 0.5;
    return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    // Stub: renders a gradient using config colors
    let t = in.uv.y;
    let color = mix(u.color0, u.color1, t);
    return vec4f(color * u.intensity, 1.0);
}
`;
