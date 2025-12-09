import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    // 1. Determine Hostname
    const forwardedHost = request.headers.get('x-forwarded-host');
    const host = forwardedHost || request.headers.get('host') || '';
    const cleanHost = host.split(':')[0]; // Remove port

    // 2. Skip Internal Paths
    const path = request.nextUrl.pathname;
    if (
        path.startsWith('/_next') ||
        path.startsWith('/api') ||
        path.startsWith('/static') ||
        cleanHost === 'localhost' // In dev, we might treat localhost as "DEMO" or handled by page logic
    ) {
        return NextResponse.next();
    }

    // 3. Rewrite: /about -> /client-domain.com/about
    // This allows [siteId] to capture "client-domain.com"
    const url = request.nextUrl.clone();
    url.pathname = `/${cleanHost}${path}`;

    return NextResponse.rewrite(url);
}

export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
