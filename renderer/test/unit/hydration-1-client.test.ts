// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { blockStrings, resolveLocaleStrings } from "@amodx/shared";
import { SocialShare } from "@/components/SocialShare";
import { InterestWidget } from "@/components/InterestShortlist";
import { CategoryShowcaseRender } from "../../../packages/plugins/src/category-showcase/CategoryShowcaseRender";

const route = vi.hoisted(() => ({ pathname: "/about" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => createElement("a", props, children) }));
const resolved = resolveLocaleStrings({});
const strings = resolved.strings.site;
let root: Root | undefined;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.cookie = "amodx_preview_base=; Max-Age=0; path=/";
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** H2/H4: real server render with NO browser globals, then hydrate that HTML in a browser document.
 * Both error channels and DOM-node identity are checked. Effects may update state after the matching first render. */
async function hydrate(element: ReactElement) {
    let html: string;
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    try { html = renderToString(element); } finally { vi.unstubAllGlobals(); }
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const serverNode = host.firstChild;
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args); });
    await act(async () => {
        root = hydrateRoot(host, element, { onRecoverableError: (error) => { errors.push(error); } });
    });
    expect(errors).toEqual([]);
    expect(host.firstChild).toBe(serverNode);
    consoleError.mockRestore();
    return { host, html };
}

describe("HYDRATION-1", () => {
    it("H2 SocialShare retains server markup without recoverable or console errors; copy uses the supplied canonical", async () => {
        const url = "https://tenant.test/ro/%C3%AEntreb%C4%83ri";
        const { host, html } = await hydrate(createElement(SocialShare, { title: "A & B", url, strings }));
        expect(host.innerHTML).toBe(html);
        expect(host.querySelectorAll("a")).toHaveLength(4);
        expect(html).toContain(encodeURIComponent(url));
        const writeText = vi.fn(async () => {});
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        vi.useFakeTimers();
        try {
            act(() => host.querySelector("button")!.click());
            expect(writeText).toHaveBeenCalledExactlyOnceWith(url);
            act(() => vi.runAllTimers());
        } finally { vi.useRealTimers(); }
    });

    for (const injected of [false, true]) {
        it(`H4 showcase matches with custom document prefixes; injected=${injected}`, async () => {
            document.head.innerHTML = '<meta name="x-product-prefix" content="/produse"><meta name="x-category-prefix" content="/categorii">';
            const attrs = {
                categoryName: "Rugs", categorySlug: "rugs", ctaText: "See all", showPrice: false,
                prefetchedProducts: [{ id: "p1", title: "Rug", slug: "rug", price: "1", currency: "USD", availability: "in_stock" }],
                ...(injected ? { _productPrefix: "/server-products", _categoryPrefix: "/server-categories" } : {}),
            };
            const { host, html } = await hydrate(createElement(CategoryShowcaseRender, { attrs, strings: blockStrings(resolved, { catalogMode: false }) }));
            expect(html).toContain(`href="${injected ? "/server-products" : "/product"}/rug"`);
            expect(html).toContain(`href="${injected ? "/server-categories" : "/category"}/rugs"`);
            expect(host.querySelector("a")!.getAttribute("href")).toBe(`${injected ? "/server-products" : "/produse"}/rug`);
            expect([...host.querySelectorAll("a")].at(-1)!.getAttribute("href")).toBe(`${injected ? "/server-categories" : "/categorii"}/rugs`);
        });
    }

    it("H4 preview pathname ignores a malformed percent-encoded cookie without reading it", async () => {
        route.pathname = "/_site/path-tenant/about";
        document.cookie = "amodx_preview_base=%E0%A4%A; path=/";
        const cookie = vi.spyOn(document, "cookie", "get").mockImplementation(() => {
            throw new Error("preview pathname must not read the cookie");
        });
        const { host, html } = await hydrate(createElement(InterestWidget, {
            tenantId: "hydration-1-malformed-cookie", listPrefix: "/my-list", strings: resolved.strings.catalog,
        }));
        expect(cookie).not.toHaveBeenCalled();
        expect(html).toContain('href="/_site/path-tenant/my-list"');
        expect(host.querySelector("a")!.getAttribute("href")).toBe("/_site/path-tenant/my-list");
    });

    for (const pathname of ["/about", "/_site/path-tenant/about"]) {
        it(`H4 InterestWidget/useTenantUrl: cookie fallback after mount, pathname wins (${pathname})`, async () => {
            route.pathname = pathname;
            document.cookie = "amodx_preview_base=%2F_site%2Fcookie-tenant; path=/";
            const { host, html } = await hydrate(createElement(InterestWidget, {
                tenantId: `hydration-1-${pathname}`, listPrefix: "/my-list", strings: resolved.strings.catalog,
            }));
            expect(html).toContain(`href="${pathname.startsWith("/_site/") ? "/_site/path-tenant" : ""}/my-list"`);
            expect(host.querySelector("a")!.getAttribute("href")).toBe(`${pathname.startsWith("/_site/") ? "/_site/path-tenant" : "/_site/cookie-tenant"}/my-list`);
        });
    }
});
