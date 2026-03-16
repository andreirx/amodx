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
