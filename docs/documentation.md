# Documentation Guidelines

Rules for documentation structure, placement, and the slice lifecycle. Keep agent
behavioral rules in `CLAUDE.md`; keep doc structure and lifecycle here.

## Directory Structure

```
CLAUDE.md                 # Agent behavioral contract (+ Slice Workflow pointer)
CURRENT_SLICE.md          # Active work pointer
README.md                 # Product overview
docs/
  VISION.md               # Strategic north-star (highest priority for direction)
  ROADMAP.md              # Prioritized slice inventory
  platform-decisions.md   # Binding cross-cutting invariants (PD-001/002/003)
  documentation.md        # This file
  TECH-DEBT.md            # Known issues and deferred work
  plan-*.md               # Detailed feature plans (slices decompose these)
  architecture-deep -dive.md, *-architecture.md, *-patterns.md  # Reference architecture
  slices/                 # Active, planned, and partial slice documents
  shipped/
    slices/               # Completed (SHIPPED) slice documents
```

## What Belongs Where

| Content | Location | Notes |
|---------|----------|-------|
| Agent behavioral rules | `CLAUDE.md` | What to do before changes, how to validate, when to stop |
| Active work pointer | `CURRENT_SLICE.md` | Names the active slice |
| Strategic direction | `docs/VISION.md` | Rarely changes |
| Priority order | `docs/ROADMAP.md` | What to work on next |
| Binding invariants | `docs/platform-decisions.md` | PD-NNN; a slice may never override these |
| Detailed feature plans | `docs/plan-*.md` | Slices decompose these; plans hold the full design |
| Active/partial slices | `docs/slices/*.md` | Scoped work with a Definition of Done |
| Completed slices | `docs/shipped/slices/*.md` | Archived after SHIPPED |
| Technical debt | `docs/TECH-DEBT.md` | Known issues, deferred decisions |

## Slice Lifecycle

A slice document tracks one execution unit from planning through completion. It is the
unit of implementation, deployment/migration, verification, rollback reasoning,
documentation update, and maturity tracking.

### Status taxonomy

Use exactly one:

- `PLANNED` — not started
- `IN_PROGRESS` — active implementation
- `PARTIAL` — some scope shipped, remainder explicitly documented in the slice header
- `IMPLEMENTED` — code complete, validation pending
- `SHIPPED` — fully validated, in production
- `SUPERSEDED` — replaced by another slice
- `WITHDRAWN` — abandoned, kept for historical record

### Maturity (orthogonal to status)

AMODX modules track maturity `PROTOTYPE → MATURE → PRODUCTION`. A slice states the
maturity it targets. `SHIPPED` does not imply `PRODUCTION` maturity.

### Location rules

- Active / planned / partial slices: `docs/slices/`
- Completed slices: `docs/shipped/slices/`
- When a slice reaches `SHIPPED`, move it from `docs/slices/` to `docs/shipped/slices/`.

### Partial status

When a slice is `PARTIAL`, keep it in `docs/slices/` and state in the header what shipped
(with references) and what remains (with blockers). Example:
`Status: PARTIAL — vimeo path shipped; youtube-nocookie privacy mode pending`.

## Required Slice Sections

Every slice doc includes:

- **Status** — one taxonomy value (+ date when it changes)
- **Track** — roadmap track
- **Depends** — prerequisite slices/decisions
- **Source plan** — the `docs/plan-*.md` this decomposes
- **Purpose / risk retired** — the one risk this slice removes
- **Scope** — what this slice does
- **Non-scope** — explicit guardrails (what it does NOT do)
- **Architectural boundaries** — invariants and module boundaries it must respect
- **Migration / deployment notes** — data migration, deploy steps, rollback (or "none")
- **Definition of Done** — checkable completion criteria
- **Evidence required** — what must be EXECUTED/OBSERVED before closing
- **Exit criterion** — what becomes possible once done
- **References** — plan sections, platform decisions, related slices

## Naming Conventions

Format: `{prefix}-{number}-{description}.md` (lowercase).

Prefixes:
- `fnd-` — foundation / cross-cutting prerequisites
- `vid-` — video embed (Track A)
- `cmrc-` — commerce-private boundary (Track B)
- `auth-` — customer auth (Track C)
- `appt-` — appointments / scheduling (Track D)
- `ai-` — admin AI (Track E, deferred)

Sub-slices use a letter suffix when one slice splits: `auth-2a-...`, `auth-2b-...`.

## Evidence Labels

Label every validation claim:

- `EXECUTED` — command run, output observed
- `OBSERVED` — artifact/behavior inspected
- `INFERRED` — concluded from context, not directly observed
- `NOT RUN` — skipped

Never present `INFERRED` as `OBSERVED`. Per repo Definition of Done, rebuild affected
workspaces (shared → plugins → backend → admin → renderer) and record the result as
`EXECUTED`.

## Reconciliation Rules

When implementation status changes, update all truth surfaces:

1. **Slice document** — update status (+ date); move to `docs/shipped/slices/` if SHIPPED.
2. **`docs/ROADMAP.md`** — update the slice's status in its track table.
3. **`CURRENT_SLICE.md`** — update only when the active priority/slice changes.
4. **`docs/TECH-DEBT.md`** — add an entry for any residual gap or deferred work.
5. **Memory / durable notes** — update only if this repository has an active memory file or tool-backed memory surface.

**Staleness is a bug.** If code ships but a doc says `PLANNED`, the doc is wrong.
