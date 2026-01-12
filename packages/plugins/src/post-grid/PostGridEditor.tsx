import { NodeViewWrapper } from '@tiptap/react';
import { LayoutGrid, Loader2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';

// Reusable Input
const Input = ({ label, value, onChange, placeholder, type = "text", min, list }: any) => (
    <div className="space-y-1 w-full">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
        <input
            type={type}
            min={min}
            list={list}
            className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-indigo-500 outline-none transition-colors"
            value={value === undefined || value === null ? "" : value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

export function PostGridEditor(props: any) {
    const { headline, filterTag, limit, layout } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    // Tag Fetching State
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [loadingTags, setLoadingTags] = useState(false);

    const datalistId = `postgrid-tags-${Math.random().toString(36).substr(2, 9)}`;

    useEffect(() => {
        // USE INJECTED FUNCTION
        const fetchFn = props.editor.storage.postGrid?.fetchTagsFn;
        if (fetchFn) {
            setLoadingTags(true);
            // We pass a callback to the host app
            fetchFn((tags: string[]) => {
                setAvailableTags(tags);
                setLoadingTags(false);
            });
        }
    }, []);

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-indigo-100 bg-indigo-50/30 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4 text-indigo-600">
                    <LayoutGrid className="w-5 h-5" />
                    <span className="font-bold text-xs uppercase tracking-widest">Dynamic Post Grid</span>
                    {loadingTags && <Loader2 className="w-3 h-3 animate-spin ml-2 opacity-50" />}
                </div>

                <div className="space-y-4">
                    <Input label="Headline" value={headline} onChange={(v: string) => update('headline', v)} />

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <Input
                                label="Filter by Tag"
                                value={filterTag}
                                onChange={(v: string) => update('filterTag', v)}
                                placeholder="All posts"
                                list={datalistId} // Connect Input
                            />
                            {/* Define Datalist */}
                            <datalist id={datalistId}>
                                {availableTags.map(tag => (
                                    <option key={tag} value={tag}/>
                                ))}
                            </datalist>
                        </div>

                        <Input
                            label="Limit (0 = All)"
                            type="number"
                            min="0"
                            value={limit}
                            onChange={(v: string) => update('limit', parseInt(v))}
                        />

                        <div className="space-y-1">
                            <label
                                className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Layout</label>
                            <select
                                className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-indigo-500 outline-none"
                                value={layout || 'grid'}
                                onChange={e => update('layout', e.target.value)}
                            >
                                <option value="grid">Grid Cards</option>
                                <option value="list">Google Style List</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
