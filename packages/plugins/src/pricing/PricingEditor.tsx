import { NodeViewWrapper } from '@tiptap/react';
import React from 'react';

// Reuse the Input/Select components from HeroEditor or move them to a shared utils file in plugins
const Input = ({ label, value, onChange }: any) => (
    <div className="space-y-1">
        <label className="text-xs font-semibold text-gray-500 uppercase">{label}</label>
        <input className="w-full h-8 rounded border px-2 text-sm" value={value} onChange={e => onChange(e.target.value)} />
    </div>
);

const TextArea = ({ label, value, onChange }: any) => (
    <div className="space-y-1">
        <label className="text-xs font-semibold text-gray-500 uppercase">{label}</label>
        <textarea className="w-full h-24 rounded border p-2 text-sm font-mono" value={value} onChange={e => onChange(e.target.value)} />
    </div>
);

export function PricingEditor(props: any) {
    const { title, price, interval, features, buttonText, buttonLink, recommended } = props.node.attrs;
    const update = (f: string, v: any) => props.updateAttributes({ [f]: v });

    return (
        <NodeViewWrapper className="my-6 max-w-sm border-2 border-indigo-100 rounded-xl p-4 bg-white shadow-sm">
            <div className="mb-4 text-xs font-bold text-indigo-600 uppercase tracking-widest border-b pb-2">Pricing Card</div>
            <div className="space-y-4">
                <Input label="Plan Name" value={title} onChange={(v: string) => update('title', v)} />
                <div className="flex gap-2">
                    <Input label="Price" value={price} onChange={(v: string) => update('price', v)} />
                    <Input label="Interval" value={interval} onChange={(v: string) => update('interval', v)} />
                </div>
                <TextArea label="Features (One per line)" value={features} onChange={(v: string) => update('features', v)} />
                <Input label="Button Text" value={buttonText} onChange={(v: string) => update('buttonText', v)} />
                <Input label="Button Link" value={buttonLink} onChange={(v: string) => update('buttonLink', v)} />
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                    <input type="checkbox" checked={recommended} onChange={e => update('recommended', e.target.checked)} />
                    Highlight as Recommended
                </label>
            </div>
        </NodeViewWrapper>
    );
}
