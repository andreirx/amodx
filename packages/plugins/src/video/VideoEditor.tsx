import { NodeViewWrapper } from '@tiptap/react';
import { Video, Youtube } from 'lucide-react';
import React from 'react';

const Input = ({ value, onChange, placeholder }: any) => (
    <input
        className="w-full bg-white border border-gray-200 rounded px-2 py-1.5 text-sm focus:border-blue-500 outline-none"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

export function VideoEditor(props: any) {
    const { url, caption } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-gray-200 bg-gray-50 rounded-xl p-4 flex gap-4 items-center">
                <div className="h-10 w-10 bg-red-100 text-red-600 rounded-lg flex items-center justify-center shrink-0">
                    <Youtube className="w-6 h-6" />
                </div>
                <div className="flex-1 space-y-2">
                    <Input
                        value={url}
                        onChange={(v: string) => update('url', v)}
                        placeholder="Paste YouTube Link..."
                    />
                    <Input
                        value={caption}
                        onChange={(v: string) => update('caption', v)}
                        placeholder="Caption (Optional)"
                    />
                </div>
            </div>
        </NodeViewWrapper>
    );
}
