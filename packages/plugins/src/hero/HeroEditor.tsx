import { NodeViewWrapper } from '@tiptap/react';
import React from 'react';

// Minimalist Input with Label
const Field = ({ label, value, onChange, placeholder }: any) => (
    <div className="flex-1 min-w-[200px]">
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 tracking-wider">{label}</label>
        <input
            className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

// Style Selector
const StyleSelect = ({ value, onChange }: any) => (
    <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 tracking-wider">Style</label>
        <div className="flex gap-1 bg-gray-50 p-1 rounded border border-gray-200">
            {['center', 'split', 'minimal'].map((s) => (
                <button
                    key={s}
                    onClick={() => onChange(s)}
                    className={`px-3 py-1 text-xs rounded font-medium transition-all ${
                        value === s
                            ? 'bg-white shadow-sm text-blue-600'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
            ))}
        </div>
    </div>
);

export function HeroEditor(props: any) {
    const { headline, subheadline, ctaText, ctaLink, style } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-6">
            <div className="border-l-4 border-blue-500 bg-white shadow-sm rounded-r-lg p-5">
                <div className="flex justify-between items-start mb-4">
                    <span className="text-xs font-bold text-blue-500 uppercase tracking-widest bg-blue-50 px-2 py-1 rounded">Hero Section</span>
                    <StyleSelect value={style} onChange={(v: string) => update('style', v)} />
                </div>

                <div className="space-y-4">
                    <div className="flex flex-wrap gap-4">
                        <Field label="Headline" value={headline} onChange={(v: string) => update('headline', v)} placeholder="Big Headline" />
                        <Field label="Subheadline" value={subheadline} onChange={(v: string) => update('subheadline', v)} placeholder="Description text" />
                    </div>

                    <div className="flex flex-wrap gap-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                        <Field label="Button Text" value={ctaText} onChange={(v: string) => update('ctaText', v)} placeholder="e.g. Get Started" />
                        <Field label="Button Link" value={ctaLink} onChange={(v: string) => update('ctaLink', v)} placeholder="/contact" />
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
