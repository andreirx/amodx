import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * slice `test-3` — `src/lib/not-found-handoff.ts`: how a "not found" render ENDS.
 *
 * WHY THIS MATTERS MORE THAN ITS SIZE SUGGESTS. On a route in ISR mode `notFound()` is
 * answered with `s-maxage=31536000` and stored by both cache layers (measured;
 * docs/caching-architecture.md § "Which render outcomes are cacheable"). So on the
 * cacheable route this module does not 404 — it redirects to the same path with `?nf=1`,
 * which middleware routes to the dynamic twin, which answers `404 + private, no-store`.
 *
 * Two things are pinned here that no wire probe pins cheaply:
 *
 *  1. `NOT_FOUND_PARAM === "nf"`. This literal is ALSO a member of the CloudFront cache-key
 *     query allowlist introduced by `cache-3` (slice doc F1). If the two ever disagree,
 *     the 307 to `?nf=1` is served from the edge for the un-suffixed key and every 404
 *     becomes an infinite redirect loop. The suite that would catch that is an infra
 *     `cdk synth` assertion (`test-4`); this half of the pair lives here.
 *  2. The separator choice — `?` vs `&`. A path that already carries a query string must
 *     not get a second `?`, which would produce a literal parameter named `…?nf`, miss the
 *     allowlist and (again) loop.
 *
 * WHY `next/navigation` IS MOCKED, AND WHY THE MOCKS THROW. Both `redirect()` and
 * `notFound()` are typed `: never` — they signal by THROWING a control-flow exception that
 * Next catches. A mock that merely records the call would let execution fall through
 * `redirect(...)` into `notFound()`, and the test would then assert a behaviour the real
 * runtime never has. The sentinels below reproduce the throw, so "returns never" is itself
 * under test.
 */

const REDIRECT = vi.hoisted(() => vi.fn());
const NOT_FOUND = vi.hoisted(() => vi.fn());

class RedirectSignal extends Error { constructor(public url: string) { super("NEXT_REDIRECT"); } }
class NotFoundSignal extends Error { constructor() { super("NEXT_NOT_FOUND"); } }

vi.mock("next/navigation", () => ({
    redirect: (url: string) => { REDIRECT(url); throw new RedirectSignal(url); },
    notFound: () => { NOT_FOUND(); throw new NotFoundSignal(); },
}));

import { notFoundOrHandoff, NOT_FOUND_PARAM } from "../../src/lib/not-found-handoff";

/** Runs the handoff and returns the control-flow signal it threw. */
function run(cacheable: boolean, publicPath: string): RedirectSignal | NotFoundSignal {
    try {
        notFoundOrHandoff(cacheable, publicPath);
    } catch (e) {
        return e as RedirectSignal | NotFoundSignal;
    }
    throw new Error("notFoundOrHandoff returned — it is typed `: never` and must not");
}

beforeEach(() => {
    REDIRECT.mockClear();
    NOT_FOUND.mockClear();
});

// ---------------------------------------------------------------------------------------

describe("NOT_FOUND_PARAM — the literal shared with the CloudFront cache key", () => {
    it("is exactly 'nf'", () => {
        // Changing this string is a CloudFront cache-policy change, not a rename:
        // `cache-3` § F1 puts `nf` in the query-string allowlist by hand.
        expect(NOT_FOUND_PARAM).toBe("nf");
    });
});

describe("notFoundOrHandoff — cacheable route (ISR): hand off, never 404 in place", () => {
    /**
     * INVARIANT: on the cacheable route the function MUST redirect and MUST NOT call
     * `notFound()`. A `notFound()` here is stored for a year by both cache layers, so a URL
     * published five minutes later keeps 404ing until an invalidation.
     */
    it("redirects to the same path with ?nf=1", () => {
        const signal = run(true, "/about");
        expect(signal).toBeInstanceOf(RedirectSignal);
        expect(REDIRECT).toHaveBeenCalledExactlyOnceWith("/about?nf=1");
    });

    it("does not fall through to notFound() after redirecting", () => {
        run(true, "/about");
        expect(NOT_FOUND).not.toHaveBeenCalled();
    });

    it("appends with & when the path already carries a query string", () => {
        expect(run(true, "/shop?page=2")).toBeInstanceOf(RedirectSignal);
        expect(REDIRECT).toHaveBeenCalledExactlyOnceWith("/shop?page=2&nf=1");
    });

    it("still uses & when the existing query is the flag itself (no ?nf=1?nf=1)", () => {
        // Reachable if the twin ever re-entered the cacheable path. `?` here would create a
        // parameter literally named "1?nf", which the allowlist does not carry.
        run(true, "/about?nf=1");
        expect(REDIRECT).toHaveBeenCalledExactlyOnceWith("/about?nf=1&nf=1");
    });

    it("uses the path VERBATIM — nothing is prefixed onto it", () => {
        /**
         * INVARIANT, and the reason the parameter is named `publicPath`: the middleware
         * rewrite target `/<siteId>/…` must never reach a `Location` header. The function
         * therefore performs no path construction of its own; the caller owns the public
         * form. This test fails the moment any prefixing is introduced here.
         */
        run(true, "/produs/inel-de-argint");
        expect(REDIRECT).toHaveBeenCalledExactlyOnceWith("/produs/inel-de-argint?nf=1");
    });

    it("handles the site root", () => {
        run(true, "/");
        expect(REDIRECT).toHaveBeenCalledExactlyOnceWith("/?nf=1");
    });
});

describe("notFoundOrHandoff — dynamic twin: answer the real 404", () => {
    /**
     * INVARIANT: on the non-cacheable route the function calls `notFound()` and does NOT
     * redirect. This is the terminating half of the handoff — a redirect here would bounce
     * the request between the two routes forever.
     */
    it("calls notFound() and never redirect()", () => {
        const signal = run(false, "/about?nf=1");
        expect(signal).toBeInstanceOf(NotFoundSignal);
        expect(NOT_FOUND).toHaveBeenCalledTimes(1);
        expect(REDIRECT).not.toHaveBeenCalled();
    });

    it("ignores the path entirely when not cacheable", () => {
        run(false, "/anything?with=query");
        expect(REDIRECT).not.toHaveBeenCalled();
        expect(NOT_FOUND).toHaveBeenCalledTimes(1);
    });
});
