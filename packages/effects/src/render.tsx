/**
 * @amodx/effects/render — Client-side React components
 *
 * "use client" — these components use browser APIs (WebGPU, IntersectionObserver,
 * ResizeObserver, requestAnimationFrame). They are imported ONLY by renderer
 * and plugin render components, never by admin or backend.
 *
 * Each component is self-contained for GPU lifecycle:
 *   - Detects tier via detectGpuTier() (module-level cache — first call probes, rest instant)
 *   - Creates its own GPUDevice (no shared context needed)
 *   - Manages IntersectionObserver (only runs when visible)
 *   - Cleans up on unmount or scroll-out
 *
 * If no effects are configured on a page, none of this code executes.
 * The dynamic import in block render components ensures it's not even bundled
 * for pages without effects.
 */

"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { GpuTier, BlockEffectConfig, PageEffectConfig, GlowEffectConfig } from "@amodx/shared";
import { detectGpuTier, isMobileDevice } from "./detection.js";
import { createEffect } from "./pipelines/map.js";
import { surfaceConfig, canvasPixelSize } from "./pipelines/base.js";

// Re-export pipeline utilities for admin preview and advanced consumers
export { createEffect } from "./pipelines/map.js";
export { surfaceConfig, canvasPixelSize } from "./pipelines/base.js";
import type { EffectPipeline } from "./types.js";

// ---------- EffectCanvas (block-level backgrounds) ----------

export interface EffectCanvasProps {
    /** Effect config from block attrs (type, colors, speed, intensity) */
    effect: BlockEffectConfig | PageEffectConfig;
    /** Optional extra CSS class on the container div */
    className?: string;
}

/**
 * Canvas wrapper for block-level background effects.
 *
 * Renders a <canvas> behind the block content. Manages the full GPU lifecycle:
 * adapter → device → surface → pipeline → rAF loop → cleanup.
 *
 * If the effect type is "none", GPU is unavailable, or reduced motion is
 * preferred, renders nothing. The block's CSS background shows through.
 *
 * Usage in a block render component:
 *   <section className="relative" style={{ background: fallbackCSS }}>
 *     <EffectCanvas effect={attrs.effect} />
 *     <div className="relative z-10">{children}</div>
 *   </section>
 */
export function EffectCanvas({ effect, className }: EffectCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const pipelineRef = useRef<EffectPipeline | null>(null);
    const deviceRef = useRef<GPUDevice | null>(null);
    const rafRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);
    const pointerRef = useRef<{ x: number; y: number } | null>(null);
    const [tier, setTier] = useState<GpuTier>("none");

    // Detect GPU tier on mount (cached — instant after first call)
    useEffect(() => {
        detectGpuTier().then(setTier);
    }, []);

    // Skip rendering entirely if no effect or no GPU
    const effectType = effect?.type;
    const shouldRender = tier !== "none" && effectType && effectType !== "none";

    // Pointer tracking (desktop only)
    const handlePointerMove = useCallback((e: PointerEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        pointerRef.current = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height,
        };
    }, []);

    const handlePointerLeave = useCallback(() => {
        pointerRef.current = null;
    }, []);

    // Main GPU lifecycle — runs when tier is known and effect is configured
    useEffect(() => {
        if (!shouldRender) return;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        let destroyed = false;
        let observer: IntersectionObserver | null = null;
        let resizeObserver: ResizeObserver | null = null;
        const mobile = isMobileDevice();

        // Default colors when none provided — prevents silent all-black output
        const DEFAULT_COLORS = ["#6366f1", "#8b5cf6", "#a855f7"];

        async function initGpu() {
            if (destroyed || !canvas) return;

            try {
                const adapter = await navigator.gpu?.requestAdapter();
                if (!adapter || destroyed) {
                    console.warn("[amodx/effects] No GPU adapter available");
                    return;
                }

                const device = await adapter.requestDevice();
                if (destroyed) {
                    device.destroy();
                    return;
                }
                deviceRef.current = device;

                // Log GPU errors that would otherwise be swallowed
                device.onuncapturederror = (ev) => {
                    console.error("[amodx/effects] GPU uncaptured error:", ev.error);
                };

                const ctx = canvas.getContext("webgpu");
                if (!ctx || destroyed) {
                    console.warn("[amodx/effects] Failed to get webgpu context");
                    device.destroy();
                    return;
                }

                const config = surfaceConfig(tier);
                ctx.configure({ device, ...config, alphaMode: "opaque" });

                const pipeline = createEffect(effectType!);
                if (!pipeline || destroyed) {
                    console.warn(`[amodx/effects] Unknown effect type: "${effectType}"`);
                    device.destroy();
                    return;
                }
                pipelineRef.current = pipeline;

                // Size canvas
                const { width, height } = canvasPixelSize(
                    canvas.clientWidth,
                    canvas.clientHeight,
                    mobile,
                );
                canvas.width = width;
                canvas.height = height;

                if (width === 0 || height === 0) {
                    console.warn(`[amodx/effects] Canvas has zero dimensions: ${width}x${height}`);
                }

                const effectColors = effect.colors?.length ? effect.colors : DEFAULT_COLORS;
                await pipeline.init(device, config.format, canvas, {
                    colors: effectColors,
                    speed: effect.speed ?? 1.0,
                    intensity: effect.intensity ?? 1.0,
                    tier,
                    isMobile: mobile,
                });

                if (destroyed) {
                    pipeline.destroy();
                    device.destroy();
                    return;
                }

                console.log(`[amodx/effects] Pipeline "${effectType}" initialized — ${width}x${height}, tier=${tier}`);

                // Pointer events (desktop only)
                if (!mobile) {
                    canvas.addEventListener("pointermove", handlePointerMove);
                    canvas.addEventListener("pointerleave", handlePointerLeave);
                }

                // Resize observer
                resizeObserver = new ResizeObserver(() => {
                    if (!canvas || destroyed) return;
                    const { width: w, height: h } = canvasPixelSize(
                        canvas.clientWidth,
                        canvas.clientHeight,
                        mobile,
                    );
                    canvas.width = w;
                    canvas.height = h;
                    pipeline.resize(w, h);
                });
                resizeObserver.observe(canvas);

                // Render loop
                startTimeRef.current = performance.now();
                function renderLoop() {
                    if (destroyed || !pipelineRef.current || !deviceRef.current) return;

                    try {
                        const time =
                            (performance.now() - startTimeRef.current) / 1000;
                        const encoder = deviceRef.current.createCommandEncoder();
                        const texture = ctx!.getCurrentTexture();
                        const view = texture.createView();

                        pipelineRef.current.frame(
                            encoder,
                            view,
                            time,
                            pointerRef.current,
                        );

                        deviceRef.current.queue.submit([encoder.finish()]);
                    } catch (frameErr) {
                        console.error("[amodx/effects] Frame error:", frameErr);
                        return; // Stop the render loop on frame error
                    }
                    rafRef.current = requestAnimationFrame(renderLoop);
                }
                rafRef.current = requestAnimationFrame(renderLoop);
            } catch (err) {
                console.error("[amodx/effects] GPU init failed:", err);
            }
        }

        function cleanup() {
            destroyed = true;
            cancelAnimationFrame(rafRef.current);
            resizeObserver?.disconnect();
            canvas?.removeEventListener("pointermove", handlePointerMove);
            canvas?.removeEventListener("pointerleave", handlePointerLeave);
            pipelineRef.current?.destroy();
            pipelineRef.current = null;
            deviceRef.current?.destroy();
            deviceRef.current = null;
        }

        // IntersectionObserver: only init GPU when visible
        observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !pipelineRef.current && !destroyed) {
                    initGpu();
                } else if (!entry.isIntersecting && pipelineRef.current) {
                    // Scrolled out — release GPU resources
                    cancelAnimationFrame(rafRef.current);
                    pipelineRef.current?.destroy();
                    pipelineRef.current = null;
                    deviceRef.current?.destroy();
                    deviceRef.current = null;
                }
            },
            { threshold: 0.1 },
        );
        observer.observe(container);

        return () => {
            observer?.disconnect();
            cleanup();
        };
    }, [shouldRender, tier, effectType, effect.colors, effect.speed, effect.intensity, handlePointerMove, handlePointerLeave]);

    // Render nothing if no GPU or no effect configured
    if (!shouldRender) return null;

    return (
        <div
            ref={containerRef}
            className={`absolute inset-0 z-0 overflow-hidden pointer-events-none ${className || ""}`}
        >
            <canvas
                ref={canvasRef}
                className="w-full h-full"
                style={{ pointerEvents: "auto" }}
            />
        </div>
    );
}

// ---------- GlowCanvas (CTA button glow) ----------

export interface GlowCanvasProps {
    /** Glow config from CTA block attrs */
    glow: GlowEffectConfig;
    /** Ref to the button element — canvas sizes to match */
    buttonRef: React.RefObject<HTMLElement | null>;
    /** Optional extra CSS class */
    className?: string;
}

/**
 * Canvas wrapper for CTA button glow effects.
 *
 * Sized to the button element plus bleed area for glow overflow.
 * Desktop: arcs track pointer. Mobile: time-based pulse.
 *
 * Renders as absolute-positioned behind the button.
 * The <a> tag remains on top for accessibility and SEO.
 */
export function GlowCanvas({ glow, buttonRef, className }: GlowCanvasProps) {
    // Stub — will be implemented when the glow pipeline is ready.
    // Same pattern as EffectCanvas but sized to buttonRef element
    // with ~20px bleed for glow overflow.
    if (!glow?.enabled) return null;

    return (
        <div className={`absolute -inset-5 overflow-visible pointer-events-none ${className || ""}`}>
            {/* Canvas will be mounted here when glow pipeline is implemented */}
        </div>
    );
}

// ---------- PageEffectLayer (full-page ambient background) ----------

export interface PageEffectLayerProps {
    /** Page effect config from TenantConfig */
    effect: PageEffectConfig;
}

/**
 * Full-viewport fixed canvas for page-level ambient effects.
 *
 * Sits at z-0 behind all page content. Uses document.visibilitychange
 * to pause when tab is hidden (battery conservation).
 *
 * Rendered conditionally in layout.tsx:
 *   {config.pageEffect?.type !== "none" && <PageEffectLayer effect={config.pageEffect} />}
 */
export function PageEffectLayer({ effect }: PageEffectLayerProps) {
    // Reuse EffectCanvas but with fixed positioning
    if (!effect || effect.type === "none") return null;

    return (
        <div className="fixed inset-0 z-0 pointer-events-none">
            <EffectCanvas effect={effect} />
        </div>
    );
}
