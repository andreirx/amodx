import React from "react";
import * as Icons from "lucide-react";
import { LazyEffectCanvas } from "../common/LazyEffectCanvas";

const ICON_SIZES: Record<string, { box: string; icon: string }> = {
    sm: { box: "h-10 w-10 rounded-lg", icon: "w-5 h-5" },
    md: { box: "h-12 w-12 rounded-xl", icon: "w-6 h-6" },
    lg: { box: "h-16 w-16 rounded-2xl", icon: "w-8 h-8" },
};

export function FeaturesRender({ attrs }: { attrs: any }) {
    const items = attrs.items || [];
    const cols = attrs.columns || "3";
    const layout = attrs.layout || "stacked";
    const iconSize = attrs.iconSize || "md";
    const sizes = ICON_SIZES[iconSize] || ICON_SIZES.md;

    const gridClass = {
        "2": "md:grid-cols-2",
        "3": "md:grid-cols-3",
        "4": "md:grid-cols-2 lg:grid-cols-4",
        "5": "md:grid-cols-3 lg:grid-cols-5",
        "6": "md:grid-cols-3 lg:grid-cols-6",
    }[cols as string] || "md:grid-cols-3";

    return (
        <section className="relative py-24 px-6 max-w-7xl mx-auto">
            <LazyEffectCanvas effect={attrs.effect} />
            <div className="relative z-10">
                {(attrs.headline || attrs.subheadline) && (
                    <div className="text-center mb-16 max-w-3xl mx-auto">
                        {attrs.headline && <h2 className="text-3xl font-bold tracking-tight mb-4">{attrs.headline}</h2>}
                        {attrs.subheadline && <p className="text-lg text-muted-foreground">{attrs.subheadline}</p>}
                    </div>
                )}

                <div className={`grid grid-cols-1 ${gridClass} gap-x-8 gap-y-12`}>
                    {items.map((item: any) => {
                        const Icon = (Icons as any)[item.icon] || Icons.Check;

                        if (layout === "inline") {
                            return (
                                <div key={item.id} className="flex items-start gap-4">
                                    <div className={`${sizes.box} bg-primary/10 text-primary flex items-center justify-center shrink-0`}>
                                        <Icon className={sizes.icon} />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-semibold mb-1">{item.title}</h3>
                                        <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                                    </div>
                                </div>
                            );
                        }

                        // stacked (default)
                        return (
                            <div key={item.id} className="flex flex-col items-center text-center">
                                <div className={`${sizes.box} bg-primary/10 text-primary flex items-center justify-center mb-6`}>
                                    <Icon className={sizes.icon} />
                                </div>
                                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                                <p className="text-muted-foreground leading-relaxed">{item.description}</p>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
