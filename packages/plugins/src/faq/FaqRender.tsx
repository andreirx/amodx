import React from "react";
import Script from "next/script";

export function FaqRender({ attrs }: { attrs: any }) {
    const items = attrs.items || [];

    // Generate FAQ Schema
    const schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": items.map((item: any) => ({
            "@type": "Question",
            "name": item.question,
            "acceptedAnswer": {
                "@type": "Answer",
                "text": item.answer
            }
        }))
    };

    return (
        <section className="py-16 max-w-3xl mx-auto px-6">
            {/* Inject Schema for SEO */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
            />

            <h2 className="text-3xl font-bold mb-10 text-center">{attrs.headline}</h2>

            <div className="space-y-4">
                {items.map((item: any) => (
                    <details key={item.id} className="group border border-border rounded-lg bg-card open:ring-1 open:ring-primary/10">
                        <summary className="flex cursor-pointer items-center justify-between p-6 font-medium text-foreground hover:bg-muted/50 transition-colors select-none">
                            {item.question}
                            <span className="ml-4 flex-shrink-0 text-muted-foreground group-open:rotate-180 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="m6 9 6 6 6-6"/></svg>
                            </span>
                        </summary>
                        <div className="px-6 pb-6 pt-0 text-muted-foreground leading-relaxed animate-in fade-in slide-in-from-top-2 duration-200">
                            {item.answer}
                        </div>
                    </details>
                ))}
            </div>
        </section>
    );
}
