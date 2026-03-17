import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { LazyEffectCanvas } from "../common/LazyEffectCanvas";
import { ButtonEffectWrap } from "../common/ButtonEffectWrap";
import { resolveButtonEffect } from "../common/resolveButtonEffect";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Button styles that respond to --btn-bg-alpha and --btn-text-stroke CSS variables
 * set by ButtonEffectWrap. See CtaRender.tsx for detailed explanation.
 */
const btnClass = "inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow h-11 px-8 hover:opacity-90";
const btnStyle: React.CSSProperties = {
    backgroundColor: "hsl(var(--primary) / var(--btn-bg-alpha, 1))",
    paintOrder: "stroke fill",
    WebkitTextStroke: "calc(var(--btn-text-stroke, 0) * 1px) hsl(var(--primary))",
    textShadow: "0 0 calc(var(--btn-text-stroke, 0) * 4px) hsl(var(--primary)), 0 0 calc(var(--btn-text-stroke, 0) * 8px) hsl(var(--primary))",
};

export function HeroRender({ attrs }: { attrs: any }) {
    const {
        headline = "Welcome to AMODX",
        subheadline = "The operating system for modern agencies.",
        ctaText = "Get Started",
        ctaLink = "#",
        imageSrc,
        style = "center"
    } = attrs || {};

    const buttonEffect = resolveButtonEffect(attrs);

    if (style === "minimal") {
        return (
            <section className="relative py-24 max-w-4xl mx-auto">
                <LazyEffectCanvas effect={attrs.effect} />
                <div className="relative z-10">
                    <h1 className="text-6xl font-black tracking-tighter text-foreground mb-6">
                        {headline}
                    </h1>
                    {subheadline && (
                        <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl">
                            {subheadline}
                        </p>
                    )}
                </div>
            </section>
        );
    }

    if (style === "split") {
        return (
            <section className="relative py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center max-w-7xl mx-auto px-6">
                <LazyEffectCanvas effect={attrs.effect} />
                <div className="relative z-10 order-2 lg:order-1">
                    <h1 className="text-5xl font-black tracking-tight text-foreground mb-6">{headline}</h1>
                    {subheadline && <p className="text-lg text-muted-foreground mb-8">{subheadline}</p>}
                    {ctaText && (
                        <ButtonEffectWrap effect={buttonEffect}>
                            <a href={ctaLink} className={btnClass} style={btnStyle}>
                                {ctaText}
                            </a>
                        </ButtonEffectWrap>
                    )}
                </div>
                <div className="relative z-10 order-1 lg:order-2 bg-muted rounded-2xl overflow-hidden shadow-2xl aspect-[4/3]">
                    {imageSrc ? (
                        <img src={imageSrc} alt={headline} className="w-full h-full object-cover" />
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground/30">No Image</div>
                    )}
                </div>
            </section>
        );
    }

    // Center
    return (
        <section className="relative py-24 text-center max-w-5xl mx-auto">
            <LazyEffectCanvas effect={attrs.effect} />
            <div className="relative z-10">
            <h1 className="text-5xl md:text-7xl font-black tracking-tight text-foreground mb-6">
                {headline}
            </h1>
            {subheadline && (
                <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
                    {subheadline}
                </p>
            )}
            {ctaText && (
                <ButtonEffectWrap effect={buttonEffect}>
                    <a href={ctaLink} className={btnClass} style={btnStyle}>
                        {ctaText}
                    </a>
                </ButtonEffectWrap>
            )}
            {/* Optional: Show image below text for center layout */}
            {imageSrc && (
                <div className="mt-12 rounded-xl overflow-hidden shadow-2xl border border-border">
                    <img src={imageSrc} alt="" className="w-full h-auto" />
                </div>
            )}
            </div>
        </section>
    );
}
