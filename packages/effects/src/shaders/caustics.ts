/**
 * Water Caustics — animated Voronoi cells creating underwater light patterns.
 *
 * Technique: Compute Voronoi distance field with animated cell centers.
 * Two overlapping Voronoi layers at different scales create interference
 * patterns that mimic underwater caustic light refraction.
 *
 * Bright lines form where cell boundaries from different layers overlap.
 */

import { LUM_INVERT_WGSL } from "./lum-invert.js";

export const CAUSTICS_SHADER = /* wgsl */ `

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

// --- Hash for Voronoi ---

fn hash2(p: vec2f) -> vec2f {
    let q = vec2f(dot(p, vec2f(127.1, 311.7)),
                  dot(p, vec2f(269.5, 183.3)));
    return fract(sin(q) * 43758.5453);
}

// --- Voronoi distance field with animated centers ---

fn voronoi(p: vec2f, t: f32, scale: f32) -> f32 {
    let uv = p * scale;
    let cell = floor(uv);
    let frac = fract(uv);

    var min_dist = 1.0;

    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let neighbor = vec2f(f32(x), f32(y));
            let point = hash2(cell + neighbor);
            // Animate cell center in a circular orbit
            let animated = point + 0.35 * sin(t + point * 6.283);
            let diff = neighbor + animated - frac;
            min_dist = min(min_dist, dot(diff, diff));
        }
    }

    return sqrt(min_dist);
}

// --- Color ---

fn get_color(t: f32) -> vec3f {
    let n = u.num_colors;
    if (n <= 1.0) { return u.color0.rgb; }
    let scaled = clamp(t, 0.0, 1.0) * (n - 1.0);
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

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let uv = in.uv;
    let t = u.time * u.speed;
    let aspect = u.resolution.x / u.resolution.y;
    var p = vec2f(uv.x * aspect, uv.y);

    // Pointer ripple influence
    if (u.pointer.x >= 0.0) {
        let mptr =vec2f(u.pointer.x * aspect, u.pointer.y);
        let d = distance(p, mptr);
        let ripple = sin(d * 30.0 - t * 5.0) * exp(-d * 4.0) * 0.02;
        p += normalize(p - mptr) * ripple;
    }

    // Two Voronoi layers at different scales and speeds
    let v1 = voronoi(p, t * 0.8, 5.0);
    let v2 = voronoi(p + vec2f(3.7, 1.3), t * 1.1, 7.0);

    // Third layer for detail (desktop only)
    var v3 = 0.5;
    if (u.octaves > 3.0) {
        v3 = voronoi(p + vec2f(7.1, 5.9), t * 0.6, 11.0);
    }

    // Caustic brightness: multiply layers — bright where edges overlap
    let caustic = v1 * v2 * v3;

    // Invert and sharpen: thin bright lines
    let bright = pow(1.0 - caustic, 3.0);

    // Color from palette based on spatial position
    let color_t = (sin(p.x * 2.0 + t * 0.2) * 0.5 + 0.5) * 0.7 + bright * 0.3;
    let color = get_color(color_t);

    // Background: dark tinted water
    let bg = u.color0.rgb * 0.03;
    var final_color = bg + color * bright * u.intensity * u.glow_mult;

    // Luminosity inversion: preserve hue & saturation, flip lightness
    if (u.invert_y > 0.5) {
        final_color = invert_luminosity(final_color);
    }

    return vec4f(final_color, 1.0);
}
`;
