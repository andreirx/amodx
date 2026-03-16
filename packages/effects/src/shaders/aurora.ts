/**
 * Aurora Borealis — vertical curtain ribbons with realistic structure.
 *
 * Technique: Each curtain is a 1D curve whose x-position varies with height
 * via layered noise (slow sway + medium ripple + fine flutter). Brightness
 * is inverse-distance from the curtain line with three glow layers:
 *   - Core:  very thin, bright center line
 *   - Inner: medium-width glow halo
 *   - Outer: wide, soft ambient light
 *
 * Vertical envelope concentrates the aurora in the upper portion of the
 * frame with a bright "lower hem" and diffuse upward fade — matching real
 * aurora structure where excited particles create a sharp lower edge.
 *
 * Color is a vertical gradient: color0 (bottom/green) → color1 (top/purple).
 * Additional palette colors tint individual curtains for variety.
 *
 * Background: dark blue-black sky with sparse twinkling star field.
 *
 * Simplex noise: Ashima Arts (Ian McEwan, Stefan Gustavson).
 */

import { LUM_INVERT_WGSL } from "./lum-invert.js";

export const AURORA_SHADER = /* wgsl */ `

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

// ─── Simplex 2D noise (Ashima Arts) ──────────────────────────────────

fn mod289_3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289_2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute(x: vec3f) -> vec3f { return mod289_3(((x * 34.0) + 10.0) * x); }

fn snoise(v: vec2f) -> f32 {
    let C = vec4f(0.211324865405187, 0.366025403784439,
                  -0.577350269189626, 0.024390243902439);
    let i  = floor(v + dot(v, C.yy));
    let x0 = v - i + dot(i, C.xx);
    let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
    let x12 = vec4f(x0 - i1 + C.xx, x0 + C.zz);
    let ii = mod289_2(i);
    let p  = permute(permute(
        ii.y + vec3f(0.0, i1.y, 1.0)) +
        ii.x + vec3f(0.0, i1.x, 1.0));
    var m = max(vec3f(0.5) - vec3f(
        dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
    m = m * m;
    m = m * m;
    let x_g = 2.0 * fract(p * C.www) - 1.0;
    let h   = abs(x_g) - 0.5;
    let ox  = floor(x_g + 0.5);
    let a0  = x_g - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    let g = vec3f(
        a0.x * x0.x + h.x * x0.y,
        a0.y * x12.x + h.y * x12.y,
        a0.z * x12.z + h.z * x12.w);
    return 130.0 * dot(m, g);
}

// ─── Star field hash ─────────────────────────────────────────────────

fn hash_star(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

// ─── Curtain x-position at height y ──────────────────────────────────
// Three noise octaves create the characteristic ribbon shape:
//   slow sway (whole curtain drifts) + medium ripple + fine flutter.

fn curtain_x(y: f32, base: f32, t: f32, seed: f32) -> f32 {
    var cx = base;
    cx += snoise(vec2f(y * 0.8 + seed, t * 0.12)) * 0.22;
    cx += snoise(vec2f(y * 2.5 + seed + 47.0, t * 0.45)) * 0.08;
    cx += snoise(vec2f(y * 6.0 + seed + 91.0, t * 0.9))  * 0.025;
    return cx;
}

// ─── Single curtain brightness ───────────────────────────────────────
// Three glow layers: tight core, medium inner halo, wide outer ambient.
// sharpness controls overall curtain thinness (higher = thinner).

fn curtain_glow(px: f32, py: f32, base: f32, t: f32, seed: f32, sharpness: f32) -> f32 {
    let cx = curtain_x(py, base, t, seed);
    let d  = abs(px - cx);
    let core  = exp(-d * sharpness);
    let inner = exp(-d * sharpness * 0.30) * 0.45;
    let outer = exp(-d * sharpness * 0.08) * 0.12;
    return core + inner + outer;
}

// ─── Vertical envelope ───────────────────────────────────────────────
// Shapes the aurora band vertically.  UV: y=0 top, y=1 bottom.
// Aurora hangs from above: bright lower hem ≈ y 0.50–0.60,
// diffusing upward.  Nothing below y 0.75 or above y 0.05.

fn envelope(y: f32) -> f32 {
    let lower = smoothstep(0.78, 0.58, y);   // sharp bottom cutoff
    let upper = smoothstep(0.02, 0.10, y);   // fade near very top
    // Gaussian peak in the bright-hem zone
    let peak = exp(-pow((y - 0.50) * 3.0, 2.0));
    return lower * upper * (0.55 + peak * 0.45);
}

// ─── Vertical color gradient ─────────────────────────────────────────
// Bottom of band → color0 (typically green).
// Top of band → color1 (typically purple/magenta).
// Per-curtain tints from color2/color3 add variety.

fn aurora_color(y: f32, ci: f32) -> vec3f {
    let grad = smoothstep(0.62, 0.12, y);  // 0 at bottom, 1 at top
    var col = mix(u.color0.rgb, u.color1.rgb, grad);

    if (u.num_colors > 2.0 && ci >= 2.0) {
        col = mix(col, u.color2.rgb, 0.25);
    }
    if (u.num_colors > 3.0 && ci >= 3.0) {
        col = mix(col, u.color3.rgb, 0.25);
    }
    return col;
}

// ─── HLS luminosity inversion ────────────────────────────────────────
${LUM_INVERT_WGSL}

// ─── Fragment ────────────────────────────────────────────────────────

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    var uv = in.uv;
    let t  = u.time * u.speed;
    let aspect = u.resolution.x / u.resolution.y;
    var px = uv.x * aspect;
    let py = uv.y;

    // Pointer influence: curtains lean gently toward mouse
    if (u.pointer.x >= 0.0) {
        let mx = u.pointer.x * aspect;
        px += (mx - px) * 0.025;
    }

    // ── Sky background ──────────────────────────────────────────
    // Custom bg color if set, otherwise deep blue-black with vertical gradient
    var color: vec3f;
    if (u.has_bg > 0.5) {
        color = u.bg_color.rgb;
    } else {
        let sky_g = py * 0.006;
        color = vec3f(0.003 + sky_g * 0.5,
                      0.005 + sky_g * 0.7,
                      0.016 + sky_g * 2.0);
    }

    // ── Star field ──────────────────────────────────────────────
    let star_cell = floor(uv * vec2f(200.0, 120.0));
    let sh = hash_star(star_cell);
    if (sh > 0.9965) {
        let twinkle = sin(t * (1.2 + sh * 4.0) + sh * 80.0) * 0.25 + 0.75;
        let star_b  = (sh - 0.9965) / (1.0 - 0.9965);  // 0..1 rarity ramp
        color += vec3f(star_b * twinkle * 0.45);
    }

    // ── Aurora curtains ─────────────────────────────────────────
    let env    = envelope(py);
    let cx     = aspect * 0.5;  // horizontal center
    let spread = aspect * 0.22; // distance between adjacent curtains

    let num_bands = u32(clamp(u.octaves, 2.0, 32.0));
    let half_bands = f32(num_bands) * 0.5;

    var aurora = vec3f(0.0);
    for (var i = 0u; i < 32u; i = i + 1u) {
        if (i >= num_bands) { break; }
        let fi   = f32(i);
        let base = cx + (fi - half_bands + 0.5) * spread;
        let seed = fi * 31.7;
        // Slight sharpness variation per curtain
        let sharp = 85.0 + fi * 5.0;
        let glow  = curtain_glow(px, py, base, t, seed, sharp);
        aurora   += aurora_color(py, fi) * glow * env;
    }

    // ── Vertical ray striations at the bright lower hem ─────────
    // High-frequency brightness modulation along x in the hem zone
    let ray_n   = snoise(vec2f(px * 18.0, t * 0.25 + py * 2.0)) * 0.5 + 0.5;
    let ray_env = smoothstep(0.65, 0.52, py) * smoothstep(0.38, 0.48, py);
    aurora *= 1.0 + ray_n * ray_env * 0.25;

    // ── Luminance shimmer ───────────────────────────────────────
    let shimmer = snoise(vec2f(px * 0.6 + t * 0.07, t * 0.035)) * 0.12 + 1.0;
    aurora *= shimmer;

    // ── Apply intensity + HDR glow multiplier ───────────────────
    aurora *= u.intensity * u.glow_mult;

    color += aurora;

    // Luminosity inversion: preserve hue & saturation, flip lightness
    if (u.invert_y > 0.5) {
        color = invert_luminosity(color);
    }

    return vec4f(color, 1.0);
}
`;
