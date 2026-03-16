/**
 * Admin-side glow configuration controls for block editors.
 *
 * Simple checkbox + color picker + intensity slider.
 * Used in CTA, Hero, and Contact editors to let content editors
 * toggle HDR button glow per block.
 *
 * The glow config is stored in the block's attrs as { enabled, color, intensity }.
 * GlowEffectConfigSchema in @amodx/shared validates the shape.
 */

import React from "react";
import type { GlowEffectConfig } from "@amodx/shared";

interface GlowControlsProps {
    glow: GlowEffectConfig | null | undefined;
    onChange: (glow: GlowEffectConfig) => void;
}

export function GlowControls({ glow, onChange }: GlowControlsProps) {
    const enabled = glow?.enabled ?? false;

    return (
        <div className="space-y-3 border-t border-gray-100 pt-4 mt-4">
            <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => onChange({
                        enabled: e.target.checked,
                        color: glow?.color || "#6366f1",
                        intensity: glow?.intensity ?? 1.0,
                    })}
                    className="w-3.5 h-3.5 rounded border-gray-300"
                />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    Button Glow
                </span>
            </label>

            {enabled && (
                <>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                            Color
                        </span>
                        <input
                            type="color"
                            value={glow?.color || "#6366f1"}
                            onChange={e => onChange({ ...glow!, color: e.target.value })}
                            className="w-8 h-8 rounded border border-gray-200 cursor-pointer"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                            Intensity: {(glow?.intensity ?? 1.0).toFixed(1)}
                        </label>
                        <input
                            type="range"
                            min="0.5"
                            max="3.0"
                            step="0.1"
                            value={glow?.intensity ?? 1.0}
                            onChange={e => onChange({ ...glow!, intensity: parseFloat(e.target.value) })}
                            className="w-full"
                        />
                    </div>
                </>
            )}
        </div>
    );
}
