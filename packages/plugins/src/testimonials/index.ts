import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MessageSquareQuote } from 'lucide-react';
import { TestimonialsSchema } from './schema';
import { TestimonialsEditor } from './TestimonialsEditor';
import { TestimonialsRender } from './TestimonialsRender';
import { PluginDefinition } from '../types';

export const TestimonialsPlugin: PluginDefinition = {
    key: 'testimonials',
    label: 'Testimonials',
    icon: MessageSquareQuote,
    schema: TestimonialsSchema,

    editorExtension: Node.create({
        name: 'testimonials',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headline: { default: 'Trusted by Builders' },
                subheadline: { default: 'See what others are saying.' },
                items: {
                    default: [
                        { id: '1', quote: "The deployment speed is insane.", author: "Jane Doe", role: "CTO" },
                        { id: '2', quote: "Finally, no more plugin updates.", author: "John Smith", role: "Agency Owner" },
                    ]
                },
                style: { default: 'grid' },
                blockWidth: { default: 'full' },
            };
        },

        parseHTML() {
            return [{ tag: 'app-testimonials' }];
        },

        renderHTML({ HTMLAttributes }) {
            return ['app-testimonials', mergeAttributes(HTMLAttributes)];
        },

        addNodeView() {
            return ReactNodeViewRenderer(TestimonialsEditor);
        },
    }),

    renderComponent: TestimonialsRender
};
