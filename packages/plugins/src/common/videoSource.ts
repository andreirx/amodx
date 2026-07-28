/**
 * Video source parser — slice `vid-1` (SUPPORT module).
 *
 * ONE deterministic classifier for the string a tenant pastes into the `video` block's
 * `url` attribute or the `video-hero` block's `videoSrc` attribute. Retires the risk that
 * each render path grows its own regex: today `video/VideoRender.tsx` carries an inline
 * YouTube regex, handles no Vimeo at all, and feeds direct `.mp4` URLs to an `<iframe>`,
 * where they do not play. `vid-2` and `vid-3` replace those paths with calls into here.
 *
 * ## Contract
 *
 * Pure, total, deterministic, SSR-safe. No DOM, no `window`, no network, no `Date`, no
 * global `URL` — the same input always yields the same output, in a Lambda, in `next
 * build`, and in the browser editor. It therefore satisfies `CLAUDE.md` Critical Rule 1
 * (plugin split entry): it is importable from BOTH the `render` (server) and `admin`
 * (browser) entry points because it touches nothing environment-specific.
 *
 * Never throws. Every input — including `""`, whitespace, and a non-URL — resolves to a
 * `ParsedVideoSource`; unrecognized input is `kind: "unknown"`, `embedUrl: null`, which is
 * the caller's signal to render nothing rather than a broken element.
 *
 * ## Why regex and not `new URL()`
 *
 * `URL` throws on relative input (`/uploads/clip.mp4`), which the media library can
 * legitimately produce, and a parser whose contract is "never throws" would then need a
 * try/catch around every call. The shape regex below is RFC 3986 Appendix B — the
 * reference decomposition from the URI spec itself, reused rather than reinvented — which
 * is total by construction: it matches every string, splitting into optional scheme,
 * optional authority, path, optional query.
 *
 * ## What is NOT handled (deliberate, see docs/TECH-DEBT.md)
 *
 * - `youtube.com/live/{id}` and the legacy `youtube.com/v/{id}` → `unknown`.
 * - `youtube-nocookie.com` → `unknown` (privacy mode is out of scope per the slice doc).
 * - Vimeo unlisted-video privacy hashes (`vimeo.com/{id}/{hash}`) → `unknown`; the embed
 *   needs a `?h=` parameter this module does not model.
 * - No oEmbed, no metadata, no thumbnail resolution.
 */

/** Four-way classification of a pasted video URL. */
export type VideoSourceKind = "youtube" | "vimeo" | "direct" | "unknown";

export interface ParsedVideoSource {
    kind: VideoSourceKind;
    /** The caller's input, verbatim and untrimmed — what to echo back in editor UI. */
    rawUrl: string;
    /**
     * What to put in the `src` attribute:
     *   `youtube` / `vimeo` → the canonical bare embed URL (no query parameters),
     *   `direct`            → the input verbatim — the SAME string as `rawUrl`,
     *   `unknown`           → `null`; render no element.
     */
    embedUrl: string | null;
    /** Provider video id. Present for `youtube` and `vimeo` only. */
    providerId?: string;
}

/**
 * Inline-player options for `buildEmbedUrl`.
 *
 * Every flag is OPT-IN: a parameter is emitted only when the flag is set to the
 * non-default value, so `buildEmbedUrl(kind, id)` returns the bare embed URL and equals
 * `parseVideoSource(...).embedUrl`. `controls` is the one flag whose provider default is
 * "on", so only `controls: false` emits anything.
 */
export interface EmbedOptions {
    autoplay?: boolean;
    muted?: boolean;
    loop?: boolean;
    controls?: boolean;
    /** Vimeo's dedicated background mode. Ignored for YouTube, which has no equivalent. */
    background?: boolean;
}

/** Provider-backed kinds — the two for which an embed URL can be constructed from an id. */
export type EmbedProviderKind = Extract<VideoSourceKind, "youtube" | "vimeo">;

// ---------------------------------------------------------------------------------------
// URL shape
// ---------------------------------------------------------------------------------------

/**
 * RFC 3986 Appendix B, minus the fragment capture (unused here).
 * Groups: 1 = scheme (no `:`), 2 = authority, 3 = path, 4 = query (no `?`).
 *
 * Every part is optional and the path group accepts the empty string, so this matches ANY
 * input — which is what makes `parseVideoSource` total. `exec()` is still typed
 * `RegExpExecArray | null`, so `splitUri` carries a null branch: it is required by the type
 * system rather than reachable today, and it is also the branch that keeps a future edit to
 * this regex from turning a non-match into a thrown TypeError.
 */
const URI_SHAPE_RE =
    /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/;

interface UriParts {
    /** Lowercased scheme without the colon; `null` for scheme-relative and relative input. */
    scheme: string | null;
    /** Lowercased host, userinfo and port removed; `""` when there is no authority. */
    host: string;
    /** Path with the leading slash, if any. */
    path: string;
    /** Query without the leading `?`; `""` when absent. */
    query: string;
}

function splitUri(url: string): UriParts {
    const m = URI_SHAPE_RE.exec(url);
    if (!m) return { scheme: null, host: "", path: url, query: "" };
    const authority = m[2] ?? "";
    // `user:pass@host:port` → `host`. Everything before the last `@` is userinfo.
    const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
    return {
        scheme: m[1] ? m[1].toLowerCase() : null,
        host: hostAndPort.split(":")[0].toLowerCase(),
        path: m[3] ?? "",
        query: m[4] ?? "",
    };
}

/** `true` for `example.com` itself and any subdomain of it — and for nothing else. */
function isHostOrSubdomainOf(host: string, domain: string): boolean {
    return host === domain || host.endsWith("." + domain);
}

/** Path split into non-empty segments: `/embed/abc/` → `["embed", "abc"]`. */
function pathSegments(path: string): string[] {
    return path.split("/").filter((s) => s.length > 0);
}

/** First value of `name` in a raw query string, or `null`. */
function queryParam(query: string, name: string): string | null {
    for (const pair of query.split("&")) {
        const eq = pair.indexOf("=");
        if (eq > 0 && pair.slice(0, eq) === name) return pair.slice(eq + 1);
    }
    return null;
}

// ---------------------------------------------------------------------------------------
// Provider id extraction
// ---------------------------------------------------------------------------------------

/** YouTube ids are exactly 11 characters of the URL-safe base64 alphabet. */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
/**
 * Vimeo ids are decimal. No length bound: the host test has already established we are on
 * `vimeo.com`, so a bare numeric path segment there is a video id, and inventing a minimum
 * length would only reject the short ids Vimeo issued in its early years.
 */
const VIMEO_ID_RE = /^[0-9]+$/;

/**
 * Returns the YouTube video id, or `null`.
 *
 * Handles exactly the four forms the plan enumerates:
 *   `youtube.com/watch?v=ID` · `youtu.be/ID` · `youtube.com/shorts/ID` · `youtube.com/embed/ID`
 *
 * `watch?v=` is read out of the parsed query rather than by position, so
 * `watch?list=PL...&v=ID` works. The id is validated against `YOUTUBE_ID_RE`, so a
 * truncated or padded id classifies as `unknown` rather than producing a dead embed.
 */
function youtubeId(parts: UriParts): string | null {
    const segs = pathSegments(parts.path);

    if (isHostOrSubdomainOf(parts.host, "youtu.be")) {
        const id = segs[0];
        return id && YOUTUBE_ID_RE.test(id) ? id : null;
    }

    if (!isHostOrSubdomainOf(parts.host, "youtube.com")) return null;

    if (segs[0] === "watch") {
        const v = queryParam(parts.query, "v");
        return v && YOUTUBE_ID_RE.test(v) ? v : null;
    }
    if ((segs[0] === "shorts" || segs[0] === "embed") && segs[1]) {
        return YOUTUBE_ID_RE.test(segs[1]) ? segs[1] : null;
    }
    return null;
}

/**
 * Returns the Vimeo video id, or `null`.
 *
 * Handles `vimeo.com/ID` and `player.vimeo.com/video/ID`. A second path segment means an
 * unlisted-video privacy hash or a channel/album URL, neither of which this module models,
 * so those return `null` → `unknown` rather than an embed that 404s at the player.
 */
function vimeoId(parts: UriParts): string | null {
    if (!isHostOrSubdomainOf(parts.host, "vimeo.com")) return null;
    const segs = pathSegments(parts.path);

    if (segs.length === 1 && VIMEO_ID_RE.test(segs[0])) return segs[0];
    if (segs.length === 2 && segs[0] === "video" && VIMEO_ID_RE.test(segs[1])) return segs[1];
    return null;
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

const DIRECT_MEDIA_EXT_RE = /\.(mp4|webm|mov|m4v|ogg)$/i;

/**
 * `true` when the URL names an uploaded media file playable by a native `<video>` element.
 *
 * The extension test runs on the PATH only, so query strings survive — S3/CloudFront
 * presigned URLs (`...clip.mp4?X-Amz-Signature=...`) and cache-busting tokens classify
 * correctly. Case-insensitive: `CLIP.MP4` counts.
 *
 * The scheme guard is a RATIFIED amendment to the plan's `direct` rule (2026-07-28,
 * decision `VID1-DIRECT-SCHEME-CONTRACT`; `docs/plan-youtube-vimeo-embed.md` § Phase 1
 * rule 3). The plan defined `direct` purely by extension. That is not sufficient: a
 * `direct` result puts `embedUrl` straight into a `<video src>`, so under the extension-only
 * rule `javascript:evil()//x.mp4` classifies as `direct` and `vid-2` hands it to that
 * attribute. Only an absent (relative / scheme-relative), `http`, or `https` scheme
 * qualifies. It tightens a region the plan left unspecified — every URL in the plan's
 * checklist is unaffected, and `/uploads/clip.mp4` from the media library still passes.
 *
 * This is defence in depth AT the classification boundary, not a substitute for output
 * encoding in the render paths — `vid-2`/`vid-3` still own that (`docs/TECH-DEBT.md`
 * § vid-1 residuals).
 */
export function isDirectMediaUrl(url: string): boolean {
    const parts = splitUri(url.trim());
    if (parts.scheme !== null && parts.scheme !== "http" && parts.scheme !== "https") {
        return false;
    }
    return DIRECT_MEDIA_EXT_RE.test(parts.path);
}

/**
 * Canonical inline embed URL for a provider id.
 *
 * With no `options` this returns the bare embed URL — the value `parseVideoSource` puts in
 * `embedUrl`. Parameters are appended only for flags set away from the provider default,
 * so the output stays the shortest URL that expresses the request.
 *
 * YouTube's `loop=1` is inert on its own; the player only loops a *playlist*, so the
 * documented workaround is `playlist={id}` naming the video itself. That pairing is
 * emitted together and must not be split.
 *
 * `background` is Vimeo-only — YouTube has no single-parameter background mode, which is
 * why `buildBackgroundEmbedUrl` exists as its own function rather than as an option here.
 */
export function buildEmbedUrl(
    kind: EmbedProviderKind,
    id: string,
    options?: EmbedOptions,
): string {
    const params: string[] = [];
    const o = options ?? {};

    if (kind === "youtube") {
        if (o.autoplay) params.push("autoplay=1");
        if (o.muted) params.push("mute=1");
        if (o.loop) params.push("loop=1", `playlist=${id}`);
        if (o.controls === false) params.push("controls=0");
        const query = params.length ? `?${params.join("&")}` : "";
        return `https://www.youtube.com/embed/${id}${query}`;
    }

    if (o.autoplay) params.push("autoplay=1");
    if (o.muted) params.push("muted=1");
    if (o.loop) params.push("loop=1");
    if (o.controls === false) params.push("controls=0");
    if (o.background) params.push("background=1");
    const query = params.length ? `?${params.join("&")}` : "";
    return `https://player.vimeo.com/video/${id}${query}`;
}

/**
 * Embed URL for `video-hero` background mode: muted, looping, chrome-free, autoplaying.
 *
 * Not expressible as `buildEmbedUrl(..., { autoplay: true, ... })` for YouTube, because
 * suppressing the player chrome needs four parameters that are not — and should not
 * become — `EmbedOptions` flags: `modestbranding`, `playsinline` (iOS refuses inline
 * autoplay without it), `rel=0` and `iv_load_policy=3`. Vimeo collapses the whole set into
 * its own `background=1`.
 *
 * Autoplay remains subject to browser policy; a device that blocks muted autoplay shows a
 * static first frame. That is a known limitation, not a parser defect.
 */
export function buildBackgroundEmbedUrl(kind: EmbedProviderKind, id: string): string {
    if (kind === "youtube") {
        return (
            `https://www.youtube.com/embed/${id}` +
            `?autoplay=1&mute=1&loop=1&playlist=${id}` +
            `&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3`
        );
    }
    return `https://player.vimeo.com/video/${id}?background=1`;
}

/**
 * Classify a pasted URL into exactly one of four kinds.
 *
 * Order is significant: YouTube → Vimeo → direct media → unknown. Provider detection runs
 * first so a provider URL that happens to end in a media extension cannot be mistaken for
 * an uploaded file.
 *
 * The four-way split is the point of this module. The previous implicit two-way split
 * ("YouTube, or pass the string through") is what let an invalid URL reach an `<iframe>`
 * and render a broken box; `unknown` now carries `embedUrl: null` so callers have a value
 * to branch on.
 */
export function parseVideoSource(url: string): ParsedVideoSource {
    const trimmed = url.trim();
    if (trimmed === "") return { kind: "unknown", rawUrl: url, embedUrl: null };

    const parts = splitUri(trimmed);

    const yt = youtubeId(parts);
    if (yt) {
        return {
            kind: "youtube",
            rawUrl: url,
            embedUrl: buildEmbedUrl("youtube", yt),
            providerId: yt,
        };
    }

    const vimeo = vimeoId(parts);
    if (vimeo) {
        return {
            kind: "vimeo",
            rawUrl: url,
            embedUrl: buildEmbedUrl("vimeo", vimeo),
            providerId: vimeo,
        };
    }

    // Rule 3 of `docs/plan-youtube-vimeo-embed.md` § Phase 1 fixes this value: for `direct`,
    // `embedUrl` IS the raw URL. Trimming is a CLASSIFICATION step only (a trailing space
    // defeats the end-anchored extension test above), so the string handed back is the
    // caller's own, byte for byte, and `embedUrl === rawUrl` holds for every `direct` result.
    // Surrounding whitespace is not a rendering hazard: the WHATWG URL parser strips leading
    // and trailing C0-control/space characters before resolving a `src` attribute.
    if (isDirectMediaUrl(trimmed)) {
        return { kind: "direct", rawUrl: url, embedUrl: url };
    }

    return { kind: "unknown", rawUrl: url, embedUrl: null };
}
