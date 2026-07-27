# Testing Strategy

Ratified direction 2026-07-27 (human: "characterize existing testing and fill gaps —
not superficially"). Estate characterized by file-level audit 2026-07-27; this doc is
the target architecture. Track TEST in `docs/ROADMAP.md` implements it.

## Current estate (measured 2026-07-27)

| Surface | Unit | Integration | API | E2E |
|---|---|---|---|---|
| backend | 1 file (`test/unit/revalidate-paths.test.ts`, AWS-free) | 8 suites vs LIVE staging DDB + API GW (`.env.test`) | same 8 suites | — |
| renderer | 0 | 0 committed (cache probe harness = uncommitted relay byproduct) | — | 2 playwright specs vs deployed staging; `public-site.spec.ts` asserts the pre-cache-1 "Site Not Found" 200 shell — STALE |
| admin | 0 (no runner installed) | — | — | 0 |
| plugins/shared/effects | 0 | — | — | — |
| infra | jest file 100% commented out, reports PASS 1/1 | — | — | — |
| CI | none | `playwright.yml` runs the staging-mutating suites | — | ↑ |

Hazards: backend suites mutate shared staging state (unattended-unsafe, forbidden to
relays); `.env.test` holds live secrets; the infra "suite" is a false green.

## Test taxonomy and where each kind lives

1. **Unit** — pure logic, no AWS, no network, vitest, in every workspace that has pure
   logic. Gate: runs in relays and CI on every change. First targets: shared schemas +
   `normalizeEmail` (fnd-1), plugins `videoSource` (vid-1), renderer
   `tenant-directory`/`not-found-handoff`, backend pure helpers.
2. **Serving-contract (renderer integration)** — the cache probe matrix automated
   against `next build` + `next start` + a local DynamoDB stub. Pins MEASURED behavior
   (docs/caching-architecture.md §Measured serving behaviour), including warts. The
   regression net for Track CACHE and the future PPR track.
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
7. **CI ordering** — every push: build + typecheck + unit (fast, no credentials).
   On demand / nightly: local-DDB integration. Post-deploy: e2e vs staging.

## Invariants

- A test that requires live shared AWS state is never a default gate and never
  relay-runnable.
- A suite that asserts nothing must not exist (no false greens).
- Serving-contract changes (anything touching caching) must update the contract suite
  in the same slice — the suite IS the contract's executable form.
