/**
 * Cellular Noise (Worley/Voronoi) — animated organic cells.
 *
 * Technique: Tiled Voronoi distance field (Steven Worley, 1996).
 * Each tile contains one animated feature point. For each pixel,
 * check 3x3 neighborhood of tiles, track F1 (nearest distance)
 * and F2 (second nearest). The difference F2-F1 highlights cell
 * boundaries as thin bright edges.
 *
 * Cell interiors glow softly from their center, colored by palette.
 * Grid scale is controlled by the octaves/bands parameter.
 *
 * Reference: "A Cellular Texture Basis Function" (Worley, 1996)
 * Precision trick from Inigo Quilez — all computations in cell space.
 */

import { LUM_INVERT_WGSL } from "./lum-invert.js";

export const CELLULAR_SHADER = /* wgsl */ `

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

// ─── Hash: deterministic random vec2 per grid cell ───────────────────

fn hash2(p: vec2f) -> vec2f {
    return fract(sin(vec2f(
        dot(p, vec2f(127.1, 311.7)),
        dot(p, vec2f(269.5, 183.3))
    )) * 43758.5453);
}

// ─── Palette color interpolation ─────────────────────────────────────

fn get_color(val: f32) -> vec3f {
    let n = u.num_colors;
    if (n <= 1.0) { return u.color0.rgb; }
    let scaled = clamp(val, 0.0, 1.0) * (n - 1.0);
    let i = u32(floor(scaled));
    let f = fract(scaled);
    var c0: vec3f; var c1: vec3f;
    switch (i) {
        case 0u: { c0 = u.color0.rgb; c1 = u.color1.rgb; }
        case 1u: { c0 = u.color1.rgb; c1 = u.color2.rgb; }
        case 2u: { c0 = u.color2.rgb; c1 = u.color3.rgb; }
        default: { c0 = u.color3.rgb; c1 = u.color3.rgb; }
    }
    return mix(c0, c1, f);
}

// ─── HLS luminosity inversion ────────────────────────────────────────
${LUM_INVERT_WGSL}

// ─── Fragment ────────────────────────────────────────────────────────

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let uv = in.uv;
    let t = u.time * u.speed + u.time_offset;
    let aspect = u.resolution.x / u.resolution.y;

    // Grid scale from bands parameter (default 8 = 8 cells across)
    let scale = max(u.octaves, 2.0);
    let st = vec2f(uv.x * aspect, uv.y) * scale;

    let i_st = floor(st);
    let f_st = fract(st);

    // Track two nearest distances (F1, F2) and nearest cell identity
    var m_dist1 = 1.0;
    var m_dist2 = 1.0;
    var m_point = vec2f(0.0);

    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let neighbor = vec2f(f32(x), f32(y));

            // Random feature point for this cell
            let point = hash2(i_st + neighbor);

            // Animate: each point orbits smoothly within its cell
            let animated = 0.5 + 0.5 * sin(t + 6.2831 * point);

            // Vector from pixel to animated point (in cell space)
            let diff = neighbor + animated - f_st;
            let dist = length(diff);

            // Update F1 and F2
            if (dist < m_dist1) {
                m_dist2 = m_dist1;
                m_dist1 = dist;
                m_point = point;
            } else if (dist < m_dist2) {
                m_dist2 = dist;
            }
        }
    }

    // Pointer influence — cells near pointer bulge inward
    if (u.pointer.x >= 0.0) {
        let mptr = vec2f(u.pointer.x * aspect, u.pointer.y) * scale;
        let ptr_d = distance(st, mptr);
        let influence = exp(-ptr_d * 0.5) * 0.12;
        m_dist1 = max(m_dist1 - influence, 0.0);
    }

    // Edge factor: thin bright lines at cell boundaries
    let edge = 1.0 - smoothstep(0.0, 0.08, m_dist2 - m_dist1);

    // Cell interior glow: exponential falloff from center
    let glow = exp(-m_dist1 * 5.0);

    // Color per cell from palette (based on cell random identity)
    let color_t = m_point.x * 0.6 + m_point.y * 0.4;
    let cell_color = get_color(color_t);

    // Background
    var bg: vec3f;
    if (u.has_bg > 0.5) {
        bg = u.bg_color.rgb;
    } else {
        bg = vec3f(0.005, 0.005, 0.015);
    }

    // Compose: bg + colored interior glow + edge highlights
    var final_color = bg + cell_color * (glow * 0.65 + edge * 0.35) * u.intensity * u.glow_mult;

    // Luminosity inversion
    if (u.invert_y > 0.5) {
        final_color = invert_luminosity(final_color);
    }

    return vec4f(final_color, 1.0);
}
`;
