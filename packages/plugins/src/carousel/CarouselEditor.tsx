import { NodeViewWrapper } from '@tiptap/react';
import { GalleryHorizontal, Plus, Trash2, Image as ImageIcon, Upload } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { BlockWidthControl } from '../BlockWidthControl';

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
    const { headline, items, style, blockWidth, cardFormat } = props.node.attrs;
    const safeItems = Array.isArray(items) ? items : [];
    const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());

    // Ref always holds the latest items so async callbacks never read stale state.
    const itemsRef = useRef(safeItems);
    itemsRef.current = safeItems;

    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...safeItems];
        newItems[index] = { ...newItems[index], [field]: value };
        update('items', newItems);
    };

    // Write a single field on an item identified by stable id, reading the
    // latest items array via ref so that concurrent edits are not discarded.
    const updateItemById = (itemId: string, field: string, value: any) => {
        const current = itemsRef.current;
        const idx = current.findIndex((it: any) => it.id === itemId);
        if (idx === -1) return; // item was deleted during async op
        const newItems = [...current];
        newItems[idx] = { ...newItems[idx], [field]: value };
        update('items', newItems);
    };

    const addItem = () => {
        update('items', [...safeItems, { id: crypto.randomUUID(), title: "New Item", description: "...", link: "#" }]);
    };

    const removeItem = (index: number) => {
        update('items', safeItems.filter((_: any, i: number) => i !== index));
    };

    const handlePickImage = (itemId: string) => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) {
            pickFn((url: string) => updateItemById(itemId, 'image', url));
        }
    };

    const handleUploadImage = async (itemId: string, file: File) => {
        const uploadFn = props.editor.storage.image?.uploadFn;
        if (!uploadFn) return;
        setUploadingIds(prev => new Set(prev).add(itemId));
        try {
            const url = await uploadFn(file);
            updateItemById(itemId, 'image', url);
        } catch (e) { console.error(e); }
        finally {
            setUploadingIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
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
                    <div className="flex items-center gap-2">
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-gray-200" />
                        <select
                            className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium shadow-sm outline-none focus:border-cyan-500 cursor-pointer"
                            value={style || 'standard'}
                            onChange={e => update('style', e.target.value)}
                        >
                            <option value="standard">Standard</option>
                            <option value="coverflow">Coverflow</option>
                        </select>
                        {style !== 'coverflow' && (
                            <select
                                className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium shadow-sm outline-none focus:border-cyan-500 cursor-pointer"
                                value={cardFormat || 'vertical'}
                                onChange={e => update('cardFormat', e.target.value)}
                            >
                                <option value="vertical">Vertical</option>
                                <option value="horizontal">Horizontal</option>
                                <option value="square">Square</option>
                            </select>
                        )}
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
                                    <div className="aspect-video bg-gray-100 rounded flex items-center justify-center relative overflow-hidden group/img">
                                        {uploadingIds.has(item.id) ? (
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <Upload className="w-4 h-4 animate-pulse" /> Uploading...
                                            </div>
                                        ) : item.image ? (
                                            <>
                                                <img src={item.image} className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                                                    <label className="cursor-pointer bg-white text-gray-900 px-2 py-1 rounded text-[10px] font-medium hover:bg-gray-100">
                                                        Replace
                                                        <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUploadImage(item.id, e.target.files[0])} accept="image/*" />
                                                    </label>
                                                    <button onClick={() => handlePickImage(item.id)} className="bg-white text-gray-900 px-2 py-1 rounded text-[10px] font-medium hover:bg-gray-100">Library</button>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex gap-2 items-center">
                                                <label className="cursor-pointer text-[10px] font-bold text-cyan-600 hover:underline">
                                                    UPLOAD
                                                    <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUploadImage(item.id, e.target.files[0])} accept="image/*" />
                                                </label>
                                                <span className="text-[10px] text-gray-400">OR</span>
                                                <button onClick={() => handlePickImage(item.id)} className="text-[10px] font-bold text-cyan-600 hover:underline">LIBRARY</button>
                                            </div>
                                        )}
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
