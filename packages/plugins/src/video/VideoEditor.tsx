import { NodeViewWrapper } from '@tiptap/react';
import { Youtube } from 'lucide-react';
import React from 'react';

const Input = ({ value, onChange, placeholder }: any) => (
    <input className="w-full h-9 bg-white border border-gray-200 rounded px-3 text-sm focus:border-red-500 outline-none" value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
);

export function VideoEditor(props: any) {
    const { url, caption } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center border-b border-gray-100 bg-gray-50/50 px-4 py-3 gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-red-50 text-red-600">
                        <Youtube className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Video Embed</span>
                </div>
                <div className="p-5 space-y-4">
                    <Input value={url} onChange={(v: string) => update('url', v)} placeholder="Paste YouTube / Vimeo URL..." />
                    <Input value={caption} onChange={(v: string) => update('caption', v)} placeholder="Caption (Optional)" />
                </div>
            </div>
        </NodeViewWrapper>
    );
}
