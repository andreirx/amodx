/**
 * Button overlay effect wrapper — Option A compositing.
 *
 * Renders the EffectCanvas BEHIND the button (same opaque canvas used for
 * backgrounds — works on every browser including Firefox). The button gets
 * a semi-transparent background so the effect bleeds through.
 *
 * Fallback chain:
 *   1. No effect configured → renders children bare, no wrapper div.
 *   2. Effect configured but WebGPU unavailable → EffectCanvas renders null,
 *      onActive stays false → button fully opaque. Visually identical to no effect.
 *   3. Effect configured + WebGPU works → canvas behind, button semi-transparent.
 *   4. Scroll out of viewport → pipeline destroyed, onActive(false) → opaque.
 *
 * Button text protection: when effect is active, text gets a CSS stroke + shadow
 * halo in the primary color. This prevents text from becoming unreadable when
 * the effect shows through the semi-transparent button background.
 *
 * The CSS variable --btn-bg-alpha is set on the wrapper:
 *   - 1 (default / no effect) → button fully opaque
 *   - overlayOpacity value (e.g. 0.85) → button semi-transparent
 * Plugin render components reference this variable in button styles.
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
}

export function ButtonEffectWrap({ effect, children, className = "inline-flex" }: ButtonEffectWrapProps) {
    const [active, setActive] = useState(false);

    // No effect configured → render children bare
    if (!effect || !effect.type || effect.type === "none") return <>{children}</>;

    const overlayOpacity = effect.overlayOpacity ?? 0.85;

    return (
        <div
            className={`relative overflow-hidden rounded-lg ${className}`}
            style={{
                '--btn-bg-alpha': active ? String(overlayOpacity) : '1',
                '--btn-text-stroke': active ? '1' : '0',
            } as React.CSSProperties}
        >
            {/* Effect canvas behind button — same component as backgrounds, opaque, z-0 */}
            <Suspense fallback={null}>
                <EffectCanvas
                    effect={effect}
                    pointerMode="document"
                    onActive={setActive}
                />
            </Suspense>
            {/* Button on top — z-10, semi-transparent when effect active */}
            <div className="relative z-10">
                {children}
            </div>
        </div>
    );
}
