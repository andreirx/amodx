import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Table } from 'lucide-react';
import { TableSchema } from './schema';
import { TableEditor } from './TableEditor';
import { TableRender } from './TableRender';
import { PluginDefinition } from '../types';

export const TablePlugin: PluginDefinition = {
    key: 'table',
    label: 'Data Table',
    icon: Table,
    schema: TableSchema,

    editorExtension: Node.create({
        name: 'table',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headers: {
                    default: ["Column 1", "Column 2", "Column 3"]
                },
                rows: {
                    default: [
                        {
                            id: "1",
                            cells: [
                                { id: "1-1", content: "" },
                                { id: "1-2", content: "" },
                                { id: "1-3", content: "" }
                            ]
                        },
                        {
                            id: "2",
                            cells: [
                                { id: "2-1", content: "" },
                                { id: "2-2", content: "" },
                                { id: "2-3", content: "" }
                            ]
                        }
                    ]
                },
                striped: {
                    default: true
                },
                bordered: {
                    default: true
                },
                blockWidth: {
                    default: "content"
                }
            };
        },

        parseHTML() {
            return [{ tag: 'app-table' }];
        },

        renderHTML({ HTMLAttributes }) {
            return ['app-table', mergeAttributes(HTMLAttributes)];
        },

        addNodeView() {
            return ReactNodeViewRenderer(TableEditor);
        },
    }),

    renderComponent: TableRender
};
