import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { LayoutGrid } from 'lucide-react';
import { CategoryShowcaseSchema } from './schema';
import { CategoryShowcaseEditor } from './CategoryShowcaseEditor';
import { CategoryShowcaseRender } from './CategoryShowcaseRender';
import { PluginDefinition } from '../types';

export const CategoryShowcasePlugin: PluginDefinition = {
    key: 'categoryShowcase',
    label: 'Category Showcase',
    icon: LayoutGrid,
    schema: CategoryShowcaseSchema,
    commerce: true,

    editorExtension: Node.create({
        name: 'categoryShowcase',
        group: 'block',
        atom: true,

        addStorage() {
            return { fetchCategoriesFn: null };
        },

        addAttributes() {
            return {
                categoryId: { default: '' },
                categoryName: { default: '' },
                categorySlug: { default: '' },
                limit: { default: 4 },
                columns: { default: '4' },
                showPrice: { default: true },
                ctaText: { default: 'View All Products' },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-category-showcase' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-category-showcase', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(CategoryShowcaseEditor); },
    }),

    renderComponent: CategoryShowcaseRender
};
