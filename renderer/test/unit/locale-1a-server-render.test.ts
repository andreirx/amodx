import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { URL_PREFIX_DEFAULTS, RO_PACK } from "@amodx/shared";

/**
 * LOCALE-1A — headless server renders of the site chrome (docs/slices/locale-1.md § 8.5 "client-only states" and the
 * rebuttal's headless fallback): the states the serving-contract fixtures do not reach — footer company lines,
 * footer links and legal links, the meta description fallback, restricted pages, pagination, comments — rendered with
 * `react-dom/server` for an EN (en-US) and a RO tenant, plus the § 5.2 preservation cases (override absent / "" / "X").
 *
 * Real: `app/[siteId]/layout.tsx`, `SitePage`, `Navbar`, `QuickContact`, `CommentsSection`, the shared resolver.
 * Mocked: the DynamoDB reads (`@/lib/dynamo`, the only external boundary), Next's runtime-coupled modules, and the
 * layout children that are not under test. `CookieConsent` is replaced by a probe that prints the props the layout
 * passes (the banner itself renders only in a browser; its texts are checked in locale-1a-client.test.ts).
 */

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), hasActivePopups: vi.fn(async () => false), getContentBySlug: vi.fn(), getPosts: vi.fn(),
    getProductBySlug: vi.fn(), getCategoryBySlug: vi.fn(), getProductsByCategory: vi.fn(), getAllCategories: vi.fn(async () => []),
    getActiveProducts: vi.fn(), getCatalogListing: vi.fn(), searchProducts: vi.fn(), getDeliveryConfig: vi.fn(),
    getOrderForCustomer: vi.fn(), getProductReviews: vi.fn(async () => ({ items: [], averageRating: 0, totalReviews: 0 })), getSiteReviews: vi.fn(),
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
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
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
vi.mock("@/components/RenderBlocks", () => ({ RenderBlocks: () => null }));
vi.mock("@/components/CookieConsent", () => ({
    CookieConsent: ({ config }: any) => React.createElement("cookie-probe", { "data-config": JSON.stringify(config) }),
}));

import SiteLayout, { generateMetadata } from "@/app/[siteId]/layout";
import { SitePage } from "@/components/SitePage";

const EN = { locale: "en-US" };
const RO = { locale: "ro-RO" };
function tenant(extra: Record<string, unknown> = {}) {
    return {
        id: "t1", name: "Atelier", domain: "t1.test", status: "LIVE", plan: "Pro", header: { showLogo: true, showTitle: true },
        navLinks: [], footerLinks: [], theme: {}, integrations: {}, urlPrefixes: URL_PREFIX_DEFAULTS, commerceEnabled: false,
        catalogMode: false, hideSocialSharing: false, ...extra,
    };
}
const FULL_FOOTER = {
    companyDetails: { legalName: "Atelier SRL", cui: "RO123", tradeRegister: "J40/1/2020", phone: "+40 700" },
    footerLinks: [{ label: "Blog", href: "/blog" }],
    legalLinks: { termsUrl: "/t", privacyUrl: "/p", anpcUrl: "https://anpc", anpcSalUrl: "https://sal" },
    quickContact: { type: "phone", value: "+40 700" },
};

async function layoutHtml(config: Record<string, unknown>) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    const el = await SiteLayout({ children: React.createElement("main", null, "page"), params: Promise.resolve({ siteId: "t1" }) });
    return renderToStaticMarkup(el as any);
}
const cookieProps = (html: string) => JSON.parse(/data-config="([^"]*)"/.exec(html)![1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
const decoded = (html: string) => html.replace(/<!-- -->/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

async function siteHtml(config: Record<string, unknown>, slug: string[], query: Record<string, string> = {}) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    const el = await SitePage({ siteId: "t1", slug, preview: false, basePath: "", sessionToken: null, query, cacheable: true });
    return renderToStaticMarkup(el as any);
}
const page = (extra: Record<string, unknown>) => ({
    id: "c1", nodeId: "n1", slug: "/members", title: "Members", status: "Published", blocks: [], commentsMode: "Hidden",
    accessPolicy: { type: "Public" }, ...extra,
});

beforeEach(() => {
    for (const fn of Object.values(dynamo)) (fn as any).mockClear?.();
});

describe("[1a-server] layout: footer, legal links, copyright, quick contact, navbar (EN and RO)", () => {
    it("[1a-server] EN tenant: footer company lines, headings, legal labels, copyright — today's English texts", async () => {
        const html = decoded(await layoutHtml(tenant({ ...EN, ...FULL_FOOTER })));
        for (const text of ["CUI: RO123", "Reg: J40/1/2020", "Tel: +40 700", ">Links<", ">Legal<", ">Terms & Conditions<",
            ">Privacy Policy<", ">Consumer Protection<", ">Dispute Resolution<", "All rights reserved.", 'title="Call us"', ">Contact<", 'aria-label="Toggle menu"']) {
            expect(html, text).toContain(text);
        }
        expect(html).toMatch(/© \d{4} Atelier SRL\. All rights reserved\./);
    });

    it("[1a-server] RO tenant: the same states in Romanian (site keys of § 6.1, legal labels from the RO pack)", async () => {
        const html = decoded(await layoutHtml(tenant({ ...RO, ...FULL_FOOTER })));
        for (const text of ["CUI: RO123", "Reg. Com.: J40/1/2020", "Tel: +40 700", ">Linkuri<", ">Informații legale<",
            `>${RO_PACK.legal.termsLabel}<`, `>${RO_PACK.legal.privacyLabel}<`, `>${RO_PACK.legal.consumerProtectionLabel}<`,
            `>${RO_PACK.legal.disputeResolutionLabel}<`, 'title="Sună-ne"', ">Contact<", 'aria-label="Deschide sau închide meniul"']) {
            expect(html, text).toContain(text);
        }
        expect(html).toMatch(/© \d{4} Atelier SRL\. Toate drepturile rezervate\./);
    });

    it("[1a-server] the copyright year stays its own text node (the CM1-A1 footer-year canonicalisation still matches)", async () => {
        // renderToString (not renderToStaticMarkup) emits the `<!-- -->` text separators, as Next's server render does.
        dynamo.getTenantConfig.mockResolvedValue(tenant(EN));
        const raw = renderToString(await SiteLayout({ children: null, params: Promise.resolve({ siteId: "t1" }) }) as any);
        expect(raw).toMatch(/<p>© <!-- -->\d{4}<!-- --> <!-- -->Atelier<!-- -->\. All rights reserved\.<\/p>/);
    });

    it("[1a-server] quick contact email title, EN and RO; the tenant label wins", async () => {
        expect(await layoutHtml(tenant({ ...EN, quickContact: { type: "email", value: "a@b.c" } }))).toContain('title="Email us"');
        expect(await layoutHtml(tenant({ ...RO, quickContact: { type: "email", value: "a@b.c" } }))).toContain('title="Scrie-ne"');
        expect(await layoutHtml(tenant({ ...RO, quickContact: { type: "phone", value: "1", label: "Sunați" } }))).toContain('title="Sunați"');
    });

    it("[1a-server] cookie banner props: EN = today's EN-pack texts; RO = the RO pack; position and colour unchanged", async () => {
        expect(cookieProps(await layoutHtml(tenant({ ...EN, theme: { primaryColor: "#123456" } })))).toEqual({
            headline: "We value your privacy",
            description: "We use cookies to enhance your browsing experience and analyze our traffic. Choose your preference below.",
            denyAll: "Deny All", necessaryOnly: "Necessary Only", acceptAll: "Accept All", position: "bottom", primaryColor: "#123456",
        });
        expect(cookieProps(await layoutHtml(tenant({ ...RO, gdpr: { position: "top" } })))).toEqual({
            headline: RO_PACK.gdpr.headline, description: RO_PACK.gdpr.description, denyAll: RO_PACK.gdpr.denyAll,
            necessaryOnly: RO_PACK.gdpr.necessaryOnly, acceptAll: RO_PACK.gdpr.acceptAll, position: "top",
        });
    });

    it("[1a-server] preservation (§ 5.2): cookie/legal keys are pattern F — absent → default, \"\" → default, \"X\" → X", async () => {
        for (const config of [EN, RO]) {
            const def = config === EN ? "Accept All" : RO_PACK.gdpr.acceptAll;
            const defTerms = config === EN ? "Terms & Conditions" : RO_PACK.legal.termsLabel;
            const links = { termsUrl: "/t" };
            expect(cookieProps(await layoutHtml(tenant({ ...config }))).acceptAll).toBe(def);
            expect(cookieProps(await layoutHtml(tenant({ ...config, gdpr: { acceptAll: "" } }))).acceptAll).toBe(def);
            expect(cookieProps(await layoutHtml(tenant({ ...config, gdpr: { acceptAll: "Da" } }))).acceptAll).toBe("Da");
            expect(decoded(await layoutHtml(tenant({ ...config, legalLinks: { ...links, termsLabel: "" } })))).toContain(`>${defTerms}<`);
            expect(decoded(await layoutHtml(tenant({ ...config, legalLinks: { ...links, termsLabel: "Reguli" } })))).toContain(">Reguli<");
        }
    });

    it("[1a-server] preservation (§ 5.2): a new site key is pattern D — absent → default, \"\" → empty, \"X\" → X", async () => {
        for (const config of [EN, RO]) {
            const def = config === EN ? "Links" : "Linkuri";
            const withLinks = { ...config, footerLinks: [{ label: "Blog", href: "/blog" }] };
            expect(await layoutHtml(tenant(withLinks))).toContain(`mb-2">${def}</p>`);
            expect(await layoutHtml(tenant({ ...withLinks, siteStrings: { footerLinksHeading: "" } }))).toContain('mb-2"></p>');
            expect(await layoutHtml(tenant({ ...withLinks, siteStrings: { footerLinksHeading: "Pagini" } }))).toContain('mb-2">Pagini</p>');
        }
    });

    it("[1a-server] meta description fallback (metaSiteDescription), EN and RO; a set description wins", async () => {
        dynamo.getTenantConfig.mockResolvedValue(tenant(EN));
        expect((await generateMetadata({ params: Promise.resolve({ siteId: "t1" }) })).description).toBe("Official site for Atelier");
        dynamo.getTenantConfig.mockResolvedValue(tenant(RO));
        expect((await generateMetadata({ params: Promise.resolve({ siteId: "t1" }) })).description).toBe("Site-ul oficial Atelier");
        dynamo.getTenantConfig.mockResolvedValue(tenant({ ...RO, description: "Despre noi" }));
        expect((await generateMetadata({ params: Promise.resolve({ siteId: "t1" }) })).description).toBe("Despre noi");
    });
});

describe("[1a-server] SitePage: restricted page, pagination, breadcrumb, comments (EN and RO)", () => {
    it("[1a-server] restricted page, sign-in required: title, message, sign-in button", async () => {
        dynamo.getContentBySlug.mockResolvedValue(page({ accessPolicy: { type: "LoginRequired" } }));
        const en = decoded(await siteHtml(tenant(EN), ["members"]));
        for (const t of ["Restricted Access", "You must be logged in to view this page.", "Log In with Google"]) expect(en).toContain(t);
        const ro = decoded(await siteHtml(tenant(RO), ["members"]));
        for (const t of ["Acces restricționat", "Trebuie să fii autentificat pentru a vedea această pagină.", "Autentificare cu Google"]) expect(ro).toContain(t);
    });

    it("[1a-server] restricted page, purchase: subscription message with currency and price, purchase button", async () => {
        dynamo.getContentBySlug.mockResolvedValue(page({ accessPolicy: { type: "Purchase", currency: "USD", price: "9" } }));
        const en = decoded(await siteHtml(tenant(EN), ["members"]));
        expect(en).toContain("This content requires a subscription (USD 9).");
        expect(en).toContain("Purchase Access");
        const ro = decoded(await siteHtml(tenant(RO), ["members"]));
        expect(ro).toContain("Acest conținut necesită un abonament (USD 9).");
        expect(ro).toContain("Cumpără accesul");
    });

    it("[1a-server] pagination on page 2 of 3, and the breadcrumb Home, on a category page", async () => {
        dynamo.getCategoryBySlug.mockResolvedValue({ id: "cat", slug: "rugs", name: "Rugs" });
        dynamo.getProductsByCategory.mockResolvedValue({ items: [], total: 60 });
        const en = decoded(await siteHtml(tenant(EN), ["category", "rugs"], { page: "2" }));
        for (const t of [">Previous<", "Page 2 of 3", ">Next<", ">Home<"]) expect(en, t).toContain(t);
        const ro = decoded(await siteHtml(tenant(RO), ["category", "rugs"], { page: "2" }));
        for (const t of [">Anterior<", "Pagina 2 din 3", ">Următor<", ">Acasă<"]) expect(ro, t).toContain(t);
    });

    it("[1a-server] preservation (§ 5.2) at a page-chrome D site: paginationNext \"\" renders empty, \"X\" renders X", async () => {
        dynamo.getCategoryBySlug.mockResolvedValue({ id: "cat", slug: "rugs", name: "Rugs" });
        dynamo.getProductsByCategory.mockResolvedValue({ items: [], total: 60 });
        expect(await siteHtml(tenant({ ...RO, siteStrings: { paginationNext: "" } }), ["category", "rugs"], { page: "2" })).toContain('hover:bg-muted"></a>');
        expect(await siteHtml(tenant({ ...RO, siteStrings: { paginationNext: "Mai departe" } }), ["category", "rugs"], { page: "2" })).toContain(">Mai departe</a>");
    });

    it("[1a-server] breadcrumb Home on the search and product pages", async () => {
        dynamo.searchProducts.mockResolvedValue({ items: [], total: 0 });
        expect(decoded(await siteHtml(tenant(RO), ["search"], { q: "x" }))).toContain(">Acasă<");
        dynamo.getProductBySlug.mockResolvedValue({ id: "p1", slug: "rug", title: "Rug", price: "1", currency: "USD", status: "active", categoryIds: [], variants: [], personalizations: [], volumePricing: [], additionalImageLinks: [] });
        expect(decoded(await siteHtml(tenant(EN), ["product", "rug"]))).toContain(">Home<");
        expect(decoded(await siteHtml(tenant(RO), ["product", "rug"]))).toContain(">Acasă<");
    });

    it("[1a-server] comments, signed out (server render): heading with count, empty list, join, sign-in", async () => {
        dynamo.getContentBySlug.mockResolvedValue(page({ commentsMode: "Enabled" }));
        const en = decoded(await siteHtml(tenant(EN), ["members"]));
        for (const t of ["Discussion (0)", "No comments yet. Be the first!", "Join the conversation", "Sign in with Google"]) expect(en, t).toContain(t);
        const ro = decoded(await siteHtml(tenant(RO), ["members"]));
        for (const t of ["Discuție (0)", "Niciun comentariu încă. Fii primul!", "Alătură-te discuției", "Autentificare cu Google"]) expect(ro, t).toContain(t);
    });
});

// ── review-0 R3: the full § 5.2 preservation matrix, expected values written out (§ 6.1 EN column; `country-packs/ro.ts`
// for the nine RO cookie/legal values; § 6.1 RO column, as shipped in `language-packs/ro.ts`, for the others). ────────
const F_KEYS = {
    // key: [stored home, field, EN default, RO default]
    cookieHeadline: ["gdpr", "headline", "We value your privacy", "Respectăm confidențialitatea ta"],
    cookieDescription: ["gdpr", "description", "We use cookies to enhance your browsing experience and analyze our traffic. Choose your preference below.",
        "Folosim cookie-uri pentru a îmbunătăți experiența ta de navigare și pentru a analiza traficul. Alege preferința ta mai jos."],
    cookieDenyAll: ["gdpr", "denyAll", "Deny All", "Refuză toate"],
    cookieNecessaryOnly: ["gdpr", "necessaryOnly", "Necessary Only", "Doar necesare"],
    cookieAcceptAll: ["gdpr", "acceptAll", "Accept All", "Acceptă toate"],
    legalTermsLabel: ["legalLinks", "termsLabel", "Terms & Conditions", "Termeni și condiții"],
    legalPrivacyLabel: ["legalLinks", "privacyLabel", "Privacy Policy", "Politica de confidențialitate"],
    legalConsumerProtectionLabel: ["legalLinks", "anpcLabel", "Consumer Protection", "ANPC"],
    legalDisputeResolutionLabel: ["legalLinks", "anpcSalLabel", "Dispute Resolution", "Soluționare alternativă a litigiilor"],
} as const;
const COOKIE_PROP = { headline: "headline", description: "description", denyAll: "denyAll", necessaryOnly: "necessaryOnly", acceptAll: "acceptAll" } as const;
const LEGAL_URLS = { termsUrl: "/t", privacyUrl: "/p", anpcUrl: "https://anpc", anpcSalUrl: "https://sal" };
/** The rendered text of the footer legal link for `field`, by its URL (the link order is fixed in layout.tsx). */
const LEGAL_HREF = { termsLabel: "/t", privacyLabel: "/p", anpcLabel: "https://anpc", anpcSalLabel: "https://sal" } as const;
function legalText(html: string, field: keyof typeof LEGAL_HREF): string {
    const m = new RegExp(`<a href="${LEGAL_HREF[field].replace(/[/.]/g, "\\$&")}"[^>]*>([^<]*)</a>`).exec(html);
    if (!m) throw new Error(`no legal link for ${field}`);
    return m[1].replace(/&amp;/g, "&");
}
async function fReading(key: keyof typeof F_KEYS, config: Record<string, unknown>): Promise<string> {
    const [home, field] = F_KEYS[key];
    const html = await layoutHtml(tenant({ ...config, legalLinks: { ...LEGAL_URLS, ...((config.legalLinks as object) ?? {}) } }));
    return home === "gdpr" ? cookieProps(html)[COOKIE_PROP[field as keyof typeof COOKIE_PROP]] : legalText(html, field as keyof typeof LEGAL_HREF);
}

describe("[1a-server] § 5.2 pattern F — the nine cookie/legal readers: absent → default, \"\" → default, \"X\" → X (EN and RO)", () => {
    for (const [key, [home, field, en, ro]] of Object.entries(F_KEYS) as [keyof typeof F_KEYS, readonly [string, string, string, string]][]) {
        for (const [lang, locale, def] of [["EN", "en-US", en], ["RO", "ro-RO", ro]] as const) {
            it(`[1a-server] F ${key} (${home}.${field}), ${lang}`, async () => {
                expect(await fReading(key, { locale })).toBe(def);
                expect(await fReading(key, { locale, [home]: { [field]: "" } })).toBe(def);
                expect(await fReading(key, { locale, [home]: { [field]: "Own text" } })).toBe("Own text");
                // never read from siteStrings, even when a script wrote it there
                expect(await fReading(key, { locale, siteStrings: { [key]: "From siteStrings" } })).toBe(def);
            });
        }
    }
});

describe("[1a-server] § 5.2 pattern D — one direct reader per server-rendered component: absent → default, \"\" → empty, \"X\" → X (EN and RO)", () => {
    for (const [lang, locale, contact, call, empty] of [
        ["EN", "en-US", "Contact", "Call us", "No comments yet. Be the first!"],
        ["RO", "ro-RO", "Contact", "Sună-ne", "Niciun comentariu încă. Fii primul!"],
    ] as const) {
        const CONTACT = (text: string) => `shadow-sm">${text}</a>`;
        it(`[1a-server] D Navbar navContact, ${lang}`, async () => {
            expect(await layoutHtml(tenant({ locale }))).toContain(CONTACT(contact));
            expect(await layoutHtml(tenant({ locale, siteStrings: { navContact: "" } }))).toContain(CONTACT(""));
            expect(await layoutHtml(tenant({ locale, siteStrings: { navContact: "Write to us" } }))).toContain(CONTACT("Write to us"));
        });
        it(`[1a-server] D QuickContact quickContactCall, ${lang}`, async () => {
            const qc = { quickContact: { type: "phone", value: "1" } };
            expect(await layoutHtml(tenant({ locale, ...qc }))).toContain(`title="${call}"`);
            expect(await layoutHtml(tenant({ locale, ...qc, siteStrings: { quickContactCall: "" } }))).toContain('title=""');
            expect(await layoutHtml(tenant({ locale, ...qc, siteStrings: { quickContactCall: "Ring" } }))).toContain('title="Ring"');
        });
        it(`[1a-server] D CommentsSection commentsEmpty (server render), ${lang}`, async () => {
            dynamo.getContentBySlug.mockResolvedValue(page({ commentsMode: "Enabled" }));
            const EMPTY = (text: string) => `italic">${text}</p>`;
            expect(await siteHtml(tenant({ locale }), ["members"])).toContain(EMPTY(empty));
            expect(await siteHtml(tenant({ locale, siteStrings: { commentsEmpty: "" } }), ["members"])).toContain(EMPTY(""));
            expect(await siteHtml(tenant({ locale, siteStrings: { commentsEmpty: "Be first" } }), ["members"])).toContain(EMPTY("Be first"));
        });
    }
});
