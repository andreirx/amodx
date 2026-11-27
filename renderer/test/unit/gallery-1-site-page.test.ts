import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LANGUAGE_PACKS, galleryTexts, resolveLocaleStrings, urlPrefixesOf } from "@amodx/shared";

/**
 * GALLERY-1 (docs/slices/gallery-1.md, ruling 2) — the server pass (`prepareBlocks` in `SitePage.tsx`) for the `gallery`
 * block, through the real `SitePage` (server render): the block's attrs gain `_gallery` = `galleryTexts` of the tenant's
 * locale table in the PAGE's language (the tenant's default language, or an extra language from the page's address,
 * LANG-1B); the stored photos are passed on as stored; no read is made for the block; a stored block without attrs is
 * skipped. Every read of `@/lib/dynamo` is a mock; Next's runtime-coupled modules, `CommentsSection` and `RenderBlocks`
 * (a probe that prints its props) are mocked as in `shop-look-1c-grid.test.ts`.
 */

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(async (..._args: unknown[]) => null as any), getPosts: vi.fn(async () => []),
    getDeliveryConfig: vi.fn(async () => null), getProductBySlug: vi.fn(async (..._args: unknown[]) => null),
    getCategoryBySlug: vi.fn(), getProductsByCategory: vi.fn(async () => ({ items: [], total: 0 })), getAllCategories: vi.fn(async () => []),
    getActiveProducts: vi.fn(), getCatalogListing: vi.fn(async () => []), searchProducts: vi.fn(), getOrderForCustomer: vi.fn(async () => null),
    getProductReviews: vi.fn(), getSiteReviews: vi.fn(), getProductById: vi.fn(), hasActivePopups: vi.fn(async () => false),
    getActiveCategoriesByIds: vi.fn(async () => []), getFormBySlug: vi.fn(async () => null),
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

const ITEMS = [{ src: "https://img.test/a.jpg", thumb: "https://img.test/a-t.jpg", alt: "Garden", width: 1600, height: 1200 }, { src: "javascript:alert(1)" }];
const GALLERY = { type: "gallery", attrs: { items: ITEMS, columns: "3", blockWidth: "wide" } };
const PARAGRAPH = { type: "paragraph", content: [{ type: "text", text: "Hello." }] };

function tenant(extra: Record<string, unknown> = {}) {
    return {
        id: "t1", name: "Site", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: urlPrefixesOf(undefined), locale: "en-US", commerceEnabled: false, catalogMode: false, ...extra,
    };
}
const decoded = (html: string) => html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** The blocks the server pass gave `RenderBlocks` on the content page `slug`, for a tenant with `blocks`. */
async function preparedBlocks(blocks: unknown[], config = tenant(), slug = ["about"]): Promise<any[]> {
    dynamo.getTenantConfig.mockResolvedValue(config);
    dynamo.getContentBySlug.mockImplementation(async () => ({
        id: "n1", nodeId: "n1", slug: `/${slug.join("/")}`, title: "About", status: "Published", accessPolicy: { type: "Public" },
        commentsMode: "Hidden", hideSharing: true, blocks: structuredClone(blocks),
    }));
    const html = renderToStaticMarkup((await SitePage({ siteId: "t1", slug, preview: false, basePath: "", sessionToken: null, query: {}, cacheable: true })) as any);
    const m = html.match(/<render-blocks-probe data-props="([^"]*)"/);
    if (!m) throw new Error("RenderBlocks not rendered");
    return JSON.parse(decoded(m[1])).blocks;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("gallery server pass (ruling 2)", () => {
    it("en-US tenant: `_gallery` = the English gallery texts; the stored photos and fields are passed on as stored; the paragraph gains nothing; no read for the block", async () => {
        const [paragraph, gallery] = await preparedBlocks([PARAGRAPH, GALLERY]);
        expect(gallery.attrs).toEqual({ ...GALLERY.attrs, _gallery: galleryTexts(resolveLocaleStrings({ locale: "en-US" })) });
        expect(gallery.attrs._gallery.counter).toBe("{n} of {total}");
        expect(paragraph).toEqual(PARAGRAPH);
        for (const read of [dynamo.getActiveCategoriesByIds, dynamo.getFormBySlug, dynamo.getPosts, dynamo.getSiteReviews, dynamo.getProductReviews]) expect(read).not.toHaveBeenCalled();
    });

    it("ro-RO tenant: the Romanian texts, with the tenant's own override over the pack and a blank override giving the pack's text", async () => {
        const config = tenant({ locale: "ro-RO", siteStrings: { galleryClose: "Gata", galleryNext: " " } });
        const [gallery] = await preparedBlocks([GALLERY], config);
        expect(gallery.attrs._gallery).toEqual({ ...galleryTexts(resolveLocaleStrings({ locale: "ro-RO" })), close: "Gata" });
        expect(gallery.attrs._gallery.next).toBe(LANGUAGE_PACKS.ro.site.galleryNext);
    });

    it("a page in an extra language (LANG-1B: `/de/…` on a tenant whose languages hold `de`): the German texts", async () => {
        const [gallery] = await preparedBlocks([GALLERY], tenant({ languages: ["de"] }), ["de", "zimmer"]);
        expect(gallery.attrs._gallery).toEqual(galleryTexts(resolveLocaleStrings({ locale: "de" })));
        expect(gallery.attrs._gallery.viewer).toBe(LANGUAGE_PACKS.de.site.galleryViewer);
    });

    it("a stored gallery block without attrs (a tool can write `{ type }` alone): skipped, the page still renders", async () => {
        const blocks = await preparedBlocks([{ type: "gallery" }, { type: "gallery", attrs: null }, PARAGRAPH]);
        expect(blocks).toEqual([{ type: "gallery" }, { type: "gallery", attrs: null }, PARAGRAPH]);
    });
});
