# AMODX Vision

Architectural north-star. Not marketing, not a feature list. For the product overview
see `README.md`; for agent rules see `CLAUDE.md`; for system schematics see
`docs/architecture-deep -dive.md`; for binding cross-cutting invariants see
`docs/platform-decisions.md`.

## What AMODX is

A production-grade, multi-tenant CMS and agency operating system. One AWS deployment
serves many independent tenant websites. We build **products, not MVPs**: rock-solid,
with documented debt and explicit assumptions.

## Core product guarantees

1. **Tenant isolation is absolute.** Every operation is scoped to one tenant; no
   cross-tenant read or write. Tenants are independent businesses — there is no shared
   customer identity across tenants (PD-001).

2. **Public/private trust boundaries are a product guarantee, not an implementation
   detail.** The renderer is public-facing and must **never become the authority for
   private data**. Authenticated customer data flows through backend handlers under the
   renderer-proxy model (PD-002); customer-private data lives outside the renderer's IAM
   reach (the commerce-private and appointments-private boundaries).

3. **Core business policy stays framework- and cloud-independent where practical.**
   Critical business rules (scheduling logic, pricing, validation) are pure and testable
   off-target. DynamoDB, Cognito, Lambda, and Next.js are volatile delivery mechanisms
   behind abstractions — not the center of the system.

## How work is executed

Planned work is executed through **deployable slices**, never broad rewrites. A slice is
the unit of implementation, deployment/migration, verification, rollback reasoning,
documentation update, and maturity tracking (PROTOTYPE → MATURE → PRODUCTION).

- Detailed plans live in `docs/plan-*.md`.
- The slice inventory and order live in `docs/ROADMAP.md`.
- The active slice is named in `CURRENT_SLICE.md`.
- The slice lifecycle is defined in `docs/documentation.md`.

Production sensitivity is real (live non-commerce tenants today). Slices default to
**disabled**, **expand before contract**, and treat shared-code/CDK deploys as
production-sensitive even when the data they touch is test-only.

## Decision hierarchy

Invariants bound everything. The principles above, `docs/platform-decisions.md`, and the
Critical Rules in `CLAUDE.md` (tenant isolation, no DynamoDB scans, clean-architecture
dependency rule) are a **floor a slice may never breach** — stop if a slice would.

Within that frame, for *what to work on* (higher wins):

1. `docs/VISION.md`
2. `docs/ROADMAP.md` current priority
3. `CURRENT_SLICE.md`
4. the active `docs/slices/*.md` and the plan/architecture docs it references
5. local style

This document changes rarely.
