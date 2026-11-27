import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Images } from 'lucide-react';
import { GalleryBlockSchema } from './schema';
import { GalleryEditor } from './GalleryEditor';
import { GalleryRender } from './GalleryRender';
import { PluginDefinition } from '../types';

// GALLERY-1: no `offeredOn` — photos have no commerce or catalog dependency; offered on every site.
export const GalleryPlugin: PluginDefinition = {
    key: 'gallery',
    label: 'Photo Gallery',
    icon: Images,
    schema: GalleryBlockSchema,

    editorExtension: Node.create({
        name: 'gallery',
        group: 'block',
        atom: true,

        // The admin's BlockEditor injects the media picker's multi-select mode (ruling 5).
        addStorage() {
            return { pickManyFn: null };
        },

        addAttributes() {
            return {
                items: { default: [] },
                columns: { default: '3' },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-gallery' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-gallery', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(GalleryEditor); },
    }),

    renderComponent: GalleryRender
};
