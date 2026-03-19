/**
 * Aurora 2 — smooth flowing aurora with fractal noise.
 *
 * Technique: Fractal noise (4-octave value noise with hermite interpolation)
 * generates three independent aurora layers positioned at different vertical
 * bands. Each layer flows horizontally at different speeds. Wave distortion
 * adds organic movement. Vertical positioning uses smoothstep windows to
 * confine each layer to its band.
 *
 * Color: Vertical gradient through 4 palette colors (green -> blue -> purple -> cyan).
 * Atmospheric horizon glow adds depth.
 *
 * Original WGSL implementation. Mathematical techniques (fBM, smoothstep
 * banding, wave distortion) are standard shader algorithms.
 */

import { LUM_INVERT_WGSL } from "./lum-invert.js";

export const AURORA2_SHADER = /* wgsl */ `

struct Uniforms {
    time: f32,
    speed: f32,
    intensity: f32,
    glow_mult: f32,
    resolution: vec2f,
    pointer: vec2f,
    octaves: f32,
    num_colors: f32,
    invert_y: f32,
    has_bg: f32,
    color0: vec4f,
    color1: vec4f,
    color2: vec4f,
    color3: vec4f,
    bg_color: vec4f,
    time_offset: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32(i32(vi & 1u)) * 4.0 - 1.0;
    let y = f32(i32(vi >> 1u)) * 4.0 - 1.0;
    out.position = vec4f(x, y, 0.0, 1.0);
    out.uv = vec2f((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
    return out;
}

// ─── Value noise (hash + hermite interpolation) ──────────────────────

fn hash_a2(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn smooth_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let w = f * f * (3.0 - 2.0 * f);

    let a = hash_a2(i);
    let b = hash_a2(i + vec2f(1.0, 0.0));
    let c = hash_a2(i + vec2f(0.0, 1.0));
    let d = hash_a2(i + vec2f(1.0, 1.0));

    return mix(a, b, w.x) + (c - a) * w.y * (1.0 - w.x) + (d - b) * w.x * w.y;
}

fn fractal_noise(p_in: vec2f) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var p = p_in;
    let max_oct = u32(clamp(u.octaves, 2.0, 8.0));

    for (var i = 0u; i < 8u; i = i + 1u) {
        if (i >= max_oct) { break; }
        value += amplitude * smooth_noise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// ─── Vertical color gradient through palette ─────────────────────────
// Maps vertical position to a blend of up to 4 palette colors.
// Bottom -> color0, lower-mid -> color1, upper-mid -> color2, top -> color3.

fn aurora_palette(y: f32) -> vec3f {
    let t1 = smoothstep(0.2, 0.4, y);
    let t2 = smoothstep(0.4, 0.6, y);
    let t3 = smoothstep(0.6, 0.8, y);

    var col = u.color0.rgb;
    col = mix(col, u.color1.rgb, t1);

    if (u.num_colors > 2.0) {
        col = mix(col, u.color2.rgb, t2);
    }
    if (u.num_colors > 3.0) {
        col = mix(col, u.color3.rgb, t3);
    }

    return col;
}

// ─── HLS luminosity inversion ────────────────────────────────────────
${LUM_INVERT_WGSL}

// ─── Fragment ────────────────────────────────────────────────────────

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let uv = in.uv;
    let t = u.time * u.speed + u.time_offset;
    let aspect = u.resolution.x / u.resolution.y;

    // ── Vertical gradient for aurora vertical confinement ──────────
    // Concentrates effect in upper 60% of frame, fading at edges
    let vert_grad = 1.0 - abs(uv.y - 0.5) * 2.0;
    let vert_env = pow(vert_grad, 1.2);

    // ── Flowing UV with horizontal drift ──────────────────────────
    let flow_uv = vec2f(uv.x * aspect + t * 0.1, uv.y);

    // ── Three aurora layers at different frequencies & speeds ──────
    // Each layer uses different noise scales and time offsets to
    // create the characteristic multi-band aurora structure.
    let a1 = fractal_noise(flow_uv * 3.0 + vec2f(t * 0.2, 0.0));
    let a2 = fractal_noise(flow_uv * 2.0 + vec2f(t * 0.15, 1000.0));
    let a3 = fractal_noise(flow_uv * 4.0 + vec2f(t * 0.25, 2000.0));

    // ── Wave distortion for organic movement ──────────────────────
    let wave1 = sin(uv.x * aspect * 8.0 + t * 2.0) * 0.1;
    let wave2 = sin(uv.x * aspect * 12.0 + t * 1.5) * 0.05;
    let distorted_y = uv.y + wave1 + wave2;

    // ── Vertical band positioning per layer ───────────────────────
    // Each layer is confined to a different vertical band via
    // smoothstep windows. This creates the layered aurora look.
    var layer1 = a1 * smoothstep(0.3, 0.7, distorted_y) * smoothstep(0.8, 0.6, distorted_y);
    var layer2 = a2 * smoothstep(0.4, 0.6, distorted_y) * smoothstep(0.7, 0.5, distorted_y);
    var layer3 = a3 * smoothstep(0.35, 0.65, distorted_y) * smoothstep(0.75, 0.55, distorted_y);

    let combined = (layer1 * 0.6 + layer2 * 0.8 + layer3 * 0.4) * vert_env;

    // ── Color from palette ────────────────────────────────────────
    var aurora_col = aurora_palette(uv.y) * combined;

    // ── Pointer influence: gentle brightening near cursor ─────────
    if (u.pointer.x >= 0.0) {
        let mptr = vec2f(u.pointer.x * aspect, u.pointer.y);
        let p_uv = vec2f(uv.x * aspect, uv.y);
        let ptr_d = distance(p_uv, mptr);
        let ptr_glow = exp(-ptr_d * 3.0) * 0.12;
        aurora_col += aurora_palette(u.pointer.y) * ptr_glow;
    }

    // ── Atmospheric horizon glow ──────────────────────────────────
    let horizon_glow = exp(-abs(uv.y - 0.5) * 8.0) * 0.1;
    aurora_col += aurora_col * horizon_glow;

    // ── Apply intensity + HDR glow multiplier ─────────────────────
    aurora_col *= u.intensity * u.glow_mult;

    // ── Background ────────────────────────────────────────────────
    var color: vec3f;
    if (u.has_bg > 0.5) {
        color = u.bg_color.rgb;
    } else {
        // Deep dark background with subtle blue tint
        color = vec3f(0.003, 0.005, 0.02);
    }

    color += aurora_col;
    color = max(color, vec3f(0.0));

    // ── Luminosity inversion ──────────────────────────────────────
    if (u.invert_y > 0.5) {
        color = invert_luminosity(color);
    }

    return vec4f(color, 1.0);
}
`;
