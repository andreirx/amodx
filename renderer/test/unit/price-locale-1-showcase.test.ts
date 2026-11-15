import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { urlPrefixesOf } from "@amodx/shared";

/**
 * PRICE-LOCALE-1 (docs/slices/price-locale-1.md; ruling PL1-SHOWCASE = C, narrowed) — the server pass
 * (`prepareBlocks` in `SitePage.tsx`) gives a showcase product `_priceRange` ONLY when the tenant locale writes a
 * decimal comma AND the product's `price` or a tier price contains a comma; every other product reaches the card
 * unchanged. Harness of `category-content-1.test.ts`: real `SitePage`; mocked DynamoDB reads, Next's runtime-coupled
 * modules, `CommentsSection`, and `RenderBlocks` (a probe that prints the prepared blocks).
 */

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(), getPosts: vi.fn(async () => []),
    getDeliveryConfig: vi.fn(async () => null), getProductBySlug: vi.fn(async () => null),
    getCategoryBySlug: vi.fn(), getProductsByCategory: vi.fn(), getAllCategories: vi.fn(async () => []),
    getActiveProducts: vi.fn(), getCatalogListing: vi.fn(), searchProducts: vi.fn(), getOrderForCustomer: vi.fn(async () => null),
    getProductReviews: vi.fn(), getSiteReviews: vi.fn(), getProductById: vi.fn(), hasActivePopups: vi.fn(async () => false),
}));
vi.mock("@/lib/dynamo", () => dynamo);
vi.mock("next/navigation", () => ({
    permanentRedirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    usePathname: () => "/",
}));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn(async () => null) }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
vi.mock("next/script", () => ({ default: () => null }));
(globalThis as any).__react = React;
vi.mock("@/components/CommentsSection", () => ({ CommentsSection: () => null }));
vi.mock("@/components/RenderBlocks", () => ({
    RenderBlocks: (props: any) => (globalThis as any).__react.createElement("render-blocks-probe", { "data-props": JSON.stringify(props) }),
}));

import { SitePage } from "@/components/SitePage";

const SHOWCASE = { type: "categoryShowcase", attrs: { categorySlug: "rugs", categoryName: "Rugs", limit: 4, columns: "4", showPrice: true, ctaText: "All" } };
const COMMA = { id: "r1", title: "Covor", slug: "covor", price: "12,50", currency: "RON", availability: "in_stock", volumePricing: [{ minQuantity: 5, price: "10,00" }] };
const POINT = { id: "r2", title: "Rug", slug: "rug", price: "100.00", currency: "RON", availability: "in_stock", volumePricing: [{ minQuantity: 5, price: "75.00" }] };
const COMMA_NO_TIERS = { id: "r3", title: "Pres", slug: "pres", price: "9,99", currency: "RON", availability: "in_stock", volumePricing: [] };
const COMMA_BROKEN = { id: "r4", title: "Preș", slug: "pres-2", price: "12,50", currency: "RON", availability: "in_stock", volumePricing: [{ minQuantity: 5, price: "10,00,1" }] };
const COMMA_TIER_ONLY = { id: "r5", title: "Mat", slug: "mat", price: "12.50", currency: "RON", availability: "in_stock", volumePricing: [{ minQuantity: 5, price: "10,00" }] };
const PRODUCTS = [COMMA, POINT, COMMA_NO_TIERS, COMMA_BROKEN, COMMA_TIER_ONLY];

const decoded = (html: string) => html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

beforeEach(() => {
    vi.clearAllMocks();
    dynamo.getCategoryBySlug.mockImplementation(async (_t: string, slug: string) => (slug === "rugs" ? { id: "rugs", slug: "rugs", name: "Rugs" } : null));
    dynamo.getProductsByCategory.mockImplementation(async () => ({ items: structuredClone(PRODUCTS), total: PRODUCTS.length }));
    dynamo.getContentBySlug.mockImplementation(async () => ({
        id: "n1", nodeId: "n1", slug: "/about", title: "About", status: "Published", accessPolicy: { type: "Public" },
        commentsMode: "Hidden", hideSharing: true, blocks: [structuredClone(SHOWCASE)],
    }));
});

/** The showcase products as the server pass gives them to RenderBlocks, for a tenant with `extra` settings. */
async function showcaseProducts(extra: Record<string, unknown>): Promise<any[]> {
    dynamo.getTenantConfig.mockResolvedValue({
        id: "t1", name: "Site", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: urlPrefixesOf(undefined), commerceEnabled: true, catalogMode: false, ...extra,
    });
    const html = renderToStaticMarkup((await SitePage({ siteId: "t1", slug: ["about"], preview: false, basePath: "", sessionToken: null, query: {}, cacheable: true })) as any);
    const m = html.match(/<render-blocks-probe data-props="([^"]*)"/);
    if (!m) throw new Error("RenderBlocks not rendered");
    return JSON.parse(decoded(m[1])).blocks[0].attrs.prefetchedProducts;
}

describe("showcase card range, server pass (PRICE-LOCALE-1)", () => {
    it("ro-RO, price 12,50, tier 10,00 → _priceRange { min: 10, max: 12.5 }; the price texts are unchanged", async () => {
        const [comma] = await showcaseProducts({ locale: "ro-RO" });
        expect(comma._priceRange).toEqual({ min: 10, max: 12.5 });
        expect(comma.price).toBe("12,50");
        expect(comma.volumePricing).toEqual([{ minQuantity: 5, price: "10,00" }]);
    });

    it("ro-RO: a comma only in a tier (12.50, tier 10,00) → the range too", async () => {
        const products = await showcaseProducts({ locale: "ro-RO" });
        expect(products[4]._priceRange).toEqual({ min: 10, max: 12.5 });
    });

    it("ro-RO: point prices, no tiers, or a text that does not parse → the product reaches the card exactly as read", async () => {
        const products = await showcaseProducts({ locale: "ro-RO" });
        expect(products[1]).toEqual(POINT);
        expect(products[2]).toEqual(COMMA_NO_TIERS);
        expect(products[3]).toEqual(COMMA_BROKEN);
    });

    it("de-DE (another decimal-comma locale) → the range", async () => {
        expect((await showcaseProducts({ locale: "de-DE" }))[0]._priceRange).toEqual({ min: 10, max: 12.5 });
    });

    it("en-US, en-GB, absent locale (decimal point) → every product exactly as read (no new key)", async () => {
        for (const extra of [{ locale: "en-US" }, { locale: "en-GB" }, {}]) {
            expect(await showcaseProducts(extra), JSON.stringify(extra)).toEqual(PRODUCTS);
        }
    });

    it("a catalog tenant (ro-RO) → display fields only; no range reaches the card", async () => {
        const products = await showcaseProducts({ locale: "ro-RO", commerceEnabled: false, catalogMode: true });
        for (const p of products) expect(Object.keys(p).sort()).toEqual(["id", "slug", "title"]);
    });
});
