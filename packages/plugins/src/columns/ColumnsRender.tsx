import React from "react";

export function ColumnsRender({ attrs }: { attrs: any }) {
    const { columns = [], gap = "md" } = attrs;

    const gapClasses = {
        sm: "gap-4",
        md: "gap-6",
        lg: "gap-8"
    };

    const gridCols: Record<string, string> = {
        '1': 'grid-cols-1',
        '2': 'grid-cols-1 lg:grid-cols-2',
        '3': 'grid-cols-1 lg:grid-cols-3',
        '4': 'grid-cols-1 lg:grid-cols-4',
    };

    return (
        <section className="py-12">
            <div className={`grid ${gridCols[columns.length]} ${gapClasses[gap as keyof typeof gapClasses]}`}>
                {columns.map((column: any) => (
                    <div key={column.id}>
                        <div className="prose prose-sm max-w-none">
                            {column.content.split('\n').filter((p: string) => p.trim()).map((paragraph: string, i: number) => (
                                <p key={i} className="text-foreground mb-4">
                                    {paragraph}
                                </p>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
