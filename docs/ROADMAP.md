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

**Execution reorder (human, 2026-08-07): Track B (commerce-private) DEFERRED — not
urgent (commerce is test-only; no live commerce tenants). The implementation wave for
the ratified plans runs first: fnd-2 → cache-4 → REV (rev-1..4) → STATIC (static-1..4)
→ EMAIL (email-2, email-2a, email-3). Track B resumes after, on the human's word; its
pre-condition (F-SHARED-1 Romania default) rides in this wave (see rev/cmrc notes).**

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
| `cache-4` | Granular invalidation (operator-requested 2026-07-26): replace the CloudFront `/*` sledgehammer with changed-path invalidations derived from the mutation (per page / per entity), and adopt tag-based ISR revalidation ("all pages showing product X") using the already-provisioned tag-cache table. **Go-live timer redefined (human 2026-07-26): ordinary admin edits invalidate their changed paths immediately — instant go-live; the 15-min debounce + banner remain only for bulk/global mutations (imports, theme changes)** where `/*` coalescing still pays. Constraint to design around: on the shared distribution, CloudFront invalidation paths match URI paths across ALL tenant hosts — true per-tenant Layer-1 isolation needs per-tenant distributions (Workstream 3); collateral is cheap once cache-1/2 land because same-path entries on other tenants refill from warm ISR without SSR. Slice doc to be authored after cache-1..3 ship. **`cache-4a` (instant go-live / changed-path invalidation) IMPLEMENTED 2026-08-07 — `docs/slices/cache-4a-instant-golive.md`, code complete, live probe is the operator gate. Remaining: `cache-4b` tag-based ISR revalidation.** | PARTIAL |
| `cache-5` | Unknown-tenant handling hardening beyond cache-1's middleware domain-cache (sequencing with domain-onboarding flow; authored after cache-1 ships and the D3 mechanism is measured) | PLANNED |
| `cache-7` | Forward OpenNext revalidation headers (`x-prerender-revalidate`, `x-isr`) through `RendererOriginPolicy` — background ISR refresh was failing on EVERY host since inception (third instance of the ORP-whitelist defect class; now assertion-pinned). Human-reported symptom: new articles never appeared in post grids until the nightly flush. | SHIPPED 2026-08-05 (prod, live-verified) |
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
| `test-5` | Deployed-staging playwright round-trip for the review import→moderate→display flow (`tests/e2e/review-flow.spec.ts` + `tests/e2e/support/staging-admin.ts`) — the authenticated-write gap the mocked `review-import-fixture.test.ts` cannot close: real AWS auth/IAM/S3 + the DynamoDB reserved-keyword projection (asserts `source` returns on `/public/reviews/{id}`, the layer that hid the `source` 500). Proves the private→public moderation boundary, STAGED-image tenant isolation (tenant B blocked from presign-view **and** approve/promote a pre-promotion pending image) + post-promotion row isolation, and a fail-red namespace-sweep cleanup assertion. `STAGING_E2E=1`-gated (self-skips in the credential-free gate); mints a real admin id-token via the ratified staging-scoped, self-reverting Cognito auth-flow toggle. CI: separate manual `on: workflow_dispatch` job `.github/workflows/staging-e2e.yml` (NOT on the push/PR gate; existing `playwright.yml` untouched). | IMPLEMENTED 2026-08-09 — SHIPPED pending: configure the two new repo secrets (`TEST_ADMIN_USER` / `TEST_ADMIN_PASSWORD`) on the manual job + dispatch it green (operator action) |

Deferred (documented, not slices yet): local-DynamoDB backend integration tests.
*(The former "playwright expansion (needs a deployed-target strategy)" deferral is
retired: `test-5` (above) delivers exactly that — a deployed-staging playwright
round-trip — via the `STAGING_E2E=1`-gated manual `workflow_dispatch` job.)*

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
| `fnd-2` | Migrate the 14 inline email call sites onto `normalizeEmail()`. As authored (`docs/slices/fnd-2-normalize-email-callsites.md`, PD-001 as amended) this is the **call-site refactor only** — the persisted-key backfill (expand-before-contract) is scoped OUT and carried as finding **F-FND2-1** to a future data slice gated behind Track B. Inventory: `docs/shipped/slices/fnd-1-normalize-email.md` § Call-site inventory | IMPLEMENTED 2026-08-07 (credential-free suites green; deploy/staging + backfill pending) |

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
  disagreed with it and with each other until `fnd-2`. As amended (PD-001), `fnd-2` performs
  the **call-site refactor** — all 14 sites now derive keys through `normalizeEmail()`; for
  ASCII addresses the derived key is byte-identical to the old `.toLowerCase()` form, so
  live records stay reachable. The **persisted-key backfill** (expand-before-contract for the
  rare non-ASCII/whitespace key written pre-`fnd-2`) is the remaining key migration, deferred
  as finding **F-FND2-1** to a future data slice gated behind Track B.
- `cmrc-*` proves the private-table + cross-table-transaction pattern that `appt-*`
  reuses.
- Track C's renderer-proxy customer sessions precede `appt-4` customer endpoints.
- PD-001/002/003 (`docs/platform-decisions.md`) are binding across B, C, and D.

## Backlog / Discovery Tracks (added 2026-07-30, human notes reconciled against repo)

Known product opportunities. NOT active slices until promoted into Current Priority and
decomposed into `docs/slices/`. Reconciliation: video embeds are SHIPPED (Track A);
commerce-privacy IS Track B; the rest below. Discovery plans to author first (in this
order, doc-only, can proceed while Track B runs): ~~`EMAIL` (sales/migration friction)~~ —
**authored 2026-07-30, `docs/plan-email-onboarding.md`; awaiting ratification of D-EMAIL-1
and D-EMAIL-6 before any `email-*` slice doc** — then `REV` (API/media/legal unknowns), then
~~`STATIC` (raw-HTML security boundary)~~ — **authored 2026-08-06,
`docs/plan-static-html-pages.md`; awaiting ratification of `D-STATIC-1`..`D-STATIC-5` before any
`static-*` slice doc**.

| Track | Scope | Repo head start | Gate |
|---|---|---|---|
| REV | **RATIFIED 2026-08-07** (`docs/plan-reviews-import.md`): per-image approval gates; private-stage→screen→promote hosting; immutable rights attestation; byte-level re-encode + input allowlist JPEG/PNG/HEIC/WebP (SVG rejected); `scope: product\|site` reviews. Phases rev-1..4 ready to queue; rev-5/6 connectors gated on verify-at-phase-start | head start: CRUD+moderation+carousel exist | rights/API risks quarantined in connectors |
| STATIC | Lovable/static HTML pages: isolation model → S3 + page schema → admin upload/preview → renderer route. **Discovery plan authored 2026-08-06: `docs/plan-static-html-pages.md`** (`static-1` = the plan itself, doc-only, delivered). Phase numbering `static-1`..`static-4` unchanged. Estate audit corrected two head-start claims: the `html` block is **not** sanitized (`packages/plugins/src/html/HtmlRender.tsx:7-20`, raw `dangerouslySetInnerHTML`, and its innerHTML path cannot execute page `<script>` at all), and the S3 assets origin is a **separate cross-origin** `AssetsDistribution` (`infra/lib/uploads.ts:49-55`) with **no** response-headers policy — that cross-origin separation is exactly what makes the sandboxed-iframe default candidate cheap. 5 ratification-class decisions raised (`D-STATIC-1`..`D-STATIC-5`); the plan **recommends** the ROADMAP's default candidate (a) — now scoped as a **three-variant family** (preferred **a1**: opaque-origin frame + a scoped asset-origin **cache behavior + constant-CORS `ResponseHeadersPolicy` pair** — a headers policy attaches to a behavior and `AssetsDistribution` has only a default one, so it is a behavior+policy pair, not a lone policy) because the strictest variant (a-opaque) **likely fails to render a stock Vite/React export** (module scripts are CORS-fetched; the asset `GET` returns no `Access-Control-Allow-Origin`, `uploads.ts:24-28` allows only PUT/POST + no CloudFront response-headers policy — INFERRED, spike-must-confirm). Its § 2.3 containment stays **conditional** on three OBSERVED facts (no CORS on renderer APIs; `SameSite=lax` cookies; `allow-scripts`-only token set), **not** categorical. | Sanitized `html` block plugin (**correction: NOT sanitized** — see plan § 2.1) + S3 assets origin exist | `static-1` isolation decision `D-STATIC-1` is RATIFICATION-CLASS (raw script vs the session/cookie boundary the CACHE track sealed); sandboxed iframe from asset origin = default candidate (three-variant family, preferred a1), **argued for in the plan; ratifying `D-STATIC-1` AUTHORIZES a bounded pre-implementation spike that picks the concrete variant and validates the § 3(a) residuals — the spike sits between `static-1` and `static-2` (NOT a new phase), replacing the earlier circular "static-2 entry gate" framing**. `static-2`..`static-4` slice docs await ratification of `D-STATIC-1`..`D-STATIC-5`. `static-` prefix registered in `docs/documentation.md` § *Naming Conventions* when the first slice doc is authored |
| AI | In-panel admin AI (MCP) | `plan-ai-admin.md`, LlmGateway hedge, operator-side tools/mcp-server | `ai-0` provider/tooling decision record; preview/apply only, full audit, admin-only |
| CART | Abandoned cart recovery: snapshots → consent/capture → scheduler+templates → suppression → analytics | None | HARD-GATED on Track B (snapshots live in commerce-private table) + consent model |
| EVT | Events (capacity, attendees, tickets, waitlist) — distinct domain from Track D appointments (resource booking) | None; reuses D's kernel concepts only | After Track D |
| PERF | `perf-1`: platform-wide unused-JS reduction (~1s on every measured site; likely plugin bundles loading for absent blocks). Gate: the 2026-08-08 Lighthouse baseline (`docs/perf/baselines-2026-08-08.md`) re-run same-method, score delta reported. Queued AFTER the current implementation wave. | serving healthy; LCP is the image story (see opennext-1 note) | zero-risk code-splitting |
| LINK | Linktree-style pages: link-list plugin → page template → optional analytics | None; vid-1-shaped plugin work | None — filler candidate between heavy tracks |
| EMAIL | Domain-email onboarding (cPanel migration friction): email audit → guided DNS for external mailbox providers (Workspace/M365/Zoho/existing cPanel) → SES DKIM/DMARC health → SES inbound: GATED ask-only delegated-subdomain archive per D-EMAIL-2 (apex MX/forwarding permanently rejected) → migration checklist. **Discovery plan authored 2026-07-30: `docs/plan-email-onboarding.md`** (`email-1` = the plan itself, doc-only, delivered). Phase numbering is **unchanged** — the plan decomposes `email-1`..`email-5` exactly as ratified here. Both human-notes claims are now **VERIFIED** there: WorkMail **ends support 2027-03-31** and closed to new customers 2026-04-30, so it is excluded as a migration *target* for anyone, eligible or not (whether *this* AWS account is grandfathered is separately marked **NOT VERIFIED** in § 3.1(c) — no organization exists in any of the 3 WorkMail regions, `EXECUTED`, but eligibility is an AWS-side determination with no queryable API; nothing in the plan rests on it); SES inbound receiving **IS available in eu-central-1** (`inbound-smtp.eu-central-1.amazonaws.com`, docs table + live DNS), so the inbound question is product/liability, not availability. The audit found the sending foundation broken **underneath** phases 2–3: **one shared platform sender** (`contact@bijuterie.software`) for every tenant with no per-tenant sender field, so guided DNS would list DKIM records that authorize nothing and a "per-tenant health page" would render one platform status light 99×; **zero DMARC** on all 4 domains inspected; **no custom MAIL FROM** (SPF unaligned → DMARC rests solely on DKIM); **zero SES config sets** → bounces/complaints uncaptured and account-level suppression drops mail on a *successful* API call, invisible at every layer; **zero SES resources in CDK** (identities are not reproducible from any repo and `test-4` has nothing to assert — *how* they were created is **`NOT VERIFIED`**, with CloudFormation and CloudTrail both ruled out as sources of the answer; staging and prod share one identity + suppression list + reputation); and the SES account is, **`INFERRED` (high confidence, not observed)**, **shared with a non-AmodX workload** — the AWS account demonstrably is (12 CFN stacks in eu-central-1, half of them non-AmodX, `EXECUTED`); that one of those other workloads is what *sends* the mail behind the suppression-list bounces remains the inference. 12 findings (F-EMAIL-1..12, plus sub-finding F-EMAIL-2b), 6 ratification-class decisions (D-EMAIL-1..6). Two deviations are **proposed, not taken**: an ordering prerequisite (D-EMAIL-6) and one **unnumbered added** phase for bounce/suppression visibility (`email-obs`) which does **not** displace `email-4` inbound or `email-5` checklist — promoting or numbering it is a change to this row and requires ratification. Note the plan's INVARIANT under D-EMAIL-1: SES reputation, quota, `EnforcementStatus` and the suppression list are **per-account-per-region, not per-identity**, so per-tenant identities buy branding and DMARC alignment only — isolation needs SES Tenants (v2) or a separate AWS account. | Outbound SES verified-identity sending only — **one hardcoded platform address, SES account-wide: 2 sends/30 days, maturity PROTOTYPE** (audit `EXECUTED` 2026-07-30). That figure is an **account total, not AmodX's** (`EXECUTED`: `cloudwatch list-metrics --namespace AWS/SES` returns `Send`/`Delivery` with `"Dimensions": []`, and zero configuration sets exist to supply a dimension), so AmodX's own share is **`NOT OBSERVED`** and the number is usable only as an *upper bound* on AmodX volume — see plan § 2.2 | NOT a mail server. Commercially heaviest backlog item. **Now gated on D-EMAIL-1 (per-tenant vs shared sending identity — blocks `email-3` scoping) and D-EMAIL-6 (where the per-tenant-sender prerequisite lands; this row's numbering is preserved under every option).** D-EMAIL-2 (offer inbound at all?) gates `email-4`, which may be `WITHDRAWN`. `email-` prefix still to be registered in `docs/documentation.md` § *Naming Conventions* when the first slice doc is authored |
