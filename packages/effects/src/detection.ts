/**
 * GPU capability detection — lazy, cached at module level.
 *
 * detectGpuTier() is called by EffectCanvas/GlowCanvas/CelebrationOverlay
 * the first time they mount. If no effect component ever mounts (no effects
 * configured), this function never runs. True zero impact.
 *
 * The detection creates a temporary GPUDevice to probe color space support,
 * then immediately destroys it. The actual rendering device is created
 * separately by each EffectCanvas instance.
 *
 * Tier semantics (maps to ZapEngine render tiers):
 *   hdr-edr  — display-p3 + rgba16float + extended tone mapping (Apple ProBook, HDR monitors)
 *              Glow multiplier: 6.4x. Values >1.0 bloom beyond white.
 *   hdr-srgb — display-p3 canvas, no extended luminance.
 *              Glow multiplier: 3.0x. Wider gamut, clamped luminance.
 *   sdr      — Standard WebGPU, bgra8unorm.
 *              Glow multiplier: 1.0x. Normal sRGB output.
 *   none     — No WebGPU, or prefers-reduced-motion. CSS fallback only.
 */

import type { GpuTier } from "@amodx/shared";

let cachedTier: GpuTier | null = null;

/**
 * Detect the GPU capability tier. Result is cached — subsequent calls
 * return immediately without GPU probing.
 *
 * Safe to call on the server (returns 'none' immediately).
 */
export async function detectGpuTier(): Promise<GpuTier> {
    if (cachedTier !== null) return cachedTier;

    // Server-side: no GPU
    if (typeof globalThis.navigator === "undefined") {
        cachedTier = "none";
        return "none";
    }

    // Respect reduced motion preference — treat as no GPU
    if (
        typeof globalThis.window !== "undefined" &&
        globalThis.window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
        cachedTier = "none";
        return "none";
    }

    // No WebGPU API
    if (!navigator.gpu) {
        cachedTier = "none";
        return "none";
    }

    // Request adapter — may fail on blocklisted GPUs
    let adapter: GPUAdapter | null;
    try {
        adapter = await navigator.gpu.requestAdapter();
    } catch {
        cachedTier = "none";
        return "none";
    }
    if (!adapter) {
        cachedTier = "none";
        return "none";
    }

    // Request a temporary device for probing
    let device: GPUDevice;
    try {
        device = await adapter.requestDevice();
    } catch {
        cachedTier = "none";
        return "none";
    }

    // Probe HDR-EDR: rgba16float + display-p3 + extended tone mapping
    const testCanvas = document.createElement("canvas");
    const ctx = testCanvas.getContext("webgpu");
    if (!ctx) {
        device.destroy();
        cachedTier = "sdr";
        return "sdr";
    }

    // Try HDR-EDR first (highest tier)
    try {
        ctx.configure({
            device,
            format: "rgba16float",
            colorSpace: "display-p3",
            toneMapping: { mode: "extended" },
        });
        device.destroy();
        cachedTier = "hdr-edr";
        return "hdr-edr";
    } catch {
        // Not supported — try next tier
    }

    // Try HDR-sRGB: display-p3 without extended tone mapping
    try {
        const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
        ctx.configure({
            device,
            format: preferredFormat,
            colorSpace: "display-p3",
        });
        device.destroy();
        cachedTier = "hdr-srgb";
        return "hdr-srgb";
    } catch {
        // Not supported — fall through to SDR
    }

    // Standard WebGPU (SDR)
    device.destroy();
    cachedTier = "sdr";
    return "sdr";
}

/**
 * Synchronously check if reduced motion is preferred.
 * Used by components that need to skip animation setup entirely.
 */
export function prefersReducedMotion(): boolean {
    if (typeof globalThis.window === "undefined") return true;
    return globalThis.window.matchMedia(
        "(prefers-reduced-motion: reduce)",
    ).matches;
}

/**
 * Detect if the device is mobile. Used by pipelines to reduce
 * shader complexity (fewer noise octaves, half-res canvas, no pointer tracking).
 */
export function isMobileDevice(): boolean {
    if (typeof globalThis.navigator === "undefined") return false;
    return (
        /Mobi|Android/i.test(navigator.userAgent) ||
        ("ontouchstart" in globalThis &&
            typeof globalThis.window !== "undefined" &&
            globalThis.window.innerWidth < 1024)
    );
}
