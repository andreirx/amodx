# NEXT-PATCH-1 — Next.js security patch 16.4.3 → 16.4.6

Status: **PLANNED (written 2026-11-18, not ratified, not started)**. Track: Maintenance (`dep-1` family).
Depends: none. Maturity target: unchanged (the renderer is PRODUCTION).

## 1. The problem

Next.js published a security advisory after the deploys of 2026-11-16.

- Advisory: GHSA-mfr8-8qww-v76h, severity moderate. "Information disclosure across root params when a
  `use cache` function is called through `unstable_cache()`."
- Range: `>=16.3.0 <=16.4.4`. Installed: `16.4.3` (`node_modules/next/package.json`).
- Fixed versions in the same line: `16.4.5`, `16.4.6` (`npm view next versions`, 2026-11-18).
- Declared: `"next": "~16.4.3"` in `renderer/package.json:24` and `packages/plugins/package.json:80`.
  The range already admits 16.4.6; the lockfile holds 16.4.3.

Exposure: a search of `renderer/src` and `packages/plugins/src` for `use cache`, `unstable_cache` and
`rootParams` finds nothing (2026-11-18). The renderer does not use the feature the advisory names. This is a
source search of two directories, not a proof for the built bundle.

Effect on the work, which is the urgent part:

- Since 16.4.x, `next build` checks for advisories (`node_modules/next/dist/lib/upgrade/nudge.js`). When the
  build runs under an agent and a security advisory applies, the build throws `SecurityFatalError` and writes a
  receipt under `<distDir>/cache/next-agentic-upgrade-retries/`. One retry inside 5 minutes continues with a
  warning and uses up the receipt (`nudge.js:97,150`).
- `infra/deploy.sh staging` runs two builds (`npm run build`, then `build:open`). One of the two always stops.
  **The operator cannot deploy to staging** (two attempts on 2026-11-18, both exit 1, nothing deployed).
- In an interactive terminal the code takes a prompt path, not the throw (`nudge.js:377,416`). What the human
  sees during `./deploy.sh prod` is **not verified**.
- The guard has a configuration switch (`experimental.agentUpgrade`) and an environment switch. Neither is
  used. Turning a security check off to deploy is not proposed.

## 2. Scope

1. `next` → `16.4.6` in the lockfile; the declared floor moves to `~16.4.6` in both `package.json` files so that
   no install can go back into the advisory range.
2. `@opennextjs/aws` stays at the exact pin 4.1.9. `patches/@opennextjs+aws+4.1.9.patch` must still apply; the
   guard `node scripts/verify-opennext-patch.mjs` must pass unchanged.
3. Record: the 16.4.3 → 16.4.6 release notes read for changes to the middleware, the cache handler interface,
   RSC request headers and the `_rsc` hash (the three places where earlier patch releases changed serving).
4. `docs/TECH-DEBT.md` § Dependency Audit Remediation: one dated line.

## 3. Non-scope

A minor or major Next.js upgrade. An OpenNext upgrade (only if 16.4.6 cannot run on 4.1.9 — then stop and
ask). `infra/` changes. The other `dep-1` items. Any use of the guard's switches.

## 4. Evidence taxonomy

| Proof | Expected |
|---|---|
| `npm ls next` in every workspace | one version, 16.4.6 |
| `next build` under the agent, cold (no receipt) | exit 0, no `SecurityFatalError` |
| `npm run test:serving` | all rows green, no row edited |
| `npm run test:serving-bundle` | all rows green on the built Lambda bundle, no row edited |
| `node scripts/verify-opennext-patch.mjs` | OK |
| the ten repository gates of `badge-case-1.md` § 6 | exit 0 |
| staging: the 51 CM1 URLs (Layer 2 canonical form, `catalog-mode-1.md` § 8.20) | identical to the capture before the upgrade, apart from build ids |
| staging: cache headers | a second request for a tenant page answers `x-cache: Hit`; a client-side navigation gives 0 × 307 (`rsc-nav-1.md` § 7) |

A serving row that changes is a finding to bring to the human, not a row to update.

## 5. Deployment and rollback

Every live tenant is served by this code. Order: gates → staging diff read → staging deploy → the proofs of § 4
→ commit → push → the human's prod deploy. Rollback: revert the commit and redeploy; no data changes.

Launch precondition: a clean worktree. On 2026-11-18 the worktree holds the reviewed, gate-green candidate of
`public-harden-1`, which cannot reach staging while this block stands. Two ways, the human's choice at launch:

| Way | Reward | Risk |
|---|---|---|
| Commit `public-harden-1` first, without its staging run; one staging deploy then carries both | simple; history stays in order | a commit on `main` that staging has not run (unit-proven only) for the time of this slice |
| Keep `public-harden-1` as a patch file outside the tree; run this slice; apply it again | `main` never holds unstaged code | a second apply step; the patch must apply cleanly after the lockfile change (the two touch different files) |

## 6. Definition of Done

§ 4 complete; staging on the new build; the operator's staging deploy runs with no stop; this record has its
closeout section; ROADMAP row updated.

## 7. Exit criterion

`./deploy.sh staging` and `./deploy.sh prod` run with no security notice, and the advisory no longer applies to
the installed version.
