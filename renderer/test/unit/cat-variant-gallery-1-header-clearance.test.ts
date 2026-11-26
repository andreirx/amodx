// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import React, { createElement, act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

/**
 * CAT-VARIANT-GALLERY-1, ruling CVG1-HEADER-CLEARANCE — the pinned gallery clears the site header in EVERY supported
 * header configuration: editorial theme on/off × Top Bar on/off × every admin choice of `header.navHeight` (and absent)
 * × every admin choice of `header.navHeightScrolled` (and absent).
 *
 * Per configuration, the header height is measured from the REAL components, not from SitePage's formula:
 *  - the real site layout (`app/[siteId]/layout.tsx`, server render) gives the sticky header's markup. Each part is
 *    recognised by its exact classes and converted with Tailwind v4's own scale (`h-<n>` = n × 0.25rem; `text-xs` line
 *    height 1rem + `py-2` = 2rem; `border-b` 1px; `border-t-[3px]` 3px). A part this test does not know fails the row,
 *    so a new header part cannot slip in unmeasured;
 *  - the real Navbar, mounted in jsdom with the props the layout passes, scrolled past its 20px threshold, gives the
 *    scrolled bar height (the server render shows only the unscrolled one).
 * The gallery's `top` is read from the real catalog product page (SitePage + ProductImageGallery, server render). The
 * rem and px parts are compared separately (the header's rem parts grow with the visitor's root font size; borders
 * do not). Rule: the SERVER value (used before hydration and without JavaScript) = the taller header state with a
 * one-line Top Bar + exactly 1rem. Per configuration the test also binds `SITE_HEADER_SELECTOR` (what the gallery
 * measures after hydration) to the real header: exactly one element, the sticky wrapper that holds the Navbar.
 * A header whose height depends on its CONTENT (Top Bar line breaks, wrapping at the window width) is the browser's
 * measurement: test/unit/cat-variant-gallery-1-client.test.ts (the mechanism) and test/interest-e2e/cvg1-pinned.spec.mjs
 * (real geometry in Chromium).
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
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }), signIn: vi.fn() }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
// Not part of the sticky header, or inside the Navbar's fixed-height row (the interest widget): not under test.
vi.mock("@/components/SearchBar", () => ({ SearchBar: () => null }));
vi.mock("@/components/InterestShortlist", () => ({ InterestToggle: () => null, InterestListPage: () => null, InterestWidget: () => null }));
vi.mock("@/components/Providers", () => ({ Providers: ({ children }: any) => children }));
vi.mock("@/components/ThemeInjector", () => ({ ThemeInjector: () => null }));
vi.mock("@/components/Analytics", () => ({ Analytics: () => null }));
vi.mock("@/components/PaddleLoader", () => ({ PaddleLoader: () => null }));
vi.mock("@/components/FBPixel", () => ({ FBPixel: () => null }));
vi.mock("@/components/PopupManager", () => ({ PopupManager: () => null }));
vi.mock("@/components/RecaptchaProvider", () => ({ RecaptchaProvider: () => null }));
vi.mock("@/components/PageEffectWrapper", () => ({ PageEffectWrapper: () => null }));
vi.mock("@/components/ReferralCapture", () => ({ ReferralCapture: () => null }));
vi.mock("@/components/CookieConsent", () => ({ CookieConsent: () => null }));

import SiteLayout from "@/app/[siteId]/layout";
import { SitePage } from "@/components/SitePage";
import { Navbar } from "@/components/Navbar";
import { SITE_HEADER_SELECTOR } from "@/components/ProductImageGallery";

type Length = { rem: number; px: number };
const NAV_ROW = /^<div class="flex justify-between items-center transition-all duration-300 h-(\d+)">/;
const TOP_BAR = '<div class="bg-primary text-primary-foreground text-xs py-2 px-4 site-top-bar">';
const NAV_OPEN = '<nav class="border-b bg-background/80 backdrop-blur site-navbar">';

/** The sticky header of the rendered layout, measured part by part (unscrolled bar). Throws on an unknown part. */
function measureHeader(html: string): { unscrolled: Length; base: Length } {
    const open = html.match(/<div class="sticky top-0 z-50( border-t-\[3px\] border-primary)?">/);
    if (!open) throw new Error("no sticky header");
    const start = html.indexOf(open[0]) + open[0].length;
    const navAt = html.indexOf("<nav", start);
    const navEnd = html.indexOf("</nav>", navAt) + "</nav>".length;
    if (html.slice(navEnd, navEnd + 6) !== "</div>") throw new Error("an unknown part after the Navbar");
    const beforeNav = html.slice(start, navAt);
    let rem = 0, px = open[1] ? 3 : 0;
    if (beforeNav !== "") {
        if (!beforeNav.startsWith(TOP_BAR)) throw new Error(`an unknown part before the Navbar: ${beforeNav.slice(0, 80)}`);
        if (beforeNav.slice(TOP_BAR.length).includes('<div class="hidden md:block')) throw new Error("a Commerce Bar in the header");
        rem += 2;
    }
    const nav = html.slice(navAt, navEnd);
    if (!nav.startsWith(NAV_OPEN)) throw new Error(`unknown Navbar root: ${nav.slice(0, 80)}`);
    px += 1;
    const row = nav.slice(NAV_OPEN.length).replace(/^<div class="[^"]*">/, "").match(NAV_ROW);
    if (!row) throw new Error("the Navbar row has no h-<n> height");
    return { base: { rem, px }, unscrolled: { rem: rem + Number(row[1]) / 4, px } };
}

/** The Navbar row height after a scroll past its threshold, from the real Navbar (rem). */
function scrolledNavRem(header: Record<string, unknown>): number {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(Navbar, {
        siteName: "Atelier", navHeight: header.navHeight as string | undefined, navHeightScrolled: header.navHeightScrolled as string | undefined,
        strings: { navAllOf: "All {name}", navContact: "Contact", navToggleMenu: "Menu", navViewAll: "View all", navContactUs: "Contact us" },
    } as any)));
    Object.defineProperty(window, "scrollY", { value: 21, configurable: true });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    const cls = host.querySelector("nav > div > div")!.getAttribute("class")!;
    act(() => root.unmount());
    host.remove();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    const m = cls.match(/ h-(\d+)$/);
    if (!m) throw new Error(`scrolled Navbar row without h-<n>: ${cls}`);
    return Number(m[1]) / 4;
}

function tenant(extra: Record<string, unknown>) {
    return {
        id: "t1", name: "Atelier", domain: "t1.test", status: "LIVE", navLinks: [], footerLinks: [], integrations: {},
        urlPrefixes: URL_PREFIX_DEFAULTS, commerceEnabled: false, catalogMode: true, ...extra,
    };
}
const PRODUCT = {
    id: "p1", slug: "vase", title: "Vase", status: "active", categoryIds: [], attributes: [], imageLink: "https://img.test/red.jpg",
    variants: [{ id: "color", name: "Color", options: [{ value: "red", imageLink: "https://img.test/red.jpg" }] }],
};

async function galleryTop(config: Record<string, unknown>): Promise<Length> {
    dynamo.getTenantConfig.mockResolvedValue(config);
    dynamo.getProductBySlug.mockResolvedValue(PRODUCT);
    const html = renderToStaticMarkup(await SitePage({ siteId: "t1", slug: ["product", "vase"], preview: false, basePath: "", sessionToken: null, query: {}, cacheable: true }) as any);
    const m = html.match(/<div class="space-y-3 md:sticky md:self-start" style="top:calc\(([\d.]+)rem \+ (\d+)px\)">/);
    if (!m) throw new Error("no pinned gallery");
    return { rem: Number(m[1]), px: Number(m[2]) };
}

async function headerOf(config: Record<string, unknown>) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    const html = renderToStaticMarkup(await SiteLayout({ children: createElement("main", null, "page"), params: Promise.resolve({ siteId: "t1" }) }) as any);
    // Review-1: after hydration the gallery measures the element SITE_HEADER_SELECTOR finds. In the real layout that
    // must be exactly one element — the sticky header measured here, holding the Navbar.
    const found = new DOMParser().parseFromString(html, "text/html").querySelectorAll(SITE_HEADER_SELECTOR);
    if (found.length !== 1) throw new Error(`SITE_HEADER_SELECTOR finds ${found.length} elements`);
    if (!found[0].querySelector(":scope > nav") || !/^sticky top-0 z-50( border-t-\[3px\] border-primary)?$/.test(found[0].getAttribute("class") ?? "")) {
        throw new Error("SITE_HEADER_SELECTOR does not find the sticky header wrapper");
    }
    return measureHeader(html);
}

// The admin's choices (admin/src/pages/Settings.tsx, the two height selects) and "absent" (the Navbar's defaults).
const NAV_HEIGHTS = [undefined, "h-12", "h-14", "h-16", "h-20", "h-24", "h-28", "h-32", "h-36"];
const NAV_HEIGHTS_SCROLLED = [undefined, "h-10", "h-12", "h-14", "h-16", "h-20", "h-24"];
const CONFIGS = [false, true].flatMap((editorial) => [false, true].flatMap((topBar) => NAV_HEIGHTS.flatMap((navHeight) => NAV_HEIGHTS_SCROLLED.map((navHeightScrolled) => {
    const header: Record<string, unknown> = { ...(navHeight ? { navHeight } : {}), ...(navHeightScrolled ? { navHeightScrolled } : {}) };
    return {
        label: `editorial=${editorial} topBar=${topBar} navHeight=${navHeight ?? "(absent)"} navHeightScrolled=${navHeightScrolled ?? "(absent)"}`,
        header,
        config: tenant({
            theme: editorial ? { shape: "editorial" } : {},
            ...(topBar ? { topBar: { show: true, content: "Free samples" } } : {}),
            header,
        }),
    };
}))));

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
    dynamo.getAllCategories.mockResolvedValue([]);
    dynamo.getProductReviews.mockResolvedValue({ items: [], averageRating: 0, totalReviews: 0 });
});

describe("[cvg1-header] the pinned gallery clears the site header (CVG1-HEADER-CLEARANCE)", () => {
    it(`every supported header configuration (${CONFIGS.length}): gallery top = the taller header state + 1rem; the borders in px`, async () => {
        const failures: string[] = [];
        for (const { label, header: navConfig, config } of CONFIGS) {
            const header = await headerOf(config);
            const scrolled = { rem: header.base.rem + scrolledNavRem(navConfig), px: header.base.px };
            const tallest = { rem: Math.max(header.unscrolled.rem, scrolled.rem), px: header.base.px };
            const top = await galleryTop(config);
            if (top.rem < tallest.rem || top.px < tallest.px) failures.push(`${label}: top ${top.rem}rem+${top.px}px under the header ${tallest.rem}rem+${tallest.px}px`);
            else if (top.rem !== tallest.rem + 1 || top.px !== tallest.px) failures.push(`${label}: top ${top.rem}rem+${top.px}px is not the header ${tallest.rem}rem+${tallest.px}px + 1rem`);
        }
        expect(failures).toEqual([]);
    });

    it("positive control: the fixed offset of round 0 (top-24 = 6rem) is under the header in some configurations, so the row above can fail", async () => {
        let under = 0;
        for (const { header: navConfig, config } of CONFIGS) {
            const header = await headerOf(config);
            const scrolled = header.base.rem + scrolledNavRem(navConfig);
            if (6 * 16 < Math.max(header.unscrolled.rem, scrolled) * 16 + header.base.px) under++;
        }
        expect(under).toBeGreaterThan(0);
    });

    it("the measurement recognises the parts: the default header is the 4rem bar + 1px; with the Top Bar and the editorial border 6rem + 4px", async () => {
        expect(await headerOf(tenant({ header: {} }))).toEqual({ base: { rem: 0, px: 1 }, unscrolled: { rem: 4, px: 1 } });
        expect(await headerOf(tenant({ theme: { shape: "editorial" }, topBar: { show: true, content: "x" }, header: {} }))).toEqual({ base: { rem: 2, px: 4 }, unscrolled: { rem: 6, px: 4 } });
        expect(scrolledNavRem({})).toBe(3);                         // the Navbar's own scrolled default, h-12
        expect(() => measureHeader('<div class="sticky top-0 z-50"><div class="other"></div><nav class="border-b bg-background/80 backdrop-blur site-navbar"></nav></div>')).toThrow(/unknown part before/);
    });
});
