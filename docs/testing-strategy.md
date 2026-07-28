# Testing Strategy

Ratified direction 2026-07-27 (human: "characterize existing testing and fill gaps —
not superficially"). Estate characterized by file-level audit 2026-07-27; this doc is
the target architecture. Track TEST in `docs/ROADMAP.md` implements it.

## Current estate (measured 2026-07-27; unit column re-measured 2026-07-28 after `test-3`, then after `vid-1`)

| Surface | Unit | Integration | API | E2E |
|---|---|---|---|---|
| backend | 3 files, AWS-free, `npm run test:unit` — `revalidate-paths` (`test-1`), `availability`, `order-email` (`test-3`); 51 tests | 8 suites vs LIVE staging DDB + API GW (`.env.test`) | same 8 suites | — |
| renderer | 2 files, AWS-free, `npm test` (`vitest.config.ts`, `include: test/unit/`) — `tenant-directory`, `not-found-handoff` (`test-3`); 29 tests | 1 suite, AWS-free (`test/serving-contract/`, `npm run test:serving`, `test-2`) | — | 2 playwright specs vs deployed staging; `public-site.spec.ts` asserts the pre-cache-1 "Site Not Found" 200 shell — STALE |
| admin | 0 (no runner installed) | — | — | 0 |
| packages/shared | 1 file, `npm test` — `test/schemas.test.ts` (`test-3`); 40 tests over the invariant-bearing parses (single `domain`, `urlPrefixes` English defaults, `ContentStatus`, the seven order statuses, `IntegrationsSchema`) | — | — | — |
| packages/plugins | 1 file, `npm test` — `test/videoSource.test.ts` (`vid-1`, revision 3); 68 tests over the four-way URL classification, the two embed-URL builders, the ratified non-http(s) scheme guard (`VID1-DIRECT-SCHEME-CONTRACT`), the plan's `direct` output contract (`embedUrl === rawUrl`) and the module's totality (11 adversarial inputs, none throws). **First suite in this workspace.** Covers `src/common/` only — the plugin components are React + Tiptap and need the §4 harness, so `vitest.config.ts` pins `include` to `test/` | — | — | — |
| packages/effects | 0 | — | — | — |
| infra | — | 1 file, AWS-free, `npm test` (jest + ts-jest, both already present) — `test/amodx-stack.test.ts` (`test-4`); 15 named assertions over a real `Template.fromStack(new AmodxStack(...))`; ≈58 s, because two application builds run inside the CDK constructors (§6) | — | — |
| CI | `ci.yml` job `build-typecheck-unit`: build → typecheck (8 workspaces) → `backend test:unit` (`test-1`, 2026-07-27) → `packages/shared` + `renderer` unit (`test-3`, 2026-07-28) → `packages/plugins` unit (`vid-1`, 2026-07-28); credential-free, every push/PR; the four unit steps together ≈2 s | `ci.yml` jobs `serving-contract` (`test-2`, 2026-07-28) and `infra-synth` (`test-4`, 2026-07-28): the renderer and infra suites above, both credential-free. `playwright.yml` runs the staging-mutating suites (secrets-gated) | — | ↑ |

Hazards: backend suites mutate shared staging state (unattended-unsafe, forbidden to
relays); `.env.test` holds live secrets. The infra false green is **closed** (`test-4`) — and
closing it surfaced a second, subtler one worth carrying as a rule: jest's default
`moduleFileExtensions` resolves `js` before `ts`, so `infra/`'s untracked compiled
`lib/*.js` leftovers shadowed the TypeScript sources and the first run silently synthesized a
seven-month-old stack. Any new jest suite in a workspace that has ever emitted JS next to its
TS must pin `moduleFileExtensions` (jest's equivalent of the `--prefer-ts-exts` that
`infra/cdk.json` already passes to ts-node) **and** assert the resolved path — see `(src1)`.

`ci.yml` deliberately references no `secrets.*` and sets no `env:` — it is the fast gate of
§7 and nothing in it can touch AWS. It installs with `npm ci`, so CI is pinned to the reviewed
`package-lock.json`; `test-1` repaired that lockfile by hand-adding the Linux/win32 entries of the
five native families that were missing them, changing no existing entry. If it ever regresses, add
the entries back — do not regenerate the lockfile (`docs/TECH-DEBT.md`, recipe in `TESTING.md`).
`npm run typecheck` runs **after** `npm run build`, not instead of it:
`tsc --noEmit` emits nothing, so consumers of `@amodx/shared` / `effects` / `plugins` need those
packages' `dist/*.d.ts` on disk, and `renderer/tsconfig.json` includes `.next/types/**`, which
`next build` generates.

## Test taxonomy and where each kind lives

1. **Unit** — pure logic, no AWS, no network, vitest, in every workspace that has pure
   logic. Gate: runs in relays and CI on every change. First targets: shared schemas +
   `normalizeEmail` (fnd-1), plugins `videoSource` (vid-1), renderer
   `tenant-directory`/`not-found-handoff`, backend pure helpers.
   *Status: `test-3` (2026-07-28) delivered the layer for the logic that exists today —
   `packages/shared` schemas, renderer `tenant-directory` + `not-found-handoff`, backend
   `availability` + `order-email`; 120 tests, ≈0.6 s of runtime across the three
   workspaces, zero new packages in the dependency tree (vitest 4.1.8 was already there for
   backend). Still outstanding by design: `normalizeEmail` does not exist until `fnd-1`;
   admin needs an RTL harness (§4).*
   *Status: `vid-1` (2026-07-28) added the plugins leg — `packages/plugins/test/videoSource.test.ts`,
   68 tests, ≈0.14 s, again **zero new packages** (vitest 4.1.8 already resolved). It is the
   workspace's first harness, so it also establishes the shape for the rest of `src/common/`:
   node environment, `include` pinned to `test/`, tests import `src/` and never `dist/`. It
   earns its place under the rule above by pinning a contract two future render paths
   (`vid-2`, `vid-3`) will both branch on, and branches the wire cannot reach cheaply — a
   suffix-confusion host, an 11-vs-12-character provider id, a `javascript:` scheme.
   Revision 1 (2026-07-28) also demonstrates the mutation discipline §7 asks for: a
   non-discriminating assertion (a `data:` URL whose path did not end in `.mp4`, so the
   extension test rejected it with or without the guard under test) was replaced by four
   rows that the guard's deletion actually flips, and the surviving non-discriminating row
   is labelled as such in the file rather than left to read as coverage.
   Revision 2 (2026-07-28) is the same lesson found by review rather than by mutation: a test
   asserted the `direct` `embedUrl` as the **trimmed** input, which passed under both the
   plan's contract and the deviation actually shipped, so it pinned the wrong one without
   being able to tell. Rewritten to assert `embedUrl === rawUrl` on a whitespace-bearing
   input **and** `kind === "direct"` — the two halves fail in opposite directions, and a
   third mutation round confirms it. **The generalisable rule: an assertion whose expected
   value is computed the same way the implementation computes it cannot detect the
   implementation being wrong.** Assert against the specification's value, not the code's.*
   A unit test earns its place by pinning a branch the wire cannot reach cheaply or a
   contract that spans workspaces — TTL expiry, cache eviction, fail-open, schema
   accept/reject, `OrderSchema.status` ↔ `STATUS_LABELS`. Restating what
   `test/serving-contract/` already measures end-to-end is duplication, not coverage.
2. **Serving-contract (renderer integration)** — the cache probe matrix automated
   against `next build` + `next start` + a local DynamoDB stub. Pins MEASURED behavior
   (docs/caching-architecture.md §Measured serving behaviour), including warts. The
   regression net for Track CACHE and the future PPR track.
   *Status: implemented as `renderer/test/serving-contract/` (`test-2`, 2026-07-28) —
   16 assertions, one per contract row, plus 2 harness isolation self-checks; ≈9 s;
   credential-free by construction — the child processes get an explicitly built environment
   and cannot read `renderer/.env*` (that directory's `README.md` § "Credential-free" carries
   the measured matrix). Runner is `node:test`, not
   vitest; rationale in that directory's `README.md` § "Why node:test". Origin-side only by
   design: the CloudFront half of the contract (cache-key allowlists, the `x-has-session`
   viewer function) is a `cdk synth` assertion and belongs to `test-4`.*
3. **Backend integration/API** — repoint the 8 suites at DynamoDB-local (container);
   unattended-safe, parallel-safe. The staging-hitting mode remains as an explicit
   operator-run pre-deploy check only.
4. **Admin component** — vitest + React Testing Library, targeted at money paths
   (settings persistence, upload constraints, publish flow) — not blanket coverage.
5. **E2E (playwright)** — post-deploy verification vs staging: fix the stale 404 spec
   to the new contract (middleware 404 + no-store), then encode the deploy-runbook
   probes (RSC, junk-param, nf, warm-edge session) as automated checks.
6. **Infra** — `cdk synth` assertions (Template.fromStack): cache policy allowlists,
   CF function presence, IAM boundaries (e.g. `cloudfront:CreateInvalidation` confined to
   **3 request-path Lambdas** — debounce, flush, nightly — **plus 1 deploy-time role**,
   CDK's `BucketDeployment` custom resource, which holds the action only while `cdk deploy`
   runs). Deletes the lying stub. Unblocks dep-1.
   *(The role contract on this line read "confined to 3 Lambdas" until 2026-07-28; corrected
   to the four named roles by operator decision `test4-invalidation-role-contract` — the
   synthesized template always had 4, so the plan was wrong, not the infra. See
   `docs/slices/test-4-infra-truth.md` § Finding 2 and `docs/caching-architecture.md`
   § Key Architectural Decision.)*
   *Status: implemented as `infra/test/amodx-stack.test.ts` (`test-4`, 2026-07-28) — 15 named
   assertions, each carrying the slice or decision that ratified the property it pins, plus
   three isolation self-checks; zero new dependencies. Mutation-checked in **five rounds**
   across two different `infra/lib` files and three assertion families (`(a2)`, `(e2)`, `(d)`×3
   — a removed request-path grant, an added fifth grant, a second removed request-path grant);
   every round failed **only** its target assertion, and every temporary edit was reverted and
   proven reverted by `shasum` equality plus an empty `git diff -- infra/lib infra/bin`.
   Named assertions, NOT
   `toMatchSnapshot()`: a snapshot over 410 resources fails on every unrelated change and gets
   re-blessed rather than read, which is a green that means "someone pressed `-u`".
   Two corrections to the plan above came out of the implementation, and both are now folded
   into it: the invalidation blast radius is **4** roles (3 request-path + 1 deploy-time), where
   the plan had said 3 — the fourth is CDK's own `BucketDeployment` custom resource, which holds
   `cloudfront:CreateInvalidation` so it can invalidate after uploading assets — and the suite is
   ≈58 s rather than instant, because `RendererHosting` and `AdminHosting`
   run the renderer OpenNext build and the admin vite build **inside their constructors**. That
   second fact is also why this suite needs its own `.env*` blindfold
   (`infra/test/no-dotenv.cjs`): without it, `next build` would load the operator's real
   `AMODX_API_KEY` and `TABLE_NAME`, exactly as `test-2` measured for the renderer. Lifting
   build orchestration out of the constructs is `docs/TECH-DEBT.md`.*
7. **CI ordering** — every push: build + typecheck + unit (fast, no credentials), plus the
   serving-contract suite as a parallel job. On demand / nightly: local-DDB integration.
   Post-deploy: e2e vs staging.
   *Status: `.github/workflows/ci.yml` carries three credential-free jobs —
   `build-typecheck-unit` (`test-1`, extended by `test-3` with the `packages/shared` and
   `renderer` unit steps and by `vid-1` with the `packages/plugins` step — four unit steps),
   `serving-contract` (`test-2`) and `infra-synth` (`test-4`). The
   backend local-DDB and post-deploy legs are still unimplemented.*

## Invariants

- A test that requires live shared AWS state is never a default gate and never
  relay-runnable.
- A suite that asserts nothing must not exist (no false greens).
- Serving-contract changes (anything touching caching) must update the contract suite
  in the same slice — the suite IS the contract's executable form. Concretely: a failing
  test in `renderer/test/serving-contract/contract.test.mjs` is a **contract change**, and
  the slice that causes it updates that file *and*
  `docs/caching-architecture.md` § *Serving contract* / § *Measured serving behaviour*
  together. Relaxing the assertion alone is the false-green failure mode above.
- An absence assertion ("nothing was stored", "zero reads") must ship with a positive
  control that exercises the same detector. Without one, a broken detector reads as a pass —
  which is the `infra` jest stub's failure mode expressed differently.
- A gate that claims to be **credential-free must construct the environment of any process it
  spawns**, not inherit it. `{ ...process.env }` is inheritance: it admits the operator's
  shell and, for anything Next-based, `renderer/.env*` on top of that. Measured 2026-07-28 on
  this repo, that path put a real `AMODX_API_KEY` into a test child. The claim is also not
  self-evident from a green run, so state the mechanism and assert it — see
  `renderer/test/serving-contract/` `(iso1)`–`(iso4)`, which fail if the isolation regresses.
- Corollary, and the part that is easy to get wrong: **the unit of isolation is the process
  tree, not the process you spawn.** A build tool forks workers, and a worker given its own
  `execArgv` inherits the environment but not the parent's command-line flags — so an
  isolation measure delivered on argv silently stops at the first fork. Deliver it in the
  environment, and then *measure the coverage* rather than reasoning about it: the hook in
  `renderer/test/serving-contract/no-dotenv.cjs` journals one record per process it loads
  into, and `(iso3)` fails unless the processes the build spawned are in that journal
  (14 covered, measured 2026-07-28). Where the tool reports the same fact about itself —
  `next build` prints `- Environments: <files>` — assert that too: it is the one reading that
  needs no cooperation from the harness.
