# Packages

Shared npm workspaces consumed by backend, admin, and renderer.

## `shared/`

Single source of truth for types and Zod schemas. 30+ schemas including TenantConfig, ProductSchema, OrderSchema, ContentItemSchema, country packs.

Build first — everything depends on it.

```bash
cd packages/shared && npm run build
```

## `plugins/`

20 block plugins with split entry points to prevent SSR crashes:

- `@amodx/plugins/admin` — Tiptap extensions (browser-only). Used by admin.
- `@amodx/plugins/render` — React components (SSR-safe). Used by renderer.

Each plugin: `schema.ts` (Zod) + `*Editor.tsx` (NodeViewWrapper) + `*Render.tsx` (pure React) + `index.ts` (PluginDefinition).

Plugins: hero, videoHero, pricing, image, contact, video, leadMagnet, cta, features, testimonials, columns, table, html, faq, postGrid, carousel, codeBlock, reviewsCarousel (commerce), categoryShowcase (commerce), markdown.

Dependencies: highlight.js (syntax highlighting), marked (markdown parsing), swiper (carousel).

### Adding a Plugin

1. Create `src/my-plugin/` with schema.ts, Editor.tsx, Render.tsx, index.ts
2. Add to `REGISTRY` in `src/admin.ts`
3. Add a lazy loader to `RENDER_LOADERS` in `src/render.ts` (dynamic `import()` thunk → `{ default: <Name>Render }`; perf-1 code-splitting)
4. `npm run build`
