import { NodeViewWrapper } from '@tiptap/react';
import { Columns as ColumnsIcon, Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { BlockWidthControl } from '../BlockWidthControl';

const Label = ({ children }: any) => (
    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">{children}</label>
);

const Select = ({ value, onChange, options }: any) => (
    <select
        className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium shadow-sm outline-none focus:border-indigo-500 cursor-pointer"
        value={value}
        onChange={e => onChange(e.target.value)}
    >
        {options.map((o: { value: string, label: string }) => (
            <option key={o.value} value={o.value}>{o.label}</option>
        ))}
    </select>
);

const TextArea = ({ value, onChange, placeholder }: any) => (
    <textarea
        className="w-full min-h-[120px] bg-white border border-gray-200 rounded px-3 py-2 text-sm focus:border-indigo-500 outline-none transition-colors resize-y"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

export function ColumnsEditor(props: any) {
    const { columnCount, gap, columns, blockWidth } = props.node.attrs;

    // Safety check
    const safeColumns = Array.isArray(columns) ? columns : [];

    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const updateColumn = (index: number, field: string, value: any) => {
        const newColumns = [...safeColumns];
        newColumns[index] = { ...newColumns[index], [field]: value };
        update('columns', newColumns);
    };

    const addColumn = () => {
        if (safeColumns.length >= 4) return;
        const newColumn = {
            id: crypto.randomUUID(),
            width: "1/2",
            content: ""
        };
        update('columns', [...safeColumns, newColumn]);
        update('columnCount', String(safeColumns.length + 1));
    };

    const removeColumn = (index: number) => {
        if (safeColumns.length <= 1) return;
        const newColumns = safeColumns.filter((_: any, i: number) => i !== index);
        update('columns', newColumns);
        update('columnCount', String(newColumns.length));
    };

    const widthOptions = [
        { value: "1/4", label: "25%" },
        { value: "1/3", label: "33%" },
        { value: "1/2", label: "50%" },
        { value: "2/3", label: "66%" },
        { value: "3/4", label: "75%" },
        { value: "full", label: "100%" }
    ];

    const gapOptions = [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" }
    ];

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">

                {/* Header Bar */}
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50 text-indigo-600">
                            <ColumnsIcon className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700">Column Layout</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-gray-200" />
                        <div className="flex items-center gap-2">
                            <Label>Gap:</Label>
                            <Select
                                value={gap}
                                onChange={(v: string) => update('gap', v)}
                                options={gapOptions}
                            />
                        </div>
                        <button
                            onClick={addColumn}
                            disabled={safeColumns.length >= 4}
                            className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <Plus className="w-3 h-3" />
                            Add Column
                        </button>
                    </div>
                </div>

                {/* Columns Grid */}
                <div className="p-6 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {safeColumns.map((column: any, i: number) => (
                        <div key={column.id} className="relative border border-gray-200 rounded-lg p-4 bg-gray-50/50">

                            {/* Column Header */}
                            <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-200">
                                <span className="text-xs font-semibold text-gray-600">Column {i + 1}</span>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1">
                                        <Label>Width:</Label>
                                        <Select
                                            value={column.width}
                                            onChange={(v: string) => updateColumn(i, 'width', v)}
                                            options={widthOptions}
                                        />
                                    </div>
                                    {safeColumns.length > 1 && (
                                        <button
                                            onClick={() => removeColumn(i)}
                                            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Content Editor */}
                            <TextArea
                                value={column.content}
                                onChange={(v: string) => updateColumn(i, 'content', v)}
                                placeholder="Enter column content..."
                            />
                        </div>
                    ))}
                </div>

                {/* Helper Text */}
                <div className="border-t border-gray-100 bg-gray-50/30 px-4 py-2 text-[10px] text-gray-500">
                    <span className="font-medium">Tip:</span> Column widths are responsive and will stack on mobile devices.
                </div>
            </div>
        </NodeViewWrapper>
    );
}
