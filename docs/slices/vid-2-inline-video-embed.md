# VID-2: Inline `video` Plugin Embed + Direct-Media Fix (FEATURE)

- **Status:** IMPLEMENTED 2026-07-28 — review pending. See § *Build run 2026-07-28*.
- **Track:** A — Video embed
- **Depends:** `vid-1` (parser)
- **Source plan:** `docs/plan-youtube-vimeo-embed.md` (Phase 2 — Video Plugin Update)
- **Maturity target:** MATURE

## Preflight

Read before implementing (plugin-internal change):

- `packages/plugins/ARCHITECTURE.md`
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

---

## Packet amendment (operator, 2026-07-28)

The § *Evidence required* "manual OBSERVED URL matrix" is replaced **where automatable** by
assertions on the RENDERED OUTPUT in the plugins test suite — element and `src` per parser
kind, `loading="lazy"` / `title` on the iframe, the native `<video>` for direct media, and the
editor-side failure state for `unknown`. True visual checks (how it *looks*, mobile autoplay
behaviour) remain `NOT RUN` and belong to the operator. Conditional judgment calls in this
doc were to be decided in-flight and recorded, not escalated.

## Decisions taken in-flight

| ID | Question | Decision | Reason |
|----|----------|----------|--------|
| `VID2-UNKNOWN-OUTPUT` | `unknown` → `null`, or an empty 16:9 container? | **`return null`** — no markup at all | The doc says both ("render nothing (empty container)"); the two Definition-of-Done statements that are *binding* — this doc's DoD 3 and the plan's DoD 4 — both say **renders nothing**, and "empty container" appears only in the plan's descriptive table. An empty container is a black 16:9 hole on a live tenant page, which is the visible artifact graceful degradation exists to avoid. It also collapses the empty-`url` case and the bad-`url` case onto one code path, since `parseVideoSource("")` is already `unknown`. The author is not left blind: the failure is surfaced editor-side instead. |
| `VID2-WARNING-TOKEN` | The plan asks for an "amber" warning; is there a warning token? | **No such token exists → neutral fallback**, per this doc's § Scope conditional | `admin/src/index.css` `@theme inline` defines `muted`/`accent`/`destructive`/`border`/`primary`/`secondary`/`card`/`popover`/`chart-*`/`sidebar-*` and **no** warning family (`OBSERVED`, grep of the file). `bg-amber-*` would violate Critical Rule 6. `destructive` is the wrong semantic — nothing failed and the save is not blocked. Callout is `border-border bg-muted text-muted-foreground` with a `TriangleAlert` icon carrying severity by SHAPE. Recorded in `docs/TECH-DEBT.md` § *vid-2 residuals*. |
| `VID2-HEADER-BADGE` | The editor header badge was a fixed `bg-red-50 text-red-600` YouTube glyph. Replace or leave? | **Replace** with the detected provider icon in `bg-muted text-muted-foreground` | It is a hardcoded brand colour of exactly the kind the plan forbids for provider indication, on a block that now serves Vimeo and uploaded media too — a badge whose appearance no longer matched the behaviour. One line, inside a file this slice already owns. The *rest* of the editor's grey/white chrome is package-wide shared style and was deliberately left alone (`docs/TECH-DEBT.md` § *vid-2 residuals*). |
| `VID2-AUTOPLAY-PRESERVED` | The old code appended `?autoplay=0\|1` by hand for YouTube. Keep the attribute? | **Keep**, now spelled by `buildEmbedUrl` | `autoplay` is in `VideoSchema` and existing blocks may have it set; dropping it would be a silent functional regression. Consequence: Vimeo gains autoplay support it never had, which is the smallest behaviour consistent with a provider-agnostic schema field. On `direct`, `autoPlay` additionally emits `muted` + `playsInline` — without them the browser blocks autoplay outright and the flag would be decorative. |
| `VID2-TEST-SEAM` | Editor-side assertions need a DOM harness the repo does not have. Build one, or extract a seam? | **Neither** — `renderToStaticMarkup` | `react-dom/server` renders both components with no DOM, no jsdom, no RTL and no new package (`react-dom@19.2.3` was already hoisted). `NodeViewWrapper` degrades to a plain `<div>` outside an editor. So no presentational sub-component had to be carved out of `VideoEditor` purely to be testable. Limitation stated in the suite header: this reaches OUTPUT, not INTERACTION. |

## CSP pre-flight (§ *Migration / deployment notes*)

`OBSERVED` 2026-07-28 — **there is no CSP anywhere in the estate.**

- `renderer/next.config.ts` is an empty `NextConfig` — no `headers()`, no CSP.
- `renderer/middleware.ts` sets no `Content-Security-Policy`.
- No CloudFront `ResponseHeadersPolicy` in `infra/lib/`.
- Method (scoped to source/config, excluding generated/index/dependency dirs):
  `grep -rniE "content-security-policy|frame-src|child-src" renderer/src renderer/next.config.ts renderer/middleware.ts infra/lib` — ZERO hits (OBSERVED 2026-07-28).
  Conclusion: no CSP is configured in renderer source or infra, so no `frame-src`
  restricts YouTube/Vimeo iframes. (The broader unscoped grep previously cited matched
  only generated artifacts — .next/.rgr — and dependency files; its conclusion was
  unsupported as stated.)
- **Visual / behavioural checks stay `NOT RUN`** and are the operator's: how the callout reads
  at real admin type scale; that a YouTube iframe actually plays; iOS Safari and Android Chrome
  autoplay behaviour on a `direct` clip with `autoplay` on.
- **Editor INTERACTION is `NOT RUN`.** The suite asserts static output for a given `url`; it
  does not type into the input or exercise `updateAttributes`. That needs the DOM/RTL harness of
  `docs/testing-strategy.md` §4, which does not exist and is not this slice.
- **Hydration.** `VideoRender` is a pure function of `attrs` with no state, effect or browser
  API, and the renderer build (gate 2) compiles it into the server bundle — but "no hydration
  mismatch" as a *runtime* observation is `NOT RUN`.

### Mutation check (`EXECUTED`)

A green suite proves nothing about the assertions unless breaking the behaviour breaks them.
Three rounds against `VideoRender.tsx`, each reverted and the revert proven by SHA-256:

| Round | Mutation | Failures | Verdict |
|-------|----------|----------|---------|
| A | Force the `direct` branch off, so direct media goes to the `<iframe>` again — i.e. re-introduce the exact defect `vid-2` retires | **6**, all and only the direct-media rows (3 table rows + controls + no-`loading` + autoplay-implies-muted) | The defect fix is genuinely pinned |
| B | `unknown` returns an empty 16:9 container instead of `null` — the rejected half of `VID2-UNKNOWN-OUTPUT` | **8**, the 2 unknown table rows + all 6 hostile-input rows | The chosen output is pinned, and the hostile-input rows are discriminating rather than incidentally green |
| C | Delete `loading="lazy"` and `title` from the iframe | **2**, exactly the DoD-4 assertions | Not asserted by accident elsewhere |

Reverts verified: `shasum -a 256 -c` → `OK` after every round; the final tree hashes to the
pre-mutation value.

### Self-review: one abstraction removed before completion

The first draft put `data-video-source="<kind>"` on the editor's indicator and callout as a
stable grip for the tests. It was **removed**: the assertions can grip the author-visible copy
(`<span>YouTube</span>`, `"not recognized as YouTube or Vimeo"`) instead, which is the coupling
that should exist — a silent rewording of the warning is precisely the regression worth
catching — so the attribute was a test seam the markup already provided, shipped into every
tenant's admin DOM for nothing. `role="status"` on the callout was kept: that is behaviour
(the callout appears mid-typing, after a screen reader has passed that point in the DOM), not
a seam. No presentational sub-component was extracted from `VideoEditor` and no helper was
extracted from `VideoRender` — each would have had exactly one caller and no named axis of
variation.
