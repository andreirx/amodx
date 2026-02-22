import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Columns } from 'lucide-react';
import { ColumnsSchema } from './schema';
import { ColumnsEditor } from './ColumnsEditor';
import { ColumnsRender } from './ColumnsRender';
import { PluginDefinition } from '../types';

export const ColumnsPlugin: PluginDefinition = {
    key: 'columns',
    label: 'Column Layout',
    icon: Columns,
    schema: ColumnsSchema,

    editorExtension: Node.create({
        name: 'columns',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                columnCount: {
                    default: "2"
                },
                gap: {
                    default: "md"
                },
                columns: {
                    default: [
                        { id: "1", width: "1/2", content: "" },
                        { id: "2", width: "1/2", content: "" }
                    ]
                },
                blockWidth: {
                    default: "content"
                }
            };
        },

        parseHTML() {
            return [{ tag: 'app-columns' }];
        },

        renderHTML({ HTMLAttributes }) {
            return ['app-columns', mergeAttributes(HTMLAttributes)];
        },

        addNodeView() {
            return ReactNodeViewRenderer(ColumnsEditor);
        },
    }),

    renderComponent: ColumnsRender
};
