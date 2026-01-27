# packages/plugins — MAP.md

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
| `video` | Video Embed | url, caption, width, autoplay | centered, wide, full |
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

## Adding a New Plugin

1. Create `src/blocks/<name>/` with schema.ts, Editor.tsx, Render.tsx, index.ts
2. Implement `PluginDefinition` interface from `src/types.ts`
3. Add to REGISTRY array in `src/admin.ts`
4. Add render component to RENDER_MAP in `src/render.ts`
5. Add block schema to MCP server's `get_block_schemas` tool if AI should use it
6. Rebuild: `cd packages/plugins && npm run build`
