/**
 * Confetti celebration — compute shader for physics + render shader for quads.
 *
 * Compute: Updates particle position, velocity (gravity + air resistance),
 * rotation, and alpha each frame.
 *
 * Render: Instanced quads (2 triangles each) with per-particle color,
 * rotation, and alpha. Drawn over a semi-transparent backdrop whose
 * opacity follows a 3-phase timeline.
 *
 * Particle buffer layout (per particle, 12 floats):
 *   [0]  pos.x       [1]  pos.y
 *   [2]  vel.x       [3]  vel.y
 *   [4]  rotation    [5]  angular_vel
 *   [6]  color_idx   [7]  alpha
 *   [8]  size        [9]  life (0-1, decreases)
 *   [10] aspect_ratio [11] reserved
 */

export const CONFETTI_COMPUTE_SHADER = /* wgsl */ `

struct Params {
    dt: f32,
    gravity: f32,
    drag: f32,
    time: f32,
};

struct Particle {
    pos_x: f32, pos_y: f32,
    vel_x: f32, vel_y: f32,
    rotation: f32, angular_vel: f32,
    color_idx: f32, alpha: f32,
    size: f32, life: f32,
    aspect_ratio: f32, reserved: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= arrayLength(&particles)) { return; }

    var p = particles[idx];

    // Skip dead particles
    if (p.life <= 0.0) { return; }

    let dt = params.dt;

    // Gravity
    p.vel_y += params.gravity * dt;

    // Air resistance (drag)
    p.vel_x *= (1.0 - params.drag * dt);
    p.vel_y *= (1.0 - params.drag * dt);

    // Slight horizontal drift (turbulence)
    p.vel_x += sin(params.time * 3.0 + f32(idx) * 0.1) * 20.0 * dt;

    // Update position
    p.pos_x += p.vel_x * dt;
    p.pos_y += p.vel_y * dt;

    // Update rotation
    p.rotation += p.angular_vel * dt;

    // Fade life
    p.life -= dt * 0.3;
    p.alpha = clamp(p.life, 0.0, 1.0);

    particles[idx] = p;
}
`;

export const CONFETTI_RENDER_SHADER = /* wgsl */ `

struct RenderParams {
    resolution: vec2f,
    time: f32,
    num_colors: f32,
    color0: vec4f,
    color1: vec4f,
    color2: vec4f,
    color3: vec4f,
    color4: vec4f,
    color5: vec4f,
};

struct Particle {
    pos_x: f32, pos_y: f32,
    vel_x: f32, vel_y: f32,
    rotation: f32, angular_vel: f32,
    color_idx: f32, alpha: f32,
    size: f32, life: f32,
    aspect_ratio: f32, reserved: f32,
};

@group(0) @binding(0) var<uniform> rp: RenderParams;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
};

fn get_confetti_color(idx: f32) -> vec3f {
    let i = u32(idx) % u32(rp.num_colors);
    switch (i) {
        case 0u: { return rp.color0.rgb; }
        case 1u: { return rp.color1.rgb; }
        case 2u: { return rp.color2.rgb; }
        case 3u: { return rp.color3.rgb; }
        case 4u: { return rp.color4.rgb; }
        case 5u: { return rp.color5.rgb; }
        default: { return rp.color0.rgb; }
    }
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VertexOutput {
    var out: VertexOutput;

    let p = particles[ii];
    if (p.alpha <= 0.0) {
        out.position = vec4f(0.0, 0.0, -2.0, 1.0);  // behind clip plane
        out.color = vec4f(0.0);
        return out;
    }

    // Quad vertices (2 triangles)
    let quad = array<vec2f, 6>(
        vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5),
        vec2f(0.5, -0.5), vec2f(0.5, 0.5), vec2f(-0.5, 0.5)
    );
    var local = quad[vi];
    local.x *= p.aspect_ratio;  // confetti pieces are rectangular
    local *= p.size;

    // Rotate
    let c = cos(p.rotation);
    let s = sin(p.rotation);
    let rotated = vec2f(local.x * c - local.y * s,
                        local.x * s + local.y * c);

    // World to clip space
    let world = vec2f(p.pos_x + rotated.x, p.pos_y + rotated.y);
    let clip = vec2f(
        world.x / rp.resolution.x * 2.0 - 1.0,
        1.0 - world.y / rp.resolution.y * 2.0
    );

    out.position = vec4f(clip, 0.0, 1.0);

    // Premultiplied alpha color
    let base_color = get_confetti_color(p.color_idx);
    let a = p.alpha;
    out.color = vec4f(base_color * a, a);

    return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    return in.color;
}
`;
