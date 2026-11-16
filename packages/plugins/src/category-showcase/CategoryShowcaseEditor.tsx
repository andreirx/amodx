import { NodeViewWrapper } from '@tiptap/react';
import { LayoutGrid, RefreshCw } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { BlockWidthControl } from '../BlockWidthControl';

/** The most badge tags the block schema accepts (`badgeTags: z.array(z.string()).max(10)`). */
const MAX_BADGE_TAGS = 10;

/**
 * SHOP-LOOK-1D: the value a text or tick-box option stores. A cleared option stores null, so the attribute is absent
 * again (design § 4): blank text → null; an unticked box → null; a ticked box → true; other text unchanged.
 */
export function storedShowcaseOption(value: string | boolean): string | true | null {
    if (typeof value === 'boolean') return value ? true : null;
    return value.trim() === '' ? null : value;
}

/**
 * SHOP-LOOK-1D: the badge tag field → the stored `badgeTags`. Comma-separated; each entry trimmed; blank entries dropped;
 * the first 10 kept (the schema's limit); nothing left → null (absent). The site ignores letter case but not spaces when
 * it matches an entry to a product's tag (BADGE-CASE-1), and draws the entry as typed here.
 */
export function badgeTagsFromText(text: string): string[] | null {
    const tags = text.split(',').map((t) => t.trim()).filter((t) => t !== '').slice(0, MAX_BADGE_TAGS);
    return tags.length === 0 ? null : tags;
}

export function CategoryShowcaseEditor(props: any) {
    const { categoryId, categoryName, categorySlug, limit, columns, showPrice, ctaText, blockWidth, eyebrow, badgeTags, showCategoryLabel, showDescription, showRating } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });
    const updateOption = (field: string, value: string | boolean) => update(field, storedShowcaseOption(value));
    // The field keeps what the owner types (a trailing comma, a space); the stored list is parsed from it on each change.
    const [badgeText, setBadgeText] = useState<string>(Array.isArray(badgeTags) ? badgeTags.join(', ') : '');

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
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-gray-200" />
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

                    {/* SHOP-LOOK-1D options: each optional; cleared → absent */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0">Label above the name:</label>
                        <input
                            className="flex-1 text-sm border rounded px-2 py-1.5 focus:outline-none focus:border-emerald-400"
                            value={eyebrow ?? ''}
                            onChange={e => updateOption('eyebrow', e.target.value)}
                            placeholder="Optional, e.g. Our picks"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0">Badge tags:</label>
                        <input
                            className="flex-1 text-sm border rounded px-2 py-1.5 focus:outline-none focus:border-emerald-400"
                            value={badgeText}
                            onChange={e => { setBadgeText(e.target.value); update('badgeTags', badgeTagsFromText(e.target.value)); }}
                            placeholder="Optional, comma-separated, e.g. TOP PICK, NEW"
                        />
                    </div>
                    <p className="text-xs text-gray-500">A product with one of these tags shows a badge: the first tag of this list that it has. Capital letters do not count: TOP PICK matches Top pick. The badge shows the tag as you type it here.</p>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700">
                        <span className="font-medium">On each card:</span>
                        <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={showCategoryLabel === true} onChange={e => updateOption('showCategoryLabel', e.target.checked)} className="accent-emerald-600" />
                            Category name
                        </label>
                        <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={showDescription === true} onChange={e => updateOption('showDescription', e.target.checked)} className="accent-emerald-600" />
                            Short description
                        </label>
                        <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={showRating === true} onChange={e => updateOption('showRating', e.target.checked)} className="accent-emerald-600" />
                            Rating (approved reviews)
                        </label>
                    </div>
                    <p className="text-xs text-gray-500">Not shown on a catalog site.</p>

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
