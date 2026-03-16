/**
 * Shader barrel export.
 * All WGSL is stored as TypeScript string constants — no .wgsl files,
 * no special bundler config needed. Works with any build tool.
 */

export { AURORA_SHADER } from "./aurora.js";
export { PLASMA_SHADER } from "./plasma.js";
export { CAUSTICS_SHADER } from "./caustics.js";
export { GLOW_SHADER } from "./glow.js";
export { CONFETTI_COMPUTE_SHADER, CONFETTI_RENDER_SHADER } from "./confetti.js";
