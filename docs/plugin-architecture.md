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
3. Add to RENDER_MAP in `src/render.ts`.
4. Rebuild: `npm run build -w @amodx/plugins`.

## Dependency Injection

Plugin editors cannot import from `admin/` or call APIs directly. If an editor needs runtime data (images, tags, etc.), inject the function via `editor.storage`:

```typescript
// In admin/src/components/editor/BlockEditor.tsx
editor.storage.image.uploadFn = uploadFile;
editor.storage.image.pickFn = openMediaPicker;
editor.storage.postGrid.fetchTagsFn = fetchTags;
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

## Render Component Contract

All render components receive `{ attrs: <ZodSchemaType>, tenantId?: string }` as props. They must be SSR-safe (no `window`, `localStorage`, or `useEffect` for critical rendering).
