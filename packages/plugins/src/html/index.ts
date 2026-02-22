import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Code } from 'lucide-react';
import { HtmlSchema } from './schema';
import { HtmlEditor } from './HtmlEditor';
import { HtmlRender } from './HtmlRender';
import { PluginDefinition } from '../types';

export const HtmlPlugin: PluginDefinition = {
    key: 'html',
    label: 'Raw HTML',
    icon: Code,
    schema: HtmlSchema,

    editorExtension: Node.create({
        name: 'html',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                content: { default: '' },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-html' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-html', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(HtmlEditor); },
    }),

    renderComponent: HtmlRender
};
