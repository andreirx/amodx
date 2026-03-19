/**
 * Fractals — iterative fractal pattern with cosine palette.
 *
 * Technique: Iteratively applies fract(uv * 1.5) - 0.5 to create self-similar
 * structure. At each iteration, measures distance from origin, applies sin()
 * for ring patterns, then inverts via 1/d for glow. Color from cosine palette
 * (Inigo Quilez technique: a + b*cos(2*pi*(c*t + d))).
 *
 * The octaves uniform controls iteration count (1-4). More iterations =
 * deeper fractal zoom with finer self-similar detail.
 *
 * Original WGSL implementation. Cosine palette is a standard shader technique
 * documented by Inigo Quilez (MIT).
 */

import { LUM_INVERT_WGSL } from "./lum-invert.js";

export const FRACTALS_SHADER = /* wgsl */ `

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

// ─── Cosine palette (Inigo Quilez technique, MIT) ────────────────────
// palette(t) = a + b * cos(2*pi * (c*t + d))
// Uses user colors to derive palette parameters.

fn palette(t: f32) -> vec3f {
    // Base palette: offset + amplitude * cos(2pi * (freq * t + phase))
    // We blend the user's color0 into the palette for customization
    let a = mix(vec3f(0.5), u.color0.rgb, 0.3);
    let b = vec3f(0.5);
    let c = vec3f(1.0);
    let d = vec3f(0.263, 0.416, 0.557);

    return a + b * cos(6.28318 * (c * t + d));
}

// ─── HLS luminosity inversion ────────────────────────────────────────
${LUM_INVERT_WGSL}

// ─── Fragment ────────────────────────────────────────────────────────

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let t = u.time * u.speed + u.time_offset;
    let aspect = u.resolution.x / u.resolution.y;

    // Centered UV in [-1, 1] range, aspect-corrected
    var uv = vec2f(
        (in.uv.x - 0.5) * 2.0 * aspect,
        (in.uv.y - 0.5) * 2.0,
    );

    // Pointer influence: gentle distortion toward cursor
    if (u.pointer.x >= 0.0) {
        let mptr = vec2f(
            (u.pointer.x - 0.5) * 2.0 * aspect,
            (u.pointer.y - 0.5) * 2.0,
        );
        let ptr_d = distance(uv, mptr);
        let pull = exp(-ptr_d * 2.0) * 0.15;
        uv = mix(uv, mptr, pull);
    }

    let uv0 = uv;
    var final_color = vec3f(0.0);
    let iterations = u32(clamp(u.octaves, 1.0, 4.0));

    for (var i = 0u; i < 4u; i = i + 1u) {
        if (i >= iterations) { break; }
        let fi = f32(i);

        // Self-similar zoom: fract creates repeating tiles
        uv = fract(uv * 1.5) - 0.5;

        // Distance from tile center, modulated by distance from origin
        var d = length(uv) * exp(-length(uv0));

        // Color from palette, driven by distance from origin + iteration + time
        let col = palette(length(uv0) + fi * 0.4 + t * 0.4);

        // Ring pattern via sin, then glow via inverse
        d = sin(d * 8.0 + t) / 8.0;
        d = abs(d);
        d = pow(0.01 / d, 1.2);

        final_color += col * d;
    }

    // ── Apply intensity + HDR glow ────────────────────────────────
    final_color *= u.intensity * u.glow_mult * 0.5;

    // ── Background ────────────────────────────────────────────────
    var color: vec3f;
    if (u.has_bg > 0.5) {
        color = u.bg_color.rgb + final_color;
    } else {
        color = final_color;
    }

    // ── Luminosity inversion ──────────────────────────────────────
    if (u.invert_y > 0.5) {
        color = invert_luminosity(color);
    }

    return vec4f(color, 1.0);
}
`;
