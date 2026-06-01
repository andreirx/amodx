# VID-1: YouTube/Vimeo URL Parser (SUPPORT)

- **Status:** PLANNED
- **Track:** A — Video embed
- **Depends:** none (independent; plugin-local)
- **Source plan:** `docs/plan-youtube-vimeo-embed.md` (Phase 1 — Parser Module)
- **Maturity target:** MATURE (pure, fully unit-tested support module)

## Preflight

Read before implementing (plugin-internal change):

- `packages/plugins/MAP.md`
- `docs/plugin-architecture.md`
- `docs/block-types.md`
- `docs/plan-youtube-vimeo-embed.md`

## Purpose / risk retired

Provide one deterministic parser that classifies a video URL and produces the correct
embed URL. Retires the risk of ad-hoc, duplicated, buggy regex scattered across the two
video plugins, and the defect where an invalid or direct-media URL is treated as a valid
embed. This is the SUPPORT module the FEATURE slices (`vid-2`, `vid-3`) consume.

## Scope

New module `packages/plugins/src/common/videoSource.ts`:

- `parseVideoSource(url): ParsedVideoSource` — four-way classification:
  `youtube` | `vimeo` | `direct` | `unknown`, with `embedUrl` (null for unknown) and
  `providerId`.
- `buildEmbedUrl(kind, id, options?)` — inline embed URL.
- `buildBackgroundEmbedUrl(kind, id)` — background-mode embed URL (YouTube
  autoplay/mute/loop/playlist; Vimeo `?background=1`).
- `isDirectMediaUrl(url)` — `.mp4|.webm|.mov|.m4v|.ogg` (case-insensitive, ignoring query).
- `EmbedOptions` type (autoplay/muted/loop/controls/background).

Unit tests covering all four kinds and the plan's testing checklist (youtube watch /
youtu.be / shorts / embed passthrough; vimeo standard / player passthrough; direct .mp4
and .webm-with-query; unknown; empty string).

Add a `test` script and a `vitest` dev dependency to `packages/plugins/package.json`: the
package currently has only `build`/`watch` and the plugins workspace has no test harness
yet — pin `vitest >= 4.1.7` (backend now uses `^4.1.8`, which clears critical advisory
GHSA-5xrq-8626-4rwp; the earlier `^4.0.16` shipped the vulnerable `@vitest/ui`). Do not add
`@vitest/ui` unless a `--ui` workflow is actually needed. Installing vitest triggers the repo
vuln-audit rule (`CLAUDE.md` Definition of Done): after installing, run `npm audit` and
document any high/critical findings.

## Non-scope

- No plugin render or editor changes (those are `vid-2` / `vid-3`).
- No schema change (`url` / `videoSrc` stay plain strings).
- No oEmbed / metadata / thumbnail fetching.
- No `youtube-nocookie` privacy mode (future consideration).

## Architectural boundaries

- Pure, deterministic, **SSR-safe** — no browser APIs, no DOM, no network.
- Lives in `packages/plugins/src/common/`. Must be importable from both the `render`
  (server) and `admin` (browser) plugin entries without violating the plugin split-entry
  rule (`CLAUDE.md` Critical Rule 1).
- No cross-imports between plugins and admin/renderer.
- Platform decisions: not applicable (plugin-local, no tenant data, no auth).

## Migration / deployment notes

None. Package-local; no data migration. Ships in the `plugins` build. Build order:
`shared → plugins`.

## Definition of Done

1. `videoSource.ts` exists with the four exported functions and `EmbedOptions`.
2. Four-way classification correct: youtube, vimeo, direct, unknown.
3. Direct-media detection ignores query params and is case-insensitive.
4. Unknown/empty → `kind: "unknown"`, `embedUrl: null`.
5. Unit tests cover every checklist case in the plan.
6. SSR-safe (no browser/DOM/network references).
7. A `test` script exists in `packages/plugins/package.json` (vitest) and runs the parser tests.

## Evidence required

- `EXECUTED`: `cd packages/plugins && npm test` green (the `test` script added in this
  slice), covering all four kinds and the checklist URLs.
- `EXECUTED`: full workspace rebuild (repo Definition of Done):

  ```bash
  cd packages/shared && npm run build
  cd ../plugins && npm run build
  cd ../../backend && npm run build
  cd ../admin && npm run build
  cd ../renderer && npm run build
  ```
- `OBSERVED`: parser output for each checklist URL matches the plan's expected table.

## Exit criterion

`vid-2` and `vid-3` can import `parseVideoSource` / `buildEmbedUrl` /
`buildBackgroundEmbedUrl` and rely on the four-way classification. No render path needs
its own URL regex after this slice.

## References

- `docs/plan-youtube-vimeo-embed.md` — Phase 1 (Parser Module) + Testing Checklist.
- `CLAUDE.md` — Critical Rule 1 (plugin split entry), Definition of Done (rebuild order).
- `packages/plugins/MAP.md` — update with the new common module on completion.
