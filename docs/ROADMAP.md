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

**Track CACHE — serving-layer remediation** (`cache-1` → `cache-2` → `cache-3`, plus the
`cache-6` hotfixes), inserted 2026-07-26 by operator ratification. **All four slices are now
implemented; none is deployed.** The remaining work is review plus one combined deploy in the
order `cache-3` → `cache-1` + `cache-2` — never `cache-1` alone, which is exactly hazard H1 on
live tenants. **`cache-6` (2026-07-28) is order-independent and joins the same deploy**: its
two changes repair transport that has been broken in production all along, so it neither gates
nor is gated by the others. Note the interaction it fixes rather than creates: without
`cache-6`'s `x-revalidation-token`, `cache-2`'s corrected purge paths would deploy and still
purge nothing, because the endpoint would keep answering 401. **The deploy is now staged** (decision `CACHE3-STAGING-DRIFT`, 2026-07-27):
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
| `cache-1` | Restore static/ISR rendering for public pages: two routes (cacheable ISR + `%5Fdyn` force-dynamic twin) discriminated in middleware, non-cacheable not-found path, doc truth-up. *(The original entry described design D1 — a `_preview` route with dynamic reads pushed into carve-out branches. D1 was refuted by measurement 2026-07-26 and replaced by D2/D3; see the slice doc.)* | SHIPPED 2026-07-28 (prod) |
| `cache-2` | ISR revalidation keyed by domain (backend resolves the tenant domain); tenantId-keyed purge dropped (test mode is dynamic); commerce paths use the tenant's own `urlPrefixes`; `content/create.ts` purges the `?nf=1` 307; loud warning when `RENDERER_URL` unset | SHIPPED 2026-07-28 (prod) |
| `cache-3` | CloudFront query-string allowlist (`page`, `q`, `availability`, `id`, `email`, `preview`, `nf` — `nf` is **mandatory**, it is the not-found handoff's param and the handoff 307 is cacheable) + **RSC header family in the cache key**, closing H1 (scope widened 2026-07-26, CACHE-1-H1 — `cache-1` must not deploy before this) + `amodx_ref` attribution moved off page responses (browser snippet → `POST /api/ref`, which keeps the server-side `HttpOnly` write so the pre-deploy cookie is actually overwritten), because the cache-key change means a warm campaign landing never reaches the origin + **`x-has-session` in the cache key**, closing H3 (revision 3, decision `CACHE3-SESSION-KEY`=B — without it a warm anonymous entry is served to signed-in visitors on access-gated pages) (CDK-touching, production-sensitive) | SHIPPED 2026-07-28 (prod) |
| `cache-4` | Granular invalidation (operator-requested 2026-07-26): replace the CloudFront `/*` sledgehammer with changed-path invalidations derived from the mutation (per page / per entity), and adopt tag-based ISR revalidation ("all pages showing product X") using the already-provisioned tag-cache table. **Go-live timer redefined (human 2026-07-26): ordinary admin edits invalidate their changed paths immediately — instant go-live; the 15-min debounce + banner remain only for bulk/global mutations (imports, theme changes)** where `/*` coalescing still pays. Constraint to design around: on the shared distribution, CloudFront invalidation paths match URI paths across ALL tenant hosts — true per-tenant Layer-1 isolation needs per-tenant distributions (Workstream 3); collateral is cheap once cache-1/2 land because same-path entries on other tenants refill from warm ISR without SSR. Slice doc to be authored after cache-1..3 ship. | PLANNED |
| `cache-5` | Unknown-tenant handling hardening beyond cache-1's middleware domain-cache (sequencing with domain-onboarding flow; authored after cache-1 ships and the D3 mechanism is measured) | PLANNED |
| `cache-6` | **Distribution transport hotfixes — two production-impacting defects, both pre-existing in prod, both found by live probing on 2026-07-28.** (D1) `x-revalidation-token` was absent from `RendererOriginPolicy`, so CloudFront stripped the ISR purge credential and `/api/revalidate` 401'd every backend caller — **no deployed Layer-2 purge has ever worked**, independent of the purge *key* `cache-2` fixed. (D2) `_next/image*` used the managed `CACHING_OPTIMIZED` policy with no origin request policy, so `?url&w&q` was deleted in flight and the image Lambda answered 500 `"url" parameter is required` — **image optimization broken for every tenant**, OBSERVED on staging AND prod. Both repaired in `infra/lib/renderer-hosting.ts`; both now pinned by named assertions (`(h)`, `(g)`), since in each case the defect shipped precisely because nothing asserted the list. Qualifies under the standing no-CDK-without-named-gain directive: this repairs broken deployed behavior, probe-verified. | SHIPPED 2026-07-28 (prod) |

## Track TEST — test estate characterization & gap-filling

Ratified 2026-07-26 (human): runs **after Track CACHE, before Track B** (commerce-private
migration must not rehearse on an untested estate). Live-tenant directive applies: none of
these slices touch production data; backend integration tests (live staging DDB) stay
operator-run only until made local.

| Slice | Scope | Status |
|-------|-------|--------|
| `test-1` | Fast gates: `typecheck` (`tsc --noEmit`) script per workspace + root aggregate; CI job for build+typecheck (today a type regression ships silently — no build CI exists) | SHIPPED 2026-07-28 (prod) |
| `test-2` | Serving-contract characterization suite: automate the cache-1 header-probe matrix (`next build`+`next start`+local DDB stub; MISS→HIT, twin no-store, not-found, zero-DDB-on-HIT) as a runnable suite — the regression net for the CACHE track | SHIPPED 2026-07-28 (prod) |
| `test-3` | Pure unit layer for pure logic: shared schemas + `normalizeEmail` (with fnd-1), backend pure helpers (cache-2 path construction), plugins parser (with vid-1) | SHIPPED 2026-07-28 (prod) |
| `test-4` | Infra truth: delete the commented-out jest stub that reports PASS 1/1 while asserting nothing; real `cdk synth` assertions — `Template.fromStack`, one **named** assertion per ratified property (NOT `toMatchSnapshot()`) — + CI synth job. Unblocks `dep-1`. *(Scope wording corrected 2026-07-28: this cell read "snapshot tests" while the ratified design and the shipped suite are named assertions.)* | SHIPPED 2026-07-28 (prod) |

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
| `fnd-1` | Shared `normalizeEmail()` (**NFKC → trim → lowercase**, per PD-001 as amended 2026-07-28) in `@amodx/shared` — the normalizer that commerce `CUSTOMER#` keys (B) and all of customer auth (C) will be migrated onto by `fnd-2`; it has no consumers yet | SHIPPED 2026-07-28 (prod) |
| `fnd-2` | Migrate the 14 inline email call sites onto `normalizeEmail()` — **key migration**, expand-before-contract (dual-read → backfill → contract). Inventory: `docs/shipped/slices/fnd-1-normalize-email.md` § Call-site inventory | PLANNED — not yet authored |

## Track A — Video embed

Source: `docs/plan-youtube-vimeo-embed.md`. Independent; plugin-local; no migration.

| Slice | Scope | Status |
|-------|-------|--------|
| `vid-1` | YouTube/Vimeo/direct/unknown URL parser (`videoSource.ts`, SUPPORT) | SHIPPED 2026-07-28 (prod) |
| `vid-2` | Inline `video` plugin: iframe embeds + native `<video>` for direct media (defect fix) | SHIPPED 2026-07-28 (prod) |
| `vid-3` | `video-hero` block: tabbed Upload/Library/Embed + background iframe cover | IMPLEMENTED 2026-07-28 — review pending; **no decision outstanding**. `video-hero/VideoHeroRender.tsx` now branches on `parseVideoSource` and nothing else, so **no render path in `packages/plugins` carries a video-URL regex any more** and the two video blocks cannot disagree about a pasted URL. `youtube`/`vimeo` → a background `<iframe>` whose `src` is `buildBackgroundEmbedUrl(kind, providerId)` — **rebuilt from the validated id** — with `title`, `allow="autoplay; …"` and deliberately **no** `loading="lazy"` (above the fold, the opposite call from `vid-2`'s inline block, and the suite cross-checks both so a copy-paste between them fails); `direct` → the existing native `<video>`, unchanged apart from its `src`; `unknown` → the **poster image**, or no backdrop at all when none is set. That last row is the deliberate divergence from `VID2-UNKNOWN-OUTPUT` (`VID3-UNKNOWN-POSTER`): an empty 16:9 box is a hole in a content column, but a hero still needs a backdrop behind its headline. **Defect retired:** before this slice *every* non-empty `videoSrc` produced a `<video>`, so a pasted YouTube link rendered a media element pointed at an HTML page — no playback, no error, and the poster suppressed. **Security:** this also closes `vid-1` residual 4 for `video-hero` — the block previously dropped `videoSrc` into `<source src>` with **no scheme check at all**, so `javascript:…/clip.mp4` reached the attribute; the parser's ratified scheme guard now stands in front of it. `VideoHeroEditor.tsx` gains the plan's option-4b **tabbed** Upload \| Library \| SHIPPED 2026-07-28 (prod) |

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
| `dep-1` | Dependency-audit remediation for the **non-backend** workspaces — renderer (`next` → `postcss`/`sharp`, `open-next`/`esbuild`), infra (`aws-cdk-lib` → bundled `fast-uri`/`yaml`), admin (`react-router` 8.x), and the repo-wide `brace-expansion` tooling leaf. No `--force`. Detail, owners and ordering in `docs/TECH-DEBT.md`. | PLANNED |

> Backend's 2 critical `vitest`/`@vitest/ui` advisories were fixed first (`vitest ^4.1.8`,
> 0 backend vulnerabilities, tests green). A non-breaking `npm audit fix` (2026-06-29) then cleared
> 4 more HIGH (`linkify-it`, `form-data`, `undici`, `vite`) + the non-breaking moderates; `next-auth`
> → `uuid` and the `jest` → `js-yaml` moderates have since cleared too (`OBSERVED` 2026-07-28).
> `dep-1` covers what remains: **46 findings — 43 high, 3 moderate** (`EXECUTED` 2026-07-28, root
> `npm audit`), all needing a version-pin bump or a breaking change. That is not the same set as the
> earlier "2 high + 27 moderate" — the advisory database moved in both directions; `brace-expansion`
> alone accounts for 36 of the 46 nodes. **Numbers are true only as of their measurement date;
> re-run `npm audit` before acting** (grouped, with owners and runtime-exposure notes, in
> `docs/TECH-DEBT.md`).

## Cross-cutting dependencies

- `fnd-1` (`normalizeEmail`) is a prerequisite for `cmrc` `CUSTOMER#` key normalization (B)
  and all of Track C (it feeds `cognitoUsername` and every `CUSTOMER#` write). **`fnd-1`
  ships the primitive only — it migrates nothing.** The estate's 14 inline email-key sites
  still disagree with it and with each other until `fnd-2` runs, and `fnd-2` is a key
  migration (expand-before-contract), not a refactor.
- `cmrc-*` proves the private-table + cross-table-transaction pattern that `appt-*`
  reuses.
- Track C's renderer-proxy customer sessions precede `appt-4` customer endpoints.
- PD-001/002/003 (`docs/platform-decisions.md`) are binding across B, C, and D.
