import React from "react";
import { buildEmbedUrl, parseVideoSource } from "../common/videoSource";

/**
 * Public-site render for the `video` block — slice `vid-2`.
 *
 * SSR-safe: pure function of `attrs`, no `window`/`document`, no effect, no state. It runs
 * in the renderer's SERVER bundle (`src/render.ts` → `RENDER_MAP`), so a browser API here
 * is a build-time crash, not a runtime warning (CLAUDE.md Critical Rule 1). Its output is
 * also cached — it lands inside ISR/CloudFront pages — so the markup must be a deterministic
 * function of the block attributes and nothing else.
 *
 * ## What changed in vid-2, and why
 *
 * The previous implementation carried its own YouTube regex and had an implicit TWO-way
 * split: "YouTube, or put the string in an iframe". That produced two defects on live pages:
 *
 *   - a direct `.mp4`/`.webm` URL was handed to an `<iframe>`, where playback is unreliable
 *     (the browser gets a document navigation, not a media element — no controls, no
 *     poster, provider-dependent behaviour);
 *   - an unrecognized URL ALSO went to the iframe, rendering a broken black box with no
 *     signal to the visitor or the author.
 *
 * All classification now goes through the `vid-1` parser
 * (`../common/videoSource.ts`), which is the single source of truth for what a pasted URL
 * means. This file holds NO video-URL regex, and no other render path may grow one.
 *
 * ## The `src` values, and why they are safe
 *
 * `docs/TECH-DEBT.md` § *vid-1 residuals* is explicit that `parseVideoSource` returning an
 * `embedUrl` does NOT mean it returned a *safe* URL — that is true for `youtube`/`vimeo`
 * and false for `direct`. This render discharges that obligation three ways:
 *
 *   1. **Provider kinds never carry tenant input.** The `src` is rebuilt by `buildEmbedUrl`
 *      from a validated 11-char YouTube id / numeric Vimeo id. Nothing of the pasted string
 *      survives into the attribute.
 *   2. **`direct` is constrained at the parser boundary.** `isDirectMediaUrl`'s ratified
 *      scheme guard (`VID1-DIRECT-SCHEME-CONTRACT`) means a `direct` result can only have an
 *      absent, `http`, or `https` scheme — so `javascript:`/`data:`/`file:` cannot reach the
 *      `<video src>` below.
 *   3. **`rawUrl` is never rendered.** Only `embedUrl` (and, for providers, a rebuilt URL)
 *      reaches the DOM. `rawUrl` carries the unfiltered input for editor echo-back and stays
 *      in the editor. Markup injection is separately impossible here because every value
 *      goes through a JSX attribute, which React escapes — this file uses no
 *      `dangerouslySetInnerHTML`.
 */
export function VideoRender({ attrs }: { attrs: any }) {
    const { url, width, caption, autoplay } = attrs;

    const source = parseVideoSource(typeof url === "string" ? url : "");

    // Graceful degradation. `unknown` covers both an empty `url` (a block the author has not
    // filled in yet) and a URL no provider claims. Rendering NOTHING — rather than an empty
    // 16:9 black box — is the point: an unrecognized URL must not leave a visible artifact on
    // a public page. The author sees the failure in the editor instead (`VideoEditor.tsx`).
    if (source.kind === "unknown") return null;

    // Width classes are unchanged from the pre-vid-2 implementation; this slice changes what
    // goes INSIDE the frame, not the frame.
    let containerClass = "my-8 rounded-xl overflow-hidden shadow-lg aspect-video bg-black ";
    if (width === 'centered') containerClass += "max-w-4xl mx-auto";
    if (width === 'wide') containerClass += "max-w-6xl mx-auto";
    if (width === 'full') containerClass += "w-full";

    return (
        <figure className={width === 'full' ? "w-full" : "px-4"}>
            <div className={containerClass}>
                {source.kind === "direct" ? (
                    // Defect fix: native media element, not an iframe. `object-contain`
                    // letterboxes inside the fixed 16:9 frame instead of distorting a clip
                    // whose real aspect ratio differs.
                    //
                    // `autoPlay` implies `muted`: every current browser blocks autoplay with
                    // sound, so an unmuted `autoPlay` would silently do nothing. `playsInline`
                    // stops iOS Safari hijacking the whole screen. Both are conditioned on the
                    // block's own `autoplay` attribute — with it off (the schema default) this
                    // is a plain controls-only player.
                    //
                    // `source.embedUrl` is non-null on this branch (parser contract:
                    // `embedUrl === null` ⇔ `kind === "unknown"`, returned above). The `??`
                    // is required by the type system, not reachable — same posture as the
                    // parser's own `splitUri` null branch.
                    <video
                        src={source.embedUrl ?? undefined}
                        className="w-full h-full object-contain"
                        controls
                        autoPlay={!!autoplay}
                        muted={!!autoplay}
                        playsInline
                    />
                ) : (
                    // `youtube` | `vimeo`. The block's `autoplay` attribute is a provider QUERY
                    // PARAMETER whose spelling differs per provider, and `buildEmbedUrl` is the
                    // only place that knows how to spell it — so the URL is rebuilt from the
                    // validated id rather than concatenated onto `embedUrl` here. With
                    // `autoplay` false, `buildEmbedUrl` emits no parameter at all and the
                    // result equals `source.embedUrl`.
                    <iframe
                        src={
                            source.providerId
                                ? buildEmbedUrl(source.kind, source.providerId, {
                                      autoplay: !!autoplay,
                                  })
                                : source.embedUrl ?? undefined
                        }
                        // a11y: an iframe with no accessible name is announced as "frame" and
                        // nothing else. The caption is the author's own description when
                        // present; the fallback keeps the name non-empty in every case.
                        title={caption || "Embedded video"}
                        // Below-the-fold by nature (this is an inline content block, unlike
                        // `video-hero`), so defer the provider's player bundle. Deliberately
                        // NOT set on the native <video> above — there the browser's own
                        // preload heuristics are better than a blanket defer.
                        loading="lazy"
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    />
                )}
            </div>
            {caption && <figcaption className="text-center text-sm text-muted-foreground mt-2">{caption}</figcaption>}
        </figure>
    );
}
