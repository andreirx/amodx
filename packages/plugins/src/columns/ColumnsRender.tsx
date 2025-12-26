import React from "react";

export function ColumnsRender({ attrs }: { attrs: any }) {
    const { columns = [], gap = "md" } = attrs;

    const gapClasses = {
        sm: "gap-4",
        md: "gap-6",
        lg: "gap-8"
    };

    // Determine grid columns based on number of columns
    const getGridCols = () => {
        const colCount = columns.length;
        if (colCount === 1) return "grid-cols-1";
        if (colCount === 2) return "grid-cols-1 lg:grid-cols-2";
        if (colCount === 3) return "grid-cols-1 lg:grid-cols-3";
        if (colCount === 4) return "grid-cols-1 lg:grid-cols-4";
        return "grid-cols-1 lg:grid-cols-2"; // Default fallback
    };

    return (
        <section className="py-12">
            <div className={`grid ${getGridCols()} ${gapClasses[gap as keyof typeof gapClasses]}`}>
                {columns.map((column: any) => (
                    <div key={column.id}>
                        <div className="prose prose-sm max-w-none">
                            {/* Render content as paragraphs - split by newlines */}
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
