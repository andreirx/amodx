import { NodeViewWrapper } from '@tiptap/react';
import { Plus, Trash2, MessageSquareQuote, User } from 'lucide-react';
import React from 'react';

const Input = ({ value, onChange, placeholder }: any) => (
    <input
        className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-orange-500 outline-none"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

const TextArea = ({ value, onChange, placeholder }: any) => (
    <textarea
        className="w-full h-20 bg-white border border-gray-200 rounded p-2 text-sm focus:border-orange-500 outline-none resize-none"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
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

    const addItem = () => update('items', [...safeItems, { id: crypto.randomUUID(), quote: "Amazing service.", author: "Name", role: "Title" }]);
    const removeItem = (index: number) => update('items', safeItems.filter((_: any, i: number) => i !== index));

    const handlePickAvatar = (index: number) => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) {
            pickFn((url: string) => updateItem(index, 'avatar', url));
        }
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center border-b border-gray-100 bg-gray-50/50 px-4 py-3 gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-orange-50 text-orange-600">
                        <MessageSquareQuote className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Testimonials</span>
                </div>

                <div className="p-5">
                    <div className="mb-6 space-y-2">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Header</label>
                        <Input value={headline} onChange={(v: string) => update('headline', v)} placeholder="Section Headline" />
                        <Input value={subheadline} onChange={(v: string) => update('subheadline', v)} placeholder="Subheadline" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {safeItems.map((item: any, i: number) => (
                            <div key={item.id || i} className="bg-white border border-gray-200 rounded-lg p-3 relative group hover:border-orange-200 transition-colors">
                                <button onClick={() => removeItem(i)} className="absolute top-2 right-2 p-1 text-gray-300 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>

                                <div className="space-y-3">
                                    <TextArea value={item.quote} onChange={(v: string) => updateItem(i, 'quote', v)} placeholder="Quote..." />
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="h-10 w-10 rounded-full bg-gray-100 border flex items-center justify-center cursor-pointer overflow-hidden shrink-0 hover:border-orange-300"
                                            onClick={() => handlePickAvatar(i)}
                                            title="Click to change avatar"
                                        >
                                            {item.avatar ? <img src={item.avatar} className="w-full h-full object-cover" /> : <User className="w-5 h-5 text-gray-400" />}
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <Input value={item.author} onChange={(v: string) => updateItem(i, 'author', v)} placeholder="Author" />
                                            <Input value={item.role} onChange={(v: string) => updateItem(i, 'role', v)} placeholder="Role" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                        <button onClick={addItem} className="min-h-[150px] border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center text-orange-400 hover:bg-orange-50/30 transition-all">
                            <Plus className="w-6 h-6 mb-1" />
                            <span className="text-xs font-bold">Add Testimonial</span>
                        </button>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
