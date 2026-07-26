# CACHE-1: Restore static/ISR rendering for public pages

- **Status:** PLANNED
- **Track:** CACHE — serving-layer remediation
- **Depends:** none
- **Source:** `docs/caching-architecture.md` (intended design); code audit 2026-07-26 (defect)
- **Maturity target:** MATURE (serving contract, verified against deployed distribution)

## Defect being fixed

The entire two-layer cache described in `docs/caching-architecture.md` is inert for HTML.
Every public page view runs full React SSR + DynamoDB reads, because the catch-all route
unconditionally invokes Next.js dynamic APIs, which forces per-request dynamic rendering
and a `no-store` Cache-Control — so neither OpenNext ISR (S3) nor CloudFront caches
anything:

- `renderer/src/app/[siteId]/[[...slug]]/page.tsx:154` — `await searchParams` (preview flag)
- `page.tsx:161` — `getPreviewBase()` → `cookies()` unconditionally (`renderer/src/lib/routing-server.ts`)
- `page.tsx` `generateMetadata` (~line 114) — `await searchParams`
- `renderer/src/app/[siteId]/products/[productId]/page.tsx:31` — same pattern

`export const revalidate = false` is present but has no effect on a dynamic render.

## Serving contract (the invariant this slice establishes)

**A public, published, non-parameterized page render must not invoke any Next.js dynamic
API** (`cookies()`, `headers()`, `await searchParams`, `unstable_noStore`). Such renders
must produce `Cache-Control: s-maxage=31536000, stale-while-revalidate` (via
`revalidate = false`) so both OpenNext ISR and CloudFront cache them.

Accepted carve-outs (stay per-request dynamic, by design):

- **Preview / test-mode traffic** (`/_site/`, `/tenant/` prefixes).
- **Parameterized commerce/list views** that genuinely read query params
  (pagination `page`, search, filters — the `sp` reads at page.tsx:213–322).
- Draft/unpublished content checks that require auth context.

## Design (ratified approach — D1)

Preview is already path-distinguished by the middleware (`/_site/<tenantId>/...` →
rewrite). Move the preview distinction from render-time dynamic APIs to the route:

1. **Dedicated preview route segment**: middleware rewrites `/_site/<tenantId>/<path>`
   to `/_preview/<tenantId>/<path>`; new `renderer/src/app/_preview/[siteId]/[[...slug]]/page.tsx`
   with `export const dynamic = 'force-dynamic'`, which delegates to the same shared
   render component with `preview: true` and `basePath: "/_site/<tenantId>"` **derived
   from params** — no cookie read, no searchParams read. Same for `/tenant/` test mode
   (non-preview but uncached is acceptable) — decide inside the slice; smallest change wins.
2. **Public route** (`[siteId]/[[...slug]]/page.tsx` and `products/[productId]/page.tsx`):
   remove the top-level `await searchParams` and `getPreviewBase()` calls. `preview` is
   always `false` here. Push remaining `searchParams` reads down into the specific view
   branches that need them (pagination/search) so only those renders go dynamic.
   Same treatment in `generateMetadata`.
3. The render logic itself is **shared, not duplicated** — extract the page body into a
   function/component both routes call with `{ preview, basePath }` as plain props.
4. `?preview=` query-flag support on the public route is **removed** (it defeats caching
   by definition). Admin preview links go through `/_site/` (verify: `admin/src/pages/
   Categories.tsx`, `ContentList.tsx`, `Products.tsx` — update any that use `?preview=`).

## Non-scope

- No change to invalidation machinery (debounce, nightly, revalidatePath) — `cache-2`.
- No CloudFront policy changes (query-string allowlist, cookies) — `cache-3`.
- No `generateStaticParams` / build-time prerender.
- No fix to `hasActivePopups()` per-render DDB read in layout — it becomes amortized by
  ISR automatically once this slice lands.

## Architectural boundaries

- Tenant isolation unaffected: cache keying by `X-Forwarded-Host` (CloudFront) and
  rewritten path (ISR) is unchanged.
- No backend or infra changes.
- Preview security check (allowed hosts for `/_site/`) stays in middleware, unchanged.

## Risks / open questions to resolve in-slice

- **open-next@3.1.3 vs next@^16 compatibility**: OpenNext 3.x targets Next 13–15. Before
  trusting Layer 2, verify the built adapter honors `revalidate = false` (inspect the
  emitted Cache-Control in a local `open-next` build or staging deploy). If broken,
  STOP and surface — an open-next upgrade is a separate decision.
- Client components that read the `amodx_preview_base` cookie (it is `httpOnly: false`
  for client reads) must keep working in preview; the cookie is still set by middleware.

## Definition of Done

1. Public route + product route contain zero unconditional dynamic-API calls.
2. Preview works via `/_preview` route segment; admin preview links verified.
3. Parameterized list views still work (pagination, search) — dynamic per-request.
4. `docs/caching-architecture.md` corrected: add the serving contract above; fix known
   doc drift (26 wrapped handlers not 51; `withInvalidation` writes CDN_PENDING **and**
   CDN_LAST_CHANGE; status endpoint also allows EDITOR; `open-next.config.ts` is a
   defaults-relying stub; `content/delete.ts` is not wrapped — flag as open question).
5. `docs/security-remediation-status.md` Phase 4 note appended: serving layer was
   inert until this slice; "COMPLETE" claim corrected.
6. **Interactive functionality holds on cached pages** (operator condition, ratified
   2026-07-26): cookie consent (`CookieConsent.tsx` — `"use client"` + localStorage),
   comments (`CommentsSection.tsx` — `"use client"` fetching uncached `/api/comments`),
   and NextAuth session UI must remain client-side hydrated — the cached HTML must
   contain no per-visitor state. Evidence: cite the `"use client"` boundary + data path
   for each; if any such surface is found to render per-visitor state on the server,
   STOP and surface it instead of quietly keeping it dynamic.

## Evidence required

- `EXECUTED`: full workspace rebuild (shared → plugins → backend → admin → renderer).
- `EXECUTED`: `cd renderer && npx next build` output shows the public catch-all route as
  static/ISR (`●`/`○`), NOT `ƒ (Dynamic)`; `_preview` route shown as dynamic.
- `OBSERVED`: in the build output or local run, public page response headers carry
  `s-maxage` (no `no-store`).
- `NOT RUN` (operator gate, post-deploy): against the staging distribution —
  first `curl -sI https://<staging-host>/` shows `x-cache: Miss from cloudfront`,
  second shows `x-cache: Hit from cloudfront`; CloudWatch shows renderer Lambda
  invocations drop for repeated page hits. **This slice is not SHIPPED until the
  operator records this.**

## Exit criterion

Repeated views of a published public page serve from CloudFront (no Lambda invocation);
a CloudFront miss serves from the OpenNext S3 ISR cache without React SSR. The SSR path
runs only on first render after invalidation and on carve-out views.

## References

- `docs/caching-architecture.md` — intended design; update per DoD 4.
- `renderer/ARCHITECTURE.md` — update route structure on completion.
- Code audit (2026-07-26): dynamic-API findings, open-next/Next 16 version concern.
