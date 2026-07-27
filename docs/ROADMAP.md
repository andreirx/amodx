# Roadmap

Operational roadmap, ordered by engineering priority. See `docs/VISION.md` for
direction, `docs/documentation.md` for the slice lifecycle, `docs/TECH-DEBT.md` for known
limitations, and `docs/platform-decisions.md` for binding invariants.

Slices are fine-grained: one slice = one deployable/verifiable/rollback-reasoned unit.
Status taxonomy and naming are defined in `docs/documentation.md`. All slices below are
`PLANNED` until implementation begins.

**Standing operator directive (human, 2026-07-27): no CDK/infra changes without a named,
real gain.** Slice packets forbid `infra/` edits by default; exceptions must state the
concrete gain and are reviewed at the cdk-diff gate. (Hygiene, refactors, or version
bumps alone do not qualify — `dep-1`'s aws-cdk-lib step stays deferred under this rule
until its CVE exposure becomes real gain.)

## Current Priority

**Track CACHE — serving-layer remediation** (`cache-1` → `cache-2` → `cache-3`), inserted
2026-07-26 by operator ratification. **All three slices are now implemented; none is
deployed.** The remaining work is review plus one combined deploy in the order
`cache-3` → `cache-1` + `cache-2` — never `cache-1` alone, which is exactly hazard H1 on
live tenants. **The deploy is now staged** (decision `CACHE3-STAGING-DRIFT`, 2026-07-27):
deploy HEAD to staging first to absorb ~630 resources of drift, run the full probe suite
there, then review a small production diff. Plan: `cache-3` slice doc § *Deployment*. A code audit found the two-layer cache described in
`docs/caching-architecture.md` is inert for HTML: the catch-all route unconditionally
invokes dynamic APIs, so every public page view pays full SSR + DynamoDB reads and
neither CloudFront nor the OpenNext S3 ISR cache stores anything. Two latent bugs
(tenantId-keyed ISR purges, Set-Cookie on cacheable responses) would surface the moment
caching turns on. Live tenants are paying this cost today, and the remediation-status
docs' "Phase 4 COMPLETE" claim is wrong at the serving layer — highest-value fix in the
repo.

`vid-1` follows immediately after as the slice-template validation run (its rationale
unchanged). See `CURRENT_SLICE.md`.

## Track CACHE — serving-layer remediation

Source: code audit 2026-07-26; `docs/caching-architecture.md` is the intended design.

| Slice | Scope | Status |
|-------|-------|--------|
| `cache-1` | Restore static/ISR rendering for public pages: two routes (cacheable ISR + `%5Fdyn` force-dynamic twin) discriminated in middleware, non-cacheable not-found path, doc truth-up. *(The original entry described design D1 — a `_preview` route with dynamic reads pushed into carve-out branches. D1 was refuted by measurement 2026-07-26 and replaced by D2/D3; see the slice doc.)* | IN_REVIEW — deploy gated on `cache-3` (H1) |
| `cache-2` | ISR revalidation keyed by domain (backend resolves the tenant domain); tenantId-keyed purge dropped (test mode is dynamic); commerce paths use the tenant's own `urlPrefixes`; `content/create.ts` purges the `?nf=1` 307; loud warning when `RENDERER_URL` unset | IMPLEMENTED 2026-07-26 (revised same day; `CACHE-2-D1` + `CACHE-2-D2` resolved and applied) — review + post-deploy gate pending. Includes the one-line `CACHE-2-D2` IAM grant in `infra/lib/api.ts` that makes the create-purge effective; deploys with `cache-1`, after `cache-3` |
| `cache-3` | CloudFront query-string allowlist (`page`, `q`, `availability`, `id`, `email`, `preview`, `nf` — `nf` is **mandatory**, it is the not-found handoff's param and the handoff 307 is cacheable) + **RSC header family in the cache key**, closing H1 (scope widened 2026-07-26, CACHE-1-H1 — `cache-1` must not deploy before this) + `amodx_ref` attribution moved off page responses (browser snippet → `POST /api/ref`, which keeps the server-side `HttpOnly` write so the pre-deploy cookie is actually overwritten), because the cache-key change means a warm campaign landing never reaches the origin + **`x-has-session` in the cache key**, closing H3 (revision 3, decision `CACHE3-SESSION-KEY`=B — without it a warm anonymous entry is served to signed-in visitors on access-gated pages) (CDK-touching, production-sensitive) | IMPLEMENTED 2026-07-27, revision 5 (review iterations 0–3 applied; iteration 2 escalated two decisions, both ratified and applied: `CACHE3-SESSION-KEY`=B, `CACHE3-STAGING-DRIFT`=staged reconcile; revision 4 narrowed the session-cookie predicate from substring to the ratified **prefix** contract, corrected the cookie-name source of truth against next-auth 4.24.14's option merge, and withdrew the false "chunked-session authentication fixed" claim to `docs/TECH-DEBT.md`; revision 5 is documentation-only — the staging deploy command needs `-c stage=staging`, the CDK scope is three deltas across two constructs not "a two-property edit", and a code comment named a nonexistent middleware function) — review + deploy pending. `cdk diff` vs `AmodxStack-staging` is **not** the gate (staging drifted ~630 resources); the gate is a source-isolated synth comparison + the staged-reconcile deploy plan, both in the slice doc |
| `cache-4` | Granular invalidation (operator-requested 2026-07-26): replace the CloudFront `/*` sledgehammer with changed-path invalidations derived from the mutation (per page / per entity), and adopt tag-based ISR revalidation ("all pages showing product X") using the already-provisioned tag-cache table. **Go-live timer redefined (human 2026-07-26): ordinary admin edits invalidate their changed paths immediately — instant go-live; the 15-min debounce + banner remain only for bulk/global mutations (imports, theme changes)** where `/*` coalescing still pays. Constraint to design around: on the shared distribution, CloudFront invalidation paths match URI paths across ALL tenant hosts — true per-tenant Layer-1 isolation needs per-tenant distributions (Workstream 3); collateral is cheap once cache-1/2 land because same-path entries on other tenants refill from warm ISR without SSR. Slice doc to be authored after cache-1..3 ship. | PLANNED |
| `cache-5` | Unknown-tenant handling hardening beyond cache-1's middleware domain-cache (sequencing with domain-onboarding flow; authored after cache-1 ships and the D3 mechanism is measured) | PLANNED |

## Track TEST — test estate characterization & gap-filling

Ratified 2026-07-26 (human): runs **after Track CACHE, before Track B** (commerce-private
migration must not rehearse on an untested estate). Live-tenant directive applies: none of
these slices touch production data; backend integration tests (live staging DDB) stay
operator-run only until made local.

| Slice | Scope | Status |
|-------|-------|--------|
| `test-1` | Fast gates: `typecheck` (`tsc --noEmit`) script per workspace + root aggregate; CI job for build+typecheck (today a type regression ships silently — no build CI exists) | IMPLEMENTED 2026-07-27 — review pending. `.github/workflows/ci.yml` (credential-free: build → typecheck → `backend test:unit`) + `typecheck` in all 8 workspaces. No `src/` changes were needed — the estate was already type-clean. CI uses `npm ci`; decision `TEST1-LOCKFILE` was applied as a surgical lockfile repair — 63 linux/win32 platform entries added at their already-pinned versions, 0 existing entries changed, so no dependency drift rides along (`docs/TECH-DEBT.md`) |
| `test-2` | Serving-contract characterization suite: automate the cache-1 header-probe matrix (`next build`+`next start`+local DDB stub; MISS→HIT, twin no-store, not-found, zero-DDB-on-HIT) as a runnable suite — the regression net for the CACHE track | PLANNED |
| `test-3` | Pure unit layer for pure logic: shared schemas + `normalizeEmail` (with fnd-1), backend pure helpers (cache-2 path construction), plugins parser (with vid-1) | PLANNED |
| `test-4` | Infra truth: delete the commented-out jest stub that reports PASS 1/1 while asserting nothing; real `cdk synth` snapshot tests + CI synth job. Unblocks `dep-1` | PLANNED |

Deferred (documented, not slices yet): local-DynamoDB backend integration tests;
playwright expansion (needs a deployed-target strategy).

Post-deploy operator verification (`x-cache: Hit`, Lambda invocation drop) is part of
each slice's evidence — a cache slice is not SHIPPED on build green alone.

## Track order and rationale

CACHE → TEST → A → FND-1 → B → C → D → E. (TEST placed before Track B by human
ratification 2026-07-26: the commerce-private migration is the first
production-machinery rehearsal and must not run on an untested estate. Track A may
interleave with TEST — it is independent and carries its own tests.)

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
| `dep-1` | Dependency-audit remediation for the **non-backend** workspaces — renderer/build (`open-next`/`esbuild`, `next`/`postcss`), infra (`aws-cdk-lib` → `fast-uri`/`brace-expansion`/`yaml`, + the `jest`/`ts-jest` test toolchain), and auth (`next-auth`/`uuid`). No `--force`; no NextAuth downgrade. Detail + grouping in `docs/TECH-DEBT.md`. | PLANNED |

> Backend's 2 critical `vitest`/`@vitest/ui` advisories were fixed first (`vitest ^4.1.8`,
> 0 backend vulnerabilities, tests green). A non-breaking `npm audit fix` (2026-06-29) then cleared
> 4 more HIGH (`linkify-it`, `form-data`, `undici`, `vite`) + the non-breaking moderates. `dep-1`
> covers only what remains — 2 high + 27 moderate, all needing a version-pin bump or a `--force`
> breaking change (grouped in `docs/TECH-DEBT.md`).

## Cross-cutting dependencies

- `fnd-1` (`normalizeEmail`) is a prerequisite for `cmrc` `CUSTOMER#` key normalization (B)
  and all of Track C (it feeds `cognitoUsername` and every `CUSTOMER#` write).
- `cmrc-*` proves the private-table + cross-table-transaction pattern that `appt-*`
  reuses.
- Track C's renderer-proxy customer sessions precede `appt-4` customer endpoints.
- PD-001/002/003 (`docs/platform-decisions.md`) are binding across B, C, and D.
