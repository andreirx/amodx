import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

/**
 * SHOP-LOOK-1A (docs/slices/shop-look-1a.md; design docs/slices/shop-look-1.md § 4, § 6) — the tagline, the category bar
 * and the footer's brand text and named columns, through the REAL site layout (`app/[siteId]/layout.tsx`) and the real
 * Navbar, server-rendered, for a content, a commerce and a catalog site. Per taxonomy row: the HTML, the Navbar element's
 * props (what the RSC payload encodes) and the footer element tree, against the same tenant without the fields. The read
 * `getActiveCategoriesByIds` is replaced (its own test: shop-look-1a-read.test.ts); what it was asked is asserted.
 * The running build's HTML and payload: serving-contract rows `sl1a-*`.
 */

type Bar = { id: string; name: string; slug: string };
const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(),
    hasActivePopups: vi.fn(async () => false),
    getActiveCategoriesByIds: vi.fn(async (_t: string, _ids: string[]) => [] as Bar[]),
}));
vi.mock("@/lib/dynamo", () => dynamo);
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }), signIn: vi.fn() }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
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

const LINKS = [{ label: "About", href: "/about" }];
/** Three site kinds; every footer column today's footer can show (company, links, legal), so the new grid holds them too. */
const KINDS: Record<string, Record<string, unknown>> = {
    content: { commerceEnabled: false },
    commerce: { commerceEnabled: true, commerceBar: { enabled: true, phone: "+1 555 0100" } },
    catalog: { commerceEnabled: false, catalogMode: true },
};
const FOOTER_TODAY = {
    companyDetails: { legalName: "Atelier SRL", address: "1 Example Street" },
    footerLinks: [{ label: "Blog", href: "/blog" }],
    legalLinks: { termsUrl: "/terms", privacyUrl: "/privacy" },
};
function tenant(kind: string, extra: { header?: Record<string, unknown>; footer?: Record<string, unknown>; urlPrefixes?: Record<string, string> } = {}) {
    return {
        id: "t1", name: "Atelier", domain: "t1.test", status: "LIVE", navLinks: LINKS, integrations: {}, urlPrefixes: URL_PREFIX_DEFAULTS,
        ...FOOTER_TODAY, ...KINDS[kind], ...extra,
    };
}

function elements(node: any): any[] {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children)];
}
async function layout(config: Record<string, unknown>) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    const tree = await SiteLayout({ children: createElement("main", null, "page"), params: Promise.resolve({ siteId: "t1" }) });
    const all = elements(tree);
    const navbars = all.filter((e) => e.type === Navbar);
    expect(navbars.length).toBe(1);
    const footer = all.find((e) => e.type === "footer");
    const html = renderToStaticMarkup(tree as any);
    return {
        html, navProps: navbars[0].props as Record<string, unknown>, footer,
        nav: html.slice(html.indexOf("<nav"), html.lastIndexOf("</nav>") + 6),
        footerHtml: html.slice(html.indexOf("<footer"), html.indexOf("</footer>") + 9),
    };
}
const NEW_PROPS = ["tagline", "categoryBar"];

beforeEach(() => {
    dynamo.getActiveCategoriesByIds.mockReset().mockImplementation(async (_t: string, ids: string[]) =>
        ids.filter((id) => id !== "gone").map((id) => ({ id, name: `Name ${id}`, slug: `${id}-slug` })));
});

describe("SHOP-LOOK-1A — absent = today's bytes", () => {
    for (const kind of Object.keys(KINDS)) {
        it(`[${kind}] no new field (no header, an old header, an old footer): no new prop, no read, the same HTML and footer tree as the base tenant`, async () => {
            const base = await layout(tenant(kind));
            for (const extra of [{ header: { navHeight: "h-20" } }, { header: { backgroundColor: "#f5f1ea" }, footer: { contentMaxWidth: "max-w-7xl" } }, {}]) {
                const page = await layout(tenant(kind, extra));
                for (const p of NEW_PROPS) expect(Object.hasOwn(page.navProps, p), `${p} ${JSON.stringify(extra)}`).toBe(false);
                expect(page.footerHtml).toBe(base.footerHtml);
            }
            expect(dynamo.getActiveCategoriesByIds).not.toHaveBeenCalled();
            expect(base.footerHtml).toContain('<div class="grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-muted-foreground">');
        });

        it(`[${kind}] blank and empty values draw as absent: a whitespace tagline, an empty id list, a blank brand text, an empty column list`, async () => {
            const base = await layout(tenant(kind));
            const page = await layout(tenant(kind, { header: { tagline: "   ", categoryBarIds: [] }, footer: { brandText: "  \n ", columns: [] } }));
            for (const p of NEW_PROPS) expect(Object.hasOwn(page.navProps, p), p).toBe(false);
            expect(page.html).toBe(base.html);
            expect(dynamo.getActiveCategoriesByIds).not.toHaveBeenCalled();
        });
    }
});

describe("SHOP-LOOK-1A — header.tagline", () => {
    for (const kind of Object.keys(KINDS)) {
        it(`[${kind}] present: the trimmed text, inside the logo link after the title, hidden below sm; the only change to the HTML`, async () => {
            const base = await layout(tenant(kind));
            const page = await layout(tenant(kind, { header: { tagline: "  Since 1998 " } }));
            expect(page.navProps.tagline).toBe("Since 1998");
            const span = '<span class="hidden sm:inline text-xs font-medium uppercase tracking-widest text-muted-foreground">Since 1998</span>';
            expect(page.html).toContain(`>Atelier</span>${span}</a>`);
            expect(page.html.split(span).join("")).toBe(base.html);
        });
    }
    it("with the title hidden, the tagline is beside the logo, still inside the logo link", async () => {
        const page = await layout({ ...tenant("content", { header: { showTitle: false, tagline: "Since 1998" } }), logo: "https://img.test/logo.png" });
        expect(page.html).toMatch(/<a href="\/" class="flex items-center gap-2"><img [^>]*><span class="hidden sm:inline[^"]*">Since 1998<\/span><\/a>/);
    });
});

describe("SHOP-LOOK-1A — header.categoryBarIds (SHOPLOOK-CATBAR = C)", () => {
    for (const kind of Object.keys(KINDS)) {
        it(`[${kind}] present: one read of the stored ids; a <nav aria-label="Categories"> inside the header <nav>, after row 1, with the links in the stored order on the category path`, async () => {
            const base = await layout(tenant(kind));
            const page = await layout(tenant(kind, { header: { categoryBarIds: ["c2", "c1"] } }));
            expect(dynamo.getActiveCategoriesByIds).toHaveBeenCalledTimes(1);
            expect(dynamo.getActiveCategoriesByIds).toHaveBeenCalledWith("t1", ["c2", "c1"]);
            expect(page.navProps.categoryBar).toEqual({ label: "Categories", links: [{ label: "Name c2", href: "/category/c2-slug" }, { label: "Name c1", href: "/category/c1-slug" }] });
            const bar = '<nav aria-label="Categories" class="border-t"><ul class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center gap-6 overflow-x-auto whitespace-nowrap py-2">'
                + '<li><a href="/category/c2-slug" class="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Name c2</a></li>'
                + '<li><a href="/category/c1-slug" class="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Name c1</a></li></ul></nav>';
            expect(page.html.split(bar).length - 1).toBe(1);
            expect(page.html.split(bar).join("")).toBe(base.html);
            expect(page.html.indexOf(bar)).toBeGreaterThan(page.html.indexOf("<nav class=\"border-b"));
            expect(page.html.indexOf(bar)).toBeLessThan(page.html.lastIndexOf("</nav>"));
        });
    }
    it("a skipped id (hidden or missing: the read drops it) leaves the others; every id skipped → no bar and no prop", async () => {
        const some = await layout(tenant("commerce", { header: { categoryBarIds: ["gone", "c1"] } }));
        expect((some.navProps.categoryBar as any).links).toEqual([{ label: "Name c1", href: "/category/c1-slug" }]);
        const none = await layout(tenant("commerce", { header: { categoryBarIds: ["gone"] } }));
        expect(Object.hasOwn(none.navProps, "categoryBar")).toBe(false);
        expect(none.html).toBe((await layout(tenant("commerce"))).html);
    });
    it("the tenant's own category path (urlPrefixes.category) and the tenant's language (navCategoryBarLabel)", async () => {
        const ro = await layout({ ...tenant("commerce", { header: { categoryBarIds: ["c1"] }, urlPrefixes: { ...URL_PREFIX_DEFAULTS, category: "/categorie" } }), locale: "ro-RO" });
        expect(ro.navProps.categoryBar).toEqual({ label: "Categorii", links: [{ label: "Name c1", href: "/categorie/c1-slug" }] });
        const own = await layout({ ...tenant("commerce", { header: { categoryBarIds: ["c1"] } }), siteStrings: { navCategoryBarLabel: "Shop by type" } });
        expect(own.html).toContain('<nav aria-label="Shop by type" class="border-t">');
    });
    it("the bar text is NOT in the Navbar's shared strings prop (every page's payload would change)", async () => {
        const page = await layout(tenant("content", { header: { categoryBarIds: ["c1"] } }));
        expect(Object.keys(page.navProps.strings as object).sort()).toEqual(["navAllOf", "navContact", "navContactUs", "navToggleMenu", "navViewAll"]);
    });
});

describe("SHOP-LOOK-1A — footer.brandText and footer.columns", () => {
    const COLUMNS = [
        { heading: "Explore", links: [{ label: "Guides", href: "/guides" }, { label: "Shop", href: "/shop" }] },
        { heading: "Company", links: [{ label: "About", href: "/about" }] },
    ];
    for (const kind of Object.keys(KINDS)) {
        it(`[${kind}] present: one grid element replaces today's grid in the same slot — brand text, named columns, then today's three columns; the copyright row unchanged`, async () => {
            const base = await layout(tenant(kind));
            const page = await layout(tenant(kind, { footer: { brandText: "Floors since 1998.\nFamily run.", columns: COLUMNS } }));
            // The footer element tree: the same two children of the width container, the first one replaced.
            const width = (f: any) => f.props.children;
            expect(width(page.footer).props.children.length).toBe(width(base.footer).props.children.length);
            expect(width(page.footer).props.children[1]).toEqual(width(base.footer).props.children[1]);
            const grid = '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-8 text-sm text-muted-foreground">';
            expect(page.footerHtml).toContain(grid
                + '<div><p class="whitespace-pre-line">Floors since 1998.\nFamily run.</p></div>'
                + '<div class="space-y-1"><p class="font-semibold text-foreground mb-2">Explore</p><a href="/guides" class="block hover:text-foreground">Guides</a><a href="/shop" class="block hover:text-foreground">Shop</a></div>'
                + '<div class="space-y-1"><p class="font-semibold text-foreground mb-2">Company</p><a href="/about" class="block hover:text-foreground">About</a></div>');
            // Today's three columns follow, byte for byte.
            const todayGridOpen = '<div class="grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-muted-foreground">';
            const todayColumns = base.footerHtml.slice(base.footerHtml.indexOf(todayGridOpen) + todayGridOpen.length, base.footerHtml.indexOf('<div class="mt-8'));
            expect(page.footerHtml).toContain(`About</a></div>${todayColumns}`);
            expect(page.footerHtml).not.toContain(todayGridOpen);
            // Outside the footer, nothing changed.
            expect(page.html.replace(page.footerHtml, "")).toBe(base.html.replace(base.footerHtml, ""));
        });
    }
    it("the lg column count is the number of columns drawn (literal classes 1-8); the phone is 1 column, 2 from sm", async () => {
        const count = async (footer: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
            /grid grid-cols-1 sm:grid-cols-2 (lg:grid-cols-\d)/.exec((await layout({ ...tenant("content", { footer }), ...extra })).footerHtml)?.[1];
        expect(await count({ brandText: "B" })).toBe("lg:grid-cols-4");                                       // brand + 3 today
        expect(await count({ columns: COLUMNS }, { companyDetails: undefined, footerLinks: [], legalLinks: undefined })).toBe("lg:grid-cols-2");
        expect(await count({ brandText: "B" }, { companyDetails: undefined, footerLinks: [], legalLinks: undefined })).toBe("lg:grid-cols-1");
        const four = [1, 2, 3, 4].map((n) => ({ heading: `H${n}`, links: [] }));
        expect(await count({ brandText: "B", columns: four })).toBe("lg:grid-cols-8");
    });
    it("brand text alone, or columns alone, each switch to the new grid; a column with no links draws its heading", async () => {
        const brandOnly = await layout(tenant("content", { footer: { brandText: "Brand" } }));
        expect(brandOnly.footerHtml).toContain('<div><p class="whitespace-pre-line">Brand</p></div>');
        const empty = await layout(tenant("content", { footer: { columns: [{ heading: "Soon", links: [] }] } }));
        expect(empty.footerHtml).toContain('<div class="space-y-1"><p class="font-semibold text-foreground mb-2">Soon</p></div>');
        expect(empty.footerHtml).not.toContain("whitespace-pre-line");
    });
    it("the footer colours still apply to the footer with the new grid (the <footer> element is the same)", async () => {
        const page = await layout(tenant("content", { footer: { backgroundColor: "#111111", brandText: "Brand" } }));
        expect(page.footerHtml.startsWith('<footer class="border-t py-12 bg-muted/30" style="background-color:#111111">')).toBe(true);
    });
});
