import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Star } from 'lucide-react';
import { ReviewsCarouselSchema } from './schema';
import { ReviewsCarouselEditor } from './ReviewsCarouselEditor';
import { ReviewsCarouselRender } from './ReviewsCarouselRender';
import { PluginDefinition } from '../types';

export const ReviewsCarouselPlugin: PluginDefinition = {
    key: 'reviewsCarousel',
    label: 'Reviews Carousel',
    icon: Star,
    schema: ReviewsCarouselSchema,

    editorExtension: Node.create({
        name: 'reviewsCarousel',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headline: { default: 'Customer Reviews' },
                items: { default: [] },
                showSource: { default: true },
                autoScroll: { default: false },
            };
        },

        parseHTML() { return [{ tag: 'app-reviews-carousel' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-reviews-carousel', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(ReviewsCarouselEditor); },
    }),

    renderComponent: ReviewsCarouselRender
};
