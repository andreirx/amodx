import { NodeViewWrapper } from '@tiptap/react';
import { Star, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import React, { useState } from 'react';

function StarRating({ rating, onChange }: { rating: number; onChange: (r: number) => void }) {
    return (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(i => (
                <button key={i} type="button" onClick={() => onChange(i)} className="p-0">
                    <Star className={`w-4 h-4 ${i <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
                </button>
            ))}
        </div>
    );
}

export function ReviewsCarouselEditor(props: any) {
    const { headline, items = [], showSource, autoScroll } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const updateItem = (id: string, field: string, value: any) => {
        const updated = items.map((item: any) => item.id === id ? { ...item, [field]: value } : item);
        update('items', updated);
    };

    const addItem = () => {
        const newItem = {
            id: crypto.randomUUID(),
            name: "Customer Name",
            avatarUrl: "",
            date: new Date().toISOString().split('T')[0],
            rating: 5,
            text: "",
            source: "google",
        };
        update('items', [...items, newItem]);
        setExpandedId(newItem.id);
    };

    const removeItem = (id: string) => {
        update('items', items.filter((item: any) => item.id !== id));
    };

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-amber-200 bg-white rounded-xl overflow-hidden shadow-sm">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-200">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-amber-200 text-amber-700">
                            <Star className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Reviews Carousel</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-amber-700">
                            <input type="checkbox" checked={showSource} onChange={e => update('showSource', e.target.checked)} className="accent-amber-600" />
                            Source badges
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-amber-700">
                            <input type="checkbox" checked={autoScroll} onChange={e => update('autoScroll', e.target.checked)} className="accent-amber-600" />
                            Auto-scroll
                        </label>
                    </div>
                </div>

                {/* Headline */}
                <div className="px-4 pt-3 pb-2">
                    <input
                        className="w-full text-lg font-bold bg-transparent border-b border-dashed border-gray-200 focus:border-amber-400 focus:outline-none pb-1"
                        value={headline}
                        onChange={e => update('headline', e.target.value)}
                        placeholder="Section headline..."
                    />
                </div>

                {/* Items */}
                <div className="px-4 pb-3 space-y-2">
                    {items.map((item: any) => {
                        const isExpanded = expandedId === item.id;
                        return (
                            <div key={item.id} className="border border-gray-200 rounded-lg overflow-hidden">
                                {/* Collapsed header */}
                                <div
                                    className="flex items-center justify-between px-3 py-2 bg-gray-50 cursor-pointer hover:bg-gray-100"
                                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                                >
                                    <div className="flex items-center gap-2">
                                        <StarRating rating={item.rating} onChange={r => updateItem(item.id, 'rating', r)} />
                                        <span className="text-sm font-medium">{item.name || "Unnamed"}</span>
                                        <span className="text-xs text-gray-400">{item.source}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={e => { e.stopPropagation(); removeItem(item.id); }} className="p-1 text-red-400 hover:text-red-600">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                        {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                                    </div>
                                </div>

                                {/* Expanded editor */}
                                {isExpanded && (
                                    <div className="p-3 space-y-2 bg-white">
                                        <div className="grid grid-cols-3 gap-2">
                                            <input className="col-span-1 text-sm border rounded px-2 py-1 focus:outline-none focus:border-amber-400" value={item.name} onChange={e => updateItem(item.id, 'name', e.target.value)} placeholder="Author name" />
                                            <input className="col-span-1 text-sm border rounded px-2 py-1 focus:outline-none focus:border-amber-400" type="date" value={item.date} onChange={e => updateItem(item.id, 'date', e.target.value)} />
                                            <select className="col-span-1 text-sm border rounded px-2 py-1 focus:outline-none focus:border-amber-400" value={item.source} onChange={e => updateItem(item.id, 'source', e.target.value)}>
                                                <option value="google">Google</option>
                                                <option value="facebook">Facebook</option>
                                                <option value="manual">Manual</option>
                                            </select>
                                        </div>
                                        <input className="w-full text-sm border rounded px-2 py-1 focus:outline-none focus:border-amber-400" value={item.avatarUrl || ""} onChange={e => updateItem(item.id, 'avatarUrl', e.target.value)} placeholder="Avatar URL (optional — colored initial if empty)" />
                                        <textarea className="w-full text-sm border rounded px-2 py-1.5 resize-y min-h-[60px] focus:outline-none focus:border-amber-400" value={item.text} onChange={e => updateItem(item.id, 'text', e.target.value)} placeholder="Review text..." />
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    <button onClick={addItem} className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:border-amber-300 hover:text-amber-600 flex items-center justify-center gap-1 transition-colors">
                        <Plus className="w-4 h-4" /> Add Review
                    </button>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
