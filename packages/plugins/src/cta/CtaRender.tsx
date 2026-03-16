import React from "react";
import { LazyEffectCanvas } from "../common/LazyEffectCanvas";
import { LazyGlowWrap } from "../common/LazyGlowWrap";

export function CtaRender({ attrs }: { attrs: any }) {
    const { headline, subheadline, buttonText, buttonLink, style } = attrs;

    if (style === 'band') {
        return (
            <section className="relative py-20 bg-primary text-primary-foreground mt-20">
                <LazyEffectCanvas effect={attrs.effect} />
                <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
                    <h2 className="text-3xl font-bold mb-6">{headline}</h2>
                    <p className="text-xl opacity-90 mb-10 max-w-2xl mx-auto">{subheadline}</p>
                    <LazyGlowWrap glow={attrs.glow}>
                        <a href={buttonLink} className="relative z-10 inline-flex items-center justify-center bg-background text-foreground px-8 py-3 rounded-lg font-bold hover:bg-background/90 transition-colors">
                            {buttonText}
                        </a>
                    </LazyGlowWrap>
                </div>
            </section>
        );
    }

    // Default 'simple' or 'card'
    return (
        <section className="relative py-24 px-6">
            <LazyEffectCanvas effect={attrs.effect} />
            <div className="relative z-10 max-w-4xl mx-auto bg-muted/50 rounded-3xl p-12 text-center border border-border">
                <h2 className="text-4xl font-bold tracking-tight mb-6">{headline}</h2>
                <p className="text-lg text-muted-foreground mb-10">{subheadline}</p>
                <LazyGlowWrap glow={attrs.glow}>
                    <a href={buttonLink} className="relative z-10 inline-flex items-center justify-center bg-primary text-primary-foreground px-8 py-4 rounded-lg font-bold hover:opacity-90 transition-opacity shadow-lg">
                        {buttonText}
                    </a>
                </LazyGlowWrap>
            </div>
        </section>
    );
}
