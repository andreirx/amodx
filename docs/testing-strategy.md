# Testing Strategy

Ratified direction 2026-07-27 (human: "characterize existing testing and fill gaps —
not superficially"). Estate characterized by file-level audit 2026-07-27; this doc is
the target architecture. Track TEST in `docs/ROADMAP.md` implements it.

## Current estate (measured 2026-07-27; unit column re-measured 2026-07-28 after `test-3`)

| Surface | Unit | Integration | API | E2E |
|---|---|---|---|---|
| backend | 3 files, AWS-free, `npm run test:unit` — `revalidate-paths` (`test-1`), `availability`, `order-email` (`test-3`); 51 tests | 8 suites vs LIVE staging DDB + API GW (`.env.test`) | same 8 suites | — |
| renderer | 2 files, AWS-free, `npm test` (`vitest.config.ts`, `include: test/unit/`) — `tenant-directory`, `not-found-handoff` (`test-3`); 29 tests | 1 suite, AWS-free (`test/serving-contract/`, `npm run test:serving`, `test-2`) | — | 2 playwright specs vs deployed staging; `public-site.spec.ts` asserts the pre-cache-1 "Site Not Found" 200 shell — STALE |
| admin | 0 (no runner installed) | — | — | 0 |
| packages/shared | 1 file, `npm test` — `test/schemas.test.ts` (`test-3`); 40 tests over the invariant-bearing parses (single `domain`, `urlPrefixes` English defaults, `ContentStatus`, the seven order statuses, `IntegrationsSchema`) | — | — | — |
| plugins/effects | 0 | — | — | — |
| infra | jest file 100% commented out, reports PASS 1/1 | — | — | — |
| CI | `ci.yml` job `build-typecheck-unit`: build → typecheck (8 workspaces) → `backend test:unit` (`test-1`, 2026-07-27) → `packages/shared` + `renderer` unit (`test-3`, 2026-07-28); credential-free, every push/PR; the three unit steps together ≈2 s | `ci.yml` job `serving-contract` (`test-2`, 2026-07-28): the renderer suite above, also credential-free. `playwright.yml` runs the staging-mutating suites (secrets-gated) | — | ↑ |

Hazards: backend suites mutate shared staging state (unattended-unsafe, forbidden to
relays); `.env.test` holds live secrets; the infra "suite" is a false green.

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
   backend). Still outstanding by design: `normalizeEmail` does not exist until `fnd-1` and
   `videoSource` until `vid-1`; admin needs an RTL harness (§4).*
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
   CF function presence, IAM boundaries (e.g. CloudFront invalidation confined to 3
   Lambdas). Deletes the lying stub. Unblocks dep-1.
7. **CI ordering** — every push: build + typecheck + unit (fast, no credentials), plus the
   serving-contract suite as a parallel job. On demand / nightly: local-DDB integration.
   Post-deploy: e2e vs staging.
   *Status: `.github/workflows/ci.yml` carries both credential-free jobs —
   `build-typecheck-unit` (`test-1`, extended by `test-3` with the `packages/shared` and
   `renderer` unit steps) and `serving-contract` (`test-2`). The backend local-DDB and
   post-deploy legs are still unimplemented.*

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
