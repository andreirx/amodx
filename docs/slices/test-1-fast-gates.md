# TEST-1: Fast gates — typecheck scripts + CI build/typecheck/unit

- **Status:** PLANNED
- **Track:** TEST
- **Depends:** none
- **Source:** `docs/testing-strategy.md` §7; estate audit 2026-07-27
- **Maturity target:** MATURE

## Purpose / risk retired

No workspace has a `typecheck` script; CI has no build job — a type regression ships
silently, and every verification loop pays the full build chain. This slice creates the
fast gate: `tsc --noEmit` per workspace, a root aggregate, and a CI workflow running
build + typecheck + the existing AWS-free unit tests on every push.

## Scope

1. `typecheck` script (`tsc --noEmit`, using each workspace's own tsconfig) in: shared,
   effects, plugins, backend, admin, renderer, infra, tools/mcp-server. Root
   `typecheck` runs them in dependency order (same order as root `build`).
   Note: admin/renderer builds embed extra steps (vite/next); `tsc --noEmit` must use
   the tsconfig that covers their sources without emitting.
2. `.github/workflows/ci.yml`: on push/PR — npm ci, root build, root typecheck,
   `backend npm run test:unit`. NO AWS credentials in this workflow; it must be green
   from a bare checkout.
3. Do NOT touch `playwright.yml` or `security-audit.yml`.
4. `docs/testing-strategy.md` estate table updated (CI row).

## Non-scope

- No new tests (test-2/3). No local-DDB work. No changes to any src/ code — if
  typecheck FINDS existing errors, fix only if trivial (<5 lines total); otherwise
  record them in the build report + TECH-DEBT entry and scope the script to pass via
  documented, minimal excludes ONLY with the finding recorded. Do not silently relax
  compiler options.

## Definition of Done

1. `npm run typecheck` green at root, running all 8 workspaces.
2. CI workflow present; steps mirror what a bare machine can run (no secrets).
3. Any discovered type errors: fixed (if trivial) or recorded honestly.

## Evidence

- `EXECUTED`: root `npm run typecheck` output (all workspaces listed, green).
- `EXECUTED`: `act`-style local verification is NOT required; instead paste the
  workflow file and the exact local command sequence it encodes, each run green.
- `NOT RUN` (operator): first real CI run on push.
