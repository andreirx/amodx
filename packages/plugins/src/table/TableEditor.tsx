import { NodeViewWrapper } from '@tiptap/react';
import { Table as TableIcon, Plus, Trash2, Columns, Rows } from 'lucide-react';
import React from 'react';

const Input = ({ value, onChange, className = "" }: any) => (
    <input
        className={`w-full h-8 px-2 border border-gray-200 rounded text-sm focus:border-indigo-500 outline-none ${className}`}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
    />
);

const Checkbox = ({ checked, onChange, label }: any) => (
    <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-600">
        <input
            type="checkbox"
            checked={checked}
            onChange={e => onChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span>{label}</span>
    </label>
);

export function TableEditor(props: any) {
    const { headers, rows, striped, bordered } = props.node.attrs;

    const safeHeaders = Array.isArray(headers) ? headers : ["Column 1", "Column 2"];
    const safeRows = Array.isArray(rows) ? rows : [];

    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    // Header operations
    const updateHeader = (index: number, value: string) => {
        const newHeaders = [...safeHeaders];
        newHeaders[index] = value;
        update('headers', newHeaders);
    };

    const addColumn = () => {
        const newHeaders = [...safeHeaders, `Column ${safeHeaders.length + 1}`];
        const newRows = safeRows.map((row: any) => ({
            ...row,
            cells: [...row.cells, { id: `${row.id}-${safeHeaders.length + 1}`, content: "" }]
        }));
        update('headers', newHeaders);
        update('rows', newRows);
    };

    const removeColumn = (index: number) => {
        if (safeHeaders.length <= 1) return;
        const newHeaders = safeHeaders.filter((_: any, i: number) => i !== index);
        const newRows = safeRows.map((row: any) => ({
            ...row,
            cells: row.cells.filter((_: any, i: number) => i !== index)
        }));
        update('headers', newHeaders);
        update('rows', newRows);
    };

    // Row operations
    const addRow = () => {
        const newRow = {
            id: crypto.randomUUID(),
            cells: safeHeaders.map((_, i) => ({ id: `${Date.now()}-${i}`, content: "" }))
        };
        update('rows', [...safeRows, newRow]);
    };

    const removeRow = (index: number) => {
        if (safeRows.length <= 1) return;
        const newRows = safeRows.filter((_: any, i: number) => i !== index);
        update('rows', newRows);
    };

    const updateCell = (rowIndex: number, cellIndex: number, value: string) => {
        const newRows = safeRows.map((row: any, rIdx: number) => {
            if (rIdx !== rowIndex) return row;
            return {
                ...row,
                cells: row.cells.map((cell: any, cIdx: number) =>
                    cIdx === cellIndex ? { ...cell, content: value } : cell
                )
            };
        });
        update('rows', newRows);
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">

                {/* Header Bar */}
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50 text-indigo-600">
                            <TableIcon className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700">Data Table</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <Checkbox
                            checked={striped}
                            onChange={(v: boolean) => update('striped', v)}
                            label="Striped Rows"
                        />
                        <Checkbox
                            checked={bordered}
                            onChange={(v: boolean) => update('bordered', v)}
                            label="Borders"
                        />
                        <div className="flex items-center gap-2">
                            <button
                                onClick={addColumn}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                            >
                                <Columns className="w-3 h-3" />
                                Add Column
                            </button>
                            <button
                                onClick={addRow}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                            >
                                <Rows className="w-3 h-3" />
                                Add Row
                            </button>
                        </div>
                    </div>
                </div>

                {/* Table Content */}
                <div className="p-6 overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                        <tr>
                            {safeHeaders.map((header: string, i: number) => (
                                <th key={i} className="border border-gray-200 bg-gray-100 p-2">
                                    <div className="flex items-center gap-2">
                                        <Input
                                            value={header}
                                            onChange={(v: string) => updateHeader(i, v)}
                                            className="font-semibold"
                                        />
                                        {safeHeaders.length > 1 && (
                                            <button
                                                onClick={() => removeColumn(i)}
                                                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                </th>
                            ))}
                            <th className="w-12 border border-gray-200 bg-gray-50"></th>
                        </tr>
                        </thead>
                        <tbody>
                        {safeRows.map((row: any, rowIndex: number) => (
                            <tr key={row.id}>
                                {row.cells.map((cell: any, cellIndex: number) => (
                                    <td key={cell.id} className="border border-gray-200 p-2">
                                        <Input
                                            value={cell.content}
                                            onChange={(v: string) => updateCell(rowIndex, cellIndex, v)}
                                        />
                                    </td>
                                ))}
                                <td className="border border-gray-200 bg-gray-50 text-center">
                                    {safeRows.length > 1 && (
                                        <button
                                            onClick={() => removeRow(rowIndex)}
                                            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>

                {/* Helper Text */}
                <div className="border-t border-gray-100 bg-gray-50/30 px-4 py-2 text-[10px] text-gray-500">
                    <span className="font-medium">Tip:</span> Tables are responsive and will scroll horizontally on smaller screens.
                </div>
            </div>
        </NodeViewWrapper>
    );
}
