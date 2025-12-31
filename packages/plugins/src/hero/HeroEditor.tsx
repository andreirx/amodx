import { NodeViewWrapper } from '@tiptap/react';
import { LayoutTemplate, Type, Link as LinkIcon, Image as ImageIcon, Upload } from 'lucide-react';
import React, { useState } from 'react';
import { Search } from 'lucide-react';

// --- LOCAL UI HELPERS (No Shadcn dependency) ---

const Label = ({ children, icon: Icon }: any) => (
    <div className="flex items-center gap-2 mb-1.5">
        {Icon && <Icon className="w-3 h-3 text-indigo-500" />}
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{children}</label>
    </div>
);

const Input = ({ value, onChange, placeholder, className = "" }: any) => (
    <input
        className={`flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm shadow-sm transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder:text-gray-400 ${className}`}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

const Select = ({ value, onChange, options }: any) => (
    <select
        className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium shadow-sm outline-none focus:border-indigo-500 cursor-pointer"
        value={value}
        onChange={e => onChange(e.target.value)}
    >
        {options.map((o: string) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
    </select>
);

// --- COMPONENT ---

export function HeroEditor(props: any) {
    const { headline, subheadline, ctaText, ctaLink, style, imageSrc } = props.node.attrs;
    const [uploading, setUploading] = useState(false);
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    // 1. Inject Picker
    const handleLibraryPick = () => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) {
            pickFn((url: string) => update('imageSrc', url));
        } else {
            alert("Media Picker not connected");
        }
    };

    const handleUpload = async (file: File) => {
        setUploading(true);
        try {
            const uploadFn = props.editor.storage.image?.uploadFn;
            if (uploadFn) {
                const url = await uploadFn(file);
                update('imageSrc', url);
            } else {
                alert("Uploader not wired");
            }
        } catch (e) { console.error(e); }
        finally { setUploading(false); }
    };

    return (
        <NodeViewWrapper className="my-8 group">
            <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md">

                {/* Header Bar */}
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-2">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50 text-indigo-600">
                            <LayoutTemplate className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700">Hero Section</span>
                    </div>
                    <Select
                        value={style}
                        onChange={(v: string) => update('style', v)}
                        options={["center", "split", "minimal"]}
                    />
                </div>

                {/* Content Area */}
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left: Text Inputs */}
                    <div className="space-y-5">
                        <div>
                            <Label icon={Type}>Content</Label>
                            <div className="space-y-2">
                                <Input
                                    value={headline}
                                    onChange={(v: string) => update('headline', v)}
                                    className="font-bold text-base text-gray-900"
                                    placeholder="Headline"
                                />
                                <Input
                                    value={subheadline}
                                    onChange={(v: string) => update('subheadline', v)}
                                    placeholder="Subheadline"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <div>
                                <Label>Button Text</Label>
                                <Input value={ctaText} onChange={(v: string) => update('ctaText', v)} placeholder="Click Me" />
                            </div>
                            <div>
                                <Label icon={LinkIcon}>Link</Label>
                                <Input value={ctaLink} onChange={(v: string) => update('ctaLink', v)} list="amodx-links" placeholder="/path" className="font-mono text-xs" />
                            </div>
                        </div>
                    </div>

                    {/* Right: Image Uploader - UPDATED */}
                    <div className="border-l pl-6 border-dashed border-gray-200">
                        <Label icon={ImageIcon}>Hero Image</Label>
                        <div className="mt-2 relative aspect-video bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 hover:border-indigo-300 hover:bg-indigo-50/10 transition-colors group/upload overflow-hidden">

                            {imageSrc ? (
                                <>
                                    <img src={imageSrc} className="w-full h-full object-cover" alt="Hero" />
                                    {/* Hover Overlay */}
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/upload:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                                        <label className="cursor-pointer bg-white text-gray-900 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-100">
                                            Upload
                                            <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} accept="image/*" />
                                        </label>
                                        <button onClick={handleLibraryPick} className="bg-white text-gray-900 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-100">
                                            Library
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    {uploading ? (
                                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-500 border-t-transparent" />
                                    ) : (
                                        <div className="flex flex-col gap-2 items-center">
                                            <Upload className="w-6 h-6 opacity-30" />
                                            <div className="flex gap-2">
                                                <label className="text-[10px] uppercase font-bold text-indigo-600 cursor-pointer hover:underline">
                                                    Upload
                                                    <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} accept="image/*" />
                                                </label>
                                                <span className="text-[10px] text-gray-400">OR</span>
                                                <button onClick={handleLibraryPick} className="text-[10px] uppercase font-bold text-indigo-600 hover:underline">
                                                    Library
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
