import React from "react";

export function ColumnsRender({ attrs }: { attrs: any }) {
    const { columns = [], gap = "md" } = attrs;

    const gapClasses = {
        sm: "gap-4",
        md: "gap-6",
        lg: "gap-8"
    };

    const widthClasses = {
        "1/4": "lg:w-1/4",
        "1/3": "lg:w-1/3",
        "1/2": "lg:w-1/2",
        "2/3": "lg:w-2/3",
        "3/4": "lg:w-3/4",
        "full": "lg:w-full"
    };

    return (
        <section className="py-12">
            <div className={`flex flex-wrap ${gapClasses[gap as keyof typeof gapClasses]}`}>
                {columns.map((column: any) => (
                    <div
                        key={column.id}
                        className={`w-full ${widthClasses[column.width as keyof typeof widthClasses]} flex-shrink-0`}
                    >
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
