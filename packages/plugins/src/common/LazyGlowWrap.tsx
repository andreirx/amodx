/**
 * Lazy-loaded glow canvas wrapper for button elements.
 *
 * Same lazy-import pattern as LazyEffectCanvas: the @amodx/effects/render
 * chunk (GPU code, shaders) only loads when a button actually has glow
 * enabled. Zero impact on pages without glow effects.
 *
 * Creates a relative container around the button. GlowCanvas renders
 * absolutely behind the button with -inset-5 bleed. The button must
 * have "relative z-10" in its className to stack above the canvas.
 *
 * When glow is disabled or null, renders children bare (no wrapper).
 */

import React, { Suspense, lazy } from "react";
import type { GlowEffectConfig } from "@amodx/shared";

const GlowCanvas = lazy(() =>
    import("@amodx/effects/render").then(m => ({ default: m.GlowCanvas }))
);

interface LazyGlowWrapProps {
    glow?: GlowEffectConfig | null;
    children: React.ReactNode;
    /**
     * Additional classes on the wrapper div.
     * Default: "inline-flex" (for inline CTA/Hero buttons).
     * Use "block" for full-width buttons (Contact form).
     */
    className?: string;
}

export function LazyGlowWrap({ glow, children, className = "inline-flex" }: LazyGlowWrapProps) {
    if (!glow?.enabled) return <>{children}</>;

    return (
        <div className={`relative ${className}`}>
            <Suspense fallback={null}>
                <GlowCanvas glow={glow} />
            </Suspense>
            {children}
        </div>
    );
}
