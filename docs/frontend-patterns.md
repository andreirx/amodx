# Frontend Architecture Patterns

## Renderer (Next.js 16 + OpenNext)

- **SEO Pre-fetching:** Dynamic blocks (PostGrid, etc.) must have their data fetched server-side in `page.tsx` and injected into `block.attrs`. Never rely solely on `useEffect` for SEO-critical content.
- **Hydration safety:** No `window` or `localStorage` access without `useEffect` or `typeof window !== 'undefined'` guard.
- **Images:** Use `<img>` tags or unoptimized `next/image` for external CDN images to avoid Lambda bandwidth costs.
- **Multi-tenancy:** Edge middleware (`renderer/src/middleware.ts`) maps domains to tenant IDs via `x-tenant-id` header. All routes are under `app/[siteId]/`.

## Admin (React 19 + Vite)

- **State management:** `TenantContext` for tenant switching (persisted in localStorage as `AMODX_TENANT_ID`). Page-level state uses `useState` — no Redux/Zustand.
- **API client:** `lib/api.ts` → `apiRequest(path, options?)` handles auth tokens, tenant headers, and 401/403 → redirect to login.
- **Dirty-state protection:** ContentEditor and StrategyEditor use `useBlocker()` + `beforeunload`.
- **UI components:** shadcn/ui patterns (Radix + Tailwind + CVA).

## Styling (Tailwind v4)

- **No hardcoded colors.** Use CSS variables: `bg-primary`, `text-muted-foreground`, `border-border`, etc. This supports per-tenant theming.
- **Plugin editors** use the standard card container (see `docs/plugin-architecture.md`).

## Authentication Layers

1. **Admin users** — AWS Cognito JWT (SRP flow via Amplify). `AppShell` guards routes with `getCurrentUser()`.
2. **API keys** — `x-api-key` header validated against Secrets Manager (MCP/integrations).
3. **Public site users** — NextAuth.js with per-tenant Google OAuth credentials from `TenantConfig`.
