import { NodeViewWrapper } from '@tiptap/react';
import { ClipboardList, RefreshCw } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { BlockWidthControl } from '../BlockWidthControl';

/** A form as the admin's `GET /forms` lists it (projection `id, name, slug, status, createdAt`). */
export interface ListedForm {
    id: string;
    name: string;
    slug: string;
    status?: string;
}

/**
 * SHOP-LOOK-1E: the picker's note for the stored slug — "" when the slug names an active form of the list; otherwise
 * the reason the site draws nothing. With the list not loaded (empty) no note is given.
 */
export function formSlugNote(formSlug: string, forms: ListedForm[]): string {
    if (formSlug === '') return 'No form picked: the site shows nothing.';
    if (forms.length === 0) return '';
    const form = forms.find((f) => f.slug === formSlug);
    if (!form) return 'Form not found — the site shows nothing.';
    return form.status === 'active' ? '' : 'Form disabled — the site shows nothing.';
}

const inputClass = 'flex-1 text-sm border rounded px-2 py-1.5 focus:outline-none focus:border-indigo-400';

/**
 * SHOP-LOOK-1E — the `form` block editor. The tenant's forms come from `editor.storage.form.fetchFormsFn` (injected by
 * the admin's BlockEditor: `GET /forms`, the list the Forms page shows — the same injection path as the showcase's
 * categories). The owner picks a form by its name; the block stores its slug. The form's fields are edited on the Forms
 * page, not here.
 */
export function FormEditor(props: any) {
    const { formSlug, eyebrow, headline, text, card, blockWidth } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const [forms, setForms] = useState<ListedForm[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const fetchFn = props.editor.storage.form?.fetchFormsFn;
        if (fetchFn) {
            setLoading(true);
            fetchFn().then((items: ListedForm[]) => {
                setForms(items);
                setLoading(false);
            }).catch(() => setLoading(false));
        }
    }, []);

    const slug = typeof formSlug === 'string' ? formSlug : '';
    const note = formSlugNote(slug, forms);
    const listed = forms.some((f) => f.slug === slug);

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-indigo-200 bg-white rounded-xl overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-4 py-2 bg-indigo-50 border-b border-indigo-200">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-200 text-indigo-700">
                            <ClipboardList className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-indigo-800 uppercase tracking-wide">Custom Form</span>
                    </div>
                    <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                </div>

                <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0 w-28">Form:</label>
                        <select value={slug} onChange={e => update('formSlug', e.target.value)} className={inputClass}>
                            <option value="">{loading ? 'Loading forms…' : forms.length === 0 ? 'No forms found' : 'Pick a form…'}</option>
                            {!listed && slug !== '' && <option value={slug}>{slug}</option>}
                            {forms.map((f) => (
                                <option key={f.id} value={f.slug}>{f.status === 'active' ? f.name : `${f.name} (disabled)`}</option>
                            ))}
                        </select>
                        {loading && <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin" />}
                    </div>
                    {note && <p className="text-xs text-amber-600">{note}</p>}
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0 w-28">Label above:</label>
                        <input className={inputClass} value={eyebrow || ''} onChange={e => update('eyebrow', e.target.value)} placeholder="e.g. Contact (optional)" />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0 w-28">Headline:</label>
                        <input className={inputClass} value={headline || ''} onChange={e => update('headline', e.target.value)} placeholder="Optional" />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700 shrink-0 w-28">Text:</label>
                        <input className={inputClass} value={text || ''} onChange={e => update('text', e.target.value)} placeholder="Optional, under the headline" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={card === true} onChange={e => update('card', e.target.checked)} />
                        Show the form in a card
                    </label>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
