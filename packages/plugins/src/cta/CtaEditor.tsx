import { NodeViewWrapper } from '@tiptap/react';
import { Megaphone, Link as LinkIcon } from 'lucide-react';
import React from 'react';
import { BlockWidthControl } from '../BlockWidthControl';

const Input = ({ label, value, onChange, placeholder, list }: any) => (
    <div className="space-y-1 w-full">
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</label>
        <input
            className="w-full h-9 bg-white border border-gray-200 rounded px-2 text-sm focus:border-pink-500 outline-none"
            value={value || ""}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            list={list}
        />
    </div>
);

export function CtaEditor(props: any) {
    const { headline, subheadline, buttonText, buttonLink, style, blockWidth } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-pink-50 text-pink-600">
                            <Megaphone className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Call to Action</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-gray-200" />
                        <select
                            className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium focus:border-pink-500 outline-none"
                            value={style}
                            onChange={e => update('style', e.target.value)}
                        >
                            <option value="simple">Simple</option>
                            <option value="card">Card</option>
                            <option value="band">Band</option>
                        </select>
                    </div>
                </div>

                <div className="p-5 space-y-4">
                    <Input label="Headline" value={headline} onChange={(v: string) => update('headline', v)} />
                    <Input label="Subheadline" value={subheadline} onChange={(v: string) => update('subheadline', v)} />

                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Button Label" value={buttonText} onChange={(v: string) => update('buttonText', v)} />
                        <Input label="Button Link" value={buttonLink} onChange={(v: string) => update('buttonLink', v)} list="amodx-links" placeholder="/path" />
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
