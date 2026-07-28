import { describe, it, expect } from "vitest";
import {
    buildBackgroundEmbedUrl,
    buildEmbedUrl,
    isDirectMediaUrl,
    parseVideoSource,
    type ParsedVideoSource,
    type VideoSourceKind,
} from "../src/common/videoSource";

/**
 * slice `vid-1` — `src/common/videoSource.ts` is the SINGLE classifier that `vid-2`
 * (`video`) and `vid-3` (`video-hero`) will both branch on. A silent change to the
 * four-way split changes what element two render paths emit, on every tenant page that
 * carries a video block, and nothing else in the estate would fail first. These tests
 * therefore pin the CLASSIFICATION and the EMITTED URL, which is what a consumer depends
 * on — not the module's internal shape.
 *
 * Imports `../src/common/videoSource` (extensionless, the style this package's own sources
 * use). Deliberately NOT `dist/`: a stale build must not read as a passing contract.
 *
 * Pure by construction — the module under test has no imports at all. No AWS, no network,
 * no environment read, no DOM. See `docs/testing-strategy.md` §1 and §7.
 */

// ---------------------------------------------------------------------------------------
// § The plan's Testing Checklist, executable
//
// One row per bullet of the original ten in `docs/plan-youtube-vimeo-embed.md` § "Parser
// Unit Tests". The checklist fixes `kind` (and, for four rows, `providerId` / `embedUrl`);
// the `embedUrl` column here additionally pins the exact string, because that value is what
// reaches an `src` attribute and "kind is right but the URL is wrong" is a defect the
// checklist alone would not catch.
//
// The four bullets that checklist gained from the 2026-07-28 scheme amendment are pinned in
// § isDirectMediaUrl below, next to the guard they exercise, rather than here — the count
// assertion on this table is what proves the ORIGINAL checklist is covered in full.
// ---------------------------------------------------------------------------------------

interface ChecklistRow {
    /** The bullet's stated intent, used as the test name. */
    note: string;
    input: string;
    kind: VideoSourceKind;
    providerId: string | undefined;
    embedUrl: string | null;
}

const CHECKLIST: ChecklistRow[] = [
    {
        note: "youtube watch URL",
        input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        kind: "youtube",
        providerId: "dQw4w9WgXcQ",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    },
    {
        note: "youtu.be short link",
        input: "https://youtu.be/dQw4w9WgXcQ",
        kind: "youtube",
        providerId: "dQw4w9WgXcQ",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    },
    {
        note: "youtube shorts, no www",
        input: "https://youtube.com/shorts/abc123xyz99",
        kind: "youtube",
        providerId: "abc123xyz99",
        embedUrl: "https://www.youtube.com/embed/abc123xyz99",
    },
    {
        note: "youtube embed passthrough (no double-embed)",
        input: "https://www.youtube.com/embed/dQw4w9WgXcQ",
        kind: "youtube",
        providerId: "dQw4w9WgXcQ",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    },
    {
        note: "vimeo standard URL",
        input: "https://vimeo.com/123456789",
        kind: "vimeo",
        providerId: "123456789",
        embedUrl: "https://player.vimeo.com/video/123456789",
    },
    {
        note: "vimeo player passthrough",
        input: "https://player.vimeo.com/video/123456789",
        kind: "vimeo",
        providerId: "123456789",
        embedUrl: "https://player.vimeo.com/video/123456789",
    },
    {
        note: "direct .mp4",
        input: "https://example.com/video.mp4",
        kind: "direct",
        providerId: undefined,
        embedUrl: "https://example.com/video.mp4",
    },
    {
        note: "direct .webm, query params ignored",
        input: "https://example.com/video.webm?token=abc",
        kind: "direct",
        providerId: undefined,
        embedUrl: "https://example.com/video.webm?token=abc",
    },
    {
        note: "unrecognized page",
        input: "https://example.com/random-page",
        kind: "unknown",
        providerId: undefined,
        embedUrl: null,
    },
    {
        note: "empty string",
        input: "",
        kind: "unknown",
        providerId: undefined,
        embedUrl: null,
    },
];

describe("plan checklist — parseVideoSource", () => {
    it.each(CHECKLIST)(
        "$note: $input -> $kind",
        ({ input, kind, providerId, embedUrl }) => {
            const parsed = parseVideoSource(input);
            expect(parsed.kind).toBe(kind);
            expect(parsed.providerId).toBe(providerId);
            expect(parsed.embedUrl).toBe(embedUrl);
            // `rawUrl` is the contract for editor UI echo-back: always the caller's input.
            expect(parsed.rawUrl).toBe(input);
        },
    );

    it("covers every row of the plan's original checklist (10 rows)", () => {
        expect(CHECKLIST).toHaveLength(10);
    });

    it("produces all four kinds — the split is real, not a two-way split in disguise", () => {
        const kinds = new Set(CHECKLIST.map((r) => parseVideoSource(r.input).kind));
        expect([...kinds].sort()).toEqual(["direct", "unknown", "vimeo", "youtube"]);
    });
});

// ---------------------------------------------------------------------------------------
// § Invariants the checklist does not reach
// ---------------------------------------------------------------------------------------

describe("parseVideoSource — YouTube", () => {
    it("reads v= from anywhere in the query, not only first position", () => {
        const parsed = parseVideoSource(
            "https://www.youtube.com/watch?list=PLabcdefgh&index=2&v=dQw4w9WgXcQ",
        );
        expect(parsed.kind).toBe("youtube");
        expect(parsed.providerId).toBe("dQw4w9WgXcQ");
    });

    it("keeps m. and other subdomains", () => {
        expect(parseVideoSource("https://m.youtube.com/watch?v=dQw4w9WgXcQ").kind).toBe(
            "youtube",
        );
    });

    it("accepts ids using the full URL-safe alphabet (_ and -)", () => {
        const parsed = parseVideoSource("https://youtu.be/a_b-c_d-e_f"); // exactly 11 chars
        expect(parsed.kind).toBe("youtube");
        expect(parsed.providerId).toBe("a_b-c_d-e_f");
    });

    it.each([
        ["too short", "https://www.youtube.com/watch?v=short"],
        ["too long", "https://www.youtube.com/watch?v=dQw4w9WgXcQxx"],
        ["v= present but empty", "https://www.youtube.com/watch?v="],
        ["shorts with no id", "https://youtube.com/shorts/"],
    ])("rejects a malformed id (%s) rather than emitting a dead embed", (_label, url) => {
        const parsed = parseVideoSource(url);
        expect(parsed.kind).toBe("unknown");
        expect(parsed.embedUrl).toBeNull();
    });

    it.each([
        ["prefix-confusion host", "https://notyoutube.com/watch?v=dQw4w9WgXcQ"],
        ["suffix-confusion host", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"],
        ["youtube string in the path only", "https://example.com/youtube.com/watch?v=dQw4w9WgXcQ"],
    ])("does not treat %s as YouTube", (_label, url) => {
        expect(parseVideoSource(url).kind).toBe("unknown");
    });

    it("does not yet handle youtube.com/live/ or the legacy /v/ form (documented residual)", () => {
        expect(parseVideoSource("https://www.youtube.com/live/dQw4w9WgXcQ").kind).toBe(
            "unknown",
        );
        expect(parseVideoSource("https://www.youtube.com/v/dQw4w9WgXcQ").kind).toBe("unknown");
    });
});

describe("parseVideoSource — Vimeo", () => {
    it("accepts www.vimeo.com", () => {
        expect(parseVideoSource("https://www.vimeo.com/123456789").kind).toBe("vimeo");
    });

    it("classifies an unlisted-video privacy-hash URL as unknown, not a 404 embed", () => {
        // `?h=` is required for these to play; the module does not model it, so it must not
        // claim the URL. Documented residual (docs/TECH-DEBT.md).
        expect(parseVideoSource("https://vimeo.com/123456789/abcdef1234").kind).toBe("unknown");
    });

    it("does not treat a non-numeric vimeo path as a video", () => {
        expect(parseVideoSource("https://vimeo.com/channels/staffpicks").kind).toBe("unknown");
    });
});

describe("isDirectMediaUrl", () => {
    it.each(["mp4", "webm", "mov", "m4v", "ogg"])(
        "recognizes .%s",
        (ext) => {
            expect(isDirectMediaUrl(`https://cdn.example.com/clip.${ext}`)).toBe(true);
        },
    );

    it("is case-insensitive on the extension", () => {
        expect(isDirectMediaUrl("https://cdn.example.com/CLIP.MP4")).toBe(true);
    });

    it("ignores query and fragment (presigned S3 URLs keep working)", () => {
        expect(
            isDirectMediaUrl(
                "https://bucket.s3.amazonaws.com/a/clip.mp4?X-Amz-Signature=deadbeef&X-Amz-Expires=900",
            ),
        ).toBe(true);
        expect(isDirectMediaUrl("https://cdn.example.com/clip.mov#t=10")).toBe(true);
    });

    it("accepts a root-relative media-library path", () => {
        expect(isDirectMediaUrl("/uploads/clip.mp4")).toBe(true);
    });

    it("does not match an extension that appears only in the query", () => {
        expect(isDirectMediaUrl("https://example.com/download?file=clip.mp4")).toBe(false);
    });

    it("does not match a non-media extension", () => {
        expect(isDirectMediaUrl("https://example.com/clip.mp3")).toBe(false);
        expect(isDirectMediaUrl("https://example.com/page.html")).toBe(false);
    });

    // -----------------------------------------------------------------------------------
    // Scheme guard — RATIFIED contract amendment, 2026-07-28 (decision
    // VID1-DIRECT-SCHEME-CONTRACT). `direct` additionally requires an http(s) or absent
    // scheme; see docs/plan-youtube-vimeo-embed.md § Phase 1 rule 3 and the slice doc
    // § Scope. These rows are the executable form of that amendment: a string ending in a
    // media extension must never classify as `direct` merely because of the extension.
    //
    // DISCRIMINATING means: the URI's PATH ends in a media extension, so
    // DIRECT_MEDIA_EXT_RE matches and the scheme guard is the only thing rejecting it.
    // Deleting the guard flips exactly these rows — that is what makes them a real test of
    // it rather than an incidental pass. The non-discriminating row is kept and labelled,
    // because it is the shape an attacker would reach for first and a future refactor that
    // widened the extension test to the whole string would need it.
    // -----------------------------------------------------------------------------------
    it.each([
        ["javascript, path ends .mp4", "javascript:alert(1)//clip.mp4", true],
        ["vbscript, path ends .mp4", "vbscript:msgbox//clip.mp4", true],
        ["data, path ends .mp4", "data:text/html;base64,AAAA/clip.mp4", true],
        ["file, path ends .mp4", "file:///x.mp4", true],
        // Not discriminating: path is `video/mp4;base64,AAAA`, which does not END in
        // `.mp4`, so the extension test rejects this one with or without the guard.
        ["data, mp4 only in the media type", "data:video/mp4;base64,AAAA", false],
    ])(
        "rejects non-http(s) scheme — %s (the value would land in a <video src>)",
        (_label, url) => {
            expect(isDirectMediaUrl(url)).toBe(false);
            expect(parseVideoSource(url).kind).toBe("unknown");
            expect(parseVideoSource(url).embedUrl).toBeNull();
        },
    );

    it("still accepts the schemes a media library actually produces", () => {
        // The amendment tightens an unspecified region; it must not have narrowed the
        // legitimate inputs. Absent scheme (relative + root-relative), scheme-relative,
        // http and https all remain `direct`.
        for (const url of [
            "clip.mp4",
            "/uploads/clip.mp4",
            "//cdn.example.com/clip.mp4",
            "http://cdn.example.com/clip.mp4",
            "https://cdn.example.com/clip.mp4",
        ]) {
            expect(isDirectMediaUrl(url)).toBe(true);
            expect(parseVideoSource(url).kind).toBe("direct");
        }
    });
});

describe("buildEmbedUrl", () => {
    it("with no options equals what parseVideoSource emits", () => {
        expect(buildEmbedUrl("youtube", "dQw4w9WgXcQ")).toBe(
            parseVideoSource("https://youtu.be/dQw4w9WgXcQ").embedUrl,
        );
        expect(buildEmbedUrl("vimeo", "123456789")).toBe(
            parseVideoSource("https://vimeo.com/123456789").embedUrl,
        );
    });

    it("emits nothing for an empty options object (flags are opt-in)", () => {
        expect(buildEmbedUrl("youtube", "dQw4w9WgXcQ", {})).toBe(
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
        );
    });

    it("emits controls=0 only when controls is explicitly false", () => {
        expect(buildEmbedUrl("youtube", "dQw4w9WgXcQ", { controls: true })).not.toContain(
            "controls",
        );
        expect(buildEmbedUrl("youtube", "dQw4w9WgXcQ", { controls: false })).toContain(
            "controls=0",
        );
    });

    it("pairs YouTube loop=1 with playlist={id} — loop alone is inert in the player", () => {
        const url = buildEmbedUrl("youtube", "dQw4w9WgXcQ", { loop: true });
        expect(url).toContain("loop=1");
        expect(url).toContain("playlist=dQw4w9WgXcQ");
    });

    it("uses each provider's own mute parameter name (YouTube mute, Vimeo muted)", () => {
        expect(buildEmbedUrl("youtube", "dQw4w9WgXcQ", { muted: true })).toContain("mute=1");
        expect(buildEmbedUrl("vimeo", "123456789", { muted: true })).toContain("muted=1");
    });

    it("honours background only for Vimeo — YouTube has no equivalent parameter", () => {
        expect(buildEmbedUrl("vimeo", "123456789", { background: true })).toContain(
            "background=1",
        );
        expect(buildEmbedUrl("youtube", "dQw4w9WgXcQ", { background: true })).not.toContain(
            "background",
        );
    });

    it("builds a full inline option set", () => {
        expect(
            buildEmbedUrl("youtube", "dQw4w9WgXcQ", {
                autoplay: true,
                muted: true,
                controls: false,
            }),
        ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&controls=0");
    });
});

describe("buildBackgroundEmbedUrl", () => {
    it("emits the plan's exact YouTube background parameter set", () => {
        expect(buildBackgroundEmbedUrl("youtube", "dQw4w9WgXcQ")).toBe(
            "https://www.youtube.com/embed/dQw4w9WgXcQ" +
                "?autoplay=1&mute=1&loop=1&playlist=dQw4w9WgXcQ" +
                "&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3",
        );
    });

    it("emits Vimeo's dedicated background mode", () => {
        expect(buildBackgroundEmbedUrl("vimeo", "123456789")).toBe(
            "https://player.vimeo.com/video/123456789?background=1",
        );
    });

    it("keeps playsinline — without it iOS refuses inline autoplay and goes fullscreen", () => {
        expect(buildBackgroundEmbedUrl("youtube", "dQw4w9WgXcQ")).toContain("playsinline=1");
    });
});

describe("total function contract", () => {
    const ADVERSARIAL = [
        "",
        "   ",
        "not a url at all",
        "://///",
        "https://",
        "?",
        "#",
        "http://[::1]/clip.mp4",
        "HTTPS://WWW.YOUTUBE.COM/WATCH?V=dQw4w9WgXcQ",
        "https://vimeo.com/",
        "\n\thttps://youtu.be/dQw4w9WgXcQ\n",
    ];

    it.each(ADVERSARIAL)("never throws on %j", (input) => {
        expect(() => parseVideoSource(input)).not.toThrow();
        expect(() => isDirectMediaUrl(input)).not.toThrow();
    });

    it("is deterministic — the same input yields an identical result", () => {
        for (const row of CHECKLIST) {
            const a: ParsedVideoSource = parseVideoSource(row.input);
            const b: ParsedVideoSource = parseVideoSource(row.input);
            expect(a).toEqual(b);
        }
    });

    it("trims surrounding whitespace for classification but keeps rawUrl verbatim", () => {
        const input = "  https://youtu.be/dQw4w9WgXcQ  ";
        const parsed = parseVideoSource(input);
        expect(parsed.kind).toBe("youtube");
        expect(parsed.rawUrl).toBe(input);
        expect(parsed.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    });

    it("returns a direct URL verbatim in embedUrl, trimming only to classify it", () => {
        // Plan rule 3 (`docs/plan-youtube-vimeo-embed.md` § Phase 1): for `direct`,
        // `embedUrl` is the RAW url. Both halves of that contract are load-bearing and both
        // are asserted here:
        //   `kind === "direct"`  proves the trim happened — `DIRECT_MEDIA_EXT_RE` is
        //                        end-anchored, so the untrimmed string would classify
        //                        `unknown` on the trailing space alone;
        //   `embedUrl === input` proves the trim did NOT leak into the output.
        const input = " https://cdn.example.com/clip.mp4 ";
        const parsed = parseVideoSource(input);
        expect(parsed.kind).toBe("direct");
        expect(parsed.rawUrl).toBe(input);
        expect(parsed.embedUrl).toBe(input);
    });

    it("never returns a non-null embedUrl for kind unknown", () => {
        for (const url of [...ADVERSARIAL, "https://example.com/random-page"]) {
            const parsed = parseVideoSource(url);
            if (parsed.kind === "unknown") expect(parsed.embedUrl).toBeNull();
        }
    });

    it("is SSR-safe: no browser/DOM/network identifier appears in the module source", async () => {
        // A behavioural test cannot prove the ABSENCE of a `window` reference on a branch
        // it did not take, and this module is imported by the renderer's server bundle —
        // where a `document` reference is a build-time crash, not a runtime warning. So
        // assert it against the source text, with a positive control below.
        const { readFileSync } = await import("node:fs");
        const src = readFileSync(
            new URL("../src/common/videoSource.ts", import.meta.url),
            "utf8",
        );
        // Comments name `window`/`DOM` when explaining the constraint; strip them first.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        for (const forbidden of ["window", "document", "navigator", "localStorage", "fetch("]) {
            expect(code).not.toContain(forbidden);
        }
        // Positive control: the detector above must be able to find something that IS there.
        expect(code).toContain("parseVideoSource");
    });
});
