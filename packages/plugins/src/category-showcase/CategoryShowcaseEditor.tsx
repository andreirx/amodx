import { NodeViewWrapper } from '@tiptap/react';
import { LayoutGrid, RefreshCw } from 'lucide-react';
import React, { useState, useEffect } from 'react';

export function CategoryShowcaseEditor(props: any) {
    const { categoryId, categoryName, categorySlug, limit, columns, showPrice, ctaText } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const [categories, setCategories] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // Fetch categories via injected function
    useEffect(() => {
        const fetchFn = props.editor.storage.categoryShowcase?.fetchCategoriesFn;
        if (fetchFn) {
            setLoading(true);
            fetchFn().then((cats: any[]) => {
                setCategories(cats);
                setLoading(false);
            }).catch(() => setLoading(false));
        }
    }, []);

    const selectCategory = (cat: any) => {
        update('categoryId', cat.id);
        update('categoryName', cat.name);
        update('categorySlug', cat.slug);
    };

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-emerald-200 bg-white rounded-xl overflow-hidden shadow-sm">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-emerald-50 border-b border-emerald-200">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-200 text-emerald-700">
                            <LayoutGrid className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Category Showcase</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-emerald-700">
                            <input type="checkbox" checked={showPrice} onChange={e => update('showPrice', e.target.checked)} className="accent-emerald-600" />
                            Prices
                        </label>
                        <select
                            value={columns}
                            onChange={e => update('columns', e.target.value)}
                            className="text-xs bg-white border border-emerald-200 rounded px-2 py-1 focus:outline-none"
                        >
                            <option value="2">2 columns</option>
                            <option value="3">3 columns</option>
                            <option value="4">4 columns</option>
                        </select>
                        <select
                            value={limit}
                            onChange={e => update('limit', parseInt(e.target.value))}
                            className="text-xs bg-white border border-emerald-200 rounded px-2 py-1 focus:outline-none"
                        >
                            {[2, 3, 4, 6, 8, 12].map(n => (
                                <option key={n} value={n}>{n} products</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="p-4 space-y-3">
                    {/* Category selector */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0">Category:</label>
                        {categories.length > 0 ? (
                            <select
                                value={categoryId}
                                onChange={e => {
                                    const cat = categories.find((c: any) => c.id === e.target.value);
                                    if (cat) selectCategory(cat);
                                }}
                                className="flex-1 text-sm border rounded px-2 py-1.5 focus:outline-none focus:border-emerald-400"
                            >
                                <option value="">Select a category...</option>
                                {categories.map((cat: any) => (
                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                            </select>
                        ) : (
                            <div className="flex-1 flex items-center gap-2">
                                <input
                                    className="flex-1 text-sm border rounded px-2 py-1.5 focus:outline-none focus:border-emerald-400"
                                    value={categoryId}
                                    onChange={e => update('categoryId', e.target.value)}
                                    placeholder="Category ID (paste from admin)"
                                />
                                {loading && <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin" />}
                            </div>
                        )}
                    </div>

                    {categoryName && (
                        <div className="text-sm text-gray-500">
                            Selected: <strong>{categoryName}</strong> ({categorySlug})
                        </div>
                    )}

                    {/* CTA text */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0">Button text:</label>
                        <input
                            className="flex-1 text-sm border rounded px-2 py-1.5 focus:outline-none focus:border-emerald-400"
                            value={ctaText}
                            onChange={e => update('ctaText', e.target.value)}
                            placeholder="View All Products"
                        />
                    </div>

                    {/* Preview placeholder */}
                    <div className={`grid gap-3 ${columns === '2' ? 'grid-cols-2' : columns === '3' ? 'grid-cols-3' : 'grid-cols-4'}`}>
                        {Array.from({ length: Math.min(limit, parseInt(columns)) }).map((_, i) => (
                            <div key={i} className="aspect-square bg-gray-100 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 text-xs">
                                Product {i + 1}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
