/**
 * Clouds — domain-warped fractal Brownian motion.
 *
 * Technique: Value noise layered into fBM (fractal Brownian Motion)
 * with triple domain warping: f(p) = fbm(p + fbm(p + fbm(p))).
 * This creates organic, flowing cloud-like patterns with self-similar
 * structure at multiple scales.
 *
 * Each fBM pass applies a rotation matrix to reduce axial bias
 * (grid-aligned artifacts), following the approach from
 * Patricio Gonzalez Vivo (The Book of Shaders) and Inigo Quilez.
 *
 * The octaves/bands parameter controls fBM octave count (2-8 meaningful,
 * higher adds imperceptible detail). More octaves = finer grain.
 *
 * Reference: "Warping" (Inigo Quilez, 2002)
 *   f(p) = fbm( p + fbm( p + fbm( p ) ) )
 */

import { LUM_INVERT_WGSL } from "./lum-invert.js";

export const CLOUDS_SHADER = /* wgsl */ `

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

// ─── Value noise (hash-based, bilinear interpolation) ────────────────

fn hash_v(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453123);
}

fn value_noise(st: vec2f) -> f32 {
    let i = floor(st);
    let f = fract(st);

    // Hermite interpolation (smoothstep) to remove grid artifacts
    let w = f * f * (3.0 - 2.0 * f);

    let a = hash_v(i);
    let b = hash_v(i + vec2f(1.0, 0.0));
    let c = hash_v(i + vec2f(0.0, 1.0));
    let d = hash_v(i + vec2f(1.0, 1.0));

    return mix(a, b, w.x) + (c - a) * w.y * (1.0 - w.x) + (d - b) * w.x * w.y;
}

// ─── fBM with rotation to reduce axial bias ──────────────────────────
// Rotation matrix: cos(0.5), sin(0.5) ≈ 28.6 degrees — breaks grid alignment.
// Each octave: double frequency, halve amplitude (lacunarity=2, gain=0.5).

const ROT_C: f32 = 0.8775825619;  // cos(0.5)
const ROT_S: f32 = 0.4794255386;  // sin(0.5)
const SHIFT: vec2f = vec2f(100.0, 100.0);

fn fbm(st_in: vec2f) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var st = st_in;
    let max_oct = u32(clamp(u.octaves, 2.0, 10.0));

    for (var i = 0u; i < 10u; i = i + 1u) {
        if (i >= max_oct) { break; }
        v += a * value_noise(st);
        // Rotate, scale, shift
        st = vec2f(st.x * ROT_C + st.y * ROT_S,
                   -st.x * ROT_S + st.y * ROT_C) * 2.0 + SHIFT;
        a *= 0.5;
    }
    return v;
}

// ─── HLS luminosity inversion ────────────────────────────────────────
${LUM_INVERT_WGSL}

// ─── Fragment ────────────────────────────────────────────────────────

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let uv = in.uv;
    let t = u.time * u.speed;
    let aspect = u.resolution.x / u.resolution.y;
    let st = vec2f(uv.x * aspect, uv.y) * 3.0;

    // ── Triple domain warping (Inigo Quilez, 2002) ───────────────
    //
    //   q = fbm(p)
    //   r = fbm(p + q)
    //   f = fbm(p + r)
    //
    // Each layer uses different offsets and time factors to prevent
    // symmetry and create organic flowing motion.

    var q = vec2f(0.0);
    q.x = fbm(st + t * 0.04);
    q.y = fbm(st + vec2f(1.0, 1.0));

    var r = vec2f(0.0);
    r.x = fbm(st + q + vec2f(1.7, 9.2) + t * 0.15);
    r.y = fbm(st + q + vec2f(8.3, 2.8) + t * 0.126);

    let f = fbm(st + r);

    // ── Color mapping from palette ───────────────────────────────
    // Three mix layers using f, q, r to create rich color variation.
    var color = mix(u.color0.rgb, u.color1.rgb, clamp(f * f * 4.0, 0.0, 1.0));

    if (u.num_colors > 2.0) {
        color = mix(color, u.color2.rgb, clamp(length(q), 0.0, 1.0));
    }
    if (u.num_colors > 3.0) {
        color = mix(color, u.color3.rgb, clamp(length(r.x), 0.0, 1.0));
    }

    // ── Background ───────────────────────────────────────────────
    var bg: vec3f;
    if (u.has_bg > 0.5) {
        bg = u.bg_color.rgb;
    } else {
        bg = vec3f(0.005, 0.005, 0.015);
    }

    // ── Brightness shaping ───────────────────────────────────────
    // Cubic + quadratic + linear blend gives soft cloud-like density.
    let brightness = f * f * f + 0.6 * f * f + 0.5 * f;

    var final_color = bg + color * brightness * u.intensity * u.glow_mult;

    // ── Pointer influence: gentle brightening near cursor ─────────
    if (u.pointer.x >= 0.0) {
        let mptr = vec2f(u.pointer.x * aspect, u.pointer.y);
        let p_uv = vec2f(uv.x * aspect, uv.y);
        let ptr_d = distance(p_uv, mptr);
        let ptr_glow = exp(-ptr_d * 4.0) * 0.08;
        final_color += u.color0.rgb * ptr_glow * u.glow_mult;
    }

    // ── Luminosity inversion ─────────────────────────────────────
    if (u.invert_y > 0.5) {
        final_color = invert_luminosity(final_color);
    }

    return vec4f(final_color, 1.0);
}
`;
