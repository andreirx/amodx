import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const url = request.nextUrl;
    const hostname = request.headers.get('host') || '';

    // Handle localhost for development
    // If we are on localhost:3000, we pretend we are "client-a.com"
    const currentHost = hostname.includes('localhost')
        ? 'localhost.local' // or a specific test domain
        : hostname;

    // We add the hostname to the headers so the Server Components
    // can read it easily without hacking around.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-amodx-host', currentHost);

    return NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });
}

// Only run on main routes, exclude static files/images
export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
