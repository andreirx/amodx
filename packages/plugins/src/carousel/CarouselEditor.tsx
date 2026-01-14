import { NodeViewWrapper } from '@tiptap/react';
import { GalleryHorizontal, Plus, Trash2, Image as ImageIcon } from 'lucide-react';
import React from 'react';

const Input = ({ label, value, onChange, placeholder }: any) => (
    <div className="space-y-1 w-full">
        {label && <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</label>}
        <input
            className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-cyan-500 outline-none transition-colors"
            value={value || ""}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

export function CarouselEditor(props: any) {
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
            {/* Unified Container Style */}
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">

                {/* Unified Header Bar */}
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-cyan-50 text-cyan-600">
                            <GalleryHorizontal className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Carousel</span>
                    </div>
                    {/* Controls moved to Header */}
                    <div className="w-32">
                        <select
                            className="h-7 w-full rounded-md border border-gray-200 bg-white px-2 text-xs font-medium shadow-sm outline-none focus:border-cyan-500 cursor-pointer"
                            value={style || 'standard'}
                            onChange={e => update('style', e.target.value)}
                        >
                            <option value="standard">Standard</option>
                            <option value="coverflow">Coverflow</option>
                        </select>
                    </div>
                </div>

                {/* Content Body */}
                <div className="p-5">
                    <div className="mb-6">
                        <Input label="Section Headline" value={headline} onChange={(v: string) => update('headline', v)} />
                    </div>

                    {/* Preserved Grid Logic */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {safeItems.map((item: any, i: number) => (
                            <div key={item.id || i} className="bg-white border border-gray-200 rounded-lg p-3 relative group shadow-sm hover:shadow-md transition-all">
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
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 flex items-center justify-center text-white text-xs font-medium transition-opacity">Change</div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Input value={item.title} onChange={(v: string) => updateItem(i, 'title', v)} placeholder="Title" />
                                    <Input value={item.description} onChange={(v: string) => updateItem(i, 'description', v)} placeholder="Description" />
                                    <Input value={item.link} onChange={(v: string) => updateItem(i, 'link', v)} placeholder="Link URL" />
                                </div>
                            </div>
                        ))}

                        <button
                            onClick={addItem}
                            className="min-h-[200px] border-2 border-dashed border-cyan-200 rounded-lg flex flex-col items-center justify-center text-cyan-500 hover:bg-cyan-50 transition-colors"
                        >
                            <Plus className="w-8 h-8 mb-2" />
                            <span className="text-sm font-bold">Add Item</span>
                        </button>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
