/**
 * Read-path backward compatibility: converts old GlowEffectConfig format
 * to unified EffectConfig. Blocks saved before the unified effect system
 * have attrs.glow = { enabled, color, intensity }. New blocks use
 * attrs.buttonEffect = { type, colors, speed, intensity, ... }.
 *
 * This normalizer ensures both formats render correctly without
 * requiring a database migration.
 */

import type { EffectConfig } from "@amodx/shared";

export function resolveButtonEffect(attrs: any): EffectConfig | null {
    // New format takes priority
    if (attrs.buttonEffect?.type && attrs.buttonEffect.type !== "none") {
        return attrs.buttonEffect;
    }
    // Legacy glow format → convert
    if (attrs.glow?.enabled) {
        return {
            type: "glow",
            colors: [attrs.glow.color || "#6366f1"],
            speed: 1.0,
            timeOffset: 0,
            intensity: attrs.glow.intensity ?? 0.25,
            invertY: false,
            overlayOpacity: 0.85,
        };
    }
    return null;
}
