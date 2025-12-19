import React from "react";
import { Check } from "lucide-react";

export function PricingRender({ attrs }: { attrs: any }) {
    const plans = attrs.plans || [];

    return (
        <section className="py-20">
            <div className="text-center mb-12">
                <h2 className="text-4xl font-bold tracking-tight mb-4">{attrs.headline}</h2>
                <p className="text-xl text-muted-foreground">{attrs.subheadline}</p>
            </div>

            {/* FLEXBOX CENTER */}
            <div className="flex flex-wrap justify-center gap-8 max-w-7xl mx-auto px-4">
                {plans.map((plan: any) => (
                    <div
                        key={plan.id}
                        className={`flex flex-col p-8 rounded-2xl border w-62 shrink-0 ${
                            plan.highlight
                                ? 'border-primary bg-primary/5 ring-1 ring-primary shadow-lg scale-105 z-10'
                                : 'border-border bg-card'
                        }`}
                    >
                        <div className="mb-6">
                            <h3 className="text-lg font-semibold">{plan.title}</h3>
                            <div className="mt-2 flex items-baseline gap-1">
                                <span className="text-4xl font-bold">{plan.price}</span>
                                <span className="text-sm text-muted-foreground">/{plan.interval}</span>
                            </div>
                        </div>

                        <div className="space-y-4 mb-8 flex-1">
                            {(plan.features || "").split('\n').map((feat: string, i: number) => (
                                <div key={i} className="flex items-start gap-3">
                                    <Check className="h-5 w-5 text-primary shrink-0" />
                                    <span className="text-sm opacity-90">{feat}</span>
                                </div>
                            ))}
                        </div>

                        <a
                            href={plan.buttonLink || "#"}
                            className={`w-full py-3 rounded-lg text-sm font-semibold transition-all text-center inline-block ${
                                plan.highlight
                                    ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-md'
                                    : 'bg-secondary text-secondary-foreground hover:opacity-90 shadow-sm'
                            }`}
                        >
                            {plan.buttonText}
                        </a>
                    </div>
                ))}
            </div>
        </section>
    );
}
