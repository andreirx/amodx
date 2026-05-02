# Plan: YouTube & Vimeo Embed Support

## Status: PLANNED

## Problem Statement

The `video` and `video-hero` plugins currently only support uploaded video files (S3/library). Users want to embed YouTube and Vimeo videos without uploading them.

### Current State

| Plugin | Schema Field | Render Method | Embed Support |
|--------|-------------|---------------|---------------|
| `video` | `url: string` | `<iframe>` | Partial — YouTube ID extraction exists, Vimeo not handled |
| `video-hero` | `videoSrc: string` | `<video>` tag | None — native video only, iframe URLs silently fail |

### Scope

**In scope:** YouTube, Vimeo only. These are stable, well-documented providers with clean iframe APIs.

**Out of scope:** Facebook (requires SDK, no clean background mode), TikTok, Instagram (unstable embed APIs, mobile restrictions).

---

## Architecture Decisions

### 1. Source-of-Truth Model: Option A (Dumb String + Shared Parser)

Keep `url` / `videoSrc` as plain strings. Add a shared parser module.

**Rationale:**
- No schema migration required
- Deterministic output (same URL always produces same embed URL)
- SSR cost is negligible (regex, nanoseconds)
- Future upgrade path to Option B (normalized schema) remains open

**Location:** `packages/plugins/src/common/videoSource.ts`

### 2. Providers: YouTube + Vimeo Only

| Provider | URL Patterns | Embed Template |
|----------|-------------|----------------|
| YouTube | `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID`, `youtube.com/embed/ID` | `https://www.youtube.com/embed/{ID}` |
| Vimeo | `vimeo.com/ID`, `player.vimeo.com/video/ID` | `https://player.vimeo.com/video/{ID}` |

Privacy variant: `youtube-nocookie.com` — expose as tenant-level setting later (not in this phase).

### 3. VideoHero Embed Behavior

Native `<video>` and `<iframe>` behave differently for background video:

| Source Type | Render Element | Background Mode |
|-------------|---------------|-----------------|
| Upload (MP4/WebM) | `<video autoplay muted loop>` | Native `object-cover` |
| YouTube | `<iframe>` | `?autoplay=1&mute=1&loop=1&playlist={ID}&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3` |
| Vimeo | `<iframe>` | `?background=1` (Vimeo's dedicated background mode) |

**CSS requirement for iframe cover:** Use min-width/min-height strategy with aspect-ratio-aware sizer div. See Phase 3 implementation for details.

**Known limitations:**
- Provider chrome may flash briefly on load
- Mobile autoplay policies vary by device/browser
- YouTube requires `playlist={ID}` parameter for loop to work

### 4. Editor UX: Option 4b (Tabbed Selector)

VideoHero editor will have three tabs:
- **Upload** — file picker, drag-and-drop
- **Library** — existing media library picker
- **Embed** — URL input with provider detection badge

The `video` plugin editor already has a URL input; enhance it with provider detection feedback.

**Provider indicators:** Use Lucide icons (`Youtube`, `Video` for Vimeo) with muted-foreground coloring. Do NOT use brand colors (red/blue) — this violates the no-hardcoded-colors rule. Differentiate via icon shape and label text only.

**Validation:** Warning-only, not save-blocking.
- Unknown URLs display amber warning: "URL not recognized as YouTube or Vimeo — may not render correctly"
- Render gracefully degrades: unknown URLs render nothing (empty container) rather than a broken iframe
- Rationale: Save-blocking requires wiring validation through ContentEditor's save pipeline, which is out of scope. Warning + graceful fallback is sufficient for this phase.

---

## Implementation Plan

### Phase 1: Parser Module (SUPPORT)

Create `packages/plugins/src/common/videoSource.ts`:

```typescript
export type VideoSourceKind = "youtube" | "vimeo" | "direct" | "unknown";

export interface ParsedVideoSource {
  kind: VideoSourceKind;
  rawUrl: string;
  embedUrl: string | null;  // null for unknown
  providerId?: string;      // YouTube/Vimeo video ID
}

export function parseVideoSource(url: string): ParsedVideoSource;
export function buildEmbedUrl(kind: "youtube" | "vimeo", id: string, options?: EmbedOptions): string;
export function buildBackgroundEmbedUrl(kind: "youtube" | "vimeo", id: string): string;
export function isDirectMediaUrl(url: string): boolean;
```

**Detection logic (four-way classification):**
1. **YouTube**: regex for all URL variants, extract 11-char ID → `kind: "youtube"`
2. **Vimeo**: regex for numeric ID after `vimeo.com/` or `player.vimeo.com/video/` → `kind: "vimeo"`
3. **Direct media**: URL ends with `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogg` (case-insensitive, ignoring query params) → `kind: "direct"`, `embedUrl` = raw URL
4. **Unknown**: anything else → `kind: "unknown"`, `embedUrl: null`

**Render behavior by kind:**

| Kind | `video` plugin | `video-hero` plugin |
|------|---------------|---------------------|
| `youtube` | `<iframe>` with embed URL | `<iframe>` with background params |
| `vimeo` | `<iframe>` with embed URL | `<iframe>` with background params |
| `direct` | `<video>` tag (native) | `<video>` tag (native) |
| `unknown` | Empty container, no element | Empty container, falls back to poster image |

**Note on `direct` in inline video plugin:** The current implementation passes direct URLs to an iframe, which is unreliable for MP4/WebM playback. This plan explicitly fixes that defect by adding a native `<video>` render path to `VideoRender.tsx` for `kind === "direct"`.

This four-way split prevents the regression where an invalid URL was previously treated as a valid upload.

**EmbedOptions:**
```typescript
interface EmbedOptions {
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  background?: boolean; // Vimeo-specific
}
```

### Phase 2: Video Plugin Update (FEATURE)

**Schema:** No change — `url: string` remains.

**VideoEditor.tsx:**
- Add provider detection on URL change
- Display provider icon (Lucide `Youtube` / `Video`, using `text-muted-foreground`) when recognized
- Display amber warning when URL is non-empty but kind is `unknown`

**VideoRender.tsx:**
- Import `parseVideoSource`
- Replace inline YouTube regex with parser call
- Add Vimeo handling via `<iframe>`
- Add native `<video>` render path for `kind === "direct"` (fixes existing defect where direct MP4/WebM was passed to iframe)
- Render nothing for `kind === "unknown"` (graceful degradation)
- Add `loading="lazy"` to iframe (not to native video — let browser decide)
- Add `title` attribute for accessibility on iframe

### Phase 3: VideoHero Plugin Update (FEATURE)

**Schema:** No change — `videoSrc: string` remains.

**VideoHeroEditor.tsx:**
- Add tabbed selector: Upload | Library | Embed
- Embed tab: URL input with provider detection
- Show preview thumbnail when possible (YouTube has predictable thumbnail URLs)

**VideoHeroRender.tsx:**
- Import `parseVideoSource`, `buildBackgroundEmbedUrl`
- Conditional render:
  - `kind === "direct"` → existing `<video>` tag (native playback)
  - `kind === "youtube"` or `kind === "vimeo"` → `<iframe>` with background params
  - `kind === "unknown"` → no video element, show poster image only (if set)
- Add CSS for iframe cover effect using min-width/min-height strategy:
  ```css
  .video-hero-iframe-container {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .video-hero-iframe {
    position: absolute;
    top: 50%;
    left: 50%;
    /* 
     * Cover algorithm: iframe must fill container on BOTH axes.
     * Use min-width/min-height so one axis always fills while other overflows.
     * 56.25% = 9/16 (inverse aspect ratio for height calc from width).
     * 177.78% = 16/9 (inverse aspect ratio for width calc from height).
     */
    min-width: 100%;
    min-height: 100%;
    width: auto;
    height: auto;
    /* Fallback for browsers that need explicit dimensions */
    @supports not (min-width: 100%) {
      width: 177.78vh;
      height: 100vh;
    }
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  /* Aspect ratio container for iframe sizing */
  .video-hero-iframe-sizer {
    position: absolute;
    top: 50%;
    left: 50%;
    min-width: 100%;
    min-height: 56.25vw; /* 9/16 of viewport width */
    width: 177.78vh;     /* 16/9 of viewport height */
    height: 100vh;
    transform: translate(-50%, -50%);
  }
  .video-hero-iframe-sizer iframe {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  ```
  
  **Implementation note:** The sizer div approach is more robust. The iframe fills the sizer, and the sizer uses competing min-width/width and min-height/height to always cover the container regardless of viewport aspect ratio. Test on both landscape and portrait viewports.

---

## Pre-Flight Checks

Before shipping, verify:

1. **CSP headers** — renderer must allow `frame-src` for:
   - `https://www.youtube.com`
   - `https://www.youtube-nocookie.com`
   - `https://player.vimeo.com`

2. **Mobile autoplay** — test on iOS Safari and Android Chrome. YouTube/Vimeo background embeds may not autoplay without user gesture. Document this limitation.

3. **Accessibility** — all iframes must have `title` attribute describing content.

---

## Testing Checklist

### Parser Unit Tests
- [ ] `parseVideoSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ")` → `kind: "youtube"`, `providerId: "dQw4w9WgXcQ"`
- [ ] `parseVideoSource("https://youtu.be/dQw4w9WgXcQ")` → `kind: "youtube"`
- [ ] `parseVideoSource("https://youtube.com/shorts/abc123xyz99")` → `kind: "youtube"`
- [ ] `parseVideoSource("https://www.youtube.com/embed/dQw4w9WgXcQ")` → `kind: "youtube"` (passthrough, no double-embed)
- [ ] `parseVideoSource("https://vimeo.com/123456789")` → `kind: "vimeo"`, `providerId: "123456789"`
- [ ] `parseVideoSource("https://player.vimeo.com/video/123456789")` → `kind: "vimeo"` (passthrough)
- [ ] `parseVideoSource("https://example.com/video.mp4")` → `kind: "direct"`
- [ ] `parseVideoSource("https://example.com/video.webm?token=abc")` → `kind: "direct"` (ignores query params)
- [ ] `parseVideoSource("https://example.com/random-page")` → `kind: "unknown"`, `embedUrl: null`
- [ ] `parseVideoSource("")` → `kind: "unknown"`, `embedUrl: null`

### Video Plugin (Inline)
- [ ] YouTube URL → iframe with embed URL renders
- [ ] Vimeo URL → iframe with embed URL renders
- [ ] Direct .mp4 URL → native `<video>` tag renders (defect fix)
- [ ] Direct .webm URL → native `<video>` tag renders
- [ ] Unknown URL → empty container, no broken element
- [ ] Empty URL → no render
- [ ] `loading="lazy"` present on iframe (not on native video)
- [ ] `title` attribute present on iframe

### VideoHero Plugin
- [ ] YouTube URL → background iframe with autoplay/mute/loop params
- [ ] Vimeo URL → background iframe with `?background=1`
- [ ] Direct .mp4 URL → native `<video>` tag (existing behavior)
- [ ] Unknown URL → falls back to poster image only
- [ ] Background iframe covers viewport on landscape (wide) screen
- [ ] Background iframe covers viewport on portrait (tall) screen
- [ ] No `loading="lazy"` on VideoHero (above-the-fold)

### Editor UX
- [ ] YouTube URL shows YouTube icon (Lucide `Youtube`)
- [ ] Vimeo URL shows video icon (Lucide `Video`)
- [ ] Direct URL shows no special indicator (or generic media icon)
- [ ] Unknown URL shows amber warning text
- [ ] Icons use `text-muted-foreground`, not brand colors

### Integration
- [ ] SSR → no hydration mismatch
- [ ] Mobile iOS Safari → document autoplay limitations if they occur
- [ ] Mobile Android Chrome → document autoplay limitations if they occur

---

## Future Considerations (Out of Scope)

- **YouTube privacy mode** — tenant setting for `youtube-nocookie.com` default
- **Thumbnail extraction** — YouTube has predictable URLs (`https://img.youtube.com/vi/{ID}/maxresdefault.jpg`), Vimeo requires oEmbed API call
- **Provider metadata** — title, duration, channel name via oEmbed
- **Schema upgrade to Option B** — if metadata storage becomes necessary, migrate to `VideoSourceSchema` object with provider fields baked in

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/plugins/src/common/videoSource.ts` | NEW — parser module |
| `packages/plugins/src/video/VideoEditor.tsx` | Add provider detection UI |
| `packages/plugins/src/video/VideoRender.tsx` | Use parser, add Vimeo, add a11y |
| `packages/plugins/src/video-hero/VideoHeroEditor.tsx` | Add tabbed selector with Embed tab |
| `packages/plugins/src/video-hero/VideoHeroRender.tsx` | Conditional iframe render for embeds |
| `packages/plugins/MAP.md` | Update with new common module, changed render paths |
| `docs/block-types.md` | Document embed support for video and video-hero |
| `docs/TECH-DEBT.md` | Add future considerations (youtube-nocookie, oEmbed metadata) |
| `tools/mcp-server/src/index.ts` | Sync block schemas if MCP exposes video/video-hero attributes |

## Build Verification

After implementation, run full rebuild to verify no cross-module breaks. Per repo Definition of Done (`CLAUDE.md`), all affected modules must rebuild:

```bash
cd packages/shared && npm run build
cd ../plugins && npm run build
cd ../../backend && npm run build
cd ../admin && npm run build
cd ../renderer && npm run build
```

All five must succeed before PR. (Backend is included per repo rules even though this change does not modify backend code — ensures no transitive breaks from shared types.)

---

## Definition of Done

### Code
1. Parser module (`videoSource.ts`) exists with unit tests covering all four kinds
2. Video plugin accepts and renders YouTube/Vimeo URLs via iframe
3. Video plugin renders direct media URLs via native `<video>` tag (defect fix, not preserving broken iframe behavior)
4. Video plugin renders nothing for unknown URLs (graceful degradation)
5. VideoHero plugin accepts and renders YouTube/Vimeo as background iframe
6. VideoHero plugin renders direct media URLs via native `<video>` tag (existing behavior)
7. VideoHero plugin falls back to poster image for unknown URLs
8. Editor shows provider icon (Lucide, theme-colored) when URL is recognized
9. Editor shows amber warning for unknown URLs
10. All iframes have `title` attribute for accessibility
11. Inline video plugin uses `loading="lazy"`
12. VideoHero iframe cover works on landscape AND portrait viewports

### Documentation
13. `packages/plugins/MAP.md` updated with new common module
14. `docs/block-types.md` updated with embed support details
15. `docs/TECH-DEBT.md` updated with future considerations
16. `tools/mcp-server/src/index.ts` synced if it exposes video block schemas

### Verification
17. Full rebuild passes: shared → plugins → backend → admin → renderer (all five)
18. Manual test: YouTube watch URL, youtu.be, Shorts URL
19. Manual test: Vimeo standard URL, player URL
20. Manual test: Direct .mp4 URL renders via native `<video>` in both plugins
21. Manual test: Direct .webm URL renders via native `<video>` in both plugins
22. Manual test: Invalid URL shows warning, renders gracefully (empty container)
23. Manual test: VideoHero background on mobile (document autoplay limitations)
24. SSR test: No hydration mismatch
