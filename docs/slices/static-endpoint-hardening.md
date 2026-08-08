# STATIC-EP: Isolation precondition — anonymous-write-endpoint hardening + sandbox contract

> **Identity note (2026-08-08):** the ratified plan's `static-1` IS the isolation-model
> DECISION (delivered via ratification, doc-only). This slice implements the D-STATIC-1
> **endpoint-hardening RIDER** — the precondition the plan named but did not phase-number
> — plus the reusable sandbox-token contract. It precedes the plan's `static-2` (storage).
> Renamed from the colliding "static-1" filename.

- **Status:** PLANNED (implementation wave; STATIC phase 1)
- **Track:** STATIC
- **Depends:** the RATIFIED plan docs/plan-static-html-pages.md (D-STATIC-1..5 + the
  human-amended D5). This slice builds the ISOLATION BARRIER + its precondition; no
  storage/schema/admin/route yet (static-2..4).

## Scope

1. **Endpoint-hardening inventory (D-STATIC-1 rider, the precondition):** enumerate
   EVERY renderer anonymous write endpoint reachable credential-free (the audit named
   /api/consent, /api/contact, /api/ref, /api/leads at minimum — VERIFY the full set
   by grep, treat prior list as subset). For each: is a same-origin/`Origin` check
   intended, and is it present? Add `Origin`/`Sec-Fetch-Site` rejection where a
   cross-site/null-origin POST is NOT intended, WITHOUT breaking the legitimate
   first-party callers (the renderer's own forms). Record the disposition per endpoint
   (hardened | intentionally-open | N/A) with file:line. This is the concrete work;
   the sandbox itself is config the later slices consume.
2. **Sandbox contract module (pure/shared):** define the ratified iframe sandbox
   attribute set (allow-scripts but NOT allow-same-origin → null origin; enumerate the
   exact token list and WHAT each permits/denies, cite the HTML spec) as a single
   documented constant the render slice (static-4) will use. NO renderer wiring yet —
   just the contract + a unit test asserting the token set (guards against a future
   edit silently adding allow-same-origin, which would collapse the barrier).
3. Docs: caching-architecture / a new static-pages architecture note recording the
   isolation model + the endpoint dispositions.

## Non-scope

S3 storage + page schema (static-2); admin upload/preview (static-3); renderer route +
actual iframe embed (static-4); the advisory upload lint (static-3). No new infra here
unless an endpoint fix needs a config change (STOP if so).

## DoD / evidence

Per-endpoint disposition table (OBSERVED file:line); Origin-check unit tests (a
cross-site POST rejected, a first-party POST accepted) for each hardened endpoint;
sandbox-token constant + its test; build + typecheck green; serving suite green
(hardening must not break existing first-party flows).
