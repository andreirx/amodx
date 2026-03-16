/**
 * Shared GPU pipeline boilerplate.
 *
 * Contains utilities shared across all pipeline implementations:
 *   - Hex color parsing to float arrays (for shader uniforms)
 *   - Uniform buffer creation helpers
 *   - Surface configuration per GPU tier
 *   - Canvas resolution management (mobile half-res)
 *
 * Individual pipelines extend or compose these utilities.
 * This file has no React dependency — pure WebGPU helpers.
 */

import type { GpuTier } from "@amodx/shared";

/**
 * Parse a hex color string to [r, g, b] floats in 0–1 range.
 * Handles both "#rgb" and "#rrggbb" formats.
 */
export function hexToFloat3(hex: string): [number, number, number] {
    const h = hex.replace("#", "");
    if (h.length === 3) {
        return [
            parseInt(h[0] + h[0], 16) / 255,
            parseInt(h[1] + h[1], 16) / 255,
            parseInt(h[2] + h[2], 16) / 255,
        ];
    }
    return [
        parseInt(h.substring(0, 2), 16) / 255,
        parseInt(h.substring(2, 4), 16) / 255,
        parseInt(h.substring(4, 6), 16) / 255,
    ];
}

/**
 * Get the HDR glow multiplier for a given tier.
 * Matches ZapEngine's EFFECTS_HDR_MULT values.
 */
export function glowMultiplier(tier: GpuTier): number {
    switch (tier) {
        case "hdr-edr":
            return 6.4;
        case "hdr-srgb":
            return 3.0;
        case "sdr":
            return 1.0;
        case "none":
            return 0;
    }
}

/**
 * Determine the GPUTextureFormat and colorSpace for canvas configuration.
 */
export function surfaceConfig(tier: GpuTier): {
    format: GPUTextureFormat;
    colorSpace: PredefinedColorSpace;
    toneMapping?: GPUCanvasToneMapping;
} {
    switch (tier) {
        case "hdr-edr":
            return {
                format: "rgba16float",
                colorSpace: "display-p3",
                toneMapping: { mode: "extended" },
            };
        case "hdr-srgb":
            return {
                format: navigator.gpu.getPreferredCanvasFormat(),
                colorSpace: "display-p3",
            };
        default:
            return {
                format: navigator.gpu.getPreferredCanvasFormat(),
                colorSpace: "srgb",
            };
    }
}

/**
 * Create a GPUBuffer for uniform data.
 * Size is rounded up to 16-byte alignment (WebGPU requirement).
 */
export function createUniformBuffer(
    device: GPUDevice,
    sizeBytes: number,
): GPUBuffer {
    const alignedSize = Math.ceil(sizeBytes / 16) * 16;
    return device.createBuffer({
        size: alignedSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
}

// ==========================================
// Standard uniform buffer layout (shared by aurora, plasma, caustics, glow)
// ==========================================
//
// Float index → WGSL member
// [0]  time        [1]  speed       [2]  intensity   [3]  glow_mult
// [4]  resolution.x [5] resolution.y [6] pointer.x   [7]  pointer.y
// [8]  octaves     [9]  num_colors  [10] _pad.x      [11] _pad.y
// [12] color0.r    [13] color0.g    [14] color0.b    [15] color0.a
// [16] color1.r    [17] color1.g    [18] color1.b    [19] color1.a
// [20] color2.r    [21] color2.g    [22] color2.b    [23] color2.a
// [24] color3.r    [25] color3.g    [26] color3.b    [27] color3.a
// Total: 28 floats = 112 bytes (16-byte aligned)

export const STANDARD_UNIFORM_FLOATS = 28;
export const STANDARD_UNIFORM_BYTES = STANDARD_UNIFORM_FLOATS * 4;

/**
 * Create a fullscreen render pipeline with a single uniform bind group.
 * Used by all fragment-shader-only effects (aurora, plasma, caustics, glow).
 */
export function createFullscreenPipeline(
    device: GPUDevice,
    shaderCode: string,
    format: GPUTextureFormat,
    blend?: GPUBlendState,
): { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout } {
    const module = device.createShaderModule({ code: shaderCode });
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" as const },
        }],
    });
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
    });
    const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module, entryPoint: "vs" },
        fragment: {
            module,
            entryPoint: "fs",
            targets: [{ format, ...(blend ? { blend } : {}) }],
        },
        primitive: { topology: "triangle-list" },
    });
    return { pipeline, bindGroupLayout };
}

/**
 * Write standard uniform data into a Float32Array.
 * Call once during init for static values, then update [0] (time)
 * and [6],[7] (pointer) each frame.
 */
export function initStandardUniforms(
    data: Float32Array,
    config: import("../types.js").PipelineConfig,
): void {
    data[1] = config.speed;
    data[2] = config.intensity;
    data[3] = glowMultiplier(config.tier);
    data[8] = config.isMobile ? 2.0 : 5.0;  // octaves
    data[9] = Math.min(config.colors.length, 4);

    for (let i = 0; i < 4; i++) {
        const hex = config.colors[i] || config.colors[0] || "#6366f1";
        const [r, g, b] = hexToFloat3(hex);
        const offset = 12 + i * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = 1.0;
    }
}

/**
 * Live-update speed, intensity, and/or colors in a standard uniform Float32Array.
 * Does NOT touch the GPU buffer — that happens in the next frame() call
 * when the pipeline writes the full array via device.queue.writeBuffer().
 */
export function updateStandardConfig(
    data: Float32Array,
    config: { speed?: number; intensity?: number; colors?: string[] },
): void {
    if (config.speed !== undefined) data[1] = config.speed;
    if (config.intensity !== undefined) data[2] = config.intensity;
    if (config.colors) {
        data[9] = Math.min(config.colors.length, 4);
        for (let i = 0; i < 4; i++) {
            const hex = config.colors[i] || config.colors[0] || "#6366f1";
            const [r, g, b] = hexToFloat3(hex);
            const offset = 12 + i * 4;
            data[offset] = r;
            data[offset + 1] = g;
            data[offset + 2] = b;
            data[offset + 3] = 1.0;
        }
    }
}

/**
 * Update per-frame uniform data (time, pointer).
 */
export function updateFrameUniforms(
    data: Float32Array,
    time: number,
    pointer: { x: number; y: number } | null,
): void {
    data[0] = time;
    data[6] = pointer?.x ?? -1;
    data[7] = pointer?.y ?? -1;
}

/**
 * Calculate canvas pixel dimensions accounting for device pixel ratio
 * and mobile resolution reduction.
 *
 * @param clientWidth  CSS width of the canvas element
 * @param clientHeight CSS height of the canvas element
 * @param isMobile     If true, renders at 50% resolution
 */
export function canvasPixelSize(
    clientWidth: number,
    clientHeight: number,
    isMobile: boolean,
): { width: number; height: number } {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    const scale = isMobile ? 0.5 : 1.0;
    return {
        width: Math.floor(clientWidth * dpr * scale),
        height: Math.floor(clientHeight * dpr * scale),
    };
}
