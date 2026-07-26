# CACHE-2: Fix ISR revalidation keying (domain, not tenantId)

- **Status:** PLANNED
- **Track:** CACHE — serving-layer remediation
- **Depends:** cache-1 (until pages are cacheable, ISR purges are moot — but this can be
  built in parallel; it only becomes *observable* after cache-1)
- **Source:** code audit 2026-07-26
- **Maturity target:** MATURE

## Defect being fixed

All 8 production ISR `revalidatePath()` calls are no-ops. The backend calls
`revalidatePath("/<tenantId>/<path>")` (`content/update.ts:191`, `products/update.ts:82,85`,
`products/delete.ts:48`, `categories/update.ts:66,69`, `categories/delete.ts:67`), but the
middleware rewrites production traffic to `/<domain>/<path>` — so the OpenNext ISR cache
entry is keyed by **domain**. Purging the tenantId-keyed path touches nothing.
(`content/update.ts:189` comment wrongly assumes "renderer routing supports both".)

Secondary defect: `RENDERER_URL` is `undefined` on deployments without a configured root
domain (`infra/lib/amodx-stack.ts:200`), making `revalidate.ts` silently return — ISR
revalidation disabled entirely, logged at `console.log` only.

## Design (ratified approach — D2)

**The backend resolves the tenant's domain(s) and purges domain-keyed paths.** The
backend already holds `TenantConfig` (it is the authority for tenant → domain mapping);
the renderer should stay dumb and purge exactly the paths it is told.

1. In the 5 handlers (or a small shared helper next to `revalidate.ts`), resolve the
   tenant's domain(s) from the already-loaded tenant config (avoid an extra DDB read if
   the handler already has it; otherwise one `GetItem`).
2. Call `revalidatePath` once per domain-keyed path: `/<domain>/<pagePath>` (+ old-slug
   variants exactly as today). Keep the tenantId-keyed purge **only if** test-mode
   (`/tenant/<id>/`) pages are ISR-cached under that key — verify in-slice; if test mode
   is dynamic (per cache-1), drop the tenantId purge entirely.
3. Custom URL prefixes: the existing hardcoded `/product`, `/category` prefixes remain a
   known gap (doc §Known Gaps 2) — **non-scope here** unless the tenant config with the
   prefix is already in hand in the handler, in which case use it (one line, not a
   refactor).
4. Log loudly (console.warn with context) when `RENDERER_URL` is unset instead of a
   silent skip; document in `infra` that ISR revalidation requires it.

## Non-scope

- No tag-based revalidation adoption (doc §Known Gaps 5) — separate future slice.
- No change to CloudFront invalidation (debounce) machinery.
- No new wrapped handlers (`content/delete.ts` question is surfaced in cache-1 DoD 4).

## Architectural boundaries

- Tenant → domain resolution stays in the backend (authority); renderer `/api/revalidate`
  contract unchanged (token + path/tag).
- Best-effort semantics preserved: revalidation failure must never fail the mutation.

## Definition of Done

1. The 5 handlers purge domain-keyed paths for the mutated content (+ old slugs).
2. tenantId-keyed purge kept or dropped per the in-slice verification, with the finding
   recorded in the slice doc.
3. Unset `RENDERER_URL` logs a warning with the skipped path.
4. `docs/caching-architecture.md` §5 table updated to describe domain keying.

## Evidence required

- `EXECUTED`: backend build green; unit test (pure, no AWS) for the path-construction
  helper: tenant config + slug → expected `revalidatePath` arguments, including
  old-slug and multi-domain cases.
- `NOT RUN` (operator gate, post-deploy): edit a page on a staging tenant with a mapped
  domain; within seconds `curl` of the page through CloudFront with a cache-busting
  header shows fresh content from ISR (before the 15-min CloudFront debounce fires).

## Exit criterion

An admin content edit refreshes the S3 ISR entry for the real production URL of the
page, so the post-invalidation CloudFront miss serves fresh content without waiting for
the nightly flush.

## References

- `backend/src/lib/revalidate.ts`, the 5 calling handlers.
- `renderer/middleware.ts` — path rewrite that defines the ISR key.
- `docs/caching-architecture.md` §Invalidation Mechanisms 5, §Known Gaps 2.
