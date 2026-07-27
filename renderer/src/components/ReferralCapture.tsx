// Referral attribution trigger (slice cache-3, design option 2b).
//
// WHY THIS RUNS IN THE BROWSER AND NOT IN MIDDLEWARE
//
// `renderer/middleware.ts` used to set the `amodx_ref` cookie server-side. cache-3 removes
// `ref` / `utm_source` from the CloudFront cache key, so `/p?ref=x` now shares the `/p`
// cache entry: once that entry is warm CloudFront answers from the edge and the origin —
// middleware included — is never invoked. A server-side capture would have gone silently
// dead for cached pages, which is most campaign traffic. The trigger must run on a cache
// HIT, and the only thing that runs on a cache HIT is the browser.
//
// The secondary reason is that a `Set-Cookie` on a page response is a cache-poisoning
// shape: any stored response carrying one is replayed to every later viewer.
//
// WHY IT BEACONS INSTEAD OF WRITING `document.cookie`
//
// The cookie is still WRITTEN by the origin — `app/api/ref/route.ts` — this script only
// tells it to. That indirection is not decoration; it is the migration path. Visitors
// carrying the pre-deploy `HttpOnly` `amodx_ref` cookie cannot have it overwritten from
// `document.cookie` at all: RFC 6265 §5.3 step 11 requires the user agent to ignore a
// non-HTTP write over an `HttpOnly` cookie. A direct client write would have silently
// frozen their attribution at the stale value for up to 30 days. See the route for the
// full argument; it also keeps `HttpOnly`, so nothing about the cookie weakens.
//
// WHY A RAW INLINE <script> AND NOT A "use client" COMPONENT
//
// This emits no markup and needs no React state, so a client component would only add a
// hydration dependency: the beacon would not fire until the React bundle loaded. An inline
// script executes during HTML parse. It ships zero bytes of bundle.
//
// WHY IT IS SAFE TO BAKE INTO CACHED HTML
//
// The script body below is a constant. Nothing per-visitor and nothing tenant-specific is
// interpolated into it, so the HTML CloudFront stores is identical for every viewer; the
// per-visitor part happens in the visitor's own browser, against their own URL, and the
// cookie comes back on a `no-store` `/api/*` response that is never stored.
//
// SEMANTICS PRESERVED FROM THE MIDDLEWARE VERSION
//
//   - `ref` takes precedence over `utm_source` (`ref || utm_source`) — resolved here,
//     because here is where the visitor's URL is read.
//   - No `ref` / `utm_source` in the URL → no request and no cookie.
//   - 30-day window, `Path=/`, `SameSite=Lax`, `HttpOnly`, last-touch overwrite: all in
//     the route.
//
// FAILURE MODE, STATED HONESTLY: the beacon is fire-and-forget. If the request fails
// (offline, blocked by an extension) attribution for that visit is lost, where the
// middleware version could not fail independently of the page load. Accepted in the slice
// design: the alternative that cannot fail — capture on the origin — cannot run at all on
// a cache HIT, which is the majority case after cache-1. `keepalive: true` covers the
// common loss case, a visitor who navigates away immediately.

const CAPTURE_SNIPPET = `(function(){try{
var p=new URLSearchParams(location.search);
var v=p.get('ref')||p.get('utm_source');
if(!v)return;
fetch('/api/ref?v='+encodeURIComponent(v),{method:'POST',keepalive:true,credentials:'same-origin'}).catch(function(){});
}catch(e){}})();`;

/** Asks the origin to record `?ref` (else `?utm_source`) into the `amodx_ref` cookie. */
export function ReferralCapture() {
    return <script dangerouslySetInnerHTML={{ __html: CAPTURE_SNIPPET }} />;
}
