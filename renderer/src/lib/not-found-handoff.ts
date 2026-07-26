// Not-found handling for the two-route split (slice cache-1, ratified resolution D3).
//
// THE PROBLEM: on a route in ISR mode, `notFound()` answers HTTP 404 with
// `Cache-Control: s-maxage=31536000` and is stored by both cache layers (measured — see
// docs/caching-architecture.md § "Which render outcomes are cacheable"). There is no API
// for "render this one response with no-store": the dynamic APIs that would normally
// force that are a hard 500 in this mode. So a URL that 404s once stays 404 at the edge
// until an invalidation — including a URL that is published five minutes later.
//
// THE MECHANISM: the cacheable route does not answer the 404 itself. It redirects to its
// own URL with `?nf=1` appended. `middleware.ts` already routes *every* query-string
// request to the `%5Fdyn` twin, so no middleware change is needed: the twin re-renders,
// finds the same thing missing, and answers `404` + `private, no-store`. The redirect
// itself is cacheable and cheap; the 404 the client actually receives never is.
//
// WHAT IT COSTS (accepted, ratified — "cached genuine 404s" was explicitly rejected):
//   - 404 traffic is no longer absorbed at the edge. Each miss costs a cached 307 plus a
//     dynamic render on the twin, so scanner traffic reaches the SSR path and DynamoDB.
//   - The visitor's URL bar shows `?nf=1` on a 404.
//
// WHAT IT BUYS BEYOND THE HEADER: the handoff re-reads, so the cached artefact is
// self-healing *for the visitor*. The 307 is stored, but it points at the *same path* with
// `?nf=1`, and the twin re-runs the real lookup. If the page is published five minutes
// later, a visitor following the stale 307 gets the real page (at `…?nf=1`), not a stale
// 404. Contrast the rejected design, where the 404 itself was the cached artefact and no
// later read happened.
//
// THE LIMIT OF THAT, measured: the *canonical* URL keeps serving the stored 307
// (`x-nextjs-cache: HIT`) until an invalidation. Self-healing means "the visitor still
// reaches the content", not "the cache entry corrects itself". This is why a failed read
// must never land here — see below.
//
// (Every read helper in `lib/dynamo.ts` used to swallow AWS errors and return `null` /
// `[]` — indistinguishable from "missing" — so a transient DynamoDB blip on a page that
// exists produced a year-lived cached 307 that survived the blip. Human decision
// CACHE-1-D4 made all of them throw, so a failed read is now a 500 and never reaches this
// function at all. Measured both ways: docs/caching-architecture.md § "Probe: a read that
// fails AFTER tenant resolution".)
import { notFound, redirect } from "next/navigation";

/** Query flag that sends a request to the dynamic twin (any query string would do). */
export const NOT_FOUND_PARAM = "nf";

/**
 * End this render as "not found".
 *
 * @param cacheable `true` when called from the ISR route, where a 404 would be cached.
 *                  The two route shells are the only callers that decide this.
 * @param publicPath the path as the *visitor* sees it — the middleware rewrite target
 *                  (`/<siteId>/…`) must never appear in a `Location` header. On the
 *                  cacheable route the public path is the slug path, because production
 *                  rewrites are `/<path>` → `/<host>/<path>` and `basePath` is always
 *                  empty there.
 */
export function notFoundOrHandoff(cacheable: boolean, publicPath: string): never {
    if (cacheable) {
        const sep = publicPath.includes("?") ? "&" : "?";
        redirect(`${publicPath}${sep}${NOT_FOUND_PARAM}=1`);
    }
    notFound();
}
