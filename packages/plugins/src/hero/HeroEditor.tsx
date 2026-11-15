import { NodeViewWrapper } from '@tiptap/react';
import { LayoutTemplate, Link as LinkIcon, Image as ImageIcon, Upload, Search, Plus, Trash2 } from 'lucide-react';
import React, { useState } from 'react';
import { BlockWidthControl } from '../BlockWidthControl';
import { EffectControls } from '../common/EffectControls';
import { InlineRichTextField } from '../common/InlineRichTextField';

// Unified Input Helper
const Input = ({ value, onChange, placeholder, className = "", maxLength }: any) => (
    <input
        className={`flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm shadow-sm transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder:text-gray-400 ${className}`}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
    />
);

type HeroStat = { value: string; label: string };

/**
 * SHOP-LOOK-1B: the value an option control stores. A cleared option goes back to `null` (absent, today's HTML), so
 * nothing is stored as `""` or `[]`: a blank text (whitespace only), an empty list, or the option's default choice
 * (`auto`, `rounded`, `plain`) → `null`; any other value is stored unchanged (a text is not trimmed while it is typed;
 * the render trims it).
 */
export function storedOption<T extends string | HeroStat[]>(value: T, defaultChoice?: string): T | null {
    if (Array.isArray(value)) return value.length === 0 ? null : value;
    if (value.trim() === "") return null;
    return defaultChoice !== undefined && value === defaultChoice ? null : value;
}

const selectClass = "w-full h-8 text-xs border border-gray-200 rounded px-2 bg-white focus:border-indigo-500 outline-none";

const Label = ({ children, icon: Icon }: any) => (
    <div className="flex items-center gap-2 mb-1.5 text-xs font-semibold text-gray-600">
        {Icon && <Icon className="w-3.5 h-3.5 text-indigo-500" />}
        {children}
    </div>
);

export function HeroEditor(props: any) {
    const { headline, subheadline, subheadlineRich, ctaText, ctaLink, style, imageSrc, blockWidth, overlayOpacity, overlayColorToken, headlineColorToken, subheadlineColorToken } = props.node.attrs;
    const { eyebrow, headlineAccent, headlineAccentColorToken, secondaryCtaText, secondaryCtaLink, buttonShape, splitPanel } = props.node.attrs;
    const stats: HeroStat[] = Array.isArray(props.node.attrs.stats) ? props.node.attrs.stats : [];
    const [uploading, setUploading] = useState(false);
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });
    // SHOP-LOOK-1B: the new options store null when cleared (storedOption).
    const updateOption = (field: string, value: string | HeroStat[], defaultChoice?: string) => update(field, storedOption(value, defaultChoice));
    const setStat = (i: number, key: keyof HeroStat, v: string) => updateOption('stats', stats.map((s, j) => j === i ? { ...s, [key]: v } : s));

    const handleLibraryPick = () => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) pickFn((url: string) => update('imageSrc', url));
    };

    const handleUpload = async (file: File) => {
        setUploading(true);
        try {
            const uploadFn = props.editor.storage.image?.uploadFn;
            if (uploadFn) {
                const url = await uploadFn(file);
                update('imageSrc', url);
            }
        } catch (e) { console.error(e); }
        finally { setUploading(false); }
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Unified Header */}
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50 text-indigo-600">
                            <LayoutTemplate className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Hero Section</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-gray-200" />
                        <select
                            className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium shadow-sm outline-none focus:border-indigo-500"
                            value={style}
                            onChange={e => update('style', e.target.value)}
                        >
                            <option value="center">Center</option>
                            <option value="split">Split</option>
                            <option value="cover">Cover</option>
                            <option value="minimal">Minimal</option>
                        </select>
                    </div>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Headline & Text</Label>
                            <Input value={headline} onChange={(v: string) => update('headline', v)} className="font-bold" placeholder="Headline" />
                            <InlineRichTextField
                                value={subheadlineRich}
                                fallbackText={subheadline}
                                onChange={(segments, plainText) => {
                                    update('subheadlineRich', segments);
                                    update('subheadline', plainText);
                                }}
                                placeholder="Subheadline (bold / italic supported)"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Button Text</Label>
                                <Input value={ctaText} onChange={(v: string) => update('ctaText', v)} placeholder="Click Me" />
                            </div>
                            <div className="space-y-1">
                                <Label icon={LinkIcon}>Link</Label>
                                <Input value={ctaLink} onChange={(v: string) => update('ctaLink', v)} list="amodx-links" placeholder="/path" className="font-mono text-xs" />
                            </div>
                        </div>

                        {/* SHOP-LOOK-1B: label, second tone, second button, button shape, numbers. Empty = not shown. */}
                        <div className="space-y-2">
                            <Label>Label above the headline</Label>
                            <Input value={eyebrow} onChange={(v: string) => updateOption('eyebrow', v)} placeholder="e.g. Since 1998 (empty = none)" />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2 space-y-1">
                                <Label>Headline second tone</Label>
                                <Input value={headlineAccent} onChange={(v: string) => updateOption('headlineAccent', v)} placeholder="Shown after the headline (empty = none)" />
                            </div>
                            <div className="space-y-1">
                                <Label>Second tone colour</Label>
                                <select
                                    value={headlineAccentColorToken || 'auto'}
                                    onChange={e => updateOption('headlineAccentColorToken', e.target.value, 'auto')}
                                    className={selectClass}
                                >
                                    <option value="auto">Auto (Primary)</option>
                                    <option value="white">White</option>
                                    <option value="foreground">Foreground</option>
                                    <option value="primary">Primary</option>
                                    <option value="primary-foreground">Primary FG</option>
                                    <option value="muted-foreground">Muted FG</option>
                                    <option value="accent-foreground">Accent FG</option>
                                </select>
                            </div>
                        </div>
                        {style !== 'minimal' && (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label>Second Button Text</Label>
                                        <Input value={secondaryCtaText} onChange={(v: string) => updateOption('secondaryCtaText', v)} placeholder="Outline button (empty = none)" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label icon={LinkIcon}>Second Button Link</Label>
                                        <Input value={secondaryCtaLink} onChange={(v: string) => updateOption('secondaryCtaLink', v)} list="amodx-links" placeholder="/path" className="font-mono text-xs" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label>Button Shape</Label>
                                        <select
                                            value={buttonShape || 'rounded'}
                                            onChange={e => updateOption('buttonShape', e.target.value, 'rounded')}
                                            className={selectClass}
                                        >
                                            <option value="rounded">Rounded</option>
                                            <option value="pill">Pill</option>
                                        </select>
                                    </div>
                                    {style === 'split' && (
                                        <div className="space-y-1">
                                            <Label>Text Panel</Label>
                                            <select
                                                value={splitPanel || 'plain'}
                                                onChange={e => updateOption('splitPanel', e.target.value, 'plain')}
                                                className={selectClass}
                                            >
                                                <option value="plain">Plain (page background)</option>
                                                <option value="inverse">Inverse (dark panel)</option>
                                            </select>
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label>Numbers (up to 4; an empty value is not shown)</Label>
                                    {stats.map((item, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <Input value={item.value} onChange={(v: string) => setStat(i, 'value', v)} placeholder="25+" maxLength={12} className="w-24 font-bold" />
                                            <Input value={item.label} onChange={(v: string) => setStat(i, 'label', v)} placeholder="Caption, e.g. years in business" maxLength={40} />
                                            <button
                                                type="button"
                                                aria-label="Remove number"
                                                onClick={() => updateOption('stats', stats.filter((_, j) => j !== i))}
                                                className="p-1 text-gray-400 hover:text-red-500"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {stats.length < 4 && (
                                        <button
                                            type="button"
                                            onClick={() => updateOption('stats', [...stats, { value: '', label: '' }])}
                                            className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                                        >
                                            <Plus className="w-3.5 h-3.5" /> Add number
                                        </button>
                                    )}
                                </div>
                            </>
                        )}

                        <EffectControls
                            effect={props.node.attrs.buttonEffect}
                            onChange={v => update('buttonEffect', v)}
                            scope="button"
                        />
                    </div>

                    <div className="border-l pl-6 border-dashed border-gray-200">
                        <Label icon={ImageIcon}>Hero Image</Label>
                        <div className="mt-2 relative aspect-video bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 hover:border-indigo-300 hover:bg-indigo-50/10 transition-colors group/upload overflow-hidden">
                            {imageSrc ? (
                                <>
                                    <img src={imageSrc} className="w-full h-full object-cover" alt="Hero" />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/upload:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                                        <label className="cursor-pointer bg-white text-gray-900 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-100">
                                            Replace
                                            <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} accept="image/*" />
                                        </label>
                                        <button
                                            onClick={() => update('imageSrc', '')}
                                            className="bg-red-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-red-700"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="flex gap-2">
                                    <label className="cursor-pointer text-[10px] font-bold text-indigo-600 hover:underline">
                                        UPLOAD
                                        <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} accept="image/*" />
                                    </label>
                                    <span className="text-[10px]">OR</span>
                                    <button onClick={handleLibraryPick} className="text-[10px] font-bold text-indigo-600 hover:underline">LIBRARY</button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Cover mode controls — overlay + color tokens */}
                {style === 'cover' && (
                    <div className="px-5 pb-2 space-y-3">
                        <div className="flex items-center gap-3">
                            <Label>Overlay</Label>
                            <input
                                type="range"
                                min={0} max={1} step={0.05}
                                value={overlayOpacity ?? 0.5}
                                onChange={e => update('overlayOpacity', parseFloat(e.target.value))}
                                className="flex-1 accent-indigo-600"
                            />
                            <span className="text-xs text-gray-500 font-mono w-8 text-right">{Math.round((overlayOpacity ?? 0.5) * 100)}%</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Overlay Color</label>
                                <select
                                    value={overlayColorToken || 'auto'}
                                    onChange={e => update('overlayColorToken', e.target.value)}
                                    className="w-full h-8 text-xs border border-gray-200 rounded px-2 bg-white focus:border-indigo-500 outline-none"
                                >
                                    <option value="auto">Auto (Black)</option>
                                    <option value="black">Black</option>
                                    <option value="primary">Primary</option>
                                    <option value="foreground">Foreground</option>
                                    <option value="muted">Muted</option>
                                    <option value="accent">Accent</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Headline</label>
                                <select
                                    value={headlineColorToken || 'auto'}
                                    onChange={e => update('headlineColorToken', e.target.value)}
                                    className="w-full h-8 text-xs border border-gray-200 rounded px-2 bg-white focus:border-indigo-500 outline-none"
                                >
                                    <option value="auto">Auto (White)</option>
                                    <option value="white">White</option>
                                    <option value="foreground">Foreground</option>
                                    <option value="primary">Primary</option>
                                    <option value="primary-foreground">Primary FG</option>
                                    <option value="muted-foreground">Muted FG</option>
                                    <option value="accent-foreground">Accent FG</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Subheadline</label>
                                <select
                                    value={subheadlineColorToken || 'auto'}
                                    onChange={e => update('subheadlineColorToken', e.target.value)}
                                    className="w-full h-8 text-xs border border-gray-200 rounded px-2 bg-white focus:border-indigo-500 outline-none"
                                >
                                    <option value="auto">Auto (White 90%)</option>
                                    <option value="white">White</option>
                                    <option value="foreground">Foreground</option>
                                    <option value="primary">Primary</option>
                                    <option value="primary-foreground">Primary FG</option>
                                    <option value="muted-foreground">Muted FG</option>
                                    <option value="accent-foreground">Accent FG</option>
                                </select>
                            </div>
                        </div>
                    </div>
                )}

                <div className="px-5 pb-5">
                    <EffectControls
                        effect={props.node.attrs.effect}
                        onChange={v => update('effect', v)}
                    />
                </div>
            </div>
        </NodeViewWrapper>
    );
}
