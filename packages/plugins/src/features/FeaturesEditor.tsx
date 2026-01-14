import { NodeViewWrapper } from '@tiptap/react';
import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import React from 'react';

// ... Standard Inputs ...
const Input = ({ value, onChange, placeholder }: any) => (
    <input className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-blue-500 outline-none" value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
);
const TextArea = ({ value, onChange, placeholder }: any) => (
    <textarea className="w-full h-16 bg-white border border-gray-200 rounded p-2 text-sm focus:border-blue-500 outline-none resize-none" value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
);

export function FeaturesEditor(props: any) {
    const { headline, subheadline, items, columns } = props.node.attrs;
    const safeItems = Array.isArray(items) ? items : [];
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    // ... addItem, removeItem, updateItem helpers ...
    const updateItem = (i: number, f: string, v: any) => { const n = [...safeItems]; n[i] = {...n[i], [f]: v}; update('items', n); };
    const addItem = () => update('items', [...safeItems, { id: crypto.randomUUID(), title: 'Feature', description: '...', icon: 'Check' }]);
    const removeItem = (i: number) => update('items', safeItems.filter((_: any, idx: number) => idx !== i));

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-50 text-blue-600">
                            <LayoutGrid className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Feature Grid</span>
                    </div>
                    <select className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium focus:border-blue-500" value={columns} onChange={e => update('columns', e.target.value)}>
                        <option value="2">2 Cols</option>
                        <option value="3">3 Cols</option>
                        <option value="4">4 Cols</option>
                    </select>
                </div>

                <div className="p-5">
                    <div className="mb-6 space-y-2">
                        <Input value={headline} onChange={(v: string) => update('headline', v)} placeholder="Headline" />
                        <Input value={subheadline} onChange={(v: string) => update('subheadline', v)} placeholder="Subheadline" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {safeItems.map((item: any, i: number) => (
                            <div key={item.id || i} className="bg-white border border-gray-200 rounded-lg p-3 relative group">
                                <button onClick={() => removeItem(i)} className="absolute top-2 right-2 p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <select className="w-24 h-8 bg-white border border-gray-200 rounded px-1 text-xs" value={item.icon} onChange={e => updateItem(i, 'icon', e.target.value)}>
                                            {["Check", "Zap", "Shield", "TrendingUp", "Users", "Globe", "Lock", "Smile"].map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                        <Input value={item.title} onChange={(v: string) => updateItem(i, 'title', v)} placeholder="Title" />
                                    </div>
                                    <TextArea value={item.description} onChange={(v: string) => updateItem(i, 'description', v)} placeholder="Description" />
                                </div>
                            </div>
                        ))}
                        <button onClick={addItem} className="min-h-[100px] border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center text-blue-500 hover:bg-blue-50 transition-colors"><Plus className="w-5 h-5" /></button>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
