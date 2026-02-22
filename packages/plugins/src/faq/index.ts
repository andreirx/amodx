import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { HelpCircle } from 'lucide-react';
import { FaqSchema } from './schema';
import { FaqEditor } from './FaqEditor';
import { FaqRender } from './FaqRender';
import { PluginDefinition } from '../types';

export const FaqPlugin: PluginDefinition = {
    key: 'faq',
    label: 'FAQ List',
    icon: HelpCircle,
    schema: FaqSchema,

    editorExtension: Node.create({
        name: 'faq',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headline: { default: 'Frequently Asked Questions' },
                items: {
                    default: [
                        { id: '1', question: 'Is this free?', answer: 'Yes, for the basic plan.' },
                        { id: '2', question: 'Can I cancel?', answer: 'Anytime.' }
                    ]
                },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-faq' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-faq', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(FaqEditor); },
    }),

    renderComponent: FaqRender
};
