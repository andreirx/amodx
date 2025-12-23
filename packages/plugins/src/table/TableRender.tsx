import React from "react";

export function TableRender({ attrs }: { attrs: any }) {
    const { headers = [], rows = [], striped = true, bordered = true } = attrs;

    return (
        <section className="py-12">
            <div className="overflow-x-auto">
                <table className={`min-w-full ${bordered ? 'border border-border' : ''}`}>
                    <thead>
                    <tr className="bg-muted">
                        {headers.map((header: string, i: number) => (
                            <th
                                key={i}
                                className={`px-6 py-3 text-left text-sm font-semibold text-foreground ${
                                    bordered ? 'border-b border-border' : ''
                                }`}
                            >
                                {header}
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {rows.map((row: any, rowIndex: number) => (
                        <tr
                            key={row.id}
                            className={`${
                                striped && rowIndex % 2 === 1 ? 'bg-muted/30' : 'bg-background'
                            } hover:bg-muted/50 transition-colors`}
                        >
                            {row.cells.map((cell: any, cellIndex: number) => (
                                <td
                                    key={cell.id}
                                    className={`px-6 py-4 text-sm text-foreground ${
                                        bordered ? 'border-b border-border' : ''
                                    }`}
                                >
                                    {cell.content || <span className="text-muted-foreground italic">—</span>}
                                </td>
                            ))}
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
