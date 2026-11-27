import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Mail } from 'lucide-react';
import { NewsletterBlockSchema } from './schema';
import { NewsletterEditor } from './NewsletterEditor';
import { NewsletterRender } from './NewsletterRender';
import { PluginDefinition } from '../types';

// NEWSLETTER-1: no `offeredOn` — a newsletter signup has no commerce or catalog dependency; offered on every site.
export const NewsletterPlugin: PluginDefinition = {
    key: 'newsletter',
    label: 'Newsletter Signup',
    icon: Mail,
    schema: NewsletterBlockSchema,

    editorExtension: Node.create({
        name: 'newsletter',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headline: { default: '' },
                description: { default: '' },
                buttonText: { default: '' },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-newsletter' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-newsletter', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(NewsletterEditor); },
    }),

    renderComponent: NewsletterRender
};
