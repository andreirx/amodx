import { NodeViewWrapper } from '@tiptap/react';
import { Megaphone, Link as LinkIcon } from 'lucide-react';
import React from 'react';

const Input = ({ label, value, onChange, placeholder }: any) => (
    <div className="space-y-1 w-full">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
        <input
            className="w-full h-9 bg-white border border-gray-200 rounded px-2 text-sm focus:border-purple-500 outline-none transition-colors"
            value={value || ""}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

const Select = ({ label, value, onChange, options }: any) => (
    <div className="space-y-1 w-full">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
        <select
            className="w-full h-9 bg-white border border-gray-200 rounded px-2 text-sm focus:border-purple-500 outline-none cursor-pointer"
            value={value}
            onChange={e => onChange(e.target.value)}
        >
            {options.map((o: string) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
    </div>
);

export function CtaEditor(props: any) {
    const { headline, subheadline, buttonText, buttonLink, style } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-purple-100 bg-purple-50/30 rounded-xl p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Megaphone className="w-4 h-4 text-purple-600" />
                        <span className="text-xs font-bold text-purple-600 uppercase tracking-widest">Call to Action</span>
                    </div>
                    <div className="w-32">
                        <Select
                            label="Style"
                            value={style}
                            onChange={(v: string) => update('style', v)}
                            options={["simple", "card", "band"]}
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <Input label="Headline" value={headline} onChange={(v: string) => update('headline', v)} />
                    <Input label="Subheadline" value={subheadline} onChange={(v: string) => update('subheadline', v)} />

                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Button Label" value={buttonText} onChange={(v: string) => update('buttonText', v)} />
                        <Input label="Button Link" value={buttonLink} onChange={(v: string) => update('buttonLink', v)} list="amodx-links" placeholder="/signup" />
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
