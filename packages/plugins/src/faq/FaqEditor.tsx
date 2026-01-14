import { NodeViewWrapper } from '@tiptap/react';
import { HelpCircle, Plus, Trash2 } from 'lucide-react';
import React from 'react';

const Input = ({ value, onChange, placeholder }: any) => (
    <input
        className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-teal-500 outline-none"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

const TextArea = ({ value, onChange, placeholder }: any) => (
    <textarea
        className="w-full h-16 bg-white border border-gray-200 rounded p-2 text-sm focus:border-teal-500 outline-none resize-none"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

export function FaqEditor(props: any) {
    const { headline, items } = props.node.attrs;
    const safeItems = Array.isArray(items) ? items : [];

    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });
    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...safeItems];
        newItems[index] = { ...newItems[index], [field]: value };
        update('items', newItems);
    };

    const addItem = () => update('items', [...safeItems, { id: crypto.randomUUID(), question: "", answer: "" }]);
    const removeItem = (index: number) => update('items', safeItems.filter((_: any, i: number) => i !== index));

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center border-b border-gray-100 bg-gray-50/50 px-4 py-3 gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-teal-50 text-teal-600">
                        <HelpCircle className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">FAQ Section</span>
                </div>

                <div className="p-5">
                    <div className="mb-6">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 block">Headline</label>
                        <Input value={headline} onChange={(e: any) => update('headline', e.target.value)} />
                    </div>

                    <div className="space-y-3">
                        {safeItems.map((item: any, i: number) => (
                            <div key={item.id || i} className="flex gap-3 items-start bg-white p-3 rounded border border-gray-200 group hover:border-teal-200 transition-colors">
                                <div className="flex-1 space-y-2">
                                    <Input
                                        value={item.question}
                                        onChange={(e: any) => updateItem(i, 'question', e.target.value)}
                                        placeholder="Question"
                                    />
                                    <TextArea
                                        value={item.answer}
                                        onChange={(e: any) => updateItem(i, 'answer', e.target.value)}
                                        placeholder="Answer"
                                    />
                                </div>
                                <button onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}

                        <button onClick={addItem} className="w-full py-2 border-2 border-dashed border-gray-200 text-teal-600 rounded-lg hover:bg-teal-50/30 hover:border-teal-300 flex items-center justify-center gap-2 text-xs font-bold transition-all">
                            <Plus className="w-4 h-4" /> ADD QUESTION
                        </button>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
