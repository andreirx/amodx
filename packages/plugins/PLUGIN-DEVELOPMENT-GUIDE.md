# AMODX Plugin Development Guide
## The Complete Architecture & Critical Patterns

---

## **The Split-Entry Point Solution:**

AMODX uses **two separate entry points** to enforce strict separation:

```
packages/plugins/src/
├── admin.ts          ← BROWSER ONLY (Tiptap + React Editor)
├── render.ts         ← SERVER ONLY (Pure React Components)
└── hero/
    ├── index.ts      ← Plugin Definition (uses Tiptap)
    ├── HeroEditor.tsx ← Admin Editor (uses NodeView)
    ├── HeroRender.tsx ← Public Renderer (pure React)
    └── schema.ts      ← Shared Validation
```

---

## ✅ Correct Import Pattern

### **File: `packages/plugins/src/admin.ts`**
```typescript
// ✅ CORRECT: Import the full Plugin (includes Tiptap extension)
import { HeroPlugin } from './hero';
import { ColumnsPlugin } from './columns';
import { TablePlugin } from './table';

export const PLUGIN_REGISTRY = [
    HeroPlugin,    // This contains the Tiptap Node definition
    ColumnsPlugin,
    TablePlugin,
];
```

### **File: `packages/plugins/src/render.ts`**
```typescript
// perf-1: LAZY loaders, not eager imports. Each thunk is a dynamic import() of ONLY the Render
// component (bypasses Tiptap). RenderBlocks wraps these in next/dynamic so a page ships only the
// render chunks for the block types it renders. An eager import re-collapses every plugin into one
// client chunk on every content page — do NOT do it.
export type RenderLoader = () => Promise<{ default: React.FC<any> }>;

export const RENDER_LOADERS: Record<string, RenderLoader> = {
    'hero':    () => import('./hero/HeroRender').then(m => ({ default: m.HeroRender })),
    'columns': () => import('./columns/ColumnsRender').then(m => ({ default: m.ColumnsRender })),
    'table':   () => import('./table/TableRender').then(m => ({ default: m.TableRender })),
    // ❌ WRONG: do NOT `import { ColumnsPlugin } from './columns'` — that pulls in the Tiptap editor.
};
```

---

## 🏗️ Plugin File Structure (Standard Pattern)

Every plugin follows this exact structure:

```
packages/plugins/src/your-plugin/
├── index.ts              ← Plugin definition (Tiptap extension)
├── YourPluginEditor.tsx  ← Admin UI (NodeView wrapper)
├── YourPluginRender.tsx  ← Public renderer (pure React)
└── schema.ts             ← Zod validation (shared)
```

### **1. schema.ts** (Shared Type Safety)
```typescript
import { z } from 'zod';

export const YourPluginSchema = z.object({
    headline: z.string().default("Default Headline"),
    items: z.array(z.object({
        id: z.string(),
        content: z.string()
    })).default([])
});
```

**Purpose:** Single source of truth for data structure. Used by both admin and renderer.

---

### **2. YourPluginEditor.tsx** (Admin Only)
```typescript
import { NodeViewWrapper } from '@tiptap/react';
import { LayoutTemplate } from 'lucide-react';
import React from 'react';

export function YourPluginEditor(props: any) {
    const { headline, items } = props.node.attrs;
    const update = (field: string, value: any) => 
        props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-8">
            {/* Your editable UI here */}
        </NodeViewWrapper>
    );
}
```

**Key Rules:**
- Must wrap everything in `<NodeViewWrapper>`
- Access attributes via `props.node.attrs`
- Update via `props.updateAttributes({ field: value })`
- Use inline styles or Tailwind (no Shadcn imports to avoid bundle bloat)
- Keep it **atomic** (no nested Tiptap editors inside)

---

### **3. YourPluginRender.tsx** (Public Site)
```typescript
import React from "react";

export function YourPluginRender({ attrs }: { attrs: any }) {
    const { headline, items = [] } = attrs;

    return (
        <section className="py-12">
            <h2 className="text-4xl font-bold">{headline}</h2>
            {items.map((item: any) => (
                <div key={item.id}>{item.content}</div>
            ))}
        </section>
    );
}
```

**Key Rules:**
- **Pure functional component** (no hooks, no state)
- Receives `attrs` as props (the saved data)
- Uses **theme variables** (`foreground`, `muted`, `border`, `primary`)
- Must be **SSR-safe** (no `window`, no `document`, no browser APIs)
- Responsive by default (mobile-first Tailwind)

---

### **4. index.ts** (Plugin Definition)
```typescript
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { LayoutTemplate } from 'lucide-react';
import { YourPluginSchema } from './schema';
import { YourPluginEditor } from './YourPluginEditor';
import { YourPluginRender } from './YourPluginRender';
import { PluginDefinition } from '../types';

export const YourPlugin: PluginDefinition = {
    key: 'yourplugin',           // Unique identifier (lowercase)
    label: 'Your Plugin',        // Display name in UI
    icon: LayoutTemplate,        // Lucide icon
    schema: YourPluginSchema,    // Zod schema

    editorExtension: Node.create({
        name: 'yourplugin',      // Must match key
        group: 'block',
        atom: true,              // Atomic block (no nested content)

        addAttributes() {
            return {
                headline: { default: 'Default' },
                items: { default: [] }
            };
        },

        parseHTML() {
            return [{ tag: 'app-yourplugin' }];
        },

        renderHTML({ HTMLAttributes }) {
            return ['app-yourplugin', mergeAttributes(HTMLAttributes)];
        },

        addNodeView() {
            return ReactNodeViewRenderer(YourPluginEditor);
        },
    }),

    renderComponent: YourPluginRender  // Public renderer
};
```

**Purpose:** Ties everything together. Defines how the block behaves in the editor and how it renders publicly.

---

## 📦 Integration Checklist

### **Step 1: Add to Admin Registry**
**File:** `packages/plugins/src/admin.ts`
```typescript
import { YourPlugin } from './your-plugin';

export const PLUGIN_REGISTRY = [
    // ... existing plugins
    YourPlugin,  // ✅ Import the full plugin object
];
```

### **Step 2: Add to Render Registry**
**File:** `packages/plugins/src/render.ts`
```typescript
export const RENDER_LOADERS: Record<string, RenderLoader> = {
    // ... existing plugins
    // ✅ Lazy loader → resolves to { default: <the render component> }. perf-1 code-splitting.
    'yourplugin': () => import('./your-plugin/YourPluginRender').then(m => ({ default: m.YourPluginRender })),
};
```

### **Step 3: Rebuild**
```bash
cd packages/plugins
npm run build
```

### **Step 4: Update MCP Server** (Optional but recommended)
**File:** `tools/mcp-server/src/index.ts`

Add your block to `BLOCK_SCHEMAS`:
```typescript
const BLOCK_SCHEMAS = {
    // ... existing blocks
    yourplugin: {
        description: "Your plugin description",
        attrs: {
            headline: "string",
            items: "array of objects"
        },
        example: { /* ... */ }
    }
};
```

Add to `add_block` enum:
```typescript
type: z.enum([
    "hero", "pricing", /* ... */ "yourplugin"
])
```

---

## 🐛 Common Errors & Fixes

### **Error: "Class extends value undefined"**
**Cause:** You imported the Plugin object into `render.ts`
**Fix:** Import only the `*Render.tsx` component

```typescript
// ❌ WRONG — imports the Tiptap Plugin object (drags the editor into the render bundle)
export const RENDER_LOADERS = { columns: () => import('./columns').then(m => ({ default: m.ColumnsPlugin.renderComponent })) };

// ✅ CORRECT — lazy import of the Render component only
export const RENDER_LOADERS = { columns: () => import('./columns/ColumnsRender').then(m => ({ default: m.ColumnsRender })) };
```

---

### **Error: "window is not defined"**
**Cause:** Browser code in the renderer component
**Fix:** Remove all browser APIs from `*Render.tsx`:
- No `window`, `document`, `localStorage`
- No `useState`, `useEffect`, event listeners
- No DOM manipulation

---

### **Error: "Module not found: @amodx/plugins"**
**Cause:** Plugins package not built
**Fix:**
```bash
npm run build -w @amodx/plugins
```

---

### **Error: TypeScript: "Property 'yourplugin' does not exist"**
**Cause:** Plugin key mismatch between `index.ts` and `render.ts`
**Fix:** Ensure the key in `PluginDefinition` matches the key in `RENDER_LOADERS`:
```typescript
// In index.ts
export const YourPlugin: PluginDefinition = {
    key: 'yourplugin',  // ← Must match below
    // ...
};

// In render.ts
export const RENDER_LOADERS = {
    'yourplugin': () => import('./your-plugin/YourPluginRender').then(m => ({ default: m.YourPluginRender })),  // ← Must match above
};
```

---

## 🎯 Design Principles

### **1. Atomic Blocks**
- Each plugin is a **single unit** (`atom: true`)
- No nested Tiptap editors inside columns/cells
- Content is stored as **plain data** (strings, arrays)
- Simplifies state management and avoids circular dependencies

### **2. Server-Client Separation**
- **Admin (Browser):** Tiptap + React + DOM
- **Render (Server):** Pure React + Props
- Never mix these environments

### **3. Theme Variables**
Renderer components use Tailwind's theme variables (injected at runtime):
```css
text-foreground      /* Main text color */
bg-background        /* Page background */
bg-muted             /* Cards, sidebars */
border-border        /* Borders */
text-primary         /* Brand color */
```

This allows each tenant to customize their site without recompiling.

### **4. Mobile-First**
- All layouts stack on mobile (`flex-wrap`, responsive grid)
- Tables scroll horizontally (`overflow-x-auto`)
- Images are responsive by default

---

## 📊 Data Flow

```
User edits in Admin
    ↓
YourPluginEditor (Tiptap NodeView)
    ↓
Updates props.node.attrs
    ↓
Saves to DynamoDB (ContentItem.blocks[])
    ↓
Next.js Renderer fetches blocks
    ↓
RENDER_LOADERS['yourplugin'] → next/dynamic → YourPluginRender chunk (loaded on demand)
    ↓
Renders to HTML (SSR/ISR)
    ↓
Served to visitor
```

---

## 🧪 Testing Strategy

### **Admin Testing:**
1. Start dev server: `cd admin && npm run dev`
2. Insert block via block menu
3. Edit attributes
4. Save page
5. Check network tab for PUT request

### **Renderer Testing:**
1. Publish page (status: "Published")
2. Visit public URL
3. Verify responsive behavior (mobile/desktop)
4. Check browser console for hydration errors

### **SSR Safety Check:**
```bash
# Build the renderer
cd renderer && npm run build

# Check for errors
# Look for "window is not defined" or similar
```

---

## 📝 Summary: The Golden Rules

1. **Split Entry Points:** `admin.ts` imports Plugins, `render.ts` imports Components
2. **No Tiptap in Renderer:** Never import `@tiptap/*` in `*Render.tsx`
3. **Atomic Blocks:** Keep blocks self-contained, no nesting
4. **Theme Variables:** Use Tailwind's CSS variables in renderer
5. **SSR-Safe Renderer:** No browser APIs in `*Render.tsx`
6. **Rebuild After Changes:** Always `npm run build -w @amodx/plugins`

---

## 🔍 Quick Reference

| File | Purpose | Imports Tiptap? | Runs Where? |
|------|---------|-----------------|-------------|
| `index.ts` | Plugin definition | ✅ Yes | Browser (Admin) |
| `*Editor.tsx` | Admin UI | ✅ Yes | Browser (Admin) |
| `*Render.tsx` | Public UI | ❌ No | Server (Renderer) |
| `schema.ts` | Validation | ❌ No | Both |
| `admin.ts` | Registry | ✅ Yes | Browser (Admin) |
| `render.ts` | Registry | ❌ No | Server (Renderer) |

---

## 🚀 Next Steps

After creating a plugin:
1. Test in admin (insert, edit, save)
2. Test in renderer (publish page, view public site)
3. Add Playwright test (optional)
4. Update MCP server schemas
5. Document in user-facing docs

**Remember:** The "pollution" error is the #1 cause of Next.js build failures. Always import render components directly, never through the Plugin object.

---

**Version:** Sprint 2 (Dec 2025)
**Plugins:** 13 blocks (Hero, Pricing, Contact, Image, Video, LeadMagnet, Features, CTA, Testimonials, Columns, Table, Paragraph, Heading)
