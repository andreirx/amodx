import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Video } from 'lucide-react';
import { VideoSchema } from './schema';
import { VideoEditor } from './VideoEditor';
import { VideoRender } from './VideoRender';
import { PluginDefinition } from '../types';

export const VideoPlugin: PluginDefinition = {
    key: 'video',
    label: 'Video Embed',
    icon: Video,
    schema: VideoSchema,

    editorExtension: Node.create({
        name: 'video',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                url: { default: '' },
                caption: { default: null },
                width: { default: 'centered' },
                autoplay: { default: false },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() {
            return [{ tag: 'app-video' }];
        },

        renderHTML({ HTMLAttributes }) {
            return ['app-video', mergeAttributes(HTMLAttributes)];
        },

        addNodeView() {
            return ReactNodeViewRenderer(VideoEditor);
        },
    }),

    renderComponent: VideoRender
};
