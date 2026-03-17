import React from "react";
import { LazyEffectCanvas } from "../common/LazyEffectCanvas";
import { ButtonEffectWrap } from "../common/ButtonEffectWrap";
import { resolveButtonEffect } from "../common/resolveButtonEffect";

/**
 * Button class that responds to --btn-bg-alpha and --btn-text-stroke CSS variables
 * set by ButtonEffectWrap when the GPU effect is active.
 *
 * --btn-bg-alpha: controls background opacity (1 = opaque, 0.85 = semi-transparent)
 * --btn-text-stroke: controls text outline (0 = none, 1 = active)
 *
 * The calc() trick: paint-order + text-stroke + text-shadow only activate when
 * --btn-text-stroke is 1. At 0, stroke width is 0px and shadow blur is 0px.
 */
const btnClass = "inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 transition-opacity";
const btnStyle: React.CSSProperties = {
    backgroundColor: "hsl(var(--primary) / var(--btn-bg-alpha, 1))",
    paintOrder: "stroke fill",
    WebkitTextStroke: "calc(var(--btn-text-stroke, 0) * 1px) hsl(var(--primary))",
    textShadow: "0 0 calc(var(--btn-text-stroke, 0) * 4px) hsl(var(--primary)), 0 0 calc(var(--btn-text-stroke, 0) * 8px) hsl(var(--primary))",
};

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
                    <ButtonEffectWrap effect={buttonEffect}>
                        <a href={buttonLink} className={btnClass} style={{
                            ...btnStyle,
                            backgroundColor: "hsl(var(--background) / var(--btn-bg-alpha, 1))",
                            color: "hsl(var(--foreground))",
                            WebkitTextStroke: "calc(var(--btn-text-stroke, 0) * 1px) hsl(var(--background))",
                            textShadow: "0 0 calc(var(--btn-text-stroke, 0) * 4px) hsl(var(--background)), 0 0 calc(var(--btn-text-stroke, 0) * 8px) hsl(var(--background))",
                        }}>
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
                    <a href={buttonLink} className={btnClass} style={btnStyle}>
                        {buttonText}
                    </a>
                </ButtonEffectWrap>
            </div>
        </section>
    );
}
