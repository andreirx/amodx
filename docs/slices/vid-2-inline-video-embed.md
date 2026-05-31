# VID-2: Inline `video` Plugin Embed + Direct-Media Fix (FEATURE)

- **Status:** PLANNED
- **Track:** A — Video embed
- **Depends:** `vid-1` (parser)
- **Source plan:** `docs/plan-youtube-vimeo-embed.md` (Phase 2 — Video Plugin Update)
- **Maturity target:** MATURE

## Preflight

Read before implementing (plugin-internal change):

- `packages/plugins/MAP.md`
- `docs/plugin-architecture.md`
- `docs/block-types.md`
- `docs/plan-youtube-vimeo-embed.md`

## Purpose / risk retired

Make the inline `video` plugin render YouTube and Vimeo via `<iframe>` and direct media
(`.mp4`/`.webm`) via a native `<video>` element. Retires the existing defect where a
direct media URL is piped into an iframe (unreliable playback), and the silent failure of
unknown URLs, by routing all classification through the `vid-1` parser with graceful
degradation.

## Scope

- `packages/plugins/src/video/VideoRender.tsx`:
  - import `parseVideoSource`; replace the inline YouTube regex.
  - `youtube` / `vimeo` → `<iframe>` (embed URL, `loading="lazy"`, `title` for a11y).
  - `direct` → native `<video>` (defect fix; no iframe).
  - `unknown` → render nothing (empty container).
- `packages/plugins/src/video/VideoEditor.tsx`:
  - provider detection on URL change; Lucide `Youtube` / `Video` icon in
    `text-muted-foreground`; a token-based warning callout (existing design-system/theme
    tokens; if no warning token exists, use neutral themed styling and add a TECH-DEBT
    entry for semantic warning tokens) when a non-empty URL is `unknown`.
- Schema unchanged (`url: string`).

## Non-scope

- `video-hero` plugin (that is `vid-3`).
- Brand colors on provider icons (theme tokens only).
- `youtube-nocookie`, oEmbed metadata, thumbnail extraction.

## Architectural boundaries

- Plugin split entry: editor in `admin.ts`, render in `render.ts`; no cross-imports.
- No hardcoded colors (`CLAUDE.md` Critical Rule 6) — `text-muted-foreground`, not red/blue.
- `VideoRender.tsx` must stay SSR-safe (no hydration mismatch).
- Platform decisions: not applicable (plugin-local, no tenant data).

## Migration / deployment notes

None (no data migration). Build: `shared → plugins → renderer` and `admin`.
**CSP pre-flight:** confirm whether a CSP is set (renderer `next.config`/middleware or a
CloudFront response-headers policy in CDK). If a CSP exists or is later added, `frame-src`
must allow `https://www.youtube.com`, `https://www.youtube-nocookie.com`,
`https://player.vimeo.com`. Record the finding in the slice on completion.

## Definition of Done

1. YouTube and Vimeo URLs render via `<iframe>` with the parser's embed URL.
2. Direct `.mp4`/`.webm` render via native `<video>` (defect fixed — not preserved as iframe).
3. Unknown URL renders nothing (graceful degradation).
4. `loading="lazy"` and `title` present on the iframe (not on native video).
5. Editor shows the provider icon (theme-colored) when recognized; a token-based warning callout on unknown (no hardcoded color).
6. No hardcoded colors.

## Evidence required

- `EXECUTED`: plugin tests for youtube/vimeo/direct/unknown/empty (the `vid-1` vitest harness).
- `EXECUTED`: full workspace rebuild (repo Definition of Done):

  ```bash
  cd packages/shared && npm run build
  cd ../plugins && npm run build
  cd ../../backend && npm run build
  cd ../admin && npm run build
  cd ../renderer && npm run build
  ```
- `OBSERVED`: manual — YouTube watch / youtu.be / Shorts; Vimeo standard / player; direct
  `.mp4` and `.webm` via native `<video>`; unknown shows warning + empty render; SSR shows
  no hydration mismatch.
- `OBSERVED` or `NOT RUN` (documented): CSP presence check.

## Exit criterion

The inline `video` plugin fully supports YouTube/Vimeo and correctly plays direct media;
the iframe-for-direct-media defect is gone. Pattern established for `vid-3`.

## References

- `docs/plan-youtube-vimeo-embed.md` — Phase 2; Definition of Done items 2,3,4,8,9,10,11.
- `docs/slices/vid-1-youtube-vimeo-url-parser.md`.
- `CLAUDE.md` — Critical Rules 1 (split entry), 6 (no hardcoded colors).
- `docs/block-types.md` — update embed support on completion.
