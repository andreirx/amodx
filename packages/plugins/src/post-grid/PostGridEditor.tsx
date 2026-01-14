import { NodeViewWrapper } from '@tiptap/react';
import { LayoutGrid, Loader2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';

const Input = ({ value, onChange, placeholder, type = "text", list }: any) => (
    <input
        type={type}
        list={list}
        className="w-full h-9 bg-white border border-gray-200 rounded-md px-3 text-sm focus:border-indigo-500 outline-none transition-colors"
        value={value === undefined || value === null ? "" : value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

export function PostGridEditor(props: any) {
    const { headline, filterTag, limit, layout } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    // Tag Fetching State
    const [availableTags, setAvailableTags] = useState<string[]>([]);

    useEffect(() => {
        const fetchFn = props.editor.storage.postGrid?.fetchTagsFn;
        if (fetchFn) {
            fetchFn((tags: string[]) => setAvailableTags(tags));
        }
    }, []);

    const datalistId = `postgrid-tags-${Math.random().toString(36).substr(2, 9)}`;

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50 text-indigo-600">
                            <LayoutGrid className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Dynamic Post Grid</span>
                    </div>
                    <select
                        className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium shadow-sm outline-none focus:border-indigo-500"
                        value={layout || 'grid'}
                        onChange={e => update('layout', e.target.value)}
                    >
                        <option value="grid">Grid Layout</option>
                        <option value="list">List Layout</option>
                    </select>
                </div>

                <div className="p-5 space-y-4">
                    <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 block">Section Headline</label>
                        <Input value={headline} onChange={(v: string) => update('headline', v)} />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Filter by Tag</label>
                            <Input
                                value={filterTag}
                                onChange={(v: string) => update('filterTag', v)}
                                placeholder="All posts"
                                list={datalistId}
                            />
                            <datalist id={datalistId}>
                                {availableTags.map(tag => <option key={tag} value={tag} />)}
                            </datalist>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Max Items (0 = All)</label>
                            <Input
                                type="number"
                                value={limit}
                                onChange={(v: string) => update('limit', parseInt(v))}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
