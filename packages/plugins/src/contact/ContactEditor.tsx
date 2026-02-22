import { NodeViewWrapper } from '@tiptap/react';
import { Mail } from 'lucide-react';
import React from 'react';
import { BlockWidthControl } from '../BlockWidthControl';

const Input = ({ label, value, onChange, placeholder }: any) => (
    <div className="space-y-1">
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</label>
        <input
            className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-blue-500 outline-none"
            value={value || ""}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

export function ContactEditor(props: any) {
    const { headline, description, buttonText, tags, blockWidth } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-50 text-blue-600">
                            <Mail className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Contact Form</span>
                    </div>
                    <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                </div>

                <div className="p-5 space-y-4">
                    <Input label="Headline" value={headline} onChange={(v: string) => update('headline', v)} />
                    <Input label="Helper Text" value={description} onChange={(v: string) => update('description', v)} />

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-50">
                        <Input label="Button Label" value={buttonText} onChange={(v: string) => update('buttonText', v)} />
                        <Input label="CRM Tags" value={tags} onChange={(v: string) => update('tags', v)} placeholder="contact, lead" />
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
