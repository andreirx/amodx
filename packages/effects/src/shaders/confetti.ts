/**
 * Confetti celebration shader — compute + render pipeline.
 *
 * Technique: GPU compute shader manages particle state (position, velocity,
 * rotation, alpha). Each particle is a small rectangle with a random color
 * from the config palette. Gravity pulls down, air resistance adds tumble.
 *
 * Two-pass pipeline:
 *   1. Compute pass: update particle positions/velocities/rotations
 *   2. Render pass: instanced quad drawing with per-particle transforms
 *
 * Timeline (driven by time uniform):
 *   0.0–0.5s:  backdrop darkens (alpha 0→0.7)
 *   0.5–3.5s:  particles spawn and animate
 *   3.5–4.5s:  everything fades out (alpha→0)
 *
 * No WASM/Rapier needed — gravity + rotation + fade is trivial in compute.
 */

export const CONFETTI_COMPUTE_SHADER = /* wgsl */ `
// Confetti compute shader — stub
// Will contain particle simulation (position, velocity, rotation, fade).
`;

export const CONFETTI_RENDER_SHADER = /* wgsl */ `
// Confetti render shader — stub
// Will contain instanced quad rendering with per-particle color and transform.
`;
