# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AMODX is a serverless multi-tenant CMS and agency operating system built on AWS. It manages up to 99 tenant websites from a single deployment. The system uses a block-based content editor (Tiptap) with a plugin architecture for extensible content types.

## Monorepo Structure

npm workspaces monorepo with these packages:

- **infra/** - AWS CDK infrastructure (DynamoDB, Lambda, Cognito, CloudFront, S3, SES, EventBridge)
- **backend/** - Node.js Lambda function handlers (API Gateway HTTP API)
- **admin/** - React 19 SPA with Vite (control panel for content, products, leads, settings)
- **renderer/** - Next.js 16 multi-tenant public site engine (uses OpenNext for AWS deployment)
- **packages/shared/** - Shared TypeScript types and Zod schemas
- **packages/plugins/** - Block registry with split entry points (`admin` for Tiptap editors, `render` for React components)
- **tools/mcp-server/** - Claude MCP server for AI-assisted content management

## Coding Standards & Critical Rules

### 1. Plugin Architecture (The #1 Rule)
To prevent Server-Side Rendering crashes and Circular Dependencies:
-   **Split Entry:** `admin.ts` (Browser) vs `render.ts` (Server).
-   **No Cross-Imports:** Plugins in `packages/plugins` **CANNOT** import from `admin/` or `renderer/`.
-   **Dependency Injection:** If a Plugin Editor needs to fetch data (e.g., Tags, Images), the function must be injected via `editor.storage` in `admin/src/components/editor/BlockEditor.tsx`.
-   **Editor UI Style:** All Editor components (`*Editor.tsx`) must be wrapped in a **Standard Card Layout**:
    ```tsx
    <NodeViewWrapper className="my-8">
        <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
            {/* Header: Gray bg, border-b, Icon + Label + specific controls */}
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">...</div>
            {/* Content: p-5 padding */}
            <div className="p-5 space-y-4">...</div>
        </div>
    </NodeViewWrapper>
    ```

### 2. Database Patterns (Single Table Design)
-   **No Scans:** Never use `ScanCommand` in production paths. Use `QueryCommand` with `PK` and `SK`.
-   **Projections:** When listing items (`backend/src/*/list.ts`), **ALWAYS** use `ProjectionExpression` to fetch metadata only. Never fetch full content blocks in a list view (avoids 1MB limit & timeouts).
-   **Isolation:** Every DB operation must validate `x-tenant-id` header. Never query `TENANT#...` without an explicit tenant context.
-   **Versioning:** Content updates use "Copy-on-Write". Move current `LATEST` to `v{N}`, then overwrite `LATEST`.
-   **System Routes:** Backend handlers must enforce immutability for System Routes (`/` and `/contact`).

### 3. Frontend Architecture
-   **Renderer (Next.js):**
    -   **SEO Pre-fetching:** Dynamic blocks (like PostGrid) must have their data fetched server-side in `page.tsx` and injected into `block.attrs`. Do not rely solely on `useEffect` for SEO-critical content.
    -   **Hydration Safety:** Do not access `window` or `localStorage` without a `useEffect` or `typeof window !== 'undefined'` check.
    -   **Images:** Use `img` tags or unoptimized `Image` if using external CDNs to avoid Lambda bandwidth costs.
-   **Admin (Vite):**
    -   Use `TenantContext` for all data fetching.
    -   Handle 403/401 errors by redirecting to Login.

### 4. Styling (Tailwind)
-   **Theming:** Do not use hardcoded colors (e.g., `bg-blue-500`). Use CSS Variables (e.g., `bg-primary`, `text-muted-foreground`) to support multi-tenancy.
-   **Spacing:** Use standard Tailwind spacing (e.g., `p-6`, `gap-4`).
-   **Editors:** Wrap all Plugin Editors in a standard "Clean Card" container (White BG, Gray Border, Header Bar) with `p-5` content padding.

### 5. Type Safety & ESM
-   **Shared Types:** If a data shape changes, update `packages/shared/src/index.ts` **FIRST**.
-   **Imports:** In `backend/`, always use `.js` extension for local imports (e.g., `import ... from "../lib/db.js"`).
-   **No Any:** Avoid `any` in backend handlers. Explicitly type DynamoDB Commands (e.g. `const command: QueryCommand = ...`) to fix inference errors.

### 6. Audit Logging
-   **Rich Context:** `publishAudit` calls must include human-readable `actor.email` and `target.title`, not just UUIDs.
-   **Enrichment:** Events are processed async by `AuditWorker`. Ensure payload contains enough snapshot data for the log to be useful without re-querying the DB.

### 7. Key Management & Secrets
-   **Agency Keys:** Store in AWS Secrets Manager or local `.env` for MCP. Do not hardcode in codebase.
-   **Tenant Keys:** Store in `TenantConfig` via the Settings page. Backend/MCP must fetch these at runtime.

## Build & Development Commands

```bash
# Install all workspaces
npm install

# Build everything (Required after changing Shared/Plugins)
npm run build

# Dev servers
cd admin && npm run dev          # Vite dev server for admin panel
cd renderer && npm run dev       # Next.js dev server for renderer

# Build individual workspaces (Order matters!)
cd packages/shared && npm run build   # 1. Base types
cd packages/plugins && npm run build  # 2. Block registry
cd backend && npm run build           # 3. API Handlers (tsc)
cd admin && npm run build             # 4. Admin UI
cd renderer && npm run build          # 5. Public Site

# Watch mode for libraries
cd packages/shared && npm run watch
cd packages/plugins && npm run watch
```

## Testing

```bash
# Backend unit/integration tests (Vitest)
cd backend && npm test                    # Run all tests
cd backend && npx vitest run src/content  # Specific domain

# E2E tests (Playwright, runs against staging.amodx.net)
npx playwright test                       # All browsers
```

## Architecture Details

### Documentation (MAP.md)

Each package has a `MAP.md` documenting its internal architecture.
-   **Read it** before making structural changes.
-   **Update it** if you add new modules, routes, or infrastructure resources.

### Single-Table DynamoDB Design

All entities share one table with composite keys:
- **PK** (partition): `TENANT#<id>`, `SYSTEM`
- **SK** (sort): `CONTENT#<uuid>#LATEST`, `ROUTE#<slug>`, `ASSET#<uuid>`, `RESOURCE#<uuid>`, `LEAD#<email>`, etc.

### Multi-Tenancy

- **Renderer** uses edge middleware (`renderer/src/middleware.ts`) to map domains to tenant IDs via `x-tenant-id` header injection. All routes are under `app/[siteId]/`.
- **Admin** uses `TenantContext` in React for tenant switching (stored in localStorage).
- **Backend** enforces tenant isolation at the Lambda authorizer level.

### Plugin System (packages/plugins)

Plugins have split entry points to keep server bundles lean:
- `@amodx/plugins/admin` - Tiptap extensions + React editor UIs (browser-only)
- `@amodx/plugins/render` - Pure React render components (SSR-safe)
- Shared Zod schemas validate block data across both contexts

**All 15 Block Plugins** (plus `paragraph` and `heading` builtins):

| Key | Label | Key Attributes | Variants |
|-----|-------|---------------|----------|
| `hero` | Hero Section | headline, subheadline, ctaText, ctaLink, imageSrc, style | center, split, minimal |
| `pricing` | Pricing Table | headline, subheadline, plans[] (title, price, interval, features, buttonText, buttonLink, highlight) | — |
| `image` | Image | src, alt, title, caption, width, aspectRatio | full, wide, centered |
| `contact` | Contact Form | headline, description, buttonText, successMessage, tags | — |
| `video` | Video Embed | url, caption, width, autoplay | centered, wide, full |
| `leadMagnet` | Lead Magnet | headline, description, buttonText, resourceId, fileName, tags | — |
| `cta` | Call to Action | headline, subheadline, buttonText, buttonLink, style | simple, card, band |
| `features` | Feature Grid | headline, subheadline, items[] (title, description, icon), columns | 2, 3, 4 columns |
| `testimonials` | Testimonials | headline, subheadline, items[] (quote, author, role, avatar), style | grid, slider, minimal |
| `columns` | Column Layout | columnCount, gap, columns[] (width, content) | 2-4 cols, sm/md/lg gap |
| `table` | Data Table | headers[], rows[] (cells[]), striped, bordered | — |
| `html` | Raw HTML | content, isSandboxed | — |
| `faq` | FAQ Accordion | headline, items[] (question, answer) | Generates FAQPage JSON-LD |
| `postGrid` | Post Grid | headline, filterTag, limit, showImages, layout, columns | grid, list; 2 or 3 cols |
| `carousel` | Carousel | headline, items[] (title, description, image, link, linkText), height, style | standard, coverflow |

**Key Rules:**
- Block type in Tiptap JSON must match the `Key` column exactly (camelCase: `leadMagnet`, `postGrid`)
- Array items (plans, items, columns, rows, cells) require UUID `id` fields
- MCP server `BLOCK_SCHEMAS` constant must stay in sync with this table

### Authentication

Three auth layers:
1. **Admin users** - AWS Cognito JWT (SRP flow via Amplify)
2. **API keys** - `x-api-key` header validated against Secrets Manager (for MCP/integrations)
3. **Public site users** - NextAuth.js with per-tenant Google OAuth

### Event-Driven Patterns

API operations publish events to EventBridge (`AmodxSystemBus`) for async processing (audit logging, cache invalidation). Audit worker is a separate Lambda.

## Deployment Info

Config lives in `amodx.config.json` (production) and `amodx.staging.json` (staging). Infrastructure deploys via CDK.
*Note: Deployment is manual or via CI/CD pipelines. Do not auto-deploy unless explicitly instructed.*

## NEW MODULE - THE GROWTH ENGINE

This module handles market research and social broadcasting. It splits responsibilities between the Cloud (Memory) and the Local Machine (Execution).

### 1. Data & Persistence (Cloud)
-   **Signals:** Potential leads/threads are stored in DynamoDB (`SIGNAL#`) via the Backend API.
-   **Configuration:** API Keys (e.g., Brave Search) are stored in `TenantConfig` (Settings).
-   **No SaaS:** We do not use third-party wrappers like Ayrshare. We use raw infrastructure.

### 2. Execution (Local MCP)
The MCP Server (`tools/mcp-server`) acts as the "Hands".
-   **Browser Automation:** Uses `playwright` running locally on the user's machine.
-   **Session State:** Social cookies are stored in `tools/mcp-server/.storage/<platform>.json`.
    -   **Rule:** This folder is `.gitignore`'d. Credentials never leave the local machine.
-   **Research:** MCP fetches the Brave API Key from the Backend (`GET /settings`), then calls Brave directly.

### 3. Workflow
1.  **Auth:** User runs `social_login("linkedin")` → MCP opens Chrome → User logs in → Cookies saved to disk.
2.  **Research:** Claude calls `search_web` → MCP calls Brave → Claude analyzes → Calls `save_signal` (Backend).
3.  **Action:** Claude calls `post_social` → MCP loads cookies → Automates the post via Playwright.
