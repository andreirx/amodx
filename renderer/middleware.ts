import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname;

    // 1. Skip Internals & Statics (Allow SEO files)
    const isSeoFile = path.endsWith('/robots.txt') ||
        path.endsWith('/sitemap.xml') ||
        path.endsWith('/llms.txt');

    if (
        path.startsWith('/_next') ||
        path.startsWith('/api') ||
        path.startsWith('/static') ||
        (path.includes('.') && !isSeoFile)
    ) {
        return NextResponse.next();
    }

    // 2. TEST MODE: /tenant/[id]/...
    // Used for E2E testing to avoid creating DNS records for every test case
    if (path.startsWith('/tenant/')) {
        const parts = path.split('/');
        // parts[0]="", parts[1]="tenant", parts[2]="test-123", parts[3]="home"
        if (parts.length >= 3) {
            const tenantId = parts[2];
            const restOfPath = "/" + parts.slice(3).join("/");

            const url = request.nextUrl.clone();
            url.pathname = `/${tenantId}${restOfPath}`;
            return NextResponse.rewrite(url);
        }
    }

    // 3. PREVIEW MODE: /_site/[id]/...
    // Secure preview for Admins
    if (path.startsWith('/_site/')) {
        const host = request.headers.get('host') || '';
        const isAllowedHost = host.includes('localhost') || host.includes('cloudfront.net') || host.includes('staging');

        if (!isAllowedHost) {
            return new NextResponse("Previews are restricted.", { status: 403 });
        }

        const parts = path.split('/');
        if (parts.length >= 3) {
            const tenantId = parts[2];
            const restOfPath = "/" + parts.slice(3).join("/");

            const url = request.nextUrl.clone();
            url.pathname = `/${tenantId}${restOfPath}`;
            return NextResponse.rewrite(url);
        }
    }

    // 4. PRODUCTION MODE: Domain Mapping
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
