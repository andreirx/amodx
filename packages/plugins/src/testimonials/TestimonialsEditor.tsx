import { NodeViewWrapper } from '@tiptap/react';
import { Plus, Trash2, MessageSquareQuote, User } from 'lucide-react';
import React from 'react';

const Input = ({ label, value, onChange, className = "" }: any) => (
    <div className="space-y-1 w-full">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <input
            className={`w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-orange-500 outline-none transition-colors ${className}`}
            value={value || ""}
            onChange={e => onChange(e.target.value)}
        />
    </div>
);

const TextArea = ({ label, value, onChange }: any) => (
    <div className="space-y-1 w-full">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <textarea
            className="w-full h-16 bg-white border border-gray-200 rounded p-2 text-sm focus:border-orange-500 outline-none transition-colors"
            value={value || ""}
            onChange={e => onChange(e.target.value)}
        />
    </div>
);

export function TestimonialsEditor(props: any) {
    const { headline, subheadline, items } = props.node.attrs;
    const safeItems = Array.isArray(items) ? items : [];

    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...safeItems];
        newItems[index] = { ...newItems[index], [field]: value };
        update('items', newItems);
    };

    const addItem = () => {
        update('items', [...safeItems, { id: crypto.randomUUID(), quote: "Amazing service.", author: "Name", role: "Title" }]);
    };

    const removeItem = (index: number) => {
        update('items', safeItems.filter((_: any, i: number) => i !== index));
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-orange-200 bg-orange-50/30 rounded-xl p-6 shadow-sm">
                <div className="mb-6 space-y-4 max-w-lg">
                    <div className="flex items-center gap-2">
                        <MessageSquareQuote className="w-4 h-4 text-orange-600" />
                        <span className="text-xs font-bold text-orange-600 uppercase tracking-widest">Testimonials</span>
                    </div>
                    <Input value={headline} onChange={(v: string) => update('headline', v)} className="font-bold text-lg" />
                    <Input value={subheadline} onChange={(v: string) => update('subheadline', v)} />
                </div>

                <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                    {safeItems.map((item: any, i: number) => (
                        <div key={item.id || i} className="relative p-4 rounded-lg border border-gray-200 bg-white group hover:border-orange-300 transition-colors">
                            <button onClick={() => removeItem(i)} className="absolute top-2 right-2 p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                <Trash2 className="w-4 h-4" />
                            </button>
                            <div className="space-y-3 pr-6">
                                <TextArea label="Quote" value={item.quote} onChange={(v: string) => updateItem(i, 'quote', v)} />
                                <div className="flex gap-2">
                                    <Input label="Author" value={item.author} onChange={(v: string) => updateItem(i, 'author', v)} />
                                    <Input label="Role" value={item.role} onChange={(v: string) => updateItem(i, 'role', v)} />
                                </div>
                            </div>
                        </div>
                    ))}
                    <button onClick={addItem} className="flex flex-col items-center justify-center h-full min-h-[150px] rounded-lg border-2 border-dashed border-gray-200 hover:border-orange-300 hover:bg-orange-50/50 transition-all group">
                        <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Plus className="w-5 h-5 text-gray-400 group-hover:text-orange-500" />
                        </div>
                        <span className="mt-2 text-xs font-medium text-gray-500 group-hover:text-orange-600">Add Testimonial</span>
                    </button>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
