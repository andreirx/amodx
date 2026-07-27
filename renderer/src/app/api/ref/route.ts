// Referral attribution beacon (slice cache-3, design option 2b).
//
// WHY THIS ROUTE EXISTS AT ALL
//
// `renderer/middleware.ts` used to set the `amodx_ref` cookie on the outgoing page
// response. cache-3 drops `ref` / `utm_source` from the CloudFront cache key, so
// `/p?ref=x` now shares the `/p` cache entry: once that entry is warm CloudFront answers
// from the edge and the origin — middleware included — is never invoked. A capture that
// runs on the origin would have gone silently dead for exactly the campaign traffic it
// exists to attribute. The capture therefore has to be triggered by something that runs on
// a cache HIT, i.e. the browser (`components/ReferralCapture.tsx`).
//
// WHY THE BROWSER POSTS HERE INSTEAD OF WRITING `document.cookie` DIRECTLY
//
// Migration. Visitors who landed on a campaign URL before this deploy hold an
// `amodx_ref` cookie set by the old middleware with `HttpOnly; Secure; Path=/` and a
// 30-day lifetime. RFC 6265 §5.3 step 11 requires a user agent to IGNORE a non-HTTP API
// (`document.cookie`) attempting to overwrite an existing `HttpOnly` cookie. A pure
// client-side write would therefore have been a silent no-op for those visitors for up to
// 30 days, freezing their attribution at the stale value — and the staleness would have
// been invisible, because the write appears to succeed.
//
// A `Set-Cookie` from this route is an HTTP-API write, which has no such restriction: it
// overwrites the legacy cookie (same name, same host, same `Path=/`) on first campaign
// visit after deploy. That also lets the cookie keep `HttpOnly`, so the slice introduces
// no security regression relative to the middleware version.
//
// WHY IT IS SAFE FOR THIS RESPONSE TO CARRY A Set-Cookie
//
// `/api/*` has its own CloudFront behavior pinned to the managed `CachingDisabled` policy
// (`infra/lib/renderer-hosting.ts`, `additionalBehaviors['api/*']`), and the response
// declares `Cache-Control: no-store` regardless. A POST is not a cacheable method to begin
// with. Three independent reasons this can never be stored and replayed to another
// visitor — which is the defect cache-3 exists to remove from *page* responses.
//
// SEMANTICS PRESERVED FROM THE MIDDLEWARE VERSION
//
//   - 30-day window, `Path=/`, `SameSite=Lax`, `HttpOnly`, last-touch overwrite.
//   - `ref` takes precedence over `utm_source`. That single `||` lives in the snippet,
//     which is where the visitor's URL is read; this route receives the already-resolved
//     value as `v`.
//   - The value is percent-encoded on the wire by `NextResponse.cookies.set` (the same
//     serializer the middleware used) and percent-decoded by the sole consumer,
//     `app/api/leads/route.ts:31` (`cookies().get("amodx_ref")`). Encoding is also what
//     prevents a `;` or a newline in the value from forging cookie attributes.
//   - The value is not length-capped, exactly as before. It is visitor-supplied and lands
//     only in that visitor's own cookie jar; the browser enforces its own ~4KB limit.
//
// ONE DELIBERATE DIFFERENCE
//
//   `Secure` is conditional on the request not being localhost. The middleware set
//   `secure: true` unconditionally, which silently dropped the cookie on plain-http local
//   development. Live traffic is HTTPS-only (CloudFront `REDIRECT_TO_HTTPS`), so
//   production behaviour is unchanged.
//
// NOT A NEW CSRF SURFACE: a cross-site POST here can set a visitor's attribution tag, but
// so can luring them to `https://<tenant>/?ref=<anything>` — a plain top-level navigation,
// which is strictly easier. The cookie is an attribution tag, not a credential, and it has
// never been anything but visitor-supplied. No token is warranted.
//
// NOT IN SCOPE: consent gating. Capture was unconditional before this slice and stays
// unconditional; the `CookieConsent` banner does not gate it. Recorded in
// docs/caching-architecture.md § Known Gaps 14 so it is a known position, not an oversight.
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "amodx_ref";
const WINDOW_SECONDS = 60 * 60 * 24 * 30; // 30 days — unchanged from the middleware version

export async function POST(req: NextRequest) {
    const res = new NextResponse(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
    });

    const value = req.nextUrl.searchParams.get("v");
    if (!value) return res; // no parameter → no cookie, same as before

    // CloudFront's viewer-request function copies the incoming Host into X-Forwarded-Host;
    // `host` is the fallback for local `next start` and for direct Lambda-URL access.
    const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
        .split(":")[0];
    const isLocal =
        host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");

    res.cookies.set(COOKIE_NAME, value, {
        httpOnly: true,
        secure: !isLocal,
        maxAge: WINDOW_SECONDS,
        path: "/",
        sameSite: "lax",
    });
    return res;
}
