import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { URL_PREFIX_DEFAULTS } from "@amodx/shared";
import { ProductImageGallery } from "@/components/ProductImageGallery";
import { CASES } from "./cat-variant-gallery-1-cases";
import BEFORE from "./cat-variant-gallery-1-before.json";

/**
 * CAT-VARIANT-GALLERY-1 (docs/slices/cat-variant-gallery-1.md § 1 rules 1, 5, 6, 8) — headless server renders of the
 * product page through the real `SitePage` and the real `ProductImageGallery` (the mock setup of
 * locale-1b-server-render.test.ts, without its gallery mock).
 *  - Commerce (rule 8): the gallery's server markup for the three props of before is byte-identical to the markup the
 *    gallery at 27fa7ca produced (`cat-variant-gallery-1-before.json`, captured from that file; cases in
 *    `cat-variant-gallery-1-cases.ts`), standalone and inside a commerce product page.
 *  - Catalog: with picture options there is no whole-gallery thumbnail row and the gallery is pinned from `md` up
 *    (default header: `calc(5rem + 1px)`; every header configuration: cat-variant-gallery-1-header-clearance.test.ts);
 *    without options the thumbnail row stays.
 * The interactive rows (choosing a tile) are in cat-variant-gallery-1-client.test.ts.
 */

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(), getPosts: vi.fn(),
    getProductBySlug: vi.fn(), getCategoryBySlug: vi.fn(), getProductsByCategory: vi.fn(), getAllCategories: vi.fn(async () => []),
    getActiveProducts: vi.fn(), getCatalogListing: vi.fn(), searchProducts: vi.fn(), getDeliveryConfig: vi.fn(),
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
vi.mock("@/components/SearchBar", () => ({ SearchBar: () => null }));
vi.mock("@/components/InterestShortlist", () => ({ InterestToggle: () => null, InterestListPage: () => null, InterestWidget: () => null }));
vi.mock("@/components/AddToCartButton", () => ({ AddToCartButton: () => null }));

import { SitePage } from "@/components/SitePage";

function tenant(extra: Record<string, unknown> = {}) {
    return {
        id: "t1", name: "Atelier", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: URL_PREFIX_DEFAULTS, commerceEnabled: true, catalogMode: false, ...extra,
    };
}
const catalogTenant = () => tenant({ commerceEnabled: false, catalogMode: true });

async function productPage(config: Record<string, unknown>, product: Record<string, unknown>) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    dynamo.getProductBySlug.mockResolvedValue(product);
    const el = await SitePage({ siteId: "t1", slug: ["product", "rug"], preview: false, basePath: "", sessionToken: null, query: {}, cacheable: true });
    return renderToStaticMarkup(el as any);
}

/** The gallery subtree only (its root div through the end of its thumbnail row), without the hoisted preload links. */
const withoutPreloads = (html: string) => html.replace(/<link rel="preload" as="image" href="[^"]*"\/>/g, "");
const THUMBNAIL_ROW = '<div class="grid grid-cols-5 gap-2">';

const BASE = { id: "p1", slug: "rug", title: "Rug", status: "active", categoryIds: [], personalizations: [], attributes: [] };
const IMPORTED = {
    ...BASE, imageLink: "https://img.test/red.jpg",
    additionalImageLinks: ["https://img.test/blue-1.jpg", "https://img.test/blue-2.jpg"],                   // deriveGallery's output
    variants: [{ id: "color", name: "Color", options: [
        { value: "red", imageLink: "https://img.test/red.jpg" },
        { value: "blue", imageLink: "https://img.test/blue-1.jpg", additionalImageLinks: ["https://img.test/blue-2.jpg"] },
    ] }],
};

beforeEach(() => {
    for (const fn of Object.values(dynamo)) (fn as any).mockReset?.();
    dynamo.getAllCategories.mockResolvedValue([]);
    dynamo.getProductReviews.mockResolvedValue({ items: [], averageRating: 0, totalReviews: 0 });
});

describe("[cvg1-server] ProductImageGallery without the new props: the markup before the slice (rule 8)", () => {
    for (const [name, props] of Object.entries(CASES)) {
        it(`[cvg1-server] ${name}: byte-identical to the 27fa7ca capture`, () => {
            expect(renderToStaticMarkup(createElement(ProductImageGallery, props))).toBe((BEFORE as Record<string, string>)[name]);
        });
    }

    it("[cvg1-server] a commerce product page holds the gallery markup of before, unchanged and unpinned", async () => {
        const html = await productPage(tenant(), {
            ...BASE, price: "10", currency: "USD", availability: "in_stock",
            imageLink: CASES.threePictures.mainImage, additionalImageLinks: CASES.threePictures.additionalImages,
            // Variants with pictures, as an imported product could carry: a commerce page must not use them as a picker.
            variants: IMPORTED.variants,
        });
        expect(withoutPreloads(html)).toContain(withoutPreloads(BEFORE.threePictures));
        expect(html).not.toContain("md:sticky");
    });
});

describe("[cvg1-server] catalog product page (rules 1, 5, 6)", () => {
    it("[cvg1-server] with picture options: the preview is the product imageLink, no whole-gallery thumbnail row, pinned from md up", async () => {
        const html = await productPage(catalogTenant(), IMPORTED);
        expect(html).toContain('<div class="space-y-3 md:sticky md:self-start" style="top:calc(5rem + 1px)"><div class="aspect-square bg-muted rounded-lg overflow-hidden relative group"><img src="https://img.test/red.jpg" alt="Rug"');
        expect(html).not.toContain(THUMBNAIL_ROW);
        // The presenter (the picker) is still the server-rendered radio group of before.
        expect(html.match(/<input type="radio"[^>]* name="catalog-option-color"/g)).toHaveLength(2);
    });

    it("[cvg1-server] without options: the gallery's own thumbnail row stays (its only picker), pinned from md up", async () => {
        const html = await productPage(catalogTenant(), { ...BASE, imageLink: "https://img.test/a.jpg", additionalImageLinks: ["https://img.test/b.jpg"], variants: [] });
        expect(html).toContain('<div class="space-y-3 md:sticky md:self-start" style="top:calc(5rem + 1px)">');
        expect(html).toContain(THUMBNAIL_ROW);
    });
});
