# Plugin Architecture

## The #1 Rule: Split Entry Points

Plugins live in `packages/plugins/src/blocks/<name>/` and **must** have two separate entry points to prevent SSR crashes:

- `@amodx/plugins/admin` — Tiptap Node extensions + React editor UIs (browser-only, uses `NodeViewWrapper`)
- `@amodx/plugins/render` — Pure React components (SSR-safe, no browser APIs)

**Never cross-import** between plugins and `admin/` or `renderer/`.

## Plugin File Structure

```
src/blocks/<name>/
├── index.ts          # PluginDefinition export (Tiptap Node config)
├── schema.ts         # Zod schema for block attributes
├── <Name>Editor.tsx  # NodeView React component (admin-only)
└── <Name>Render.tsx  # Pure React render component (SSR-safe)
```

## Registering a New Plugin

1. Create the four files above in `src/blocks/<name>/`.
2. Add to REGISTRY array in `src/admin.ts`.
3. Add a lazy loader entry to `RENDER_LOADERS` in `src/render.ts` — a dynamic
   `import()` thunk resolving to `{ default: <Name>Render }`. Do **not** eagerly
   import render components here: the renderer code-splits each loader (`next/dynamic`)
   so a page ships only the render chunks for the block types it actually renders
   (perf-1). An eager import re-collapses every plugin into one client chunk.
4. Rebuild: `npm run build -w @amodx/plugins`.

## Dependency Injection

Plugin editors cannot import from `admin/` or call APIs directly. If an editor needs runtime data (images, tags, etc.), inject the function via `editor.storage`:

```typescript
// In admin/src/components/editor/BlockEditor.tsx
editor.storage.image.uploadFn = uploadFile;
editor.storage.image.pickFn = openMediaPicker;
editor.storage.postGrid.fetchTagsFn = fetchTags;
editor.storage.categoryShowcase.fetchCategoriesFn = fetchCategories;
editor.storage.categoryGrid.fetchCategoriesFn = fetchCategories;   // SHOP-LOOK-1C
editor.storage.form.fetchFormsFn = fetchForms;                    // SHOP-LOOK-1E (GET /forms)
```

The plugin reads from `this.editor.storage.<key>` at runtime.

## Editor UI Standard

All `*Editor.tsx` components must use this card layout for visual consistency:

```tsx
<NodeViewWrapper className="my-8">
    <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
        {/* Header: Gray bg, border-b, Icon + Label + controls */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
            ...
        </div>
        {/* Content area */}
        <div className="p-5 space-y-4">...</div>
    </div>
</NodeViewWrapper>
```

## Server-prepared block data

A render component never reads the database. When a block needs tenant data on the public site, the renderer's server
pass (`prepareBlocks` in `renderer/src/components/SitePage.tsx`) reads it before `RenderBlocks` draws the page and adds
plain fields to that block's `attrs` only: `postGrid` (`prefetchedPosts`), `categoryShowcase` (`prefetchedProducts`,
`_productPrefix`, `_categoryPrefix`, `_catalogMode`), `reviewsCarousel` (`items`), `categoryGrid` (`_categories`: the
picked active categories, each `{ id, name, description?, imageLink?, path }`, SHOP-LOOK-1C), `form` (`_form`: the active
form of `formSlug` as `{ slug, name, fields, submitButtonText, successMessage, strings }` — display data and the four
form texts of the tenant's locale table, never the notify address; SHOP-LOOK-1E), `newsletter` (`_newsletter`: the newsletter
texts of the page's language, `newsletterTexts` of @amodx/shared — never the MailerLite settings; NEWSLETTER-1). The attrs of a block travel
in the page's RSC payload, so the pass builds these values field by field. A new block that needs server data adds one
branch there; see `docs/block-types.md` per block.

## Browser submits from a block

A block that posts from the browser uses the page's globals and the build's public settings, never a renderer import
(split entry): the tenant is the `tenantId` prop (RenderBlocks gives `config.id`) or `window.AMODX_TENANT_ID`; the
reCAPTCHA key is `window.AMODX_RECAPTCHA_KEY` with `window.grecaptcha` (both injected by the renderer's `ThemeInjector`;
no key or no script → no token); the API address is `process.env.NEXT_PUBLIC_API_URL`, inlined by `next build` into the
block's chunk. Users: `contact` and `leadMagnet` (renderer proxies `/api/contact`, `/api/leads`), the showcase's
fallback fetch, `form` (`POST <API>/public/forms/{slug}/submit`, SHOP-LOOK-1E), and `newsletter` (`/api/leads` with
`source: "newsletter"`; its form component `NewsletterForm` is also the package entry `@amodx/plugins/newsletter/NewsletterForm`,
which the renderer's popup uses — NEWSLETTER-1).

## Render Component Contract

All render components receive `{ attrs: <ZodSchemaType>, tenantId?: string }` as props. They must be SSR-safe (no `window`, `localStorage`, or `useEffect` for critical rendering).
