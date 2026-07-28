import React from "react";
import { InlineRichTextRenderer } from "../common/InlineRichTextRenderer";
import { resolveOverlayStyle, resolveTextClass } from "../common/resolveCoverColorTokens";
import { buildBackgroundEmbedUrl, parseVideoSource } from "../common/videoSource";

/**
 * Cover geometry for a background `<iframe>` — slice `vid-3`.
 *
 * A native `<video>` covers with `object-fit: cover`, which is a property of REPLACED
 * elements. An `<iframe>` is not replaced: it is a viewport onto another document, and the
 * provider's player letterboxes its 16:9 video inside whatever box we give it. So `cover`
 * has to be done by SIZING THE BOX — the box must itself stay 16:9 and be at least as large
 * as the section on both axes.
 *
 * The two competing pairs do that:
 *   `width : max(177.7778vh, 100%)`   — 177.7778vh is 16/9 of the viewport height
 *   `height: max(100vh, 56.25vw)`     — 56.25vw is 9/16 of the viewport width
 *
 * `177.7778vh × 100vh` is exactly 16:9, and `100% × 56.25vw` is exactly 16:9 whenever the
 * section spans the viewport width (`blockWidth: "full"`, the schema default). Whichever
 * pair wins, the box keeps the player's aspect ratio, so the video fills it edge to edge and
 * the `translate(-50%, -50%)` centring crops the overflow symmetrically. Landscape wins on
 * the vh pair, portrait on the vw pair — which is why both are needed and why DoD item 4 is
 * checked on a wide AND a tall viewport.
 *
 * This is `docs/plan-youtube-vimeo-embed.md` § Phase 3's ratified sizer, expressed as an
 * inline style rather than a stylesheet: the plugins package emits no CSS (there is no
 * `.css` file and no bundler step — `npm run build` is bare `tsc`), so a class would need a
 * new delivery mechanism, and a Tailwind arbitrary value would make the cover depend on the
 * consuming app's `@source` scan resolving `w-[177.7778vh]`. Geometry, no colour — Critical
 * Rule 6 is not in play. `resolveOverlayStyle` in this same file already returns an inline
 * style, so this is the file's existing idiom.
 *
 * KNOWN BOUNDARY (documented, not fixed): the vh terms are viewport-relative while the
 * section is `min-h-[70vh]`. If the author's headline/CTA push the section TALLER than the
 * viewport, the box can stop covering the bottom of it. Viewport units are what the ratified
 * plan specifies; making this container-relative needs `container-type: size` + `cqw`/`cqh`
 * units, which is a design change, not an implementation detail. Recorded in
 * `docs/TECH-DEBT.md` § *vid-3 residuals*.
 */
const IFRAME_COVER_SIZER: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "177.7778vh",
    height: "100vh",
    minWidth: "100%",
    minHeight: "56.25vw",
    // The background is decorative. Without this, the provider's player swallows clicks
    // aimed at the CTA's neighbourhood and pops up its own chrome on hover.
    pointerEvents: "none",
    // UA stylesheets give an iframe a 2px inset border. Tailwind's preflight resets it in
    // both consuming apps today, but this element must not depend on that — a visible frame
    // around a full-bleed hero is the kind of defect nobody catches until production.
    border: 0,
};

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

/**
 * Public-site render for the `video-hero` block — slice `vid-3`.
 *
 * SSR-safe: a pure function of `attrs`. No `window`/`document`, no state, no effect. It runs
 * in the renderer's SERVER bundle via `src/render.ts` → `RENDER_MAP["videoHero"]`, and its
 * markup is cached inside ISR/CloudFront pages, so it must be deterministic in the block
 * attributes and nothing else (CLAUDE.md Critical Rule 1).
 *
 * ## What changed in vid-3
 *
 * Before this slice the block was native-`<video>`-only: ANY non-empty `videoSrc` was
 * dropped into `<source src>`. A pasted YouTube or Vimeo URL therefore produced a `<video>`
 * element pointing at an HTML page — a silent failure, no playback, no error, and the poster
 * was suppressed because a `<video>` element existed. Classification now goes through the
 * `vid-1` parser, the same one `video/VideoRender.tsx` uses, so the two video blocks cannot
 * disagree about what a URL means. This file holds NO video-URL regex.
 *
 * | Kind | Background element | Source |
 * |------|--------------------|--------|
 * | `direct` | native `<video autoplay playsinline>` | `embedUrl`, which for this kind IS the raw URL |
 * | `youtube` / `vimeo` | `<iframe>` in the cover sizer above | `buildBackgroundEmbedUrl` — rebuilt from the validated id |
 * | `unknown` | none — the poster `<img>`, if the author set one | — |
 *
 * ## Behaviour change worth knowing at review time
 *
 * `unknown` now falls back to the poster instead of emitting a dead `<video>`. That is DoD
 * item 3 and is the point of the slice, but it means a stored `videoSrc` the parser does not
 * recognize — an extension outside `.mp4/.webm/.mov/.m4v/.ogg`, or an extensionless URL —
 * stops emitting a `<video>` element. Media-library uploads are unaffected: `assets/create.ts`
 * builds the S3 key as `${tenantId}/${assetId}-${filename}`, so the original extension
 * survives and those URLs still classify `direct`.
 *
 * ## Why the `src` values are safe (discharges the `vid-1` residual for this block)
 *
 * `docs/TECH-DEBT.md` § *vid-1 residuals* is explicit that an `embedUrl` is not the same as a
 * SAFE URL. Three defences, the same shape `vid-2` used:
 *   1. Provider kinds carry no tenant input — `buildBackgroundEmbedUrl` rebuilds the URL from
 *      a validated 11-char YouTube id / numeric Vimeo id.
 *   2. `direct` is bounded at the parser: `isDirectMediaUrl`'s ratified scheme guard
 *      (`VID1-DIRECT-SCHEME-CONTRACT`) admits only an absent, `http`, or `https` scheme, so
 *      `javascript:`/`data:`/`file:` cannot reach `<source src>`. Before vid-3 they could.
 *   3. `rawUrl` is never rendered, every value goes through a JSX attribute (React escapes
 *      it), and there is no `dangerouslySetInnerHTML` on this path.
 *
 * `posterSrc` is NOT parser-gated — it is an image URL, outside `parseVideoSource`'s domain,
 * and it reaches `<img src>`/`<video poster>` exactly as it did before this slice. Unchanged
 * pre-existing surface, recorded in `docs/TECH-DEBT.md` § *vid-3 residuals*.
 */
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

    const source = parseVideoSource(typeof videoSrc === "string" ? videoSrc : "");
    // Built here rather than in the JSX so the `kind` narrowing and the `providerId`
    // presence check happen in one expression — inside JSX, TypeScript cannot carry the
    // narrowing across the branch and the call would need a cast.
    //
    // Background params are the provider's, not ours: YouTube needs six
    // (`autoplay`+`mute`+`loop`+`playlist` plus chrome suppression), Vimeo collapses them
    // into `background=1`. `buildBackgroundEmbedUrl` is the only place that spelling lives.
    const embedUrl =
        (source.kind === "youtube" || source.kind === "vimeo") && source.providerId
            ? buildBackgroundEmbedUrl(source.kind, source.providerId)
            : null;

    return (
        <section className="relative min-h-[70vh] flex items-center justify-center overflow-hidden">
            {/* Background: native video / provider embed / poster, per parser kind. */}
            {source.kind === "direct" ? (
                // Unchanged from pre-vid-3 apart from the `src`, which is now the parsed
                // value rather than the raw attribute. `muted`/`loop` stay author-controlled
                // here because a native element can honour them; note that `muted={false}`
                // means browsers will refuse the `autoPlay` — pre-existing behaviour, and the
                // schema default is `true`.
                <video
                    autoPlay
                    muted={muted}
                    loop={loop}
                    playsInline
                    poster={posterSrc || undefined}
                    className="absolute inset-0 w-full h-full object-cover"
                >
                    <source src={source.embedUrl ?? undefined} />
                </video>
            ) : embedUrl ? (
                <iframe
                    src={embedUrl}
                    style={IFRAME_COVER_SIZER}
                    // a11y: an iframe with no accessible name is announced as "frame" and
                    // nothing more. The headline is the author's own description of the hero
                    // when present; the fallback keeps the name non-empty in every case.
                    title={headline || "Background video"}
                    // Cross-origin autoplay is gated by Permissions Policy — without
                    // `autoplay` here the provider's own `autoplay=1` is ignored.
                    allow="autoplay; encrypted-media; picture-in-picture"
                    // NO `loading="lazy"`: this is the top of the page (DoD item 6). Deferring
                    // it would guarantee the hero is blank on first paint.
                />
            ) : posterSrc ? (
                // `unknown`, including an empty `videoSrc`: poster only (DoD item 3). No dead
                // `<video>`, and nothing at all when the author has not set a poster either.
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
