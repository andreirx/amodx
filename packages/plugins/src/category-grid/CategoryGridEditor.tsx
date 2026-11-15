import { NodeViewWrapper } from '@tiptap/react';
import { LayoutDashboard, ArrowUp, ArrowDown, X, Plus, RefreshCw } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { BlockWidthControl } from '../BlockWidthControl';

/** The most categories a grid holds (schema `categoryIds.max(12)`, design § 4.2). */
export const MAX_GRID_CATEGORIES = 12;
/** The most links under the grid (schema `chips.max(12)`). */
const MAX_CHIPS = 12;

type Chip = { label: string; href: string };

/** `ids` with `id` appended at the end — unchanged when `id` is blank, already picked, or the list is full. */
export function withPickedId(ids: string[], id: string): string[] {
    if (id === '' || ids.includes(id) || ids.length >= MAX_GRID_CATEGORIES) return ids;
    return [...ids, id];
}

/** `list` with the item at `index` swapped with its neighbour at `index + delta` (-1 up, +1 down); unchanged at an end. */
export function withItemMoved<T>(list: T[], index: number, delta: -1 | 1): T[] {
    const to = index + delta;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
    const next = [...list];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
}

/** `list` without the item at `index`. */
export function withoutItem<T>(list: T[], index: number): T[] {
    return list.filter((_, i) => i !== index);
}

const inputClass = 'flex-1 text-sm border rounded px-2 py-1.5 focus:outline-none focus:border-emerald-400';
const iconButton = 'p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent';

/**
 * SHOP-LOOK-1C — the `categoryGrid` editor. The tenant's categories come from `editor.storage.categoryGrid
 * .fetchCategoriesFn` (injected by the admin's BlockEditor, the same list the showcase editor receives). The owner adds
 * categories from that list, orders them (up / down) and removes them; the picked list, with each category's photo and
 * name, is the editor's preview (the public render draws nothing without server data, design SL-D12). A picked id that is
 * not in the list (deleted) or a category that is not active is marked: the site skips it.
 */
export function CategoryGridEditor(props: any) {
    const { eyebrow, headline, columns, ctaText, blockWidth } = props.node.attrs;
    const categoryIds: string[] = Array.isArray(props.node.attrs.categoryIds) ? props.node.attrs.categoryIds : [];
    const chips: Chip[] = Array.isArray(props.node.attrs.chips) ? props.node.attrs.chips : [];
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const [categories, setCategories] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const fetchFn = props.editor.storage.categoryGrid?.fetchCategoriesFn;
        if (fetchFn) {
            setLoading(true);
            fetchFn().then((cats: any[]) => {
                setCategories(cats);
                setLoading(false);
            }).catch(() => setLoading(false));
        }
    }, []);

    const byId = new Map(categories.map((c: any) => [c.id, c]));
    const pickable = categories.filter((c: any) => !categoryIds.includes(c.id));
    const full = categoryIds.length >= MAX_GRID_CATEGORIES;

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-emerald-200 bg-white rounded-xl overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-4 py-2 bg-emerald-50 border-b border-emerald-200">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-200 text-emerald-700">
                            <LayoutDashboard className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Category Grid</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-gray-200" />
                        <select
                            value={columns}
                            onChange={e => update('columns', e.target.value)}
                            className="text-xs bg-white border border-emerald-200 rounded px-2 py-1 focus:outline-none"
                        >
                            <option value="2">2 columns</option>
                            <option value="3">3 columns</option>
                            <option value="4">4 columns</option>
                        </select>
                    </div>
                </div>

                <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0 w-28">Label above:</label>
                        <input className={inputClass} value={eyebrow || ''} onChange={e => update('eyebrow', e.target.value)} placeholder="e.g. Shop by category (optional)" />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0 w-28">Headline:</label>
                        <input className={inputClass} value={headline || ''} onChange={e => update('headline', e.target.value)} placeholder="Optional" />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0 w-28">Tile foot text:</label>
                        <input className={inputClass} value={ctaText || ''} onChange={e => update('ctaText', e.target.value)} placeholder="e.g. Shop category (optional, on every tile)" />
                    </div>

                    {/* Categories: add, order, remove */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-gray-700 shrink-0 w-28">Categories:</label>
                            <select
                                value=""
                                disabled={full || pickable.length === 0}
                                onChange={e => update('categoryIds', withPickedId(categoryIds, e.target.value))}
                                className={inputClass}
                            >
                                <option value="">{full ? `Maximum ${MAX_GRID_CATEGORIES} categories` : categories.length === 0 ? (loading ? 'Loading categories…' : 'No categories found') : 'Add a category…'}</option>
                                {pickable.map((c: any) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                            {loading && <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin" />}
                        </div>
                        {categoryIds.length === 0 ? (
                            <p className="text-xs text-gray-400">No category picked: the site shows only the label, the headline and the links.</p>
                        ) : (
                            <ol className="space-y-1">
                                {categoryIds.map((id, i) => {
                                    const cat = byId.get(id);
                                    const note = !cat ? (categories.length > 0 ? 'not found — skipped on the site' : '') : cat.status !== 'active' ? 'not active — skipped on the site' : '';
                                    return (
                                        <li key={id} className="flex items-center gap-2 rounded border border-gray-100 px-2 py-1">
                                            <div className="h-8 w-6 shrink-0 overflow-hidden rounded bg-gray-100">
                                                {cat?.imageLink && <img src={cat.imageLink} alt="" className="h-full w-full object-cover" />}
                                            </div>
                                            <span className="flex-1 text-sm text-gray-800">{cat?.name || id}</span>
                                            {note && <span className="text-xs text-amber-600">{note}</span>}
                                            <button type="button" title="Move up" className={iconButton} disabled={i === 0} onClick={() => update('categoryIds', withItemMoved(categoryIds, i, -1))}><ArrowUp className="w-3.5 h-3.5" /></button>
                                            <button type="button" title="Move down" className={iconButton} disabled={i === categoryIds.length - 1} onClick={() => update('categoryIds', withItemMoved(categoryIds, i, 1))}><ArrowDown className="w-3.5 h-3.5" /></button>
                                            <button type="button" title="Remove" className={iconButton} onClick={() => update('categoryIds', withoutItem(categoryIds, i))}><X className="w-3.5 h-3.5" /></button>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </div>

                    {/* Chips: label + link, under the grid */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Links under the grid (a link without a label or a link target is not shown):</label>
                        {chips.map((chip, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <input className={inputClass} value={chip.label} onChange={e => update('chips', chips.map((c, j) => j === i ? { ...c, label: e.target.value } : c))} placeholder="Label" />
                                <input className={inputClass} value={chip.href} onChange={e => update('chips', chips.map((c, j) => j === i ? { ...c, href: e.target.value } : c))} placeholder="/path or https://…" />
                                <button type="button" title="Move up" className={iconButton} disabled={i === 0} onClick={() => update('chips', withItemMoved(chips, i, -1))}><ArrowUp className="w-3.5 h-3.5" /></button>
                                <button type="button" title="Move down" className={iconButton} disabled={i === chips.length - 1} onClick={() => update('chips', withItemMoved(chips, i, 1))}><ArrowDown className="w-3.5 h-3.5" /></button>
                                <button type="button" title="Remove" className={iconButton} onClick={() => update('chips', withoutItem(chips, i))}><X className="w-3.5 h-3.5" /></button>
                            </div>
                        ))}
                        {chips.length < MAX_CHIPS && (
                            <button type="button" onClick={() => update('chips', [...chips, { label: '', href: '' }])} className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900">
                                <Plus className="w-3.5 h-3.5" /> Add link
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
