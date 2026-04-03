import React from "react";
import { LazyEffectCanvas } from "../common/LazyEffectCanvas";
import { ButtonEffectWrap } from "../common/ButtonEffectWrap";
import { resolveButtonEffect } from "../common/resolveButtonEffect";

// Button text sits on the opaque label surface inside ButtonEffectWrap.
// No stroke/shadow hacks needed — readability is handled by the compositor.
// Background is transparent here because the label chip provides the fill.
// When not wrapped (no effect), bg-primary kicks in via the class.
const btnClass = "inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 transition-opacity bg-primary";

export function CtaRender({ attrs }: { attrs: any }) {
    const { headline, subheadline, buttonText, buttonLink, style } = attrs;
    const buttonEffect = resolveButtonEffect(attrs);

    if (style === 'band') {
        return (
            <section className="relative py-20 bg-primary text-primary-foreground mt-20">
                <LazyEffectCanvas effect={attrs.effect} />
                <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
                    <h2 className="text-3xl font-bold mb-6">{headline}</h2>
                    <p className="text-xl opacity-90 mb-10 max-w-2xl mx-auto">{subheadline}</p>
                    <ButtonEffectWrap effect={buttonEffect} bgClass="bg-background" labelSurfaceClass="bg-background">
                        <a href={buttonLink} className="inline-flex items-center justify-center rounded-md text-sm font-medium text-foreground shadow h-11 px-8 hover:opacity-90 transition-opacity bg-background">
                            {buttonText}
                        </a>
                    </ButtonEffectWrap>
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
                <ButtonEffectWrap effect={buttonEffect}>
                    <a href={buttonLink} className={btnClass}>
                        {buttonText}
                    </a>
                </ButtonEffectWrap>
            </div>
        </section>
    );
}
