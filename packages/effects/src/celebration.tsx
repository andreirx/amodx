/**
 * @amodx/effects/celebration — Order confirmation celebration overlay
 *
 * "use client" — self-contained GPU lifecycle (own detection, own device).
 *
 * Hardcoded behavior (not configurable per tenant):
 *   - Confetti particles with gravity, rotation, and fade
 *   - 4-phase timeline: darken → animate → fade out → unmount
 *   - If GPU unavailable: renders nothing (confirmation page unaffected)
 *
 * Used in ConfirmationPageView:
 *   <CelebrationOverlay />
 *   <div>{order details}</div>
 */

"use client";

import { useRef, useEffect, useState } from "react";
import { detectGpuTier, isMobileDevice } from "./detection.js";
import { createEffect } from "./pipelines/map.js";
import { surfaceConfig, canvasPixelSize } from "./pipelines/base.js";
import type { EffectPipeline } from "./types.js";

const CELEBRATION_DURATION_MS = 4500;

/**
 * Full-screen confetti overlay. Self-manages its entire lifecycle:
 *   mount → detect GPU → init pipeline → animate → unmount
 *
 * Renders nothing if GPU is unavailable or reduced motion is preferred.
 */
export function CelebrationOverlay() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        let destroyed = false;

        async function run() {
            const tier = await detectGpuTier();
            if (tier === "none" || destroyed) {
                setVisible(false);
                return;
            }

            const canvas = canvasRef.current;
            if (!canvas || destroyed) return;

            const adapter = await navigator.gpu?.requestAdapter();
            if (!adapter || destroyed) {
                setVisible(false);
                return;
            }

            const device = await adapter.requestDevice();
            if (destroyed) {
                device.destroy();
                return;
            }

            const ctx = canvas.getContext("webgpu");
            if (!ctx || destroyed) {
                device.destroy();
                setVisible(false);
                return;
            }

            const config = surfaceConfig(tier);
            ctx.configure({ device, ...config });

            const mobile = isMobileDevice();
            const { width, height } = canvasPixelSize(
                window.innerWidth,
                window.innerHeight,
                mobile,
            );
            canvas.width = width;
            canvas.height = height;

            const maybePipeline = createEffect("confetti");
            if (!maybePipeline || destroyed) {
                device.destroy();
                setVisible(false);
                return;
            }
            // Narrowed to non-null — safe to use in nested frame() closure
            const pipeline: EffectPipeline = maybePipeline;

            await pipeline.init(device, config.format, canvas, {
                colors: ["#f59e0b", "#ef4444", "#6366f1", "#10b981", "#ec4899", "#06b6d4"],
                speed: 1.0,
                intensity: 1.0,
                tier,
                isMobile: mobile,
            });

            if (destroyed) {
                pipeline.destroy();
                device.destroy();
                return;
            }

            // Render loop — runs for CELEBRATION_DURATION_MS then auto-cleans
            const startTime = performance.now();
            function frame() {
                if (destroyed) return;

                const elapsed = performance.now() - startTime;
                if (elapsed > CELEBRATION_DURATION_MS) {
                    // Animation complete — clean up
                    pipeline.destroy();
                    device.destroy();
                    setVisible(false);
                    return;
                }

                const time = elapsed / 1000;
                const encoder = device.createCommandEncoder();
                const texture = ctx!.getCurrentTexture();
                const view = texture.createView();

                pipeline.frame(encoder, view, time, null);
                device.queue.submit([encoder.finish()]);
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
        }

        run();

        return () => {
            destroyed = true;
        };
    }, []);

    if (!visible) return null;

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 z-[9999] pointer-events-none"
            style={{ width: "100vw", height: "100vh" }}
        />
    );
}
