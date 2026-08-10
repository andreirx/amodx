import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RENDER_LOADERS } from "../src/render";
import { VideoHeroEditor } from "../src/video-hero/VideoHeroEditor";
import { VideoHeroSchema } from "../src/video-hero/schema";
import type { VideoSourceKind } from "../src/common/videoSource";

/**
 * slice `vid-3` — the `video-hero` plugin's two surfaces, asserted as OUTPUT.
 *
 * Same shape and same rationale as `vid-2`'s `videoPlugin.test.ts` (commit e8da608):
 * `vid-1` pinned what the parser DECIDES, these files pin what each decision EMITS. The two
 * are separable failures — the parser can classify a YouTube URL correctly while the hero
 * still drops it into a `<source>` element, which is exactly the defect this slice retires.
 *
 * ## What this suite can and cannot reach
 *
 * `renderToStaticMarkup` is `react-dom/server` — the same code path the renderer's SSR uses.
 * No DOM, no jsdom, no RTL, no new dependency, so the suite stays in the `environment:
 * "node"` run and stays credential-free. Going through `RENDER_LOADERS["videoHero"]` (the
 * perf-1 lazy registry) rather than the component asserts the render-entry wiring too, and
 * `await`ing the thunk loads the `videoHero` (and `video`) render module with no DOM — so a
 * top-level `window` reference in THAT module fails this file. Scope note: after perf-1 the
 * loaders are lazy, so this only exercises the modules it awaits, NOT the whole render entry —
 * the entry-wide module-load SSR check lives in `test/renderLoaders.test.ts`.
 *
 * What it CANNOT reach is anything that needs layout or a real browser. The cover geometry
 * is asserted here as EMITTED CSS (the declarations are a deterministic function of the
 * branch taken); whether those declarations visually cover a landscape and a portrait
 * viewport is a measurement, not an assertion, and stays the operator's — see the slice's
 * § *Operator visual checklist*. Same for mobile autoplay policy and hydration smoothness.
 *
 * `VideoHeroEditor` renders under this harness because it reads only `props.node.attrs` at
 * render time; `props.editor` is touched exclusively inside click/change handlers. Its
 * `InlineRichTextField` logs one Tiptap SSR notice per render (`useEditor` returns `null`
 * outside a browser and the field renders empty) — expected, and precisely why the editor is
 * admin-only under CLAUDE.md Critical Rule 1. Interaction (typing, tab clicks, `onChange`)
 * still needs the DOM/RTL harness of `docs/testing-strategy.md` §4 and is out of reach here.
 */

// ---------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------

const VideoHeroRender = (await RENDER_LOADERS["videoHero"]()).default;
const VideoRender = (await RENDER_LOADERS["video"]()).default;

/** Schema defaults, so each test states only what it varies. */
const DEFAULTS = {
    headline: "",
    subheadline: "",
    videoSrc: "",
    posterSrc: undefined as string | undefined,
    ctaText: "",
    ctaLink: "#",
    overlayOpacity: 0.4,
    overlayColorToken: "auto",
    headlineColorToken: "auto",
    subheadlineColorToken: "auto",
    muted: true,
    loop: true,
    blockWidth: "full",
};

function render(attrs: Partial<typeof DEFAULTS>): string {
    return renderToStaticMarkup(
        React.createElement(VideoHeroRender, { attrs: { ...DEFAULTS, ...attrs } }),
    );
}

function renderEditor(attrs: Partial<typeof DEFAULTS>): string {
    return renderToStaticMarkup(
        React.createElement(VideoHeroEditor, {
            node: { attrs: { ...DEFAULTS, ...attrs } },
            updateAttributes: () => {},
            editor: { storage: {} },
        } as never),
    );
}

/**
 * The first `src="…"` in the markup, entity-DECODED.
 *
 * React escapes `&` to `&amp;` in attribute values, which is correct HTML output — the
 * browser's parser hands the URL back with plain `&`. Asserting on the escaped form would
 * pin the serializer instead of the URL, and the background embed URL is the one place in
 * this slice where the parameter separators matter.
 */
function srcOf(html: string): string | null {
    const raw = /\ssrc="([^"]*)"/.exec(html)?.[1];
    return raw === undefined ? null : raw.replace(/&amp;/g, "&");
}

/** The inline `style="…"` of the first element that has one. */
function styleOf(html: string): string | null {
    return /\sstyle="([^"]*)"/.exec(html)?.[1] ?? null;
}

/**
 * Is a boolean/valued attribute present?
 *
 * CASE-INSENSITIVE deliberately, for the reason `vid-2`'s suite documents: `react-dom/server`
 * emits several DOM props in their camelCase React spelling (`autoPlay=""`, `playsInline=""`),
 * and HTML attribute names are ASCII case-insensitive (WHATWG HTML § 13.2.5), so a browser
 * reads them as `autoplay` / `playsinline`. A case-sensitive assertion would pin React's
 * serializer casing rather than the behaviour.
 */
function hasAttr(html: string, name: string): boolean {
    return new RegExp(`\\s${name}(=|\\s|>)`, "i").test(html);
}

// ---------------------------------------------------------------------------------------
// § Background element and src, one row per parser kind
//
// The executable form of `docs/plan-youtube-vimeo-embed.md` § Testing Checklist →
// "VideoHero Plugin" rows 1-4, and of the slice's Definition of Done items 1-3. `element` is
// the load-bearing column: before vid-3 EVERY non-empty `videoSrc` produced a `<video>`, so
// a YouTube URL rendered a media element pointed at an HTML page — no playback, no error,
// and the poster suppressed because a `<video>` existed.
// ---------------------------------------------------------------------------------------

interface OutputRow {
    note: string;
    videoSrc: string;
    kind: VideoSourceKind;
    element: "iframe" | "video" | "img";
    src: string;
}

const YT_BACKGROUND =
    "https://www.youtube.com/embed/dQw4w9WgXcQ" +
    "?autoplay=1&mute=1&loop=1&playlist=dQw4w9WgXcQ" +
    "&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3";

const OUTPUT: OutputRow[] = [
    {
        note: "youtube watch URL -> background iframe with the full background parameter set",
        videoSrc: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        kind: "youtube",
        element: "iframe",
        src: YT_BACKGROUND,
    },
    {
        note: "youtu.be short link -> the same background embed URL",
        videoSrc: "https://youtu.be/dQw4w9WgXcQ",
        kind: "youtube",
        element: "iframe",
        src: YT_BACKGROUND,
    },
    {
        note: "youtube shorts -> background iframe",
        videoSrc: "https://youtube.com/shorts/abc123xyz99",
        kind: "youtube",
        element: "iframe",
        src:
            "https://www.youtube.com/embed/abc123xyz99" +
            "?autoplay=1&mute=1&loop=1&playlist=abc123xyz99" +
            "&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3",
    },
    {
        note: "vimeo URL -> background iframe on Vimeo's own background mode",
        videoSrc: "https://vimeo.com/123456789",
        kind: "vimeo",
        element: "iframe",
        src: "https://player.vimeo.com/video/123456789?background=1",
    },
    {
        note: "vimeo player URL -> same, no double-embed",
        videoSrc: "https://player.vimeo.com/video/123456789",
        kind: "vimeo",
        element: "iframe",
        src: "https://player.vimeo.com/video/123456789?background=1",
    },
    {
        note: "direct .mp4 -> native <video> (existing behaviour preserved)",
        videoSrc: "https://cdn.example.com/clip.mp4",
        kind: "direct",
        element: "video",
        src: "https://cdn.example.com/clip.mp4",
    },
    {
        note: "direct .webm -> native <video>",
        videoSrc: "https://cdn.example.com/clip.webm",
        kind: "direct",
        element: "video",
        src: "https://cdn.example.com/clip.webm",
    },
    {
        note: "root-relative media-library path -> native <video>",
        videoSrc: "/uploads/clip.mp4",
        kind: "direct",
        element: "video",
        src: "/uploads/clip.mp4",
    },
    {
        note: "unrecognized URL -> poster image only, no media element (DoD 3)",
        videoSrc: "https://example.com/random-page",
        kind: "unknown",
        element: "img",
        src: "/poster.jpg",
    },
    {
        note: "empty videoSrc -> poster image only",
        videoSrc: "",
        kind: "unknown",
        element: "img",
        src: "/poster.jpg",
    },
];

describe("VideoHeroRender — background element and src per kind", () => {
    it.each(OUTPUT)("$note", ({ videoSrc, element, src }) => {
        const html = render({ videoSrc, posterSrc: "/poster.jpg" });

        expect(html).toContain(`<${element} `);
        // Exactly one background mechanism: the other two must be absent.
        for (const other of ["iframe", "video", "img"].filter((e) => e !== element)) {
            expect(html).not.toContain(`<${other} `);
        }
        expect(srcOf(html)).toBe(src);
    });

    it("covers all four parser kinds", () => {
        expect(new Set(OUTPUT.map((r) => r.kind))).toEqual(
            new Set(["youtube", "vimeo", "direct", "unknown"]),
        );
    });

    it("unknown with NO poster renders no background at all, not an empty element", () => {
        const html = render({ videoSrc: "https://example.com/random-page" });
        expect(html).not.toContain("<img ");
        expect(html).not.toContain("<video ");
        expect(html).not.toContain("<iframe ");
        // The hero itself still renders — the block is a text/CTA surface as well as a video
        // one, so an unrecognized URL must not blank the headline.
        expect(html).toContain("<section ");
    });
});

// ---------------------------------------------------------------------------------------
// § Background parameters, named individually
//
// The row assertions above compare whole URLs, which fails usefully but reads as one opaque
// diff. These name each parameter the Definition of Done names, so a regression says WHICH
// behaviour was lost.
// ---------------------------------------------------------------------------------------

describe("VideoHeroRender — YouTube background parameters (DoD 1)", () => {
    const src = srcOf(render({ videoSrc: "https://youtu.be/dQw4w9WgXcQ" })) ?? "";

    it.each([
        ["autoplays", "autoplay=1"],
        ["is muted — the precondition for autoplay in every current browser", "mute=1"],
        ["loops", "loop=1"],
        // Not decoration: YouTube's `loop=1` is inert on a single video. The player only
        // loops a PLAYLIST, so the documented workaround is a playlist naming the video
        // itself. Drop this and the hero plays once and freezes.
        ["names itself as the playlist, or loop=1 does nothing", "playlist=dQw4w9WgXcQ"],
        ["hides the player chrome", "controls=0"],
        ["plays inline — iOS Safari refuses inline autoplay without it", "playsinline=1"],
    ])("%s", (_note, param) => {
        expect(src).toContain(param);
    });
});

describe("VideoHeroRender — Vimeo background parameter (DoD 1)", () => {
    const src = srcOf(render({ videoSrc: "https://vimeo.com/123456789" })) ?? "";

    it("uses Vimeo's dedicated background mode, which subsumes the whole YouTube set", () => {
        expect(src).toBe("https://player.vimeo.com/video/123456789?background=1");
    });

    it("does not carry YouTube's parameter spelling", () => {
        expect(src).not.toContain("mute=1");
        expect(src).not.toContain("modestbranding");
    });
});

// ---------------------------------------------------------------------------------------
// § Cover geometry — the declarations, not the pixels
//
// An `<iframe>` is not a replaced element, so `object-fit: cover` does nothing to it: the
// provider letterboxes its 16:9 video inside whatever box we give it. Cover therefore has to
// be done by SIZING THE BOX, and these assert the emitted sizer. Whether the result visually
// covers a wide and a tall viewport is the operator's check (slice § Operator visual
// checklist) — this pins that the algorithm is present and unchanged.
// ---------------------------------------------------------------------------------------

describe("VideoHeroRender — iframe cover sizer (DoD 4, mechanism only)", () => {
    const style = styleOf(render({ videoSrc: "https://youtu.be/dQw4w9WgXcQ" })) ?? "";

    it.each([
        ["centres on both axes", "transform:translate(-50%, -50%)"],
        ["width is 16/9 of the viewport height", "width:177.7778vh"],
        ["height is the full viewport height", "height:100vh"],
        ["never narrower than the section", "min-width:100%"],
        ["never shorter than 9/16 of the viewport width", "min-height:56.25vw"],
    ])("%s", (_note, decl) => {
        expect(style).toContain(decl);
    });

    it("is click-through — a decorative background must not eat CTA clicks", () => {
        expect(style).toContain("pointer-events:none");
    });

    it("has no UA iframe border", () => {
        expect(style).toContain("border:0");
    });

    it("the native <video> path keeps object-cover and gains no inline sizer", () => {
        const html = render({ videoSrc: "/uploads/clip.mp4" });
        expect(html).toContain("object-cover");
        // Only the overlay div carries a style on this path.
        expect(styleOf(html)).toContain("background-color");
    });
});

// ---------------------------------------------------------------------------------------
// § Attributes the Definition of Done names explicitly
// ---------------------------------------------------------------------------------------

describe("VideoHeroRender — above-the-fold loading (DoD 6)", () => {
    it("the background iframe is NOT lazy — this is the top of the page", () => {
        expect(hasAttr(render({ videoSrc: "https://youtu.be/dQw4w9WgXcQ" }), "loading")).toBe(
            false,
        );
    });

    it("the native <video> carries no loading attribute either", () => {
        expect(hasAttr(render({ videoSrc: "/uploads/clip.mp4" }), "loading")).toBe(false);
    });

    it("contrast: the inline `video` block IS lazy, and stays that way", () => {
        // Cross-check, not duplication. The two blocks make OPPOSITE calls for the same
        // reason (position on the page), and a copy-paste between the render files would
        // silently break whichever one it landed in.
        const inline = renderToStaticMarkup(
            React.createElement(VideoRender, {
                attrs: { url: "https://youtu.be/dQw4w9WgXcQ", width: "centered" },
            }),
        );
        expect(inline).toContain('loading="lazy"');
    });
});

describe("VideoHeroRender — iframe accessibility", () => {
    it("has a non-empty accessible name", () => {
        expect(/\stitle="[^"]+"/.test(render({ videoSrc: "https://vimeo.com/123456789" }))).toBe(
            true,
        );
    });

    it("uses the author's headline as that name when present", () => {
        const html = render({
            videoSrc: "https://vimeo.com/123456789",
            headline: "Handmade in Bucharest",
        });
        expect(html).toContain('title="Handmade in Bucharest"');
    });

    it("falls back to a generic name when the hero has no headline", () => {
        expect(render({ videoSrc: "https://vimeo.com/123456789" })).toContain(
            'title="Background video"',
        );
    });

    it("declares the autoplay permission, without which the provider's autoplay=1 is ignored", () => {
        expect(render({ videoSrc: "https://youtu.be/dQw4w9WgXcQ" })).toContain("autoplay;");
    });
});

describe("VideoHeroRender — native <video> path is unchanged apart from its src", () => {
    it("autoplays, muted, looping, inline by default", () => {
        const html = render({ videoSrc: "/uploads/clip.mp4" });
        expect(hasAttr(html, "autoplay")).toBe(true);
        expect(hasAttr(html, "muted")).toBe(true);
        expect(hasAttr(html, "loop")).toBe(true);
        expect(hasAttr(html, "playsinline")).toBe(true);
    });

    it("still honours the author's muted/loop attributes", () => {
        // These two remain author-controlled on the native path — a `<video>` element can
        // obey them. They are NOT expressible on the provider path (see the editor's
        // "Muted + looped (embed)" note), so this pins that vid-3 did not quietly hardcode
        // them everywhere.
        const html = render({ videoSrc: "/uploads/clip.mp4", muted: false, loop: false });
        expect(hasAttr(html, "muted")).toBe(false);
        expect(hasAttr(html, "loop")).toBe(false);
        expect(hasAttr(html, "autoplay")).toBe(true);
    });

    it("keeps the poster as the pre-playback frame", () => {
        expect(render({ videoSrc: "/uploads/clip.mp4", posterSrc: "/p.jpg" })).toContain(
            'poster="/p.jpg"',
        );
    });
});

// ---------------------------------------------------------------------------------------
// § The tenant string never reaches an attribute unfiltered
//
// `docs/TECH-DEBT.md` § *vid-1 residuals* leaves this obligation to vid-2 and vid-3. It is a
// REAL change here, not a formality: before this slice `videoSrc` went straight into
// `<source src>` with no scheme check at all, so `javascript:…/clip.mp4` reached the
// attribute. The parser's scheme guard now stands in front of it.
// ---------------------------------------------------------------------------------------

describe("VideoHeroRender — hostile input degrades to the poster", () => {
    it.each([
        "javascript:alert(1)//clip.mp4",
        "vbscript:msgbox//clip.mp4",
        "data:text/html;base64,AAAA/clip.mp4",
        "file:///x.mp4",
        'https://example.com/"><script>alert(1)</script>',
        "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    ])("%j -> no media element, poster only", (videoSrc) => {
        const html = render({ videoSrc, posterSrc: "/poster.jpg" });
        expect(html).not.toContain("<video ");
        expect(html).not.toContain("<iframe ");
        expect(srcOf(html)).toBe("/poster.jpg");
    });

    it("a provider embed src contains nothing of the pasted string beyond the id", () => {
        const html = render({
            videoSrc: "https://m.youtube.com/watch?list=PLevil&v=dQw4w9WgXcQ&next=/evil",
        });
        expect(srcOf(html)).toBe(YT_BACKGROUND);
    });

    it("a headline is escaped, not interpreted, when it becomes the iframe title", () => {
        const html = render({
            videoSrc: "https://youtu.be/dQw4w9WgXcQ",
            headline: '"><script>alert(1)</script>',
        });
        expect(html).not.toContain("<script>");
        expect(html).toContain("&quot;&gt;&lt;script&gt;");
    });
});

// ---------------------------------------------------------------------------------------
// § Schema round-trip
//
// The slice's § Scope ends with "Schema unchanged (`videoSrc: string`)" — Option A of the
// plan, no normalized `VideoSourceSchema`. That is a NON-scope statement, and the cheapest
// way to keep it true is to assert it: a later slice that adds a provider field to the block
// has to change this test deliberately rather than drift into it.
// ---------------------------------------------------------------------------------------

describe("VideoHeroSchema — unchanged by vid-3", () => {
    it("videoSrc is a plain string defaulting to empty, with no provider companion fields", () => {
        const parsed = VideoHeroSchema.parse({});
        expect(parsed.videoSrc).toBe("");
        expect(Object.keys(parsed).sort()).toEqual(
            [
                "blockWidth",
                "ctaLink",
                "ctaText",
                "headline",
                "headlineColorToken",
                "loop",
                "muted",
                "overlayColorToken",
                "overlayOpacity",
                "subheadline",
                "subheadlineColorToken",
                "videoSrc",
            ].sort(),
        );
    });

    it("round-trips an embed URL as an opaque string — no normalization on save", () => {
        const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        expect(VideoHeroSchema.parse({ videoSrc: url }).videoSrc).toBe(url);
    });

    it("round-trips an unrecognized URL too — validation is warning-only, never blocking", () => {
        const url = "https://example.com/random-page";
        expect(VideoHeroSchema.parse({ videoSrc: url }).videoSrc).toBe(url);
    });
});

// ---------------------------------------------------------------------------------------
// § Editor surfaces
//
// The counterpart to "unknown falls back to the poster": the page degrades silently, so the
// author's only signal that a URL is wrong is here.
// ---------------------------------------------------------------------------------------

const WARNING_COPY = "not recognized as YouTube, Vimeo, or an uploaded media file";

describe("VideoHeroEditor — tabbed source selector (DoD 5)", () => {
    it("offers exactly the three sources the plan names", () => {
        const html = renderEditor({});
        for (const label of ["Upload", "Library", "Embed"]) {
            expect(html).toContain(label);
        }
        expect(html.match(/role="tab"/g)).toHaveLength(3);
    });

    it("opens on Upload for an empty block", () => {
        // `aria-selected` is the assertion target rather than a class, because it is the
        // contract an assistive technology reads — the styling is free to change.
        const html = renderEditor({});
        expect(html).toMatch(/aria-selected="true"[^>]*>[^<]*<svg[^>]*>.*?<\/svg>Upload/s);
    });

    it("opens on Embed when the stored value is already a provider URL", () => {
        const html = renderEditor({ videoSrc: "https://youtu.be/dQw4w9WgXcQ" });
        expect(html).toMatch(/aria-selected="true"[^>]*>[^<]*<svg[^>]*>.*?<\/svg>Embed/s);
    });

    it("opens on Upload for a stored media file — Embed would be the wrong control", () => {
        const html = renderEditor({ videoSrc: "/uploads/clip.mp4" });
        expect(html).toMatch(/aria-selected="true"[^>]*>[^<]*<svg[^>]*>.*?<\/svg>Upload/s);
    });
});

describe("VideoHeroEditor — provider detection and failure state", () => {
    it.each([
        ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "YouTube"],
        ["vimeo", "https://vimeo.com/123456789", "Vimeo"],
        ["direct", "https://cdn.example.com/clip.mp4", "Media file"],
    ])("%s shows its labelled indicator and no warning", (_kind, videoSrc, label) => {
        const html = renderEditor({ videoSrc });
        expect(html).toContain(`<span>${label}</span>`);
        expect(html).not.toContain(WARNING_COPY);
    });

    it("distinguishes YouTube from Vimeo by icon SHAPE, since colour is not allowed to", () => {
        expect(renderEditor({ videoSrc: "https://youtu.be/dQw4w9WgXcQ" })).toContain(
            "lucide-youtube",
        );
        expect(renderEditor({ videoSrc: "https://vimeo.com/123456789" })).not.toContain(
            "lucide-youtube",
        );
    });

    it("warns on a non-empty unrecognized URL, and says what will actually happen", () => {
        const html = renderEditor({ videoSrc: "https://example.com/random-page" });
        expect(html).toContain(WARNING_COPY);
        // The consequence differs from the inline `video` block's — the hero does not vanish,
        // it falls back to the poster — so the copy must not be copied from there.
        expect(html).toContain("will show the poster image instead");
        expect(html).toContain('role="status"');
    });

    it("an empty block is unfinished, not wrong — no indicator, no warning", () => {
        const html = renderEditor({});
        expect(html).not.toContain(WARNING_COPY);
        for (const label of ["YouTube", "Vimeo", "Media file"]) {
            expect(html).not.toContain(`<span>${label}</span>`);
        }
    });

    it("uses theme tokens for the markup vid-3 adds (Critical Rule 6)", () => {
        // Scoped to the new surfaces. The surrounding `border-gray-200` / `bg-white` /
        // violet chrome is the shared visual language of every plugin editor in the package
        // and is recorded in docs/TECH-DEBT.md § vid-2 residuals; this asserts vid-3 did not
        // ADD to it.
        const html = renderEditor({ videoSrc: "https://example.com/random-page" });
        expect(html).toContain("border border-border bg-muted p-2 text-xs text-muted-foreground");
        expect(html).toContain("rounded-md bg-muted p-0.5"); // tab strip
        expect(html).not.toContain("amber");
        expect(html).not.toContain("bg-red-");
        expect(html).not.toContain("text-red-");
    });
});

describe("VideoHeroEditor — preview reflects what is STORED", () => {
    it("YouTube gets a real thumbnail, derived from the validated id", () => {
        expect(renderEditor({ videoSrc: "https://youtu.be/dQw4w9WgXcQ" })).toContain(
            'src="https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"',
        );
    });

    it("Vimeo gets an id-labelled placeholder — no static thumbnail exists without oEmbed", () => {
        const html = renderEditor({ videoSrc: "https://vimeo.com/123456789" });
        expect(html).not.toContain("img.youtube.com");
        expect(html).toContain("123456789");
    });

    it("a media file gets a native <video> preview", () => {
        expect(renderEditor({ videoSrc: "/uploads/clip.mp4" })).toContain(
            '<video src="/uploads/clip.mp4"',
        );
    });

    it("an unrecognized URL gets NO preview element — it would be a broken image", () => {
        const html = renderEditor({ videoSrc: "https://example.com/random-page" });
        expect(html).toContain("No background video");
        expect(html).not.toContain("img.youtube.com");
    });
});

describe("VideoHeroEditor — muted/loop controls tell the truth", () => {
    it("are offered on the native path, where the element can obey them", () => {
        const html = renderEditor({ videoSrc: "/uploads/clip.mp4" });
        expect(html).toContain("Muted");
        expect(html).toContain("Loop");
        expect(html).not.toContain("Muted + looped (embed)");
    });

    it("are replaced by a statement of fact on the embed path, where they are inert", () => {
        // `buildBackgroundEmbedUrl` hardcodes mute+loop for both providers, so leaving the
        // checkboxes enabled would be a control that silently does nothing — a
        // name-vs-behaviour mismatch in the UI, not merely a cosmetic one.
        const html = renderEditor({ videoSrc: "https://youtu.be/dQw4w9WgXcQ" });
        expect(html).toContain("Muted + looped (embed)");
        expect(html).not.toContain("type=\"checkbox\"");
    });
});
