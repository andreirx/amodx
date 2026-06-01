# CLAUDE.md

AMODX is a serverless multi-tenant CMS and agency operating system on AWS. Single deployment serves up to 99 tenant websites. Block-based content editor (Tiptap) with a plugin architecture.

## Slice Workflow

Before implementation work, read in order:

1. `docs/VISION.md`
2. `docs/ROADMAP.md` (current priority)
3. `CURRENT_SLICE.md`
4. the referenced `docs/slices/*.md` file
5. any plan/architecture docs the slice references

Work only inside the active slice unless explicitly instructed otherwise. Record evidence
as `EXECUTED` / `OBSERVED` / `INFERRED` / `NOT RUN`. **Stop** if the slice would contradict
`docs/platform-decisions.md`, tenant isolation, the no-DynamoDB-scan rule, or clean-architecture
boundaries. The slice lifecycle, status taxonomy, and naming live in `docs/documentation.md`.

Before declaring a change done:

- **Verify, don't assert.** Check every command, script, config field, or file you cite against the actual repo before stating it exists. Label claims `EXECUTED` / `OBSERVED` / `INFERRED`; never present `INFERRED` as `OBSERVED`.
- **Chase ripples.** After any rename or structural edit, re-read the whole file/doc and update every dependent reference — cross-refs, renamed identifiers, example commands, summary tables. A partial scan misses them.
- **"Done" means the ripple re-read and evidence are complete**, not "edit applied."

## Monorepo Structure

npm workspaces. **Build order matters** — shared → effects → plugins → backend → admin → renderer (then tools/mcp-server, infra). The root `npm run build` runs exactly this dependency order.

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

## Definition of Done

When updating code, rebuild shared, backend, plugins, renderer.
When installing new packages, audit vulnerabilities and explain the high priority ones.
Check that the MCP server reflects the changes.
Update the documentation.

## Critical Rules

These invariants, if broken, cause crashes or data corruption:

1. **Plugin split entry.** `admin.ts` (browser) vs `render.ts` (server). No cross-imports between plugins and admin/renderer. See `docs/plugin-architecture.md`.
2. **No DynamoDB scans.** Always `QueryCommand` with `PK`+`SK`. List handlers must use `ProjectionExpression`.
3. **Tenant isolation.** Every DB operation validates `x-tenant-id`. Never query across tenants.
4. **Shared-first types.** Schema changes go to `packages/shared/src/index.ts` first, then rebuild dependents.
5. **Backend ESM imports.** Always use `.js` extension for local imports (e.g., `from "../lib/db.js"`).
6. **No hardcoded colors.** Use CSS variables (`bg-primary`, `text-muted-foreground`) for multi-tenant theming.
7. **Audit context.** `publishAudit` calls must include `actor.email` and `target.title`, not just UUIDs.
8. **Tenant keys at runtime.** API keys stored in `TenantConfig` via Settings page. Never hardcode.
9. **Treat user feedback as HARD DATA.** Never assume your code is correct even if it looks correct.

## Documentation

Each package has a **MAP.md** with internal architecture. Read before structural changes, update after.

| File | When to read |
|------|-------------|
| `docs/plugin-architecture.md` | Adding or modifying block plugins |
| `docs/block-types.md` | Working with content blocks |
| `docs/database-patterns.md` | Backend handlers, DynamoDB queries |
| `docs/frontend-patterns.md` | Admin UI, renderer SSR, styling |
| `docs/growth-engine.md` | Signals, research, social posting |
| `docs/commerce.md` | Cart, checkout, orders, delivery |
| `docs/authentication-architecture.md` | Auth system, Cognito, NextAuth |

## Codebase Intelligence (rmap)

This repo is indexed by `rmap` for structural analysis. Database: `./amodx.db`

```bash
# Indexing
rmap index . ./amodx.db                              # Full index
rmap refresh . ./amodx.db                            # Incremental refresh

# Orientation
rmap orient ./amodx.db amodx                         # Overview
rmap trust ./amodx.db amodx                          # Extraction reliability
rmap check ./amodx.db amodx                          # Structural check

# Structural queries
rmap callers ./amodx.db amodx <symbol>               # Who calls this?
rmap callees ./amodx.db amodx <symbol>               # What does this call?
rmap imports ./amodx.db amodx <file>                 # Import chain

# Boundaries
rmap boundaries list ./amodx.db amodx                # HTTP/CLI surfaces
rmap boundaries summary ./amodx.db amodx             # Provider/consumer summary

# Modules
rmap modules list ./amodx.db amodx                   # Module inventory
rmap modules show ./amodx.db amodx <module>          # Module detail
rmap modules deps ./amodx.db amodx <module>          # Module dependencies

# Governance
rmap violations ./amodx.db amodx                     # Boundary violations
rmap gate ./amodx.db amodx                           # CI gate check
```

Slash commands (`.claude/commands/`):
- `/investigate-symbol <SymbolName>` — callers, callees, trust context
- `/repo-overview` — full structural health check
- `/assess-health` — structure + complexity report

### Trust boundaries

rmap uses syntax-only extraction (tree-sitter) with optional compiler enrichment. Import graphs are accurate. Call graphs resolve well on class-heavy architectures; weaker on SDK-heavy or functional patterns.

For registry/plugin-driven architectures (CMS renderers, extension registries, render maps, string-key dispatch): treat dead-code results as "graph orphans," not deletion candidates.

### Not yet ported to rmap

These rgr commands are not yet available in rmap:
- `graph cycles` — dependency cycle detection
- `graph stats` — module structural metrics
- `graph dead` — dead code detection (withdrawn pending coverage integration)
- `graph metrics` — complexity metrics (partial via `rmap check`)
- `graph path` — shortest path between symbols

## Clean Architecture Directives

1. **Dependency Rule:** Source code dependencies must point strictly inward toward `core/`. Elements in `core/` must never import or reference entities from `adapters/` or `infrastructure/`.
2. **Boundary Enforcement:** Data crossing architectural boundaries must utilize simple DTOs. Do not pass framework-specific objects across boundaries.
3. **Volatility Isolation:** Hardware, databases, and frameworks are volatile external details. Isolate them behind strict abstraction layers.
4. **Architectural Decisions:** When encountering an architectural fork, halt and ask for clarification. Provide evidence and explain options.

## Progressive Disclosure

Do not assume domain specifics. Read the relevant docs before modifying their associated domains:
- architecture decisions: Historical context and existing structural boundaries
- database schema: Persistence layer rules and Gateway interface implementations
- testing strategy: Rules for the Test API and decoupled verification
