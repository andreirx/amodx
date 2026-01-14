import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { GalleryHorizontal } from 'lucide-react';
import { CarouselSchema } from './schema';
import { CarouselEditor } from './CarouselEditor';
import { CarouselRender } from './CarouselRender';
import { PluginDefinition } from '../types';

export const CarouselPlugin: PluginDefinition = {
    key: 'carousel',
    label: 'Carousel',
    icon: GalleryHorizontal,
    schema: CarouselSchema,

    editorExtension: Node.create({
    name: 'carousel',
    group: 'block',
    atom: true,

    addAttributes() {
        return {
            headline: { default: 'Featured' },
            items: { default: [] },
            height: { default: 'medium' },
            style: { default: 'coverflow' }
        };
    },

    parseHTML() { return [{ tag: 'app-carousel' }]; },
    renderHTML({ HTMLAttributes }) { return ['app-carousel', mergeAttributes(HTMLAttributes)]; },
    addNodeView() { return ReactNodeViewRenderer(CarouselEditor); },
}),

    renderComponent: CarouselRender
};
