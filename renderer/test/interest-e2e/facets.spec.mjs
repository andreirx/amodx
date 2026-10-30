// CAT-FACETS-1 — row `cf1-prefetch` (spec docs/slices/cat-facets-1.md § 5.3, § 5.5). Hermetic, like interest.spec.mjs:
// the real renderer build (`next build` + `next start`, ../serving-contract/harness.mjs) against the DynamoDB stub, the
// catalog fixture tenant `cm1-catalog` (fixtures.mjs, block CF1), driven by Chromium.
//
// What it measures: the visitor's own browser does not request any filter URL in the background. Facet links are plain
// anchors (no Next `<Link>`, so no viewport prefetch). Before a click: no request whose URL carries `f=`. After a click
// on one facet link: exactly one such request — the navigation to that link — and no other. A load-reduction measure,
// not a bound: it changes only what our page asks for (§ 5.3).
//
// "Network idle" (the spec's wording) is never reached on this page, for a reason that predates the panel: Next's
// viewport prefetch of the header's Contact link (`/contact`, a page the fixture tenant does not have) follows the
// not-found handoff to `/contact?nf=1` and that RSC request stays open (OBSERVED 2026-10-30; interest.spec.mjs notes
// the same for the commerce pages). So the row waits for the network to be QUIET instead: no request in flight except
// that one, and none started in the last second. The exclusion is by the `nf` parameter only, never by `f`.
import { test, expect } from "@playwright/test";
import { startStubs, buildRenderer, startRenderer } from "../serving-contract/harness.mjs";
import { CM1 } from "../serving-contract/fixtures.mjs";

let stubs;
let server;

/** Resolves when no request is in flight except not-found-handoff prefetches (`nf=1`) and none began for 1 s. */
async function networkQuiet(page, inFlight, lastStart) {
    await expect.poll(() => {
        const open = [...inFlight].filter((u) => !new URL(u).searchParams.has("nf"));
        return open.length === 0 && Date.now() - lastStart() > 1000;
    }, { timeout: 30_000, intervals: [250] }).toBe(true);
}

test.beforeAll(async () => {
    test.setTimeout(600_000);
    stubs = await startStubs();
    await buildRenderer(stubs.ddb.url);
    server = await startRenderer(stubs);
});

test.afterAll(async () => {
    await server?.close();
    await stubs?.close();
});

test("(cf1-prefetch) catalog shop with the filter panel: no request for a facet-link URL before a click; one after", async ({ page }) => {
    const filterRequests = [];
    const inFlight = new Set();
    let started = Date.now();
    page.on("request", (r) => {
        started = Date.now();
        inFlight.add(r.url());
        if (new URL(r.url()).searchParams.has("f")) filterRequests.push(r.url());
    });
    for (const done of ["requestfinished", "requestfailed"]) page.on(done, (r) => inFlight.delete(r.url()));
    const quiet = () => networkQuiet(page, inFlight, () => started);

    await page.goto(`http://${CM1.catalog.host}:${server.port}/shop`);
    const links = page.locator('[data-facet-panel] a[data-facet-value="link"]');
    expect(await links.count()).toBeGreaterThan(5);
    // Scroll the panel through the viewport, as a reader would, so any viewport prefetch would fire.
    for (const details of await page.locator("[data-facet-panel] details[data-facet]").all()) await details.scrollIntoViewIfNeeded();
    await quiet();
    expect(filterRequests).toEqual([]);

    const link = page.locator('[data-facet="producator"] a[data-facet-value="link"]').first();
    const href = await link.getAttribute("href");
    await link.click();
    await page.waitForURL((u) => u.searchParams.has("f"));
    await quiet();
    expect(filterRequests).toEqual([new URL(href, page.url()).toString()]);
    await expect(page.locator("[data-facet-chips]")).toBeVisible();
});
