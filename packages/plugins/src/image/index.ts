import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Image as ImageIcon } from 'lucide-react';
import { ImageSchema } from './schema';
import { ImageEditor } from './ImageEditor';
import { ImageRender } from './ImageRender';
import { PluginDefinition } from '../types';

export const ImagePlugin: PluginDefinition = {
    key: 'image',
    label: 'Image',
    icon: ImageIcon,
    schema: ImageSchema,

    editorExtension: Node.create({
        name: 'image',
        group: 'block',
        atom: true,

        // This storage object is where we inject the uploader at runtime
        addStorage() {
            return {
                uploadFn: null,
            }
        },

        addAttributes() {
            return {
                src: { default: null },
                alt: { default: null },
                caption: { default: null },
                width: { default: 'full' },
            };
        },

        parseHTML() { return [{ tag: 'app-image' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-image', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(ImageEditor); },
    }),

    renderComponent: ImageRender
};
