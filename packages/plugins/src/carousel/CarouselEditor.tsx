import { NodeViewWrapper } from '@tiptap/react';
import { GalleryHorizontal, Plus, Trash2, Image as ImageIcon } from 'lucide-react';
import React from 'react';

// Helpers
const Input = ({ label, value, onChange }: any) => (
    <div className="space-y-1 w-full">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <input
            className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-cyan-500 outline-none"
            value={value || ""}
            onChange={e => onChange(e.target.value)}
        />
    </div>
);

const Select = ({ label, value, onChange, options }: any) => (
    <div className="space-y-1 w-full">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <select
            className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-cyan-500 outline-none cursor-pointer"
            value={value}
            onChange={e => onChange(e.target.value)}
        >
            {options.map((o: string) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
    </div>
);

export function CarouselEditor(props: any) {
    // FIX: Destructure style
    const { headline, items, style } = props.node.attrs;
    const safeItems = Array.isArray(items) ? items : [];

    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...safeItems];
        newItems[index] = { ...newItems[index], [field]: value };
        update('items', newItems);
    };

    const addItem = () => {
        update('items', [...safeItems, { id: crypto.randomUUID(), title: "New Item", description: "...", link: "#" }]);
    };

    const removeItem = (index: number) => {
        update('items', safeItems.filter((_: any, i: number) => i !== index));
    };

    const handlePickImage = (index: number) => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) {
            pickFn((url: string) => updateItem(index, 'image', url));
        }
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-cyan-100 bg-cyan-50/20 rounded-xl p-5 shadow-sm">
                {/* ... Header ... */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2 text-cyan-600">
                        <GalleryHorizontal className="w-5 h-5" />
                        <span className="font-bold text-xs uppercase tracking-widest">Carousel</span>
                    </div>
                    <div className="w-32">
                        <Select
                            label="Style"
                            value={style || 'standard'}
                            onChange={(v: string) => update('style', v)}
                            options={["standard", "coverflow"]}
                        />
                    </div>
                </div>

                <div className="mb-6">
                    <Input label="Headline" value={headline} onChange={(v: string) => update('headline', v)} />
                </div>

                {/* FIX: Use Grid instead of Flex for better Editor UX */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {safeItems.map((item: any, i: number) => (
                        <div key={item.id || i} className="bg-white border border-gray-200 rounded-lg p-3 relative group shadow-sm hover:shadow-md transition-all">
                            {/* ... Content ... */}
                            <button onClick={() => removeItem(i)} className="absolute top-2 right-2 text-gray-300 hover:text-red-500 z-10 p-1 bg-white/80 rounded-full">
                                <Trash2 className="w-4 h-4" />
                            </button>

                            <div className="mb-3">
                                <div
                                    className="aspect-video bg-gray-100 rounded flex items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors relative overflow-hidden group/img"
                                    onClick={() => handlePickImage(i)}
                                >
                                    {item.image ? (
                                        <img src={item.image} className="w-full h-full object-cover" />
                                    ) : (
                                        <ImageIcon className="w-6 h-6 text-gray-400" />
                                    )}
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 flex items-center justify-center text-white text-xs font-medium transition-opacity">Change Image</div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Input value={item.title} onChange={(v: string) => updateItem(i, 'title', v)} placeholder="Title" />
                                <Input value={item.description} onChange={(v: string) => updateItem(i, 'description', v)} placeholder="Description" />
                                <Input value={item.link} onChange={(v: string) => updateItem(i, 'link', v)} placeholder="Link URL" />
                            </div>
                        </div>
                    ))}

                    {/* Add Button */}
                    <button
                        onClick={addItem}
                        className="min-h-[200px] border-2 border-dashed border-cyan-200 rounded-lg flex flex-col items-center justify-center text-cyan-500 hover:bg-cyan-50 transition-colors"
                    >
                        <Plus className="w-8 h-8 mb-2" />
                        <span className="text-sm font-bold">Add Item</span>
                    </button>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
