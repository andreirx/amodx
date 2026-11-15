import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { URL_PREFIX_DEFAULTS, urlPrefixesOf } from "@amodx/shared";

/**
 * SHOP-LOOK-1C (docs/slices/shop-look-1c.md; design docs/slices/shop-look-1.md § 6.3, § 6.4) — the server pass
 * (`prepareBlocks` in `SitePage.tsx`) for the `categoryGrid` block, through the real `SitePage` (server render).
 *
 * The read is the REAL `getActiveCategoriesByIds` (`renderer/src/lib/dynamo.ts`), wrapped in a spy that counts helper
 * calls; under it only the DynamoDB document client is replaced, by the stub of `shop-look-1a-read.test.ts` (an exact-key
 * `GetCommand` answered from stored items, the `ProjectionExpression` applied; any other command throws). So one test
 * counts both units of § 6.4: helper calls and DynamoDB requests. Every other read of `@/lib/dynamo` is a mock; Next's
 * runtime-coupled modules, `CommentsSection` and `RenderBlocks` (a probe that prints its props) are mocked as in
 * `category-content-1.test.ts`.
 */

const store = vi.hoisted(() => ({ items: [] as Record<string, unknown>[], calls: [] as { name: string; input: any }[], ignoreProjection: false }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    const project = (item: Record<string, unknown>, expression: string, names: Record<string, string>) =>
        Object.fromEntries(expression.split(",").map((s) => s.trim()).map((raw) => (raw.startsWith("#") ? names[raw] : raw))
            .filter((name) => Object.hasOwn(item, name)).map((name) => [name, item[name]]));
    return {
        ...real,
        DynamoDBDocumentClient: {
            from: () => ({
                send: async (c: any) => {
                    store.calls.push({ name: c.constructor.name, input: c.input });
                    if (c.constructor.name !== "GetCommand") throw new Error(`unmodelled ${c.constructor.name}`);
                    const item = store.items.find((i) => i.PK === c.input.Key.PK && i.SK === c.input.Key.SK);
                    if (!item) return {};
                    return { Item: store.ignoreProjection ? { ...item } : project(item, c.input.ProjectionExpression, c.input.ExpressionAttributeNames) };
                },
            }),
        },
    };
});

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(async (..._args: unknown[]) => null as any), getPosts: vi.fn(async () => []),
    getDeliveryConfig: vi.fn(async () => null), getProductBySlug: vi.fn(async (..._args: unknown[]) => null),
    getCategoryBySlug: vi.fn(), getProductsByCategory: vi.fn(async () => ({ items: [], total: 0 })), getAllCategories: vi.fn(async () => []),
    getActiveProducts: vi.fn(), getCatalogListing: vi.fn(async () => []), searchProducts: vi.fn(), getOrderForCustomer: vi.fn(async () => null),
    getProductReviews: vi.fn(), getSiteReviews: vi.fn(), getProductById: vi.fn(), hasActivePopups: vi.fn(async () => false),
}));
vi.mock("@/lib/dynamo", async (importOriginal) => {
    const real: any = await importOriginal();
    return { ...dynamo, getActiveCategoriesByIds: vi.fn(real.getActiveCategoriesByIds) };
});
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
import { getActiveCategoriesByIds } from "@/lib/dynamo";
const readSpy = getActiveCategoriesByIds as unknown as ReturnType<typeof vi.fn>;

const KINDS = {
    content: { commerceEnabled: false, catalogMode: false },
    commerce: { commerceEnabled: true, catalogMode: false },
    catalog: { commerceEnabled: false, catalogMode: true },
} as const;
type Kind = keyof typeof KINDS;

const category = (id: string, extra: Record<string, unknown> = {}) => ({
    PK: "TENANT#t1", SK: `CATEGORY#${id}`, TenantSlug: `t1#${id}-slug`, id, tenantId: "t1", name: `Name ${id}`, slug: `${id}-slug`,
    description: `About ${id}`, imageLink: `https://img.test/${id}.jpg`, status: "active", sortOrder: 1, productCount: 3, seoTitle: "SEO", ...extra,
});
/** A tile as the pass gives it, on the default category path. */
const tile = (id: string, prefix: string = URL_PREFIX_DEFAULTS.category) =>
    ({ id, name: `Name ${id}`, description: `About ${id}`, imageLink: `https://img.test/${id}.jpg`, path: `${prefix}/${id}-slug` });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);
const GRID = (attrs: Record<string, unknown>) => ({ type: "categoryGrid", attrs: { eyebrow: "", headline: "Shop", columns: "4", ctaText: "", chips: [], blockWidth: "content", ...attrs } });
const HERO = { type: "hero", attrs: { headline: "Floors", style: "center", ctaText: "Shop", ctaLink: "/shop" } };
const PARAGRAPH = { type: "paragraph", content: [{ type: "text", text: "Hello." }] };

function tenant(kind: Kind = "commerce", extra: Record<string, unknown> = {}) {
    return {
        id: "t1", name: "Site", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: urlPrefixesOf(undefined), locale: "en-US", ...KINDS[kind], ...extra,
    };
}

const decoded = (html: string) => html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** The blocks the server pass gave `RenderBlocks` on the content page `/about`, for a tenant with `blocks`. */
async function preparedBlocks(blocks: unknown[], config = tenant()): Promise<any[]> {
    dynamo.getTenantConfig.mockResolvedValue(config);
    dynamo.getContentBySlug.mockImplementation(async () => ({
        id: "n1", nodeId: "n1", slug: "/about", title: "About", status: "Published", accessPolicy: { type: "Public" },
        commentsMode: "Hidden", hideSharing: true, blocks: structuredClone(blocks),
    }));
    const html = renderToStaticMarkup((await SitePage({ siteId: "t1", slug: ["about"], preview: false, basePath: "", sessionToken: null, query: {}, cacheable: true })) as any);
    const m = html.match(/<render-blocks-probe data-props="([^"]*)"/);
    if (!m) throw new Error("RenderBlocks not rendered");
    return JSON.parse(decoded(m[1])).blocks;
}
const gets = () => store.calls.filter((c) => c.name === "GetCommand");

beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "sl1c-unit";
    store.items = [...ids(13).map((id) => category(id)), category("hid", { status: "hidden" })];
    store.calls = [];
    store.ignoreProjection = false;
});
afterEach(() => { delete process.env.TABLE_NAME; });

describe("categoryGrid server pass — the read (§ 6.4)", () => {
    it("0 ids stored: no helper call, no GetCommand; `_categories` is [] (the block draws its header and chips only)", async () => {
        for (const categoryIds of [[], undefined, "c1", [" ", 7, null]]) {
            const [grid] = await preparedBlocks([GRID({ categoryIds })]);
            expect(grid.attrs._categories).toEqual([]);
        }
        expect(readSpy).not.toHaveBeenCalled();
        expect(gets()).toEqual([]);
    });

    it("1 id: one helper call, one GetCommand on TENANT#t1 / CATEGORY#<id>; the tile with its category path", async () => {
        const [grid] = await preparedBlocks([GRID({ categoryIds: ["c1"] })]);
        expect(grid.attrs._categories).toEqual([tile("c1")]);
        expect(readSpy).toHaveBeenCalledTimes(1);
        expect(readSpy).toHaveBeenCalledWith("t1", ["c1"]);
        expect(gets().map((c) => c.input.Key)).toEqual([{ PK: "TENANT#t1", SK: "CATEGORY#c1" }]);
    });

    it("12 ids: one helper call, 12 GetCommands (one per id); twelve tiles in the picked order", async () => {
        const order = ids(12).reverse();
        const [grid] = await preparedBlocks([GRID({ categoryIds: order })]);
        expect(grid.attrs._categories).toEqual(order.map((id) => tile(id)));
        expect(readSpy).toHaveBeenCalledTimes(1);
        expect(gets().map((c) => c.input.Key.SK)).toEqual(order.map((id) => `CATEGORY#${id}`));
    });

    it("a stored 13th id (the schema refuses it; the backend does not check blocks): not read and not drawn — the first 12 only", async () => {
        const [grid] = await preparedBlocks([GRID({ categoryIds: ids(13) })]);
        expect(readSpy).toHaveBeenCalledWith("t1", ids(12));
        expect(gets()).toHaveLength(12);
        expect(grid.attrs._categories.map((t: any) => t.id)).toEqual(ids(12));
    });

    it("a hidden category and an id of no category are skipped; the others keep their order (each id still costs one GetCommand)", async () => {
        const [grid] = await preparedBlocks([GRID({ categoryIds: ["c3", "hid", "c1", "gone", "c2"] })]);
        expect(grid.attrs._categories.map((t: any) => t.id)).toEqual(["c3", "c1", "c2"]);
        expect(gets()).toHaveLength(5);
    });

    it("all ids hidden or missing: `_categories` is []", async () => {
        const [grid] = await preparedBlocks([GRID({ categoryIds: ["hid", "gone"] })]);
        expect(grid.attrs._categories).toEqual([]);
    });

    it("a category without a photo or a description: the tile has no such key (the render draws no element for it)", async () => {
        store.items.push({ PK: "TENANT#t1", SK: "CATEGORY#bare", id: "bare", name: "Bare", slug: "bare", status: "active" });
        const [grid] = await preparedBlocks([GRID({ categoryIds: ["bare"] })]);
        expect(grid.attrs._categories).toEqual([{ id: "bare", name: "Bare", path: `${URL_PREFIX_DEFAULTS.category}/bare` }]);
    });

    it("one helper call PER BLOCK: two grids → two calls; a page without the block → no call", async () => {
        await preparedBlocks([GRID({ categoryIds: ["c1", "c2"] }), PARAGRAPH, GRID({ categoryIds: ["c3"] })]);
        expect(readSpy).toHaveBeenCalledTimes(2);
        expect(gets()).toHaveLength(3);
        vi.clearAllMocks(); store.calls = [];
        await preparedBlocks([PARAGRAPH, HERO]);
        expect(readSpy).not.toHaveBeenCalled();
        expect(gets()).toEqual([]);
    });
});

describe("categoryGrid server pass — the link and the payload (§ 6.3)", () => {
    it("the tile path is the tenant's own category path: the default, and a custom prefix", async () => {
        expect((await preparedBlocks([GRID({ categoryIds: ["c1"] })]))[0].attrs._categories[0].path).toBe("/category/c1-slug");
        const custom = tenant("commerce", { urlPrefixes: urlPrefixesOf({ category: "/colectii" }) });
        expect((await preparedBlocks([GRID({ categoryIds: ["c1"] })], custom))[0].attrs._categories[0].path).toBe("/colectii/c1-slug");
        // A tenant item without `urlPrefixes` (mapTenant always sets it; defensive): the default path.
        const none = { ...tenant(), urlPrefixes: undefined };
        expect((await preparedBlocks([GRID({ categoryIds: ["c1"] })], none as any))[0].attrs._categories[0].path).toBe("/category/c1-slug");
    });

    it("only the grid's attrs change, by exactly one key (`_categories`); every other block reaches RenderBlocks as stored", async () => {
        const grid = GRID({ categoryIds: ["c1"], eyebrow: "Rooms", chips: [{ label: "Oak", href: "/oak" }] });
        const prepared = await preparedBlocks([PARAGRAPH, HERO, grid]);
        expect(prepared[0]).toEqual(PARAGRAPH);
        expect(prepared[1]).toEqual(HERO);
        const { _categories, ...rest } = prepared[2].attrs;
        expect(rest).toEqual(grid.attrs);
        expect(_categories).toEqual([tile("c1")]);
    });

    it("the tile carries only its display fields and the path, whatever the read returns (a stub that ignores the projection, as the serving stub does)", async () => {
        store.ignoreProjection = true;
        const [grid] = await preparedBlocks([GRID({ categoryIds: ["c1"] })]);
        expect(grid.attrs._categories).toEqual([tile("c1")]);
        expect(Object.keys(grid.attrs._categories[0])).toEqual(["id", "name", "description", "imageLink", "path"]);
    });

    it("drawn on every site kind (content, commerce, catalog): the same tiles; the renderer does not gate the block by kind", async () => {
        for (const kind of Object.keys(KINDS) as Kind[]) {
            const [grid] = await preparedBlocks([GRID({ categoryIds: ["c2", "c1"] })], tenant(kind));
            expect(grid.attrs._categories, kind).toEqual([tile("c2"), tile("c1")]);
        }
    });

    it("on a category page (CATEGORY-CONTENT-1): the category's own blocks get the same pass", async () => {
        dynamo.getTenantConfig.mockResolvedValue(tenant("commerce"));
        dynamo.getCategoryBySlug.mockImplementation(async (_t: string, slug: string) =>
            slug === "boen" ? { id: "boen", tenantId: "t1", name: "Boen", slug: "boen", status: "active", blocks: [GRID({ categoryIds: ["c1"] })] } : null);
        const el: any = await SitePage({ siteId: "t1", slug: ["category", "boen"], preview: false, basePath: "", sessionToken: null, query: {}, cacheable: true });
        const html = renderToStaticMarkup(el);
        const m = html.match(/<render-blocks-probe data-props="([^"]*)"/);
        expect(m).not.toBeNull();
        expect(JSON.parse(decoded(m![1])).blocks[0].attrs._categories).toEqual([tile("c1")]);
        expect(readSpy).toHaveBeenCalledTimes(1);
    });
});
