// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import React, { createElement, act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

/**
 * HEADER-COLOURS-1 (docs/slices/header-colours-1.md) — `header.backgroundColor` / `header.textColor`.
 *  - Server render of the REAL site layout (`app/[siteId]/layout.tsx`) per taxonomy row, for a content, a commerce and a
 *    catalog site: the `<nav>` opening tag, the Navbar element's props (what the RSC payload encodes), and every other
 *    byte of the layout (Top Bar, Commerce Bar, editorial border, page, footer) against the same tenant without colours.
 *  - The real Navbar mounted in jsdom with the style the layout gives: the desktop dropdown panel, the mobile panel and
 *    the scrolled state (the server render shows none of them) stay inside the styled `<nav>` and read its variables.
 * What the compiled CSS does with the variables is proven on the built stylesheet: serving-contract rows `hc1-*`.
 */

const dynamo = vi.hoisted(() => ({ getTenantConfig: vi.fn(), hasActivePopups: vi.fn(async () => false) }));
vi.mock("@/lib/dynamo", () => dynamo);
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }), signIn: vi.fn() }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
// Script and side-effect components of the layout, outside the header and the footer: not under test.
// The real cart context (the commerce Navbar and Commerce Bar read it); the session provider is replaced by the mock above.
vi.mock("@/components/Providers", async () => {
    const { CartProvider } = await import("@/context/CartContext");
    return { Providers: ({ children, tenantId, cartPrefix }: any) => createElement(CartProvider, { tenantId, cartPrefix: cartPrefix ?? "/cart", children }) };
});
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
import { Navbar } from "@/components/Navbar";

const NAV_OPEN = '<nav class="border-b bg-background/80 backdrop-blur site-navbar">';
const BG = "#f5f1ea", FG = "#1f2937";
const LINKS = [{ label: "Services", href: "/services", children: [{ label: "Design", href: "/design" }] }, { label: "About", href: "/about" }];

/** Three site kinds, each with every header part its kind can show (Top Bar; Commerce Bar on commerce; editorial border). */
const KINDS: Record<string, Record<string, unknown>> = {
    content: { commerceEnabled: false, topBar: { show: true, content: "Free advice" }, theme: { shape: "editorial" } },
    commerce: {
        commerceEnabled: true, topBar: { show: true, content: "Free shipping" },
        commerceBar: { enabled: true, phone: "+1 555 0100", socialLinks: [{ platform: "facebook", url: "https://fb.test/x" }], ctaButton: { text: "Shop", url: "/shop" } },
    },
    catalog: { commerceEnabled: false, catalogMode: true, topBar: { show: true, content: "New collection" } },
};
function tenant(kind: string, header?: Record<string, unknown>) {
    return {
        id: "t1", name: "Atelier", domain: "t1.test", status: "LIVE", navLinks: LINKS, footerLinks: [], integrations: {},
        urlPrefixes: URL_PREFIX_DEFAULTS, ...KINDS[kind], ...(header ? { header } : {}),
    };
}

/** The layout's element tree, walked without rendering (props as the RSC payload would encode them). */
function elements(node: any): any[] {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children)];
}
async function layout(config: Record<string, unknown>) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    const tree = await SiteLayout({ children: createElement("main", null, "page"), params: Promise.resolve({ siteId: "t1" }) });
    const navbars = elements(tree).filter((e) => e.type === Navbar);
    expect(navbars.length).toBe(1);
    const html = renderToStaticMarkup(tree as any);
    const navOpen = /<nav[^>]*>/.exec(html)![0];
    return { html, navOpen, navProps: navbars[0].props as Record<string, unknown> };
}

describe("HEADER-COLOURS-1 — the site layout (server render)", () => {
    for (const kind of Object.keys(KINDS)) {
        it(`[${kind}] both values absent: no style on the <nav>, no colorStyle prop — the layout is unchanged`, async () => {
            for (const header of [undefined, {}, { navHeight: "h-20" }]) {
                const page = await layout(tenant(kind, header));
                expect(page.navOpen, JSON.stringify(header)).toBe(NAV_OPEN);
                expect(Object.hasOwn(page.navProps, "colorStyle"), JSON.stringify(header)).toBe(false);
                expect(page.html).not.toContain("--color-");
            }
        });

        it(`[${kind}] an invalid value is ignored, as absent: the same bytes and props as no header colour`, async () => {
            const plain = await layout(tenant(kind, { navHeight: "h-20" }));
            for (const bad of ["red; x:y", "url(https://x.test/a.png)", "url(x)", "#12", "var(--x)", "", 5]) {
                const page = await layout(tenant(kind, { navHeight: "h-20", backgroundColor: bad, textColor: bad }));
                expect(page.html, JSON.stringify(bad)).toBe(plain.html);
                expect(Object.hasOwn(page.navProps, "colorStyle"), JSON.stringify(bad)).toBe(false);
            }
        });

        it(`[${kind}] both values valid: the <nav> re-declares the background and the two text variables; every other byte is unchanged (Top Bar, Commerce Bar, editorial border, page, footer)`, async () => {
            const plain = await layout(tenant(kind));
            const page = await layout(tenant(kind, { backgroundColor: BG, textColor: FG }));
            const style = `--color-background:${BG};--color-foreground:${FG};--color-muted-foreground:${FG}`;
            expect(page.navOpen).toBe(`<nav class="border-b bg-background/80 backdrop-blur site-navbar" style="${style}">`);
            expect(page.navProps.colorStyle).toEqual({ "--color-background": BG, "--color-foreground": FG, "--color-muted-foreground": FG });
            expect(page.html.split(page.navOpen).join(NAV_OPEN)).toBe(plain.html);
            expect(page.html.split("--color-").length - 1, "the variables occur only on the <nav>").toBe(3);
        });

        it(`[${kind}] only one value valid: only that one applies`, async () => {
            const bgOnly = await layout(tenant(kind, { backgroundColor: BG }));
            expect(bgOnly.navOpen).toBe(`<nav class="border-b bg-background/80 backdrop-blur site-navbar" style="--color-background:${BG}">`);
            expect(bgOnly.navProps.colorStyle).toEqual({ "--color-background": BG });
            const fgOnly = await layout(tenant(kind, { backgroundColor: "red; x:y", textColor: FG }));
            expect(fgOnly.navOpen).toBe(`<nav class="border-b bg-background/80 backdrop-blur site-navbar" style="--color-foreground:${FG};--color-muted-foreground:${FG}">`);
            expect(fgOnly.navProps.colorStyle).toEqual({ "--color-foreground": FG, "--color-muted-foreground": FG });
        });
    }

    it("control: the Top Bar and the Commerce Bar are present in the compared commerce markup (the comparison sees them)", async () => {
        const page = await layout(tenant("commerce", { backgroundColor: BG, textColor: FG }));
        expect(page.html).toContain("Free shipping");
        expect(page.html).toContain("+1 555 0100");
        const nav = page.html.indexOf("<nav"), top = page.html.indexOf("Free shipping"), bar = page.html.indexOf("+1 555 0100");
        expect(top).toBeLessThan(nav);                                   // both bars are siblings BEFORE the <nav>, outside it
        expect(bar).toBeLessThan(nav);
        expect(page.html.indexOf("</nav>")).toBeGreaterThan(nav);
    });
});

// ── the real Navbar in jsdom: the states the server render does not show ─────────────────────────────────────────────
const STYLE = { "--color-background": BG, "--color-foreground": FG, "--color-muted-foreground": FG } as React.CSSProperties;
const STRINGS = { navAllOf: "{label} (All)", navContact: "Contact", navToggleMenu: "Menu", navViewAll: "View all", navContactUs: "Contact us" };
let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});
function mount(props: Record<string, unknown>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(createElement(Navbar, { siteName: "Atelier", links: LINKS, strings: STRINGS, ...props } as any)); });
    return host.querySelector("nav")!;
}
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
const buttons = (t: string) => [...host.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === t);
const classesOf = (root: Element) => [...new Set([root, ...root.querySelectorAll("*")].flatMap((e) => (e.getAttribute("class") ?? "").split(/\s+/)).filter(Boolean))];
const colourClasses = (root: Element) => classesOf(root)
    .filter((c) => /^(hover:)?(text|bg)-/.test(c) && !/^text-(xs|sm|base|lg|xl|\d?xl|center|left|right)$/.test(c)).sort();
const declared = (nav: HTMLElement) => ["--color-background", "--color-foreground", "--color-muted-foreground"].map((v) => nav.style.getPropertyValue(v));

describe("HEADER-COLOURS-1 — the Navbar's panels and states (jsdom)", () => {
    it("no colorStyle: no style attribute on the <nav>", () => {
        const nav = mount({});
        expect(nav.hasAttribute("style")).toBe(false);
    });

    it("the desktop dropdown panel and the mobile panel are inside the styled <nav> and read its background; full and scrolled", () => {
        const nav = mount({ colorStyle: STYLE });
        expect(declared(nav)).toEqual([BG, FG, FG]);
        click(buttons("Services")[0]);                                                   // desktop dropdown open
        const dropdown = host.querySelector("div.absolute.top-full")!;
        expect(dropdown.getAttribute("class")).toContain(" bg-background ");
        expect(nav.contains(dropdown)).toBe(true);
        click(host.querySelector("button[aria-label]")!);                                // mobile menu open
        const mobile = host.querySelector("div.md\\:hidden.absolute")!;
        expect(mobile.getAttribute("class")!.split(" ")).toContain("bg-background");
        expect(nav.contains(mobile)).toBe(true);
        Object.defineProperty(window, "scrollY", { value: 21, configurable: true });
        act(() => { window.dispatchEvent(new Event("scroll")); });                       // scrolled state
        expect(host.querySelector("nav > div > div")!.getAttribute("class")).toMatch(/ h-12$/);
        expect(declared(host.querySelector("nav")!)).toEqual([BG, FG, FG]);              // same <nav>, same variables
        expect(host.querySelector("nav")!.contains(host.querySelector("div.md\\:hidden.absolute"))).toBe(true);
        // Every background inside the <nav>: the two re-declared surfaces, the theme's hover fill, the contact button.
        expect(colourClasses(nav).filter((c) => /^(hover:)?bg-/.test(c))).toEqual(["bg-background", "bg-background/80", "bg-primary", "hover:bg-muted", "hover:bg-muted/50"]);
    });

    it("text: the title, the links, the icons and the menu button read the re-declared variables; hover stays Primary; the contact button keeps Primary / Primary Text", () => {
        const nav = mount({ colorStyle: STYLE });
        click(buttons("Services")[0]);
        click(host.querySelector("button[aria-label]")!);
        // Every text colour in the open header: two re-declared variables, the theme's hover and the contact button's text.
        expect(colourClasses(nav).filter((c) => /^(hover:)?text-/.test(c))).toEqual(["hover:text-primary", "text-foreground", "text-muted-foreground", "text-primary-foreground"]);
        expect(host.querySelector("span.font-bold")!.getAttribute("class")).toContain("text-foreground");              // the title
        expect(host.querySelector("button[aria-label]")!.getAttribute("class")).toContain("text-foreground");          // the menu button
        for (const a of [...nav.querySelectorAll("a")].filter((a) => ["About", "Design", "Services (All)"].includes(a.textContent!.trim())))
            expect(a.getAttribute("class"), a.textContent!).toMatch(/text-muted-foreground hover:text-primary/);
        // Icons carry no colour class: they draw with `currentColor`, the colour of their button.
        for (const svg of nav.querySelectorAll("svg")) expect(colourClasses(svg), svg.outerHTML.slice(0, 60)).toEqual([]);
        for (const contact of [...nav.querySelectorAll("a")].filter((a) => /^Contact/.test(a.textContent!.trim())))
            expect(contact.getAttribute("class")).toMatch(/bg-primary text-primary-foreground/);
    });
});
