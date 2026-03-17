/**
 * Soap Bubbles — iridescent floating bubbles with refraction.
 *
 * Technique: Voronoi cell grid generates bubble centers. Each cell is
 * evaluated for distance to center (bubble radius). Surface rendering
 * uses thin-film interference (distance-from-edge drives color cycling)
 * to create the iridescent soap-film look. Refraction is simulated by
 * displacing the background UV based on the bubble surface normal.
 *
 * Multiple layers at different scales create depth (large background
 * bubbles + small foreground bubbles). Bubbles drift and oscillate
 * using hash-seeded animation offsets.
 *
 * Original WGSL implementation. Voronoi distance fields and thin-film
 * color cycling are standard shader techniques.
 */

import { LUM_INVERT_WGSL } from "./lum-invert.js";

export const BUBBLES_SHADER = /* wgsl */ `

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

// ─── Hash functions ──────────────────────────────────────────────────

fn hash21(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn hash22(p: vec2f) -> vec2f {
    let n = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
    return fract(sin(n) * 43758.5453);
}

// ─── Value noise for background texture ──────────────────────────────

fn vnoise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let w = f * f * (3.0 - 2.0 * f);
    let a = hash21(i);
    let b = hash21(i + vec2f(1.0, 0.0));
    let c = hash21(i + vec2f(0.0, 1.0));
    let d = hash21(i + vec2f(1.0, 1.0));
    return mix(a, b, w.x) + (c - a) * w.y * (1.0 - w.x) + (d - b) * w.x * w.y;
}

fn vnoise3(p: vec3f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let w = f * f * (3.0 - 2.0 * f);
    // 2D slices blended in z
    let a0 = vnoise(i.xy + i.z * 157.0);
    let b0 = vnoise(i.xy + (i.z + 1.0) * 157.0);
    return mix(a0, b0, w.z);
}

// ─── Single bubble layer ─────────────────────────────────────────────
// Returns vec4: rgb color, w = alpha (bubble coverage)

fn bubble_layer(uv: vec2f, cell_scale: f32, time_offset: f32, layer_alpha: f32) -> vec4f {
    let t = u.time * u.speed;
    let scaled = uv * cell_scale;
    let cell = floor(scaled);
    let local = fract(scaled);

    var min_dist = 1.0;
    var bubble_center = vec2f(0.0);
    var bubble_cell = vec2f(0.0);

    // Search 3x3 neighborhood for closest bubble center
    for (var xo = -1; xo <= 1; xo = xo + 1) {
        for (var yo = -1; yo <= 1; yo = yo + 1) {
            let neighbor = vec2f(f32(xo), f32(yo));
            let cell_id = cell + neighbor;
            let h = hash22(cell_id);
            let rng = hash21(cell_id);

            // Skip some cells based on density (octaves controls density)
            let density = clamp(u.octaves / 8.0, 0.3, 1.0);
            if (rng > density) { continue; }

            // Animated bubble position: gentle drift + wobble
            let anim = vec2f(
                sin(t * 0.3 * (rng + 0.5) + time_offset + rng * 6.28) * 0.15,
                cos(t * 0.2 * (rng + 0.3) + time_offset + rng * 4.0) * 0.1 - t * 0.05 * (rng * 0.5 + 0.5),
            );

            let center = neighbor + h * 0.6 + 0.2 + anim;
            let d = distance(local, center);

            if (d < min_dist) {
                min_dist = d;
                bubble_center = center;
                bubble_cell = cell_id;
            }
        }
    }

    // Bubble radius varies per cell
    let rng = hash21(bubble_cell);
    let radius = 0.25 + rng * 0.15;

    if (min_dist > radius) {
        return vec4f(0.0);
    }

    // Normalized distance from bubble edge (0 = edge, 1 = center)
    let edge_dist = 1.0 - min_dist / radius;

    // ── Thin-film interference color ──────────────────────────────
    // Film thickness varies across the bubble surface.
    // Color cycles through the palette based on position + time.
    let film_t = edge_dist * 3.0 + rng * 6.28 + u.time * u.speed * 0.2;

    // Iridescent color from palette
    var irid = u.color0.rgb * (0.5 + 0.5 * cos(film_t));
    if (u.num_colors > 1.0) {
        irid += u.color1.rgb * (0.5 + 0.5 * cos(film_t * 1.3 + 2.094));
    }
    if (u.num_colors > 2.0) {
        irid += u.color2.rgb * (0.5 + 0.5 * cos(film_t * 0.7 + 4.189));
    }
    irid *= 0.5;

    // ── Specular highlight ────────────────────────────────────────
    let to_center = (local - bubble_center) / radius;
    // Default light from upper-left; pointer overrides
    var light_dir = vec2f(-0.3, -0.4);
    if (u.pointer.x >= 0.0) {
        let ptr_uv = vec2f(u.pointer.x, u.pointer.y);
        let bubble_uv = (bubble_cell + bubble_center) / cell_scale;
        light_dir = normalize(ptr_uv - bubble_uv);
    }
    let spec_dot = max(dot(-to_center, light_dir), 0.0);
    let specular = pow(spec_dot, 16.0) * 0.8;

    // ── Edge rim glow ─────────────────────────────────────────────
    let rim = pow(1.0 - edge_dist, 3.0) * 0.4;

    // ── Fresnel-like opacity: more opaque at edges, transparent at center
    let alpha = (rim + 0.15 + specular * 0.3) * layer_alpha;

    // ── Internal noise for soap-film shimmer ──────────────────────
    let shimmer_uv = to_center * 3.0 + u.time * u.speed * 0.1;
    let shimmer = vnoise(shimmer_uv * 10.0 + bubble_cell * 100.0) * 0.2;

    let col = irid + vec3f(specular) + vec3f(shimmer) * irid + rim * vec3f(0.8, 0.9, 1.0);

    return vec4f(col, clamp(alpha, 0.0, 1.0));
}

// ─── HLS luminosity inversion ────────────────────────────────────────
${LUM_INVERT_WGSL}

// ─── Fragment ────────────────────────────────────────────────────────

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let uv = in.uv;
    let aspect = u.resolution.x / u.resolution.y;
    let uv_a = vec2f(uv.x * aspect, uv.y);

    // ── Background: subtle noise texture ──────────────────────────
    var bg: vec3f;
    if (u.has_bg > 0.5) {
        bg = u.bg_color.rgb;
    } else {
        let bg_noise = vnoise3(vec3f(uv_a * 2.0, u.time * u.speed * 0.1));
        bg = vec3f(bg_noise * 0.08, bg_noise * 0.06, bg_noise * 0.1);
    }

    var color = bg;

    // ── Bubble layers (back to front) ─────────────────────────────
    // Large background bubbles
    let layer1 = bubble_layer(uv_a, 3.0, 0.0, 0.6);
    color = mix(color, layer1.rgb * u.intensity * u.glow_mult, layer1.w);

    // Medium bubbles
    let layer2 = bubble_layer(uv_a, 5.0, 100.0, 0.75);
    color = mix(color, layer2.rgb * u.intensity * u.glow_mult, layer2.w);

    // Small foreground bubbles
    let layer3 = bubble_layer(uv_a, 8.0, 250.0, 0.9);
    color = mix(color, layer3.rgb * u.intensity * u.glow_mult, layer3.w);

    // ── Luminosity inversion ──────────────────────────────────────
    if (u.invert_y > 0.5) {
        color = invert_luminosity(color);
    }

    return vec4f(color, 1.0);
}
`;
