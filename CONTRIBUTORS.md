# AMODX Developer Guide

This document is for engineers contributing to the AMODX core platform.

---

## 🏗 System Architecture

AMODX is a monorepo managed by NPM Workspaces.

### The Six Domains

1.  **The Brain (Context Engine):** `backend/src/context`
2.  **The Cockpit (Admin UI):** `admin/`
3.  **The Face (ISR Renderer):** `renderer/`
4.  **The Bridge (MCP Server):** `tools/mcp-server/`
5.  **The Gatekeeper:** `infra/lib/auth.ts`
6.  **The Plugins (Block Registry):** `packages/plugins`
    *   **Architecture:** Uses **Split Entry Points** to separate CMS logic from Frontend logic.
    *   `src/admin.ts`: Exports Tiptap extensions (Node Views) for the Admin.
    *   `src/render.ts`: Exports React Components for the Renderer.
    *   *Why?* This prevents the Next.js server build from crashing on Tiptap dependencies.

---

## 💻 Local Development

### 1. Initial Setup
```bash
npm install
npm run build -w @amodx/shared
npm run build -w @amodx/plugins
```

### 2. Deploy Backend
```bash
cd infra
npx cdk deploy
npm run post-deploy # Generates local .env files from AWS outputs
```

### 3. Run Admin & Renderer
Open two terminals:
```bash
# Terminal 1: Admin Panel
cd admin && npm run dev

# Terminal 2: Public Renderer
cd renderer && npm run dev
```

### 4. Watch Mode (For Plugin Dev)
If you are building a new block, run the watch script so changes compile immediately:
```bash
# Terminal 3
cd packages/plugins
npm run watch
```

---

## 🧩 How to Create a New Plugin (UI Block)

To add a new block (e.g., "Pricing Table", "FAQ", "Testimonial"), follow this strict workflow:

### Step 1: Create the Folder
Create `packages/plugins/src/pricing/`.

### Step 2: Define Schema
Create `schema.ts`. This defines the data saved to DynamoDB.
```typescript
import { z } from 'zod';
export const PricingSchema = z.object({
    title: z.string().default("Our Plans"),
    price: z.string().default("$99"),
});
```

### Step 3: Create Renderer Component
Create `PricingRender.tsx`. **CRITICAL:** Do not import `@tiptap/*` here.
```tsx
export function PricingRender({ attrs }: { attrs: any }) {
    return <div className="p-4 border">{attrs.title} - {attrs.price}</div>;
}
```

### Step 4: Create Editor Component
Create `PricingEditor.tsx`. This uses Tiptap Node Views.
```tsx
import { NodeViewWrapper } from '@tiptap/react';
export function PricingEditor(props: any) {
    const { title } = props.node.attrs;
    return (
        <NodeViewWrapper>
            <input value={title} onChange={e => props.updateAttributes({ title: e.target.value })} />
        </NodeViewWrapper>
    );
}
```

### Step 5: Bundle the Plugin
Create `index.ts` in the folder to wrap the Tiptap extension.
```typescript
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CreditCard } from 'lucide-react'; // Icon
import { PricingEditor } from './PricingEditor';
import { PricingRender } from './PricingRender';
import { PricingSchema } from './schema';

export const PricingPlugin = {
    key: 'pricing',
    label: 'Pricing Table',
    icon: CreditCard,
    schema: PricingSchema,
    editorExtension: Node.create({
        name: 'pricing',
        group: 'block',
        atom: true,
        addAttributes() { return { title: { default: 'Plans' }, price: { default: '0' } } },
        parseHTML() { return [{ tag: 'app-pricing' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-pricing', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(PricingEditor); },
    }),
    renderComponent: PricingRender
};
```

### Step 6: Register (The Split)
You must register the plugin in **two** places:

1.  **For Admin:** Edit `packages/plugins/src/admin.ts`:
    ```typescript
    import { PricingPlugin } from './pricing';
    const REGISTRY = [HeroPlugin, PricingPlugin]; // Add here
    ```

2.  **For Renderer:** Edit `packages/plugins/src/render.ts`:
    ```typescript
    import { PricingRender } from './pricing/PricingRender';
    export const RENDER_MAP = {
        'hero': HeroRender,
        'pricing': PricingRender // Add here
    };
    ```

---

## 📦 Project Structure

```text
amodx/
├── admin/                 # React SPA (Vite)
├── backend/               # Lambda Functions
├── infra/                 # AWS CDK
├── packages/
│   ├── shared/            # Types
│   └── plugins/           # UI Block Registry
│       ├── src/
│       │   ├── admin.ts   # Entry point for Admin
│       │   ├── render.ts  # Entry point for Renderer
│       │   └── hero/      # Example Block
├── renderer/              # Next.js App Router (ISR)
└── tools/
    └── mcp-server/        # AI Interface
```
