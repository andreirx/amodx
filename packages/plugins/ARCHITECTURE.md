# packages/plugins — ARCHITECTURE.md

## Role in the System

The block plugin registry. Defines the visual building blocks used in the Tiptap content editor (admin) and the public site renderer. Each plugin has a split architecture: an editor component for the admin panel and a render component for the public site.

**Consumed by:** admin (editor extensions), renderer (render components)
**Depends on:** packages/shared (Zod schemas), @tiptap/core, @tiptap/react, react, lucide-react, swiper

## Entry Points

Three separate entry points keep bundles lean:

| Entry | Import Path | Exports | Used By |
|-------|-------------|---------|---------|
| `src/index.ts` | `@amodx/plugins` | `types` only | Type-level imports |
| `src/admin.ts` | `@amodx/plugins/admin` | `getExtensions()`, `getPluginList()` | Admin BlockEditor |
| `src/render.ts` | `@amodx/plugins/render` | `RENDER_LOADERS` (key → lazy render loader) | Renderer RenderBlocks |

- `getExtensions()` returns an array of Tiptap Node extensions for all plugins
- `getPluginList()` returns `{key, label, icon}[]` for the editor toolbar insert menu
- `RENDER_LOADERS` is a `Record<string, () => Promise<{ default: React.FC<any> }>>` mapping block type
  keys to **dynamic `import()` thunks** (perf-1). It replaced the eager `RENDER_MAP`: because the
  renderer's `RenderBlocks` is a client component, an eager map pulled every plugin (incl.
  highlight.js / marked / swiper) into one ~1.2 MB client chunk on every content page. RenderBlocks
  now wraps each loader in `next/dynamic`, so a page ships only the render chunks for the block types
  it renders. The thunks are plain ESM `import()` — no framework coupling — so the split-entry rule
  (render vs admin) holds. See `docs/slices/perf-1-unused-js.md`.

## Plugin File Structure

Every plugin follows this pattern:

```
src/blocks/<name>/
├── index.ts          # PluginDefinition export (key, label, icon, schema, editorExtension, renderComponent)
├── schema.ts         # Zod schema for block attributes
├── <Name>Editor.tsx  # Tiptap NodeView React component (admin-only)
└── <Name>Render.tsx  # Pure React render component (SSR-safe)
```

## All 20 Plugins

This table lists every key in `RENDER_LOADERS` (`src/render.ts`) — one row per registered
render loader. It must stay in sync with that map (perf-1: 20 loaders).

| Key | Label | Attributes | Styles/Variants |
|-----|-------|-----------|-----------------|
| `hero` | Hero Section | headline, subheadline, ctaText, ctaLink, imageSrc, style | center, split, minimal |
| `videoHero` | Video Hero | headline, subheadline, videoSrc, posterSrc, ctaText, ctaLink, overlay/heading color tokens, muted, loop, blockWidth | direct → native `<video>`, YouTube/Vimeo → cover `<iframe>`, unknown → poster (see § *The `video-hero` block's render contract*) |
| `pricing` | Pricing Table | headline, subheadline, plans[] (title, price, interval, features, highlight) | — |
| `image` | Image | src, alt, caption, width, aspectRatio | full, wide, centered |
| `contact` | Contact Form | headline, description, buttonText, successMessage, tags | — |
| `video` | Video Embed | url, caption, width, autoplay | centered, wide, full; YouTube/Vimeo → iframe, direct media → native `<video>`, unrecognized → nothing (see § *The `video` block's render contract*) |
| `leadMagnet` | Lead Magnet | headline, description, buttonText, resourceId, fileName, tags | — |
| `cta` | Call to Action | headline, subheadline, buttonText, buttonLink, style | simple, card, band |
| `features` | Feature Grid | headline, subheadline, items[] (title, description, icon), columns | 2, 3, or 4 columns |
| `testimonials` | Testimonials | headline, subheadline, items[] (quote, author, role, avatar), style | grid, slider, minimal |
| `columns` | Column Layout | columnCount, gap, columns[] (width, content) | 2-4 cols, sm/md/lg gap |
| `table` | Data Table | headers[], rows[] (cells[]), striped, bordered | — |
| `html` | Raw HTML | content, isSandboxed | — |
| `faq` | FAQ Accordion | headline, items[] (question, answer) | Generates FAQPage JSON-LD |
| `postGrid` | Post Grid | headline, filterTag, limit, showImages, layout, columns | grid, list; 2 or 3 cols |
| `carousel` | Carousel | headline, items[] (title, description, image, link), height, style | standard, coverflow (Swiper) |
| `codeBlock` | Code Block | code, language, filename, showLineNumbers, blockWidth | 19 languages; dark `<pre><code>` + copy button |
| `reviewsCarousel` | Reviews Carousel | headline, scope, productId, items[] (name, avatar, date, rating, text, source, photos), showSource, autoScroll, maxLines, blockWidth | manual / product-reviews-by-id / site-reviews (see § *The `reviews-carousel` block's render contract*) |
| `categoryShowcase` | Category Showcase | categoryId, categoryName, categorySlug, limit, columns, showPrice, ctaText, blockWidth | 2 / 3 / 4 columns |
| `markdown` | Markdown | content, blockWidth | rendered via `marked` (async chunk) |

## Tiptap Integration Pattern

Each plugin registers as a Tiptap `Node` extension:
- `name`: matches the plugin key
- `group: 'block'`, `atom: true` — block-level, non-editable inline
- `addAttributes()`: defines default values for all block attrs
- `addNodeView()`: returns `ReactNodeViewRenderer(EditorComponent)` for the admin UI
- `parseHTML()` / `renderHTML()`: HTML serialization (used for clipboard)

## Storage Injection

Plugins access runtime dependencies via `editor.storage.<key>`:
- `editor.storage.image.uploadFn` — file upload to S3 (presigned URL)
- `editor.storage.image.pickFn` — open media library picker dialog
- `editor.storage.postGrid.fetchTagsFn` — load available tags for autocomplete

These are injected by the admin's BlockEditor component before the editor mounts.

## Render Component Contract

All render components receive: `{ attrs: <schema type>, tenantId?: string }`

Client-side components (contact form, lead magnet, post grid) use `window.AMODX_TENANT_ID` for API calls and submit to `/api/contact`, `/api/leads`, or `/api/posts`.

## Shared modules under `src/common/`

Code more than one plugin needs. Imported by RELATIVE path from the plugin directories, so
it works from both the `admin` and `render` entry points without either importing the other
— which is what keeps Critical Rule 1 (plugin split entry) intact. A module here that is not
SSR-safe would break the renderer's server bundle, so anything with a `window` / `document`
reference belongs in a plugin's `*Editor.tsx`, not here.

| Module | What |
|--------|------|
| `videoSource.ts` | **Video URL parser** (slice `vid-1`). `parseVideoSource()` classifies a pasted URL four ways — `youtube` \| `vimeo` \| `direct` \| `unknown` — returning `{ kind, rawUrl, embedUrl, providerId? }`. **`embedUrl` is not uniformly safe:** for `youtube`/`vimeo` it is *rebuilt* from a validated provider id (nothing of the caller's string survives), for `direct` it is the caller's raw URL *verbatim* (`embedUrl === rawUrl` — the plan's rule 3 contract; trimming happens only to classify), and for `unknown` it is `null`. `buildEmbedUrl()` / `buildBackgroundEmbedUrl()` construct player URLs from an id; `isDirectMediaUrl()` detects uploaded media — extension **and** an absent/`http`/`https` scheme, so a `javascript:`/`data:`/`file:` string ending in `.mp4` classifies `unknown`, never `direct` (ratified 2026-07-28, `VID1-DIRECT-SCHEME-CONTRACT`; it is defence in depth, **not** a substitute for encoding output in the render path). Pure, **total** (never throws; `""` → `unknown`, `embedUrl: null`), **zero imports** — so SSR-safety is a property of the file, not of a dependency. Unit-tested. |
| `resolveButtonEffect.ts` | Converts the legacy `GlowEffectConfig` to the unified `EffectConfig` on read |
| `resolveCoverColorTokens.ts` | Cover/overlay colour token resolution |
| `EffectControls.tsx`, `EffectPreview.tsx` | Admin-side effect configuration UI; the only two entries `package.json` exports individually (`@amodx/plugins/common/EffectControls`, `…/EffectPreview`) for the admin app |
| `ButtonEffectWrap.tsx` | Button effect compositor (four-layer shell + chip) |
| `LazyEffectCanvas.tsx` | Lazily-loaded block background effect canvas; carries `'use client'` |
| `InlineRichTextField.tsx`, `InlineRichTextRenderer.tsx` | Inline rich-text editing field and its render counterpart |

*(The one-line descriptions of the pre-`vid-1` modules are read from their file headers;
`vid-1` characterized only `videoSource.ts` and did not re-audit the others.)*

`videoSource.ts` is the SUPPORT module `vid-2` (`video`) and `vid-3` (`video-hero`) consume.
`vid-2` **deleted** the inline YouTube regex from `video/VideoRender.tsx`; `vid-3` put
`video-hero` on the same parser. **No render path in this package now carries a video-URL
regex, and none may grow one** — both video blocks branch on `parseVideoSource` and nothing
else, so they cannot disagree about what a pasted URL means.

## The `video` block's render contract (slice `vid-2`)

`video/VideoRender.tsx` branches on `parseVideoSource(attrs.url).kind` and nothing else:

| Kind | Element | `src` | Notes |
|------|---------|-------|-------|
| `youtube` / `vimeo` | `<iframe>` | `buildEmbedUrl(kind, providerId, { autoplay })` — **rebuilt from the validated id**, nothing of the pasted string survives | `loading="lazy"` + `title` (the caption, else `"Embedded video"`) |
| `direct` | `<video controls>` | `embedUrl`, which for this kind IS the raw URL | `autoPlay` implies `muted` + `playsInline`, or the browser blocks it; no `loading` |
| `unknown` | *(none — returns `null`)* | — | Empty `url` classifies here too. **No markup at all**, so a bad URL leaves no artifact on a public page |

The `unknown` branch is silent by design, so the author's only signal is editor-side:
`video/VideoEditor.tsx` shows a provider indicator (icon shape + label, `text-muted-foreground`
— never brand colour, Critical Rule 6) for the three recognized kinds, and a neutral-token
warning callout for a non-empty unrecognized URL. Validation is warning-only and never blocks
a save. Both surfaces call the SAME classifier, so what the editor promises and what the page
renders cannot drift.

**Do not read "the parser returned an `embedUrl`" as "the parser returned a safe URL"** —
true for `youtube`/`vimeo`, false for `direct` (`docs/TECH-DEBT.md` § *vid-1 residuals*).
The render path's three defences are: provider URLs are rebuilt from a validated id;
`direct` is constrained by `isDirectMediaUrl`'s http(s) scheme guard; and `rawUrl` is **never**
rendered — it stays in the editor for echo-back. No `dangerouslySetInnerHTML` on this path.

## The `video-hero` block's render contract (slice `vid-3`)

`video-hero/VideoHeroRender.tsx` branches on `parseVideoSource(attrs.videoSrc).kind`:

| Kind | Background element | `src` | Notes |
|------|--------------------|-------|-------|
| `direct` | native `<video autoplay playsinline>` | `embedUrl`, which for this kind IS the raw URL | `muted` / `loop` stay author-controlled; `object-cover` does the covering |
| `youtube` / `vimeo` | `<iframe>` | `buildBackgroundEmbedUrl(kind, providerId)` — **rebuilt from the validated id** | cover via the inline sizer below; `title`; `allow="autoplay; …"`; **no** `loading="lazy"` |
| `unknown` | the poster `<img>`, or nothing when no poster is set | — | Empty `videoSrc` classifies here too |

Note the deliberate divergence from the `video` block: `unknown` there renders **nothing**
(`VID2-UNKNOWN-OUTPUT`), because an empty 16:9 box is a black hole in a content column. Here
it renders the **poster**, because a hero is a full-bleed text/CTA surface that still has to
have a backdrop. Both are ratified; they are not an inconsistency to "fix".

**Why the iframe needs a sizer at all.** `object-fit: cover` is a property of REPLACED
elements. An `<iframe>` is not one — it is a viewport onto another document, and the provider
letterboxes its 16:9 video inside whatever box it is given. So cover is done by sizing the
box: `width: max(177.7778vh, 100%)` against `height: max(100vh, 56.25vw)`, centred with
`translate(-50%, -50%)`. Both pairs are exactly 16:9, so whichever wins the video fills the
box and the overflow crops symmetrically — landscape wins on the `vh` pair, portrait on the
`vw` pair. It is an **inline style**, not a class: this package emits no CSS (`npm run build`
is bare `tsc`, there is no bundler and no `.css` file), so a class would need a new delivery
mechanism, and a Tailwind arbitrary value would make the cover depend on the consuming app's
`@source` scan. It is geometry, not colour, so Critical Rule 6 is not in play.

Known boundary, recorded in `docs/TECH-DEBT.md` § *vid-3 residuals*: the `vh` terms are
viewport-relative while the section is `min-h-[70vh]`, so a hero made taller than the
viewport by its own headline/CTA can stop being fully covered.

The editor mirrors the render: `VideoHeroEditor.tsx` has a **tabbed** Upload | Library |
Embed selector over the single `videoSrc` attribute, a provider indicator and warning callout
driven by the SAME classifier, a YouTube thumbnail preview
(`img.youtube.com/vi/{id}/hqdefault.jpg` — `hqdefault`, not `maxresdefault`, which 404s for
sub-720p uploads), and — because `buildBackgroundEmbedUrl` hardcodes mute+loop — it replaces
the Muted/Loop checkboxes with a statement of fact whenever the source is a provider embed,
rather than leaving two controls that silently do nothing.

## The `reviews-carousel` block's render contract (slice `rev-4`)

`reviewsCarousel` (`src/reviews-carousel/`) renders customer reviews as a horizontally-scrolling
card strip. Beyond the authored fields it carries a **data-source discriminator**, `scope`
(`ReviewsCarouselSchema`), with three values — the block is where a review's approved *photos*
reach visitor markup:

| `scope` | `items` source | Photos |
|---------|----------------|--------|
| `manual` (default) | author-typed `items` (unchanged original behaviour) | never rendered |
| `product-reviews-by-id` | server prefetch REPLACES `items` with a product's approved reviews (by the `productId` attr) | rendered |
| `site-reviews` | server prefetch REPLACES `items` with the tenant's approved SITE-scope (`SITEREVIEW#`) reviews | rendered |

**The prefetch lives in the renderer, not here.** `ReviewsCarouselRender` is a pure view: it
consumes an `items[]` whose `photos` are already resolved public URLs. The DB reads
(`getSiteReviews` / `getProductReviews`), the approved-only + private-key-leak filter, and the
assetKey→URL resolution all live in `renderer/src/lib/review-images.ts` + `SitePage.tsx`'s prefetch
branches (see the renderer ARCHITECTURE § *Review images*). This keeps Critical Rule 1 (split
entry) intact — the block imports no renderer/DB code.

**Photos are DB-scope-gated in the render, defence-in-depth.** `items[].photos` is NOT
author-editable (only the server prefetch writes it), but `RenderBlocks` passes persisted attrs
through WITHOUT schema-parsing, so a hand-edited `manual`/legacy block could carry an injected
`photos` array. `ReviewsCarouselRender` therefore emits photo markup ONLY when
`scope ∈ {site-reviews, product-reviews-by-id}`; a non-DB scope renders no thumbnail regardless of
`item.photos`, so an unmoderated URL can never reach markup. Photos render as bounded lazy `<img>`
inside a plain `<a target="_blank">` to the full image — RAW asset URLs, **never** `next/image`
(opennext-1 parking rule).

The editor (`ReviewsCarouselEditor.tsx`) exposes the `scope` toggle and a `productId` input (shown
only for `product-reviews-by-id`); in the two DB scopes the manual item editor is hidden.

## Tests

`npm test -w packages/plugins` → vitest, `test/**/*.test.ts` (`vitest.config.ts`).

| Suite | Covers |
|-------|--------|
| `test/videoSource.test.ts` (`vid-1`) | The parser's classification and emitted URLs |
| `test/videoPlugin.test.ts` (`vid-2`) | What each classification **emits** — `RENDER_LOADERS["video"]` markup per kind, plus `VideoEditor`'s indicator/warning output |
| `test/videoHeroPlugin.test.ts` (`vid-3`) | The same for `RENDER_LOADERS["videoHero"]`: background element + `src` per kind, the YouTube/Vimeo background parameters named individually, the cover sizer's emitted declarations, `VideoHeroSchema` round-trip (pinning the "schema unchanged" non-scope), and the editor's tabs / indicator / warning / preview |
| `test/reviewsCarousel.test.ts` (`rev-4`) | `RENDER_LOADERS["reviewsCarousel"]` photo markup in a DB scope (lazy `<img>`, `alt`, `<a href>` to the full URL, no `/_next/image`); the **DB-scope gate** — a `manual`/legacy block with an injected `photos` array emits NO thumbnail; and the editor's three `scope` options + conditional `productId` input |
| `test/renderLoaders.test.ts` (`perf-1`) | The **whole-entry SSR-safety binding**: `await`s every `RENDER_LOADERS` entry in `environment: "node"`, forcing each render module to load, and asserts each resolves to a `{ default: <function component> }`. Catches a module-load `window`/`document` hazard in ANY registered render module (the guarantee eager `RENDER_MAP` gave for free before lazy loaders removed it). Also pins loader count = 20, so a new plugin added to the map without its own suite is still covered by this file. Does NOT render the components (no browser-free *render* proof — the per-plugin suites do that) |

`vid-2` widened the scope beyond `src/common/`: `videoPlugin.test.ts` renders real plugin
components through `renderToStaticMarkup` (`react-dom/server`), which is the same code path
the renderer's SSR uses and needs **no DOM, no jsdom, no RTL, and no new dependency** — so the
suite stays in the `environment: "node"` run and stays credential-free. What it cannot reach
is INTERACTION (typing, `onChange`, Tiptap commands); that still needs the DOM/RTL harness of
`docs/testing-strategy.md` §4.

**SSR-safety binding (perf-1 correction).** Before perf-1, `src/render.ts` *eagerly* imported
every render component, so merely importing it in a node environment executed all of them and a
top-level `window` reference anywhere would fail that import. After perf-1 the entry holds only
lazy `import()` thunks: importing `RENDER_LOADERS` executes NONE of the component modules, so it
is NO LONGER a whole-entry SSR smoke test on its own. The per-plugin suites below each `await` and
render only THEIR loader, so each covers only its own module. The whole-entry guarantee now lives
in `test/renderLoaders.test.ts`: it `await`s every `RENDER_LOADERS` entry in `environment: "node"`,
which forces each render module to load. That detects **module-load** SSR hazards (a top-level
`window`/`document` reference in any registered render module) for all 20 loaders. It does NOT
render each component, so it does not prove browser-free *render execution* — the per-plugin
suites do that for the components they exercise.

`vid-3` follows the same pattern, and adds one caveat worth knowing before writing the next
editor test: `VideoHeroEditor` embeds `InlineRichTextField`, whose Tiptap `useEditor` detects
SSR, logs one notice, and returns `null`. The field therefore renders empty under
`renderToStaticMarkup`. That is expected — the editor is browser-only by construction — but
it means an assertion about rich-text OUTPUT cannot be written in this harness.

Neither suite can reach anything requiring layout. `vid-3`'s cover geometry is asserted as
EMITTED CSS declarations; whether those declarations visually cover a landscape and a
portrait viewport, whether mobile autoplay is permitted by the device, and whether hydration
is visually smooth are MEASUREMENTS and remain the operator's — see
`docs/slices/vid-3-video-hero-block.md` § *Operator visual checklist*.

`include` is pinned to `test/` and must not be widened to `src/`. Tests import `src/`, never
`dist/`, so a stale build cannot read as a passing contract. Runs in CI's
`build-typecheck-unit` job.

## Adding a New Plugin

1. Create `src/blocks/<name>/` with schema.ts, Editor.tsx, Render.tsx, index.ts
2. Implement `PluginDefinition` interface from `src/types.ts`
3. Add to REGISTRY array in `src/admin.ts`
4. Add a lazy loader entry to `RENDER_LOADERS` in `src/render.ts` — a dynamic `import()` thunk
   resolving to `{ default: <Name>Render }`; do NOT eagerly import (perf-1 code-splitting)
5. Add block schema to MCP server's `get_block_schemas` tool if AI should use it
6. Rebuild: `cd packages/plugins && npm run build`
