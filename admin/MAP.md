# admin — MAP.md

## Role in the System

The admin panel SPA. Used by agency operators and client admins to manage content, products, strategy, leads, comments, media, team, and site settings. Communicates exclusively with the backend via HTTP API. Deployed as static files to S3 + CloudFront.

**Depends on:** packages/shared (types, theme presets), packages/plugins/admin (Tiptap editor extensions), backend (HTTP API)

## Internal Structure

```
src/
├── main.tsx                    # App entry: Amplify config, React root
├── App.tsx                     # React Router v7 routes + AppShell auth guard
├── index.css                   # Tailwind v4 imports
├── lib/
│   ├── api.ts                  # apiRequest() — fetch wrapper with auth, tenant header, error handling
│   └── utils.ts                # cn() (clsx + tailwind-merge)
├── components/
│   ├── ui/                     # shadcn/ui primitives (Button, Input, Dialog, Select, Sheet, etc.)
│   ├── AdminLayout.tsx         # Master layout: sidebar, content area, global link datalist
│   ├── Sidebar.tsx             # Navigation menu, tenant switcher, logout
│   ├── editor/
│   │   ├── BlockEditor.tsx     # Tiptap editor wrapper with media picker injection
│   │   └── Toolbar.tsx         # Formatting toolbar + plugin insert buttons
│   ├── MediaPicker.tsx         # Modal for selecting uploaded assets
│   ├── SmartLinkInput.tsx      # Autocomplete input for internal page links
│   └── TagInput.tsx            # Multi-tag input with suggestion autocomplete
├── contexts/
│   └── TenantContext.tsx       # TenantProvider: tenant list, selection, localStorage persistence
└── pages/
    ├── Login.tsx               # Cognito sign-in with forced password change flow
    ├── ContentList.tsx         # Page listing, create, WordPress import
    ├── ContentEditor.tsx       # Full page editor: blocks, metadata, SEO, versions, theme overrides
    ├── ContentGraph.tsx        # ReactFlow + Dagre visualization of internal links, orphan detection
    ├── Products.tsx            # Product listing table
    ├── ProductEditor.tsx       # Product form: pricing, inventory, images, Paddle/digital delivery
    ├── StrategyBoard.tsx       # Strategy document cards with quick-create dialog
    ├── StrategyEditor.tsx      # Block editor for strategy docs with tags
    ├── MediaLibrary.tsx        # Asset grid gallery with copy-URL
    ├── Leads.tsx               # Lead table with CSV export
    ├── Comments.tsx            # Moderation queue with status control
    ├── Resources.tsx           # Private file manager for gated downloads
    ├── Users.tsx               # Team management with invite dialog and role assignment
    ├── Settings.tsx            # Site config: identity, theme, analytics, OAuth, Paddle, GDPR, nav
    └── AuditLog.tsx            # Activity feed with action icons
```

## Routing

React Router v7. `AppShell` in `App.tsx` guards all routes with `getCurrentUser()` from Amplify.

| Path | Component | Description |
|------|-----------|-------------|
| `/login` | Login | Public, unauthenticated |
| `/` | ContentList | Dashboard / page listing |
| `/graph` | ContentGraph | Content link visualization |
| `/content/:id` | ContentEditor | Page editor |
| `/products` | Products | Product listing |
| `/products/:id` | ProductEditor | Product editor |
| `/strategy` | StrategyBoard | Strategy docs |
| `/strategy/:id` | StrategyEditor | Strategy editor |
| `/media` | MediaLibrary | Asset gallery |
| `/leads` | Leads | Form submissions |
| `/comments` | Comments | Comment moderation |
| `/audit` | AuditLog | Activity history |
| `/resources` | Resources | Private files |
| `/users` | Users | Team management |
| `/settings` | Settings | Site configuration |

## State Management

- **TenantContext** (React Context): manages tenant list, current selection (persisted in localStorage as `AMODX_TENANT_ID`), auto-ejects from detail pages on tenant switch
- **Page-level state**: each editor uses local `useState`. No Redux or Zustand.
- **Dirty-state protection**: ContentEditor and StrategyEditor use `useBlocker()` + `beforeunload` to warn about unsaved changes
- **Custom events**: `amodx:refresh-links` dispatched by ContentList, listened by AdminLayout to update the global link datalist

## API Client (`lib/api.ts`)

`apiRequest(path, options?)` handles:
- Auth: fetches Amplify session, attaches ID token as `Authorization: Bearer` header
- Tenant: reads `AMODX_TENANT_ID` from localStorage, sends as `x-tenant-id` header
- Config: checks `window.AMODX_CONFIG` (runtime, from `/config.json`) before `import.meta.env` (build-time)
- Error handling: 401/403 triggers sign-out and redirect to `/login`
- File uploads: POST to `/assets` returns presigned URL, then client PUTs binary directly to S3

## Tiptap Editor Integration

`BlockEditor.tsx` wraps the Tiptap editor:
- Loads extensions from `getExtensions()` (`@amodx/plugins/admin`)
- Injects storage callbacks: `uploadFn`, `pickFn` (media), `fetchTagsFn` (post grid tags)
- `Toolbar.tsx` renders formatting buttons + dynamic plugin insert buttons from `getPluginList()`
- `MediaPicker.tsx` opens as a dialog to browse/select uploaded assets

## Auth Flow

1. `main.tsx` configures Amplify with Cognito userPoolId + clientId (from runtime config or env)
2. `Login.tsx` calls `signIn()`, handles `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` challenge
3. `AppShell` checks `getCurrentUser()` before rendering authenticated routes
4. `apiRequest()` extracts ID token from `fetchAuthSession()` for every API call

## Build

- Dev: `npm run dev` (Vite)
- Build: `npm run build` (tsc -b && vite build)
- Lint: `npm run lint` (ESLint with React hooks + refresh plugins)
- Path alias: `@/*` → `./src/*`
- Tailwind v4 via `@tailwindcss/vite` plugin
- UI components follow shadcn/ui patterns (Radix + Tailwind + CVA)
