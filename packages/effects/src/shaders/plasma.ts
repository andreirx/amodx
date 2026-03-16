/**
 * Plasma Globe — electric arcs with pointer-reactive attractors and HDR bloom.
 *
 * Technique: For each pixel, compute distance to multiple "arc paths."
 * Arc paths are defined as lines between random edge points, distorted
 * by noise to create the jagged lightning look. Glow = inverse distance
 * with high falloff exponent. Arcs warp toward pointer position.
 *
 * On HDR-EDR displays, arc cores exceed 1.0 luminance, creating
 * real physical bloom on capable panels.
 */

import { LUM_INVERT_WGSL } from "./lum-invert.js";

export const PLASMA_SHADER = /* wgsl */ `

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

// --- Hash and noise ---

fn hash(p: f32) -> f32 {
    var x = fract(sin(p * 127.1) * 43758.5453);
    return x;
}

fn hash2(p: vec2f) -> vec2f {
    return fract(sin(vec2f(
        dot(p, vec2f(127.1, 311.7)),
        dot(p, vec2f(269.5, 183.3))
    )) * 43758.5453);
}

fn mod289_3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289_2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute(x: vec3f) -> vec3f { return mod289_3(((x * 34.0) + 10.0) * x); }

fn snoise(v: vec2f) -> f32 {
    let C = vec4f(0.211324865405187, 0.366025403784439,
                  -0.577350269189626, 0.024390243902439);
    let i = floor(v + dot(v, C.yy));
    let x0 = v - i + dot(i, C.xx);
    let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
    let x12 = vec4f(x0 - i1 + C.xx, x0 + C.zz);
    let ii = mod289_2(i);
    let p = permute(permute(
        ii.y + vec3f(0.0, i1.y, 1.0)) +
        ii.x + vec3f(0.0, i1.x, 1.0));
    var m = max(vec3f(0.5) - vec3f(
        dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
    m = m * m; m = m * m;
    let x_g = 2.0 * fract(p * C.www) - 1.0;
    let h = abs(x_g) - 0.5;
    let ox = floor(x_g + 0.5);
    let a0 = x_g - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    let g = vec3f(a0.x * x0.x + h.x * x0.y,
                  a0.y * x12.x + h.y * x12.y,
                  a0.z * x12.z + h.z * x12.w);
    return 130.0 * dot(m, g);
}

// --- Arc rendering ---

// Compute electric arc glow from a pixel to a noise-distorted line.
// Returns brightness (can exceed 1.0 for HDR).
fn arc_glow(uv: vec2f, a: vec2f, b: vec2f, seed: f32, t: f32) -> f32 {
    let ab = b - a;
    let ab_len = length(ab);
    if (ab_len < 0.001) { return 0.0; }
    let ab_dir = ab / ab_len;
    let ap = uv - a;
    let proj = clamp(dot(ap, ab_dir), 0.0, ab_len);
    let param = proj / ab_len;

    // Noise displacement perpendicular to arc
    let perp = vec2f(-ab_dir.y, ab_dir.x);
    var displacement = 0.0;
    displacement += snoise(vec2f(param * 4.0 + seed, t * 2.0)) * 0.08;
    displacement += snoise(vec2f(param * 8.0 + seed + 50.0, t * 3.5)) * 0.03;
    displacement += snoise(vec2f(param * 16.0 + seed + 100.0, t * 6.0)) * 0.01;

    let arc_point = a + ab_dir * proj + perp * displacement;
    let dist = distance(uv, arc_point);

    // Sharp glow falloff — thin bright core, soft halo
    let core = exp(-dist * 120.0);
    let halo = exp(-dist * 30.0) * 0.3;
    return core + halo;
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
    let p = vec2f(uv.x * aspect, uv.y);

    // Center and pointer (or center if no pointer)
    let center = vec2f(0.5 * aspect, 0.5);
    var attractor = center;
    if (u.pointer.x >= 0.0) {
        attractor = vec2f(u.pointer.x * aspect, u.pointer.y);
    }

    // Generate multiple arcs
    let num_arcs = select(3u, 5u, u.octaves > 3.0);
    var total_glow = 0.0;
    var color_accum = vec3f(0.0);

    for (var i = 0u; i < num_arcs; i = i + 1u) {
        let fi = f32(i);
        let seed = fi * 37.7 + t * 0.5;

        // Arc endpoints: random positions on edges, drifting over time
        let angle_a = hash(fi * 13.1 + floor(t * 0.3)) * 6.283;
        let angle_b = hash(fi * 27.3 + floor(t * 0.3 + 0.5)) * 6.283;
        let edge_a = center + vec2f(cos(angle_a), sin(angle_a)) * 0.45;

        // Second endpoint attracted toward pointer/center
        let edge_b = mix(
            center + vec2f(cos(angle_b), sin(angle_b)) * 0.3,
            attractor,
            0.6
        );

        let glow = arc_glow(p, edge_a, edge_b, seed, t);
        let color = get_color(fi / f32(num_arcs));
        total_glow += glow;
        color_accum += color * glow;
    }

    // Ambient glow around center
    let center_dist = distance(p, center);
    let ambient = exp(-center_dist * 3.0) * 0.05;

    // Compose
    let final_glow = total_glow * u.intensity * u.glow_mult;
    var final_color = vec3f(0.0);
    if (total_glow > 0.001) {
        final_color = (color_accum / total_glow) * final_glow;
    }
    final_color += u.color0.rgb * ambient * u.glow_mult;

    // Luminosity inversion: preserve hue & saturation, flip lightness
    if (u.invert_y > 0.5) {
        final_color = invert_luminosity(final_color);
    }

    return vec4f(final_color, 1.0);
}
`;
