import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname;

    // --- 1. DETERMINE DESTINATION URL ---

    // Default: Don't rewrite (pass through)
    let rewriteUrl = null;

    // A. Skip Internals (Assets, API, Next.js hydration)
    const isSeoFile = path.endsWith('/robots.txt') || path.endsWith('/sitemap.xml') || path.endsWith('/llms.txt');
    if (
        path.startsWith('/_next') ||
        path.startsWith('/api') ||
        path.startsWith('/static') ||
        (path.includes('.') && !isSeoFile)
    ) {
        // Return next() immediately, but we might need to attach cookies?
        // Usually referrals land on pages, not assets.
        // Let's allow cookie logic to run even for pages, but usually skip for assets.
        return NextResponse.next();
    }

    // B. Logic for Tenant Routing
    if (path.startsWith('/tenant/')) {
        // TEST MODE: /tenant/[id]/...
        const parts = path.split('/');
        if (parts.length >= 3) {
            const tenantId = parts[2];
            const restOfPath = "/" + parts.slice(3).join("/");

            const url = request.nextUrl.clone();
            url.pathname = `/${tenantId}${restOfPath}`;
            rewriteUrl = url;
        }
    } else if (path.startsWith('/_site/')) {
        // PREVIEW MODE: /_site/[id]/...
        const host = request.headers.get('host') || '';
        const isAllowedHost = host.includes('localhost') || host.includes('cloudfront.net') || host.includes('staging');

        if (!isAllowedHost) {
            return new NextResponse("Previews are restricted to Admin/CloudFront domains.", { status: 403 });
        }

        const parts = path.split('/');
        if (parts.length >= 3) {
            const tenantId = parts[2];
            const restOfPath = "/" + parts.slice(3).join("/");

            const url = request.nextUrl.clone();
            url.pathname = `/${tenantId}${restOfPath}`;
            rewriteUrl = url;

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

        const url = request.nextUrl.clone();
        url.pathname = `/${cleanHost}${path}`;
        rewriteUrl = url;
    }

    // --- 2. CONSTRUCT RESPONSE ---

    // If we determined a rewrite, create a rewrite response. Otherwise, 'next'.
    const response = rewriteUrl
        ? NextResponse.rewrite(rewriteUrl)
        : NextResponse.next();

    // --- 3. REFERRAL TRACKING (Cookie Injection) ---

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
