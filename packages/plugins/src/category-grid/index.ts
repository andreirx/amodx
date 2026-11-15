import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { LayoutDashboard } from 'lucide-react';
import { CategoryGridSchema } from './schema';
import { CategoryGridEditor } from './CategoryGridEditor';
import { CategoryGridRender } from './CategoryGridRender';
import { PluginDefinition } from '../types';

// SHOP-LOOK-1C: offered on commerce and catalog sites, as `categoryShowcase` (design SL-D11).
export const CategoryGridPlugin: PluginDefinition = {
    key: 'categoryGrid',
    label: 'Category Grid',
    icon: LayoutDashboard,
    schema: CategoryGridSchema,
    offeredOn: ['commerce', 'catalog'],

    editorExtension: Node.create({
        name: 'categoryGrid',
        group: 'block',
        atom: true,

        // The admin's BlockEditor injects the tenant's category list (the same function as `categoryShowcase`).
        addStorage() {
            return { fetchCategoriesFn: null };
        },

        addAttributes() {
            return {
                eyebrow: { default: '' },
                headline: { default: '' },
                categoryIds: { default: [] },
                columns: { default: '4' },
                ctaText: { default: '' },
                chips: { default: [] },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-category-grid' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-category-grid', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(CategoryGridEditor); },
    }),

    renderComponent: CategoryGridRender
};
