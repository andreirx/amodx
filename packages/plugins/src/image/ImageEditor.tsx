import { NodeViewWrapper } from '@tiptap/react';
import { UploadCloud, Image as ImageIcon, Loader2, Search, Maximize2, MoveHorizontal, Minimize2 } from 'lucide-react';
import React, { useState } from 'react';

const Input = ({ value, onChange, placeholder }: any) => (
    <input
        className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-slate-500 outline-none transition-colors placeholder:text-gray-400"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

export function ImageEditor(props: any) {
    const { src, alt, caption, width } = props.node.attrs;
    const [uploading, setUploading] = useState(false);
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const handleLibraryPick = () => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) pickFn((url: string) => update('src', url));
    };

    const handleUpload = async (file: File) => {
        setUploading(true);
        try {
            const uploadFn = props.editor.storage.image?.uploadFn;
            if (uploadFn) {
                const publicUrl = await uploadFn(file);
                update('src', publicUrl);
            }
        } catch (e: any) {
            alert("Upload failed");
        } finally {
            setUploading(false);
        }
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-slate-600">
                            <ImageIcon className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Image</span>
                    </div>

                    <div className="flex bg-gray-100 rounded-md p-0.5">
                        {[
                            { id: 'centered', icon: Minimize2, title: 'Centered' },
                            { id: 'wide', icon: MoveHorizontal, title: 'Wide' },
                            { id: 'full', icon: Maximize2, title: 'Full' }
                        ].map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => update('width', opt.id)}
                                className={`p-1 rounded-sm transition-all ${width === opt.id ? 'bg-white shadow text-slate-800' : 'text-gray-400 hover:text-gray-600'}`}
                                title={opt.title}
                            >
                                <opt.icon className="w-3.5 h-3.5" />
                            </button>
                        ))}
                    </div>
                </div>

                <div className="p-5">
                    <div className="relative bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 min-h-[200px] flex flex-col items-center justify-center overflow-hidden group">
                        {src ? (
                            <>
                                <img src={src} alt={alt} className="max-h-[300px] w-auto object-contain" />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                    <label className="cursor-pointer bg-white text-gray-900 px-3 py-1.5 rounded-md text-xs font-bold hover:bg-gray-100 shadow-sm flex items-center gap-2">
                                        <UploadCloud className="w-3 h-3"/> REPLACE
                                        <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} accept="image/*" />
                                    </label>
                                    <button onClick={handleLibraryPick} className="bg-white text-gray-900 px-3 py-1.5 rounded-md text-xs font-bold hover:bg-gray-100 shadow-sm flex items-center gap-2">
                                        <Search className="w-3 h-3"/> LIBRARY
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center gap-3">
                                {uploading ? (
                                    <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
                                ) : (
                                    <>
                                        <ImageIcon className="w-8 h-8 text-gray-300" />
                                        <div className="flex gap-2">
                                            <label className="cursor-pointer text-xs font-bold text-slate-600 hover:underline">
                                                UPLOAD
                                                <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} accept="image/*" />
                                            </label>
                                            <span className="text-xs text-gray-300">|</span>
                                            <button onClick={handleLibraryPick} className="text-xs font-bold text-slate-600 hover:underline">
                                                LIBRARY
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input value={caption} onChange={(v: string) => update('caption', v)} placeholder="Caption (optional)" />
                        <Input value={alt} onChange={(v: string) => update('alt', v)} placeholder="Alt text (SEO)" />
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
