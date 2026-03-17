import React from "react";
import { LazyEffectCanvas } from "../common/LazyEffectCanvas";
import { ButtonEffectWrap } from "../common/ButtonEffectWrap";
import { resolveButtonEffect } from "../common/resolveButtonEffect";

/**
 * Button styles that respond to CSS variables set by ButtonEffectWrap:
 *
 * --btn-bg-color: set to "transparent" when wrapped (overlay div provides the fill).
 *   Falls back to var(--primary) when not wrapped → normal opaque button.
 * --btn-text-stroke: 0 (inactive) or 1 (active) — drives stroke width + shadow blur
 *   via calc(). At 0, stroke is 0px and shadow blur is 0px → zero visual impact.
 *
 * Colors use var(--primary) directly (not hsl(var(--primary))) because --primary
 * stores hex colors, not HSL triplets.
 */
const btnClass = "inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 transition-opacity";
const btnStyle: React.CSSProperties = {
    backgroundColor: "var(--btn-bg-color, var(--primary))",
    paintOrder: "stroke fill",
    WebkitTextStroke: "calc(var(--btn-text-stroke, 0) * 1px) var(--primary)",
    textShadow: "0 0 calc(var(--btn-text-stroke, 0) * 4px) var(--primary), 0 0 calc(var(--btn-text-stroke, 0) * 8px) var(--primary)",
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
                    <ButtonEffectWrap effect={buttonEffect} bgClass="bg-background">
                        <a href={buttonLink} className={btnClass} style={{
                            ...btnStyle,
                            backgroundColor: "var(--btn-bg-color, var(--background))",
                            color: "var(--foreground)",
                            WebkitTextStroke: "calc(var(--btn-text-stroke, 0) * 1px) var(--background)",
                            textShadow: "0 0 calc(var(--btn-text-stroke, 0) * 4px) var(--background), 0 0 calc(var(--btn-text-stroke, 0) * 8px) var(--background)",
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
