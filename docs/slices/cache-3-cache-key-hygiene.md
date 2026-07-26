# CACHE-3: Cache-key hygiene — query-string allowlist + no Set-Cookie on cached HTML

- **Status:** PLANNED
- **Track:** CACHE — serving-layer remediation
- **Depends:** cache-1 (these defects only bite once caching is live)
- **Source:** code audit 2026-07-26
- **Maturity target:** MATURE
- **⚠ Production-sensitive:** touches CDK (`infra/lib/renderer-hosting.ts` cache policy)
  and middleware behavior for live tenants. Operator reviews `cdk diff` before deploy.

## Defects being fixed

1. **Unbounded cache fragmentation / busting**: the CloudFront cache policy uses
   `queryStringBehavior: all()` (`infra/lib/renderer-hosting.ts:265-274`). Any
   `?utm_*`, `?fbclid`, or attacker-chosen junk parameter mints a distinct cache entry —
   guaranteed miss — an SSR Lambda invocation. This is the largest remaining
   "Lambda fires more than intended" vector after cache-1.
2. **Set-Cookie poisoning of cached responses**: `renderer/middleware.ts:100-115` sets
   `amodx_ref` (attribution) whenever `?ref=`/`?utm_source=` is present. With
   `cookieBehavior: none()`, CloudFront stores that `Set-Cookie` in the cache entry and
   replays it to **every subsequent viewer** — cross-visitor attribution contamination.
   (The `amodx_preview_base` Set-Cookie is preview-only traffic — uncached — fine.)

## Design (ratified approach — D3)

1. **Query-string allowlist** in `RendererCachePolicy`:
   `cloudfront.CacheQueryStringBehavior.allowList(...)` with exactly the params the
   renderer actually varies on. In-slice, enumerate them from the code (`sp` reads in
   the catch-all page + product page); expected set is approximately
   `page`, `q`/search, filter/sort params — **not** `ref`, `utm_*`, `fbclid`, `preview`.
   The allowlist and its per-param justification go into `docs/caching-architecture.md`.
   Note: this changes only the cache **key**; the origin request policy still forwards
   full query strings to the Lambda, so attribution params still reach the server for
   the dynamic carve-out views.
2. **Attribution capture moves off cached HTML responses.** Middleware stops setting
   `amodx_ref` on page responses. Replace with the smallest working alternative,
   preferred order:
   a. a tiny client-side snippet/component (public layout) that reads
      `location.search` and sets the cookie via `document.cookie` — note this loses
      `httpOnly`, acceptable for an attribution tag (it is not an auth credential), or
   b. a beacon to an existing uncached `/api/*` route that sets the cookie server-side,
      preserving `httpOnly`.
   Decide in-slice by inspecting the sole consumer of `amodx_ref` (grep; believed to be
   lead/order attribution) and record which option shipped and why.
3. Middleware keeps the origin-verify check and rewrites — unchanged.

## Non-scope

- No per-tenant CloudFront invalidation scoping (doc §Known Gaps 3, Workstream 3).
- No CDK changes beyond the one cache-policy property.
- No cookie-based personalization work.

## Architectural boundaries

- CDK change is a single-property edit on an existing construct — in-place UPDATE of the
  cache policy; no distribution replacement. Confirm with `cdk diff` (operator gate).
- Attribution semantics (30-day window, ref precedence over utm_source) preserved.

## Definition of Done

1. Cache policy uses an explicit allowlist; the list + justification documented.
2. No code path sets cookies on cacheable (public, non-carve-out) HTML responses.
3. Attribution still captured end-to-end (cookie present after visiting `?ref=x`,
   consumed by whatever reads `amodx_ref` today).
4. `docs/caching-architecture.md` cache-policy section and §Known Gaps updated.

## Evidence required

- `EXECUTED`: `cd infra && npm run build`; `cdk synth` succeeds; `cdk diff` output
  captured in the build report showing ONLY the cache-policy change.
- `EXECUTED`: renderer build green; grep proves middleware sets no cookie on the
  production-mode path.
- `OBSERVED`: attribution consumer path traced with file:line evidence.
- `NOT RUN` (operator gate, post-deploy): `curl -sI '.../?fbclid=junk123'` twice → second
  response is `x-cache: Hit` (junk param no longer busts cache); visiting `?ref=test`
  in a browser sets `amodx_ref`; a subsequent anonymous request does NOT receive a
  `Set-Cookie` for it.

## Exit criterion

Cache hit ratio is insensitive to junk query params, and no visitor can receive another
visitor's attribution cookie from the CDN.

## References

- `infra/lib/renderer-hosting.ts` — cache policy.
- `renderer/middleware.ts` — attribution block.
- `docs/caching-architecture.md` — §Cache Policy, §Known Gaps.
