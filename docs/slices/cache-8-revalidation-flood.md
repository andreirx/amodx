# CACHE-8: Stop scanner junk from drowning the SWR refresh pipeline

- **Status:** PLANNED
- **Track:** CACHE
- **Evidence:** TECH-DEBT 2026-08-16 entry (live-diagnosed): RevalidationFunction
  1,104 failures/12h dominated by bot-scanner URLs (/wk/index.php etc); legitimate
  SWR grid refreshes never complete; CloudFront's own swr (2592000) re-pins stale
  copies at the edge (observed age=194 on s-maxage=2).

## Root-cause questions (investigate FIRST, cite source/logs)

1. WHY do 404-class/nf-handoff URLs enter the revalidation queue at all? Trace the
   enqueue path in the installed open-next 3.1.3 (node_modules source, verify don't
   assume): what marks a rendered response for background revalidation, and what do
   the nf-handoff 307s / scanner-path renders emit that qualifies them?
2. Why do those revalidations FAIL (the "Failed to revalidate" reason for e.g.
   /wk/index.php) — and does a failing record retry/park and starve the FIFO group?

## Scope (smallest set that makes the pipeline junk-proof — pick per findings)

Candidates, in preference order — implement what the investigation supports:
a. Prevent junk from qualifying: ensure 404/nf-handoff responses carry headers/state
   that open-next does NOT enqueue for revalidation (e.g. their cache-control /
   x-nextjs-cache disposition), so scanner paths never enter the queue.
b. Make failures harmless: if (a) is impossible without forking open-next, ensure a
   failed revalidation cannot starve other work (queue/group semantics; source-cite
   what is configurable).
c. Bound the edge staleness: reduce the swr window Next emits for SWR pages
   (fetch-level revalidate config in the post-grid path) from 2592000 to a bounded
   value (e.g. 300s) so even a broken refresh self-limits at the edge. Record the
   trade-off (edge misses after the window).
d. Optional cheap shield: middleware short-circuits known scanner patterns
   (*.php, /wp-*, /wk/*) with a plain 404 no-store BEFORE any render/ISR machinery —
   zero cost, kills the junk at the door. Justify pattern list conservatively
   (never block legitimate tenant slugs — document the patterns + a test proving a
   normal slug passes).

## Non-scope

No open-next fork/upgrade (parked); no CDK unless a queue setting demands it (STOP);
no per-tenant distributions.

## DoD / evidence

Investigation findings source-cited; implemented mitigations each with tests
(serving suite grows: scanner path → 404 no-store, never enqueued — assert via the
harness's queue observation if reachable, else the response-disposition contract);
serving+unit+typecheck green. Operator gate (NOT RUN): post-deploy, RevalidationFunction
error rate collapses and a grid refresh completes within its window without manual purge.
