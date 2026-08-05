# CACHE-7: Forward OpenNext's revalidation header (background ISR refresh is dead)

- **Status:** PLANNED (operator-authored 2026-08-05 from live prod incident)
- **Track:** CACHE
- **CDK-change justification:** repairs broken prod behavior (real gain, probe/log-proven):
  the OpenNext RevalidationFunction fails EVERY page ("Failed to revalidate", CloudWatch,
  all hosts) because `RendererOriginPolicy` strips `x-prerender-revalidate` — Next never
  sees the re-render instruction. Same defect class as cache-6's x-revalidation-token.

## User-visible symptom (reported by the human, 2026-08-05)

A published article is reachable at its URL but never appears in tag/post-grid listing
pages: those pages serve stale-while-revalidate (`s-maxage=2, swr=2592000`), the
background refresh always fails, `x-nextjs-cache: STALE` forever, until the nightly
flush.

## Scope

1. `infra/lib/renderer-hosting.ts`: add `x-prerender-revalidate` to the
   RendererOriginPolicy header allowlist. VERIFY against the pinned open-next@3.1.3
   source (node_modules) whether the revalidation/bypass protocol needs any OTHER
   header (e.g. `x-prerender-bypass`, `x-isr`) — add exactly what the protocol
   requires, each justified with a source cite; nothing speculative.
2. Update the infra assertion pinning the ORP header set (count + names).
3. Doc ripples: caching-architecture (§Open hazards/known gaps — record this as
   found-and-fixed; explain the SWR path for grid pages), TECH-DEBT reconciliation.
4. Investigate + RECORD (no code change): why grid pages carry s-maxage=2/SWR while
   plain pages carry s-maxage=31536000 — cite the mechanism (fetch-level revalidate in
   the post-grid render? route config?) with file:line, so the freshness model is
   documented, not folklore.

## Non-scope

No other infra edits; no middleware changes; no tag-based revalidation (cache-4).

## DoD / evidence

- Synth fragment showing the ORP header list; assertion updated + mutation-checked.
- The §4 mechanism note with OBSERVED cites.
- NOT RUN (operator): deploy + watch RevalidationFunction logs go quiet + STALE→fresh
  on a listing page within seconds.
