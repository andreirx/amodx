import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isWiredTenantHost } from '@/lib/tenant-directory';

// Phase 6.1: Origin verification secret (injected by CloudFront, verified here)
const ORIGIN_VERIFY_SECRET = process.env.ORIGIN_VERIFY_SECRET;

// --- cache-1: rendering-mode discriminator ---
//
// Every public request is rewritten to one of two routes that render the same body:
//
//   /<siteId><path>        → [siteId]/[[...slug]]         cacheable (ISR), no dynamic APIs
//   /<siteId>/_dyn<path>   → [siteId]/%5Fdyn/[[...slug]]  force-dynamic, no-store
//
// Next 16.2.9 decides a route's rendering mode at build time; a dynamic API call inside
// a cacheable route is an HTTP 500, not a per-request downgrade (measured — see
// docs/caching-architecture.md). So the split has to happen here, before the render,
// using only information a request carries. Two signals are enough and both are free:
// a query string, and a NextAuth session cookie.
//
// This file only runs on a CloudFront MISS. Both signals therefore have a counterpart in
// the CloudFront cache key (slice cache-3): query strings via the parameter allowlist, and
// the session cookie via the `x-has-session` header the viewer-request Function derives.
// Without those, a warm entry is served at the edge and this discriminator never executes.
//
// This file is also the only place a **non-cacheable 404** can be produced for a
// production host (the unknown-host gate below) — see `lib/tenant-directory.ts`.
const DYN_SEGMENT = '_dyn';

// Session detection — two base names, matched by PREFIX (base, or base + '.' + chunk index).
//
// Source of truth for the names: the NextAuth cookie configuration in
// `src/app/api/auth/[...nextauth]/route.ts` (`cookies.sessionToken.name =
// 'next-auth.session-token'`). next-auth 4.24.14 spreads that object over its own defaults
// at the top level (`next-auth/core/init.js:59-61`), so the configured name REPLACES the
// default and the `__Secure-` prefix `defaultCookies()` applies on https does not take
// effect while this config stands. What is emitted today is therefore
// `next-auth.session-token`, plus `.0`, `.1`, … chunks when the JWT exceeds the 4096-byte
// cookie limit (`next-auth/core/lib/cookie.js:152` names chunks `<configured-name>.<i>`).
//
// `__secure-next-auth.session-token` is listed as COMPATIBILITY/LEGACY coverage: it is what
// next-auth would emit if the explicit `cookies` block were removed, and what a cookie
// issued before that block existed still carries. No repo evidence shows it in use today.
// Listing it costs nothing; missing a real session cookie is the expensive direction.
//
// Matching is case-insensitive (hence lowercase literals) even though cookie names are
// case-sensitive per RFC 6265. That over-matches slightly, which is the safe direction: a
// false positive routes the request to the uncached twin, which renders correctly and merely
// misses the cache. It is NOT a substring test — a substring test would also match unrelated
// names that happen to embed the literal (`x-next-auth.session-token-decoy`), needlessly
// widening the set of requests a viewer can push past the edge cache.
//
// This predicate must stay IDENTICAL to the one in the CloudFront viewer-request Function
// (`infra/lib/renderer-hosting.ts`, `HostRewriteFunction` → `x-has-session`). That function
// decides whether an authenticated request can match a warm anonymous edge entry; this one
// decides whether it renders on the dynamic twin. If the CF function classified a request
// as anonymous while this file classified it as authenticated, the request would be
// answered from the anonymous entry and never reach here at all (hazard H3).
const SESSION_COOKIE_BASES = ['next-auth.session-token', '__secure-next-auth.session-token'];

/** True iff the request carries any NextAuth session cookie, chunked variants included. */
function hasSessionCookie(request: NextRequest): boolean {
    return request.cookies.getAll().some((c) => {
        const lower = c.name.toLowerCase();
        return SESSION_COOKIE_BASES.some((base) => lower === base || lower.indexOf(base + '.') === 0);
    });
}

// --- cache-8: scanner-junk shield — INVESTIGATED, NOT SHIPPED (mitigation d DEFERRED) ---
//
// There is deliberately NO middleware short-circuit for bot-scanner shapes (`/wk/index.php`,
// `/wp-login.php`, …) here. This is a recorded decision, not an omission: DO NOT re-add a
// path-shape shield without first defeating the counterexample below.
//
// The flood is real and fully traced in docs/caching-architecture.md § "The SWR revalidation
// queue and the scanner-junk flood (cache-8)": a scanner path mints a cacheable `307` not-found
// handoff, that entry later flips to STALE, and open-next's `revalidateIfRequired()`
// (`open-next/dist/core/routing/util.js:281-282`, verified against the installed 3.1.3 source)
// enqueues it on the ONE condition `x-nextjs-cache: STALE` — not on any header the render
// controls. The junk HEAD then re-renders the same `307`, never `REVALIDATED`, so it fails on
// every attempt (`dist/adapters/revalidate.js:35-37`). Saturation of the 10 FIFO groups is a
// THEORETICAL failure mode of this queue at higher rates, not the observed cause: at the OBSERVED
// 1,104 failures/12h (~1.5/min) the prod-log investigation found NO published page in the failure
// set, so real grid refreshes were not starved. The human-visible stale symptom is the CloudFront
// 30-day edge-SWR re-pin (bounded to 5 min by mitigation c below).
//
// Mitigation d was to answer a scanner shape with `404 + no-store` BEFORE any render. It was
// implemented for `.php` and then WITHDRAWN because the "`.php` is provably never a tenant page"
// claim is FALSE under the current contracts (two review rounds, code-confirmed):
//
//   - tenant IDs are arbitrary strings — `backend/src/tenant/create.ts`, `@amodx/shared` accept
//     `wk` (or anything), and `getTenantConfig()` falls back from the domain GSI to a bare
//     `SYSTEM / TENANT#<identifier>` GetItem (`src/lib/dynamo.ts`), so `getTenantConfig("wk")`
//     resolves the real tenant `wk`;
//   - `content/update.ts` does NOT sanitise slugs (unlike `content/create.ts` `cleanSlug`): it
//     only prepends `/`, so a route `/index.php` is persistable as `ROUTE#/index.php`.
//
// Therefore `/wk/index.php` binds the catch-all `[siteId]=wk`, resolves tenant `wk`, and renders
// its `/index.php` route — a legitimate 200. A `.php` shield would 404 it. No path SHAPE is
// disjoint from content while the first segment can be any tenant ID and the remainder any
// persisted route, so no conservative shield exists at this layer. The counterexample is pinned
// by serving-contract row `(h1)`; the deferred/unmitigated flood state by `(h2)`.
//
// The remaining fixes are out of this slice's scope (no fork, no CDK): controlling the enqueue
// disposition needs an open-next fork (mitigation a); DLQ / reportBatchItemFailures / larger
// concurrency is a CDK queue change (b). Bounding the 2592000 edge SWR window (mitigation c) IS
// now shipped, and NOT at this layer: `patches/open-next+3.1.3.patch` rewrites open-next's
// `fixISRHeaders()` edge window to `stale-while-revalidate=300` (applied by root `postinstall:
// patch-package`, guarded by serving row `(c2)`). That bounds edge staleness to 5 min but does
// NOT stop the junk flood — a scanner shield here is still deferred (the `(h1)` counterexample).
// See docs/TECH-DEBT.md § cache-8 for the ledger and the `opennext-1` / queue-config follow-ups.

// Route Handlers that live under [siteId]. They never enter the full-route cache whatever
// the rendering mode, and each sets (or deliberately omits) its own Cache-Control on the
// Response, so they need no twin — and they have none, so rewriting one to /_dyn lands on
// the page catch-all and 404s. Single source of truth for both the "don't treat this as a
// static asset" check and the twin exemption below.
const SITE_ROUTE_HANDLERS = ['/robots.txt', '/sitemap.xml', '/llms.txt', '/openai-feed'];

/** Internal rewrite target for per-request renders. */
function dynamicPath(siteId: string, restOfPath: string) {
    return `/${siteId}/${DYN_SEGMENT}${restOfPath === '/' ? '' : restOfPath}`;
}

/** Non-cacheable 404. The only response shape that must never enter either cache layer. */
function notFoundResponse() {
    return new NextResponse('Not found', {
        status: 404,
        headers: { 'cache-control': 'private, no-store' },
    });
}

export async function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname;

    // --- 0. ORIGIN VERIFICATION (Phase 6.1) ---
    // Block direct Lambda URL access - only allow requests through CloudFront
    if (ORIGIN_VERIFY_SECRET) {
        const originHeader = request.headers.get('x-origin-verify');
        if (originHeader !== ORIGIN_VERIFY_SECRET) {
            // Log but don't expose the secret in the error
            console.warn(`[Origin Verify] Blocked: missing or invalid x-origin-verify header. Path: ${path}`);
            return new NextResponse('Direct access forbidden', { status: 403 });
        }
    }

    // --- 1. DETERMINE DESTINATION URL ---
    // (No cache-8 scanner shield here — see the "cache-8 … DEFERRED" note above.)

    // Default: Don't rewrite (pass through)
    let rewriteUrl = null;

    // A. Skip Internals (Assets, API, Next.js hydration)
    const isSiteRouteHandler = SITE_ROUTE_HANDLERS.some((p) => path.endsWith(p));
    if (
        path.startsWith('/_next') ||
        path.startsWith('/api') ||
        path.startsWith('/static') ||
        (path.includes('.') && !isSiteRouteHandler)
    ) {
        // Return next() immediately, but we might need to attach cookies?
        // Usually referrals land on pages, not assets.
        // Let's allow cookie logic to run even for pages, but usually skip for assets.
        return NextResponse.next();
    }

    // A2. `/_dyn` is an internal rewrite target, never a public URL. Refusing it here
    // keeps the uncached twin off the wire (no cache-bypass surface, no duplicate URL
    // serving the same tenant content).
    if (path === `/${DYN_SEGMENT}` || path.startsWith(`/${DYN_SEGMENT}/`)) {
        return notFoundResponse();
    }

    // Requests that cannot be served from a cacheable render. Route Handlers are exempt:
    // they have no twin, and they are never in the full-route cache to begin with.
    const needsDynamicRender =
        !isSiteRouteHandler &&
        (request.nextUrl.search !== '' || hasSessionCookie(request));

    // B. Logic for Tenant Routing
    if (path.startsWith('/tenant/')) {
        // TEST MODE: /tenant/[id]/...
        // Always dynamic: test-mode traffic must reflect live DynamoDB state, and it
        // shares a host with /_site/ previews, so its renders must never be cached.
        const parts = path.split('/');
        if (parts.length >= 3) {
            const tenantId = parts[2];
            const restOfPath = "/" + parts.slice(3).join("/");

            const url = request.nextUrl.clone();
            url.pathname = isSiteRouteHandler
                ? `/${tenantId}${restOfPath}`
                : dynamicPath(tenantId, restOfPath);
            rewriteUrl = url;
        }
    } else if (path.startsWith('/_site/')) {
        // PREVIEW MODE: /_site/[id]/...
        // Previews are accessible via CloudFront URL for sharing with clients
        // Security: Block requests from production tenant domains (prevents /_site/ path hijacking)
        const host = request.headers.get('host') || '';
        const isAllowedHost = host.includes('localhost') || host.includes('cloudfront.net') || host.includes('staging');

        if (!isAllowedHost) {
            return new NextResponse("Preview URLs are only accessible via CloudFront or localhost.", { status: 403 });
        }

        const parts = path.split('/');
        if (parts.length >= 3) {
            const tenantId = parts[2];
            const restOfPath = "/" + parts.slice(3).join("/");

            const url = request.nextUrl.clone();
            // Always dynamic: previews show drafts and must never enter either cache.
            url.pathname = isSiteRouteHandler
                ? `/${tenantId}${restOfPath}`
                : dynamicPath(tenantId, restOfPath);

            // Set cookie with preview base path for link generation
            const response = NextResponse.rewrite(url);
            response.cookies.set('amodx_preview_base', `/_site/${tenantId}`, {
                httpOnly: false, // Needs to be readable client-side
                secure: false,
                maxAge: 60 * 60, // 1 hour
                path: '/',
                sameSite: 'lax'
            });
            return response;
        }
    } else {
        // PRODUCTION MODE: Domain Mapping
        const forwardedHost = request.headers.get('x-forwarded-host');
        const host = forwardedHost || request.headers.get('host') || '';
        const cleanHost = host.split(':')[0];

        // cache-1 / D3: unknown host gate. A host with no tenant record must never reach
        // the render — the render answers 200 with a "Site Not Found" shell (soft 404),
        // and on the cacheable route that answer is stored by both cache layers with no
        // way to opt out (measured: a route in ISR mode has no non-cacheable outcome
        // except a thrown 500). Answering here is the only place a 404 can carry
        // `no-store`. `null` means "lookup unavailable" — fail open and render as before,
        // because a DynamoDB blip must not 404 every tenant at once.
        if (await isWiredTenantHost(cleanHost) === false) {
            return notFoundResponse();
        }

        const url = request.nextUrl.clone();
        url.pathname = needsDynamicRender
            ? dynamicPath(cleanHost, path)
            : `/${cleanHost}${path}`;
        rewriteUrl = url;
    }

    // --- 2. CONSTRUCT RESPONSE ---

    // If we determined a rewrite, create a rewrite response. Otherwise, 'next'.
    // No Set-Cookie is attached here — see the note below.
    return rewriteUrl
        ? NextResponse.rewrite(rewriteUrl)
        : NextResponse.next();
}

// --- REFERRAL ATTRIBUTION: deliberately NOT here (slice cache-3) ---
//
// This middleware used to set `amodx_ref` from `?ref=` / `?utm_source=` on the outgoing
// page response. It is now a two-part mechanism: `components/ReferralCapture.tsx` (an
// inline script in the public site layout) beacons to `src/app/api/ref/route.ts`, which
// sets the cookie. Two reasons the trigger had to leave this file, in order of weight:
//
// 1. cache-3 drops `ref` / `utm_source` from the CloudFront cache key, so `/p?ref=x`
//    collapses onto the `/p` entry. Once that entry is warm the edge answers it directly
//    and the origin — hence this middleware — never runs. A server-side capture would
//    have silently stopped firing exactly for the visitors it exists to attribute. The
//    trigger has to live somewhere that runs on a cache HIT, i.e. in the browser.
// 2. Even before that, a `Set-Cookie` on a page response is a cache-poisoning shape: if a
//    response carrying one is ever stored, CloudFront replays it to every later viewer.
//    cache-1's twin discriminator happened to keep those responses `no-store`, so the
//    hazard was latent rather than live — but "correct only because of a rule enforced in
//    another file" is not a property worth keeping.
//
// The cookie is still WRITTEN by the origin, on an `/api/*` response that is uncacheable
// three ways over (POST, `CachingDisabled` behavior, `no-store`). Keeping the write
// server-side is what makes the change migration-safe: visitors holding the old
// `HttpOnly` `amodx_ref` cookie cannot have it overwritten from `document.cookie`
// (RFC 6265 §5.3 step 11), so a pure client-side write would have frozen their
// attribution at the stale value for up to 30 days. The cookie keeps `HttpOnly`, and the
// sole consumer — `src/app/api/leads/route.ts:31`, `cookies().get("amodx_ref")` — is
// unchanged.
//
// The `amodx_preview_base` cookie above is exempt from all of this: `/_site/` preview
// traffic is rewritten to the force-dynamic twin and is never stored by either cache
// layer.

export const config = {
    matcher: [
        // Match everything that isn't a static file
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
