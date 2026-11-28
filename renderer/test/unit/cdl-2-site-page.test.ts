import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { URL_PREFIX_DEFAULTS, urlPrefixesOf } from "@amodx/shared";

/**
 * CDL-2 (record docs/slices/cdl-2.md § 5) — the renderer routing rows of the packet's evidence taxonomy, through the
 * real `SitePage`:
 *   - the order-confirmation segment (design § 14 item 2): `checkout + checkoutConfirmation` is the confirmation page,
 *     every other segment under `checkout` a tracking page; the checkout page sends the visitor to that address;
 *   - the interest path (§ 7.2): on a catalog site without a stored value it is /my-list;
 *   - the partial-prefix tenant (F-CDL-PARTIAL-PREFIXES): a stored `{ interest: "/lista-mea" }` routes product pages.
 * The config is what `mapTenant` hands over (`urlPrefixesOf(stored)`, cdl-2-map-tenant.test.ts). Mocked: the DynamoDB
 * reads (`@/lib/dynamo`), Next's runtime-coupled modules, and the checkout and interest views, which print their props.
 * Which branch matched is read from the reads it makes (`getOrderForCustomer`'s order id, `getProductBySlug`'s slug,
 * `getContentBySlug`'s slug) — no change to SitePage for the test.
 */

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(async (..._args: unknown[]) => null), getPosts: vi.fn(), getDeliveryConfig: vi.fn(async () => null),
    getProductBySlug: vi.fn(async (..._args: unknown[]) => null), getCategoryBySlug: vi.fn(), getProductsByCategory: vi.fn(), getAllCategories: vi.fn(async () => []),
    getActiveProducts: vi.fn(), getCatalogListing: vi.fn(), searchProducts: vi.fn(), getOrderForCustomer: vi.fn(async (..._args: unknown[]) => null),
    getProductReviews: vi.fn(), getSiteReviews: vi.fn(), getProductById: vi.fn(), hasActivePopups: vi.fn(async () => false),
}));
vi.mock("@/lib/dynamo", () => dynamo);
// CMRC-1L: SitePage takes the order read from `@/lib/customer-api` (the backend), no longer from `@/lib/dynamo`. The same
// mock function serves, so every assertion below is unchanged; its entry in the `@/lib/dynamo` mock is now unused.
vi.mock("@/lib/customer-api", () => ({ getOrderForCustomer: dynamo.getOrderForCustomer }));
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
const { probe } = vi.hoisted(() => ({
    probe: (tag: string) => (props: any) => (globalThis as any).__react.createElement(tag, { "data-props": JSON.stringify(props) }),
}));
(globalThis as any).__react = React;
vi.mock("@/components/CheckoutPageView", () => ({ CheckoutPageView: probe("checkout-probe") }));
vi.mock("@/components/CartPageView", () => ({ CartPageView: probe("cart-probe") }));
vi.mock("@/components/AccountPageView", () => ({ AccountPageView: probe("account-probe") }));
vi.mock("@/components/InterestShortlist", async (importOriginal) => ({ ...(await importOriginal<any>()), InterestListPage: probe("interest-probe") }));

import { SitePage } from "@/components/SitePage";

function tenant(stored: unknown, extra: Record<string, unknown> = {}) {
    return {
        id: "t1", name: "Site", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: urlPrefixesOf(stored), commerceEnabled: false, catalogMode: false, ...extra,
    };
}
const COMMERCE = { commerceEnabled: true };
const CATALOG = { catalogMode: true };

/** Renders `path` (with `query`) for `config`; answers the markup, or the thrown Next control-flow message. */
async function render(config: Record<string, unknown>, path: string, query: Record<string, string> = {}) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    try {
        const el = await SitePage({ siteId: "t1", slug: path.replace(/^\//, "").split("/"), preview: false, basePath: "", sessionToken: null, query, cacheable: true });
        return renderToStaticMarkup(el as any);
    } catch (e) {
        return String((e as Error).message);
    }
}
const decoded = (html: string) => html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const propsOf = (html: string, tag: string) => {
    const m = html.match(new RegExp(`<${tag} data-props="([^"]*)"`));
    if (!m) throw new Error(`${tag} not rendered: ${html.slice(0, 200)}`);
    return JSON.parse(decoded(m[1]));
};
const Q = { id: "o1", email: "buyer@t1.test" };
/** The order id the last order read asked for: "o1" = the confirmation page (query id), anything else = tracking. */
async function orderReadOf(config: Record<string, unknown>, path: string) {
    dynamo.getOrderForCustomer.mockClear();
    await render(config, path, Q);
    expect(dynamo.getOrderForCustomer, path).toHaveBeenCalledTimes(1);
    return dynamo.getOrderForCustomer.mock.calls[0][1];
}

beforeEach(() => {
    dynamo.getContentBySlug.mockClear();
    dynamo.getProductBySlug.mockClear();
});

describe("CDL-2 — the order-confirmation segment (§ 14 item 2)", () => {
    it("no stored value: /checkout/confirmation is the confirmation page; /checkout/confirmare is a tracking address", async () => {
        const config = tenant(undefined, COMMERCE);
        expect(await orderReadOf(config, "/checkout/confirmation")).toBe("o1");               // checkout-confirm
        expect(await orderReadOf(config, "/checkout/confirmare")).toBe("confirmare");         // checkout-track
        expect(await orderReadOf(config, "/checkout/o1")).toBe("o1");                         // tracking stays
    });
    it("no stored value: the checkout page's confirmPrefix ends with /confirmation", async () => {
        const p = propsOf(await render(tenant(undefined, COMMERCE), "/checkout"), "checkout-probe");
        expect(p.confirmPrefix).toBe("/checkout/confirmation");
    });
    it("stored /multumim: that segment is the confirmation page; /checkout/confirmation is a tracking address; confirmPrefix follows", async () => {
        const config = tenant({ checkoutConfirmation: "/multumim" }, COMMERCE);
        expect(await orderReadOf(config, "/checkout/multumim")).toBe("o1");
        expect(await orderReadOf(config, "/checkout/confirmation")).toBe("confirmation");
        expect(propsOf(await render(config, "/checkout"), "checkout-probe").confirmPrefix).toBe("/checkout/multumim");
    });
    it("stored custom checkout prefix: the segment is appended to it", async () => {
        const config = tenant({ checkout: "/comanda" }, COMMERCE);
        expect(await orderReadOf(config, "/comanda/confirmation")).toBe("o1");
        expect(propsOf(await render(config, "/comanda"), "checkout-probe").confirmPrefix).toBe("/comanda/confirmation");
    });
    it("a config without the key (a caller that bypasses mapTenant) still uses the default segment", async () => {
        const config = { ...tenant(undefined, COMMERCE), urlPrefixes: { ...URL_PREFIX_DEFAULTS, checkoutConfirmation: undefined } };
        expect(await orderReadOf(config, "/checkout/confirmation")).toBe("o1");
    });
});

describe("CDL-2 — the interest path (§ 7.2) and the partial-prefix tenant (§ 7.1)", () => {
    it("catalog tenant, no stored interest: /my-list is the interest page; /lista-mea is an ordinary content slug", async () => {
        const config = tenant(undefined, CATALOG);
        const p = propsOf(await render(config, "/my-list"), "interest-probe");
        expect(p.productPrefix).toBe("/product");
        expect(dynamo.getContentBySlug).not.toHaveBeenCalled();
        await render(config, "/lista-mea");
        expect(dynamo.getContentBySlug).toHaveBeenCalledWith("t1", "/lista-mea");
    });
    it("catalog tenant with stored { interest: \"/lista-mea\" }: /lista-mea is the interest page and /product/<slug> routes", async () => {
        const config = tenant({ interest: "/lista-mea" }, CATALOG);
        propsOf(await render(config, "/lista-mea"), "interest-probe");
        await render(config, "/product/oak-plank");
        expect(dynamo.getProductBySlug).toHaveBeenCalledWith("t1", "oak-plank");
        expect(dynamo.getContentBySlug).not.toHaveBeenCalled();
    });
    it("non-catalog tenant: /my-list stays an ordinary content slug", async () => {
        await render(tenant(undefined, COMMERCE), "/my-list");
        expect(dynamo.getContentBySlug).toHaveBeenCalledWith("t1", "/my-list");
    });
});

/**
 * CDL2-R2 (review-0) — the renderer side of the overlap table. The SAME rows as `OVERLAPS` in
 * `backend/test/unit/cdl-2-paths.test.ts` (same order): stored prefixes, site kind, slug → the branch the real
 * `SitePage` takes. The backend slug check names the page of this branch (`builtInPageAt`, a copy of this precedence);
 * where the branch is `content` (row 7) it names the first reserved address in precedence order. Keep the tables equal.
 * The branch is read from what the page renders or reads (the mocked views and DynamoDB reads), not from SitePage
 * internals.
 */
const OVERLAPS: { stored: Record<string, string>; catalog: boolean; slug: string; branch: string }[] = [
    { stored: { interest: "/shop" }, catalog: true, slug: "/shop", branch: "interest" },
    { stored: { product: "/shop" }, catalog: false, slug: "/shop", branch: "shop" },
    { stored: { product: "/checkout" }, catalog: false, slug: "/checkout", branch: "checkout" },
    { stored: { product: "/x", interest: "/x/a" }, catalog: true, slug: "/x/a", branch: "interest" },
    { stored: { product: "/x", interest: "/x/a" }, catalog: false, slug: "/x/a", branch: "product" },
    { stored: { shop: "/a", product: "/a/b" }, catalog: false, slug: "/a/b/c", branch: "product" },
    { stored: { shop: "/a", product: "/a/b" }, catalog: false, slug: "/a/b", branch: "content" },
    { stored: { search: "/checkout/x" }, catalog: false, slug: "/checkout/x", branch: "track" },
    { stored: { account: "/cart" }, catalog: false, slug: "/cart", branch: "cart" },
    { stored: { category: "/product" }, catalog: false, slug: "/product/x", branch: "product" },
    { stored: { checkoutConfirmation: "/multumim" }, catalog: false, slug: "/checkout/multumim", branch: "confirm" },
    { stored: { cart: "/shop/cart" }, catalog: false, slug: "/shop/cart", branch: "cart" },
    { stored: { interest: "/search" }, catalog: true, slug: "/search", branch: "interest" },
    { stored: { interest: "/search" }, catalog: false, slug: "/search", branch: "search" },
    { stored: { account: "/category/x" }, catalog: false, slug: "/category/x", branch: "category" },
];

/** The branch SitePage took for `path`: a probe it rendered, or the first read it made. */
async function branchAt(config: Record<string, unknown>, path: string) {
    for (const fn of Object.values(dynamo)) if (fn !== dynamo.getTenantConfig) (fn as any).mockClear();
    const html = await render(config, path, { ...Q, q: "x" });
    for (const [tag, branch] of [["interest-probe", "interest"], ["cart-probe", "cart"], ["checkout-probe", "checkout"], ["account-probe", "account"]]) {
        if (html.includes(`<${tag} `)) return branch;
    }
    if (dynamo.getOrderForCustomer.mock.calls.length) return dynamo.getOrderForCustomer.mock.calls[0][1] === Q.id ? "confirm" : "track";
    if (dynamo.getProductBySlug.mock.calls.length) return "product";
    if (dynamo.getCategoryBySlug.mock.calls.length) return "category";
    if (dynamo.getActiveProducts.mock.calls.length || dynamo.getCatalogListing.mock.calls.length) return "shop";
    if (dynamo.searchProducts.mock.calls.length) return "search";
    if (dynamo.getContentBySlug.mock.calls.length) return "content";
    return `unknown: ${html.slice(0, 120)}`;
}

describe("CDL2-R2 overlaps — the branch the renderer takes (the backend's slug check names the same page)", () => {
    for (const row of OVERLAPS) {
        it(`${JSON.stringify(row.stored)} ${row.catalog ? "catalog" : "commerce"} ${row.slug} → ${row.branch}`, async () => {
            expect(await branchAt(tenant(row.stored, row.catalog ? CATALOG : COMMERCE), row.slug)).toBe(row.branch);
        });
    }
});
