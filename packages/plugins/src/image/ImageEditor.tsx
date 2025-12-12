import { NodeViewWrapper } from '@tiptap/react';
import { UploadCloud, Image as ImageIcon, Loader2 } from 'lucide-react';
import React, { useState } from 'react';

// UI Helpers (Inlined to keep plugin isolated)
const Input = ({ value, onChange, placeholder, className = "" }: any) => (
    <input
        className={`w-full bg-transparent border-b border-gray-200 py-1 text-sm focus:border-blue-500 outline-none transition-colors ${className}`}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

export function ImageEditor(props: any) {
    const { src, alt, caption } = props.node.attrs;
    const [uploading, setUploading] = useState(false);

    const handleUpload = async (file: File) => {
        setUploading(true);
        try {
            // DEPENDENCY INJECTION: Ask the editor instance to handle the upload
            // The Admin App configures this function.
            const uploadFn = props.editor.storage.image?.uploadFn;

            if (!uploadFn) {
                alert("Upload function not configured in Editor");
                return;
            }

            const publicUrl = await uploadFn(file);
            props.updateAttributes({ src: publicUrl });
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
            <div className="group relative rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">

                {src ? (
                    <div className="relative">
                        <img src={src} alt={alt} className="w-full h-auto max-h-[500px] object-contain bg-white" />

                        {/* Overlay Controls */}
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
                        onChange={(v: string) => props.updateAttributes({ caption: v })}
                        placeholder="Write a caption (optional)"
                        className="text-center font-medium text-gray-700"
                    />
                    <div className="grid grid-cols-2 gap-4 pt-1">
                        <Input
                            value={alt}
                            onChange={(v: string) => props.updateAttributes({ alt: v })}
                            placeholder="Alt Text (SEO)"
                            className="text-xs text-gray-500"
                        />
                        <div className="text-xs text-gray-400 flex items-center justify-end">
                            {props.node.attrs.width === 'full' ? 'Full Width' : 'Centered'}
                        </div>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
