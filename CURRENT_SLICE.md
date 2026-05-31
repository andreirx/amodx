# CURRENT_SLICE.md

## Current Priority

**`vid-1` — YouTube/Vimeo URL parser** (Track A).

Active slice: `docs/slices/vid-1-youtube-vimeo-url-parser.md`.

Why now: decision-free, plugin-local, no tenant data, no migration — and the worked
example that validates the slice template before the production-sensitive tracks (B
commerce-private, C auth, D appointments) begin.

Read before implementation: `docs/VISION.md` → `docs/ROADMAP.md` → this file →
`docs/slices/vid-1-youtube-vimeo-url-parser.md` → `docs/plan-youtube-vimeo-embed.md`.

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

`vid-2` → `vid-3` (complete Track A), then `fnd-1` (shared `normalizeEmail`), then begin
Track B (`cmrc-1`). The `fnd-1` and Track B/C/D slice docs are not yet authored — generate
them per `docs/ROADMAP.md` when their track starts.

## Recently Completed

- Slice infrastructure scaffolding: `VISION.md`, `ROADMAP.md`, `documentation.md`, this
  file, the `CLAUDE.md` Slice Workflow section, and `docs/slices/` + `docs/shipped/slices/`.
