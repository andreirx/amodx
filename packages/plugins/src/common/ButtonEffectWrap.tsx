/**
 * Button overlay effect wrapper — Option A compositing.
 *
 * Renders the EffectCanvas BEHIND the button (same opaque canvas used for
 * backgrounds — works on every browser including Firefox). A dedicated
 * background overlay div provides the button's fill color at configurable
 * opacity — the effect bleeds through the semi-transparent overlay.
 *
 * Architecture: Three z-layers within a positioned container:
 *   z-0:  EffectCanvas — opaque effect rendering
 *   z-[5]: Background overlay — bg-primary (or custom bgClass) with opacity
 *   z-10: Button text/chrome — transparent background, text protection
 *
 * Fallback chain:
 *   1. No effect configured → renders children bare, no wrapper div.
 *   2. Effect configured but WebGPU unavailable → EffectCanvas renders null,
 *      onActive stays false → overlay fully opaque. Visually identical to no effect.
 *   3. Effect configured + WebGPU works → canvas renders, overlay semi-transparent.
 *   4. Scroll out of viewport → pipeline destroyed, onActive(false) → overlay opaque.
 *
 * Button text protection: when effect is active, text gets a CSS stroke + shadow
 * halo. Plugin render components read --btn-text-stroke CSS variable (0 or 1)
 * and apply stroke/shadow via calc(). The color is var(--primary) directly (no
 * hsl() wrapper — --primary stores hex colors, not HSL triplets).
 *
 * Why a separate overlay instead of button background opacity?
 *   --primary is stored as a hex color (e.g. "#6366f1"), not as HSL triplets.
 *   CSS like hsl(var(--primary) / 0.85) is invalid when --primary is hex.
 *   A separate div with bg-primary + opacity works with ANY color format.
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
    /**
     * Additional classes on the wrapper div.
     * Default: "inline-flex" (for inline CTA/Hero buttons).
     * Use "block" for full-width buttons (Contact form).
     */
    className?: string;
    /**
     * Tailwind class for the background overlay color.
     * Default: "bg-primary" — matches most buttons.
     * Use "bg-background" for inverted buttons (e.g. band-style CTA on primary bg).
     */
    bgClass?: string;
}

export function ButtonEffectWrap({ effect, children, className = "inline-flex", bgClass = "bg-primary" }: ButtonEffectWrapProps) {
    const [active, setActive] = useState(false);

    // No effect configured → render children bare
    if (!effect || !effect.type || effect.type === "none") return <>{children}</>;

    const overlayOpacity = effect.overlayOpacity ?? 0.85;

    return (
        <div
            className={`relative overflow-hidden rounded-lg ${className}`}
            style={{
                // Children read these CSS variables for text protection + bg transparency
                '--btn-bg-color': 'transparent',
                '--btn-text-stroke': active ? '1' : '0',
            } as React.CSSProperties}
        >
            {/* z-0: Effect canvas — opaque rendering, same component as backgrounds */}
            <Suspense fallback={null}>
                <EffectCanvas
                    effect={effect}
                    pointerMode="document"
                    onActive={setActive}
                />
            </Suspense>
            {/* z-[5]: Background overlay — provides button fill color at configurable opacity.
                When inactive: opacity 1 (fully covers effect → visually identical to normal button).
                When active: opacity e.g. 0.85 (effect bleeds through the 15% gap). */}
            <div
                className={`absolute inset-0 z-[5] ${bgClass} transition-opacity duration-300`}
                style={{ opacity: active ? overlayOpacity : 1 }}
            />
            {/* z-10: Button chrome + text — background is transparent (overlay provides color) */}
            <div className="relative z-10">
                {children}
            </div>
        </div>
    );
}
