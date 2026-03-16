/**
 * Live GPU effect preview for admin block editors and Settings page.
 *
 * Architecture:
 *   - GPU device and pipeline created once per effect TYPE change
 *   - Speed, intensity, colors updated via pipeline.updateConfig() without re-init
 *   - rAF loop reads latest config from refs each frame
 *   - Zero flashing on slider drag — GPU pipeline stays alive
 *
 * Uses dynamic import to keep admin bundle small. The @amodx/effects/render
 * chunk only loads when a user selects an effect (not on page load).
 *
 * If WebGPU is unavailable, renders a fallback message.
 */

import React, { useRef, useEffect, useState } from "react";
import type { BlockEffectConfig, GpuTier } from "@amodx/shared";
import type { EffectPipeline, PipelineConfig } from "@amodx/effects";

interface EffectPreviewProps {
    effect: BlockEffectConfig | null | undefined;
}

export function EffectPreview({ effect }: EffectPreviewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pipelineRef = useRef<EffectPipeline | null>(null);
    // WebGPU types not available in plugins package — use any for internal admin component
    const deviceRef = useRef<any>(null);
    const ctxRef = useRef<any>(null);
    const rafRef = useRef<number>(0);
    const startRef = useRef<number>(0);
    const tierRef = useRef<GpuTier>("none");
    const [gpuReady, setGpuReady] = useState<boolean | null>(null); // null = loading

    const effectType = effect?.type || "none";
    const isActive = effectType !== "none";

    // Live-update config via ref — pipeline reads this each frame
    const configRef = useRef(effect);
    configRef.current = effect;

    // Detect GPU tier once
    useEffect(() => {
        let cancelled = false;
        import("@amodx/effects").then(mod => {
            if (cancelled) return;
            mod.detectGpuTier().then(tier => {
                if (cancelled) return;
                tierRef.current = tier;
                setGpuReady(tier !== "none");
            });
        });
        return () => { cancelled = true; };
    }, []);

    // Main GPU lifecycle — only re-runs when effect TYPE changes
    useEffect(() => {
        if (!isActive || gpuReady !== true) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        let destroyed = false;

        async function init() {
            if (destroyed || !canvas) return;

            const { createEffect, surfaceConfig, canvasPixelSize } = await import("@amodx/effects/render");
            if (destroyed) return;

            const adapter = await (navigator as any).gpu?.requestAdapter();
            if (!adapter || destroyed) return;

            const device = await adapter.requestDevice();
            if (destroyed) { device.destroy(); return; }
            deviceRef.current = device;

            const ctx = canvas.getContext("webgpu") as any;
            if (!ctx || destroyed) { device.destroy(); return; }
            ctxRef.current = ctx;

            const cfg = surfaceConfig(tierRef.current);
            ctx.configure({ device, ...cfg });

            const { width, height } = canvasPixelSize(canvas.clientWidth, canvas.clientHeight, false);
            canvas.width = width;
            canvas.height = height;

            const pipeline = createEffect(effectType);
            if (!pipeline || destroyed) { device.destroy(); return; }
            pipelineRef.current = pipeline;

            const currentConfig = configRef.current;
            await pipeline.init(device, cfg.format, canvas, {
                colors: currentConfig?.colors || [],
                speed: currentConfig?.speed ?? 1.0,
                intensity: currentConfig?.intensity ?? 1.0,
                tier: tierRef.current,
                isMobile: false,
            });

            if (destroyed) { pipeline.destroy(); device.destroy(); return; }

            // Render loop
            startRef.current = performance.now();
            function renderLoop() {
                if (destroyed || !pipelineRef.current || !deviceRef.current || !ctxRef.current) return;

                // Live-update config from ref (no GPU re-init needed)
                const live = configRef.current;
                if (pipelineRef.current.updateConfig && live) {
                    pipelineRef.current.updateConfig({
                        speed: live.speed,
                        intensity: live.intensity,
                        colors: live.colors,
                    });
                }

                const time = (performance.now() - startRef.current) / 1000;
                const encoder = deviceRef.current.createCommandEncoder();
                const texture = ctxRef.current.getCurrentTexture();
                const view = texture.createView();
                pipelineRef.current.frame(encoder, view, time, null);
                deviceRef.current.queue.submit([encoder.finish()]);
                rafRef.current = requestAnimationFrame(renderLoop);
            }
            rafRef.current = requestAnimationFrame(renderLoop);
        }

        init();

        return () => {
            destroyed = true;
            cancelAnimationFrame(rafRef.current);
            pipelineRef.current?.destroy();
            pipelineRef.current = null;
            deviceRef.current?.destroy();
            deviceRef.current = null;
            ctxRef.current = null;
        };
    }, [isActive, gpuReady, effectType]); // Only type change triggers re-init

    if (!isActive) return null;

    if (gpuReady === null) {
        return (
            <div className="h-32 w-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center">
                <span className="text-xs text-gray-400">Detecting GPU...</span>
            </div>
        );
    }

    if (gpuReady === false) {
        return (
            <div className="h-32 w-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center">
                <span className="text-xs text-gray-400">Preview unavailable (WebGPU not supported in this browser)</span>
            </div>
        );
    }

    return (
        <div className="relative h-32 w-full rounded-lg overflow-hidden border border-gray-200 bg-black">
            <canvas
                ref={canvasRef}
                className="w-full h-full"
            />
        </div>
    );
}
