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
| `src/render.ts` | `@amodx/plugins/render` | `RENDER_MAP` (key → React component) | Renderer RenderBlocks |

- `getExtensions()` returns an array of Tiptap Node extensions for all plugins
- `getPluginList()` returns `{key, label, icon}[]` for the editor toolbar insert menu
- `RENDER_MAP` is a `Record<string, React.FC<any>>` mapping block type keys to render components

## Plugin File Structure

Every plugin follows this pattern:

```
src/blocks/<name>/
├── index.ts          # PluginDefinition export (key, label, icon, schema, editorExtension, renderComponent)
├── schema.ts         # Zod schema for block attributes
├── <Name>Editor.tsx  # Tiptap NodeView React component (admin-only)
└── <Name>Render.tsx  # Pure React render component (SSR-safe)
```

## All 15 Plugins

| Key | Label | Attributes | Styles/Variants |
|-----|-------|-----------|-----------------|
| `hero` | Hero Section | headline, subheadline, ctaText, ctaLink, imageSrc, style | center, split, minimal |
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
`vid-2` **deleted** the inline YouTube regex from `video/VideoRender.tsx`; `video-hero` is
still on its own path until `vid-3`. After `vid-3`, no render path carries a video-URL regex.

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

## Tests

`npm test -w packages/plugins` → vitest, `test/**/*.test.ts` (`vitest.config.ts`).

| Suite | Covers |
|-------|--------|
| `test/videoSource.test.ts` (`vid-1`) | The parser's classification and emitted URLs |
| `test/videoPlugin.test.ts` (`vid-2`) | What each classification **emits** — `RENDER_MAP["video"]` markup per kind, plus `VideoEditor`'s indicator/warning output |

`vid-2` widened the scope beyond `src/common/`: `videoPlugin.test.ts` renders real plugin
components through `renderToStaticMarkup` (`react-dom/server`), which is the same code path
the renderer's SSR uses and needs **no DOM, no jsdom, no RTL, and no new dependency** — so the
suite stays in the `environment: "node"` run and stays credential-free. What it cannot reach
is INTERACTION (typing, `onChange`, Tiptap commands); that still needs the DOM/RTL harness of
`docs/testing-strategy.md` §4. Importing `src/render.ts` in a node environment is itself the
SSR-safety smoke test for the whole render entry — a top-level `window` reference anywhere in
it fails that import.

`include` is pinned to `test/` and must not be widened to `src/`. Tests import `src/`, never
`dist/`, so a stale build cannot read as a passing contract. Runs in CI's
`build-typecheck-unit` job.

## Adding a New Plugin

1. Create `src/blocks/<name>/` with schema.ts, Editor.tsx, Render.tsx, index.ts
2. Implement `PluginDefinition` interface from `src/types.ts`
3. Add to REGISTRY array in `src/admin.ts`
4. Add render component to RENDER_MAP in `src/render.ts`
5. Add block schema to MCP server's `get_block_schemas` tool if AI should use it
6. Rebuild: `cd packages/plugins && npm run build`
