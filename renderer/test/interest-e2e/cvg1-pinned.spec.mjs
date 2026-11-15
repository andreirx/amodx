// CAT-VARIANT-GALLERY-1 — rule 6 in a real browser (docs/slices/cat-variant-gallery-1.md § 3.1; review-1). Hermetic, like
// facets.spec.mjs: the real renderer build (`next build` + `next start`, ../serving-contract/harness.mjs) against the
// DynamoDB stub, driven by Chromium. Fixtures: fixtures.mjs `CVG1` — catalog copies whose site header has a height that
// depends on its CONTENT, which no server value can know:
//  - `breaks`: a Top Bar with two `<br>` (three lines) and a 96px Navbar;
//  - `wrap`: an editorial site (48px Navbar) whose Top Bar announcement wraps at an 800px window and fits on one line
//    at 1600px.
// Page: `/product/many-colours` (48 colour tiles, so the info column is taller than the window and the gallery pins).
//
// What it measures, with the browser's own layout (getBoundingClientRect, getComputedStyle): after the page is scrolled,
// the pinned gallery's top edge is exactly 1rem under the header's bottom edge — never under the header. Positive
// controls: the server's configuration value (the inline `top` of the HTML response, which assumes a one-line Top Bar)
// would be under the three-line header, and would leave no gap at all under the two-line one (one extra line = the
// 1rem gap) — so the rows prove the browser measurement, not the configuration value.
import { test, expect } from "@playwright/test";
import { startStubs, buildRenderer, startRenderer } from "../serving-contract/harness.mjs";
import { CVG1, CVG1_MANY_SLUG } from "../serving-contract/fixtures.mjs";

let stubs;
let server;

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

// The header: ProductImageGallery.tsx `SITE_HEADER_SELECTOR` (bound to the real layout by the header-clearance unit test).
const HEADER = "body .sticky.top-0.z-50";
const GALLERY = 'div[class="space-y-3 md:sticky md:self-start"]';

/** The geometry the visitor sees, in CSS px. */
const geometry = (page) => page.evaluate(({ HEADER, GALLERY }) => {
    const header = document.querySelector(HEADER);
    const gallery = document.querySelector(GALLERY);
    const topBar = header.querySelector(":scope > div.bg-primary");
    return {
        headerBottom: header.getBoundingClientRect().bottom,
        galleryTop: gallery.getBoundingClientRect().top,
        stickyTop: parseFloat(getComputedStyle(gallery).top),
        topBarHeight: topBar ? topBar.getBoundingClientRect().height : 0,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        scrollY: window.scrollY,
    };
}, { HEADER, GALLERY });

/**
 * Scrolls to 40px past the point where the gallery reaches its sticky `top` (well before the info column ends, where
 * sticky lets the gallery go with its grid container), then waits until the gallery is stuck (its top = its sticky
 * `top`) and the layout is still.
 */
async function pinned(page) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await geometry(page)).scrollY).toBe(0);
    const start = await geometry(page);
    await page.evaluate((y) => window.scrollTo(0, y), Math.ceil(start.galleryTop - start.stickyTop + 40));
    let last;
    try {
        await expect.poll(async () => {
            const g = await geometry(page);
            const still = last && Math.abs(last.headerBottom - g.headerBottom) < 0.01 && Math.abs(last.galleryTop - g.galleryTop) < 0.01;
            last = g;
            return still && g.scrollY > 0 && Math.abs(g.galleryTop - g.stickyTop) < 0.5;
        }, { timeout: 30_000, intervals: [250] }).toBe(true);
    } catch (e) {
        throw new Error(`the gallery did not settle pinned; last geometry ${JSON.stringify(last)}`);
    }
    return last;
}

/** The server's configuration value: the inline `top` of the gallery in the HTML response, in px. */
async function serverTopPx(page, url, rem) {
    // Fetched by the page itself (same origin): the Node request context has no host mapping for the fixture hosts.
    const html = await page.evaluate((u) => fetch(u).then((r) => r.text()), url);
    const m = html.match(/<div class="space-y-3 md:sticky md:self-start" style="top:calc\(([\d.]+)rem \+ (\d+)px\)">/);
    expect(m, "the server HTML holds the configuration value").not.toBeNull();
    return Number(m[1]) * rem + Number(m[2]);
}

test("(cvg1-pinned-breaks) a three-line Top Bar (two <br>) and a 96px bar: the pinned gallery is 1rem under the real header", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    const url = `http://${CVG1.breaks.host}:${server.port}/product/${CVG1_MANY_SLUG}`;
    await page.goto(url);
    const g = await pinned(page);
    expect(g.topBarHeight, "precondition: the Top Bar is three lines (3 × 1rem + 1rem padding)").toBeCloseTo(4 * g.rem, 0);
    expect(g.galleryTop, "the gallery clears the header").toBeGreaterThanOrEqual(g.headerBottom);
    expect(g.galleryTop - g.headerBottom, "exactly 1rem under the header").toBeCloseTo(g.rem, 0);
    const serverPx = await serverTopPx(page, url, g.rem);
    expect(serverPx, "positive control: the configuration value alone would be under this header").toBeLessThan(g.headerBottom);
    console.log(`  (cvg1-pinned-breaks) Top Bar ${g.topBarHeight}px, header bottom ${g.headerBottom}px, gallery top ${g.galleryTop}px; server value ${serverPx}px`);
});

test("(cvg1-pinned-wrap) an announcement that wraps at 800px and fits at 1600px: the pinned gallery follows the header's height", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    const url = `http://${CVG1.wrap.host}:${server.port}/product/${CVG1_MANY_SLUG}`;
    await page.goto(url);
    const narrow = await pinned(page);
    expect(narrow.topBarHeight, "precondition: at 800px the announcement wraps").toBeGreaterThan(2 * narrow.rem + 1);
    expect(narrow.galleryTop).toBeGreaterThanOrEqual(narrow.headerBottom);
    expect(narrow.galleryTop - narrow.headerBottom).toBeCloseTo(narrow.rem, 0);
    expect(await serverTopPx(page, url, narrow.rem), "positive control: the configuration value alone would leave no gap under the wrapped header").toBeLessThanOrEqual(narrow.headerBottom);

    await page.setViewportSize({ width: 1600, height: 900 });
    const wide = await pinned(page);
    expect(wide.topBarHeight, "precondition: at 1600px the announcement is one line").toBeCloseTo(2 * wide.rem, 0);
    expect(wide.headerBottom, "the header is shorter at 1600px").toBeLessThan(narrow.headerBottom);
    expect(wide.galleryTop).toBeGreaterThanOrEqual(wide.headerBottom);
    expect(wide.galleryTop - wide.headerBottom, "the gallery moved up with the header: still exactly 1rem under it").toBeCloseTo(wide.rem, 0);
    console.log(`  (cvg1-pinned-wrap) 800px: Top Bar ${narrow.topBarHeight}px, header ${narrow.headerBottom}px, gallery ${narrow.galleryTop}px; 1600px: Top Bar ${wide.topBarHeight}px, header ${wide.headerBottom}px, gallery ${wide.galleryTop}px`);
});
