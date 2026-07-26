# CURRENT_SLICE.md

## Current Priority

**`cache-1` — Restore static/ISR rendering for public pages** (Track CACHE).

Active slice: `docs/slices/cache-1-restore-static-rendering.md`.

Why now (ratified 2026-07-26): audit found both cache layers inert for HTML — every
public page view runs full SSR + DynamoDB reads for live tenants. cache-1 alone turns
the documented architecture back on; `cache-2`/`cache-3` fix the bugs that become
observable once it does.

Read before implementation: `docs/VISION.md` → `docs/ROADMAP.md` → this file →
`docs/slices/cache-1-restore-static-rendering.md` → `docs/caching-architecture.md`.

## Planning phase — COMPLETE

The four feature plans and the platform decisions are approved and are the binding
source for the slice inventory:

- `docs/platform-decisions.md` — PD-001 (tenant-local identity), PD-002 (renderer-proxy
  customer data transport), PD-003 (Cognito as login substrate; dormant CUSTOMER branch).
- `docs/plan-public-pool-customer-auth.md` — approved.
- `docs/plan-appointments-private-table-extension.md` — approved.
- `docs/plan-commerce-private-table.md` — approved.
- `docs/plan-youtube-vimeo-embed.md` — source for Track A.

## In Progress

None. Track A slice docs exist (`vid-1`, `vid-2`, `vid-3`); implementation not started.

## Next

`cache-2` → `cache-3` (complete Track CACHE, each with post-deploy operator
verification), then `vid-1` → `vid-2` → `vid-3` (Track A), then `fnd-1` (shared
`normalizeEmail`), then begin
Track B (`cmrc-1`). The `fnd-1` and Track B/C/D slice docs are not yet authored — generate
them per `docs/ROADMAP.md` when their track starts.

## Recently Completed

- Slice infrastructure scaffolding: `VISION.md`, `ROADMAP.md`, `documentation.md`, this
  file, the `CLAUDE.md` Slice Workflow section, and `docs/slices/` + `docs/shipped/slices/`.
