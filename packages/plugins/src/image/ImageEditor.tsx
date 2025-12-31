import { NodeViewWrapper } from '@tiptap/react';
import { UploadCloud, Image as ImageIcon, Loader2, Minimize2, Maximize2, MoveHorizontal, Search } from 'lucide-react';
import React, { useState } from 'react';

const Input = ({ value, onChange, placeholder, className = "" }: any) => (
    <input
        className={`w-full bg-transparent border-b border-gray-200 py-1 text-sm focus:border-blue-500 outline-none transition-colors ${className}`}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

const ToolbarButton = ({ active, onClick, icon: Icon, title }: any) => (
    <button
        onClick={onClick}
        className={`p-1.5 rounded-md transition-colors ${active ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
        title={title}
    >
        <Icon className="w-4 h-4" />
    </button>
);

export function ImageEditor(props: any) {
    const { src, alt, caption, width } = props.node.attrs;
    const [uploading, setUploading] = useState(false);

    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    // 1. Dependency Injection: Get the picker function
    const handleLibraryPick = () => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) {
            pickFn((url: string) => update('src', url));
        } else {
            alert("Media Picker not connected");
        }
    };

    const handleUpload = async (file: File) => {
        setUploading(true);
        try {
            const uploadFn = props.editor.storage.image?.uploadFn;
            if (!uploadFn) {
                alert("Upload function not configured");
                return;
            }
            const publicUrl = await uploadFn(file);
            update('src', publicUrl);
        } catch (e: any) {
            console.error(e);
            alert("Upload failed: " + e.message);
        } finally {
            setUploading(false);
        }
    };

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) handleUpload(e.target.files[0]);
    };

    return (
        <NodeViewWrapper className="my-6">
            <div className={`group relative rounded-lg border border-gray-200 bg-gray-50 overflow-hidden transition-all ${width === 'centered' ? 'max-w-md mx-auto' : ''}`}>

                {/* Top Toolbar */}
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-white border border-gray-200 shadow-sm rounded-lg p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <ToolbarButton active={width === 'centered'} onClick={() => update('width', 'centered')} icon={Minimize2} title="Centered" />
                    <ToolbarButton active={width === 'wide'} onClick={() => update('width', 'wide')} icon={MoveHorizontal} title="Wide" />
                    <ToolbarButton active={width === 'full'} onClick={() => update('width', 'full')} icon={Maximize2} title="Full Width" />
                </div>

                {src ? (
                    // FILLED STATE
                    <div className="relative">
                        <img src={src} alt={alt} className="w-full h-auto object-cover bg-white" />

                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                            {/* Upload Button */}
                            <label className="cursor-pointer bg-white text-gray-900 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-100 shadow-sm flex items-center gap-2">
                                <UploadCloud className="w-3 h-3"/> Upload
                                <input type="file" className="hidden" onChange={onFileChange} accept="image/*" />
                            </label>

                            {/* Library Button */}
                            <button onClick={handleLibraryPick} className="bg-white text-gray-900 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-100 shadow-sm flex items-center gap-2">
                                <Search className="w-3 h-3"/> Library
                            </button>
                        </div>
                    </div>
                ) : (
                    // EMPTY STATE
                    <div className="py-12 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 m-2 rounded-lg bg-gray-50/50">
                        {uploading ? (
                            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                        ) : (
                            <div className="flex gap-4">
                                <label className="flex flex-col items-center cursor-pointer p-4 hover:bg-white hover:shadow-sm rounded-lg transition-all border border-transparent hover:border-gray-200">
                                    <UploadCloud className="w-6 h-6 text-gray-400 mb-2" />
                                    <span className="text-xs font-medium text-gray-600">Upload New</span>
                                    <input type="file" className="hidden" onChange={onFileChange} accept="image/*" />
                                </label>

                                <div className="w-px bg-gray-200 my-2"></div>

                                <button onClick={handleLibraryPick} className="flex flex-col items-center cursor-pointer p-4 hover:bg-white hover:shadow-sm rounded-lg transition-all border border-transparent hover:border-gray-200">
                                    <Search className="w-6 h-6 text-gray-400 mb-2" />
                                    <span className="text-xs font-medium text-gray-600">Select Existing</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Footer Inputs */}
                <div className="p-3 bg-white border-t border-gray-100 space-y-2">
                    <Input value={caption} onChange={(v: string) => update('caption', v)} placeholder="Write a caption (optional)" className="text-center font-medium text-gray-700" />
                    <Input value={alt} onChange={(v: string) => update('alt', v)} placeholder="Alt Text (Required for SEO)" className="text-xs text-gray-500" />
                </div>
            </div>
        </NodeViewWrapper>
    );
}
