import { NodeViewWrapper } from '@tiptap/react';
import { Lock } from 'lucide-react';
import React from 'react';

const Input = ({ label, value, onChange, placeholder }: any) => (
    <div className="space-y-1">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
        <input
            className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-indigo-500 outline-none"
            value={value || ""}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

export function LeadMagnetEditor(props: any) {
    const { headline, description, buttonText, resourceId, tags } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-indigo-100 bg-indigo-50/20 rounded-xl p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Lead Magnet (Gated)</span>
                </div>

                <div className="space-y-4">
                    <Input label="Headline" value={headline} onChange={(v: string) => update('headline', v)} />
                    <Input label="Description" value={description} onChange={(v: string) => update('description', v)} />

                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Resource ID" value={resourceId} onChange={(v: string) => update('resourceId', v)} placeholder="Paste ID from Resources" />
                        <Input label="Button Label" value={buttonText} onChange={(v: string) => update('buttonText', v)} />
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
