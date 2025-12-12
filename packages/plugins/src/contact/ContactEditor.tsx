import { NodeViewWrapper } from '@tiptap/react';
import React from 'react';

const Input = ({ label, value, onChange, placeholder }: any) => (
    <div className="space-y-1">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
        <input
            className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-blue-500 outline-none"
            value={value || ""}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

export function ContactEditor(props: any) {
    const { headline, description, buttonText, tags } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-gray-200 bg-gray-50 rounded-xl p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest px-2 py-1 rounded border border-gray-200 bg-white">Contact Form</span>
                </div>

                <div className="space-y-4">
                    <Input label="Headline" value={headline} onChange={(v: string) => update('headline', v)} />
                    <Input label="Helper Text" value={description} onChange={(v: string) => update('description', v)} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Button Label" value={buttonText} onChange={(v: string) => update('buttonText', v)} />
                        <Input label="CRM Tags" value={tags} onChange={(v: string) => update('tags', v)} placeholder="contact, support" />
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
