import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { LayoutGrid } from 'lucide-react';
import { PostGridSchema } from './schema';
import { PostGridEditor } from './PostGridEditor';
import { PostGridRender } from './PostGridRender';
import { PluginDefinition } from '../types';

export const PostGridPlugin: PluginDefinition = {
    key: 'postGrid',
    label: 'Post Grid',
    icon: LayoutGrid,
    schema: PostGridSchema,

    editorExtension: Node.create({
        name: 'postGrid',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headline: { default: 'Latest Posts' },
                filterTag: { default: '' },
                limit: { default: 6 },
                showImages: { default: true },
                columns: { default: '3' }
            };
        },

        parseHTML() { return [{ tag: 'app-post-grid' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-post-grid', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(PostGridEditor); },
    }),

    renderComponent: PostGridRender
};
