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

Beware the installed packages within each workspace, don't mix them up.
Each module builds SEPARATELY.

## Definition of Done

When updating code, rebuild shared, backend, plugins, renderer.
When installing new packages, audit vulnerabilities and explain the high priority ones. Github actions will fail on this.
Check that the MCP server reflects the changes.
Update the documentation.
Record any important decisions being made.

## Critical Rules

These invariants, if broken, cause crashes or data corruption:

1. **Plugin split entry.** `admin.ts` (browser) vs `render.ts` (server). No cross-imports between plugins and admin/renderer. See `docs/plugin-architecture.md`.
2. **No DynamoDB scans.** Always `QueryCommand` with `PK`+`SK`. List handlers must use `ProjectionExpression`.
3. **Tenant isolation.** Every DB operation validates `x-tenant-id`. Never query across tenants.
4. **Shared-first types.** Schema changes go to `packages/shared/src/index.ts` first, then rebuild dependents.
5. **Backend ESM imports.** Always use `.js` extension for local imports (e.g., `from "../lib/db.js"`).
6. **No hardcoded colors.** Use CSS variables (`bg-primary`, `text-muted-foreground`) for multi-tenant theming.
7. **Audit context.** `publishAudit` calls must include `actor.email` and `target.title`, not just UUIDs.
8. **Tenant keys at runtime.** API keys (Brave, etc.) stored in `TenantConfig` via Settings page. Never hardcode. Or in AWS secrets for agency-wide.
9. **Treat user feedback as HARD DATA.** never assume your code is correct even if it looks correct. Maybe there's something else affecting it.

## Documentation

Each package has a **MAP.md** with internal architecture. Read before structural changes, update after.

Detailed patterns and business logic live in `docs/`:

| File                              | When to read |
|-----------------------------------|-------------|
| `docs/plugin-architecture.md`     | Adding or modifying block plugins |
| `docs/block-types.md`             | Working with content blocks (15 plugins + attributes reference) |
| `docs/database-patterns.md`       | Writing backend handlers, DynamoDB queries, or content versioning |
| `docs/frontend-patterns.md`       | Working on admin UI, renderer SSR, styling, or authentication |
| `docs/growth-engine.md`           | Working on signals, research, social posting, or MCP tools |
| `docs/commerce.md`               | Commerce extension: cart, checkout, orders, delivery, coupons, email templates |
| `docs/lessons-learned-details.md` | Check this when planning a feature or refactor              |
| `docs/authentication-architecture.md` | Auth system: 2 Cognito pools, NextAuth, master API key, reCAPTCHA |
| `docs/INTEGRATION_MANUAL.md`          | reCAPTCHA setup, SSM keys, tenant onboarding, troubleshooting |
| `docs/plan-self-hosted-saas.md`       | SaaS platform: control plane, provisioning, billing, AI integration, phases |


## Codebase Intelligence (rgr)

This repo can be indexed by `rgr` (Repo-Graph) for structural analysis. If rgr is available on PATH:

```bash
rgr repo add .                           # Register this repo
rgr repo index amodx                     # Full index (~400 files, <1s)
rgr graph cycles amodx                   # Module-level dependency cycles
rgr graph dead amodx --kind SYMBOL       # Unreferenced exported symbols
rgr graph callers amodx <symbol>         # Who calls this?
rgr graph callers amodx <symbol> --edge-types CALLS,INSTANTIATES  # Who uses this?
rgr graph path amodx <from> <to>         # Shortest path between two symbols
```

Use `/investigate-symbol amodx <SymbolName>` for a guided investigation workflow. Use `/repo-overview .` for a full structural health check.

rgr uses syntax-only resolution (no type info). Import graphs are accurate. Call graphs are conservative — `this.method()` and `obj.method()` calls may not resolve. When callee results look incomplete, read the source directly.

When you find architectural breadcrumbs, comments, or docs in the repo:
- Do not copy them into repo-graph blindly.
- First verify them against current code.
- If the claim is still true and operationally useful, store the distilled fact in rgr as a declaration.
- Prefer short, canonical facts over prose.
- Treat rgr as the system of record for verified architectural facts, with source files/docs serving as evidence.
- If a breadcrumb conflicts with code, trust code and report the drift.

HOWEVER - Only store a fact in rgr if it would help a future agent make a better design/debugging decision without rereading the same code.
Store surprises, constraints, hazards, and architectural intent.
Don’t store summaries of obvious code.

# System Intent (WHY)
This repository contains a high-reliability, safety-critical product. The objective is rock-solid execution, not a Minimum Viable Product. Structural decisions must prioritize long-term maintainability, hardware-independence, and off-target testability. 

# Clean Architecture Directives (UNIVERSAL RULES)
1. **The Dependency Rule:** Source code dependencies must point strictly inward toward `core/`. Elements in `core/` must never import or reference entities from `adapters/` or `infrastructure/`.
2. **Boundary Enforcement:** Data crossing architectural boundaries must utilize simple Data Transfer Objects (DTOs). Do not pass framework-specific objects, hardware structs, or database rows across boundaries.
3. **Volatility Isolation:** Hardware, databases, and frameworks are volatile external details. Isolate them behind strict abstraction layers (e.g., HAL, OSAL, Gateways).
4. **Architectural Decisions:** When encountering an architectural fork, halt and ask for clarification. Do not unilaterally select an architecture pattern. Provide evidence and explain the underlying mechanics of available options to facilitate a decision.

# Progressive Disclosure Context
Do not assume domain specifics. Read the relevant files din docs before modifying their associated domains (and update them when the user input justifies it)
* architecture decisions: Historical context and existing structural boundaries.
* hardware abstractions: Protocols for the HAL and off-target simulation requirements.
* database schema: Persistence layer rules and Gateway interface implementations.
* testing strategy: Rules for the Test API and decoupled verification.
