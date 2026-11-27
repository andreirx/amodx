import { NodeViewWrapper } from '@tiptap/react';
import { Mail } from 'lucide-react';
import React from 'react';
import { BlockWidthControl } from '../BlockWidthControl';

const Input = ({ label, value, placeholder, onChange }: any) => (
    <div className="space-y-1">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
        <input className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-purple-500 outline-none" value={value || ""} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
);

/**
 * NEWSLETTER-1 — the `newsletter` block editor: headline, text and an optional button label. The email field, the
 * consent line and the other visitor texts come from the site's labels (Labels page), so the editor does not hold them.
 */
export function NewsletterEditor(props: any) {
    const { headline, description, buttonText, blockWidth } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-purple-50 text-purple-600">
                            <Mail className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Newsletter Signup</span>
                    </div>
                    <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                </div>
                <div className="p-5 space-y-4">
                    <Input label="Headline" value={headline} onChange={(v: string) => update('headline', v)} />
                    <Input label="Text" value={description} onChange={(v: string) => update('description', v)} />
                    <Input label="Button label" value={buttonText} placeholder="Empty = the site's label" onChange={(v: string) => update('buttonText', v)} />
                    <p className="text-xs text-gray-500">
                        The email field and the consent line use the site's labels (Labels page). Signups appear on the Leads page
                        and go to MailerLite when the site is connected (Settings).
                    </p>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
