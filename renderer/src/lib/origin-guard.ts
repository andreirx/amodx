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
 *     `Origin` on POST). We compare the FULL origin — scheme + host + port — against the
 *     request's own public origin, NOT the host label alone. Host-only matching would accept
 *     an `http://` downgrade or a foreign port (`https://<site>:8443`) on the same host; the
 *     STATIC-EP reviewer's rider requires whole-origin equality, so those are rejected.
 *   - Neither header present ⇒ NOT a browser cross-site write (browsers always send `Origin`
 *     on POST). A non-browser client can forge `Origin` anyway, so blocking it buys no
 *     isolation against the browser-sandbox threat this guard is for. Allow — matching the
 *     shape the backend already relies on for its own callers.
 *
 * PRODUCTION STATUS — BELT-AND-SUSPENDERS, INERT AT THE EDGE-FRONTED ORIGIN
 * -------------------------------------------------------------------------
 * Behind CloudFront a request header only reaches this origin if it is on the
 * `RendererOriginPolicy` transport allowlist (`infra/lib/renderer-hosting.ts`); anything else
 * is stripped at the edge. `Origin` is DELIBERATELY NOT on that allowlist: the CYCLE-1 attempt
 * to add it (so this guard would run in production) hit CloudFront's hard 10-header origin-request
 * -policy cap on deploy and was reverted (D-STATIC-EP-ORIGIN, human-ratified 2026-08-09). So in
 * production this guard sees `origin === null` on every request and falls through to the allow
 * branch — it is INERT there. The real production barrier is the viewer-request CloudFront
 * Function (`STATIC_EP_EDGE_ORIGIN_GUARD` in `infra/lib/renderer-hosting.ts`), which 403s a
 * cross-site / null-origin POST to these three paths BEFORE it reaches this Lambda and which sees
 * `Origin` regardless of the ORP cap.
 *
 * This module is retained as DEFENCE-IN-DEPTH and remains fully active where there is no
 * CloudFront in front of the renderer — local `next start`, direct Lambda-URL invocation, and the
 * serving-contract harness — which is why `renderer/test/serving-contract/contract.test.mjs` row
 * `(g4)` still exercises it end-to-end. It is inert-SAFE: with `Origin`/`Sec-Fetch-Site` stripped
 * it can only ever take the allow branch, so it never rejects a legitimate first-party caller.
 *
 * RECONSTRUCTING THE EXPECTED ORIGIN (scheme is the subtle part)
 * -------------------------------------------------------------
 * The browser's public host arrives as `x-forwarded-host` behind CloudFront; on local
 * `next start` / direct invocation it is `host`. Scheme is inferred, not read: CloudFront
 * terminates TLS and force-redirects http→https, so a request carrying `X-Forwarded-Host` has
 * a public origin of `https://<forwarded-host>` — and `x-forwarded-proto` is deliberately NOT
 * on the allowlist, so presence of `X-Forwarded-Host` IS the scheme signal.
 *
 * `X-Forwarded-Host` and `Host` are MUTUALLY EXCLUSIVE as the public-origin source, not
 * additive. When `X-Forwarded-Host` is present the request came through CloudFront, and `Host`
 * is then the Lambda/function-URL ORIGIN host (CloudFront rewrites Host to the origin it dials),
 * NOT a second public origin. Admitting `Host` on that path would accept a write forged with
 * `Origin: https://<lambda-url-host>` — the function-URL host is discoverable — so on the
 * forwarded path `Host` is ignored entirely. The bare `Host` path (local/harness, never the
 * production security boundary) is reached ONLY when `X-Forwarded-Host` is absent; it carries
 * no scheme signal, so both schemes are accepted for it.
 */

/** Structural request shape — the guard needs only headers, so it stays framework-free. */
type HeadersOnly = { headers: Headers };

/**
 * Canonical origin string (`scheme://host[:non-default-port]`) for an `Origin` header value,
 * which is a full URL. `URL.origin` lowercases the host and drops a default port (443/https,
 * 80/http), giving a stable string to compare. Returns `null` for the opaque frame's literal
 * `Origin: null` (does not parse) or any unparseable value — a null never matches a candidate,
 * so the opaque-frame write is rejected.
 */
function canonicalOrigin(value: string | null): string | null {
    if (!value) return null;
    try {
        return new URL(value).origin || null;
    } catch {
        return null;
    }
}

/**
 * The set of FULL origins a legitimate same-origin write may carry, reconstructed from what
 * the request tells us about its own public origin (see the module header for the scheme
 * inference). Built with `canonicalOrigin` on both sides so default ports and case are
 * normalised identically.
 *
 * `X-Forwarded-Host` / `Host` are BARE authorities (`host[:port]`), not URLs, so they are
 * prefixed with a scheme before parsing — `new URL("localhost:3000")` would otherwise read
 * `localhost` as the scheme and yield an empty host.
 */
function firstPartyOrigins(req: HeadersOnly): string[] {
    const out: string[] = [];
    const add = (o: string | null) => { if (o && !out.includes(o)) out.push(o); };

    // Production: presence of X-Forwarded-Host ⇒ the request came through CloudFront (TLS
    // terminated, http→https forced) ⇒ the public origin is https://<forwarded-host>, and it is
    // the SOLE source. `Host` on this path is the Lambda/function-URL origin host (see the module
    // header), so it must NOT be admitted — return before the bare-host fallback.
    const forwardedHost = req.headers.get("x-forwarded-host");
    if (forwardedHost) {
        add(canonicalOrigin(`https://${forwardedHost}`));
        return out;
    }

    // Local `next start` / direct invocation / serving-contract harness: no X-Forwarded-Host,
    // so `Host` IS the public host — but it carries no scheme signal, so accept either scheme.
    // Reached only when X-Forwarded-Host is absent, i.e. never the production security boundary.
    const host = req.headers.get("host");
    if (host) {
        add(canonicalOrigin(`https://${host}`));
        add(canonicalOrigin(`http://${host}`));
    }
    return out;
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

    // 2. FULL-origin match (scheme + host + port). A browser POST always carries Origin;
    //    `Origin: null` (opaque frame → canonicalOrigin null) and any foreign origin, scheme
    //    downgrade, or foreign port all fail the exact match. Absent Origin falls through.
    const origin = req.headers.get("origin");
    if (origin !== null) {
        const candidate = canonicalOrigin(origin);
        return candidate !== null && firstPartyOrigins(req).includes(candidate);
    }

    // 3. No Origin AND no disqualifying Sec-Fetch-Site: not a browser cross-site write. Allow.
    return true;
}
