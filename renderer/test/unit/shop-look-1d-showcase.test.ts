import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { urlPrefixesOf } from "@amodx/shared";

/**
 * SHOP-LOOK-1D (docs/slices/shop-look-1d.md; design docs/slices/shop-look-1.md § 6.3 rule 3, § 6.4, § 7) — the server
 * pass (`prepareBlocks` → `withShowcaseCardData` in `SitePage.tsx`) for the `categoryShowcase` card options, through the
 * real `SitePage` (server render).
 *
 * The three reads are the REAL helpers of `renderer/src/lib/dynamo.ts` — `getAllCategories`, `getProductById`,
 * `getProductReviews` — each wrapped in a spy that counts helper calls. Under them only the DynamoDB document client is
 * replaced, by a stub that models what the two units of § 6.4 depend on:
 * - `GetCommand`: an exact-key item from the store (or none).
 * - `QueryCommand` `PK = :pk AND begins_with(SK, :sk)`: the matching items in SK order, cut into pages of `pageSize`
 *   items BEFORE the `FilterExpression` (`#s = :value`, the form both paginating helpers send) is applied — as DynamoDB
 *   ends a page by the items it READ — so a page can hold zero items after the filter and still carry a
 *   `LastEvaluatedKey`. The `ProjectionExpression` is applied.
 * Any other command throws. So one test counts helper calls and DynamoDB requests. The category and its CATPROD# cards
 * (`getCategoryBySlug`, `getProductsByCategory`) and every other read are mocks; Next's runtime-coupled modules,
 * `CommentsSection` and `RenderBlocks` (a probe that prints its props) are mocked as in `shop-look-1c-grid.test.ts`.
 */

type Item = Record<string, any>;
const store = vi.hoisted(() => ({ items: [] as Item[], calls: [] as { name: string; input: any }[], pageSize: 100 }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    const project = (item: Item, expression: string | undefined, names: Record<string, string> | undefined) => {
        if (!expression) return { ...item };
        return Object.fromEntries(expression.split(",").map((s) => s.trim()).map((raw) => (raw.startsWith("#") ? names![raw] : raw))
            .filter((name) => Object.hasOwn(item, name)).map((name) => [name, item[name]]));
    };
    return {
        ...real,
        DynamoDBDocumentClient: {
            from: () => ({
                send: async (c: any) => {
                    const input = c.input;
                    store.calls.push({ name: c.constructor.name, input });
                    if (c.constructor.name === "GetCommand") {
                        const item = store.items.find((i) => i.PK === input.Key.PK && i.SK === input.Key.SK);
                        return item ? { Item: project(item, input.ProjectionExpression, input.ExpressionAttributeNames) } : {};
                    }
                    if (c.constructor.name !== "QueryCommand" || input.KeyConditionExpression !== "PK = :pk AND begins_with(SK, :sk)" || input.FilterExpression !== "#s = :active" && input.FilterExpression !== "#s = :approved") {
                        throw new Error(`unmodelled ${c.constructor.name} ${JSON.stringify(input)}`);
                    }
                    const values = input.ExpressionAttributeValues;
                    const wanted = values[":active"] ?? values[":approved"];
                    const matching = store.items.filter((i) => i.PK === values[":pk"] && i.SK.startsWith(values[":sk"])).sort((a, b) => (a.SK < b.SK ? -1 : 1));
                    const start = input.ExclusiveStartKey ? matching.findIndex((i) => i.SK === input.ExclusiveStartKey.SK) + 1 : 0;
                    const page = matching.slice(start, start + store.pageSize);
                    const more = start + store.pageSize < matching.length;
                    return {
                        Items: page.filter((i) => i.status === wanted).map((i) => project(i, input.ProjectionExpression, input.ExpressionAttributeNames)),
                        ...(more ? { LastEvaluatedKey: { PK: page[page.length - 1].PK, SK: page[page.length - 1].SK } } : {}),
                    };
                },
            }),
        },
    };
});

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(async (..._args: unknown[]) => null as any), getPosts: vi.fn(async () => []),
    getDeliveryConfig: vi.fn(async () => null), getProductBySlug: vi.fn(async (..._args: unknown[]) => null),
    getCategoryBySlug: vi.fn(), getProductsByCategory: vi.fn(), getActiveProducts: vi.fn(), getCatalogListing: vi.fn(async () => []),
    searchProducts: vi.fn(), getOrderForCustomer: vi.fn(async () => null), getSiteReviews: vi.fn(), getActiveCategoriesByIds: vi.fn(async () => []),
    hasActivePopups: vi.fn(async () => false),
}));
vi.mock("@/lib/dynamo", async (importOriginal) => {
    const real: any = await importOriginal();
    return {
        ...dynamo,
        getAllCategories: vi.fn(real.getAllCategories),
        getProductById: vi.fn(real.getProductById),
        getProductReviews: vi.fn(real.getProductReviews),
    };
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
import { getAllCategories, getProductById, getProductReviews } from "@/lib/dynamo";
const categoriesSpy = getAllCategories as unknown as ReturnType<typeof vi.fn>;
const productSpy = getProductById as unknown as ReturnType<typeof vi.fn>;
const reviewsSpy = getProductReviews as unknown as ReturnType<typeof vi.fn>;

const KINDS = {
    content: { commerceEnabled: false, catalogMode: false },
    commerce: { commerceEnabled: true, catalogMode: false },
    catalog: { commerceEnabled: false, catalogMode: true },
} as const;
type Kind = keyof typeof KINDS;
function tenant(kind: Kind = "commerce", extra: Record<string, unknown> = {}) {
    return {
        id: "t1", name: "Site", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: urlPrefixesOf(undefined), locale: "en-US", currency: "USD", ...KINDS[kind], ...extra,
    };
}

/** A CATPROD# card item, as `getProductsByCategory` returns it (key fields included). */
const card = (id: string, categoryIds: string[] = ["c1"], extra: Item = {}) => ({
    PK: "TENANT#t1", SK: `CATPROD#c1#${id}`, id, title: `Title ${id}`, slug: `${id}-slug`, price: "10.00", currency: "USD",
    availability: "in_stock", status: "active", sortOrder: 0, tags: [], volumePricing: [], categoryIds, ...extra,
});
const category = (id: string, status = "active") => ({ PK: "TENANT#t1", SK: `CATEGORY#${id}`, id, name: `Name ${id}`, slug: `${id}-slug`, status, sortOrder: 0 });
const product = (id: string, description?: unknown) => ({ PK: "TENANT#t1", SK: `PRODUCT#${id}`, id, title: `Title ${id}`, status: "active", ...(description !== undefined ? { description } : {}) });
const review = (productId: string, n: number, rating: number, status = "approved") =>
    ({ PK: "TENANT#t1", SK: `REVIEW#${productId}#r${String(n).padStart(2, "0")}`, id: `r${n}`, productId, rating, status, authorName: "A", content: "x", createdAt: `2026-01-${String(n).padStart(2, "0")}T00:00:00.000Z` });

const SHOWCASE = (attrs: Record<string, unknown> = {}) => ({ type: "categoryShowcase", attrs: { categoryId: "c1", categoryName: "Best", categorySlug: "best", limit: 4, columns: "4", showPrice: true, ctaText: "View all", blockWidth: "content", ...attrs } });
const PARAGRAPH = { type: "paragraph", content: [{ type: "text", text: "Hello." }] };

/** The HTML attribute's escapes undone — `&amp;` LAST, so a text that holds an escape (`&lt;`) is not decoded twice. */
const decoded = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
async function preparedBlocks(blocks: unknown[], config: any = tenant()): Promise<any[]> {
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
const sent = (name: string) => store.calls.filter((c) => c.name === name);
let cards: Item[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "sl1d-unit";
    store.calls = [];
    store.pageSize = 100;
    store.items = [category("c1"), category("c2"), category("hid", "hidden"), product("p1", "Solid oak."), product("p2"), product("p3", "<p>Ash</p>")];
    cards = [card("p1", ["c2", "c1"]), card("p2"), card("p3", ["hid", "c1"])];
    dynamo.getCategoryBySlug.mockImplementation(async (_t: string, slug: string) => (slug === "best" ? { id: "c1", slug: "best", name: "Best", status: "active" } : null));
    dynamo.getProductsByCategory.mockImplementation(async (_t: string, _c: string, _p: number, limit: number) => ({ items: structuredClone(cards.slice(0, limit)), total: cards.length }));
});
afterEach(() => { delete process.env.TABLE_NAME; });

describe("showcase card options — every option off: no read, today's attrs (§ 6.3 rule 3)", () => {
    it("absent, null and false: no helper call, no DynamoDB request; the products are the CATPROD# cards unchanged, the attrs keys are today's", async () => {
        for (const extra of [{}, { showCategoryLabel: null, showDescription: null, showRating: null, badgeTags: null, eyebrow: null }, { showCategoryLabel: false, showDescription: false, showRating: false }, { showCategoryLabel: "true", showRating: 1 }]) {
            const [block] = await preparedBlocks([SHOWCASE(extra)]);
            expect(block.attrs.prefetchedProducts).toEqual(cards);
            expect(Object.keys(block.attrs).sort()).toEqual([...Object.keys(SHOWCASE(extra).attrs), "prefetchedProducts", "_productPrefix", "_categoryPrefix"].sort());
        }
        expect(categoriesSpy).not.toHaveBeenCalled();
        expect(productSpy).not.toHaveBeenCalled();
        expect(reviewsSpy).not.toHaveBeenCalled();
        expect(store.calls).toEqual([]);
    });

    it("eyebrow and badgeTags need no read (the badge is drawn from the card's `tags`): no call, products unchanged", async () => {
        const [block] = await preparedBlocks([SHOWCASE({ eyebrow: "Picks", badgeTags: ["TOP PICK"] })]);
        expect(block.attrs.prefetchedProducts).toEqual(cards);
        expect(store.calls).toEqual([]);
    });
});

describe("showCategoryLabel — the first category's name (SL-D7)", () => {
    it("one getAllCategories call per block; `_categoryName` = the name of categoryIds[0]; a hidden or missing first category → no key", async () => {
        cards.push(card("p4", ["gone", "c1"]), card("p5", []));
        const [block] = await preparedBlocks([SHOWCASE({ showCategoryLabel: true, limit: 12 })]);
        const names = block.attrs.prefetchedProducts.map((p: any) => p._categoryName);
        // p1 in [c2, c1] → c2 (the first, not the showcased one); p2 → c1; p3 first = hidden → none; p4 first missing → none; p5 none
        expect(names).toEqual(["Name c2", "Name c1", undefined, undefined, undefined]);
        expect(categoriesSpy).toHaveBeenCalledTimes(1);
        expect(categoriesSpy).toHaveBeenCalledWith("t1");
        expect(sent("QueryCommand").map((c) => c.input.ExpressionAttributeValues[":sk"])).toEqual(["CATEGORY#"]);
        expect(sent("GetCommand")).toEqual([]);
        // only the one key is added; every other field of the card is unchanged
        const { _categoryName, ...rest } = block.attrs.prefetchedProducts[0];
        expect(rest).toEqual(cards[0]);
    });

    it("two result pages (the first holds no active category after the filter): both pages read, two requests", async () => {
        store.items = [category("a1", "hidden"), category("a2", "hidden"), category("c1"), category("c2"), ...store.items.filter((i) => !i.SK.startsWith("CATEGORY#"))];
        store.pageSize = 2;
        const [block] = await preparedBlocks([SHOWCASE({ showCategoryLabel: true })]);
        expect(block.attrs.prefetchedProducts.map((p: any) => p._categoryName)).toEqual(["Name c2", "Name c1", undefined]);
        const queries = sent("QueryCommand");
        expect(queries).toHaveLength(2);
        expect(queries[0].input.ExclusiveStartKey).toBeUndefined();
        expect(queries[1].input.ExclusiveStartKey).toEqual({ PK: "TENANT#t1", SK: "CATEGORY#a2" });
    });

    it("one call PER BLOCK: two showcases → two calls", async () => {
        await preparedBlocks([SHOWCASE({ showCategoryLabel: true }), PARAGRAPH, SHOWCASE({ showCategoryLabel: true })]);
        expect(categoriesSpy).toHaveBeenCalledTimes(2);
    });
});

describe("showDescription — the short text (§ 7.2)", () => {
    it("one getProductById (one GetCommand on TENANT#t1 / PRODUCT#<id>) per product; no description → no key", async () => {
        const [block] = await preparedBlocks([SHOWCASE({ showDescription: true })]);
        expect(block.attrs.prefetchedProducts.map((p: any) => p._descriptionText)).toEqual(["Solid oak.", undefined, "Ash"]);
        expect(productSpy).toHaveBeenCalledTimes(3);
        expect(sent("GetCommand").map((c) => c.input.Key)).toEqual(["p1", "p2", "p3"].map((id) => ({ PK: "TENANT#t1", SK: `PRODUCT#${id}` })));
        expect(sent("QueryCommand")).toEqual([]);
        expect(block.attrs.prefetchedProducts[1]).toEqual(cards[1]);
    });

    it("HTML becomes plain text, never HTML: tags removed (script and style with their content), paragraphs and line breaks → a space, the escapes undone", async () => {
        const cases: [unknown, string | undefined][] = [
            ["<p>Oak &amp; ash.</p><p>Second <b>line</b>.</p>", "Oak & ash. Second line."],
            ["<ul><li>One</li><li>Two</li></ul>", "One Two"],
            ["Line one\\nLine two", "Line one Line two"],
            ["5 &lt; 6 &gt; 4 &quot;q&quot; it&#39;s&nbsp;fine", "5 < 6 > 4 \"q\" it's fine"],
            ["<script>alert(1)</script>Safe<style>p{color:red}</style><img src=x onerror=alert(1)>", "Safe"],
            ["&amp;lt;b&amp;gt;", "&lt;b&gt;"],
            ["<p> </p><br>", undefined],
            ["", undefined],
            [42, undefined],
        ];
        for (const [description, expected] of cases) {
            store.items = store.items.filter((i) => i.SK !== "PRODUCT#p1").concat(product("p1", description));
            const [block] = await preparedBlocks([SHOWCASE({ showDescription: true, limit: 1 })]);
            expect(block.attrs.prefetchedProducts[0]._descriptionText, JSON.stringify(description)).toBe(expected);
        }
    });

    it("cut to 400 characters (code points: an emoji is never split); a shorter text is whole", async () => {
        store.items = store.items.filter((i) => i.SK !== "PRODUCT#p1").concat(product("p1", "😀".repeat(500)));
        const [block] = await preparedBlocks([SHOWCASE({ showDescription: true, limit: 1 })]);
        expect(Array.from(block.attrs.prefetchedProducts[0]._descriptionText)).toEqual(Array(400).fill("😀"));
    });

    it("a stored limit above 12 (the backend does not check block attributes): the first 12 products are read, the others shown without", async () => {
        cards = Array.from({ length: 14 }, (_, i) => card(`q${i}`));
        store.items.push(...cards.map((c) => product(c.id, `Text ${c.id}`)));
        const [block] = await preparedBlocks([SHOWCASE({ showDescription: true, limit: 14 })]);
        expect(block.attrs.prefetchedProducts).toHaveLength(14);
        expect(productSpy).toHaveBeenCalledTimes(12);
        expect(block.attrs.prefetchedProducts.slice(12)).toEqual(cards.slice(12));
    });
});

describe("showRating — approved reviews (§ 7.3)", () => {
    it("one getProductReviews per product; `_rating` = { average, count, text } of the APPROVED reviews only; none → no key", async () => {
        store.items.push(review("p1", 1, 5), review("p1", 2, 4), review("p1", 3, 1, "pending"), review("p1", 4, 1, "rejected"), review("p2", 1, 3, "pending"), review("p3", 1, 4));
        const [block] = await preparedBlocks([SHOWCASE({ showRating: true })]);
        expect(block.attrs.prefetchedProducts.map((p: any) => p._rating)).toEqual([
            { average: 4.5, count: 2, text: "4.5/5 (2 reviews)" },
            undefined,
            { average: 4, count: 1, text: "4/5 (1 review)" },
        ]);
        expect(reviewsSpy).toHaveBeenCalledTimes(3);
        expect(sent("QueryCommand").map((c) => c.input.ExpressionAttributeValues[":sk"])).toEqual(["REVIEW#p1#", "REVIEW#p2#", "REVIEW#p3#"]);
        expect(block.attrs.prefetchedProducts[1]).toEqual(cards[1]);
    });

    it("reviews over two result pages, the first page empty after the filter: both pages counted, two requests for that product", async () => {
        store.items.push(review("p1", 1, 1, "pending"), review("p1", 2, 1, "rejected"), review("p1", 3, 5), review("p1", 4, 4));
        store.pageSize = 2;
        const [block] = await preparedBlocks([SHOWCASE({ showRating: true, limit: 1 })]);
        expect(block.attrs.prefetchedProducts[0]._rating).toEqual({ average: 4.5, count: 2, text: "4.5/5 (2 reviews)" });
        expect(sent("QueryCommand")).toHaveLength(2);
    });

    it("reviews over two result pages, approved ones on both: all counted", async () => {
        store.items.push(review("p1", 1, 5), review("p1", 2, 5), review("p1", 3, 2));
        store.pageSize = 2;
        const [block] = await preparedBlocks([SHOWCASE({ showRating: true, limit: 1 })]);
        expect(block.attrs.prefetchedProducts[0]._rating).toEqual({ average: 4, count: 3, text: "4/5 (3 reviews)" });
        expect(sent("QueryCommand")).toHaveLength(2);
    });

    it("the text is the tenant's `reviewsSummary`, with its plural forms (ro-RO: one, few, other)", async () => {
        store.items.push(review("p1", 1, 5), ...Array.from({ length: 3 }, (_, i) => review("p2", i + 1, 4)), ...Array.from({ length: 20 }, (_, i) => review("p3", i + 1, 3)));
        const [block] = await preparedBlocks([SHOWCASE({ showRating: true })], tenant("commerce", { locale: "ro-RO" }));
        expect(block.attrs.prefetchedProducts.map((p: any) => p._rating.text)).toEqual(["5/5 (1 recenzie)", "4/5 (3 recenzii)", "3/5 (20 de recenzii)"]);
    });
});

describe("site kinds, other blocks, all three options", () => {
    it("a catalog tenant (SL-D10): no read and no key, whatever the options; the catalog reduction as today", async () => {
        const [block] = await preparedBlocks([SHOWCASE({ showCategoryLabel: true, showDescription: true, showRating: true, badgeTags: ["X"] })], tenant("catalog"));
        expect(store.calls).toEqual([]);
        expect(block.attrs.prefetchedProducts).toEqual(cards.map((c) => ({ id: c.id, title: c.title, slug: c.slug })));
        expect(block.attrs._catalogMode).toBe(true);
    });

    it("a content site (no commerce) reads as a commerce site: the block is drawn on every kind that stores it", async () => {
        const [block] = await preparedBlocks([SHOWCASE({ showDescription: true, limit: 1 })], tenant("content"));
        expect(block.attrs.prefetchedProducts[0]._descriptionText).toBe("Solid oak.");
    });

    it("the category is not found: no read for the card options", async () => {
        await preparedBlocks([SHOWCASE({ categorySlug: "nope", showCategoryLabel: true, showDescription: true, showRating: true })]);
        expect(store.calls).toEqual([]);
    });

    it("all three on: 1 getAllCategories + per product 1 getProductById and 1 getProductReviews; only the showcase's products change", async () => {
        store.items.push(review("p2", 1, 2));
        const blocks = [PARAGRAPH, SHOWCASE({ showCategoryLabel: true, showDescription: true, showRating: true })];
        const prepared = await preparedBlocks(blocks);
        expect(prepared[0]).toEqual(PARAGRAPH);
        expect(categoriesSpy).toHaveBeenCalledTimes(1);
        expect(productSpy).toHaveBeenCalledTimes(3);
        expect(reviewsSpy).toHaveBeenCalledTimes(3);
        expect(sent("GetCommand")).toHaveLength(3);
        expect(sent("QueryCommand")).toHaveLength(4);
        expect(prepared[1].attrs.prefetchedProducts[1]).toEqual({ ...cards[1], _categoryName: "Name c1", _rating: { average: 2, count: 1, text: "2/5 (1 review)" } });
    });
});
