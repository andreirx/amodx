import { NodeViewWrapper } from '@tiptap/react';
import { Plus, Trash2, LayoutGrid, Star } from 'lucide-react';
import React from 'react';

// Reusable Input Helper
const Input = ({ label, value, onChange, className = "" }: any) => (
    <div className="space-y-1 w-full">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <input
            className={`w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-blue-500 outline-none transition-colors ${className}`}
            value={value || ""}
            onChange={e => onChange(e.target.value)}
        />
    </div>
);

const TextArea = ({ label, value, onChange }: any) => (
    <div className="space-y-1 w-full">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <textarea
            className="w-full h-20 bg-white border border-gray-200 rounded p-2 text-sm focus:border-blue-500 outline-none transition-colors font-sans"
            value={value || ""}
            onChange={e => onChange(e.target.value)}
        />
    </div>
);

const Select = ({ label, value, onChange, options }: any) => (
    <div className="space-y-1 w-full">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <select
            className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-blue-500 outline-none cursor-pointer"
            value={value}
            onChange={e => onChange(e.target.value)}
        >
            {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
        </select>
    </div>
);

export function FeaturesEditor(props: any) {
    const { headline, subheadline, items, columns } = props.node.attrs;

    // Safety check for array
    const safeItems = Array.isArray(items) ? items : [];

    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...safeItems];
        newItems[index] = { ...newItems[index], [field]: value };
        update('items', newItems);
    };

    const addItem = () => {
        const newItem = {
            id: crypto.randomUUID(),
            title: 'New Feature',
            description: 'Description...',
            icon: 'Check'
        };
        update('items', [...safeItems, newItem]);
    };

    const removeItem = (index: number) => {
        const newItems = safeItems.filter((_: any, i: number) => i !== index);
        update('items', newItems);
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-gray-50/50 rounded-xl p-6 shadow-sm">

                {/* Header */}
                <div className="mb-6 flex justify-between items-start">
                    <div className="space-y-4 max-w-lg flex-1">
                        <div className="flex items-center gap-2">
                            <LayoutGrid className="w-4 h-4 text-blue-600" />
                            <span className="text-xs font-bold text-blue-600 uppercase tracking-widest">Feature Grid</span>
                        </div>
                        <Input value={headline} onChange={(v: string) => update('headline', v)} className="font-bold text-lg" />
                        <Input value={subheadline} onChange={(v: string) => update('subheadline', v)} />
                    </div>
                    <div className="w-32">
                        <Select
                            label="Columns"
                            value={columns}
                            onChange={(v: string) => update('columns', v)}
                            options={["2", "3", "4"]}
                        />
                    </div>
                </div>

                {/* Items Grid */}
                <div className={`grid gap-4 grid-cols-1 md:grid-cols-2`}>
                    {safeItems.map((item: any, i: number) => (
                        <div key={item.id || i} className="relative p-4 rounded-lg border border-gray-200 bg-white group hover:border-blue-300 transition-colors">
                            <button
                                onClick={() => removeItem(i)}
                                className="absolute top-2 right-2 p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                title="Remove Item"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>

                            <div className="space-y-3 pr-6">
                                <div className="flex gap-2">
                                    {/* Simple Icon Selector for V1 */}
                                    <div className="w-1/3">
                                        <Select
                                            label="Icon"
                                            value={item.icon}
                                            onChange={(v: string) => updateItem(i, 'icon', v)}
                                            options={["Check", "Zap", "Shield", "TrendingUp", "Users", "Globe", "Lock", "Smile"]}
                                        />
                                    </div>
                                    <div className="w-2/3">
                                        <Input label="Title" value={item.title} onChange={(v: string) => updateItem(i, 'title', v)} />
                                    </div>
                                </div>
                                <TextArea label="Description" value={item.description} onChange={(v: string) => updateItem(i, 'description', v)} />
                            </div>
                        </div>
                    ))}

                    {/* Add Button */}
                    <button
                        onClick={addItem}
                        className="flex flex-col items-center justify-center h-full min-h-[150px] rounded-lg border-2 border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all group"
                    >
                        <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Plus className="w-5 h-5 text-gray-400 group-hover:text-blue-500" />
                        </div>
                        <span className="mt-2 text-xs font-medium text-gray-500 group-hover:text-blue-600">Add Feature</span>
                    </button>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
