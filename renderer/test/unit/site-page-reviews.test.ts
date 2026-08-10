import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * slice `rev-4` — INTEGRATION of the two `SitePage` prefetch/render branches that this slice added,
 * asserted as SSR OUTPUT (not just the pure helpers). This is the DoD render surface: the point of
 * rev-4 is that approved review photos + site-scope reviews actually reach visitor markup.
 *
 * WHY THIS DRIVES THE REAL `SitePage` (and only mocks the DB boundary). The pure filter/URL
 * resolution is pinned in `review-images.test.ts`; the block's markup emission in
 * `packages/plugins/test/reviewsCarousel.test.ts`. Neither exercises the WIRING inside `SitePage`:
 *   • the `scope === "site-reviews"` prefetch branch that calls `getSiteReviews(config.id)` and
 *     REPLACES the block's authored `items`; and
 *   • the product-page review section that renders each approved review's photos.
 * These tests fail if either branch is removed — see the negative assertions (manual marker must be
 * gone; the DB photo URL must be present).
 *
 * MOCKS. Only the DynamoDB reads (`@/lib/dynamo`) and Next's runtime-coupled modules are mocked —
 * the DB is the sole external boundary. `@/lib/review-images` (the code under test), `RenderBlocks`,
 * `@amodx/plugins/render`, and the whole render tree stay REAL, so the assertions are on the actual
 * SSR HTML. `renderToStaticMarkup` is `react-dom/server` (the renderer's own SSR path) and runs the
 * "use client" components in a single pass (effects skipped) exactly as an ISR prerender would.
 *
 * `next/dynamic` (perf-1): RenderBlocks wraps each plugin render in `next/dynamic` so a page ships
 * only the render chunks for the block types it renders. Its `loadable` runtime is Next-runtime
 * coupled and cannot execute under this bare `react-dom/server` harness (it resolves `React` to
 * null → "invalid hook call"), exactly like `next/link` / `next/script` below. We stub it to a
 * preload-then-synchronous-render shim: `renderSite()` awaits every registered plugin loader before
 * rendering, so the REAL render component (e.g. `ReviewsCarouselRender`) still emits its markup in
 * a single pass — mirroring how production's async server render resolves the dynamic import before
 * the ISR HTML is cached. The split is a client-chunk change; the SSR HTML is unchanged.
 *
 * `UPLOADS_CDN_URL` is set here so `reviewAssetCdnBase()` resolves a non-empty base and photos
 * appear; production wiring of that env var into the renderer Lambda is the slice's deploy gate.
 */

// --- DB boundary mock: every export SitePage imports from `@/lib/dynamo`, defaulted to vi.fn(). ---
const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(),
    getContentBySlug: vi.fn(),
    getPosts: vi.fn(),
    getProductBySlug: vi.fn(),
    getCategoryBySlug: vi.fn(),
    getProductsByCategory: vi.fn(),
    getAllCategories: vi.fn(),
    getActiveProducts: vi.fn(),
    searchProducts: vi.fn(),
    getDeliveryConfig: vi.fn(),
    getOrderForCustomer: vi.fn(),
    getProductReviews: vi.fn(),
    getSiteReviews: vi.fn(),
}));
vi.mock("@/lib/dynamo", () => dynamo);

// Next control-flow (throw like the runtime) + auth (not reached on a Public page, but must resolve).
vi.mock("next/navigation", () => ({
    permanentRedirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    // Read by `useTenantUrl()` inside RenderBlocks; on the cacheable route the base path is "/".
    usePathname: () => "/",
}));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn(async () => null) }));
// `CommentsSection` (rendered after RenderBlocks) calls `useSession()`, which needs a SessionProvider
// context absent here. Stub to unauthenticated — not part of the review surface under test.
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));
// `next/script` reaches for Next's HeadManagerContext (unavailable outside the Next runtime); it only
// injects JSON-LD here, which these tests do not assert. Stub it to an inert passthrough.
vi.mock("next/script", () => ({ default: () => null }));
// `next/link` reaches for Next's router/LinkStatus context (unavailable outside the Next runtime).
// Stub it to a plain <a>; the review PHOTO links under test are plain <a> already, not next/link.
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) =>
        React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
// `next/dynamic` — see the header note. Registry is `vi.hoisted` so the mock factory (hoisted above
// imports) can reach it; `dyn.React` is filled from the real import below and read only at render time.
const dyn = vi.hoisted(() => ({
    React: null as any,
    loaders: [] as Array<() => Promise<void>>,
    resolved: new Map<object, any>(),
}));
vi.mock("next/dynamic", () => ({
    default: (loader: () => Promise<{ default: any }>) => {
        const Dyn: any = (props: any) => {
            const C = dyn.resolved.get(Dyn);
            return C ? dyn.React.createElement(C, props) : null;
        };
        dyn.loaders.push(async () => {
            const m = await loader();
            dyn.resolved.set(Dyn, (m && (m.default ?? m)));
        });
        return Dyn;
    },
}));
dyn.React = React;

import { SitePage } from "@/components/SitePage";

const CDN = "https://cdn.example.com";
const originalCdn = process.env.UPLOADS_CDN_URL;

const PREFIXES = {
    product: "/product", category: "/category", cart: "/cart",
    checkout: "/checkout", shop: "/shop", account: "/account", search: "/search",
};

const baseConfig = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    domain: "shop.example",
    name: "Shop",
    header: {},
    theme: {},
    urlPrefixes: PREFIXES,
    commerceEnabled: false,
    countryCode: "EN",
    currency: "USD",
    locale: "en-US",
    hideSocialSharing: true,
    ...over,
});

async function renderSite(input: {
    slug: string[];
    query?: Record<string, string | undefined>;
}): Promise<string> {
    const el = await SitePage({
        siteId: "t1",
        slug: input.slug,
        preview: false,
        basePath: "",
        sessionToken: null,
        query: input.query ?? {},
        cacheable: true,
    });
    // Preload the dynamic plugin renders (see header note) so the real component renders in one pass.
    await Promise.all(dyn.loaders.map((f) => f()));
    return renderToStaticMarkup(el as React.ReactElement);
}

beforeEach(() => {
    process.env.UPLOADS_CDN_URL = CDN;
    for (const fn of Object.values(dynamo)) fn.mockReset();
    dynamo.getTenantConfig.mockResolvedValue(baseConfig());
    dynamo.getAllCategories.mockResolvedValue([]);
});

afterAll(() => {
    if (originalCdn === undefined) delete process.env.UPLOADS_CDN_URL;
    else process.env.UPLOADS_CDN_URL = originalCdn;
});

describe("SitePage — site-reviews carousel prefetch branch (rev-4)", () => {
    it("replaces authored items with getSiteReviews() results, rendering the DB review + approved photo", async () => {
        dynamo.getContentBySlug.mockResolvedValue({
            status: "Published",
            accessPolicy: { type: "Public" },
            title: "",
            nodeId: "n1",
            hideSharing: true,
            blocks: [
                {
                    type: "reviewsCarousel",
                    attrs: {
                        scope: "site-reviews",
                        headline: "What customers say",
                        showSource: true,
                        blockWidth: "content",
                        items: [
                            { id: "manual-1", name: "Author Typed", rating: 5, source: "google", date: "", text: "MANUAL_AUTHORED_MARKER" },
                        ],
                    },
                },
            ],
        });
        dynamo.getSiteReviews.mockResolvedValue({
            items: [
                {
                    id: "sr1",
                    authorName: "Site Reviewer",
                    rating: 5,
                    content: "They are wonderful people",
                    source: "google",
                    createdAt: "2025-02-02",
                    images: [{ assetKey: "tenantA/sitephoto.jpg", status: "approved", alt: "our storefront" }],
                },
            ],
            averageRating: 5,
            totalReviews: 1,
        });

        const html = await renderSite({ slug: ["testimonials"] });

        // The site-scope read ran, tenant-scoped.
        expect(dynamo.getSiteReviews).toHaveBeenCalledWith("t1");
        // DB review content + its approved photo (resolved to a RAW asset URL) are in the markup.
        expect(html).toContain("They are wonderful people");
        expect(html).toContain(`src="${CDN}/tenantA/sitephoto.jpg"`);
        expect(html).toContain('alt="our storefront"');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain(`href="${CDN}/tenantA/sitephoto.jpg"`);
        // The authored manual item was REPLACED — proof the prefetch branch ran.
        expect(html).not.toContain("MANUAL_AUTHORED_MARKER");
        // Never a next/image wrapper (opennext-1 parking rule).
        expect(html).not.toContain("/_next/image");
    });

    it("product-reviews-by-id: calls getProductReviews(config.id, productId), replaces items, renders the approved photo", async () => {
        dynamo.getContentBySlug.mockResolvedValue({
            status: "Published",
            accessPolicy: { type: "Public" },
            title: "",
            nodeId: "n3",
            hideSharing: true,
            blocks: [
                {
                    type: "reviewsCarousel",
                    attrs: {
                        scope: "product-reviews-by-id",
                        productId: "prod-xyz",
                        headline: "What buyers say",
                        showSource: true,
                        blockWidth: "content",
                        items: [
                            { id: "manual-1", name: "Author Typed", rating: 5, source: "google", date: "", text: "MANUAL_AUTHORED_MARKER" },
                        ],
                    },
                },
            ],
        });
        dynamo.getProductReviews.mockResolvedValue({
            items: [
                {
                    id: "pbr1",
                    authorName: "Verified Buyer",
                    rating: 5,
                    content: "Exactly as pictured",
                    source: "google",
                    createdAt: "2025-04-04",
                    images: [{ assetKey: "tenantA/byid.jpg", status: "approved", alt: "in hand" }],
                },
            ],
            averageRating: 5,
            totalReviews: 1,
        });

        const html = await renderSite({ slug: ["reviews-page"] });

        // The by-id read ran, tenant-scoped, with the block's productId — the distinct prefetch branch.
        expect(dynamo.getProductReviews).toHaveBeenCalledWith("t1", "prod-xyz");
        // The site-scope read did NOT run for this block.
        expect(dynamo.getSiteReviews).not.toHaveBeenCalled();
        // DB review content + its approved photo reach the carousel markup.
        expect(html).toContain("Exactly as pictured");
        expect(html).toContain(`src="${CDN}/tenantA/byid.jpg"`);
        expect(html).toContain('alt="in hand"');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain(`href="${CDN}/tenantA/byid.jpg"`);
        // Authored placeholder REPLACED — proof the prefetch branch ran.
        expect(html).not.toContain("MANUAL_AUTHORED_MARKER");
        expect(html).not.toContain("/_next/image");
    });

    it("leaves a manual-scope block untouched (no getSiteReviews call, authored item rendered)", async () => {
        dynamo.getContentBySlug.mockResolvedValue({
            status: "Published",
            accessPolicy: { type: "Public" },
            title: "",
            nodeId: "n2",
            hideSharing: true,
            blocks: [
                {
                    type: "reviewsCarousel",
                    attrs: {
                        scope: "manual",
                        headline: "Reviews",
                        showSource: true,
                        blockWidth: "content",
                        items: [
                            { id: "manual-1", name: "Author Typed", rating: 5, source: "google", date: "", text: "MANUAL_AUTHORED_MARKER" },
                        ],
                    },
                },
            ],
        });

        const html = await renderSite({ slug: ["testimonials"] });

        expect(dynamo.getSiteReviews).not.toHaveBeenCalled();
        expect(html).toContain("MANUAL_AUTHORED_MARKER");
    });
});

describe("SitePage — product page review photos (rev-4)", () => {
    it("renders an approved review image as a raw, lazy, alt-bearing thumbnail linking to the full URL", async () => {
        dynamo.getProductBySlug.mockResolvedValue({
            id: "p1",
            status: "active",
            title: "Necklace",
            slug: "necklace",
            description: "",
            imageLink: "",
            price: 99,
            currency: "USD",
            availability: "in_stock",
            categoryIds: [],
        });
        dynamo.getProductReviews.mockResolvedValue({
            items: [
                {
                    id: "pr1",
                    authorName: "Buyer",
                    rating: 5,
                    content: "Absolutely lovely",
                    source: "google",
                    createdAt: "2025-03-03",
                    images: [{ assetKey: "tenantA/prodphoto.jpg", status: "approved", alt: "worn on model" }],
                },
            ],
            averageRating: 5,
            totalReviews: 1,
        });

        const html = await renderSite({ slug: ["product", "necklace"] });

        expect(dynamo.getProductReviews).toHaveBeenCalledWith("t1", "p1");
        expect(html).toContain("Absolutely lovely");
        expect(html).toContain(`src="${CDN}/tenantA/prodphoto.jpg"`);
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('alt="worn on model"');
        expect(html).toContain(`href="${CDN}/tenantA/prodphoto.jpg"`);
        expect(html).not.toContain("/_next/image");
    });

    it("renders no review thumbnail when the review's only image is not approved", async () => {
        dynamo.getProductBySlug.mockResolvedValue({
            id: "p1", status: "active", title: "Necklace", slug: "necklace",
            description: "", imageLink: "", price: 99, currency: "USD",
            availability: "in_stock", categoryIds: [],
        });
        dynamo.getProductReviews.mockResolvedValue({
            items: [
                {
                    id: "pr1", authorName: "Buyer", rating: 5, content: "Pending photo",
                    source: "google", createdAt: "2025-03-03",
                    images: [{ assetKey: "tenantA/pending.jpg", status: "pending", alt: "unmoderated" }],
                },
            ],
            averageRating: 5, totalReviews: 1,
        });

        const html = await renderSite({ slug: ["product", "necklace"] });

        expect(html).toContain("Pending photo");
        // The pending image must not leak into markup.
        expect(html).not.toContain("tenantA/pending.jpg");
    });
});
