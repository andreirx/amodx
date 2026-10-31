import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

/**
 * CAT-IMAGE-GATE-1 (docs/slices/cat-image-gate-1.md § 3 item 5, § 5) — the product page's status gate in the REAL
 * `SitePage` and `buildSitePageMetadata`, with only the DynamoDB reads (`@/lib/dynamo`) and Next's runtime modules
 * mocked (the harness of `site-page-reviews.test.ts`).
 *
 * How the gate is observed without rendering a page: `notFound()` throws `NEXT_NOT_FOUND` (dynamic twin,
 * `cacheable: false`); a request that passes the gate reaches the next read, `getProductReviews`, which throws
 * `PAST_THE_STATUS_GATE`. So each case ends in exactly one of the two, and nothing else is asserted.
 * Rule under test: a non-active product is not found; on a catalog site ALSO with `preview` (the unauthenticated
 * `?preview=` flag); on any other site the preview exception is kept (unchanged).
 */

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(),
    getContentBySlug: vi.fn(),
    getPosts: vi.fn(),
    getProductBySlug: vi.fn(),
    getCategoryBySlug: vi.fn(),
    getProductsByCategory: vi.fn(),
    getAllCategories: vi.fn(),
    getActiveProducts: vi.fn(),
    getCatalogListing: vi.fn(),
    searchProducts: vi.fn(),
    getDeliveryConfig: vi.fn(),
    getOrderForCustomer: vi.fn(),
    getProductReviews: vi.fn(),
    getSiteReviews: vi.fn(),
}));
vi.mock("@/lib/dynamo", () => dynamo);
vi.mock("next/navigation", () => ({
    permanentRedirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    usePathname: () => "/",
}));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn(async () => null) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { SitePage, buildSitePageMetadata } from "@/components/SitePage";

const config = (catalog: boolean) => ({
    id: "t1", domain: "site.example", name: "Site", header: {}, theme: {},
    urlPrefixes: { product: "/product", category: "/category", cart: "/cart", checkout: "/checkout", shop: "/shop", account: "/account", search: "/search" },
    commerceEnabled: !catalog, countryCode: "EN", currency: "USD", locale: "en-US",
    ...(catalog ? { catalogMode: true } : {}),
});
const product = (status: string | undefined) => ({
    id: "p1", title: "Hidden Oak", slug: "oak", description: "Oak.", categoryIds: [], ...(status === undefined ? {} : { status }),
});

/** The outcome of one product-page request on the dynamic twin. */
async function outcome(catalog: boolean, status: string | undefined, preview: boolean): Promise<string> {
    dynamo.getTenantConfig.mockResolvedValue(config(catalog));
    dynamo.getProductBySlug.mockResolvedValue(product(status));
    try {
        await SitePage({ siteId: "t1", slug: ["product", "oak"], preview, basePath: "", sessionToken: null, query: preview ? { preview: "true" } : {}, cacheable: false });
        return "rendered without a read";
    } catch (e) {
        return (e as Error).message;
    }
}

beforeEach(() => {
    for (const fn of Object.values(dynamo)) fn.mockReset();
    dynamo.getProductReviews.mockRejectedValue(new Error("PAST_THE_STATUS_GATE"));
    dynamo.getAllCategories.mockResolvedValue([]);
    dynamo.getContentBySlug.mockResolvedValue(null);
});

describe("CAT-IMAGE-GATE-1 — product page status gate", () => {
    it.each([
        ["catalog, draft", "NEXT_NOT_FOUND", true, "draft", false],
        ["catalog, draft, ?preview=", "NEXT_NOT_FOUND", true, "draft", true],
        ["catalog, archived, ?preview=", "NEXT_NOT_FOUND", true, "archived", true],
        ["catalog, no status (legacy), ?preview=", "NEXT_NOT_FOUND", true, undefined, true],
        ["catalog, active", "PAST_THE_STATUS_GATE", true, "active", false],
        ["catalog, active, ?preview=", "PAST_THE_STATUS_GATE", true, "active", true],
        // non-catalog: unchanged — not found without preview, shown with it
        ["commerce, draft", "NEXT_NOT_FOUND", false, "draft", false],
        ["commerce, draft, ?preview=", "PAST_THE_STATUS_GATE", false, "draft", true],
        ["commerce, active", "PAST_THE_STATUS_GATE", false, "active", false],
    ] as const)("%s → %s", async (_name, expected, catalog, status, preview) => {
        expect(await outcome(catalog, status, preview)).toBe(expected);
    });

    it("a missing product takes the same path as a catalog draft (not found)", async () => {
        dynamo.getTenantConfig.mockResolvedValue(config(true));
        dynamo.getProductBySlug.mockResolvedValue(null);
        await expect(SitePage({ siteId: "t1", slug: ["product", "oak"], preview: true, basePath: "", sessionToken: null, query: { preview: "true" }, cacheable: false }))
            .rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("metadata: a catalog draft gives the missing-product metadata (no title leak); a commerce draft keeps its product metadata (unchanged)", async () => {
        dynamo.getTenantConfig.mockResolvedValue(config(true));
        dynamo.getProductBySlug.mockResolvedValue(product("draft"));
        const hidden = await buildSitePageMetadata({ siteId: "t1", slug: ["product", "oak"], query: {} });
        dynamo.getProductBySlug.mockResolvedValue(null);
        const missing = await buildSitePageMetadata({ siteId: "t1", slug: ["product", "oak"], query: {} });
        expect(hidden).toEqual(missing);
        expect(JSON.stringify(hidden)).not.toContain("Hidden Oak");

        dynamo.getTenantConfig.mockResolvedValue(config(false));
        dynamo.getProductBySlug.mockResolvedValue(product("draft"));
        expect((await buildSitePageMetadata({ siteId: "t1", slug: ["product", "oak"], query: {} })).title).toBe("Hidden Oak");
        dynamo.getTenantConfig.mockResolvedValue(config(true));
        dynamo.getProductBySlug.mockResolvedValue(product("active"));
        expect((await buildSitePageMetadata({ siteId: "t1", slug: ["product", "oak"], query: {} })).title).toBe("Hidden Oak");
    });
});
