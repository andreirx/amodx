import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { URL_PREFIX_DEFAULTS, urlPrefixesOf } from "@amodx/shared";

/**
 * CATEGORY-CONTENT-1 (docs/slices/category-content-1.md) — a category's own blocks on the category page, through the
 * real `SitePage` (server render), for the three site kinds:
 *   - where: between the title block and the filters / product list, on page 1, page 2 and a filter state;
 *   - how: `RenderBlocks` (a probe here, which prints its props) with no width props, the tenant's block texts and the
 *     catalog-mode rule; the blocks first get the content page's preparation pass (`prepareBlocks`), so a block that needs
 *     server data has it, exactly as on a content page;
 *   - absence: `blocks` absent, `[]` or not an array → the element tree of the page is the one without blocks (no extra
 *     child, no read, no error).
 * Byte identity against the base commit is the serving contract's job (rows `cm1-*`, `loc1-*`, `cc1-*`).
 * Mocked: the DynamoDB reads (`@/lib/dynamo`), Next's runtime-coupled modules, `RenderBlocks` and `CommentsSection`.
 */

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(async (..._args: unknown[]) => null as any), getPosts: vi.fn(),
    getDeliveryConfig: vi.fn(async () => null), getProductBySlug: vi.fn(async (..._args: unknown[]) => null),
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
// The content page (the comparison of the second row) also draws the comments section, which needs a session context.
vi.mock("@/components/CommentsSection", () => ({ CommentsSection: () => null }));
vi.mock("@/components/RenderBlocks", () => ({
    RenderBlocks: (props: any) => (globalThis as any).__react.createElement("render-blocks-probe", { "data-props": JSON.stringify(props) }),
}));

import { SitePage } from "@/components/SitePage";

const KINDS = {
    content: { commerceEnabled: false, catalogMode: false },
    commerce: { commerceEnabled: true, catalogMode: false },
    catalog: { commerceEnabled: false, catalogMode: true },
} as const;
type Kind = keyof typeof KINDS;

function tenant(kind: Kind) {
    return {
        id: "t1", name: "Site", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: urlPrefixesOf(undefined), locale: "ro-RO", ...KINDS[kind],
    };
}

const PARAGRAPH = { type: "paragraph", content: [{ type: "text", text: "Boen makes floors." }] };
/** A block that needs the preparation pass: the showcase reads its category's products on the server. */
const SHOWCASE = () => ({ type: "categoryShowcase", attrs: { categorySlug: "rugs", categoryName: "Rugs", limit: 2, columns: "4", showPrice: true, ctaText: "All" } });
/** A second one: the post grid reads the tenant's posts on the server. */
const POST_GRID = () => ({ type: "postGrid", attrs: { limit: 2 } });

const PRODUCT = (n: number) => ({
    id: `p${n}`, title: `Plank ${n}`, slug: `plank-${n}`, status: "active", price: "10.00", currency: "USD", availability: "in_stock",
    imageLink: `https://img.test/${n}.jpg`, volumePricing: [], categoryIds: ["boen"], brand: "BOEN",
    attributes: [{ key: "Wood", value: n % 2 ? "Oak" : "Ash" }],
});
const PRODUCTS = Array.from({ length: 30 }, (_, i) => PRODUCT(i + 1));
const RUGS = [{ id: "r1", title: "Rug", slug: "rug", price: "50.00", currency: "USD", availability: "out_of_stock", imageLink: "https://img.test/r.jpg", volumePricing: [] }];

function category(blocks?: unknown) {
    const c: Record<string, unknown> = { id: "boen", tenantId: "t1", name: "Boen", slug: "boen", description: "Plain text.", status: "active" };
    if (blocks !== undefined) c.blocks = blocks;
    return c;
}

beforeEach(() => {
    vi.clearAllMocks();
    dynamo.getCatalogListing.mockImplementation(async () => structuredClone(PRODUCTS));
    dynamo.getProductsByCategory.mockImplementation(async (_t: string, categoryId: string, page: number, limit: number) =>
        categoryId === "rugs" ? { items: structuredClone(RUGS).slice(0, limit), total: 1 } : { items: structuredClone(PRODUCTS).slice((page - 1) * limit, page * limit), total: PRODUCTS.length });
    dynamo.getPosts.mockImplementation(async () => [{ id: "post-1", title: "News", slug: "/news" }]);
});

/** The category's lookup answers `boen` with the given blocks; the showcase's lookup answers `rugs`. */
function serve(kind: Kind, blocks?: unknown) {
    dynamo.getTenantConfig.mockResolvedValue(tenant(kind));
    dynamo.getCategoryBySlug.mockImplementation(async (_t: string, slug: string) =>
        slug === "boen" ? category(structuredClone(blocks)) : slug === "rugs" ? { id: "rugs", slug: "rugs", name: "Rugs" } : null);
}

async function element(path: string, query: Record<string, string> = {}) {
    return SitePage({ siteId: "t1", slug: path.replace(/^\//, "").split("/"), preview: false, basePath: "", sessionToken: null, query, cacheable: true });
}
/** The category view's own tree (SitePage answers `<CategoryPageView …/>`; the view is a synchronous function). */
function viewTree(el: any) {
    expect(typeof el.type).toBe("function");
    return el.type(el.props);
}
/** The children of the page's `<main>` in the view tree. */
function mainChildren(view: any): any[] {
    const main = React.Children.toArray(view.props.children).find((c: any) => c.type === "main") as any;
    return main.props.children;
}
const decoded = (html: string) => html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
function probeProps(html: string) {
    const m = html.match(/<render-blocks-probe data-props="([^"]*)"/g) ?? [];
    return m.map((tag) => JSON.parse(decoded(tag.match(/data-props="([^"]*)"/)![1])));
}

describe("no blocks: the page is the page without blocks (rule 3)", () => {
    for (const kind of Object.keys(KINDS) as Kind[]) {
        for (const [label, blocks] of [["absent", undefined], ["[]", []], ["not an array (string)", "<h2>x</h2>"], ["not an array (object)", { type: "paragraph" }]] as const) {
            it(`[${kind}] blocks ${label}: same element tree and markup as absent; no probe, no extra read`, async () => {
                serve(kind);
                const baseEl = await element(`${URL_PREFIX_DEFAULTS.category}/boen`);
                const baseView = viewTree(baseEl);
                const baseReads = [dynamo.getCategoryBySlug.mock.calls.length, dynamo.getPosts.mock.calls.length, dynamo.getProductsByCategory.mock.calls.length];
                vi.clearAllMocks();
                serve(kind, blocks);
                const el = await element(`${URL_PREFIX_DEFAULTS.category}/boen`);
                const view = viewTree(el);
                // The <main> keeps its four children: breadcrumb, the title block (a <div>, not a fragment), the listing, the pager.
                const children = mainChildren(view);
                expect(children).toHaveLength(4);
                expect(children[1].type).toBe("div");
                expect(children[1].props.className).toBe("mb-8");
                expect(renderToStaticMarkup(el as any)).toBe(renderToStaticMarkup(baseEl as any));
                expect(renderToStaticMarkup(el as any)).not.toContain("render-blocks-probe");
                expect([dynamo.getCategoryBySlug.mock.calls.length, dynamo.getPosts.mock.calls.length, dynamo.getProductsByCategory.mock.calls.length]).toEqual(baseReads);
                expect(mainChildren(baseView)).toHaveLength(4);
            });
        }
    }
});

describe("valid blocks: drawn between the title block and the listing, prepared as on a content page (rule 2)", () => {
    for (const kind of Object.keys(KINDS) as Kind[]) {
        it(`[${kind}] a paragraph + a showcase + a post grid: one RenderBlocks after the product count and before the grid, every page and filter state`, async () => {
            const blocks = [PARAGRAPH, SHOWCASE(), POST_GRID()];
            const queries: Record<string, string>[] = [{}, { page: "2" }, ...(kind === "catalog" ? [{ f: "a.Wood:Oak" }, { f: "a.Wood:Oak", page: "2" }] : [])];
            for (const query of queries) {
                serve(kind, blocks);
                const html = renderToStaticMarkup((await element(`${URL_PREFIX_DEFAULTS.category}/boen`, query)) as any);
                const props = probeProps(html);
                expect(props, JSON.stringify(query)).toHaveLength(1);
                // Order: title block, then the content, then the listing (the first product card link) and the pager.
                const at = (s: string) => { const i = html.indexOf(s); expect(i, `${s} in ${JSON.stringify(query)}`).toBeGreaterThanOrEqual(0); return i; };
                const content = at('<div class="mb-8" data-category-content="true"><render-blocks-probe');
                expect(at("<h1")).toBeLessThan(content);
                expect(at("Plain text.")).toBeLessThan(content);
                expect(content).toBeLessThan(at('href="/product/plank-'));
                if (kind === "catalog") expect(content).toBeLessThan(at("data-facet-panel"));
                // No width props: the blocks take the category page's container width.
                expect(Object.keys(props[0]).sort()).toEqual(["basePath", "blocks", "strings", "tenantId"]);
                expect(props[0].tenantId).toBe("t1");
                expect(props[0].blocks[0]).toEqual(PARAGRAPH);
            }
        });

        it(`[${kind}] the blocks, their prepared attrs and the texts equal what a content page with the same blocks gives RenderBlocks`, async () => {
            serve(kind, [PARAGRAPH, SHOWCASE(), POST_GRID()]);
            const onCategory = probeProps(renderToStaticMarkup((await element(`${URL_PREFIX_DEFAULTS.category}/boen`)) as any))[0];
            dynamo.getContentBySlug.mockImplementation(async () => ({
                id: "n1", nodeId: "n1", slug: "/about", title: "About", status: "Published", accessPolicy: { type: "Public" },
                commentsMode: "Hidden", hideSharing: true, blocks: [PARAGRAPH, SHOWCASE(), POST_GRID()],
            }));
            const onPage = probeProps(renderToStaticMarkup((await element("/about")) as any))[0];
            expect(onCategory.blocks).toEqual(onPage.blocks);
            expect(onCategory.strings).toEqual(onPage.strings);
            // The preparation ran: the showcase holds its products, the grid its posts.
            const showcase = onCategory.blocks[1].attrs;
            expect(showcase.prefetchedProducts.map((p: any) => p.id)).toEqual(["r1"]);
            expect(showcase._productPrefix).toBe(URL_PREFIX_DEFAULTS.product);
            expect(onCategory.blocks[2].attrs.prefetchedPosts).toEqual([{ id: "post-1", title: "News", slug: "/news" }]);
            // The catalog-mode rule: on a catalog site the showcase products keep display fields only and the stock text is
            // not in the block texts; on the other sites both are as on their content pages.
            if (kind === "catalog") {
                expect(showcase._catalogMode).toBe(true);
                expect(showcase.prefetchedProducts).toEqual([{ id: "r1", title: "Rug", slug: "rug", imageLink: "https://img.test/r.jpg" }]);
                expect(Object.hasOwn(onCategory.strings, "outOfStock")).toBe(false);
            } else {
                expect(Object.hasOwn(showcase, "_catalogMode")).toBe(false);
                expect(showcase.prefetchedProducts[0].price).toBe("50.00");
                expect(Object.hasOwn(onCategory.strings, "outOfStock")).toBe(true);
            }
            // The tenant's language (ro-RO): the block texts are the Romanian ones, as on the content page.
            expect(onCategory.strings.dateLocale).toBe("ro-RO");
        });
    }

    it("the element tree with blocks: the title block and the content are one fragment in the title block's place", async () => {
        serve("commerce", [PARAGRAPH]);
        const children = mainChildren(viewTree(await element(`${URL_PREFIX_DEFAULTS.category}/boen`)));
        expect(children).toHaveLength(4);
        expect(children[1].type).toBe(React.Fragment);
    });
});
