import { NodeViewWrapper } from '@tiptap/react';
import { HelpCircle, Plus, Trash2 } from 'lucide-react';
import React from 'react';

// FIX: Added proper types for props and events
interface InputProps {
    label?: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    className?: string;
    placeholder?: string;
}

const Input = ({ label, value, onChange, className = "", placeholder }: InputProps) => (
    <div className="space-y-1 w-full">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <input
            className={`w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-blue-500 outline-none transition-colors ${className}`}
            value={value || ""}
            onChange={onChange}
            placeholder={placeholder}
        />
    </div>
);

interface TextAreaProps {
    label?: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
}

const TextArea = ({ label, value, onChange, placeholder }: TextAreaProps) => (
    <div className="space-y-1 w-full">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <textarea
            className="w-full h-20 bg-white border border-gray-200 rounded p-2 text-sm focus:border-blue-500 outline-none transition-colors font-sans"
            value={value || ""}
            onChange={onChange}
            placeholder={placeholder}
        />
    </div>
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

    const addItem = () => update('items', [...safeItems, { id: crypto.randomUUID(), question: "New Question", answer: "Answer" }]);
    const removeItem = (index: number) => update('items', safeItems.filter((_: any, i: number) => i !== index));

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-blue-100 bg-blue-50/20 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4 text-blue-600">
                    <HelpCircle className="w-5 h-5" />
                    <span className="font-bold text-xs uppercase tracking-widest">FAQ Section</span>
                </div>
                <input
                    className="w-full text-lg font-bold bg-transparent border-b border-transparent hover:border-blue-200 focus:border-blue-500 outline-none mb-6"
                    value={headline}
                    onChange={(e) => update('headline', e.target.value)}
                />

                <div className="space-y-3">
                    {safeItems.map((item: any, i: number) => (
                        <div key={item.id} className="flex gap-3 items-start bg-white p-3 rounded border border-gray-100">
                            <div className="flex-1 space-y-2">
                                <Input
                                    value={item.question}
                                    onChange={(e) => updateItem(i, 'question', e.target.value)}
                                    placeholder="Question"
                                />
                                <TextArea
                                    value={item.answer}
                                    onChange={(e) => updateItem(i, 'answer', e.target.value)}
                                    placeholder="Answer"
                                />
                            </div>
                            <button onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                    <button onClick={addItem} className="w-full py-2 border-2 border-dashed border-blue-100 text-blue-400 rounded-lg hover:bg-blue-50 hover:border-blue-300 flex items-center justify-center gap-2 text-sm font-medium transition-colors">
                        <Plus className="w-4 h-4" /> Add Question
                    </button>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
