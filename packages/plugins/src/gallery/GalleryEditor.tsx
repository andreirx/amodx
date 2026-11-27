import { NodeViewWrapper } from '@tiptap/react';
import { Images, ArrowUp, ArrowDown, X, Plus } from 'lucide-react';
import React from 'react';
import { BlockWidthControl } from '../BlockWidthControl';
import { withItemMoved, withoutItem } from '../category-grid/CategoryGridEditor';

/** A stored photo as the editor keeps it: the fields it edits plus any other field a tool wrote (`thumb`, sizes). */
type Item = { src: string; alt?: string; caption?: string; [field: string]: unknown };

/** `items` with one new photo per picked address appended, in the picked order; a blank address adds nothing. A photo
 *  already in the gallery can be added again (the owner may want it twice). */
export function withPhotosAdded(items: Item[], addresses: string[]): Item[] {
    return [...items, ...addresses.filter((a) => typeof a === 'string' && a.trim() !== '').map((src) => ({ src, alt: '' }))];
}

const inputClass = 'w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:border-sky-400';
const iconButton = 'p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent';

/**
 * GALLERY-1 (docs/slices/gallery-1.md, scope item 5; ruling 5) — the `gallery` editor. "Add photos" opens the admin's
 * media picker in its multi-select mode (`editor.storage.gallery.pickManyFn`, injected by the admin's BlockEditor; the
 * plugin imports nothing from `admin/`): the owner picks several images in one step and they are appended in the picked
 * order. Per photo: a description (`alt`) and a caption; move up / move down / remove buttons (keyboard-reachable; no
 * drag and drop). The tile file (`thumb`) and the sizes are not asked for: tools write them (ruling 6), and the editor
 * keeps them when it changes a photo.
 */
export function GalleryEditor(props: any) {
    const { columns, blockWidth } = props.node.attrs;
    const items: Item[] = Array.isArray(props.node.attrs.items) ? props.node.attrs.items : [];
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });
    const setField = (i: number, field: 'alt' | 'caption', value: string) => update('items', items.map((item, j) => (j === i ? { ...item, [field]: value } : item)));
    const pickManyFn = props.editor.storage.gallery?.pickManyFn;
    const addPhotos = () => {
        if (pickManyFn) pickManyFn((addresses: string[]) => update('items', withPhotosAdded(items, addresses)), { mediaType: 'image' });
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-sky-50 text-sky-600">
                            <Images className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Photo Gallery</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-gray-200" />
                        <select
                            value={columns}
                            onChange={e => update('columns', e.target.value)}
                            className="text-xs bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none"
                        >
                            <option value="2">2 columns</option>
                            <option value="3">3 columns</option>
                            <option value="4">4 columns</option>
                        </select>
                    </div>
                </div>

                <div className="p-5 space-y-3">
                    {items.length === 0 ? (
                        <p className="text-xs text-gray-400">No photos yet: the site shows nothing for this block.</p>
                    ) : (
                        <ol className="space-y-2">
                            {items.map((item, i) => (
                                <li key={i} className="flex items-start gap-3 rounded border border-gray-100 p-2">
                                    <div className="h-16 w-20 shrink-0 overflow-hidden rounded bg-gray-100">
                                        {typeof item.src === 'string' && item.src !== '' && (
                                            <img src={typeof item.thumb === 'string' && item.thumb !== '' ? item.thumb : item.src} alt="" className="h-full w-full object-cover" />
                                        )}
                                    </div>
                                    <div className="flex-1 space-y-1">
                                        <input
                                            className={inputClass}
                                            aria-label={`Photo ${i + 1}: description`}
                                            value={item.alt ?? ''}
                                            onChange={e => setField(i, 'alt', e.target.value)}
                                            placeholder="Description: what the photo shows (for screen readers and search engines)"
                                        />
                                        <input
                                            className={inputClass}
                                            aria-label={`Photo ${i + 1}: caption`}
                                            value={item.caption ?? ''}
                                            onChange={e => setField(i, 'caption', e.target.value)}
                                            placeholder="Caption under the photo in the viewer (optional)"
                                        />
                                    </div>
                                    <div className="flex flex-col">
                                        <button type="button" title="Move up" aria-label={`Move photo ${i + 1} up`} className={iconButton} disabled={i === 0} onClick={() => update('items', withItemMoved(items, i, -1))}><ArrowUp className="w-3.5 h-3.5" /></button>
                                        <button type="button" title="Move down" aria-label={`Move photo ${i + 1} down`} className={iconButton} disabled={i === items.length - 1} onClick={() => update('items', withItemMoved(items, i, 1))}><ArrowDown className="w-3.5 h-3.5" /></button>
                                        <button type="button" title="Remove" aria-label={`Remove photo ${i + 1}`} className={iconButton} onClick={() => update('items', withoutItem(items, i))}><X className="w-3.5 h-3.5" /></button>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    )}
                    <button
                        type="button"
                        onClick={addPhotos}
                        disabled={!pickManyFn}
                        className="flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 disabled:opacity-40"
                    >
                        <Plus className="w-3.5 h-3.5" /> Add photos
                    </button>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
