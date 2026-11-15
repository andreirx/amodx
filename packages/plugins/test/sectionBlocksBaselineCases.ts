/**
 * SHOP-LOOK-1D: the `categoryShowcase` and `postGrid` inputs whose HTML was recorded BEFORE the slice changed the two
 * renders (`sectionBlocks.baseline.json`, rendered from `CategoryShowcaseRender.tsx` and `PostGridRender.tsx` at 61d965d
 * with `renderToStaticMarkup` and `renderToString`). `sectionBlocks.test.ts` renders each case with the current code —
 * alone, and with every new attribute absent, `null`, blank or off — and asserts the HTML equals the recorded one
 * (design `docs/slices/shop-look-1.md` § 4: absent = today's bytes).
 *
 * The showcase cases cover the card's price forms (plain, sale, tier range, equal tiers, out of stock, no image), the
 * columns, no price, no button text, no category name, no products, no server data (the spinner), no slug, a catalog
 * site (`_catalogMode` with the reduced products) and a Romanian tenant. The products are `CATPROD#` card items as the
 * server pass gives them today: key fields, `tags` and `categoryIds` included. The post grid cases cover both layouts,
 * both grid widths, no images, no headline, no domain, no posts, no server data (the spinner) and a Romanian tenant.
 * Post dates are at 12:00 UTC, so the printed day is the same in every time zone from UTC-11 to UTC+11.
 */

export type StringsKind = "en" | "en-catalog" | "ro";
export interface BaselineCase { strings: StringsKind; attrs: Record<string, unknown> }

/** The URL helper RenderBlocks injects, in the `/_site/` preview form (a prefix the HTML shows). */
export const previewUrl = (path: string) => `/_site/t1${path}`;

const CARD = { PK: "TENANT#t1", status: "active", sortOrder: 0 };
export const PRODUCTS = [
    { ...CARD, SK: "CATPROD#c1#p1", id: "p1", title: "Oak plank", slug: "oak-plank", sku: "OAK-1", price: "39.90", currency: "USD", imageLink: "https://img.test/p1.jpg", availability: "in_stock", tags: ["TOP PICK", "oak"], volumePricing: [], categoryIds: ["c1", "c2"] },
    { ...CARD, SK: "CATPROD#c1#p2", id: "p2", title: "Walnut plank", slug: "walnut-plank", price: "59.00", salePrice: "49.00", currency: "USD", imageLink: "https://img.test/p2.jpg", availability: "in_stock", tags: [], volumePricing: [], categoryIds: ["c1"] },
    { ...CARD, SK: "CATPROD#c1#p3", id: "p3", title: "Ash plank", slug: "ash-plank", price: "30.00", currency: "USD", imageLink: "https://img.test/p3.jpg", availability: "in_stock", tags: ["POPULAR"], volumePricing: [{ minQuantity: 10, price: "25.00" }, { minQuantity: 50, price: "20.00" }], categoryIds: ["c1"] },
    { ...CARD, SK: "CATPROD#c1#p4", id: "p4", title: "Pine plank", slug: "pine-plank", price: "15.00", currency: "USD", availability: "out_of_stock", tags: ["POPULAR", "TOP PICK"], volumePricing: [], categoryIds: [] },
    { ...CARD, SK: "CATPROD#c1#p5", id: "p5", title: "Elm plank", slug: "elm-plank", price: "22.00", currency: "USD", imageLink: "https://img.test/p5.jpg", availability: "in_stock", tags: [], volumePricing: [{ minQuantity: 5, price: "22.00" }], categoryIds: ["c2"] },
];
/** The catalog reduction of the server pass (`SitePage.tsx`): display fields only. */
export const CATALOG_PRODUCTS = PRODUCTS.map((p) => ({ id: p.id, title: p.title, slug: p.slug, ...(p.imageLink !== undefined ? { imageLink: p.imageLink } : {}) }));

/** The Tiptap attribute defaults (`category-showcase/index.ts`) with a picked category, plus what the server pass adds. */
export const SHOWCASE_BASE = {
    categoryId: "c1", categoryName: "Best Sellers", categorySlug: "best-sellers", limit: 4, columns: "4", showPrice: true,
    ctaText: "View All Products", blockWidth: "content",
    prefetchedProducts: PRODUCTS, _productPrefix: "/product", _categoryPrefix: "/category", _getUrl: previewUrl,
};

export const SHOWCASE_CASES: Record<string, BaselineCase> = {
    "tiptap-defaults": { strings: "en", attrs: SHOWCASE_BASE },
    "columns-2": { strings: "en", attrs: { ...SHOWCASE_BASE, columns: "2" } },
    "columns-3": { strings: "en", attrs: { ...SHOWCASE_BASE, columns: "3" } },
    "no-price": { strings: "en", attrs: { ...SHOWCASE_BASE, showPrice: false } },
    "no-cta": { strings: "en", attrs: { ...SHOWCASE_BASE, ctaText: "" } },
    "no-name": { strings: "en", attrs: { ...SHOWCASE_BASE, categoryName: "" } },
    "no-products": { strings: "en", attrs: { ...SHOWCASE_BASE, prefetchedProducts: [] } },
    "no-server-data": { strings: "en", attrs: { ...SHOWCASE_BASE, prefetchedProducts: undefined } },
    "no-slug": { strings: "en", attrs: { ...SHOWCASE_BASE, categorySlug: "" } },
    "custom-prefixes": { strings: "en", attrs: { ...SHOWCASE_BASE, _productPrefix: "/produs", _categoryPrefix: "/categorie" } },
    "catalog": { strings: "en-catalog", attrs: { ...SHOWCASE_BASE, prefetchedProducts: CATALOG_PRODUCTS, _catalogMode: true } },
    "ro": { strings: "ro", attrs: SHOWCASE_BASE },
};

export const POSTS = [
    { id: "n1", slug: "/blog/first", title: "First post", featuredImage: "https://img.test/n1.jpg", seoDescription: "How we lay oak floors.", createdAt: "2026-03-10T12:00:00.000Z", tags: ["news", "oak", "guides"] },
    { id: "n2", slug: "/blog/second", title: "Second post", createdAt: "2026-02-01T12:00:00.000Z" },
];

/** The Tiptap attribute defaults (`post-grid/index.ts`) plus what the server pass adds. */
export const POST_GRID_BASE = {
    headline: "Latest Posts", filterTag: "", limit: 6, showImages: true, layout: "list", columns: "3", blockWidth: "content",
    prefetchedPosts: POSTS, serverDomain: "t1.test",
};

export const POST_GRID_CASES: Record<string, BaselineCase> = {
    "tiptap-defaults-list": { strings: "en", attrs: POST_GRID_BASE },
    "grid-3": { strings: "en", attrs: { ...POST_GRID_BASE, layout: "grid" } },
    "grid-2": { strings: "en", attrs: { ...POST_GRID_BASE, layout: "grid", columns: "2" } },
    "list-no-images": { strings: "en", attrs: { ...POST_GRID_BASE, showImages: false } },
    "grid-no-images": { strings: "en", attrs: { ...POST_GRID_BASE, layout: "grid", showImages: false } },
    "no-headline": { strings: "en", attrs: { ...POST_GRID_BASE, headline: "" } },
    "no-domain": { strings: "en", attrs: { ...POST_GRID_BASE, serverDomain: undefined } },
    "no-posts": { strings: "en", attrs: { ...POST_GRID_BASE, prefetchedPosts: [] } },
    "no-server-data": { strings: "en", attrs: { ...POST_GRID_BASE, prefetchedPosts: undefined } },
    "ro": { strings: "ro", attrs: POST_GRID_BASE },
};
