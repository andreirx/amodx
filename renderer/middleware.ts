import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    // Get the host (e.g. "localhost:3000" or "dental-pros.com")
    const hostname = request.headers.get('host') || '';

    // STRIP PORT: The DB stores "localhost", not "localhost:3000".
    // We standardise this so the lookup works.
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
