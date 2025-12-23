import React from "react";
import { Quote } from "lucide-react";

export function TestimonialsRender({ attrs }: { attrs: any }) {
    const items = attrs.items || [];

    return (
        <section className="py-24 bg-muted/30">
            <div className="max-w-7xl mx-auto px-6">
                <div className="text-center mb-16 max-w-3xl mx-auto">
                    <h2 className="text-3xl font-bold tracking-tight mb-4">{attrs.headline}</h2>
                    <p className="text-lg text-muted-foreground">{attrs.subheadline}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {items.map((item: any) => (
                        <div key={item.id} className="bg-card p-8 rounded-2xl border border-border shadow-sm flex flex-col">
                            <div className="mb-6 text-primary/20">
                                <Quote className="w-8 h-8 fill-current" />
                            </div>
                            <p className="text-lg leading-relaxed mb-6 flex-1">"{item.quote}"</p>
                            <div className="flex items-center gap-4 mt-auto">
                                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground text-xs overflow-hidden">
                                    {item.avatar ? <img src={item.avatar} alt={item.author} className="w-full h-full object-cover" /> : item.author.charAt(0)}
                                </div>
                                <div>
                                    <div className="font-bold text-sm">{item.author}</div>
                                    <div className="text-xs text-muted-foreground">{item.role}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
