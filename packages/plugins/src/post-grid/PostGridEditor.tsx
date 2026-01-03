import { NodeViewWrapper } from '@tiptap/react';
import { LayoutGrid } from 'lucide-react';
import React from 'react';

// Reusable Input
const Input = ({ label, value, onChange, placeholder }: any) => (
    <div className="space-y-1 w-full">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
        <input
            className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-indigo-500 outline-none"
            value={value || ""}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

export function PostGridEditor(props: any) {
    const { headline, filterTag, limit, columns } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-indigo-100 bg-indigo-50/30 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4 text-indigo-600">
                    <LayoutGrid className="w-5 h-5" />
                    <span className="font-bold text-xs uppercase tracking-widest">Dynamic Post Grid</span>
                </div>

                <div className="space-y-4">
                    <Input label="Headline" value={headline} onChange={(v: string) => update('headline', v)} />

                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Filter by Tag"
                            value={filterTag}
                            onChange={(v: string) => update('filterTag', v)}
                            placeholder="e.g. blog (Leave empty for all)"
                        />
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Limit</label>
                            <input
                                type="number"
                                className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm"
                                value={limit}
                                onChange={e => update('limit', parseInt(e.target.value))}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
