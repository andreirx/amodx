import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Newspaper } from 'lucide-react';
import { PostGridSchema } from './schema';
import { PostGridEditor } from './PostGridEditor';
import { PostGridRender } from './PostGridRender';
import { PluginDefinition } from '../types';

export const PostGridPlugin: PluginDefinition = {
    key: 'postGrid',
    label: 'Post Grid',
    icon: Newspaper,
    schema: PostGridSchema,

    editorExtension: Node.create({
    name: 'postGrid',
    group: 'block',
    atom: true,

    // NEW: Allow Admin to inject a tag fetcher
    addStorage() {
        return {
            fetchTagsFn: null, // (callback: (tags: string[]) => void) => void
        };
    },

    addAttributes() {
        return {
            headline: { default: 'Latest Posts' },
            filterTag: { default: '' },
            limit: { default: 6 },
            showImages: { default: true },
            layout: { default: 'list' },
            columns: { default: '3' }
        };
    },

    parseHTML() { return [{ tag: 'app-post-grid' }]; },
    renderHTML({ HTMLAttributes }) { return ['app-post-grid', mergeAttributes(HTMLAttributes)]; },
    addNodeView() { return ReactNodeViewRenderer(PostGridEditor); },
}),

    renderComponent: PostGridRender
};
