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
import type { GpuTier, EffectConfig, PageEffectConfig } from "@amodx/shared";
import { detectGpuTier, isMobileDevice } from "./detection.js";
import { createEffect } from "./pipelines/map.js";
import { surfaceConfig, canvasPixelSize } from "./pipelines/base.js";

// Re-export pipeline utilities for admin preview and advanced consumers
export { createEffect } from "./pipelines/map.js";
export { surfaceConfig, canvasPixelSize } from "./pipelines/base.js";
import type { EffectPipeline } from "./types.js";

// ---------- EffectCanvas (block-level backgrounds) ----------

export interface EffectCanvasProps {
    /** Effect config (unified — works for backgrounds, button overlays, and page effects) */
    effect: EffectConfig | PageEffectConfig;
    /** Optional extra CSS class on the container div */
    className?: string;
    /**
     * Pointer tracking mode:
     * - "canvas" (default): pointermove on the canvas element. For backgrounds.
     * - "document": document-level pointermove with proximity check. For button
     *   overlays where the canvas is behind a button that captures pointer events.
     */
    pointerMode?: "canvas" | "document";
    /**
     * Called when the GPU pipeline activates or deactivates.
     * true = pipeline initialized and rendering. false = destroyed (scroll-out, error, unmount).
     * Used by ButtonEffectWrap to toggle button semi-transparency only when the
     * effect is actually rendering — pixel-perfect fallback when GPU is unavailable.
     */
    onActive?: (active: boolean) => void;
}

/**
 * Canvas wrapper for GPU effects — unified for backgrounds and button overlays.
 *
 * Renders a <canvas> that manages the full GPU lifecycle:
 * adapter → device → surface → pipeline → rAF loop → cleanup.
 *
 * If the effect type is "none", GPU is unavailable, or reduced motion is
 * preferred, renders nothing. The block's CSS background shows through.
 *
 * Usage as a background:
 *   <section className="relative">
 *     <EffectCanvas effect={attrs.effect} />
 *     <div className="relative z-10">{children}</div>
 *   </section>
 *
 * Usage as a button overlay (via ButtonEffectWrap):
 *   <EffectCanvas effect={attrs.buttonEffect} pointerMode="document" onActive={setActive} />
 */
export function EffectCanvas({ effect, className, pointerMode = "canvas", onActive }: EffectCanvasProps) {
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
    // "canvas" mode: direct listeners on canvas element (backgrounds)
    // "document" mode: document-level with proximity check (button overlays
    //   where the canvas is behind a button that captures pointer events)
    const handleCanvasPointerMove = useCallback((e: PointerEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        pointerRef.current = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height,
        };
    }, []);

    const handleCanvasPointerLeave = useCallback(() => {
        pointerRef.current = null;
    }, []);

    const handleDocumentPointerMove = useCallback((e: PointerEvent) => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        // Proximity check — track when cursor is near the element
        if (x >= -0.2 && x <= 1.2 && y >= -0.3 && y <= 1.3) {
            pointerRef.current = {
                x: Math.max(0, Math.min(1, x)),
                y: Math.max(0, Math.min(1, y)),
            };
        } else {
            pointerRef.current = null;
        }
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
                const usesBands = effectType === "aurora" || effectType === "plasma" || effectType === "cellular" || effectType === "clouds";
                await pipeline.init(device, config.format, canvas, {
                    colors: effectColors,
                    speed: effect.speed ?? 1.0,
                    timeOffset: (effect as any).timeOffset ?? 0,
                    intensity: effect.intensity ?? 0.25,
                    tier,
                    isMobile: mobile,
                    invertY: (effect as any).invertY ?? false,
                    bgColor: (effect as any).bgColor,
                    bands: (effect as any).bands ?? (usesBands ? 8 : undefined),
                });

                if (destroyed) {
                    pipeline.destroy();
                    device.destroy();
                    return;
                }

                console.log(`[amodx/effects] Pipeline "${effectType}" initialized — ${width}x${height}, tier=${tier}`);
                onActive?.(true);

                // Pointer events (desktop only)
                if (!mobile) {
                    if (pointerMode === "document") {
                        document.addEventListener("pointermove", handleDocumentPointerMove);
                    } else {
                        canvas.addEventListener("pointermove", handleCanvasPointerMove);
                        canvas.addEventListener("pointerleave", handleCanvasPointerLeave);
                    }
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
            if (pointerMode === "document") {
                document.removeEventListener("pointermove", handleDocumentPointerMove);
            } else {
                canvas?.removeEventListener("pointermove", handleCanvasPointerMove);
                canvas?.removeEventListener("pointerleave", handleCanvasPointerLeave);
            }
            pipelineRef.current?.destroy();
            pipelineRef.current = null;
            deviceRef.current?.destroy();
            deviceRef.current = null;
            onActive?.(false);
        }

        // IntersectionObserver: only init GPU when visible
        observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !pipelineRef.current && !destroyed) {
                    initGpu();
                } else if (!entry.isIntersecting && pipelineRef.current) {
                    // Scrolled out — release GPU resources
                    cancelAnimationFrame(rafRef.current);
                    if (pointerMode === "document") {
                        document.removeEventListener("pointermove", handleDocumentPointerMove);
                    }
                    pipelineRef.current?.destroy();
                    pipelineRef.current = null;
                    deviceRef.current?.destroy();
                    deviceRef.current = null;
                    onActive?.(false);
                }
            },
            { threshold: 0.1 },
        );
        observer.observe(container);

        return () => {
            observer?.disconnect();
            cleanup();
        };
    }, [shouldRender, tier, effectType, effect.colors, effect.speed, effect.intensity, pointerMode, handleCanvasPointerMove, handleCanvasPointerLeave, handleDocumentPointerMove, onActive]);

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
