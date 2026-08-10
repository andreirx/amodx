# PERF-1: Reduce unused JavaScript on rendered pages

- **Status:** PLANNED
- **Track:** PERF
- **Depends:** none (renderer-side; adds ZERO CloudFormation resources — deployable
  despite the stack-500 ceiling)
- **Gate:** the 2026-08-08 Lighthouse baseline (docs/perf/baselines-2026-08-08.md);
  report before/after score delta re-run same-method.

## Problem

~0.9-1.2s of unused JavaScript on every measured live site (bijup.com, blog.bijup.com,
amodx.net) — likely plugin bundles / block code loading on pages that don't use those
blocks, and/or non-code-split vendor chunks. First platform-wide perf lever; serving is
already healthy (FCP<=1.5s), so JS weight + LCP are the drags (LCP is images/opennext-1,
parked — NOT this slice).

## Scope

1. Measure the source of unused JS from the build output / bundle analysis (OBSERVED:
   which chunks, which routes load them). Cite specifics, don't guess.
2. Code-split so a page loads only the block/plugin JS it actually renders (dynamic
   import of block render components; route-level splitting). Respect the plugin
   split-entry rule (render vs admin) and SSR-safety.
3. NO behavior change; NO next/image (opennext-1 parked); NO new dependencies unless a
   bundle-analyzer devDep is needed (pinned, dev-only, audited).
4. Serving-contract suite MUST stay green (this touches renderer render paths).

## Non-scope

LCP/images (opennext-1); no infra; no plugin feature changes; no admin bundle work
unless it's the same fix for free.

## DoD / evidence

- `EXECUTED`: renderer build shows reduced per-route JS (before/after chunk sizes);
  serving suite green; build+typecheck green.
- `NOT RUN` (operator): re-run the Lighthouse baseline on the 3 sites post-deploy,
  report the score delta vs docs/perf/baselines-2026-08-08.md.
