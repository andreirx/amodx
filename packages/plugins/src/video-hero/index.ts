import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Film } from 'lucide-react';
import { VideoHeroSchema } from './schema';
import { VideoHeroEditor } from './VideoHeroEditor';
import { VideoHeroRender } from './VideoHeroRender';
import { PluginDefinition } from '../types';

export const VideoHeroPlugin: PluginDefinition = {
    key: 'videoHero',
    label: 'Video Hero',
    icon: Film,
    schema: VideoHeroSchema,

    editorExtension: Node.create({
        name: 'videoHero',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headline: { default: '' },
                subheadline: { default: '' },
                subheadlineRich: { default: null },
                videoSrc: { default: '' },
                posterSrc: { default: null },
                ctaText: { default: '' },
                ctaLink: { default: '#' },
                overlayOpacity: { default: 0.4 },
                overlayColorToken: { default: 'auto' },
                headlineColorToken: { default: 'auto' },
                subheadlineColorToken: { default: 'auto' },
                muted: { default: true },
                loop: { default: true },
                blockWidth: { default: 'full' },
            };
        },

        parseHTML() { return [{ tag: 'app-video-hero' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-video-hero', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(VideoHeroEditor); },
    }),

    renderComponent: VideoHeroRender
};
