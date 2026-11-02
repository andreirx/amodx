// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveLocaleStrings } from "@amodx/shared";

/**
 * CAT-THEME-1 (docs/slices/cat-theme-1-impl.md) — the client side of the new theme fields:
 *  - ThemeInjector (server markup): the font request (400;700 ∪ the listed weights, ascending; the nav font as one
 *    more family), the two colours, `--font-nav`, the heading weight rule and the editorial rules; absent or invalid
 *    values add nothing (the byte identity of whole pages is the serving suite's `loc1-diff-theme-1`);
 *  - Navbar and CommerceBar (mounted in jsdom): the nav-font class on the two item containers, and the arrow marker
 *    `data-theme-arrow` on exactly the text links and buttons the record names — and nowhere without the props.
 * Mocked: Next's link, NextAuth's session, the cart context and the tenant URL helper; the components are real.
 */

const cart = vi.hoisted(() => ({ state: { itemCount: 0, subtotal: 0, cartPrefix: "/cart" } as Record<string, unknown> }));
vi.mock("@/context/CartContext", () => ({ useCart: () => cart.state }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }), signIn: () => {}, signOut: () => {} }));
vi.mock("@/lib/routing", () => ({ useTenantUrl: () => ({ getUrl: (p: string) => p }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/" }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));

import { ThemeInjector } from "@/components/ThemeInjector";
import { Navbar } from "@/components/Navbar";
import { CommerceBar } from "@/components/CommerceBar";

const BASE = { primaryColor: "#111111", fontHeading: "Prata", fontBody: "Lato" };
const inject = (theme: Record<string, unknown>) => renderToStaticMarkup(createElement(ThemeInjector, { theme, tenantId: "t1" }));
const fontHref = (html: string) => /<link rel="preload" as="style" href="([^"]+)"/.exec(html.replace(/&amp;/g, "&"))?.[1];

describe("ThemeInjector — CAT-THEME-1 fields", () => {
    it("absent: the request is 400;700 for the two fonts; the injector's constants; no nav font, weight rule or editorial rule", () => {
        const html = inject(BASE);
        expect(fontHref(html)).toBe("https://fonts.googleapis.com/css2?family=Prata:wght@400;700&family=Lato:wght@400;700&display=swap");
        expect(html).toContain("--muted-foreground: #64748b !important;");
        expect(html).toContain("--border: #e2e8f0 !important;");
        expect(html).toContain("--input: #e2e8f0 !important;");
        for (const absent of ["--font-nav", "--section-gap", "font-weight:", "data-theme-arrow", "--tw-shadow"]) expect(html, absent).not.toContain(absent);
        expect(inject({ ...BASE, shape: "default" })).toBe(html);   // "default" = absent
        expect(inject({ ...BASE, cardImage: "landscape", cardCategoryLine: true })).toBe(html);   // card options: not the injector's
    });

    it("every field set: the weights ∪ 400;700 ascending for each family, the nav font as a third family, the colours, the rules", () => {
        const html = inject({ ...BASE, fontNav: "Inter", fontWeights: [500, 300, 700], headingWeight: 300, mutedColor: "#6b6b6b", borderColor: "rgb(212, 212, 212)", shape: "editorial" });
        expect(fontHref(html)).toBe("https://fonts.googleapis.com/css2?family=Prata:wght@300;400;500;700&family=Lato:wght@300;400;500;700&family=Inter:wght@300;400;500;700&display=swap");
        expect(html).toContain("--muted-foreground: #6b6b6b !important;");
        expect(html).toContain("--border: rgb(212, 212, 212) !important;");
        expect(html).toContain("--input: rgb(212, 212, 212) !important;");
        expect(html).toContain("--font-nav: 'Inter', sans-serif !important;");
        expect(html).toContain("--section-gap: 6rem !important;");
        expect(html).toMatch(/h1, h2, h3, h4, h5, h6 \{\s*font-weight: 300;\s*\}/);
        expect(html).toMatch(/\*, ::before, ::after \{\s*--tw-shadow: 0 0 #0000 !important;\s*--tw-drop-shadow: initial !important;\s*\}/);
        expect(html).toMatch(/\[data-theme-arrow\]::after, \[data-quote-request\]::after \{\s*content: " \\2197";\s*\}/);
    });

    it("a nav font equal to another theme font is requested once", () => {
        expect(fontHref(inject({ ...BASE, fontNav: "Prata" }))).toBe("https://fonts.googleapis.com/css2?family=Prata:wght@400;700&family=Lato:wght@400;700&display=swap");
    });

    it("invalid stored values are ignored like the existing ones: bad weights dropped, a bad colour → the constant, a bad font → no nav font", () => {
        const html = inject({ ...BASE, fontNav: "Bad;Font", fontWeights: [50, "300", 1000, 600], headingWeight: 950, mutedColor: "red;}", borderColor: "url(x)", shape: "brutalist" });
        expect(fontHref(html)).toBe("https://fonts.googleapis.com/css2?family=Prata:wght@400;600;700&family=Lato:wght@400;600;700&display=swap");
        expect(html).toContain("--muted-foreground: #64748b !important;");
        expect(html).toContain("--border: #e2e8f0 !important;");
        for (const absent of ["--font-nav", "--section-gap", "font-weight:", "data-theme-arrow"]) expect(html, absent).not.toContain(absent);
    });
});

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });
function mount(el: React.ReactElement) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(el); });
}
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
const SITE = resolveLocaleStrings({}).strings.site;
const navStrings = { navAllOf: SITE.navAllOf, navContact: SITE.navContact, navToggleMenu: SITE.navToggleMenu, navViewAll: SITE.navViewAll, navContactUs: SITE.navContactUs };
const LINKS = [{ label: "Shop", href: "/shop" }, { label: "Services", href: "/services", children: [{ label: "Design", href: "/design" }] }];
/** The text of every element that carries the arrow marker, in document order. */
const marked = () => [...host.querySelectorAll("[data-theme-arrow]")].map((e) => (e.textContent ?? "").trim());
const NAV_FONT = "font-[family-name:var(--font-nav)]";

describe("Navbar — nav font and arrows (CAT-THEME-1)", () => {
    // The desktop and the mobile dropdown share ONE open-index state: open the mobile menu, then one "Services" toggle
    // opens both dropdowns.
    function openEverything() {
        click(host.querySelector(`button[aria-label="${SITE.navToggleMenu}"]`)!);
        click([...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Services")!);
    }

    it("without the props: no nav-font class and no marker anywhere, also with every menu open", () => {
        mount(createElement(Navbar, { siteName: "Site", links: LINKS, strings: navStrings }));
        openEverything();
        expect(host.innerHTML).not.toContain(NAV_FONT);
        expect(marked()).toEqual([]);
    });

    it("navFont: the desktop items and the mobile menu use the nav font; the site title does not", () => {
        mount(createElement(Navbar, { siteName: "Site", links: LINKS, strings: navStrings, navFont: true }));
        openEverything();
        const withFont = [...host.querySelectorAll(`[class~="${NAV_FONT}"]`)];
        expect(withFont.length).toBe(2);
        expect(withFont[0].className).toBe(`hidden md:flex items-center gap-8 ${NAV_FONT}`);
        expect(withFont[1].className).toBe(`space-y-1 px-4 pb-6 pt-2 ${NAV_FONT}`);
        expect(withFont.some((e) => e.contains(host.querySelector("span.font-bold")))).toBe(false);
    });

    it("linkArrows: exactly the text links, the dropdown items and the contact button (desktop and mobile); not the logo, the toggles or the menu button", () => {
        mount(createElement(Navbar, { siteName: "Site", links: LINKS, strings: navStrings, linkArrows: true }));
        openEverything();
        expect(marked()).toEqual([
            "Shop",                                                    // desktop simple link
            SITE.navAllOf.replace("{label}", "Services"), "Design",    // desktop dropdown items
            SITE.navContact,                                           // desktop contact button
            "Shop",                                                    // mobile simple link
            SITE.navViewAll, "Design",                                 // mobile dropdown items
            SITE.navContactUs,                                         // mobile contact button
        ]);
        expect(host.querySelector('a[href="/"]')!.hasAttribute("data-theme-arrow")).toBe(false);
        expect([...host.querySelectorAll("button")].some((b) => b.hasAttribute("data-theme-arrow"))).toBe(false);
    });
});

describe("CommerceBar — the CTA arrow (CAT-THEME-1)", () => {
    const props = { ctaButton: { text: "Order now", url: "/order" }, labels: { signIn: "Sign in", accountLabel: "Account", cartWidgetTotal: "{total}" } };
    it("ctaArrow marks the CTA only; without it nothing is marked", () => {
        mount(createElement(CommerceBar, props as any));
        expect(marked()).toEqual([]);
        act(() => root?.unmount()); document.body.innerHTML = "";
        mount(createElement(CommerceBar, { ...props, ctaArrow: true } as any));
        expect(marked()).toEqual(["Order now"]);
    });
});
