import React from "react";
import { Check } from "lucide-react";

export function PricingRender({ attrs }: { attrs: any }) {
    const features = (attrs.features || "").split("\n").filter((f: string) => f.trim() !== "");

    return (
        <div className={`p-8 rounded-2xl border ${attrs.recommended ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card'} max-w-sm mx-auto`}>
            <div className="mb-6">
                <h3 className="text-lg font-semibold text-muted-foreground">{attrs.title}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight">{attrs.price}</span>
                    <span className="text-sm font-medium text-muted-foreground">/{attrs.interval}</span>
                </div>
            </div>

            <div className="space-y-4 mb-8">
                {features.map((feat: string, i: number) => (
                    <div key={i} className="flex items-start gap-3">
                        <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                            <Check className="h-3 w-3 text-primary" />
                        </div>
                        <span className="text-sm text-foreground">{feat}</span>
                    </div>
                ))}
            </div>

            <a
                href={attrs.buttonLink}
                className={`w-full inline-flex items-center justify-center rounded-lg py-3 text-sm font-semibold transition-all ${
                    attrs.recommended
                        ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-md'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
            >
                {attrs.buttonText}
            </a>
        </div>
    );
}
