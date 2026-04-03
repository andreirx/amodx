/**
 * Button effect compositor — four-layer shell + chip architecture.
 *
 * Renders a GPU-powered effect as a decorative shell around an opaque inner
 * label surface. Text/icons sit on the solid chip and render with normal
 * browser painting — no WebkitTextStroke, no textShadow halo, no paintOrder
 * tricks. Readability is a deterministic layout property, not a browser paint
 * side effect.
 *
 * Layer stack (inside a positioned container with overflow-hidden + rounded):
 *   z-0:   EffectCanvas — opaque GPU effect fills the full button area
 *   z-[5]: Base overlay — bg fill at configurable opacity (0..1).
 *          At 0: full effect visible. At 1: effect fully covered.
 *   z-[8]: Label surface — solid opaque chip, inset from edges, carries the
 *          button's text background color. Effect shows as a decorative
 *          border/glow in the gap between the chip edge and the outer shell.
 *   z-10:  Children (text, icons) — normal rendering on the opaque chip.
 *
 * Fallback chain:
 *   1. No effect configured → renders children bare, no wrapper.
 *   2. Effect configured but WebGPU unavailable → canvas renders null,
 *      onActive stays false → overlay + chip fully opaque. Visually normal.
 *   3. Effect active → canvas renders, overlay at configured opacity,
 *      chip opaque, text crisp regardless of effect noise level.
 *   4. Scroll out of viewport → pipeline destroyed, onActive(false) →
 *      overlay goes opaque. Seamless fallback.
 *
 * Migration note: replaces the previous three-layer model that used
 * --btn-text-stroke / --btn-bg-color CSS variables for text protection.
 * Those variables are no longer set or consumed. Consumers no longer need
 * special btnStyle objects — just normal button classes.
 */

import React, { Suspense, lazy, useState } from "react";
import type { EffectConfig } from "@amodx/shared";

const EffectCanvas = lazy(() =>
    import("@amodx/effects/render").then(m => ({ default: m.EffectCanvas }))
);

interface ButtonEffectWrapProps {
    /** Unified effect config. null/undefined or type "none" → bare children. */
    effect?: EffectConfig | null;
    children: React.ReactNode;
    /** Classes on the outer shell container. Default: "inline-flex". */
    className?: string;
    /** Tailwind class for the base overlay color. Default: "bg-primary". */
    bgClass?: string;
    /** Tailwind class for the inner label chip color. Default: "bg-primary". */
    labelSurfaceClass?: string;
    /** Inset in pixels for the label chip from the shell edge. Default: 2. */
    labelInset?: number;
}

export function ButtonEffectWrap({
    effect,
    children,
    className = "inline-flex",
    bgClass = "bg-primary",
    labelSurfaceClass = "bg-primary",
    labelInset = 2,
}: ButtonEffectWrapProps) {
    const [active, setActive] = useState(false);

    // No effect configured → render children bare
    if (!effect || !effect.type || effect.type === "none") return <>{children}</>;

    const overlayOpacity = effect.overlayOpacity ?? 0.85;

    return (
        <div className={`relative overflow-hidden rounded-lg ${className}`}>
            {/* z-0: Effect canvas — opaque GPU rendering, fills full shell area */}
            <Suspense fallback={null}>
                <EffectCanvas
                    effect={effect}
                    pointerMode="document"
                    onActive={setActive}
                />
            </Suspense>

            {/* z-[5]: Base overlay — controls how much effect bleeds through the shell.
                When inactive: opacity 1 (fully covers effect → normal button appearance).
                When active: user-configured opacity (0 = full effect, 1 = no effect visible). */}
            <div
                className={`absolute inset-0 z-[5] ${bgClass} transition-opacity duration-300`}
                style={{ opacity: active ? overlayOpacity : 1 }}
            />

            {/* z-[8]: Label surface — solid opaque chip, inset from shell edge.
                The gap between the chip and the outer shell is where the effect shows
                as a decorative border/glow. Text readability is guaranteed because
                this surface is fully opaque regardless of effect state. */}
            <div
                className={`absolute z-[8] ${labelSurfaceClass} rounded-md`}
                style={{
                    inset: `${labelInset}px`,
                }}
            />

            {/* z-10: Children (text, icons) — normal rendering on the opaque chip */}
            <div className="relative z-10">
                {children}
            </div>
        </div>
    );
}
