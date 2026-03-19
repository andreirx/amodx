/**
 * Button Gleam — flowing caustic light overlay for CTA buttons.
 *
 * Renders bright caustic ridges on a black background. The canvas sits
 * ON TOP of the button with CSS mix-blend-mode: screen. In screen blend,
 * black = invisible, bright = adds light. This compositing is handled
 * entirely by CSS (universally supported), not by WebGPU alpha tricks.
 *
 * Technique:
 *   1. Domain-warped simplex noise creates flowing caustic ridges
 *   2. Secondary detail layer adds fine-grained texture
 *   3. Pointer position (mouse or device tilt) creates a Gaussian specular highlight
 *   4. When no pointer: slow sweeping highlight as fallback
 *   5. Edge vignette prevents hard cutoff at button borders
 *   6. HDR glow_mult pushes values > 1.0 on capable displays (physical bloom)
 *
 * Desktop: specular highlight tracks mouse cursor via document-level listener.
 * Mobile: time-based sweeping highlight. Device orientation tilt tracking
 * can be layered on via the same pointer uniform (tech debt: not yet wired).
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

// ─── Simplex noise (Ashima Arts) ─────────────────────────────────────

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

// ─── Fragment ────────────────────────────────────────────────────────

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let uv = in.uv;
    let t = u.time * u.speed + u.time_offset;
    let aspect = u.resolution.x / u.resolution.y;
    let p = vec2f(uv.x * aspect, uv.y);

    // --- Domain-warped caustic pattern ---
    // Warp field: two noise samples create organic displacement
    let warp = vec2f(
        snoise(p * 2.5 + vec2f(t * 0.3, 0.0)),
        snoise(p * 2.5 + vec2f(0.0, t * 0.4))
    );
    // Caustic ridges: noise sampled through the warp, sharpened via pow()
    let n = snoise(p * 3.0 + warp * 0.6 + vec2f(t * 0.15));
    let caustic = pow(clamp(n * 0.5 + 0.55, 0.0, 1.0), 5.0);

    // --- Secondary detail layer (finer texture) ---
    let n2 = snoise(p * 6.0 + warp * 0.3 + vec2f(-t * 0.2, t * 0.25));
    let detail = pow(clamp(n2 * 0.5 + 0.5, 0.0, 1.0), 4.0) * 0.3;

    // --- Specular highlight ---
    var specular = 0.0;
    if (u.pointer.x >= 0.0) {
        // Pointer active: bright Gaussian spot tracks cursor / device tilt
        let ptr = vec2f(u.pointer.x, u.pointer.y);
        let d = distance(uv, ptr);
        specular = exp(-d * d * 18.0) * 1.5;
    } else {
        // No pointer: slow sweeping highlight (mobile fallback)
        let sweep = vec2f(
            sin(t * 0.4) * 0.3 + 0.5,
            cos(t * 0.6) * 0.2 + 0.5
        );
        let d = distance(uv, sweep);
        specular = exp(-d * d * 12.0) * 0.5;
    }

    // --- Edge vignette (soft fade at button borders) ---
    let ex = smoothstep(0.0, 0.15, uv.x) * smoothstep(0.0, 0.15, 1.0 - uv.x);
    let ey = smoothstep(0.0, 0.2, uv.y) * smoothstep(0.0, 0.2, 1.0 - uv.y);
    let edge = ex * ey;

    // --- Compose ---
    // SDR compensation: glow_mult is 1.0 on SDR, 3.0-6.4 on HDR.
    // The caustic pattern (pow 5 sharpening) produces values in 0.05-0.2
    // range before multiplication — invisible at 1.0x. Guarantee a minimum
    // effective multiplier of 2.5 so the pattern fills the 0-1 range on SDR.
    // On HDR displays, glow_mult is already >= 3.0 — no change.
    let effective_mult = max(u.glow_mult, 2.5);
    let brightness = (caustic + detail + specular) * u.intensity * effective_mult * edge;
    let color = u.color0.rgb * brightness;

    // Opaque output — compositing is handled by the wrapper component
    // (ButtonEffectWrap for buttons, LazyEffectCanvas for backgrounds).
    return vec4f(color, 1.0);
}
`;
