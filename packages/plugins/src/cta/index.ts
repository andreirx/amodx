import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Megaphone } from 'lucide-react';
import { CtaSchema } from './schema';
import { CtaEditor } from './CtaEditor';
import { CtaRender } from './CtaRender'; // Provided previously
import { PluginDefinition } from '../types';

export const CtaPlugin: PluginDefinition = {
    key: 'cta',
    label: 'Call to Action',
    icon: Megaphone,
    schema: CtaSchema,

    editorExtension: Node.create({
        name: 'cta',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headline: { default: 'Ready to start?' },
                subheadline: { default: 'Join us today.' },
                buttonText: { default: 'Get Started' },
                buttonLink: { default: '#' },
                style: { default: 'simple' },
                blockWidth: { default: 'full' },
            };
        },

        parseHTML() { return [{ tag: 'app-cta' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-cta', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(CtaEditor); },
    }),

    renderComponent: CtaRender
};
