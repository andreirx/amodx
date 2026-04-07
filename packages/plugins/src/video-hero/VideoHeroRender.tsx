import React from "react";
import { InlineRichTextRenderer } from "../common/InlineRichTextRenderer";
import { resolveOverlayStyle, resolveTextClass } from "../common/resolveCoverColorTokens";

/** Parse legacy <br>/\n in plain subheadline strings. */
function parseLegacyText(text: string): { text?: string; br?: boolean }[] {
    const parts = text.split(/<br\s*\/?>|\n/gi);
    const segments: { text?: string; br?: boolean }[] = [];
    parts.forEach((part, i) => {
        if (part) segments.push({ text: part });
        if (i < parts.length - 1) segments.push({ br: true });
    });
    return segments;
}

function SubheadlineText({ rich, plain, className }: { rich?: any[]; plain?: string; className?: string }) {
    if (rich && rich.length > 0) {
        return <InlineRichTextRenderer segments={rich} className={className} as="p" />;
    }
    if (plain) {
        if (plain.includes("<br") || plain.includes("\n")) {
            return <InlineRichTextRenderer segments={parseLegacyText(plain)} className={className} as="p" />;
        }
        return <p className={className}>{plain}</p>;
    }
    return null;
}

export function VideoHeroRender({ attrs }: { attrs: any }) {
    const {
        headline = "",
        subheadline = "",
        subheadlineRich,
        videoSrc,
        posterSrc,
        ctaText = "",
        ctaLink = "#",
        overlayOpacity = 0.4,
        overlayColorToken,
        headlineColorToken,
        subheadlineColorToken,
        muted = true,
        loop = true,
    } = attrs || {};

    const hasSubheadline = (subheadlineRich && subheadlineRich.length > 0) || !!subheadline;
    const overlayStyle = resolveOverlayStyle(overlayColorToken, overlayOpacity);
    const hlClass = resolveTextClass(headlineColorToken, "text-white");
    const shClass = resolveTextClass(subheadlineColorToken, "text-white/90");

    return (
        <section className="relative min-h-[70vh] flex items-center justify-center overflow-hidden">
            {/* Background video */}
            {videoSrc ? (
                <video
                    autoPlay
                    muted={muted}
                    loop={loop}
                    playsInline
                    poster={posterSrc || undefined}
                    className="absolute inset-0 w-full h-full object-cover"
                >
                    <source src={videoSrc} />
                </video>
            ) : posterSrc ? (
                <img
                    src={posterSrc}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                />
            ) : null}

            {/* Overlay */}
            <div className="absolute inset-0" style={overlayStyle} />

            {/* Content */}
            <div className="relative z-10 text-center px-6 py-24 max-w-4xl mx-auto">
                {headline && (
                    <h1 className={`text-5xl md:text-7xl font-black tracking-tight mb-6 drop-shadow-lg ${hlClass}`}>
                        {headline}
                    </h1>
                )}
                {hasSubheadline && (
                    <SubheadlineText
                        rich={subheadlineRich}
                        plain={subheadline}
                        className={`text-xl mb-10 max-w-2xl mx-auto drop-shadow-md ${shClass}`}
                    />
                )}
                {ctaText && (
                    <a
                        href={ctaLink}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary"
                    >
                        {ctaText}
                    </a>
                )}
            </div>
        </section>
    );
}
