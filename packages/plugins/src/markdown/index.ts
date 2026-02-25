import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FileText } from 'lucide-react';
import { MarkdownSchema } from './schema';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownRender } from './MarkdownRender';
import { PluginDefinition } from '../types';

export const MarkdownPlugin: PluginDefinition = {
    key: 'markdown',
    label: 'Markdown',
    icon: FileText,
    schema: MarkdownSchema,

    editorExtension: Node.create({
        name: 'markdown',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                content: { default: '' },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-markdown' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-markdown', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(MarkdownEditor); },
    }),

    renderComponent: MarkdownRender
};
