# VID-3: `video-hero` Block Embed (FEATURE)

- **Status:** SHIPPED 2026-07-28 — deployed to production by the human, verified live (staging probe suite + prod probes: bijup.com s-maxage/Hit/age, session bypass, nf no-loop)
  (§ *Build run 2026-07-28*). Maturity reached: MATURE.
- **Track:** A — Video embed
- **Depends:** `vid-1` (parser), `vid-2` (render pattern established)
- **Source plan:** `docs/plan-youtube-vimeo-embed.md` (Phase 3 — VideoHero Plugin Update)
- **Maturity target:** MATURE

## Preflight

Read before implementing (plugin-internal change):

- `packages/plugins/ARCHITECTURE.md`
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

*(This section is the slice's requirement list, written before implementation. For what was
actually run and what was not, read § *Build run 2026-07-28* and § *Operator visual
checklist* — the four `OBSERVED` rows below are all still `NOT RUN` and are the operator's.)*

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
`docs/block-types.md`, `packages/plugins/ARCHITECTURE.md`, sync the MCP server video schemas
(`tools/mcp-server/src/index.ts`), and add the deferred items (`youtube-nocookie`, oEmbed
metadata, schema Option B) to `docs/TECH-DEBT.md`.

## Build run 2026-07-28

Plugins-only change. Files touched outside `packages/plugins/` are documentation.

### Files changed

| File | Change |
|------|--------|
| `packages/plugins/src/video-hero/VideoHeroRender.tsx` | Branches on `parseVideoSource`; adds the provider `<iframe>` + cover sizer; `unknown` → poster |
| `packages/plugins/src/video-hero/VideoHeroEditor.tsx` | Tabbed Upload \| Library \| Embed; provider indicator; warning callout; YouTube thumbnail; embed-aware muted/loop note |
| `packages/plugins/test/videoHeroPlugin.test.ts` | NEW — 66 tests |
| `packages/plugins/ARCHITECTURE.md` | § *The `video-hero` block's render contract*; tests table; sizer rationale |
| `docs/block-types.md` | § *Video embed support* split into `video` / `video-hero` subsections |
| `docs/TECH-DEBT.md` | `vid-1` residual 4 closed; new § *vid-3 residuals* (5 items) |
| `docs/plan-youtube-vimeo-embed.md` | Phase 3 marked implemented; checklists reconciled; MCP row resolved; DoD status block |
| `docs/ROADMAP.md`, `CURRENT_SLICE.md` | Status |

**No dependency was added** — the suite reuses `react-dom/server`, already present as a
`vid-2` devDependency. `package-lock.json` is untouched. `.github/workflows/ci.yml` is
untouched and needs no edit: the `Plugins unit tests` step runs `npm test` in
`packages/plugins`, which is `vitest run` with no path argument, so it discovers
`videoHeroPlugin.test.ts` by the `test/**/*.test.ts` glob (`vitest.config.ts`).

### Evidence

| # | Gate | Command | Result |
|---|------|---------|--------|
| 1 | Full rebuild, repo DoD order | `cd packages/shared && npm run build` → `plugins` → `backend` → `admin` → `renderer` | `EXECUTED` — all five succeeded |
| 2 | Typecheck, 8 workspaces | `npm run typecheck` | `EXECUTED` — clean |
| 3 | Plugins suite | `npm test -w packages/plugins` | `EXECUTED` — **172 passed** (106 pre-existing + 66 new), 3 files |
| 4 | Serving contract (`test-2`) | `cd renderer && npm run test:serving` | `EXECUTED` — 20/20, unchanged |
| 5 | Backend pure units | `cd backend && npm run test:unit` | `EXECUTED` — 51/51 |
| 6 | Renderer pure units (`test-3`) | `cd renderer && npx vitest run` | `EXECUTED` — 29/29 |
| 7 | Infra synth (`test-4`) | `cd infra && npm test` | `EXECUTED` — 15/15 |
| 8 | MCP surface | read `tools/mcp-server/src/index.ts` | `OBSERVED` — no `videoHero` in `BLOCK_SCHEMAS` or `add_block`; `video` attrs unchanged ⇒ **no sync owed** |

`cd backend && npm test` is **`NOT RUN`**: per `CLAUDE.md` it runs against real staging
DynamoDB with real credentials. This slice touches no backend code and no shared type, and
the relay's isolation rule forbids reaching the operator's live environment. Its
credential-free counterpart (gate 5) was run.

### Definition of Done

| # | Item | Evidence |
|---|------|----------|
| 1 | YouTube/Vimeo render as a background iframe with the correct params | `EXECUTED` — suite § *background element and src per kind* + § *background parameters*, each parameter asserted by name |
| 2 | Direct media renders via native `<video>` (existing behaviour preserved) | `EXECUTED` — § *native `<video>` path is unchanged apart from its src* |
| 3 | Unknown URL falls back to poster only | `EXECUTED` — two rows, plus the no-poster case asserting no element at all |
| 4 | Background iframe covers on landscape AND portrait | **`NOT RUN` — OPERATOR.** Mechanism pinned (`EXECUTED`, § *iframe cover sizer*); coverage is a layout measurement no static-markup harness can make |
| 5 | Editor exposes Upload/Library/Embed tabs; Embed shows provider detection | `EXECUTED` — § *tabbed source selector*, § *provider detection and failure state* |
| 6 | No `loading="lazy"` on the hero | `EXECUTED`, incl. a cross-check that the inline `video` block is still lazy |

### Operator visual checklist (`NOT RUN` — these are yours)

Every item below needs a real browser, a real device, or a live tenant page. They are listed
here rather than claimed. Author a `video-hero` block on a staging page to run them.

1. **Landscape cover** — wide viewport (e.g. 1600×900 and an ultra-wide 2560×1080). The
   YouTube/Vimeo background must reach all four edges with no overlay-coloured band.
2. **Portrait cover** — tall/narrow viewport (e.g. 390×844, iPhone). Same.
3. **Tall-hero boundary** — a long headline + subheadline + CTA that makes the section taller
   than the viewport. This is the known limitation in `docs/TECH-DEBT.md` § *vid-3 residuals*;
   confirm whether it is reachable with realistic copy.
4. **Direct media still plays** — an uploaded `.mp4` autoplays muted and loops as before.
5. **Unknown falls back** — paste a non-video URL: the hero shows the poster, and the editor
   shows the warning callout.
6. **Mobile autoplay** — iOS Safari and Android Chrome, both providers. Document what actually
   happens; a device that blocks muted autoplay shows a static first frame, which is a browser
   policy, not a defect.
7. **SSR / hydration** — load a hero page with a provider embed and confirm no hydration
   warning in the console and no visible flash of a different background.
8. **Editor tabs** — clicking Upload / Library / Embed switches the control; the media-library
   picker still returns a URL; Remove clears the block; a YouTube URL shows its thumbnail.
9. **Provider chrome flash** — the plan warns the player's chrome may flash on load. Note
   whether it is objectionable at the tenant's connection speed.

### Decisions taken in-flight

Recorded for ratification; none contradicts `docs/platform-decisions.md`, tenant isolation,
the no-scan rule, or a clean-architecture boundary.

- **`VID3-UNKNOWN-POSTER`** — `unknown` renders the poster, or nothing when no poster is set;
  never an empty container element. This is the slice's DoD item 3 read literally, and it is
  the deliberate divergence from `vid-2`'s `VID2-UNKNOWN-OUTPUT`. Both are correct for their
  block: an empty 16:9 box is a hole in a content column, but a hero is a text/CTA surface
  that still needs a backdrop. Do not "harmonize" these later without re-deciding.
- **`VID3-SIZER-INLINE-STYLE`** — the ratified cover CSS is emitted as an inline `style`
  object, not a class. `packages/plugins` emits no CSS at all (`npm run build` is bare `tsc`);
  a class would need a new delivery mechanism, and a Tailwind arbitrary value would make the
  cover silently depend on the consuming app's `@source` scan resolving `w-[177.7778vh]`.
  Geometry, not colour, so Critical Rule 6 is not in play, and `resolveOverlayStyle` in the
  same file already returns an inline style. The plan's `@supports not (min-width: 100%)`
  fallback is dropped as dead — its values are what the base rule already computes.
- **`VID3-EMBED-MUTED-LOOP-INERT`** — `buildBackgroundEmbedUrl` hardcodes mute+loop, so the
  block's `muted`/`loop` attributes cannot affect a provider embed. Rather than leave two
  checkboxes that silently do nothing, the editor replaces them with "Muted + looped (embed)"
  for those kinds. The stored attributes are left untouched, so switching back to an upload
  restores the author's choice. A control that lies about what it does is a defect, not a
  cosmetic issue.
- **`VID3-YT-THUMB-HQDEFAULT`** — the editor preview uses `hqdefault.jpg`, not the plan's
  `maxresdefault.jpg`. Maxres exists only for uploads at 720p or above and 404s otherwise,
  which would show a broken image for a video that embeds perfectly well.
- **`VID3-THUMB-URL-LOCAL`** — the thumbnail URL builder stays a local function in
  `VideoHeroEditor.tsx` rather than joining `common/videoSource.ts`. One concrete caller,
  admin-only (the public render never shows a thumbnail), no named second surface. The
  rejected alternative — export it from the parser module — would put a browser-facing concern
  into the one module both entry points import, for no current caller.
- **`VID3-TABS-REPLACE-HOVER-OVERLAY`** — the tabs replace the old hover-only "Replace /
  Library" overlay buttons. No capability is lost (upload → Upload tab, picker → Library tab,
  clear → an always-visible REMOVE button); the overlay's only affordances were invisible
  until hover and had no room for a third source.

### Surfaced, not acted on

- **`packages/plugins/ARCHITECTURE.md` § *Plugin File Structure* and `docs/block-types.md`
  § *Rules* both give the plugin path as `src/blocks/<name>/`. There is no `blocks/`
  directory** — plugins live at `packages/plugins/src/<name>/` (`OBSERVED`: `ls
  packages/plugins/src`). The same section is headed "All 15 Plugins" while the package holds
  ~19. Both are pre-existing drift about plugins this slice does not touch, so correcting them
  is adjacent scope; flagged for a documentation-scoped slice.
- **The MCP server exposes no `video-hero` block at all.** Not a `vid-3` regression — it never
  did — but it means the AI authoring tools cannot create or edit a hero. Adding it is new
  scope (a `BLOCK_SCHEMAS` entry plus an `add_block` enum member), not reconciliation.
- **`SOURCE_HINT` (the provider icon + label table) is now duplicated** between
  `video/VideoEditor.tsx` (`vid-2`) and `video-hero/VideoHeroEditor.tsx`. Two concrete callers
  is the repo's own threshold for hoisting into `src/common/`, and `ARCHITECTURE.md` defines
  that directory as exactly "code more than one plugin needs" — so extraction is *arguable*.
  It was NOT done, for two reasons: the duplicate is a five-line data literal, not non-trivial
  logic (drift costs a mismatched label, nothing behavioural), and hoisting it means editing
  `video/VideoEditor.tsx`, a file currently under review from `vid-2`, purely for tidiness.
  Flagged for the reviewer to rule on rather than decided unilaterally.
- **The tab strip has ARIA tab semantics but no roving arrow-key navigation.** Every tab keeps
  its own tab stop, so all three sources are keyboard-reachable and activatable — the idiom is
  Tab, not Arrow. Completing it is interaction logic with no test harness in this package
  (`docs/testing-strategy.md` §4); the gap is commented in the component rather than left for
  someone to discover.
- **The background iframe is keyboard-focusable while being decorative and
  `pointer-events: none`.** `tabIndex={-1}` would remove it from the tab order, but the plan's
  ratified pre-flight explicitly requires a `title` on every iframe — i.e. it wants this frame
  in the accessibility tree — so suppressing focus is a decision against a ratified item
  rather than an implementation detail. Left as-is, flagged.

## References

- `docs/plan-youtube-vimeo-embed.md` — Phase 3; Definition of Done items 5,6,7,12;
  Files-to-Modify; Future Considerations.
- `docs/shipped/slices/vid-1-youtube-vimeo-url-parser.md`, `docs/shipped/slices/vid-2-inline-video-embed.md`.
