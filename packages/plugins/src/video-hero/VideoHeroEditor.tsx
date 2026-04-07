import { NodeViewWrapper } from '@tiptap/react';
import { Film, Link as LinkIcon, Image as ImageIcon, Upload } from 'lucide-react';
import React, { useState } from 'react';
import { BlockWidthControl } from '../BlockWidthControl';
import { InlineRichTextField } from '../common/InlineRichTextField';

const Input = ({ value, onChange, placeholder, className = "" }: any) => (
    <input
        className={`flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm shadow-sm transition-all focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none placeholder:text-gray-400 ${className}`}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

const Label = ({ children, icon: Icon }: any) => (
    <div className="flex items-center gap-2 mb-1.5 text-xs font-semibold text-gray-600">
        {Icon && <Icon className="w-3.5 h-3.5 text-violet-500" />}
        {children}
    </div>
);

export function VideoHeroEditor(props: any) {
    const {
        headline, subheadline, subheadlineRich,
        videoSrc, posterSrc, ctaText, ctaLink,
        blockWidth, overlayOpacity,
        overlayColorToken, headlineColorToken, subheadlineColorToken,
        muted, loop,
    } = props.node.attrs;
    const [uploading, setUploading] = useState<"video" | "poster" | null>(null);
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const handleUpload = async (file: File, field: string, type: "video" | "poster") => {
        const uploadFn = props.editor.storage.image?.uploadFn;
        if (!uploadFn) return;
        setUploading(type);
        try {
            const url = await uploadFn(file);
            update(field, url);
        } catch (e: any) {
            alert(e.message || "Upload failed");
        } finally {
            setUploading(null);
        }
    };

    const handlePickVideo = () => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) pickFn((url: string) => update('videoSrc', url), { mediaType: "video" });
    };

    const handlePickPoster = () => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) pickFn((url: string) => update('posterSrc', url), { mediaType: "image" });
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-violet-50 text-violet-600">
                            <Film className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Video Hero</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-gray-200" />
                        <label className="flex items-center gap-1.5 text-xs text-gray-600">
                            <input type="checkbox" checked={muted ?? true} onChange={e => update('muted', e.target.checked)} className="accent-violet-600" />
                            Muted
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-gray-600">
                            <input type="checkbox" checked={loop ?? true} onChange={e => update('loop', e.target.checked)} className="accent-violet-600" />
                            Loop
                        </label>
                    </div>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left: text controls */}
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
                                <Input value={ctaText} onChange={(v: string) => update('ctaText', v)} placeholder="Shop Now" />
                            </div>
                            <div className="space-y-1">
                                <Label icon={LinkIcon}>Link</Label>
                                <Input value={ctaLink} onChange={(v: string) => update('ctaLink', v)} list="amodx-links" placeholder="/path" className="font-mono text-xs" />
                            </div>
                        </div>
                    </div>

                    {/* Right: media controls */}
                    <div className="space-y-4">
                        {/* Video source */}
                        <div>
                            <Label icon={Film}>Background Video</Label>
                            <div className="mt-1 relative aspect-video bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 overflow-hidden group/vid">
                                {uploading === "video" ? (
                                    <div className="flex items-center gap-2 text-xs"><Upload className="w-4 h-4 animate-pulse" /> Uploading video...</div>
                                ) : videoSrc ? (
                                    <>
                                        <video src={videoSrc} muted className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/vid:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                                            <label className="cursor-pointer bg-white text-gray-900 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-100">
                                                Replace
                                                <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'videoSrc', 'video')} accept="video/*" />
                                            </label>
                                            <button onClick={handlePickVideo} className="bg-white text-gray-900 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-100">Library</button>
                                            <button onClick={() => update('videoSrc', '')} className="bg-red-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-red-700">Remove</button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex gap-2 items-center">
                                        <label className="cursor-pointer text-[10px] font-bold text-violet-400 hover:underline">
                                            UPLOAD
                                            <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'videoSrc', 'video')} accept="video/*" />
                                        </label>
                                        <span className="text-[10px] text-gray-500">OR</span>
                                        <button onClick={handlePickVideo} className="text-[10px] font-bold text-violet-400 hover:underline">LIBRARY</button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Poster image */}
                        <div>
                            <Label icon={ImageIcon}>Poster Image (fallback)</Label>
                            <div className="mt-1 relative h-20 bg-gray-50 rounded-lg border border-dashed border-gray-200 flex items-center justify-center text-gray-400 overflow-hidden group/poster">
                                {uploading === "poster" ? (
                                    <div className="flex items-center gap-2 text-xs"><Upload className="w-4 h-4 animate-pulse" /> Uploading...</div>
                                ) : posterSrc ? (
                                    <>
                                        <img src={posterSrc} className="h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/poster:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                                            <label className="cursor-pointer bg-white text-gray-900 px-2 py-1 rounded text-[10px] font-medium hover:bg-gray-100">
                                                Replace
                                                <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'posterSrc', 'poster')} accept="image/*" />
                                            </label>
                                            <button onClick={() => update('posterSrc', '')} className="bg-red-600 text-white px-2 py-1 rounded text-[10px] font-medium hover:bg-red-700">Remove</button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex gap-2 items-center">
                                        <label className="cursor-pointer text-[10px] font-bold text-violet-400 hover:underline">
                                            UPLOAD
                                            <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'posterSrc', 'poster')} accept="image/*" />
                                        </label>
                                        <span className="text-[10px] text-gray-500">OR</span>
                                        <button onClick={handlePickPoster} className="text-[10px] font-bold text-violet-400 hover:underline">LIBRARY</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Cover controls: overlay + color tokens */}
                <div className="px-5 pb-4 space-y-3">
                    <div className="flex items-center gap-3">
                        <Label>Overlay</Label>
                        <input
                            type="range"
                            min={0} max={1} step={0.05}
                            value={overlayOpacity ?? 0.4}
                            onChange={e => update('overlayOpacity', parseFloat(e.target.value))}
                            className="flex-1 accent-violet-600"
                        />
                        <span className="text-xs text-gray-500 font-mono w-8 text-right">{Math.round((overlayOpacity ?? 0.4) * 100)}%</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Overlay Color</label>
                            <select value={overlayColorToken || 'auto'} onChange={e => update('overlayColorToken', e.target.value)} className="w-full h-8 text-xs border border-gray-200 rounded px-2 bg-white focus:border-violet-500 outline-none">
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
                            <select value={headlineColorToken || 'auto'} onChange={e => update('headlineColorToken', e.target.value)} className="w-full h-8 text-xs border border-gray-200 rounded px-2 bg-white focus:border-violet-500 outline-none">
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
                            <select value={subheadlineColorToken || 'auto'} onChange={e => update('subheadlineColorToken', e.target.value)} className="w-full h-8 text-xs border border-gray-200 rounded px-2 bg-white focus:border-violet-500 outline-none">
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
            </div>
        </NodeViewWrapper>
    );
}
