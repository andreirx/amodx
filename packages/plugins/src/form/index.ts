import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ClipboardList } from 'lucide-react';
import { FormBlockSchema } from './schema';
import { FormEditor } from './FormEditor';
import { FormRender } from './FormRender';
import { PluginDefinition } from '../types';

// SHOP-LOOK-1E: no `offeredOn` — a custom form is offered on every site kind (a form has no commerce or catalog
// dependency; design docs/slices/shop-look-1.md SL-D11 restricts only the product and category blocks).
export const FormPlugin: PluginDefinition = {
    key: 'form',
    label: 'Custom Form',
    icon: ClipboardList,
    schema: FormBlockSchema,

    editorExtension: Node.create({
        name: 'form',
        group: 'block',
        atom: true,

        // The admin's BlockEditor injects the tenant's form list (`GET /forms`, the list the Forms page shows).
        addStorage() {
            return { fetchFormsFn: null };
        },

        addAttributes() {
            return {
                formSlug: { default: '' },
                eyebrow: { default: '' },
                headline: { default: '' },
                text: { default: '' },
                card: { default: false },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-form' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-form', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(FormEditor); },
    }),

    renderComponent: FormRender
};
