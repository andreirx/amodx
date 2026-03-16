/**
 * HDR Glow — pulsating bloom for CTA buttons.
 *
 * Technique: Distance from each pixel to the center (or to an inner
 * rectangle representing the button). Exponential falloff creates a
 * soft glow halo. On HDR-EDR, values exceed 1.0 creating physical
 * bloom on capable displays.
 *
 * Desktop: glow intensifies toward pointer, optional arc filaments.
 * Mobile: slow time-based pulse with no pointer tracking.
 */

export const GLOW_SHADER = /* wgsl */ `

struct Uniforms {
    time: f32,
    speed: f32,
    intensity: f32,
    glow_mult: f32,
    resolution: vec2f,
    pointer: vec2f,
    octaves: f32,
    num_colors: f32,
    _pad: vec2f,
    color0: vec4f,
    color1: vec4f,
    color2: vec4f,
    color3: vec4f,
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

// SDF distance to rounded rectangle (the button shape)
fn sdf_rounded_rect(p: vec2f, half_size: vec2f, radius: f32) -> f32 {
    let q = abs(p) - half_size + vec2f(radius);
    return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let uv = in.uv;
    let t = u.time * u.speed;

    // Canvas is sized to button + bleed. Button occupies the inner ~70%.
    let centered = uv - vec2f(0.5);
    let aspect = u.resolution.x / u.resolution.y;
    let p = vec2f(centered.x * aspect, centered.y);

    // Button SDF (inner rectangle)
    let button_half = vec2f(0.28 * aspect, 0.22);
    let dist = sdf_rounded_rect(p, button_half, 0.04);

    // Pulsation
    let pulse = sin(t * 2.0) * 0.15 + 0.85;

    // Glow layers: tight inner + soft outer
    let inner_glow = exp(-max(dist, 0.0) * 25.0) * 1.5;
    let outer_glow = exp(-max(dist, 0.0) * 8.0) * 0.4;
    var glow = (inner_glow + outer_glow) * pulse;

    // Pointer-reactive boost (desktop)
    if (u.pointer.x >= 0.0) {
        let ptr = vec2f((u.pointer.x - 0.5) * aspect, u.pointer.y - 0.5);
        let ptr_dist = distance(p, ptr);
        let ptr_boost = exp(-ptr_dist * 6.0) * 0.8;
        glow += ptr_boost;

        // Arc filament toward pointer
        let to_ptr = ptr - p;
        let to_ptr_len = length(to_ptr);
        if (to_ptr_len > 0.01 && dist > 0.0 && dist < 0.3) {
            let along = dot(p - vec2f(0.0), normalize(to_ptr));
            let noise_val = snoise(vec2f(along * 10.0, t * 4.0));
            let arc = exp(-abs(noise_val) * 20.0) * exp(-dist * 15.0);
            glow += arc * 0.5;
        }
    }

    let color = u.color0.rgb;
    let final_color = color * glow * u.intensity * u.glow_mult;

    return vec4f(final_color, 0.0);
}
`;
