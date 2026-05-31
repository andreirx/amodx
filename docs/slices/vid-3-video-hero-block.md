# VID-3: `video-hero` Block Embed (FEATURE)

- **Status:** PLANNED
- **Track:** A — Video embed
- **Depends:** `vid-1` (parser), `vid-2` (render pattern established)
- **Source plan:** `docs/plan-youtube-vimeo-embed.md` (Phase 3 — VideoHero Plugin Update)
- **Maturity target:** MATURE

## Preflight

Read before implementing (plugin-internal change):

- `packages/plugins/MAP.md`
- `docs/plugin-architecture.md`
- `docs/block-types.md`
- `docs/plan-youtube-vimeo-embed.md`

## Purpose / risk retired

Make the `video-hero` block support YouTube/Vimeo as a background embed. Today it is
native-`<video>`-only and iframe URLs silently fail. Retires that silent failure and the
background-cover sizing risk (iframe cover behaves differently from native `object-cover`),
with a tabbed editor so authors pick Upload / Library / Embed explicitly.

## Scope

- `packages/plugins/src/video-hero/VideoHeroRender.tsx`:
  - import `parseVideoSource`, `buildBackgroundEmbedUrl`.
  - `direct` → existing native `<video>` background.
  - `youtube` / `vimeo` → `<iframe>` background (autoplay/mute/loop/playlist for YouTube,
    `?background=1` for Vimeo), cover via the min-width/min-height sizer CSS.
  - `unknown` → poster image only (if set).
  - no `loading="lazy"` (above the fold).
- `packages/plugins/src/video-hero/VideoHeroEditor.tsx`:
  - tabbed selector Upload | Library | Embed; Embed tab = URL input + provider detection;
    YouTube thumbnail preview when derivable.
- Schema unchanged (`videoSrc: string`).

## Non-scope

- Schema upgrade to a normalized `VideoSourceSchema` (Option B) — future.
- oEmbed metadata; `youtube-nocookie` tenant setting.
- Changes to the inline `video` plugin (`vid-2`).

## Architectural boundaries

- Plugin split entry; no cross-imports; no hardcoded colors.
- SSR-safe render; no hydration mismatch.
- JSX template-literal closing discipline: in `<div className={`...`}>` the `>` must
  follow the closing backtick+brace (a known prior bug class fixed previously in the
  renderer's `CommerceBar.tsx` / `Navbar.tsx`). The cover sizer uses template-literal
  classNames — watch this.
- Platform decisions: not applicable (plugin-local, no tenant data).

## Migration / deployment notes

None (no data migration). Build: `shared → plugins → renderer` and `admin`. Same CSP
`frame-src` requirement as `vid-2`; additionally, if a CSP is present and the editor uses
direct YouTube thumbnails, `img-src` must allow `https://img.youtube.com`. Document mobile
autoplay limitations (iOS Safari / Android Chrome background embeds may not autoplay
without a gesture).

## Definition of Done

1. YouTube/Vimeo render as a background iframe with the correct background params.
2. Direct media renders via native `<video>` (existing behavior preserved).
3. Unknown URL falls back to the poster image only.
4. Background iframe covers the viewport on both landscape and portrait.
5. Editor exposes Upload / Library / Embed tabs; Embed shows provider detection.
6. No `loading="lazy"` on the hero (above the fold).

## Evidence required

- `EXECUTED`: full workspace rebuild (repo Definition of Done):

  ```bash
  cd packages/shared && npm run build
  cd ../plugins && npm run build
  cd ../../backend && npm run build
  cd ../admin && npm run build
  cd ../renderer && npm run build
  ```
- `OBSERVED`: background cover correct on a wide (landscape) and a tall (portrait) viewport.
- `OBSERVED`: direct-media hero still plays natively; unknown falls back to poster.
- `OBSERVED` / documented: mobile autoplay behavior on iOS Safari and Android Chrome.
- `OBSERVED`: SSR — no hydration mismatch.

## Exit criterion

Both video plugins fully support YouTube/Vimeo; Track A is complete. On completion, update
`docs/block-types.md`, `packages/plugins/MAP.md`, sync the MCP server video schemas
(`tools/mcp-server/src/index.ts`), and add the deferred items (`youtube-nocookie`, oEmbed
metadata, schema Option B) to `docs/TECH-DEBT.md`.

## References

- `docs/plan-youtube-vimeo-embed.md` — Phase 3; Definition of Done items 5,6,7,12;
  Files-to-Modify; Future Considerations.
- `docs/slices/vid-1-youtube-vimeo-url-parser.md`, `docs/slices/vid-2-inline-video-embed.md`.
