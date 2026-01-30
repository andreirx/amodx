# CLAUDE.md

AMODX is a serverless multi-tenant CMS and agency operating system on AWS. Single deployment serves up to 99 tenant websites. Block-based content editor (Tiptap) with a plugin architecture.

## Monorepo Structure

npm workspaces. **Build order matters** — shared → plugins → backend/admin/renderer.

| Package | What | Tech |
|---------|------|------|
| `packages/shared/` | Types & Zod schemas (single source of truth) | TypeScript |
| `packages/plugins/` | Block plugins — split entry: `admin` (Tiptap) / `render` (SSR-safe React) | React, Zod |
| `backend/` | Lambda handlers behind API Gateway | Node.js 22, DynamoDB |
| `admin/` | Control panel SPA | React 19, Vite, shadcn/ui |
| `renderer/` | Public site engine | Next.js 16, OpenNext |
| `infra/` | CDK infrastructure | AWS CDK |
| `tools/mcp-server/` | Claude MCP server + Playwright browser automation | MCP SDK |

## Commands

```bash
npm install                              # All workspaces
npm run build                            # Full build (shared → plugins → all)
cd admin && npm run dev                  # Admin dev server
cd renderer && npm run dev               # Renderer dev server
cd backend && npm test                   # Vitest (uses real staging DynamoDB)
```

## Critical Rules

These invariants, if broken, cause crashes or data corruption:

1. **Plugin split entry.** `admin.ts` (browser) vs `render.ts` (server). No cross-imports between plugins and admin/renderer. See `docs/plugin-architecture.md`.
2. **No DynamoDB scans.** Always `QueryCommand` with `PK`+`SK`. List handlers must use `ProjectionExpression`.
3. **Tenant isolation.** Every DB operation validates `x-tenant-id`. Never query across tenants.
4. **Shared-first types.** Schema changes go to `packages/shared/src/index.ts` first, then rebuild dependents.
5. **Backend ESM imports.** Always use `.js` extension for local imports (e.g., `from "../lib/db.js"`).
6. **No hardcoded colors.** Use CSS variables (`bg-primary`, `text-muted-foreground`) for multi-tenant theming.
7. **Audit context.** `publishAudit` calls must include `actor.email` and `target.title`, not just UUIDs.
8. **Tenant keys at runtime.** API keys (Brave, etc.) stored in `TenantConfig` via Settings page. Never hardcode.

## Documentation

Each package has a **MAP.md** with internal architecture. Read before structural changes, update after.

Detailed patterns and business logic live in `docs/`:

| File | When to read |
|------|-------------|
| `docs/plugin-architecture.md` | Adding or modifying block plugins |
| `docs/block-types.md` | Working with content blocks (15 plugins + attributes reference) |
| `docs/database-patterns.md` | Writing backend handlers, DynamoDB queries, or content versioning |
| `docs/frontend-patterns.md` | Working on admin UI, renderer SSR, styling, or authentication |
| `docs/growth-engine.md` | Working on signals, research, social posting, or MCP tools |
