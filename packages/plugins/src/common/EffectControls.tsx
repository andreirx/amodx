/**
 * Admin-side effect configuration controls for block editors.
 *
 * Imports EFFECT_LIST from @amodx/effects root entry (lightweight —
 * metadata only, no GPU code, no shaders).
 *
 * Renders a dropdown of available background effects, plus color pickers
 * and speed/intensity sliders when an effect is selected.
 *
 * Used inside Tiptap NodeView editors (HeroEditor, CtaEditor, etc.)
 * to let content editors configure GPU background effects per block.
 */

import React from "react";
import { EFFECT_LIST } from "@amodx/effects";
import type { BlockEffectConfig } from "@amodx/shared";
import { EffectPreview } from "./EffectPreview";

/** Only show effects that support "background" scope in block editors */
const backgroundEffects = EFFECT_LIST.filter(e => e.scopes.includes("background"));

interface EffectControlsProps {
    effect: BlockEffectConfig | null | undefined;
    onChange: (effect: BlockEffectConfig) => void;
}

export function EffectControls({ effect, onChange }: EffectControlsProps) {
    const currentType = effect?.type || "none";
    const meta = backgroundEffects.find(e => e.key === currentType);

    const update = (field: string, value: any) => {
        const merged: any = {
            type: currentType,
            colors: effect?.colors || meta?.defaultColors || [],
            speed: effect?.speed ?? 1.0,
            intensity: effect?.intensity ?? 0.25,
            invertY: effect?.invertY ?? false,
            bgColor: effect?.bgColor,
            [field]: value,
        };
        if (effect?.bands !== undefined) merged.bands = effect.bands;
        if (field === "bands") merged.bands = value;
        onChange(merged);
    };

    return (
        <div className="space-y-3 border-t border-gray-100 pt-4 mt-4">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                Background Effect
            </label>

            <select
                className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-indigo-500 outline-none"
                value={currentType}
                onChange={e => {
                    const key = e.target.value;
                    if (key === "none") {
                        onChange({ type: "none", colors: [], speed: 1.0, intensity: 0.25, invertY: false });
                        return;
                    }
                    const newMeta = backgroundEffects.find(ef => ef.key === key);
                    onChange({
                        type: key,
                        colors: newMeta?.defaultColors || [],
                        speed: 1.0,
                        intensity: 0.25,
                        invertY: false,
                    });
                }}
            >
                <option value="none">None</option>
                {backgroundEffects.map(e => (
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

                    {/* Live GPU preview */}
                    <EffectPreview effect={effect} />
                </>
            )}
        </div>
    );
}
