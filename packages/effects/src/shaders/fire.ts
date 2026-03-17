/**
 * Fire with Smoke — volumetric fire, rising smoke, and drifting sparks.
 *
 * Technique: 3D simplex noise (Ashima Arts, MIT) stacked in octaves
 * creates the turbulent fire density field. The field is sampled along
 * a vertical gradient with fuel falloff (parabolic from center-x).
 * Fire color uses a thermal gradient (black -> red -> orange -> yellow).
 * Smoke layer uses the same noise at lower frequency, rendered as gray
 * additive above the flame zone. Sparks are grid-hashed point particles
 * with lifetime and circular motion.
 *
 * Simplex 3D noise: Ashima Arts (Ian McEwan, Stefan Gustavson), MIT License.
 * Fire/smoke/spark composition: original WGSL implementation.
 */

import { LUM_INVERT_WGSL } from "./lum-invert.js";

export const FIRE_SHADER = /* wgsl */ `

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

// ─── Simplex 3D noise (Ashima Arts, MIT) ─────────────────────────────

fn mod289_3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289_4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn perm4(x: vec4f) -> vec4f { return mod289_4(((x * 34.0) + 10.0) * x); }

fn snoise3(v: vec3f) -> f32 {
    let C = vec2f(1.0 / 6.0, 1.0 / 3.0);
    let D = vec4f(0.0, 0.5, 1.0, 2.0);

    let i = floor(v + dot(v, vec3f(C.y)));
    let x0 = v - i + dot(i, vec3f(C.x));

    let g = step(x0.yzx, x0.xyz);
    let l = 1.0 - g;
    let i1 = min(g, l.zxy);
    let i2 = max(g, l.zxy);

    let x1 = x0 - i1 + vec3f(C.x);
    let x2 = x0 - i2 + vec3f(C.y);
    let x3 = x0 - D.yyy;

    let ii = mod289_3(i);
    let p = perm4(perm4(perm4(
        ii.z + vec4f(0.0, i1.z, i2.z, 1.0)) +
        ii.y + vec4f(0.0, i1.y, i2.y, 1.0)) +
        ii.x + vec4f(0.0, i1.x, i2.x, 1.0));

    let ns = 0.142857142857 * vec3f(D.w, D.y, D.z) - vec3f(D.x, D.z, D.x);
    let j = p - 49.0 * floor(p * ns.z * ns.z);
    let x_ = floor(j * ns.z);
    let y_ = floor(j - 7.0 * x_);
    let xx = x_ * ns.x + vec4f(ns.y);
    let yy = y_ * ns.x + vec4f(ns.y);
    let h = 1.0 - abs(xx) - abs(yy);
    let b0 = vec4f(xx.x, xx.y, yy.x, yy.y);
    let b1 = vec4f(xx.z, xx.w, yy.z, yy.w);
    let s0 = floor(b0) * 2.0 + 1.0;
    let s1 = floor(b1) * 2.0 + 1.0;
    let sh = -step(h, vec4f(0.0));
    let a0 = vec4f(b0.x + s0.x * sh.x, b0.z + s0.z * sh.x,
                    b0.y + s0.y * sh.y, b0.w + s0.w * sh.y);
    let a1 = vec4f(b1.x + s1.x * sh.z, b1.z + s1.z * sh.z,
                    b1.y + s1.y * sh.w, b1.w + s1.w * sh.w);
    let p0 = vec3f(a0.x, a0.y, h.x);
    let p1 = vec3f(a0.z, a0.w, h.y);
    let p2 = vec3f(a1.x, a1.y, h.z);
    let p3 = vec3f(a1.z, a1.w, h.w);
    let norm = inverseSqrt(vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));

    var m = max(vec4f(0.6) - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4f(0.0));
    m = m * m;
    return 42.0 * dot(m * m, vec4f(
        dot(p0 * norm.x, x0), dot(p1 * norm.y, x1),
        dot(p2 * norm.z, x2), dot(p3 * norm.w, x3)));
}

// ─── Noise stacking with octave falloff ──────────────────────────────

fn noise_stack(pos_in: vec3f, falloff: f32) -> f32 {
    var noise = snoise3(pos_in);
    var off = 1.0;
    var pos = pos_in;
    let max_oct = u32(clamp(u.octaves, 2.0, 6.0));

    for (var i = 1u; i < 6u; i = i + 1u) {
        if (i >= max_oct) { break; }
        pos *= 2.0;
        off *= falloff;
        noise = (1.0 - off) * noise + off * snoise3(pos);
    }
    return (1.0 + noise) * 0.5;
}

fn noise_stack_uv(pos: vec3f, falloff: f32) -> vec2f {
    let a = noise_stack(pos, falloff);
    let b = noise_stack(pos + vec3f(3984.293, 423.21, 5235.19), falloff);
    return vec2f(a, b);
}

// ─── PRNG for spark grid ─────────────────────────────────────────────

fn prng(seed: vec2f) -> f32 {
    let s = fract(seed * vec2f(5.3983, 5.4427));
    let s2 = s + dot(s.yx, s.xy + vec2f(21.5351, 14.3137));
    return fract(s2.x * s2.y * 95.4337);
}

// ─── HLS luminosity inversion ────────────────────────────────────────
${LUM_INVERT_WGSL}

// ─── Fragment ────────────────────────────────────────────────────────

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let real_time = u.time * u.speed * 0.5;
    let res = u.resolution;

    // fragCoord equivalent: uv is 0..1, convert to pixel coords
    let frag = vec2f(in.uv.x * res.x, (1.0 - in.uv.y) * res.y);

    let xpart = frag.x / res.x;
    let ypart = frag.y / res.y;

    // Clip plane for flame zone (lower portion of screen)
    let clip = res.y * 0.35;
    let y_clip = frag.y / clip;
    let y_clip_falloff = clamp(2.0 - y_clip, 0.0, 1.0);
    let y_clipped = min(y_clip, 1.0);
    let y_clipped_n = 1.0 - y_clipped;

    // Fuel: strongest at horizontal center, fades to edges
    let xfuel = 1.0 - abs(2.0 * xpart - 1.0);

    // Coordinate scaling for noise sampling
    let coord_sc = 0.01 * frag;
    let position = vec3f(coord_sc, 0.0) + vec3f(1223.0, 6434.0, 8425.0);

    // Flow field: horizontal pull + strong upward draft at flame base
    let flow = vec3f(
        4.1 * (0.5 - xpart) * pow(y_clipped_n, 4.0),
        -2.0 * xfuel * pow(y_clipped_n, 64.0),
        0.0,
    );
    let timing = real_time * vec3f(0.0, -1.7, 1.1) + flow;

    // Domain displacement for turbulence
    let displace_pos = vec3f(1.0, 0.5, 1.0) * 2.4 * position + real_time * vec3f(0.01, -0.7, 1.3);
    let displace = vec3f(noise_stack_uv(displace_pos, 0.4), 0.0);

    // Main fire noise
    let noise_coord = (vec3f(2.0, 1.0, 1.0) * position + timing + 0.4 * displace);
    let noise_val = noise_stack(noise_coord, 0.4);

    // Fire shape: vertical falloff * fuel * noise
    let flames = pow(y_clipped, 0.3 * xfuel) * pow(noise_val, 0.3 * xfuel);
    let f = y_clip_falloff * pow(1.0 - flames * flames * flames, 8.0);
    let fff = f * f * f;

    // Fire color: user color0 for base, warm gradient for core
    var fire = vec3f(f, fff, fff * fff) * 1.5;
    // Tint with user color
    fire = mix(fire, u.color0.rgb * f * 2.0, 0.3);

    // ── Smoke layer ───────────────────────────────────────────────
    let smoke_noise = 0.5 + snoise3(0.4 * position + timing * vec3f(1.0, 1.0, 0.2)) * 0.5;
    var smoke_color = u.color1.rgb;
    if (u.num_colors < 2.0) {
        smoke_color = vec3f(0.15, 0.12, 0.1);
    }
    let smoke = smoke_color * 0.3 * pow(xfuel, 3.0) * pow(ypart, 2.0) * (smoke_noise + 0.4 * (1.0 - noise_val));

    // ── Sparks ────────────────────────────────────────────────────
    let spark_grid = 30.0;
    var spark_coord = frag - vec2f(0.0, 190.0 * real_time);
    spark_coord -= 30.0 * noise_stack_uv(0.01 * vec3f(spark_coord, 30.0 * u.time), 0.4);
    spark_coord += 100.0 * flow.xy;

    // Offset every other row for hexagonal packing
    if (fract(spark_coord.y / spark_grid * 0.5) < 0.5) {
        spark_coord.x += 0.5 * spark_grid;
    }

    let spark_idx = floor(spark_coord / spark_grid);
    let spark_rng = prng(spark_idx);
    let spark_life = min(10.0 * (1.0 - min(
        (spark_idx.y + 190.0 * real_time / spark_grid) / (24.0 - 20.0 * spark_rng),
        1.0)), 1.0);

    var sparks = vec3f(0.0);
    if (spark_life > 0.0) {
        let spark_size = xfuel * xfuel * spark_rng * 0.08;
        let spark_rad = 999.0 * spark_rng * 6.28318 + 2.0 * u.time;
        let spark_circ = vec2f(sin(spark_rad), cos(spark_rad));
        let spark_off = (0.5 - spark_size) * spark_grid * spark_circ;
        let spark_mod = fract((spark_coord + spark_off) / spark_grid + 0.5) * spark_grid - 0.5 * spark_grid;
        let spark_len = length(spark_mod);
        let spark_gray = max(0.0, 1.0 - spark_len / (spark_size * spark_grid));
        sparks = spark_life * spark_gray * vec3f(1.0, 0.3, 0.0);
    }

    // ── Composite ─────────────────────────────────────────────────
    var color = max(fire, sparks) + smoke;
    color *= u.intensity * u.glow_mult;

    // ── Background ────────────────────────────────────────────────
    if (u.has_bg > 0.5) {
        color += u.bg_color.rgb;
    }

    // ── Luminosity inversion ──────────────────────────────────────
    if (u.invert_y > 0.5) {
        color = invert_luminosity(color);
    }

    return vec4f(color, 1.0);
}
`;
