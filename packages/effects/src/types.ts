/**
 * @amodx/effects — Core type definitions
 *
 * EffectPipeline is the extension point. Third-party developers implement
 * this interface to create new GPU effects. The interface deliberately
 * exposes only WebGPU primitives — no React, no framework coupling.
 *
 * Lifecycle:
 *   1. EffectCanvas detects GPU tier and creates a GPUDevice
 *   2. createEffect(key) returns an EffectPipeline instance
 *   3. pipeline.init() — create shader modules, bind groups, pipeline state
 *   4. pipeline.frame() — called every rAF while visible
 *   5. pipeline.resize() — called on canvas resize
 *   6. pipeline.destroy() — release GPU resources (IntersectionObserver exit or unmount)
 */

import type { GpuTier } from "@amodx/shared";

export interface PipelineConfig {
    /** Hex color strings from block attrs (e.g., ["#6366f1", "#8b5cf6"]) */
    colors: string[];
    /** Animation speed multiplier (0.1–3.0) */
    speed: number;
    /** Effect intensity multiplier (0.1–2.0) */
    intensity: number;
    /** Detected GPU capability tier — pipeline adjusts quality accordingly */
    tier: GpuTier;
    /** True on touch devices with small screens — pipeline reduces complexity */
    isMobile: boolean;
}

export interface EffectPipeline {
    /**
     * Initialize GPU resources: shader modules, pipelines, bind groups, buffers.
     * Called once when the effect becomes visible (IntersectionObserver).
     */
    init(
        device: GPUDevice,
        format: GPUTextureFormat,
        canvas: HTMLCanvasElement,
        config: PipelineConfig,
    ): Promise<void>;

    /**
     * Handle canvas resize. Update resolution uniforms, recreate size-dependent textures.
     */
    resize(width: number, height: number): void;

    /**
     * Render one frame. Called every requestAnimationFrame while the effect is visible.
     *
     * @param time - elapsed seconds since init (for animation)
     * @param pointer - normalized pointer position {x: 0–1, y: 0–1}, or null if
     *                  no pointer is active (mobile idle, pointer left canvas)
     */
    frame(
        encoder: GPUCommandEncoder,
        view: GPUTextureView,
        time: number,
        pointer: { x: number; y: number } | null,
    ): void;

    /**
     * Release all GPU resources. Called when scrolled out of view or on unmount.
     * Must be idempotent — may be called multiple times.
     */
    destroy(): void;
}

/**
 * Metadata for the admin effect dropdown. No GPU code — just labels and defaults.
 * Manually maintained alongside PIPELINE_MAP in pipelines/map.ts.
 */
export interface EffectMetadata {
    /** Unique key matching PIPELINE_MAP entry (e.g., "aurora") */
    key: string;
    /** Human-readable label for admin dropdown (e.g., "Aurora Borealis") */
    label: string;
    /** Short description for admin tooltip */
    description: string;
    /** Suggested default colors shown in admin color pickers */
    defaultColors: string[];
    /** Which scopes this effect supports — filters the dropdown per context */
    scopes: readonly ('background' | 'glow' | 'celebration')[];
}
