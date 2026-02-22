import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Code2 } from 'lucide-react';
import { CodeBlockSchema } from './schema';
import { CodeBlockEditor } from './CodeBlockEditor';
import { CodeBlockRender } from './CodeBlockRender';
import { PluginDefinition } from '../types';

export const CodeBlockPlugin: PluginDefinition = {
    key: 'codeBlock',
    label: 'Code Block',
    icon: Code2,
    schema: CodeBlockSchema,

    editorExtension: Node.create({
        name: 'codeBlock',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                code: { default: '' },
                language: { default: 'plaintext' },
                filename: { default: null },
                showLineNumbers: { default: false },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-code-block' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-code-block', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(CodeBlockEditor); },
    }),

    renderComponent: CodeBlockRender
};
