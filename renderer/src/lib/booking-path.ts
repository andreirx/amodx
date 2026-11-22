/**
 * SCHED-1G2 — the public and internal addresses of the hosted booking pages (docs/slices/sched-1.md § 10.1). Pure: no
 * I/O, no Next import, so the middleware and the browser code share it and a unit test can drive every path shape.
 *
 * Public addresses (the only ones a visitor or a mail uses):
 *   - a host with a domain:   `/_booking[/<rest>]`
 *   - a preview host:         `/_site/<tenantId>/_booking[/<rest>]` (a tenant with no domain, D13)
 * Internal rewrite target (never public, refused when it comes from the wire):
 *   - `/_book/<siteId>[/<rest>]` → the tree `app/%5Fbook/[siteId]/` (a folder that starts with `_` needs the encoded
 *     name, finding G9). `<siteId>` is the request host or the tenant id; only the middleware writes it, so the wire
 *     never chooses the tenant (the same rule as `/_dyn`, PD-002 booking-token variant, § 16.3).
 *
 * Abstraction line: `bookingRoute` — users: `middleware.ts` (the one branch) and its unit test; axis: none (one rule);
 * rejected: the classification written inline in the middleware (the percent-encoded, mixed-case and doubled-slash
 * forms of G5 are then testable only through a running server). `bookingBaseOf` — users: the book and manage pages'
 * browser code (the API calls go to the public base the visitor is on); rejected: a request header set by the
 * middleware (a second channel the browser could also set).
 */

/** First path segment of every public booking address on a host with a domain. */
export const BOOKING_PUBLIC_SEGMENT = "_booking";
/** First path segment of the internal rewrite target (folder `app/%5Fbook`). */
export const BOOKING_INTERNAL_SEGMENT = "_book";

export type BookingRoute =
    /** The internal target, in any spelling (encoded, mixed case, doubled slash): answer 404. */
    | { kind: "internal" }
    /** `/_booking[/<rest>]`: the tenant is the request host (the caller checks that the host is a tenant's). */
    | { kind: "domain"; rest: string }
    /** `/_site/<tenantId>/_booking[/<rest>]` on a preview host: the tenant is the id in the path. */
    | { kind: "preview"; tenantId: string; rest: string }
    /** Not a booking address: the request takes the code path it took before SCHED-1G2. */
    | { kind: "none" };

/** Percent-decoding applied until the text no longer changes (at most 4 rounds); a malformed escape stops it. */
function decodeFully(segment: string): string {
    let current = segment;
    for (let i = 0; i < 4; i++) {
        let next: string;
        try {
            next = decodeURIComponent(current);
        } catch {
            return current;
        }
        if (next === current) return current;
        current = next;
    }
    return current;
}

/**
 * The booking address `path` (the request path, as the middleware reads it) names.
 *
 * Internal: the first NON-EMPTY segment (so `//_book/…` counts), fully percent-decoded and lower-cased, equals `_book`.
 * Public: the raw path is exactly `/_booking` or starts with `/_booking/` (domain), or — on a preview host only —
 * `/_site/<id>/_booking` or `/_site/<id>/_booking/…` with a non-empty `<id>`. `rest` is `""` or starts with `/`.
 * Every other path is `none`.
 */
export function bookingRoute(path: string, previewHost: boolean): BookingRoute {
    const first = path.split("/").find((s) => s !== "");
    if (first !== undefined && decodeFully(first).toLowerCase() === BOOKING_INTERNAL_SEGMENT) return { kind: "internal" };

    const publicPrefix = `/${BOOKING_PUBLIC_SEGMENT}`;
    if (path === publicPrefix || path.startsWith(`${publicPrefix}/`)) {
        return { kind: "domain", rest: path.slice(publicPrefix.length) };
    }

    if (previewHost && path.startsWith("/_site/")) {
        const parts = path.split("/"); // ['', '_site', id, '_booking', ...rest]
        if (parts.length >= 4 && parts[2] !== "" && parts[3] === BOOKING_PUBLIC_SEGMENT) {
            const rest = parts.slice(4);
            return { kind: "preview", tenantId: parts[2], rest: rest.length > 0 ? `/${rest.join("/")}` : "" };
        }
    }
    return { kind: "none" };
}

/** The internal rewrite target of a public booking address: `/_book/<siteId><rest>`. */
export function bookingInternalPath(siteId: string, rest: string): string {
    return `/${BOOKING_INTERNAL_SEGMENT}/${siteId}${rest}`;
}

/**
 * The public base the visitor's page is under, from the browser's `location.pathname`: `/_site/<id>/_booking` on a
 * preview address, else `/_booking`. The page calls `<base>/api/<op>`; the middleware then binds the same tenant.
 */
export function bookingBaseOf(pathname: string): string {
    const parts = pathname.split("/");
    if (parts[1] === "_site" && parts.length >= 4 && parts[2] !== "" && parts[3] === BOOKING_PUBLIC_SEGMENT) {
        return `/_site/${parts[2]}/${BOOKING_PUBLIC_SEGMENT}`;
    }
    return `/${BOOKING_PUBLIC_SEGMENT}`;
}
