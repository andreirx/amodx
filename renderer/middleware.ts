import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname;

    // Define SEO files that must be handled dynamically
    const isSeoFile = path.endsWith('/robots.txt') ||
        path.endsWith('/sitemap.xml') ||
        path.endsWith('/llms.txt');

    // 1. Skip Internals
    if (
        path.startsWith('/_next') ||
        path.startsWith('/api') ||
        path.startsWith('/static') ||
        (path.includes('.') && !isSeoFile)
    ) {
        return NextResponse.next();
    }

    // 2. PREVIEW MODE
    // matches /_site/client-id/page
    if (path.startsWith('/_site/')) {
        const parts = path.split('/');
        // parts[0] = "", parts[1] = "_site", parts[2] = "client-id"
        if (parts.length >= 3) {
            const tenantId = parts[2];
            const restOfPath = "/" + parts.slice(3).join("/"); // "/page" or "/"

            // Rewrite to: /client-id/page
            // This maps to [siteId]=client-id
            const url = request.nextUrl.clone();
            url.pathname = `/${tenantId}${restOfPath}`;
            return NextResponse.rewrite(url);
        }
    }

    // 3. PRODUCTION MODE
    const forwardedHost = request.headers.get('x-forwarded-host');
    const host = forwardedHost || request.headers.get('host') || '';
    const cleanHost = host.split(':')[0];

    const url = request.nextUrl.clone();
    url.pathname = `/${cleanHost}${path}`;

    return NextResponse.rewrite(url);
}

export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
