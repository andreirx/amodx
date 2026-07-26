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
// This file is also the only place a **non-cacheable 404** can be produced for a
// production host (the unknown-host gate below) — see `lib/tenant-directory.ts`.
const DYN_SEGMENT = '_dyn';
const SESSION_COOKIES = ['next-auth.session-token', '__Secure-next-auth.session-token'];

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
        (request.nextUrl.search !== '' ||
            SESSION_COOKIES.some((name) => request.cookies.has(name)));

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
    const response = rewriteUrl
        ? NextResponse.rewrite(rewriteUrl)
        : NextResponse.next();

    // --- 3. REFERRAL TRACKING (Cookie Injection) ---
    // Both triggers are query params, so these requests were already routed to the
    // dynamic twin above — the Set-Cookie can never land on a cacheable response.

    const ref = request.nextUrl.searchParams.get('ref');
    const source = request.nextUrl.searchParams.get('utm_source');

    if (ref || source) {
        const val = ref || source;
        // Set cookie on the outgoing response object
        response.cookies.set('amodx_ref', val!, {
            httpOnly: true,
            secure: true, // Only HTTPS
            maxAge: 60 * 60 * 24 * 30, // 30 days
            path: '/', // Global
            sameSite: 'lax'
        });
    }

    return response;
}

export const config = {
    matcher: [
        // Match everything that isn't a static file
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
