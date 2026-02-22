import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { LayoutGrid } from 'lucide-react';
import { FeaturesSchema } from './schema';
import { FeaturesEditor } from './FeaturesEditor';
import { FeaturesRender } from './FeaturesRender'; // Provided previously
import { PluginDefinition } from '../types';

export const FeaturesPlugin: PluginDefinition = {
    key: 'features',
    label: 'Feature Grid',
    icon: LayoutGrid,
    schema: FeaturesSchema,

    editorExtension: Node.create({
        name: 'features',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headline: { default: 'Key Features' },
                subheadline: { default: 'Everything you need.' },
                items: {
                    default: [
                        { id: '1', title: 'Fast', description: 'Blazing fast.', icon: 'Zap' },
                        { id: '2', title: 'Secure', description: 'Safe.', icon: 'Shield' },
                        { id: '3', title: 'Scale', description: 'Grows with you.', icon: 'TrendingUp' },
                    ]
                },
                columns: { default: '3' },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-features' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-features', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(FeaturesEditor); },
    }),

    renderComponent: FeaturesRender
};
