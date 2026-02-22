import { NodeViewWrapper } from '@tiptap/react';
import { LayoutTemplate, Link as LinkIcon, Image as ImageIcon, Upload, Search } from 'lucide-react';
import React, { useState } from 'react';
import { BlockWidthControl } from '../BlockWidthControl';

// Unified Input Helper
const Input = ({ value, onChange, placeholder, className = "" }: any) => (
    <input
        className={`flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm shadow-sm transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder:text-gray-400 ${className}`}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

const Label = ({ children, icon: Icon }: any) => (
    <div className="flex items-center gap-2 mb-1.5 text-xs font-semibold text-gray-600">
        {Icon && <Icon className="w-3.5 h-3.5 text-indigo-500" />}
        {children}
    </div>
);

export function HeroEditor(props: any) {
    const { headline, subheadline, ctaText, ctaLink, style, imageSrc, blockWidth } = props.node.attrs;
    const [uploading, setUploading] = useState(false);
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

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
                            <option value="minimal">Minimal</option>
                        </select>
                    </div>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Headline & Text</Label>
                            <Input value={headline} onChange={(v: string) => update('headline', v)} className="font-bold" placeholder="Headline" />
                            <Input value={subheadline} onChange={(v: string) => update('subheadline', v)} placeholder="Subheadline" />
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
            </div>
        </NodeViewWrapper>
    );
}
