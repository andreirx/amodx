import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { LayoutTemplate } from 'lucide-react';
import { HeroSchema } from './schema';
import { HeroEditor } from './HeroEditor';
import { HeroRender } from './HeroRender';
import { PluginDefinition } from '../types';

export const HeroPlugin: PluginDefinition = {
    key: 'hero',
    label: 'Hero Section',
    icon: LayoutTemplate,
    schema: HeroSchema,

    editorExtension: Node.create({
        name: 'hero',
        group: 'block',
        atom: true,
        addAttributes() {
            return {
                headline: { default: 'Welcome' },
                subheadline: { default: '' },
                ctaText: { default: 'Get Started' },
                ctaLink: { default: '#' },
                style: { default: 'center' },
            };
        },
        parseHTML() { return [{ tag: 'app-hero' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-hero', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(HeroEditor); },
    }),

    renderComponent: HeroRender
};
