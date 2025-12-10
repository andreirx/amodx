import { NodeViewWrapper } from '@tiptap/react';
import React from 'react';

// Simple UI components to avoid dependency hell in plugins
const Input = ({ label, value, onChange, placeholder }: any) => (
    <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</label>
        <input
            className="flex h-9 w-full rounded-md border border-gray-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-950"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

const Select = ({ label, value, onChange, options }: any) => (
    <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</label>
        <select
            className="flex h-9 w-full rounded-md border border-gray-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-950"
            value={value}
            onChange={e => onChange(e.target.value)}
        >
            {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
        </select>
    </div>
);

export function HeroEditor(props: any) {
    const { headline, subheadline, ctaText, ctaLink, style } = props.node.attrs;
    const update = (field: string, value: string) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-8 border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
            <div className="mb-4 flex items-center gap-2">
                <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-mono font-bold">HERO BLOCK</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Headline" value={headline} onChange={(v: string) => update('headline', v)} />
                <Select
                    label="Style"
                    value={style}
                    onChange={(v: string) => update('style', v)}
                    options={["center", "split", "minimal"]}
                />
                <div className="md:col-span-2">
                    <Input label="Subheadline" value={subheadline} onChange={(v: string) => update('subheadline', v)} />
                </div>
                <Input label="Button Text" value={ctaText} onChange={(v: string) => update('ctaText', v)} />
                <Input label="Button Link" value={ctaLink} onChange={(v: string) => update('ctaLink', v)} />
            </div>
        </NodeViewWrapper>
    );
}
