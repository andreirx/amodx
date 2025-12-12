import { NodeViewWrapper } from '@tiptap/react';
import { UploadCloud, Image as ImageIcon, Loader2, Minimize2, Maximize2, MoveHorizontal } from 'lucide-react';
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

    const handleUpload = async (file: File) => {
        setUploading(true);
        try {
            const uploadFn = props.editor.storage.image?.uploadFn;
            if (!uploadFn) {
                alert("Upload function not configured in Editor");
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

                {/* TOOLBAR (Floating on Hover) */}
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-white border border-gray-200 shadow-sm rounded-lg p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <ToolbarButton
                        active={width === 'centered'}
                        onClick={() => update('width', 'centered')}
                        icon={Minimize2}
                        title="Centered"
                    />
                    <ToolbarButton
                        active={width === 'wide'}
                        onClick={() => update('width', 'wide')}
                        icon={MoveHorizontal}
                        title="Wide"
                    />
                    <ToolbarButton
                        active={width === 'full'}
                        onClick={() => update('width', 'full')}
                        icon={Maximize2}
                        title="Full Width"
                    />
                </div>

                {src ? (
                    <div className="relative">
                        <img src={src} alt={alt} className="w-full h-auto object-cover bg-white" />

                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                            <label className="cursor-pointer bg-white text-gray-900 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-gray-100 shadow-sm">
                                Change Image
                                <input type="file" className="hidden" onChange={onFileChange} accept="image/*" />
                            </label>
                        </div>
                    </div>
                ) : (
                    <div className="py-16 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 m-2 rounded-lg hover:bg-gray-100 transition-colors">
                        {uploading ? (
                            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                        ) : (
                            <>
                                <UploadCloud className="w-8 h-8 text-gray-400 mb-2" />
                                <span className="text-sm text-gray-500 font-medium">Drag & Drop or Click to Upload</span>
                                <input type="file" className="absolute inset-0 cursor-pointer opacity-0" onChange={onFileChange} accept="image/*" />
                            </>
                        )}
                    </div>
                )}

                <div className="p-3 bg-white border-t border-gray-100 space-y-2">
                    <Input
                        value={caption}
                        onChange={(v: string) => update('caption', v)}
                        placeholder="Write a caption (optional)"
                        className="text-center font-medium text-gray-700"
                    />
                    <div className="pt-1">
                        <Input
                            value={alt}
                            onChange={(v: string) => update('alt', v)}
                            placeholder="Alt Text (Required for SEO)"
                            className="text-xs text-gray-500"
                        />
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
