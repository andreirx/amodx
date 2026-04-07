import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { LazyEffectCanvas } from "../common/LazyEffectCanvas";
import { ButtonEffectWrap } from "../common/ButtonEffectWrap";
import { resolveButtonEffect } from "../common/resolveButtonEffect";
import { InlineRichTextRenderer } from "../common/InlineRichTextRenderer";
import { resolveOverlayStyle, resolveTextClass } from "../common/resolveCoverColorTokens";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// Button text sits on the opaque label surface inside ButtonEffectWrap.
// No stroke/shadow hacks — readability is structural, not a paint trick.
const btnClass = "inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary";

/** Parse legacy plain text containing <br> tags or \n into Shape B segments. */
function parseLegacySubheadline(text: string): { text?: string; bold?: boolean; italic?: boolean; br?: boolean }[] {
    // Split on <br>, <br/>, <br />, and literal newlines
    const parts = text.split(/<br\s*\/?>|\n/gi);
    const segments: { text?: string; br?: boolean }[] = [];
    parts.forEach((part, i) => {
        if (part) segments.push({ text: part });
        if (i < parts.length - 1) segments.push({ br: true });
    });
    return segments;
}

/** Render subheadline: prefer rich segments, fall back to plain string with <br>/\n parsing. */
function SubheadlineText({ rich, plain, className }: { rich?: any[]; plain?: string; className?: string }) {
    if (rich && rich.length > 0) {
        return <InlineRichTextRenderer segments={rich} className={className} as="p" />;
    }
    if (plain) {
        // Legacy path: parse <br> tags and newlines so existing content renders line breaks
        if (plain.includes("<br") || plain.includes("\n")) {
            return <InlineRichTextRenderer segments={parseLegacySubheadline(plain)} className={className} as="p" />;
        }
        return <p className={className}>{plain}</p>;
    }
    return null;
}

export function HeroRender({ attrs }: { attrs: any }) {
    const {
        headline = "Welcome to AMODX",
        subheadline = "The operating system for modern agencies.",
        subheadlineRich,
        ctaText = "Get Started",
        ctaLink = "#",
        imageSrc,
        style = "center",
        overlayOpacity = 0.5,
        overlayColorToken,
        headlineColorToken,
        subheadlineColorToken,
    } = attrs || {};

    const hasSubheadline = (subheadlineRich && subheadlineRich.length > 0) || !!subheadline;
    const buttonEffect = resolveButtonEffect(attrs);

    // --- Minimal ---
    if (style === "minimal") {
        return (
            <section className="relative py-24 max-w-4xl mx-auto">
                <LazyEffectCanvas effect={attrs.effect} />
                <div className="relative z-10">
                    <h1 className="text-6xl font-black tracking-tighter text-foreground mb-6">
                        {headline}
                    </h1>
                    {hasSubheadline && (
                        <SubheadlineText rich={subheadlineRich} plain={subheadline} className="text-xl text-muted-foreground leading-relaxed max-w-2xl" />
                    )}
                </div>
            </section>
        );
    }

    // --- Split: image first (mobile), image right + large (desktop) ---
    if (style === "split") {
        return (
            <section className="relative grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] items-stretch max-w-7xl mx-auto">
                <LazyEffectCanvas effect={attrs.effect} />
                {/* Image — shows first on mobile, right on desktop */}
                <div className="relative z-10 order-1 lg:order-2 bg-muted overflow-hidden min-h-[300px] lg:min-h-[500px]">
                    {imageSrc ? (
                        <img src={imageSrc} alt={headline} className="w-full h-full object-cover" />
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground/30">No Image</div>
                    )}
                </div>
                {/* Text — shows second on mobile, left on desktop */}
                <div className="relative z-10 order-2 lg:order-1 flex flex-col justify-center px-6 lg:px-12 py-12 lg:py-20">
                    <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-foreground mb-6">{headline}</h1>
                    {hasSubheadline && <SubheadlineText rich={subheadlineRich} plain={subheadline} className="text-lg text-muted-foreground mb-8" />}
                    {ctaText && (
                        <div>
                            <ButtonEffectWrap effect={buttonEffect}>
                                <a href={ctaLink} className={btnClass}>
                                    {ctaText}
                                </a>
                            </ButtonEffectWrap>
                        </div>
                    )}
                </div>
            </section>
        );
    }

    // --- Cover: image as full background, text centered on top ---
    if (style === "cover") {
        const overlayStyle = resolveOverlayStyle(overlayColorToken, overlayOpacity);
        const hlClass = resolveTextClass(headlineColorToken, "text-white");
        const shClass = resolveTextClass(subheadlineColorToken, "text-white/90");

        return (
            <section className="relative min-h-[60vh] flex items-center justify-center overflow-hidden">
                {/* Background image */}
                {imageSrc && (
                    <img
                        src={imageSrc}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                    />
                )}
                {/* Overlay — color and opacity resolved from semantic tokens */}
                <div
                    className="absolute inset-0"
                    style={overlayStyle}
                />
                <LazyEffectCanvas effect={attrs.effect} />
                {/* Content */}
                <div className="relative z-10 text-center px-6 py-24 max-w-4xl mx-auto">
                    <h1 className={`text-5xl md:text-7xl font-black tracking-tight mb-6 drop-shadow-lg ${hlClass}`}>
                        {headline}
                    </h1>
                    {hasSubheadline && (
                        <SubheadlineText rich={subheadlineRich} plain={subheadline} className={`text-xl mb-10 max-w-2xl mx-auto drop-shadow-md ${shClass}`} />
                    )}
                    {ctaText && (
                        <ButtonEffectWrap effect={buttonEffect}>
                            <a href={ctaLink} className={btnClass}>
                                {ctaText}
                            </a>
                        </ButtonEffectWrap>
                    )}
                </div>
            </section>
        );
    }

    // --- Center: image first, then text + button ---
    return (
        <section className="relative py-24 text-center max-w-5xl mx-auto">
            <LazyEffectCanvas effect={attrs.effect} />
            <div className="relative z-10">
            {/* Image above text */}
            {imageSrc && (
                <div className="mb-12 rounded-xl overflow-hidden shadow-2xl border border-border">
                    <img src={imageSrc} alt="" className="w-full h-auto" />
                </div>
            )}
            <h1 className="text-5xl md:text-7xl font-black tracking-tight text-foreground mb-6">
                {headline}
            </h1>
            {hasSubheadline && (
                <SubheadlineText rich={subheadlineRich} plain={subheadline} className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto" />
            )}
            {ctaText && (
                <ButtonEffectWrap effect={buttonEffect}>
                    <a href={ctaLink} className={btnClass}>
                        {ctaText}
                    </a>
                </ButtonEffectWrap>
            )}
            </div>
        </section>
    );
}
