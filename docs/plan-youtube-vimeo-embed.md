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
3. **Direct media**: URL ends with `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogg` (case-insensitive, ignoring query params) **and** its scheme is absent (relative / scheme-relative), `http`, or `https` → `kind: "direct"`, `embedUrl` = raw URL
4. **Unknown**: anything else → `kind: "unknown"`, `embedUrl: null`

**Amendment 2026-07-28 (decision `VID1-DIRECT-SCHEME-CONTRACT`, ratified during `vid-1`
review):** rule 3's scheme requirement was added to this plan after the fact. The original
rule classified purely by extension, which makes `javascript:alert(1)//clip.mp4` a `direct`
result — and rule 3 says `embedUrl` = the raw URL, which Phase 2/3 then put in a
`<video src>`. Defence in depth belongs at the boundary that owns the classification, so a
non-http(s) scheme now yields `unknown` (render nothing). This tightens a region the plan
had left unspecified: no URL in § *Testing Checklist* changes classification, and the
root-relative media-library form (`/uploads/clip.mp4`) still classifies `direct`. It does
**not** relieve Phase 2/3 of encoding output — see `docs/TECH-DEBT.md` § *vid-1 residuals*.
Pinned by test (`packages/plugins/test/videoSource.test.ts`, § scheme guard).

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

**IMPLEMENTED 2026-07-28 as slice `vid-2`** (`docs/slices/vid-2-inline-video-embed.md`,
§ *Build run 2026-07-28*); review pending, nothing deployed. Two points below were decided
in-flight and the plan text now reads as implemented:

- The `unknown` row of the render table said *"Empty container, no element"*. The `video`
  plugin renders **nothing at all** (`return null`) — decision `VID2-UNKNOWN-OUTPUT`, taken
  because an empty 16:9 container is a black hole on a live page and both binding
  Definition-of-Done statements (this plan's item 4, the slice's item 3) say "renders
  nothing". The empty-`url` and unrecognized-`url` cases therefore share one code path.
  This does **not** amend Phase 3: `video-hero`'s `unknown` still falls back to the poster.
- *"Display amber warning"* below could not be satisfied without a hardcoded colour — the
  admin design system has no semantic warning token (`VID2-WARNING-TOKEN`). The callout uses
  neutral theme tokens with a `TriangleAlert` icon carrying the severity by shape; the
  missing token is tracked in `docs/TECH-DEBT.md` § *vid-2 residuals*.

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

**IMPLEMENTED 2026-07-28 as slice `vid-3`** (`docs/slices/vid-3-video-hero-block.md`,
§ *Build run 2026-07-28*); review pending, nothing deployed. Track A is code-complete. Three
points were decided in-flight and the text below reads as implemented:

- The `unknown` row of the render table (*"Empty container, falls back to poster image"*) is
  implemented as **poster, or no backdrop at all when no poster is set** — there is no empty
  container element either way. This is the deliberate divergence from Phase 2's
  `VID2-UNKNOWN-OUTPUT`: the inline block renders nothing because an empty 16:9 box is a hole
  in a content column, the hero renders the poster because it still has to have a backdrop
  behind its headline and CTA.
- The sizer CSS below is implemented as an **inline style object**, not a stylesheet class.
  `packages/plugins` emits no CSS — `npm run build` is bare `tsc`, there is no bundler and no
  `.css` file — so a class would need a new delivery mechanism, and a Tailwind arbitrary value
  would make the cover depend on the consuming app's `@source` scan resolving
  `w-[177.7778vh]`. The `@supports not (min-width: 100%)` fallback is dropped: `min-width` is
  supported by every browser in the estate's support matrix, and the `@supports` block's own
  `177.78vh`/`100vh` values are what the base rule already computes.
- **`muted` and `loop` are inert on the embed kinds.** `buildBackgroundEmbedUrl` hardcodes
  both (an unmuted background embed is refused autoplay everywhere; YouTube loops only via
  `playlist={id}`), so the editor replaces those two checkboxes with a statement of fact when
  the source is a provider embed rather than offering controls that silently do nothing.

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

Added by the 2026-07-28 scheme amendment to rule 3 (`VID1-DIRECT-SCHEME-CONTRACT`). The
first three are *discriminating* — the URI path ends in a media extension, so only the
scheme guard rejects them; the fourth proves the amendment did not narrow legitimate input:
- [ ] `parseVideoSource("javascript:alert(1)//clip.mp4")` → `kind: "unknown"`, `embedUrl: null`
- [ ] `parseVideoSource("data:text/html;base64,AAAA/clip.mp4")` → `kind: "unknown"`, `embedUrl: null`
- [ ] `parseVideoSource("file:///x.mp4")` → `kind: "unknown"`, `embedUrl: null`
- [ ] `parseVideoSource("/uploads/clip.mp4")` → `kind: "direct"` (relative media-library path unaffected)

### Video Plugin (Inline)

All eight are `EXECUTED` as assertions on rendered output in
`packages/plugins/test/videoPlugin.test.ts` (`vid-2`), not manual checks.

- [x] YouTube URL → iframe with embed URL renders
- [x] Vimeo URL → iframe with embed URL renders
- [x] Direct .mp4 URL → native `<video>` tag renders (defect fix)
- [x] Direct .webm URL → native `<video>` tag renders
- [x] Unknown URL → no broken element *(renders nothing — see `VID2-UNKNOWN-OUTPUT` above)*
- [x] Empty URL → no render
- [x] `loading="lazy"` present on iframe (not on native video)
- [x] `title` attribute present on iframe

### VideoHero Plugin

Five of the seven are `EXECUTED` as assertions on rendered output in
`packages/plugins/test/videoHeroPlugin.test.ts` (`vid-3`). The two viewport rows are
**measurements, not assertions** — a static-markup harness has no layout — so they stay
manual and are itemized in the slice doc's § *Operator visual checklist*. What the suite
pins in their place is the cover MECHANISM: the emitted sizer declarations.

- [x] YouTube URL → background iframe with autoplay/mute/loop params *(each parameter asserted by name, including the `playlist={id}` pairing without which `loop=1` is inert)*
- [x] Vimeo URL → background iframe with `?background=1`
- [x] Direct .mp4 URL → native `<video>` tag (existing behavior)
- [x] Unknown URL → falls back to poster image only
- [ ] Background iframe covers viewport on landscape (wide) screen — **OPERATOR**
- [ ] Background iframe covers viewport on portrait (tall) screen — **OPERATOR**
- [x] No `loading="lazy"` on VideoHero (above-the-fold)

### Editor UX

The `video` plugin's five rows are `EXECUTED` in `videoPlugin.test.ts`; the `video-hero`
rows below are `EXECUTED` in `videoHeroPlugin.test.ts` (`vid-3`).

- [x] YouTube URL shows YouTube icon (Lucide `Youtube`)
- [x] Vimeo URL shows video icon (Lucide `Video`)
- [x] Direct URL shows a generic media icon (Lucide `FileVideo`) + the label "Media file"
- [x] Unknown URL shows warning text *(neutral tokens, not amber — `VID2-WARNING-TOKEN`)*
- [x] Icons use `text-muted-foreground`, not brand colors

### Integration

All three are **OPERATOR** rows and remain so after `vid-3`. The automated suites reach the
STATIC markup both blocks emit — which is the input to hydration, not hydration itself — and
they run in a `node` environment with no device, so an autoplay policy cannot be observed
from them. The nearest automated proxy that does exist is credible but partial: both render
components are pure functions of `attrs` with no state, no effect and no `window` reference,
and `packages/plugins`' test suites import `src/render.ts` in a node environment, which fails
outright on any top-level browser API. That makes a hydration mismatch *unlikely by
construction*; it does not make it `OBSERVED`.

- [ ] SSR → no hydration mismatch — **OPERATOR**
- [ ] Mobile iOS Safari → document autoplay limitations if they occur — **OPERATOR**
- [ ] Mobile Android Chrome → document autoplay limitations if they occur — **OPERATOR**

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
| `packages/plugins/src/video-hero/VideoHeroEditor.tsx` | Add tabbed selector with Embed tab — DONE (`vid-3`) |
| `packages/plugins/src/video-hero/VideoHeroRender.tsx` | Conditional iframe render for embeds — DONE (`vid-3`) |
| `packages/plugins/ARCHITECTURE.md` | Update with new common module, changed render paths — DONE |
| `docs/block-types.md` | Document embed support for video and video-hero — DONE |
| `docs/TECH-DEBT.md` | Add future considerations (youtube-nocookie, oEmbed metadata) — DONE (§ *vid-3 residuals*) |
| `tools/mcp-server/src/index.ts` | Sync block schemas if MCP exposes video/video-hero attributes — **NO CHANGE NEEDED**, verified `OBSERVED` 2026-07-28 |

**MCP sync, checked and recorded** (`CLAUDE.md` § Definition of Done, "Check that the MCP
server reflects the changes"). The condition in that row is *"if MCP exposes video/video-hero
attributes"*, and it does not, for either half:

- `videoHero` appears in neither `BLOCK_SCHEMAS` nor `add_block`'s `type` enum in
  `tools/mcp-server/src/index.ts` — the MCP surface has never included this block.
- The `video` entry that IS there describes only `url` / `caption` / `width` / `autoplay`, all
  unchanged, and its description already reads *"supporting YouTube, Vimeo, or direct MP4
  links"*, which `vid-2` made true.

Neither `vid-2` nor `vid-3` changed a schema, so there is nothing to sync. **Adding
`videoHero` to the MCP surface is new scope**, not reconciliation — it would let the AI author
hero blocks it cannot author today — and is surfaced for the operator rather than built.

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
13. `packages/plugins/ARCHITECTURE.md` updated with new common module
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

### Status after `vid-3` (2026-07-28)

Items **1-11 and 13-17 are met**; the plan's three phases are all IMPLEMENTED and Track A is
code-complete. Reviews are pending on `vid-1`/`vid-2`/`vid-3` and nothing is deployed.

Two items are met with a **ratified deviation**, both recorded above at the phase that made
them and both re-stated here so this list is not read as unqualified:

- **9** — *"amber warning"*: the admin design system has no semantic warning token, so the
  callout uses neutral tokens with a `TriangleAlert` icon carrying the severity
  (`VID2-WARNING-TOKEN`, `docs/TECH-DEBT.md` § *vid-2 residuals*). The `video-hero` callout
  follows the same rule with hero-specific copy — it says the poster will show, because that
  is what actually happens there.
- **16** — the MCP server exposes no `video-hero` schema and no changed `video` attribute, so
  the conditional does not fire. See § *Files to Modify* for the observation.

Items **12, 18-24 are `NOT RUN` and are the OPERATOR's** — every one of them is a measurement
on a real browser or device (viewport cover, mobile autoplay policy, hydration), and rows
18-22 additionally want a live tenant page. They are itemized as a checklist in
`docs/slices/vid-3-video-hero-block.md` § *Operator visual checklist*. Their automated
counterparts — which assert what the server EMITS, not what a browser does with it — are
`packages/plugins/test/videoPlugin.test.ts` and `test/videoHeroPlugin.test.ts`.
