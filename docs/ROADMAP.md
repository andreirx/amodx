# Roadmap

Operational roadmap, ordered by engineering priority. See `docs/VISION.md` for
direction, `docs/documentation.md` for the slice lifecycle, `docs/TECH-DEBT.md` for known
limitations, and `docs/platform-decisions.md` for binding invariants.

Slices are fine-grained: one slice = one deployable/verifiable/rollback-reasoned unit.
Status taxonomy and naming are defined in `docs/documentation.md`. All slices below are
`PLANNED` until implementation begins.

## Current Priority

**`vid-1` — YouTube/Vimeo URL parser** (Track A). Decision-free, plugin-local, no tenant
data, no migration. It is also the worked example that validates the slice template
before the production-sensitive tracks (B/C/D) begin.

See `CURRENT_SLICE.md` and `docs/slices/vid-1-youtube-vimeo-url-parser.md`.

## Track order and rationale

A → FND-1 → B → C → D → E.

- **A (video embed)** first: independent, low-risk, no private data, no migration —
  momentum plus a proof that the slice format is not overbuilt.
- **FND-1 (foundation)** next: the shared `normalizeEmail()` utility. It is a platform
  prerequisite for both commerce `CUSTOMER#` key normalization (B) and customer auth (C),
  so it is **not** auth-owned and lands before B.
- **B (commerce-private)**: highest-value platform hardening (security finding 7.6).
  Commerce is test-only today, so the first migration is a rehearsal of the production
  migration machinery on disposable data. Depends on FND-1 for `CUSTOMER#` key normalization.
- **C (customer auth)**: establishes the renderer-proxy customer-session substrate.
  Depends on FND-1 (`normalizeEmail`).
- **D (appointments)**: depends on the auth substrate (C) and reuses the private-table
  pattern proven by B.
- **E (admin AI)**: deferred — provider undecided.

## Foundation (cross-cutting prerequisites)

Shared primitives more than one track depends on. Not a feature track.

| Slice | Scope | Status |
|-------|-------|--------|
| `fnd-1` | Shared `normalizeEmail()` (`trim + lowercase`) in `@amodx/shared` — used by commerce `CUSTOMER#` keys (B) and all of customer auth (C) | PLANNED |

## Track A — Video embed

Source: `docs/plan-youtube-vimeo-embed.md`. Independent; plugin-local; no migration.

| Slice | Scope | Status |
|-------|-------|--------|
| `vid-1` | YouTube/Vimeo/direct/unknown URL parser (`videoSource.ts`, SUPPORT) | PLANNED |
| `vid-2` | Inline `video` plugin: iframe embeds + native `<video>` for direct media (defect fix) | PLANNED |
| `vid-3` | `video-hero` block: tabbed Upload/Library/Embed + background iframe cover | PLANNED |

## Track B — Commerce-private boundary

Source: `docs/plan-commerce-private-table.md`. Invariants: PD-002 (renderer-proxy),
PD-001 (tenant-local identity). Security finding 7.6.

| Slice | Scope | Status |
|-------|-------|--------|
| `cmrc-1` | Read-topology cutover: `commerce-db.ts`, renderer-key `/customer/*` endpoints, renderer proxy routes, inert commerce-private table | PLANNED |
| `cmrc-2` | Migration tooling (plan/migrate/verify --strict/--post-cutover/purge-*) + GSI pre-migration gate | PLANNED |
| `cmrc-3` | Copy under write freeze (operational, disposable test data) | PLANNED |
| `cmrc-4` | Backend storage cutover: cross-table `TransactWrite`, `Update`-not-`Put` customer | PLANNED |
| `cmrc-5` | Post-cutover validation + forbidden-import CI guard | PLANNED |
| `cmrc-6` | Purge old main-table copies (backup-ref + NDJSON gated, `purge-verify`) | PLANNED |

## Track C — Customer auth

Source: `docs/plan-public-pool-customer-auth.md`. Invariants: PD-001/002/003.

| Slice | Scope | Status |
|-------|-------|--------|
| `auth-1` | `customerAuth` config flag in `IntegrationsSchema` (`enableEmailPassword`/`enableGoogle`) — depends on `fnd-1` | PLANNED |
| `auth-2` | Public Cognito pool replacement: confidential client, username-only sign-in, `userPassword`, `preventUserExistenceErrors` | PLANNED |
| `auth-3` | Renderer server-only auth lib (`cognitoUsername`/`secretHashFor`) + NextAuth `CredentialsProvider` login | PLANNED |
| `auth-4` | `CUSTOMER#` provisioning on sign-in (best-effort, session-derived) | PLANNED |
| `auth-5` | Register/confirm/forgot/reset renderer API routes + feature-flag enforcement | PLANNED |
| `auth-6` | Renderer auth UI (sign-in/register/forgot) + admin settings card | PLANNED |
| `auth-7` | Hardening: rate-limit/WAF, enumeration, recovery | PLANNED |

## Track D — Scheduling (appointments)

Source: `docs/plan-appointments-private-table-extension.md`. Invariants: PD-001/002/003.

| Slice | Scope | Status |
|-------|-------|--------|
| `appt-1` | Pure domain kernel: slot generation, overlap, status transitions (no I/O, injected clock) | PLANNED |
| `appt-2` | Inert appointments-private table + `appointmentsEnabled` flag | PLANNED |
| `appt-3` | Persistence support module + slot-lock concurrency (`appointments-db.ts`) | PLANNED |
| `appt-4` | Backend handlers: customer (renderer-proxied) + admin | PLANNED |
| `appt-5` | Tenant toggle + admin config UI + renderer booking UI | PLANNED |
| `appt-6` | Notifications & audit | PLANNED |
| `appt-7` | Validation (isolation, concurrency, disabled-state) | PLANNED |

## Track E — Admin AI (deferred)

Source: `docs/plan-ai-admin.md`. **DEFERRED** — LLM provider undecided; even the
request/response schemas depend on the provider's streaming and tool-call format. No
slice docs until the provider is chosen. The provider-agnostic `LlmGateway` interface is
the hedge when this resumes.

## Maintenance

Hygiene work, not a feature track.

| Slice | Scope | Status |
|-------|-------|--------|
| `dep-1` | Dependency-audit remediation for the **non-backend** workspaces — renderer/build (`open-next`/`esbuild`, `next`/`postcss`), infra (`aws-cdk-lib` → `fast-uri`/`brace-expansion`/`yaml`), and auth (`next-auth`/`uuid`). No `--force`; no NextAuth downgrade. Detail + grouping in `docs/TECH-DEBT.md`. | PLANNED |

> Backend's 2 critical `vitest`/`@vitest/ui` advisories are already fixed (`vitest ^4.1.8`,
> 0 backend vulnerabilities, tests green). `dep-1` covers only the remaining 9 moderate + 1 high
> in the other workspaces.

## Cross-cutting dependencies

- `fnd-1` (`normalizeEmail`) is a prerequisite for `cmrc` `CUSTOMER#` key normalization (B)
  and all of Track C (it feeds `cognitoUsername` and every `CUSTOMER#` write).
- `cmrc-*` proves the private-table + cross-table-transaction pattern that `appt-*`
  reuses.
- Track C's renderer-proxy customer sessions precede `appt-4` customer endpoints.
- PD-001/002/003 (`docs/platform-decisions.md`) are binding across B, C, and D.
