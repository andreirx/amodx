/**
 * Unified admin-side effect configuration controls.
 *
 * Used for BOTH background effects and button overlay effects.
 * The `scope` prop filters the effect type dropdown to show only
 * effects that support the given context.
 *
 * When scope is "button", an extra Overlay Opacity slider appears
 * (controls how transparent the button background becomes).
 *
 * Imports EFFECT_LIST from @amodx/effects root entry (lightweight —
 * metadata only, no GPU code, no shaders).
 */

import React from "react";
import { EFFECT_LIST } from "@amodx/effects";
import type { EffectConfig } from "@amodx/shared";
import { EffectPreview } from "./EffectPreview";

interface EffectControlsProps {
    effect: EffectConfig | null | undefined;
    onChange: (effect: EffectConfig) => void;
    /** Which scope to filter effects by. Default: "background". */
    scope?: "background" | "button";
    /** Label shown above the dropdown. Default: "Background Effect" or "Button Effect". */
    label?: string;
}

export function EffectControls({ effect, onChange, scope = "background", label }: EffectControlsProps) {
    const scopedEffects = EFFECT_LIST.filter(e => e.scopes.includes(scope));
    const currentType = effect?.type || "none";
    const meta = scopedEffects.find(e => e.key === currentType);
    const displayLabel = label || (scope === "button" ? "Button Effect" : "Background Effect");

    const update = (field: string, value: any) => {
        const merged: any = {
            type: currentType,
            colors: effect?.colors || meta?.defaultColors || [],
            speed: effect?.speed ?? 1.0,
            intensity: effect?.intensity ?? 0.25,
            invertY: effect?.invertY ?? false,
            bgColor: effect?.bgColor,
            overlayOpacity: effect?.overlayOpacity ?? 0.85,
            [field]: value,
        };
        if (effect?.bands !== undefined) merged.bands = effect.bands;
        if (field === "bands") merged.bands = value;
        onChange(merged);
    };

    return (
        <div className="space-y-3 border-t border-gray-100 pt-4 mt-4">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                {displayLabel}
            </label>

            <select
                className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-indigo-500 outline-none"
                value={currentType}
                onChange={e => {
                    const key = e.target.value;
                    if (key === "none") {
                        onChange({ type: "none", colors: [], speed: 1.0, intensity: 0.25, invertY: false, overlayOpacity: 0.85 });
                        return;
                    }
                    const newMeta = scopedEffects.find(ef => ef.key === key);
                    onChange({
                        type: key,
                        colors: newMeta?.defaultColors || [],
                        speed: 1.0,
                        intensity: 0.25,
                        invertY: false,
                        overlayOpacity: 0.85,
                    });
                }}
            >
                <option value="none">None</option>
                {scopedEffects.map(e => (
                    <option key={e.key} value={e.key}>{e.label}</option>
                ))}
            </select>

            {currentType !== "none" && (
                <>
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                            Colors
                        </label>
                        <div className="flex gap-2">
                            {(effect?.colors || []).map((c, i) => (
                                <input
                                    key={i}
                                    type="color"
                                    value={c}
                                    onChange={e => {
                                        const newColors = [...(effect?.colors || [])];
                                        newColors[i] = e.target.value;
                                        update("colors", newColors);
                                    }}
                                    className="w-8 h-8 rounded border border-gray-200 cursor-pointer"
                                />
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                            Speed: {(effect?.speed ?? 1.0).toFixed(1)}
                        </label>
                        <input
                            type="range"
                            min="0.1"
                            max="3.0"
                            step="0.1"
                            value={effect?.speed ?? 1.0}
                            onChange={e => update("speed", parseFloat(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                            Intensity: {(effect?.intensity ?? 0.25).toFixed(3)}
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="0.5"
                            step="0.001"
                            value={effect?.intensity ?? 0.25}
                            onChange={e => update("intensity", parseFloat(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    {(currentType === "aurora" || currentType === "plasma" || currentType === "cellular" || currentType === "clouds") && (
                        <div>
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                                {{ aurora: "Bands", plasma: "Arcs", cellular: "Cells", clouds: "Detail" }[currentType] || "Detail"}: {effect?.bands ?? 8}
                            </label>
                            <input
                                type="range"
                                min="2"
                                max="32"
                                step="1"
                                value={effect?.bands ?? 8}
                                onChange={e => update("bands", parseInt(e.target.value, 10))}
                                className="w-full"
                            />
                        </div>
                    )}

                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={effect?.invertY ?? false}
                                onChange={e => update("invertY", e.target.checked)}
                                className="w-3.5 h-3.5 rounded border-gray-300"
                            />
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                Invert
                            </span>
                        </label>

                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                BG
                            </span>
                            <input
                                type="color"
                                value={effect?.bgColor || "#000010"}
                                onChange={e => update("bgColor", e.target.value)}
                                className="w-6 h-6 rounded border border-gray-200 cursor-pointer"
                            />
                            {effect?.bgColor && (
                                <button
                                    onClick={() => update("bgColor", undefined)}
                                    className="text-[9px] text-gray-400 hover:text-red-500 underline"
                                >
                                    reset
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Overlay opacity — only shown for button scope */}
                    {scope === "button" && (
                        <div>
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                                Button Opacity: {((effect?.overlayOpacity ?? 0.85) * 100).toFixed(0)}%
                            </label>
                            <input
                                type="range"
                                min="0.5"
                                max="1.0"
                                step="0.05"
                                value={effect?.overlayOpacity ?? 0.85}
                                onChange={e => update("overlayOpacity", parseFloat(e.target.value))}
                                className="w-full"
                            />
                        </div>
                    )}

                    {/* Live GPU preview */}
                    <EffectPreview effect={effect} />
                </>
            )}
        </div>
    );
}
