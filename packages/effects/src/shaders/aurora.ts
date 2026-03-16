/**
 * Aurora Borealis — layered simplex noise with vertical envelope.
 *
 * Technique: Multiple octaves of 2D simplex noise, each scrolling at
 * different speeds. Color interpolated from palette. Vertical envelope
 * concentrates the effect in the upper portion. Pointer gently distorts
 * the noise field.
 *
 * Simplex noise implementation: Ashima Arts (Ian McEwan, Stefan Gustavson).
 */

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

// --- Simplex 2D noise (Ashima Arts) ---

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
    m = m * m;
    m = m * m;
    let x_g = 2.0 * fract(p * C.www) - 1.0;
    let h = abs(x_g) - 0.5;
    let ox = floor(x_g + 0.5);
    let a0 = x_g - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    let g = vec3f(
        a0.x * x0.x + h.x * x0.y,
        a0.y * x12.x + h.y * x12.y,
        a0.z * x12.z + h.z * x12.w);
    return 130.0 * dot(m, g);
}

// --- Color interpolation ---

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

// --- Fragment shader ---

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let uv = in.uv;
    let t = u.time * u.speed;
    let aspect = u.resolution.x / u.resolution.y;
    var p = vec2f(uv.x * aspect, uv.y);

    // Subtle pointer influence (desktop)
    if (u.pointer.x >= 0.0) {
        let mptr =vec2f(u.pointer.x * aspect, u.pointer.y);
        let pull = (mptr - p) * 0.04;
        p += pull;
    }

    // Layered noise
    var aurora = 0.0;
    var freq = 1.5;
    var amp = 1.0;
    let max_oct = u32(u.octaves);
    for (var i = 0u; i < max_oct; i = i + 1u) {
        let fi = f32(i);
        let offset = vec2f(t * (0.15 + fi * 0.08), fi * 73.7);
        aurora += snoise(p * freq + offset) * amp;
        freq *= 2.1;
        amp *= 0.45;
    }

    // Normalize and shape
    aurora = aurora * 0.5 + 0.5;
    aurora = pow(aurora, 1.8);

    // Vertical envelope: strongest in upper third
    let env = smoothstep(0.0, 0.25, uv.y) * smoothstep(1.0, 0.45, uv.y);
    aurora *= env;

    // Horizontal shimmer
    let shimmer = snoise(vec2f(uv.x * 3.0 + t * 0.3, t * 0.1)) * 0.3 + 0.7;
    aurora *= shimmer;

    // Color from palette
    let color_t = snoise(vec2f(uv.x * 2.0 + t * 0.05, uv.y * 0.5)) * 0.5 + 0.5;
    let color = get_color(color_t);

    // Brightness with HDR glow
    let brightness = aurora * u.intensity * u.glow_mult;

    // Dark background tinted by first color
    let bg = u.color0.rgb * 0.015;
    let final_color = bg + color * brightness;

    return vec4f(final_color, 1.0);
}
`;
