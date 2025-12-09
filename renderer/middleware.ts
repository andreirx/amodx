import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    // Priority order:
    // 1. x-forwarded-host (set by CloudFront Function - contains original viewer host)
    // 2. host (fallback for local dev)
    const forwardedHost = request.headers.get('x-forwarded-host');
    const originalHost = request.headers.get('host') || '';

    const hostname = forwardedHost || originalHost;

    // STRIP PORT: The DB stores "localhost", not "localhost:3000".
    const cleanHost = hostname.split(':')[0];

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-amodx-host', cleanHost);

    return NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });
}

export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
