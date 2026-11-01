// The tracking page's status history formats its times with the server's time zone; pin it before any Date is made, so
// the start-commit capture below does not depend on the machine (Node applies a runtime TZ change).
process.env.TZ = "UTC";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { URL_PREFIX_DEFAULTS, fillTemplate, resolveLocaleStrings } from "@amodx/shared";
import { extractVisibleText, textChanges } from "../serving-contract/locale-1/extract.mjs";

/**
 * LOCALE-1D — headless server renders of the commerce-only surfaces (docs/slices/locale-1.md § 5.2, § 6.2, § 8.5):
 *  - the props `SitePage` and the layout pass to the commerce views, the add-to-cart control, the commerce bar and the
 *    navbar: exactly each view's keys, EN = the EN table, RO = the RO pack; the § 5.2 preservation cases of every F site
 *    (override absent / "" / "X") and of one D site per view; stored overrides keep winning (packet rule 2), including a
 *    Romanian shop's stored copies of the old country-pack texts; `formatLocale` only for a non-en-US tenant;
 *  - the four commerce-only titles;
 *  - the tracking page WITH a status history (the serving fixtures have none: its times depend on the time zone) — EN
 *    bytes equal to `locale-1d-server-before.json`, rendered by THIS file from 92adbba (capture mode
 *    `LOCALE_1D_SERVER_CAPTURE=<file>`), and every RO change explained by a declared key or formatted value.
 * Real: `SitePage`, the layout, the resolver. Mocked: the DynamoDB reads, Next's runtime-coupled modules, and the client
 * components whose PROPS are under test (they print their props).
 */

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(async () => null), getPosts: vi.fn(),
    getProductBySlug: vi.fn(), getCategoryBySlug: vi.fn(), getProductsByCategory: vi.fn(), getAllCategories: vi.fn(async () => []),
    getActiveProducts: vi.fn(), getCatalogListing: vi.fn(), searchProducts: vi.fn(), getDeliveryConfig: vi.fn(async () => null),
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
vi.mock("@/components/CartPageView", () => ({ CartPageView: probe("cart-view") }));
vi.mock("@/components/CheckoutPageView", () => ({ CheckoutPageView: probe("checkout-view") }));
vi.mock("@/components/AccountPageView", () => ({ AccountPageView: probe("account-view") }));
vi.mock("@/components/AddToCartButton", () => ({ AddToCartButton: probe("cart-probe") }));
vi.mock("@/components/FBPurchaseEvent", () => ({ FBPurchaseEvent: () => null }));
vi.mock("@/components/ProductImageGallery", () => ({ ProductImageGallery: () => null }));
vi.mock("@/components/SearchBar", () => ({ SearchBar: () => null }));
// The site layout: its children that are not under test; the commerce bar and the navbar print their props.
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }), signIn: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/Providers", () => ({ Providers: ({ children }: any) => children }));
vi.mock("@/components/ThemeInjector", () => ({ ThemeInjector: () => null }));
vi.mock("@/components/Analytics", () => ({ Analytics: () => null }));
vi.mock("@/components/PaddleLoader", () => ({ PaddleLoader: () => null }));
vi.mock("@/components/TopBar", () => ({ TopBar: () => null }));
vi.mock("@/components/CommerceBar", () => ({ CommerceBar: probe("bar-probe") }));
vi.mock("@/components/Navbar", () => ({ Navbar: probe("nav-probe") }));
vi.mock("@/components/FBPixel", () => ({ FBPixel: () => null }));
vi.mock("@/components/PopupManager", () => ({ PopupManager: () => null }));
vi.mock("@/components/RecaptchaProvider", () => ({ RecaptchaProvider: () => null }));
vi.mock("@/components/PageEffectWrapper", () => ({ PageEffectWrapper: () => null }));
vi.mock("@/components/ReferralCapture", () => ({ ReferralCapture: () => null }));
vi.mock("@/components/CookieConsent", () => ({ CookieConsent: () => null }));
vi.mock("@/components/QuickContact", () => ({ QuickContact: () => null }));

import SiteLayout from "@/app/[siteId]/layout";
import { SitePage, buildSitePageMetadata } from "@/components/SitePage";

const BEFORE_FILE = fileURLToPath(new URL("./locale-1d-server-before.json", import.meta.url));
const CAPTURE = process.env.LOCALE_1D_SERVER_CAPTURE;

function tenant(extra: Record<string, unknown> = {}) {
    return {
        id: "t1", name: "Atelier", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: URL_PREFIX_DEFAULTS, commerceEnabled: true, catalogMode: false, ...extra,
    };
}
const decoded = (html: string) => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const page = (slug: string[], query: Record<string, string> = {}) => SitePage({ siteId: "t1", slug, preview: false, basePath: "", sessionToken: null, query, cacheable: false });
/** The props of every `<tag>` the render printed. */
const probes = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag} data-props="([^"]*)"`, "g"))].map((m) => JSON.parse(decoded(m[1])));
async function viewProps(tag: "cart-view" | "checkout-view" | "account-view", config: Record<string, unknown>) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    const slug = { "cart-view": "cart", "checkout-view": "checkout", "account-view": "account" }[tag];
    const [p] = probes(renderToStaticMarkup(await page([slug]) as any), tag);
    if (!p) throw new Error(`${tag} not rendered`);
    return p;
}
async function addToCartProps(config: Record<string, unknown>) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    dynamo.getProductBySlug.mockResolvedValue({ id: "p1", title: "Rug", slug: "rug", price: "10.00", currency: "USD", availability: "in_stock", status: "active", variants: [], personalizations: [], volumePricing: [] });
    const [p] = probes(renderToStaticMarkup(await page(["product", "rug"]) as any), "cart-probe");
    return p;
}
async function layoutProps(config: Record<string, unknown>) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    const html = renderToStaticMarkup(await SiteLayout({ children: null, params: Promise.resolve({ siteId: "t1" }) }) as any);
    return { bar: probes(html, "bar-probe")[0], nav: probes(html, "nav-probe")[0] };
}

const ORDER = {
    id: "o1", orderNumber: "T-0007", status: "delivered", customerEmail: "a@b.test", currency: "USD", createdAt: "2026-10-15T12:00:00.000Z",
    trackingNumber: "AWB-7", total: "50.00", items: [{ productTitle: "Rug", quantity: 1, totalPrice: "50.00" }],
    statusHistory: ["placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled", "on_hold"].map((status, i) => ({
        status, timestamp: `2026-10-${String(15 + i).padStart(2, "0")}T0${i}:30:00.000Z`, ...(i === 3 ? { note: "AWB-7" } : {}),
    })),
};
async function trackingHtml(config: Record<string, unknown>) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    dynamo.getOrderForCustomer.mockResolvedValue(ORDER);
    return renderToString(await page(["checkout", "o1"], { email: "a@b.test" }) as any);
}

if (CAPTURE) {
    describe("[locale-1d] server capture", () => {
        it("writes the EN tracking page with a status history", async () => {
            writeFileSync(CAPTURE, JSON.stringify({ commit: process.env.LOCALE_1D_COMMIT ?? "", timeZone: process.env.TZ, states: { "track-history": await trackingHtml(tenant()) } }, null, 2) + "\n");
        });
    });
} else {
    const EN = resolveLocaleStrings({});
    const RO = resolveLocaleStrings({ locale: "ro-RO" });
    const pickOf = (table: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, table[k]]));
    const CART_KEYS = ["emptyCart", "emptyCartMessage", "continueShopping", "shoppingCart", "orderSummary", "remove", "couponCode", "apply", "subtotal", "discount", "shipping",
        "freeShipping", "total", "freeDeliveryFrom", "addMoreForFreeDelivery", "minimumOrder", "proceedToCheckout", "invalidCoupon", "couponValidateFailed"];
    const CHECKOUT_F = ["billingDetails", "firstName", "lastName", "birthday", "orderAsCompany", "companyName", "taxId", "taxIdPlaceholder", "registrationNumber",
        "registrationNumberPlaceholder", "vatNumber", "vatNumberPlaceholder", "useSameAsShipping", "billingAddress"];
    const CHECKOUT_D = ["checkout", "email", "phone", "phonePlaceholder", "birthdayHint", "shippingAddress", "country", "selectCountry", "streetAddress", "city", "county",
        "selectCounty", "postalCode", "deliveryNotes", "deliveryNotesPlaceholder", "preferredDeliveryDate", "paymentMethod", "cashOnDelivery", "cashOnDeliveryDesc",
        "bankTransfer", "bankTransferTo", "orderSummary", "subtotal", "discount", "shipping", "freeShipping", "total", "placingOrder", "placeOrder", "termsAgreement",
        "emptyCart", "checkoutEmptyMessage", "orderFailed", "orderFailedStatus", "deliveryDateSelected", "deliveryDatesLoading", "calendarMo", "calendarTu", "calendarWe",
        "calendarTh", "calendarFr", "calendarSa", "calendarSu"];
    const ACCOUNT_F = ["phone", "phonePlaceholder", "birthday"];
    const ACCOUNT_D = ["myAccount", "accountSignInPrompt", "signInWithGoogle", "signOut", "profileHeading", "edit", "accountName", "email", "birthdayHint", "save", "saving",
        "cancel", "loyaltyPoints", "defaultAddress", "orderHistory", "noOrdersYet", "startShopping", "orderStatusPlaced", "orderStatusConfirmed", "orderStatusPrepared",
        "orderStatusShipped", "orderStatusDelivered", "orderStatusCancelled", "orderStatusAnnulled"];
    const ATC_F = ["addToCart", "addedToCart", "viewCart", "outOfStock", "variantUnavailable"];
    const LANGS = [["EN", {}, EN], ["RO", { locale: "ro-RO" }, RO]] as const;

    describe("[1d-server] the commerce views get exactly their keys: EN = the EN table, RO = the RO pack", () => {
        beforeEach(() => { vi.clearAllMocks(); });
        for (const [name, locale, r] of LANGS) {
            it(`[1d-server] ${name}: cart, checkout, account and add-to-cart props`, async () => {
                const c = r.strings.commerce as Record<string, unknown>;
                expect((await viewProps("cart-view", tenant(locale))).strings).toEqual(pickOf(c, CART_KEYS));
                expect((await viewProps("checkout-view", tenant(locale))).strings).toEqual({ ...pickOf(c, [...CHECKOUT_D, ...CHECKOUT_F]), errorTryAgain: r.strings.site.errorTryAgain });
                expect((await viewProps("account-view", tenant(locale))).strings).toEqual(pickOf(c, [...ACCOUNT_D, ...ACCOUNT_F]));
                expect((await addToCartProps(tenant(locale))).strings).toEqual({ ...pickOf(c, [...ATC_F, "personalizationRequired", "variantRequired"]), formSelectPlaceholder: r.strings.site.formSelectPlaceholder });
            });
        }
        it("[1d-server] the RO values are the RO pack's (spot checks of the § 6.2 RO column), the EN values today's literals", async () => {
            const ro = (await viewProps("checkout-view", tenant({ locale: "ro-RO" }))).strings;
            expect([ro.emptyCart, ro.checkoutEmptyMessage, ro.orderFailedStatus, ro.calendarSa, ro.errorTryAgain]).toEqual(["Coșul tău este gol", "Adaugă produse înainte de a finaliza comanda.", "Comanda a eșuat ({status})", "Sâ", "A apărut o eroare. Încearcă din nou."]);
            const en = (await viewProps("checkout-view", tenant())).strings;
            expect([en.emptyCart, en.checkoutEmptyMessage, en.orderFailedStatus, en.calendarSa, en.errorTryAgain]).toEqual(["Your cart is empty", "Add some products before checking out.", "Order failed ({status})", "Sa", "Something went wrong. Please try again."]);
        });
    });

    describe("[1d-server] preservation (§ 5.2): F sites — absent → default, \"\" → default, \"X\" → X; D sites — \"\" → empty", () => {
        beforeEach(() => { vi.clearAllMocks(); });
        const cases: [string, "checkout-view" | "account-view" | "add-to-cart", string[], string][] = [
            ["checkout", "checkout-view", CHECKOUT_F, "checkout"], ["account", "account-view", ACCOUNT_F, "myAccount"], ["add-to-cart", "add-to-cart", ATC_F, "variantRequired"],
        ];
        for (const [name, locale, r] of LANGS) {
            for (const [view, tag, fKeys, dKey] of cases) {
                it(`[1d-server] ${name} ${view}: every F key and one D key`, async () => {
                    const props = (stored: Record<string, string>) => (tag === "add-to-cart" ? addToCartProps(tenant({ ...locale, commerceStrings: stored })) : viewProps(tag, tenant({ ...locale, commerceStrings: stored })));
                    const d = r.defaults.commerce as unknown as Record<string, string>;
                    const absent = (await props({})).strings, empty = (await props(Object.fromEntries([...fKeys, dKey].map((k) => [k, ""])))).strings;
                    const own = (await props(Object.fromEntries([...fKeys, dKey].map((k) => [k, `X-${k}`])))).strings;
                    for (const k of fKeys) {
                        expect(absent[k], k).toBe(d[k]);
                        expect(empty[k], k).toBe(d[k]);
                        expect(own[k], k).toBe(`X-${k}`);
                    }
                    expect(absent[dKey]).toBe(d[dKey]);
                    expect(empty[dKey]).toBe("");
                    expect(own[dKey]).toBe(`X-${dKey}`);
                });
            }
            it(`[1d-server] ${name} layout: the commerce bar's signIn / accountLabel are F, its cart total D; the navbar's account texts only on a commerce site`, async () => {
                const d = r.defaults.commerce;
                const withBar = (extra: Record<string, unknown>) => tenant({ ...locale, commerceBar: { enabled: true }, ...extra });
                expect((await layoutProps(withBar({}))).bar.labels).toEqual({ signIn: d.signIn, accountLabel: d.accountLabel, cartWidgetTotal: d.cartWidgetTotal });
                expect((await layoutProps(withBar({ commerceStrings: { signIn: "", accountLabel: "", cartWidgetTotal: "" } }))).bar.labels).toEqual({ signIn: d.signIn, accountLabel: d.accountLabel, cartWidgetTotal: "" });
                expect((await layoutProps(withBar({ commerceStrings: { signIn: "In", accountLabel: "Eu", cartWidgetTotal: "{total}" } }))).bar.labels).toEqual({ signIn: "In", accountLabel: "Eu", cartWidgetTotal: "{total}" });
                const { nav } = await layoutProps(tenant(locale));
                expect(nav.commerceStrings).toEqual({ signIn: d.signIn, accountLabel: d.accountLabel, myAccount: d.myAccount });
                expect(Object.hasOwn((await layoutProps(tenant({ ...locale, commerceEnabled: false }))).nav, "commerceStrings")).toBe(false);
            });
        }
    });

    describe("[1d-server] stored overrides keep winning (packet rule 2)", () => {
        beforeEach(() => { vi.clearAllMocks(); });
        it("[1d-server] a Romanian shop that stores copies of the old country-pack texts (\"Overwrite All Texts\") renders every stored text", async () => {
            // The start commit's RO country-pack texts (packages/shared/test/fixtures/locale-1d-packs-92adbba.json), stored with
            // two owner edits: before 1d these rendered on the commerce pages (defaults < stored); after 1d too.
            const start = JSON.parse(readFileSync(fileURLToPath(new URL("../../../packages/shared/test/fixtures/locale-1d-packs-92adbba.json", import.meta.url)), "utf8"));
            const stored: Record<string, string> = { ...start.countryPacks.RO.defaultStrings, checkout: "Comanda ta", emptyCart: "Nimic în coș" };
            const config = tenant({ locale: "ro-RO", countryCode: "RO", commerceStrings: stored });
            const all = { ...(await viewProps("cart-view", config)).strings, ...(await viewProps("checkout-view", config)).strings, ...(await viewProps("account-view", config)).strings, ...(await addToCartProps(config)).strings };
            const shown = Object.keys(stored).filter((k) => Object.hasOwn(all, k));
            expect(shown.length).toBeGreaterThan(40);
            for (const k of shown) expect(all[k], k).toBe(stored[k]);
        });
        it("[1d-server] an en-US shop with stored overrides: each stored key renders its stored text, as `{ ...English defaults, ...commerceStrings }` did", async () => {
            const stored = { checkout: "Pay", phone: "Mobile", addToCart: "Buy", invalidCoupon: "Nope", signIn: "Log in" };
            const config = tenant({ commerceStrings: stored });
            const all = { ...(await viewProps("cart-view", config)).strings, ...(await viewProps("checkout-view", config)).strings, ...(await addToCartProps(config)).strings };
            for (const [k, v] of Object.entries(stored).filter(([k]) => Object.hasOwn(all, k))) expect(all[k], k).toBe(v);
            expect((await layoutProps(tenant({ commerceStrings: stored }))).nav.commerceStrings.signIn).toBe("Log in");
        });
    });

    describe("[1d-server] formatLocale: only for a tenant whose normalised locale is not en-US (§ 16.2 item 4)", () => {
        beforeEach(() => { vi.clearAllMocks(); });
        it("[1d-server] absent / en-US / malformed → no prop (the formatters keep their defaults); ro-RO, de-DE → the locale", async () => {
            for (const tag of ["account-view", "checkout-view"] as const) {
                for (const locale of [undefined, "en-US", "en_US", "xx-YY"]) {
                    // mapTenant normalises `locale` before SitePage (lib/dynamo.ts); the resolver normalises again.
                    expect(Object.hasOwn(await viewProps(tag, tenant(locale === undefined ? {} : { locale })), "formatLocale"), `${tag} ${locale}`).toBe(false);
                }
                expect((await viewProps(tag, tenant({ locale: "ro-RO" }))).formatLocale).toBe("ro-RO");
                const de = await viewProps(tag, tenant({ locale: "de-DE" }));
                expect(de.formatLocale).toBe("de-DE");
                expect(de.strings.emptyCart ?? de.strings.myAccount).toBe(tag === "checkout-view" ? "Your cart is empty" : "My Account");
            }
        });
    });

    describe("[1d-server] the commerce-only titles (§ 6.2)", () => {
        it("[1d-server] cart, checkout, confirmation, tracking: EN today's titles, RO the RO pack", async () => {
            const titles = async (locale: Record<string, string>) => {
                dynamo.getTenantConfig.mockResolvedValue(tenant(locale));
                const out: unknown[] = [];
                for (const slug of [["cart"], ["checkout"], ["checkout", "confirmare"], ["checkout", "o1"]]) out.push((await buildSitePageMetadata({ siteId: "t1", slug, query: {} })).title);
                return out;
            };
            expect(await titles({})).toEqual(["Cart - Atelier", "Checkout - Atelier", "Order Confirmation - Atelier", "Order Tracking - Atelier"]);
            expect(await titles({ locale: "ro-RO" })).toEqual(["Coș - Atelier", "Finalizare comandă - Atelier", "Confirmare comandă - Atelier", "Urmărire comandă - Atelier"]);
        });
    });

    describe("[1d-server] the tracking page with a status history", () => {
        const before: { commit: string; timeZone: string; states: Record<string, string> } = JSON.parse(readFileSync(BEFORE_FILE, "utf8"));
        it("[1d-server] track-history: EN bytes equal the 92adbba capture (same time zone)", async () => {
            expect(before.commit).toBe("92adbba");
            expect(before.timeZone).toBe("UTC");
            expect(await trackingHtml(tenant())).toBe(before.states["track-history"]);
        });
        it("[1d-server] track-history: RO texts — every change is a declared key or formatted value; a status without a key stays raw", async () => {
            const en = extractVisibleText(await trackingHtml(tenant()));
            const ro = extractVisibleText(await trackingHtml(tenant({ locale: "ro-RO" })));
            const t = (r: typeof EN) => r.strings.commerce;
            const time = (iso: string, locale: string) => new Date(iso).toLocaleString(locale);
            type Spec = [string, (r: typeof EN, locale: string) => string];
            const specs: Spec[] = [
                ["orderNumber", (r) => fillTemplate(t(r).orderNumber, { number: ORDER.orderNumber })],
                ["placedOn", (r, l) => fillTemplate(t(r).placedOn, { date: new Date(ORDER.createdAt).toLocaleDateString(l) })],
                ...(["orderStepPending", "orderStepConfirmed", "orderStepProcessing", "orderStepShipped", "orderStepDelivered", "orderStepCompleted", "statusHistory",
                    "orderHistoryPlaced", "orderHistoryConfirmed", "orderHistoryPrepared", "orderHistoryShipped", "orderHistoryDelivered", "orderHistoryCancelled",
                    "orderHistoryAnnulled", "tracking", "items", "total"] as const).map((k): Spec => [k, (r) => t(r)[k]]),
                ["trackingNumber", (r) => t(r).trackingNumber],
                ...ORDER.statusHistory.map((e): Spec => [`time ${e.timestamp}`, (_r, l) => time(e.timestamp, l)]),
            ];
            const problems: string[] = [];
            const used = new Set<string>();
            for (const c of textChanges(en, ro)) {
                // Every spec with this exact pair is credited (a step and a history label can share one, e.g. "confirmed" → "confirmată").
                const matching = specs.filter(([, f]) => f(EN, "en-US") === c.from && f(RO, "ro-RO") === c.to);
                if (matching.length > 0) matching.forEach(([name]) => used.add(name)); else problems.push(`unexplained ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
            }
            for (const [name, f] of specs) if (f(EN, "en-US") !== f(RO, "ro-RO") && !used.has(name)) problems.push(`declared ${name} did not change`);
            expect(problems).toEqual([]);
            expect(ro.map((i) => i.text)).toContain("on_hold");                       // a legacy status: no key, rendered as stored
            expect(ro.map((i) => i.text)).toContain("- AWB-7");
        });
    });
}
