import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

/**
 * LOCALE-1B — headless server renders of the shared product surfaces and the catalog panel (docs/slices/locale-1.md
 * § 6.2, § 6.3, § 8.5): the product, category, shop and search pages, their metadata, the by-id product page and the
 * facet panel, for an EN (en-US) and a RO tenant — the states the serving-contract fixtures do not reach (reviews,
 * pre-order, Buy Now, empty listings, plural counts 1 / 2 / 20, the facet notices), plus the § 5.2 F-rule preservation
 * cases of the search bar (override absent / "" / "X") and the facet ids of every href.
 *
 * Real: `SitePage`, `ProductByIdPage`, the shared resolver and facet module. Mocked: the DynamoDB reads (`@/lib/dynamo`),
 * Next's runtime-coupled modules, and the client components whose PROPS are under test here — `SearchBar`,
 * `InterestToggle`, `InterestListPage`, `AddToCartButton` print the props the server passes (their rendering of those
 * texts is checked in locale-1b-client.test.ts and, for the commerce view, unchanged code).
 * The expected texts are written out (§ 6.2 / § 6.3 columns).
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
const { probe } = vi.hoisted(() => ({
    probe: (tag: string) => (props: any) => (globalThis as any).__react.createElement(tag, { "data-props": JSON.stringify(props) }),
}));
(globalThis as any).__react = React;
vi.mock("@/components/SearchBar", () => ({ SearchBar: probe("search-probe") }));
vi.mock("@/components/InterestShortlist", () => ({ InterestToggle: probe("toggle-probe"), InterestListPage: probe("list-probe"), InterestWidget: probe("widget-probe") }));
// The site layout (for the header widget's props, LOCALE1B-WIDGET): its children that are not under test.
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }), signIn: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/Providers", () => ({ Providers: ({ children }: any) => children }));
vi.mock("@/components/ThemeInjector", () => ({ ThemeInjector: () => null }));
vi.mock("@/components/Analytics", () => ({ Analytics: () => null }));
vi.mock("@/components/PaddleLoader", () => ({ PaddleLoader: () => null }));
vi.mock("@/components/TopBar", () => ({ TopBar: () => null }));
vi.mock("@/components/CommerceBar", () => ({ CommerceBar: () => null }));
vi.mock("@/components/FBPixel", () => ({ FBPixel: () => null }));
vi.mock("@/components/PopupManager", () => ({ PopupManager: () => null }));
vi.mock("@/components/RecaptchaProvider", () => ({ RecaptchaProvider: () => null }));
vi.mock("@/components/PageEffectWrapper", () => ({ PageEffectWrapper: () => null }));
vi.mock("@/components/ReferralCapture", () => ({ ReferralCapture: () => null }));
vi.mock("@/components/CookieConsent", () => ({ CookieConsent: () => null }));
vi.mock("@/components/AddToCartButton", () => ({ AddToCartButton: probe("cart-probe") }));
vi.mock("@/components/ProductImageGallery", () => ({ ProductImageGallery: () => null }));

import SiteLayout from "@/app/[siteId]/layout";
import { SitePage, buildSitePageMetadata } from "@/components/SitePage";
import { ProductByIdPage } from "@/components/ProductByIdPage";

const EN = {};
const RO = { locale: "ro-RO" };
function tenant(extra: Record<string, unknown> = {}) {
    return {
        id: "t1", name: "Atelier", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: URL_PREFIX_DEFAULTS, commerceEnabled: true, catalogMode: false,
        searchBar: { enabled: true, placeholder: "" }, ...extra,
    };
}
const catalogTenant = (extra: Record<string, unknown> = {}) => tenant({ commerceEnabled: false, catalogMode: true, ...extra });

async function siteHtml(config: Record<string, unknown>, slug: string[], query: Record<string, string> = {}) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    const el = await SitePage({ siteId: "t1", slug, preview: false, basePath: "", sessionToken: null, query, cacheable: true });
    return renderToStaticMarkup(el as any);
}
const decoded = (html: string) => html.replace(/<!-- -->/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const probes = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag} data-props="([^"]*)"`, "g"))].map((m) => JSON.parse(decoded(m[1])));

const PRODUCT = {
    id: "p1", slug: "rug", title: "Rug", price: "10", currency: "USD", status: "active", categoryIds: [], variants: [],
    personalizations: [], additionalImageLinks: [], availability: "preorder", paymentLinkId: "pri_1",
    volumePricing: [{ minQuantity: 5, price: "8" }], longDescription: "<p>Long</p>", ingredients: "Wool", nutritionalValues: [{ label: "Fat", value: "0" }],
};
const reviews = (n: number) => ({ items: [], averageRating: 4.5, totalReviews: n });

beforeEach(() => {
    for (const fn of Object.values(dynamo)) (fn as any).mockReset?.();
    dynamo.getAllCategories.mockResolvedValue([]);
    dynamo.getProductReviews.mockResolvedValue(reviews(0));
});

describe("[1b-server] product page (commerce tenant)", () => {
    for (const [name, locale, want] of [
        ["EN", EN, { shop: ">Shop<", volume: "Volume Pricing", pre: "Pre-order", buy: "Buy Now", ingredients: "Ingredients", nutrition: "Nutritional Values", reviews: ">Reviews<", description: "Description",
            summary: ["4.5/5 (1 review)", "4.5/5 (2 reviews)", "4.5/5 (20 reviews)"] }],
        ["RO", RO, { shop: ">Magazin<", volume: "Prețuri pentru cantități mari", pre: "Precomandă", buy: "Cumpără acum", ingredients: "Ingrediente", nutrition: "Valori nutriționale", reviews: ">Recenzii<", description: "Descriere",
            summary: ["4.5/5 (1 recenzie)", "4.5/5 (2 recenzii)", "4.5/5 (20 de recenzii)"] }],
    ] as const) {
        it(`[1b-server] ${name} product page: shopTitle, volumePricing, preOrder, buyNow, ingredients, nutritionalValues, reviewsHeading, reviewsSummary 1/2/20, description`, async () => {
            dynamo.getProductBySlug.mockResolvedValue(PRODUCT);
            for (const [i, n] of [1, 2, 20].entries()) {
                dynamo.getProductReviews.mockResolvedValue(reviews(n));
                const html = decoded(await siteHtml(tenant(locale), ["product", "rug"]));
                for (const text of [want.shop, want.volume, want.pre, want.buy, want.ingredients, want.nutrition, want.reviews, want.description]) expect(html, text).toContain(text);
                expect(html).toContain(want.summary[i]);
            }
        });
    }

    it("[1b-server] the product page caller reads the resolver: AddToCartButton gets the RO pack texts on a RO tenant (ledger L-RO-3), today's English on an EN tenant", async () => {
        dynamo.getProductBySlug.mockResolvedValue({ ...PRODUCT, paymentLinkId: undefined, availability: "in_stock" });
        const [en] = probes(await siteHtml(tenant(EN), ["product", "rug"]), "cart-probe");
        expect(en.strings).toEqual({ addToCart: "Add to Cart", addedToCart: "Added to Cart!", viewCart: "View Cart", outOfStock: "Out of Stock", variantUnavailable: "Variant Unavailable" });
        const [ro] = probes(await siteHtml(tenant(RO), ["product", "rug"]), "cart-probe");
        expect(ro.strings.addToCart).toBe("Adaugă în coș");
        expect(ro.strings.outOfStock).toBe("Stoc epuizat");
        // An override still wins, as before.
        const [own] = probes(await siteHtml(tenant({ ...RO, commerceStrings: { addToCart: "Cumpără" } }), ["product", "rug"]), "cart-probe");
        expect(own.strings.addToCart).toBe("Cumpără");
    });

    it("[1b-server] the reviews summary is one filled text (category-1 consolidation): no `<!-- -->` separators inside it", async () => {
        dynamo.getProductBySlug.mockResolvedValue(PRODUCT);
        dynamo.getProductReviews.mockResolvedValue(reviews(3));
        dynamo.getTenantConfig.mockResolvedValue(tenant(EN));
        const raw = renderToString(await SitePage({ siteId: "t1", slug: ["product", "rug"], preview: false, basePath: "", sessionToken: null, query: {}, cacheable: true }) as any);
        expect(raw).toContain(">4.5/5 (3 reviews)<");
    });
});

describe("[1b-server] search bar props: placeholder and the § 5.2 F rule (preservation cases)", () => {
    const labelsOf = async (config: Record<string, unknown>) => probes(await siteHtml(config, ["shop"]), "search-probe")[0];
    beforeEach(() => { dynamo.getActiveProducts.mockResolvedValue({ items: [], total: 0 }); });

    it("[1b-server] EN and RO: searchPlaceholder when the tenant's searchBar.placeholder is empty; the tenant's placeholder otherwise", async () => {
        expect((await labelsOf(tenant(EN))).placeholder).toBe("Search products...");
        expect((await labelsOf(tenant(RO))).placeholder).toBe("Caută produse...");
        expect((await labelsOf(tenant({ ...RO, searchBar: { enabled: true, placeholder: "Search products..." } }))).placeholder).toBe("Search products...");
    });

    for (const [name, locale, defaults] of [
        ["EN", EN, { searchButton: "Search", searchNoResults: "No products found", searchSearching: "Searching...", viewAllResults: "View all results" }],
        ["RO", RO, { searchButton: "Caută", searchNoResults: "Nu s-au găsit produse", searchSearching: "Se caută...", viewAllResults: "Vezi toate rezultatele" }],
    ] as const) {
        it(`[1b-server] ${name} search bar labels: override absent → language default; "" → language default (F); "X" → "X"`, async () => {
            expect((await labelsOf(tenant(locale))).labels).toEqual(defaults);
            const empty = { searchButton: "", searchNoResults: "", searchSearching: "", viewAllResults: "" };
            expect((await labelsOf(tenant({ ...locale, commerceStrings: empty }))).labels).toEqual(defaults);
            const own = { searchButton: "X1", searchNoResults: "X2", searchSearching: "X3", viewAllResults: "X4" };
            expect((await labelsOf(tenant({ ...locale, commerceStrings: own }))).labels).toEqual(own);
        });
    }
});

describe("[1b-server] category, shop and search pages (commerce tenant)", () => {
    const category = { id: "cat", slug: "rugs", name: "Rugs" };
    for (const [name, locale, want] of [
        ["EN", EN, { counts: ["1 product", "2 products", "20 products"], empty: "No products in this category yet.", shop: "Shop", all: "All Products", inStock: "In Stock",
            shopEmpty: "No products available yet.", shopEmptyInStock: "No products currently in stock.", results: ["1 result", "2 results", "20 results"],
            breadcrumb: ">Search<", enter: "Enter a search term to find products.", resultsFor: 'Results for "rug"', searchProducts: "Search Products", noResults: "No products found “rug”." }],
        ["RO", RO, { counts: ["1 produs", "2 produse", "20 de produse"], empty: "Nu există încă produse în această categorie.", shop: "Magazin", all: "Toate produsele", inStock: "În stoc",
            shopEmpty: "Nu există încă produse disponibile.", shopEmptyInStock: "Nu există produse în stoc momentan.", results: ["1 rezultat", "2 rezultate", "20 de rezultate"],
            breadcrumb: ">Căutare<", enter: "Introdu un termen de căutare pentru a găsi produse.", resultsFor: 'Rezultate pentru "rug"', searchProducts: "Caută produse", noResults: "Nu s-au găsit produse “rug”." }],
    ] as const) {
        it(`[1b-server] ${name} category page: productCount 1/2/20, categoryEmpty, shopTitle breadcrumb`, async () => {
            dynamo.getCategoryBySlug.mockResolvedValue(category);
            for (const [i, n] of [1, 2, 20].entries()) {
                dynamo.getProductsByCategory.mockResolvedValue({ items: [], total: n });
                const html = decoded(await siteHtml(tenant(locale), ["category", "rugs"]));
                expect(html).toContain(`>${want.counts[i]}<`);
                expect(html).toContain(want.empty);
                expect(html).toContain(`>${want.shop}<`);
            }
        });

        it(`[1b-server] ${name} shop page: shopTitle, shopAllProducts, inStock filter, shopEmpty / shopEmptyInStock`, async () => {
            dynamo.getActiveProducts.mockResolvedValue({ items: [], total: 0 });
            const html = decoded(await siteHtml(tenant(locale), ["shop"]));
            for (const text of [`>${want.shop}</h1>`, want.all, want.inStock, want.shopEmpty]) expect(html, text).toContain(text);
            expect(decoded(await siteHtml(tenant(locale), ["shop"], { availability: "in_stock" }))).toContain(want.shopEmptyInStock);
        });

        it(`[1b-server] ${name} search page: searchResultCount 1/2/20, searchBreadcrumb, searchEnterTerm, resultsFor, searchProducts, searchNoResults (L-RO-3)`, async () => {
            for (const [i, n] of [1, 2, 20].entries()) {
                dynamo.searchProducts.mockResolvedValue({ items: [], total: n });
                const html = decoded(await siteHtml(tenant(locale), ["search"], { q: "rug" }));
                expect(html).toContain(`>${want.results[i]}<`);
                expect(html).toContain(want.resultsFor);
                expect(html).toContain(want.breadcrumb);
                expect(html).toContain(want.noResults.replace("“", "“").replace("”", "”"));
            }
            const none = decoded(await siteHtml(tenant(locale), ["search"]));
            expect(none).toContain(want.enter);
            expect(none).toContain(want.searchProducts);
        });
    }

    it("[1b-server] the counts are one filled text (category-1 consolidation of `{n} product{s}` / `{n} result{s}`)", async () => {
        dynamo.getCategoryBySlug.mockResolvedValue(category);
        dynamo.getProductsByCategory.mockResolvedValue({ items: [], total: 3 });
        dynamo.getTenantConfig.mockResolvedValue(tenant(EN));
        const raw = renderToString(await SitePage({ siteId: "t1", slug: ["category", "rugs"], preview: false, basePath: "", sessionToken: null, query: {}, cacheable: true }) as any);
        expect(raw).toContain(">3 products</p>");
    });
});

describe("[1b-server] metadata of the shared pages and the interest list", () => {
    const meta = async (config: Record<string, unknown>, slug: string[], query: Record<string, string> = {}) => {
        dynamo.getTenantConfig.mockResolvedValue(config);
        return buildSitePageMetadata({ siteId: "t1", slug, query });
    };
    for (const [name, locale, want] of [
        ["EN", EN, { category: "Browse Rugs products", shop: "Shop - Atelier", search: "Search - Atelier", query: "Search: oak - Atelier", list: "My list" }],
        ["RO", RO, { category: "Vezi produsele din Rugs", shop: "Magazin - Atelier", search: "Căutare - Atelier", query: "Căutare: oak - Atelier", list: "Lista mea" }],
    ] as const) {
        it(`[1b-server] ${name} metadata: metaCategoryDescription, metaShopTitle, metaSearchTitle, metaSearchQueryTitle, interestListTitle`, async () => {
            dynamo.getCategoryBySlug.mockResolvedValue({ id: "cat", slug: "rugs", name: "Rugs" });
            expect((await meta(tenant(locale), ["category", "rugs"])).description).toBe(want.category);
            expect((await meta(tenant(locale), ["shop"])).title).toBe(want.shop);
            expect((await meta(tenant(locale), ["search"])).title).toBe(want.search);
            expect((await meta(tenant(locale), ["search"], { q: "oak" })).title).toBe(want.query);
            expect((await meta(catalogTenant(locale), ["lista-mea"])).title).toBe(want.list);
        });
    }
});

describe("[1b-server] the by-id product page (ProductByIdPage)", () => {
    for (const [name, locale, want] of [
        ["EN", EN, { buy: "Buy Now", pre: "Pre-order", out: "Out of Stock" }],
        ["RO", RO, { buy: "Cumpără acum", pre: "Precomandă", out: "Stoc epuizat" }],
    ] as const) {
        it(`[1b-server] ${name} by-id page: buyNow, preOrder, outOfStock`, async () => {
            dynamo.getTenantConfig.mockResolvedValue(tenant(locale));
            const render = async (product: Record<string, unknown>) => {
                dynamo.getProductById.mockResolvedValue({ id: "p1", title: "Rug", description: "d", price: "1", currency: "USD", status: "active", ...product });
                return decoded(renderToStaticMarkup(await ProductByIdPage({ siteId: "t1", productId: "p1", preview: false, cacheable: true }) as any));
            };
            expect(await render({ availability: "in_stock", paymentLinkId: "pri_1" })).toContain(`>${want.buy}</a>`);
            expect(await render({ availability: "preorder" })).toContain(`>${want.pre}</button>`);
            expect(await render({ availability: "out_of_stock" })).toContain(`>${want.out}</button>`);
        });
    }
});

// ── the catalog facet panel and the interest components' props ─────────────────────────────────────────────────

/** A catalog base set: two producers, option groups with different names (→ the default variant heading), and one
 *  attribute value longer than the URL budget (→ a too-long value: its title and the budget hint). */
const LONG = "L".repeat(6200);
const CATALOG_PRODUCTS = [
    { id: "a", slug: "a", title: "A", status: "active", brand: "BOEN", categoryIds: ["cat"], variants: [{ id: "g", name: "Format", options: [{ value: "120" }] }], attributes: [{ key: "Finisaj", value: LONG }] },
    { id: "b", slug: "b", title: "B", status: "active", brand: "BOEN", categoryIds: ["cat"], variants: [{ id: "g", name: "Culoare", options: [{ value: "90" }] }], attributes: [{ key: "Finisaj", value: LONG }] },
    { id: "c", slug: "c", title: "C", status: "active", brand: "ITC", categoryIds: ["cat"], variants: [{ id: "g", name: "Format", options: [{ value: "120" }] }], attributes: [{ key: "Finisaj", value: "Mat" }] },
];

describe("[1b-server] catalog facet panel (shop and category pages)", () => {
    beforeEach(() => {
        dynamo.getCategoryBySlug.mockResolvedValue({ id: "cat", slug: "floors", name: "Floors" });
        dynamo.getCatalogListing.mockResolvedValue(CATALOG_PRODUCTS);
    });
    for (const [name, locale, want] of [
        ["EN", EN, { title: "Filters", producer: "Brand", variant: "Option", counts: ["1 product", "3 products"], clear: "Clear the filters", remove: "Remove the filter Brand: ITC",
            noMatch: "No product matches the selected filters.", tooLong: "The filters in the address are too long and were not applied.", tooMany: "Too many filters selected — remove one" }],
        ["RO", RO, { title: "Filtre", producer: "Producător", variant: "Variantă", counts: ["1 produs", "3 produse"], clear: "Șterge filtrele", remove: "Elimină filtrul Producător: ITC",
            noMatch: "Niciun produs nu corespunde filtrelor alese.", tooLong: "Filtrele din adresă sunt prea lungi și nu au fost aplicate.", tooMany: "Prea multe filtre selectate — eliminați unul" }],
    ] as const) {
        it(`[1b-server] ${name} facet panel: facetsTitle, facetProducer, facetVariantDefault, facetsCount, facetsRemove, facetsClear, facetsTooMany`, async () => {
            for (const slug of [["shop"], ["category", "floors"]]) {
                const html = decoded(await siteHtml(catalogTenant(locale), slug, { f: "producator=ITC" }));
                expect(html).toContain(`aria-label="${want.title}"`);
                expect(html).toContain(`<h2 class="hidden lg:block font-semibold mb-3">${want.title}</h2>`);
                expect(html).toContain(`>${want.title} (1)</label>`);
                expect(html).toContain(`<summary class="cursor-pointer font-medium">${want.producer}</summary>`);
                expect(html).toContain(`<summary class="cursor-pointer font-medium">${want.variant}</summary>`);
                expect(html).toContain(`data-facet-total="1">${want.counts[0]}</p>`);
                expect(html).toContain(`aria-label="${want.remove}"`);
                expect(html).toContain(`data-facet-clear="true">${want.clear}</a>`);
                // Facet ids in every href stay the URL contract: producator / varianta / a.<key>, never a heading.
                const hrefs = [...html.matchAll(/href="([^"]*\?f=[^"]*)"/g)].map((m) => decodeURIComponent(m[1]));
                expect(hrefs.length).toBeGreaterThan(0);
                for (const h of hrefs) expect(h).not.toMatch(/Brand|Producător|Option|Variantă/);
                expect(hrefs.some((h) => h.includes("varianta="))).toBe(true);
            }
            // Unfiltered: three products; the value longer than the URL budget is "too long" (its title) and the hint shows.
            const all = decoded(await siteHtml(catalogTenant(locale), ["shop"]));
            expect(all).toContain(`data-facet-total="3">${want.counts[1]}</p>`);
            expect(all).toContain(`title="${want.tooMany}"`);
            expect(all).toContain(`data-facet-hint="true">${want.tooMany}</p>`);
        });

        it(`[1b-server] ${name} facet panel: facetsNoMatch (a selection that matches nothing), facetsUrlTooLong (filters too long)`, async () => {
            const none = decoded(await siteHtml(catalogTenant(locale), ["shop"], { f: "producator=NONE" }));
            expect(none).toContain(`<p class="text-muted-foreground">${want.noMatch}</p>`);
            const long = decoded(await siteHtml(catalogTenant(locale), ["shop"], { f: `a.Finisaj=${"x".repeat(7000)}` }));
            expect(long).toContain(`data-facet-notice="true">${want.tooLong}</p>`);
        });

        it(`[1b-server] ${name} interest toggles (cards and product page) and the list page get the tenant's catalog texts`, async () => {
            const toggles = probes(await siteHtml(catalogTenant(locale), ["shop"]), "toggle-probe");
            expect(toggles).toHaveLength(3);
            const c = name === "EN"
                ? { interestAdd: "I'm interested", interestAdded: "In my list", interestListFull: "Your list already has 50 products. Remove one to add another." }
                : { interestAdd: "Mă interesează", interestAdded: "În lista mea", interestListFull: "Lista are deja 50 de produse. Scoateți un produs ca să adăugați altul." };
            for (const t of toggles) expect(t.strings).toEqual(c);
            dynamo.getProductBySlug.mockResolvedValue({ ...CATALOG_PRODUCTS[0], variants: [] });
            const [page] = probes(await siteHtml(catalogTenant(locale), ["product", "a"]), "toggle-probe");
            expect(page.strings).toEqual(c);
            const [list] = probes(await siteHtml(catalogTenant(locale), ["lista-mea"]), "list-probe");
            expect(Object.keys(list.strings)).toHaveLength(25);
            expect(list.strings.interestListTitle).toBe(name === "EN" ? "My list" : "Lista mea");
            expect(list.strings.interestRemove).toBe(name === "EN" ? "Remove {title} from the list" : "Scoateți {title} din listă");
        });
    }

    it("[1b-server] a non-catalog tenant renders no toggle and no facet panel (the catalog texts reach catalog sites only)", async () => {
        dynamo.getActiveProducts.mockResolvedValue({ items: [{ id: "p", slug: "p", title: "P", price: "1", currency: "USD", availability: "in_stock" }], total: 1 });
        const html = await siteHtml(tenant(RO), ["shop"]);
        expect(probes(html, "toggle-probe")).toEqual([]);
        expect(html).not.toContain("data-facet-panel");
    });
});

describe("[1b-server] the header interest widget (layout → Navbar → InterestWidget, LOCALE1B-WIDGET)", () => {
    const widgetOf = async (config: Record<string, unknown>) => {
        dynamo.getTenantConfig.mockResolvedValue(config);
        const el = await SiteLayout({ children: React.createElement("main", null, "page"), params: Promise.resolve({ siteId: "t1" }) });
        return probes(renderToStaticMarkup(el as any), "widget-probe");
    };
    for (const [name, locale, want] of [
        ["EN", EN, { interestListTitle: "My list", interestWidgetLabel: { language: "en", forms: { one: "My list: {n} product", other: "My list: {n} products" }, english: { one: "My list: {n} product", other: "My list: {n} products" } },
            interestStorageWarning: "This browser cannot save the list. We keep it while this page stays open.", interestStorageAck: "Got it" }],
        ["RO", RO, { interestListTitle: "Lista mea", interestWidgetLabel: { language: "ro", forms: { one: "Lista mea: {n} produs", few: "Lista mea: {n} produse", other: "Lista mea: {n} de produse" }, english: { one: "My list: {n} product", other: "My list: {n} products" } },
            interestStorageWarning: "Lista nu poate fi salvată în acest browser; o păstrăm cât timp pagina rămâne deschisă.", interestStorageAck: "Am înțeles" }],
    ] as const) {
        it(`[1b-server] ${name} catalog tenant: both widget mounts (desktop, mobile) get interestListTitle, interestWidgetLabel, interestStorageWarning, interestStorageAck`, async () => {
            const widgets = await widgetOf(catalogTenant(locale));
            expect(widgets).toHaveLength(2);
            for (const w of widgets) expect(w.strings).toEqual(want);
        });
    }
    it("[1b-server] a non-catalog tenant has no interest widget (no catalog texts in its header)", async () => {
        expect(await widgetOf(tenant({ ...RO, commerceEnabled: false }))).toEqual([]);
    });
});
