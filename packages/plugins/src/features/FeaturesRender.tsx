import React from "react";
import * as Icons from "lucide-react";

export function FeaturesRender({ attrs }: { attrs: any }) {
    const items = attrs.items || [];
    const cols = attrs.columns || "3";

    // Map column count to Tailwind class
    const gridClass = {
        "2": "md:grid-cols-2",
        "3": "md:grid-cols-3",
        "4": "md:grid-cols-2 lg:grid-cols-4"
    }[cols as string] || "md:grid-cols-3";

    return (
        <section className="py-24 px-6 max-w-7xl mx-auto">
            <div className="text-center mb-16 max-w-3xl mx-auto">
                <h2 className="text-3xl font-bold tracking-tight mb-4">{attrs.headline}</h2>
                <p className="text-lg text-muted-foreground">{attrs.subheadline}</p>
            </div>

            <div className={`grid grid-cols-1 ${gridClass} gap-x-8 gap-y-12`}>
                {items.map((item: any) => {
                    // Dynamic Icon Lookup
                    const Icon = (Icons as any)[item.icon] || Icons.Check;

                    return (
                        <div key={item.id} className="flex flex-col items-center text-center">
                            <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                                <Icon className="w-6 h-6" />
                            </div>
                            <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                            <p className="text-muted-foreground leading-relaxed">{item.description}</p>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
