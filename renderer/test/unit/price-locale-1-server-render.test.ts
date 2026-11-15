import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

/**
 * PRICE-LOCALE-1 (docs/slices/price-locale-1.md § 1, § 2) — the props `SitePage` passes to the add-to-cart control:
 * `priceLocale` (the normalised tenant locale) ONLY for a locale that writes a decimal comma, so every decimal-point
 * tenant's props (and its flight payload) stay as they were. Harness of `locale-1d-server-render.test.ts`: real
 * `SitePage` and resolver; mocked DynamoDB reads, Next's runtime-coupled modules, and the client control (it prints its
 * props).
 */

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(async () => null), getPosts: vi.fn(),
    getProductBySlug: vi.fn(), getCategoryBySlug: vi.fn(), getProductsByCategory: vi.fn(), getAllCategories: vi.fn(async () => []),
    getActiveProducts: vi.fn(), getCatalogListing: vi.fn(), searchProducts: vi.fn(), getDeliveryConfig: vi.fn(async () => null),
    getOrderForCustomer: vi.fn(), getProductReviews: vi.fn(async () => ({ items: [], averageRating: 0, totalReviews: 0 })), getSiteReviews: vi.fn(),
    getProductById: vi.fn(), hasActivePopups: vi.fn(async () => false),
}));
vi.mock("@/lib/dynamo", () => dynamo);
vi.mock("next/navigation", () => ({
    permanentRedirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    usePathname: () => "/",
}));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn(async () => null) }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
const { probe } = vi.hoisted(() => ({
    probe: (tag: string) => (props: any) => (globalThis as any).__react.createElement(tag, { "data-props": JSON.stringify(props) }),
}));
(globalThis as any).__react = React;
vi.mock("@/components/AddToCartButton", () => ({ AddToCartButton: probe("cart-probe") }));
vi.mock("@/components/FBPurchaseEvent", () => ({ FBPurchaseEvent: () => null }));
vi.mock("@/components/ProductImageGallery", () => ({ ProductImageGallery: () => null }));
vi.mock("@/components/SearchBar", () => ({ SearchBar: () => null }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }), signIn: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { SitePage } from "@/components/SitePage";

const decoded = (html: string) => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

async function addToCartProps(locale: string | undefined) {
    dynamo.getTenantConfig.mockResolvedValue({
        id: "t1", name: "Atelier", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: URL_PREFIX_DEFAULTS, commerceEnabled: true, catalogMode: false,
        ...(locale !== undefined ? { locale } : {}),
    });
    dynamo.getProductBySlug.mockResolvedValue({ id: "p1", title: "Rug", slug: "rug", price: "12,50", currency: "RON", availability: "in_stock", status: "active", variants: [], personalizations: [], volumePricing: [] });
    const html = renderToStaticMarkup(await SitePage({ siteId: "t1", slug: ["product", "rug"], preview: false, basePath: "", sessionToken: null, query: {}, cacheable: false }) as any);
    const m = html.match(/<cart-probe data-props="([^"]*)"/);
    if (!m) throw new Error("add-to-cart control not rendered");
    return JSON.parse(decoded(m[1]));
}

describe("SitePage → AddToCartButton priceLocale", () => {
    it("ro-RO and de-DE (decimal comma) → priceLocale is the normalised locale; ro_RO is normalised", async () => {
        expect((await addToCartProps("ro-RO")).priceLocale).toBe("ro-RO");
        expect((await addToCartProps("de-DE")).priceLocale).toBe("de-DE");
        expect((await addToCartProps("ro_RO")).priceLocale).toBe("ro-RO");
    });

    it("en-US, en-GB, de-CH (decimal point), absent or malformed → no priceLocale key at all", async () => {
        for (const locale of ["en-US", "en-GB", "de-CH", undefined, "123"]) {
            expect(Object.hasOwn(await addToCartProps(locale), "priceLocale"), String(locale)).toBe(false);
        }
    });

    it("the price text reaches the control as stored (12,50)", async () => {
        expect((await addToCartProps("ro-RO")).price).toBe("12,50");
    });
});
