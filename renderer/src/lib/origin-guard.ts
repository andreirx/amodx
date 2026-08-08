/**
 * STATIC-1 — first-party-write guard for anonymous (credential-free) renderer write proxies.
 *
 * WHY THIS EXISTS, AND WHY HERE
 * -----------------------------
 * `/api/consent`, `/api/contact`, `/api/leads` are POST proxies that accept a browser
 * request with NO user credential, derive the tenant from the host, attach the RENDERER
 * API key, and forward to the backend. The backend's own Origin check
 * (`backend/src/lib/tenant-verify.ts` → `verifyTenantFromOrigin`) is deliberately SKIPPED
 * for the RENDERER role — the service identity is its trust anchor. So the browser's
 * `Origin` is visible to the barrier ONLY at this renderer hop; once proxied it is gone.
 * This guard is that hop's Origin check.
 *
 * The concrete threat is STATIC-1's own barrier: a page embedded in the ratified
 * `sandbox="allow-scripts"` iframe runs at an OPAQUE (null) origin and can still fire
 * `fetch()`. Residual (i) of docs/plan-static-html-pages.md § 3(a) is exactly "a renderer
 * write endpoint that is neither session-gated nor SameSite-protected, reachable
 * credential-free cross-origin." These three proxies are that shape. This guard closes
 * them to cross-site / null-origin browser writes without touching the first-party forms.
 *
 * WHY IT DOES NOT BREAK LEGITIMATE FIRST-PARTY CALLERS
 * ----------------------------------------------------
 * The only legitimate callers are the site's OWN forms — `ContactRender`, `LeadMagnetRender`,
 * `CookieConsent` — which `fetch()` a RELATIVE URL. Per the Fetch spec, a browser sends
 * `Origin` on every non-GET/HEAD request (same-origin included), and `Sec-Fetch-Site` on
 * every request. A same-origin form POST therefore carries `Origin: https://<site-host>`
 * and `Sec-Fetch-Site: same-origin` — both pass. A sandboxed opaque frame carries
 * `Origin: null` / `Sec-Fetch-Site: cross-site` — both fail.
 *
 * DECISION SURFACE (kept minimal on purpose):
 *   - `Sec-Fetch-Site` is a Forbidden header — page JS cannot set or forge it — so when the
 *     browser sends it, it is authoritative. Reject `cross-site` and `same-site` outright.
 *   - `Origin` is the universal fallback (Safari < 16.4 omits `Sec-Fetch-Site`, but sends
 *     `Origin` on POST). Its host must equal the request's own public host.
 *   - Neither header present ⇒ NOT a browser cross-site write (browsers always send `Origin`
 *     on POST). A non-browser client can forge `Origin` anyway, so blocking it buys no
 *     isolation against the browser-sandbox threat this guard is for. Allow — matching the
 *     shape the backend already relies on for its own callers.
 *
 * Behind CloudFront the browser's public host arrives as `x-forwarded-host`; on local
 * `next start` / direct invocation it is `host`. Matching against BOTH is what keeps this
 * correct in production and in the serving-contract harness alike.
 */

/** Structural request shape — the guard needs only headers, so it stays framework-free. */
type HeadersOnly = { headers: Headers };

/**
 * Host from an `Origin` header, which is a URL (`scheme://host[:port]`). `null` for an
 * opaque frame's literal `Origin: null` (URL parse throws) or any unparseable value — a
 * null host never matches, so the opaque-frame write is rejected.
 */
function hostFromOrigin(origin: string | null): string | null {
    if (!origin) return null;
    try {
        return new URL(origin).host.split(":")[0].toLowerCase() || null;
    } catch {
        return null;
    }
}

/**
 * Host from a `Host` / `X-Forwarded-Host` header, which is a BARE authority
 * (`host[:port]`), NOT a URL. It must NOT be URL-parsed: `new URL("localhost:3000")`
 * does not throw — it reads `localhost` as a scheme and yields an empty host. Strip the
 * port directly instead.
 */
function hostFromAuthority(authority: string | null): string | null {
    if (!authority) return null;
    const host = authority.split(":")[0].trim().toLowerCase();
    return host || null;
}

/**
 * True iff the request is a legitimate first-party (same-origin) write. A cross-site or
 * null-origin (sandboxed opaque-frame) browser write returns false and must be rejected 403.
 */
export function isFirstPartyWrite(req: HeadersOnly): boolean {
    // 1. Sec-Fetch-Site (unspoofable by page JS). `none` = user-initiated (typed URL /
    //    bookmark), not a scripted cross-site write, so it is allowed alongside `same-origin`.
    const secFetchSite = req.headers.get("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
        return false;
    }

    // 2. Origin host-match. A browser POST always carries Origin; `null` (opaque frame) and a
    //    foreign host both fail the match. Absent Origin falls through to the non-browser case.
    const origin = req.headers.get("origin");
    if (origin !== null) {
        const originHost = hostFromOrigin(origin); // "null" (opaque frame) → null → reject
        const expected = [
            hostFromAuthority(req.headers.get("x-forwarded-host")), // public host behind CloudFront
            hostFromAuthority(req.headers.get("host")),             // local `next start` / direct
        ].filter((h): h is string => h !== null);
        return originHost !== null && expected.includes(originHost);
    }

    // 3. No Origin AND no disqualifying Sec-Fetch-Site: not a browser cross-site write. Allow.
    return true;
}
