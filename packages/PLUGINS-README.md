# AMODX Plugins (The Block Registry)

This workspace contains the UI definitions for the Content Blocks (Hero, Pricing, Contact, etc.).

## 🏗 Architecture: Split Entry Points

To prevents Server-Side Rendering crashes in Next.js, we split the exports:

1.  **`src/admin.ts`**: Exports Tiptap Extensions (uses `window`, DOM access). Used ONLY by Admin.
2.  **`src/render.ts`**: Exports React Components. Used by Renderer.

**⚠️ NEVER import from `src/index.ts` directly in the apps.**

## 🧩 How to Create a New Block

1.  **Folder:** Create `src/my-block/`.
2.  **Schema:** Define Zod schema in `schema.ts`.
3.  **Render:** Create `MyBlockRender.tsx` (Pure React).
4.  **Editor:** Create `MyBlockEditor.tsx` (Tiptap Node View).
5.  **Index:** Bundle it into a `PluginDefinition` object.
6.  **Register:** Add to `REGISTRY` in `src/admin.ts` AND `RENDER_MAP` in `src/render.ts`.
7.  **Build:** Run `npm run build` in this folder.

## 📦 Available Blocks
*   **Hero:** Headline, Image, CTA.
*   **Pricing:** Multi-column plans grid.
*   **Image:** S3-backed image with alignment/caption.
*   **Video:** YouTube/Vimeo embed.
*   **Contact:** Lead capture form (Public).
*   **Lead Magnet:** Gated content form (Private).
