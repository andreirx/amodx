import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { LazyEffectCanvas } from "../common/LazyEffectCanvas";
import { ButtonEffectWrap } from "../common/ButtonEffectWrap";
import { resolveButtonEffect } from "../common/resolveButtonEffect";
import { InlineRichTextRenderer } from "../common/InlineRichTextRenderer";
import { resolveOverlayStyle, resolveTextClass } from "../common/resolveCoverColorTokens";
import type { BlockStrings } from "@amodx/shared";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// Button text sits on the opaque label surface inside ButtonEffectWrap.
// No stroke/shadow hacks — readability is structural, not a paint trick.
const btnClass = "inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary";
// SHOP-LOOK-1B `buttonShape: "pill"`: today's string with `rounded-full` in the place of `rounded-md`. Class rule
// (docs/slices/shop-look-1.md § 6.5): an existing element's class string is one of two complete literals, chosen by one
// conditional — never today's string with a part appended — so "absent" is today's string character for character.
const btnClassPill = "inline-flex items-center justify-center rounded-full text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary";
// Operator ruling SL1B-INVERSE-BUTTON (amends the "First button" row of § 6.5): on the inverse split panel the first
// button keeps its fill and label and gains an edge in the panel's text colour (`border border-background/40`), because
// with a theme whose primary equals the foreground the fill is not visible on `bg-foreground`. One complete literal per
// shape; `plain`, absent and every other style keep `btnClass` / `btnClassPill`.
const FIRST_BUTTON_CLASS = {
    plain: { rounded: btnClass, pill: btnClassPill },
    inverse: {
        rounded: "inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary border border-background/40",
        pill: "inline-flex items-center justify-center rounded-full text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary border border-background/40",
    },
};

// SHOP-LOOK-1B `splitPanel: "inverse"` (§ 6.5): the split text panel and the existing texts inside it, as complete
// strings. `plain` holds today's strings; `inverse` swaps each colour class in its place and adds `bg-foreground`.
const SPLIT_PANEL = {
    plain: {
        panel: "relative z-10 order-2 lg:order-1 flex flex-col justify-center px-6 lg:px-12 py-12 lg:py-20",
        headline: "text-4xl lg:text-5xl font-black tracking-tight text-foreground mb-6",
        text: "text-lg text-muted-foreground mb-8",
    },
    inverse: {
        panel: "relative z-10 order-2 lg:order-1 flex flex-col justify-center px-6 lg:px-12 py-12 lg:py-20 bg-foreground",
        headline: "text-4xl lg:text-5xl font-black tracking-tight text-background mb-6",
        text: "text-lg text-background/80 mb-8",
    },
};

/**
 * SHOP-LOOK-1B: the colour classes of the NEW elements, by the surface they sit on. These elements exist only when
 * their attribute is set, so their strings cannot change today's HTML.
 *  - page: the page background (center, minimal, split with a plain panel) — § 6.5 column "Today (plain)";
 *  - inverse: the split panel with `splitPanel: "inverse"` — § 6.5 column "inverse";
 *  - cover: the photo overlay. The design names no colour here; the new texts follow the cover's own text tokens (the
 *    eyebrow — ruling SL1B-COVER-EYEBROW —, the outline button and the numbers take the headline's class with
 *    `border-current`, the captions the subheadline's; defaults white and white/90, as today's cover texts), so an owner
 *    who re-coloured the cover texts for a light overlay gets the same colours on the new texts. The accent keeps the
 *    § 4.2 default `text-primary` on the cover (the owner changes it with `headlineAccentColorToken`).
 */
type Tone = { eyebrow: string; accent: string; outline: string; statValue: string; statLabel: string };
const EYEBROW_BASE = "inline-block w-fit rounded-full border px-3 py-1 mb-6 text-xs font-semibold uppercase tracking-widest";
const OUTLINE_BASE = {
    rounded: "inline-flex items-center justify-center rounded-md border text-sm font-medium h-11 px-8 hover:opacity-90",
    pill: "inline-flex items-center justify-center rounded-full border text-sm font-medium h-11 px-8 hover:opacity-90",
};
const STAT_VALUE_BASE = "text-2xl md:text-4xl font-black tracking-tight";
const STAT_LABEL_BASE = "text-sm";
const PAGE_TONE: Tone = {
    eyebrow: `${EYEBROW_BASE} border-primary/30 text-primary`,
    accent: "text-primary",
    outline: "border-foreground text-foreground",
    statValue: `${STAT_VALUE_BASE} text-foreground`,
    statLabel: `${STAT_LABEL_BASE} text-muted-foreground`,
};
const INVERSE_TONE: Tone = {
    eyebrow: `${EYEBROW_BASE} border-background/40 text-background`,
    accent: "text-background/70",
    outline: "border-background text-background",
    statValue: `${STAT_VALUE_BASE} text-background`,
    statLabel: `${STAT_LABEL_BASE} text-background/70`,
};
function coverTone(hlClass: string, shClass: string): Tone {
    return {
        eyebrow: `${EYEBROW_BASE} border-current ${hlClass}`,
        accent: PAGE_TONE.accent,
        outline: `border-current ${hlClass}`,
        statValue: `${STAT_VALUE_BASE} drop-shadow-md ${hlClass}`,
        statLabel: `${STAT_LABEL_BASE} drop-shadow-md ${shClass}`,
    };
}

/** § 6.2: the numbers on one row from `md`; on a phone 2 columns for 4 items (literal classes, so Tailwind compiles them). */
const STATS_GRID: Record<number, string> = {
    1: "mt-12 grid grid-cols-1 gap-6",
    2: "mt-12 grid grid-cols-2 gap-6",
    3: "mt-12 grid grid-cols-3 gap-6",
    4: "mt-12 grid grid-cols-2 md:grid-cols-4 gap-6",
};
/** § 6.2: two buttons stacked full width on a phone, side by side from `md`. */
const BUTTON_ROW = {
    centered: "flex flex-col md:flex-row gap-4 md:justify-center",
    start: "flex flex-col md:flex-row gap-4",
};

/** A stored text attribute, trimmed; `null` when it is absent, not a string, or blank (whitespace only). */
function textOrNull(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The numbers to draw: the items with a non-blank value, in stored order, at most four; a blank caption → no caption. */
function statsToDraw(value: unknown): { value: string; label: string | null }[] {
    if (!Array.isArray(value)) return [];
    const drawn: { value: string; label: string | null }[] = [];
    for (const item of value) {
        const v = textOrNull(item?.value);
        if (v !== null) drawn.push({ value: v, label: textOrNull(item?.label) });
    }
    return drawn.slice(0, 4);
}

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

/** LOCALE-1C: the fixed text comes from `strings` (the tenant's locale table; RenderBlocks always gives it). */
export function HeroRender({ attrs, strings }: { attrs: any; strings: BlockStrings }) {
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

    // SHOP-LOOK-1B options (§ 4.2). Each is null / empty when absent or blank, and then adds nothing to the HTML.
    const eyebrow = textOrNull(attrs?.eyebrow);
    const accent = textOrNull(attrs?.headlineAccent);
    const secondaryText = textOrNull(attrs?.secondaryCtaText);
    const secondaryLink = textOrNull(attrs?.secondaryCtaLink);
    const stats = statsToDraw(attrs?.stats);
    const shape = attrs?.buttonShape === "pill" ? "pill" : "rounded";
    // Internal links through the tenant URL helper that RenderBlocks injects (SL-D14); a blank link → "#".
    const toUrl: (slug: string) => string = typeof attrs?._getUrl === "function" ? attrs._getUrl : (slug: string) => slug;
    const secondaryHref = secondaryLink === null ? "#" : toUrl(secondaryLink);

    const eyebrowEl = (tone: Tone) => eyebrow === null ? null : <p className={tone.eyebrow}>{eyebrow}</p>;
    // The accent's colour: an owner's explicit token → its class in every style and panel (kept, § 6.5); absent, `auto`
    // or a value the resolver does not know → the surface default (`resolveTextClass` returns the default for both).
    const accentEl = (tone: Tone) => accent === null ? null : (
        <>{" "}<span className={resolveTextClass(attrs?.headlineAccentColorToken, tone.accent)}>{accent}</span></>
    );
    /** The first button (today's element) with the class of its panel kind and shape; nothing without a text. */
    const firstButton = (panelKind: "plain" | "inverse") => ctaText && (
        <ButtonEffectWrap effect={buttonEffect}>
            <a href={ctaLink} className={FIRST_BUTTON_CLASS[panelKind][shape]}>
                {ctaText}
            </a>
        </ButtonEffectWrap>
    );
    /** `today` (the first button's slot as before; default: the first button bare), or both buttons in one row when
     *  the second is set. */
    const buttonsEl = (tone: Tone, row: string, first: React.ReactNode, today: React.ReactNode = first) => secondaryText === null ? today : (
        <div className={row}>
            {first || null}
            <a href={secondaryHref} className={`${OUTLINE_BASE[shape]} ${tone.outline}`}>{secondaryText}</a>
        </div>
    );
    const statsEl = (tone: Tone) => stats.length === 0 ? null : (
        <div className={STATS_GRID[stats.length]}>
            {stats.map((item, i) => (
                <div key={i}>
                    <p className={tone.statValue}>{item.value}</p>
                    {item.label !== null && <p className={tone.statLabel}>{item.label}</p>}
                </div>
            ))}
        </div>
    );

    // --- Minimal ---
    if (style === "minimal") {
        return (
            <section className="relative py-24 max-w-4xl mx-auto">
                <LazyEffectCanvas effect={attrs.effect} />
                <div className="relative z-10">
                    {eyebrowEl(PAGE_TONE)}
                    <h1 className="text-6xl font-black tracking-tighter text-foreground mb-6">
                        {headline}{accentEl(PAGE_TONE)}
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
        // `inverse` is read on this style only; any other value (absent, `plain`, unknown) → today's strings.
        const inverse = attrs?.splitPanel === "inverse";
        const panel = inverse ? SPLIT_PANEL.inverse : SPLIT_PANEL.plain;
        const tone = inverse ? INVERSE_TONE : PAGE_TONE;
        const first = firstButton(inverse ? "inverse" : "plain");
        return (
            <section className="relative grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] items-stretch max-w-7xl mx-auto">
                <LazyEffectCanvas effect={attrs.effect} />
                {/* Image — shows first on mobile, right on desktop */}
                <div className="relative z-10 order-1 lg:order-2 bg-muted overflow-hidden min-h-[300px] lg:min-h-[500px]">
                    {imageSrc ? (
                        <img src={imageSrc} alt={headline} className="w-full h-full object-cover" />
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground/30">{strings.heroNoImage}</div>
                    )}
                </div>
                {/* Text — shows second on mobile, left on desktop */}
                <div className={panel.panel}>
                    {eyebrowEl(tone)}
                    <h1 className={panel.headline}>{headline}{accentEl(tone)}</h1>
                    {hasSubheadline && <SubheadlineText rich={subheadlineRich} plain={subheadline} className={panel.text} />}
                    {buttonsEl(tone, BUTTON_ROW.start, first, first && <div>{first}</div>)}
                    {statsEl(tone)}
                </div>
            </section>
        );
    }

    // --- Cover: image as full background, text centered on top ---
    if (style === "cover") {
        const overlayStyle = resolveOverlayStyle(overlayColorToken, overlayOpacity);
        const hlClass = resolveTextClass(headlineColorToken, "text-white");
        const shClass = resolveTextClass(subheadlineColorToken, "text-white/90");
        const tone = coverTone(hlClass, shClass);

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
                    {eyebrowEl(tone)}
                    <h1 className={`text-5xl md:text-7xl font-black tracking-tight mb-6 drop-shadow-lg ${hlClass}`}>
                        {headline}{accentEl(tone)}
                    </h1>
                    {hasSubheadline && (
                        <SubheadlineText rich={subheadlineRich} plain={subheadline} className={`text-xl mb-10 max-w-2xl mx-auto drop-shadow-md ${shClass}`} />
                    )}
                    {buttonsEl(tone, BUTTON_ROW.centered, firstButton("plain"))}
                    {statsEl(tone)}
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
            {eyebrowEl(PAGE_TONE)}
            <h1 className="text-5xl md:text-7xl font-black tracking-tight text-foreground mb-6">
                {headline}{accentEl(PAGE_TONE)}
            </h1>
            {hasSubheadline && (
                <SubheadlineText rich={subheadlineRich} plain={subheadline} className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto" />
            )}
            {buttonsEl(PAGE_TONE, BUTTON_ROW.centered, firstButton("plain"))}
            {statsEl(PAGE_TONE)}
            </div>
        </section>
    );
}
