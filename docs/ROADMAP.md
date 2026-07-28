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
| `test-2` | Serving-contract characterization suite: automate the cache-1 header-probe matrix (`next build`+`next start`+local DDB stub; MISS→HIT, twin no-store, not-found, zero-DDB-on-HIT) as a runnable suite — the regression net for the CACHE track | IMPLEMENTED 2026-07-28, revision 2 — review pending. `renderer/test/serving-contract/` + `npm run test:serving`: 16 assertions, one per contract row, plus 4 isolation self-checks; ≈10 s; zero new dependencies (`node:test`; rationale in that directory's `README.md`). Credential-free **by construction**: the child processes get an explicitly built environment and `renderer/.env*` is hidden from the whole process tree `next build` forks (revision 1 fixed an inherited `process.env` that admitted the operator's real `AMODX_API_KEY`; revision 2 moved the hook to `NODE_OPTIONS` and made its coverage a measured assertion — 14 processes). CI job `serving-contract` in `.github/workflows/ci.yml`. Only non-doc change outside `test/` is the renderer `test:serving` script. First run doubles as the regression check `sec-1`'s `next` 16.2.9 → 16.2.12 bump never got: **no contract drift** — every measured row identical (slice doc § Build run) |
| `test-3` | Pure unit layer for pure logic: shared schemas + `normalizeEmail` (with fnd-1), backend pure helpers (cache-2 path construction), plugins parser (with vid-1) | IMPLEMENTED 2026-07-28 — review pending (shared schema accept/reject + renderer tenant-directory/not-found-handoff pure branches; 2 product bugs found, see TECH-DEBT) |
| `test-4` | Infra truth: delete the commented-out jest stub that reports PASS 1/1 while asserting nothing; real `cdk synth` assertions — `Template.fromStack`, one **named** assertion per ratified property (NOT `toMatchSnapshot()`) — + CI synth job. Unblocks `dep-1`. *(Scope wording corrected 2026-07-28: this cell read "snapshot tests" while the ratified design and the shipped suite are named assertions.)* | IMPLEMENTED 2026-07-28 — review pending. Stub deleted; `infra/test/amodx-stack.test.ts` = 15 **named** assertions (not a snapshot — a snapshot over 410 resources is re-blessed, not read) over a real `Template.fromStack(new AmodxStack(...))`, each naming the slice/decision that ratified the property it pins: cache-key header + query allowlists, `CookieBehavior: none`, TTLs, the viewer-request Function on both keyed behaviors, `api/*` = CACHING_DISABLED, the S3 static behaviors, the `cloudfront:CreateInvalidation` blast radius, both flush schedules. 58 s, **zero new dependencies**. Mutation-checked in **five rounds** (`nf` dropped from the query allowlist → only `(a2)` fails; nightly cron 02→03 → only `(e2)` fails; then three rounds on `(d)` — a removed nightly grant, an added fifth grant on a DDB-read-only handler, a removed debounce grant — each failing only `(d)`, at the expectation that names the role that moved), every temporary edit reverted and proven reverted by hash; final diff touches **no** `infra/lib` / `infra/bin`. CI job `infra-synth` in `.github/workflows/ci.yml`. Three findings: jest was silently resolving **seven-month-old compiled `infra/lib/*.js`** instead of the TS sources (fixed + pinned by `(src1)`); the invalidation blast radius is **4** roles, not the documented 3 (the 4th is CDK's `BucketDeployment` custom resource — contract corrected 2026-07-28 by decision `test4-invalidation-role-contract`, `(d)` now asserts 3 request-path + 1 deploy-time and fails on a fifth, and `docs/caching-architecture.md` § *Key Architectural Decision* was amended); and `npm test` in infra runs the renderer + admin builds inside the CDK constructors, which without the new `.env` blindfold would have fed a live `AMODX_API_KEY` to a Next build. `dep-1` step 1 satisfied |

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
| `vid-1` | YouTube/Vimeo/direct/unknown URL parser (`videoSource.ts`, SUPPORT) | IMPLEMENTED 2026-07-28, **revision 3** — review pending; **no decision outstanding**. `packages/plugins/src/common/videoSource.ts` (pure, total, zero imports) + `test/videoSource.test.ts` (68 tests, ≈0.14 s), the plugins workspace's **first** test harness; CI step `Plugins unit tests` in the existing credential-free `build-typecheck-unit` job. All 10 rows of the plan's original Testing Checklist pass with the plan's expected values (slice doc § *Parser output*). Mutation-checked in 2 rounds (re-run at revision 1), each failing only its target assertions, each reverted and proven reverted by hash. **Zero packages added to the tree** — `vitest@4.1.8` was already there for backend + shared, so `npm install` reported `up to date` and `npm audit` is unchanged at 46 (3 mod / 43 high). The one deviation raised at revision 0 is **RATIFIED** (`VID1-DIRECT-SCHEME-CONTRACT` = RETAIN, operator 2026-07-28): `isDirectMediaUrl` rejects non-http(s) schemes, so `javascript:…/x.mp4` cannot be classified `direct` and reach `vid-2`'s `<video src>`. It is now an amendment to `docs/plan-youtube-vimeo-embed.md` rule 3 (plan doc edited, so plan and code agree), pinned by 4 discriminating tests — deleting the guard fails exactly those 4. Revision 1 changed **no behaviour**: two code files touched, one a comment and one the test file. **Revision 2** clears the revision-1 review's two required changes: (a) the `direct` kind's `embedUrl` is restored to the plan's contract — the **raw** URL, so `embedUrl === rawUrl`; the trimmed value was a *second*, never-ratified deviation that a same-shaped test had pinned in place (now mutation-checked: round 3 fails exactly that one test); (b) `docs/TECH-DEBT.md`'s dependency-audit counts are reconciled against a freshly executed root `npm audit` — the tracker's "2 high + 27 moderate" was stale, 46 (3 mod / 43 high) is correct, and the delta plus the new `sharp`/`react-router` HIGHs, the cleared `uuid`/`js-yaml` items and the evidence that `npm audit fix` clears none of them are all written into the tracker. Still 68 tests, unchanged CI step. **Revision 3** closes the second and last open question and changes **no code**: the revision-2 review escalated the root `package-lock.json` diff against the task packet's "ZERO changes outside…" wording, and the operator ratified it (`VID1_LOCKFILE_SCOPE`) — an npm-workspace devDependency cannot be declared without the root lockfile recording it, and CI's `npm ci` fails outright when a manifest and the lockfile disagree, so the constraint as worded was unsatisfiable. The diff is authorized narrowly, as an ancillary of the permitted `vitest` devDependency: metadata only, **zero** `node_modules/` entries added (measured, not asserted). Every gate re-measured green against the current tree, and the parser output table re-derived from the built `dist/` artifact rather than source |
| `vid-2` | Inline `video` plugin: iframe embeds + native `<video>` for direct media (defect fix) | IMPLEMENTED 2026-07-28 — review pending; **no decision outstanding**. `video/VideoRender.tsx` rewritten around `parseVideoSource` (the inline YouTube regex is **gone**): `youtube`/`vimeo` → `<iframe>` on a URL **rebuilt from the validated provider id** with `loading="lazy"` + `title`; `direct` → native `<video controls>` (the defect — direct media was piped to an iframe and did not play reliably); `unknown` → `null`, no markup at all. `VideoEditor.tsx` gains a provider indicator (icon SHAPE + label in `text-muted-foreground`) and a warning callout on a non-empty unrecognized URL, which is the author's ONLY signal since the page renders nothing. New `test/videoPlugin.test.ts` — 38 tests asserting **rendered output**, via `renderToStaticMarkup` through `RENDER_MAP["video"]`, so it covers the render-entry wiring and doubles as an SSR-safety smoke test; no DOM/jsdom/RTL harness needed and **zero packages added to the tree** (`react`/`react-dom` were already hoisted; only the devDep declaration + 2 lockfile lines). Plugins suite now 106 tests. Five in-flight decisions recorded in the slice doc § *Decisions taken in-flight* — the load-bearing one is `VID2-UNKNOWN-OUTPUT` (`unknown` renders **nothing**, not an empty 16:9 container, so a bad URL leaves no black hole on a public page) and `VID2-WARNING-TOKEN` (the admin design system has **no** semantic warning token, so the callout uses the neutral fallback the slice doc prescribes; recorded as `vid-2` debt). CSP pre-flight `OBSERVED`: **no CSP exists anywhere** in renderer or infra, so the iframes are unblocked today — but a future CSP must allow `frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com` or every video block goes blank at once. `vid-1`'s residual-4 output-encoding obligation is **discharged for `video`** (still open for `video-hero`). All gates green: full 5-package rebuild, 8-workspace typecheck, and 261 tests across 6 runners including `test-2`'s serving contract (20/20) and `test-4`'s infra synth (15/15). Visual/mobile-autoplay checks and editor INTERACTION remain `NOT RUN` and are the operator's. **Revision 1** reverted revision 0's comment-only `.github/workflows/ci.yml` edit — the packet permits a CI change only if a job addition is needed, and none was, since `packages/plugins` `npm test` is `vitest run` with no path argument and discovers the new file by glob. **Revision 2** changes **no code** and clears the revision-1 review's single finding: `CURRENT_SLICE.md` still credited `vid-2` with "one CI *comment* correction" after that revert, a doc claim against a file that is byte-identical to `HEAD`. All eight gates were re-executed against the revised tree rather than inferred — 261/261, unchanged |
| `vid-3` | `video-hero` block: tabbed Upload/Library/Embed + background iframe cover | IMPLEMENTED 2026-07-28 — review pending; **no decision outstanding**. `video-hero/VideoHeroRender.tsx` now branches on `parseVideoSource` and nothing else, so **no render path in `packages/plugins` carries a video-URL regex any more** and the two video blocks cannot disagree about a pasted URL. `youtube`/`vimeo` → a background `<iframe>` whose `src` is `buildBackgroundEmbedUrl(kind, providerId)` — **rebuilt from the validated id** — with `title`, `allow="autoplay; …"` and deliberately **no** `loading="lazy"` (above the fold, the opposite call from `vid-2`'s inline block, and the suite cross-checks both so a copy-paste between them fails); `direct` → the existing native `<video>`, unchanged apart from its `src`; `unknown` → the **poster image**, or no backdrop at all when none is set. That last row is the deliberate divergence from `VID2-UNKNOWN-OUTPUT` (`VID3-UNKNOWN-POSTER`): an empty 16:9 box is a hole in a content column, but a hero still needs a backdrop behind its headline. **Defect retired:** before this slice *every* non-empty `videoSrc` produced a `<video>`, so a pasted YouTube link rendered a media element pointed at an HTML page — no playback, no error, and the poster suppressed. **Security:** this also closes `vid-1` residual 4 for `video-hero` — the block previously dropped `videoSrc` into `<source src>` with **no scheme check at all**, so `javascript:…/clip.mp4` reached the attribute; the parser's ratified scheme guard now stands in front of it. `VideoHeroEditor.tsx` gains the plan's option-4b **tabbed** Upload \| Library \| Embed selector over the single `videoSrc` attribute, a provider indicator + warning callout driven by the SAME classifier (so editor promise and page behaviour cannot drift), and a YouTube thumbnail preview — `hqdefault`, not the plan's `maxresdefault`, which 404s for sub-720p uploads (`VID3-YT-THUMB-HQDEFAULT`). Because `buildBackgroundEmbedUrl` hardcodes mute+loop, the Muted/Loop checkboxes are **replaced by a statement of fact** on embed sources rather than left as controls that silently do nothing (`VID3-EMBED-MUTED-LOOP-INERT`). Cover is the plan's ratified min-width/min-height sizer, emitted as an **inline style** because this package ships no CSS (`VID3-SIZER-INLINE-STYLE`). New `test/videoHeroPlugin.test.ts` — **66 tests** on rendered output via `renderToStaticMarkup` through `RENDER_MAP["videoHero"]`, following `vid-2`'s pattern (e8da608): element + `src` per kind, every background parameter asserted **by name** (including the `playlist={id}` pairing without which YouTube's `loop=1` is inert), the sizer's emitted declarations, hostile-input degradation, a `VideoHeroSchema` round-trip pinning the "schema unchanged" non-scope, and the editor's tabs/indicator/warning/preview. **Zero packages added**; `package-lock.json` and `.github/workflows/ci.yml` untouched (`vitest run` discovers the file by glob). Plugins suite now **172 tests**. All gates green: 5-package rebuild, 8-workspace typecheck, 172 + 20 + 51 + 29 + 15 tests across 5 credential-free runners. `cd backend && npm test` is `NOT RUN` — it needs real staging DynamoDB and this slice touches no backend code. **Viewport cover (landscape/portrait), mobile autoplay and hydration are `NOT RUN` and are the OPERATOR's** — they are layout/device measurements a node-environment static-markup harness cannot make; a 9-item checklist is in the slice doc § *Operator visual checklist*. MCP sync checked and **not owed** (`OBSERVED`: `videoHero` is in neither `BLOCK_SCHEMAS` nor `add_block`'s enum, and no `video` attribute changed) — adding it would be new scope, surfaced not built |

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
  and all of Track C (it feeds `cognitoUsername` and every `CUSTOMER#` write).
- `cmrc-*` proves the private-table + cross-table-transaction pattern that `appt-*`
  reuses.
- Track C's renderer-proxy customer sessions precede `appt-4` customer endpoints.
- PD-001/002/003 (`docs/platform-decisions.md`) are binding across B, C, and D.
