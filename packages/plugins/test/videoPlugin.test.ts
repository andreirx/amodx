import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RENDER_LOADERS } from "../src/render";
import { VideoEditor } from "../src/video/VideoEditor";
import type { VideoSourceKind } from "../src/common/videoSource";

/**
 * slice `vid-2` — the `video` plugin's two surfaces, asserted as OUTPUT.
 *
 * `vid-1` pinned the parser's classification. This file pins what each classification
 * actually EMITS, which is the thing a tenant page and a tenant author see. The two are
 * genuinely separable failures: the parser can return `kind: "direct"` correctly while the
 * render still puts that URL in an `<iframe>` — which is precisely the defect vid-2 retires.
 *
 * ## Why this needs no DOM harness
 *
 * `packages/plugins/ARCHITECTURE.md` § Tests says the plugin components need a DOM/RTL
 * harness (`docs/testing-strategy.md` §4) that does not exist. That is true for INTERACTION.
 * It is not true for output: `renderToStaticMarkup` is `react-dom/server`, the same code path
 * the renderer's SSR uses, and it needs no `window`, no jsdom, and no new dependency
 * (`react-dom` 19.2.3 is already installed as a peer). So this suite stays in the
 * `environment: "node"` run and stays credential-free.
 *
 * `VideoEditor` renders under it too — `NodeViewWrapper` degrades to a plain `<div>` with no
 * editor context, and the component reads only `props.node.attrs`. What is asserted here is
 * therefore the editor's STATIC output for a given URL, not its typing behaviour; the
 * `onChange` wiring is unchanged by this slice and is out of this suite's reach.
 *
 * ## Why through RENDER_LOADERS rather than the component
 *
 * `src/render.ts` is the entry point the renderer imports (`@amodx/plugins/render`). Going
 * through `RENDER_LOADERS["video"]` (the perf-1 lazy registry) asserts the wiring as well as
 * the component, and `await`ing the thunk in a `node` environment loads the `video` render
 * module with no DOM — so a top-level `window` reference in THAT module fails this file.
 * Scope note: after perf-1 the loaders are lazy, so this only exercises the `video` module,
 * NOT the whole render entry — the entry-wide module-load SSR check lives in
 * `test/renderLoaders.test.ts`, which `await`s every loader.
 */

// ---------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------

const VideoRender = (await RENDER_LOADERS["video"]()).default;

interface VideoAttrs {
    url: string;
    caption?: string | null;
    width?: "centered" | "wide" | "full";
    autoplay?: boolean;
}

/** Schema defaults (`src/video/schema.ts`) so each test states only what it varies. */
function render(attrs: Partial<VideoAttrs> & { url: string }): string {
    return renderToStaticMarkup(
        React.createElement(VideoRender, {
            attrs: { caption: null, width: "centered", autoplay: false, ...attrs },
        }),
    );
}

function renderEditor(url: string): string {
    return renderToStaticMarkup(
        React.createElement(VideoEditor, {
            node: { attrs: { url, caption: null, blockWidth: "content" } },
            updateAttributes: () => {},
        } as never),
    );
}

/** First `src="..."` in the markup, or null. Assertions want the value, not the substring. */
function srcOf(html: string): string | null {
    return /\ssrc="([^"]*)"/.exec(html)?.[1] ?? null;
}

/**
 * Is a boolean/valued attribute present?
 *
 * CASE-INSENSITIVE deliberately. `react-dom/server` serializes several DOM props in their
 * camelCase React spelling — this render emits `autoPlay=""`, `playsInline=""` and
 * `allowFullScreen=""` — and that is correct output: HTML attribute names are ASCII
 * case-insensitive (WHATWG HTML § 13.2.5 tokenizer), so a browser reads them as `autoplay`,
 * `playsinline`, `allowfullscreen`. A case-SENSITIVE assertion here would pin React's
 * serializer casing rather than the behaviour, and would flip on a React upgrade that
 * changed nothing observable.
 */
function hasAttr(html: string, name: string): boolean {
    return new RegExp(`\\s${name}(=|\\s|>)`, "i").test(html);
}

// ---------------------------------------------------------------------------------------
// § Rendered output, one row per parser kind
//
// This table is the executable form of `docs/plan-youtube-vimeo-embed.md` § Testing Checklist
// → "Video Plugin (Inline)", and of the slice's Definition of Done items 1-4. `element` is
// the load-bearing column: `iframe` vs `video` vs nothing is the whole point of the four-way
// split, and it is what regressed before.
// ---------------------------------------------------------------------------------------

interface OutputRow {
    note: string;
    url: string;
    kind: VideoSourceKind;
    element: "iframe" | "video" | null;
    src: string | null;
}

const OUTPUT: OutputRow[] = [
    {
        note: "youtube watch URL -> iframe on the canonical embed origin",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        kind: "youtube",
        element: "iframe",
        src: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    },
    {
        note: "youtu.be short link -> same embed URL (no double-embed)",
        url: "https://youtu.be/dQw4w9WgXcQ",
        kind: "youtube",
        element: "iframe",
        src: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    },
    {
        note: "youtube shorts -> iframe",
        url: "https://youtube.com/shorts/abc123xyz99",
        kind: "youtube",
        element: "iframe",
        src: "https://www.youtube.com/embed/abc123xyz99",
    },
    {
        note: "vimeo standard URL -> player iframe",
        url: "https://vimeo.com/123456789",
        kind: "vimeo",
        element: "iframe",
        src: "https://player.vimeo.com/video/123456789",
    },
    {
        note: "vimeo player URL -> passthrough iframe",
        url: "https://player.vimeo.com/video/123456789",
        kind: "vimeo",
        element: "iframe",
        src: "https://player.vimeo.com/video/123456789",
    },
    {
        note: "direct .mp4 -> native <video>, NOT an iframe (the vid-2 defect fix)",
        url: "https://cdn.example.com/clip.mp4",
        kind: "direct",
        element: "video",
        src: "https://cdn.example.com/clip.mp4",
    },
    {
        note: "direct .webm -> native <video>",
        url: "https://cdn.example.com/clip.webm",
        kind: "direct",
        element: "video",
        src: "https://cdn.example.com/clip.webm",
    },
    {
        note: "root-relative media-library path -> native <video>",
        url: "/uploads/clip.mp4",
        kind: "direct",
        element: "video",
        src: "/uploads/clip.mp4",
    },
    {
        note: "unrecognized URL -> nothing at all, not a broken iframe",
        url: "https://example.com/random-page",
        kind: "unknown",
        element: null,
        src: null,
    },
    {
        note: "empty URL -> nothing",
        url: "",
        kind: "unknown",
        element: null,
        src: null,
    },
];

describe("VideoRender — element and src per kind", () => {
    it.each(OUTPUT)("$note", ({ url, element, src }) => {
        const html = render({ url });

        if (element === null) {
            // Stronger than "no iframe": the block must contribute NO markup, so an
            // unrecognized URL cannot leave an empty 16:9 black box on a public page.
            expect(html).toBe("");
            return;
        }

        expect(html).toContain(`<${element} `);
        // Exactly one media element, and not the other one.
        const other = element === "iframe" ? "video" : "iframe";
        expect(html).not.toContain(`<${other} `);
        expect(srcOf(html)).toBe(src);
    });

    it("covers all four parser kinds", () => {
        expect(new Set(OUTPUT.map((r) => r.kind))).toEqual(
            new Set(["youtube", "vimeo", "direct", "unknown"]),
        );
    });
});

// ---------------------------------------------------------------------------------------
// § Attributes the Definition of Done names explicitly
// ---------------------------------------------------------------------------------------

describe("VideoRender — iframe attributes (DoD 4)", () => {
    it("carries loading=lazy and a non-empty title", () => {
        const html = render({ url: "https://youtu.be/dQw4w9WgXcQ" });
        expect(html).toContain('loading="lazy"');
        expect(/\stitle="[^"]+"/.test(html)).toBe(true);
    });

    it("uses the author's caption as the accessible name when present", () => {
        const html = render({
            url: "https://youtu.be/dQw4w9WgXcQ",
            caption: "Founder interview",
        });
        expect(html).toContain('title="Founder interview"');
    });

    it("keeps allowFullScreen and the provider permissions policy", () => {
        const html = render({ url: "https://vimeo.com/123456789" });
        expect(hasAttr(html, "allowfullscreen")).toBe(true);
        expect(html).toContain("encrypted-media");
    });
});

describe("VideoRender — native <video> attributes", () => {
    const html = render({ url: "https://cdn.example.com/clip.mp4" });

    it("is playable: controls are present", () => {
        expect(hasAttr(html, "controls")).toBe(true);
    });

    it("does NOT carry loading=lazy — that attribute is iframe-only here (DoD 4)", () => {
        expect(hasAttr(html, "loading")).toBe(false);
    });

    it("does not autoplay by default (schema default is false)", () => {
        expect(hasAttr(html, "autoplay")).toBe(false);
        expect(hasAttr(html, "muted")).toBe(false);
    });
});

describe("VideoRender — the autoplay attribute survives vid-2", () => {
    // Pre-vid-2 the block appended `?autoplay=0|1` to the YouTube embed by hand. That
    // behaviour is preserved, now spelled by `buildEmbedUrl`; dropping it would be a silent
    // functional regression on any existing block that has the flag set.
    it("YouTube: emits the provider parameter only when the flag is on", () => {
        expect(srcOf(render({ url: "https://youtu.be/dQw4w9WgXcQ", autoplay: true }))).toBe(
            "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1",
        );
        expect(srcOf(render({ url: "https://youtu.be/dQw4w9WgXcQ", autoplay: false }))).toBe(
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
        );
    });

    it("Vimeo: same flag, the provider's own spelling", () => {
        expect(srcOf(render({ url: "https://vimeo.com/123456789", autoplay: true }))).toBe(
            "https://player.vimeo.com/video/123456789?autoplay=1",
        );
    });

    it("direct: autoplay implies muted+playsInline, or the browser blocks it outright", () => {
        const html = render({ url: "https://cdn.example.com/clip.mp4", autoplay: true });
        expect(hasAttr(html, "autoplay")).toBe(true);
        expect(hasAttr(html, "muted")).toBe(true);
        expect(hasAttr(html, "playsinline")).toBe(true);
    });
});

describe("VideoRender — width variants are unchanged by vid-2", () => {
    it.each([
        ["centered", "max-w-4xl"],
        ["wide", "max-w-6xl"],
        ["full", "w-full"],
    ] as const)("width=%s keeps its container class", (width, cls) => {
        expect(render({ url: "https://youtu.be/dQw4w9WgXcQ", width })).toContain(cls);
    });
});

// ---------------------------------------------------------------------------------------
// § The tenant string never reaches an attribute unfiltered
//
// `docs/TECH-DEBT.md` § vid-1 residuals makes this vid-2's obligation, not the parser's:
// the scheme guard is defence in depth, and for `kind: "direct"` the parser hands back the
// raw URL byte for byte. These rows assert the END-TO-END result at the render boundary,
// which is the only place the claim is actually testable.
// ---------------------------------------------------------------------------------------

describe("VideoRender — hostile input renders nothing", () => {
    it.each([
        "javascript:alert(1)//clip.mp4",
        "vbscript:msgbox//clip.mp4",
        "data:text/html;base64,AAAA/clip.mp4",
        "file:///x.mp4",
        'https://example.com/"><script>alert(1)</script>',
        "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    ])("%j -> no element", (url) => {
        expect(render({ url })).toBe("");
    });

    it("a caption is escaped, not interpreted, when it becomes the iframe title", () => {
        const html = render({
            url: "https://youtu.be/dQw4w9WgXcQ",
            caption: '"><script>alert(1)</script>',
        });
        expect(html).not.toContain("<script>");
        expect(html).toContain("&quot;&gt;&lt;script&gt;");
    });

    it("a provider embed src contains nothing of the pasted string beyond the id", () => {
        // The id is re-emitted into a template; everything else — host, path, query — is
        // discarded by `buildEmbedUrl`.
        const html = render({
            url: "https://m.youtube.com/watch?list=PLevil&v=dQw4w9WgXcQ&next=/evil",
        });
        expect(srcOf(html)).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    });
});

// ---------------------------------------------------------------------------------------
// § Editor-side failure state
//
// The counterpart to "unknown renders nothing": the author's ONLY signal that a URL is bad
// is here, so its absence would be a silent failure end to end.
// ---------------------------------------------------------------------------------------

// The author-visible COPY is the contract here, so these assert on the copy rather than on a
// test-only `data-` hook: a silent rewording of the warning is exactly the regression worth
// catching, and adding an attribute to production markup purely to be gripped by a test would
// have been a seam the copy already provides.
const WARNING_COPY = "not recognized as YouTube or Vimeo";

describe("VideoEditor — provider indicator and warning callout", () => {
    it.each([
        ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "YouTube"],
        ["vimeo", "https://vimeo.com/123456789", "Vimeo"],
        ["direct", "https://cdn.example.com/clip.mp4", "Media file"],
    ])("%s URL shows its labelled indicator and no warning", (_kind, url, label) => {
        const html = renderEditor(url);
        expect(html).toContain(`<span>${label}</span>`);
        expect(html).not.toContain(WARNING_COPY);
    });

    it("an unrecognized non-empty URL shows the warning callout", () => {
        const html = renderEditor("https://example.com/random-page");
        expect(html).toContain(WARNING_COPY);
        // The callout must say what will actually HAPPEN, because what happens is nothing
        // visible — see VideoRender's `unknown` branch. "May not render correctly" would
        // understate it.
        expect(html).toContain("will not render on the published page");
        expect(html).toContain('role="status"');
    });

    it("an empty URL is unfinished, not wrong — no indicator, no warning", () => {
        const html = renderEditor("");
        expect(html).not.toContain(WARNING_COPY);
        for (const label of ["YouTube", "Vimeo", "Media file"]) {
            expect(html).not.toContain(`<span>${label}</span>`);
        }
    });

    it("distinguishes YouTube from Vimeo by icon SHAPE, since colour is not allowed to", () => {
        expect(renderEditor("https://youtu.be/dQw4w9WgXcQ")).toContain("lucide-youtube");
        expect(renderEditor("https://vimeo.com/123456789")).not.toContain("lucide-youtube");
    });

    it("uses theme tokens only for the indicator and callout (Critical Rule 6)", () => {
        // Scoped to the markup vid-2 owns. The surviving `focus:border-red-500` on the shared
        // `Input` and the `bg-gray-*` chrome are pre-existing and recorded in
        // docs/TECH-DEBT.md; this asserts the slice did not ADD to them.
        const html = renderEditor("https://example.com/random-page");
        expect(html).toContain("border border-border bg-muted p-2 text-xs text-muted-foreground");
        expect(html).toContain("bg-muted text-muted-foreground"); // header badge
        expect(html).not.toContain("amber");
        expect(html).not.toContain("bg-red-");
        expect(html).not.toContain("text-red-");
    });
});
