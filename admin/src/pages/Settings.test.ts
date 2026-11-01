import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

/**
 * CAT-ADMIN-1 (docs/slices/cat-admin-1.md § 4.5, CA-D2) — the page rendered per site kind with react-dom/server in
 * the admin's node test environment (no DOM). Replaced: the tenant and auth contexts, Amplify, `window` (the page
 * reads `window.AMODX_CONFIG` while rendering), and ONE test-only state seed — the page's only empty-object initial
 * state is `config` (`useState<Partial<TenantConfig>>({})`); the seed starts it as the fixture config, because
 * react-dom/server never runs the effect that loads `/settings`. `seed.config = null` leaves React untouched.
 */
const seed = vi.hoisted(() => ({ config: null as null | Record<string, unknown> }));
vi.mock("react", async (importOriginal) => {
    const React = await importOriginal<typeof import("react")>();
    const isEmptyObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0;
    const useState = ((init: unknown) => React.useState(seed.config && isEmptyObject(init) ? seed.config : init)) as typeof React.useState;
    return { ...React, default: { ...React, useState }, useState };
});
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ tenants: [], currentTenant: { id: "t", name: "T", domain: "t.test" }, selectTenant: () => {}, refreshTenants: async () => {} }),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ userRole: "TENANT_ADMIN" }) }));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));
// Review-0 R-CA-1: a preservation render takes no input from the build environment. The page reads
// `window.AMODX_CONFIG?.VITE_RENDERER_URL || import.meta.env.VITE_RENDERER_URL` while rendering (the preview links);
// the runtime config is read first, so fixing it here keeps `.env*` files and the shell out of the render. The value is
// the one the 3912c5d captures under __markup__/ were taken with (they were not re-captured).
vi.stubGlobal("window", { AMODX_CONFIG: { VITE_RENDERER_URL: "https://d111wtnnjzzsb1.cloudfront.net" } });

import SettingsPage, { localeStatus, withCountry, withSiteLanguage } from "./Settings";

/**
 * LOCALE-1A — the "Language & Country" card of Settings (docs/slices/locale-1.md § 3.5, § 7.2; review-0 R3, R4).
 * Expected values are the ratified behaviour written out, not computed by the resolver: Site language writes the
 * pack's default locale; the country Apply writes `countryCode` and `currency` only; the help line states the date
 * locale and the text language; a present value that falls back to en-US shows the warning.
 */

describe("Site language (§ 3.5)", () => {
    it("Romanian writes locale ro-RO; English writes en-US; no other field changes", () => {
        const config = { id: "t1", locale: "en-US", countryCode: "RO", currency: "RON", commerceStrings: { addToCart: "x" } };
        expect(withSiteLanguage(config, "ro")).toEqual({ ...config, locale: "ro-RO" });
        expect(withSiteLanguage({ ...config, locale: "ro-RO" }, "en")).toEqual({ ...config, locale: "en-US" });
    });
});

describe("Country Apply (§ 7.2: country facts only, never texts)", () => {
    it("RO → countryCode RO and currency RON; locale, texts, gdpr and legal links untouched", () => {
        const config = {
            id: "t1", locale: "en-US", countryCode: "EN", currency: "USD",
            commerceStrings: { addToCart: "Add" }, siteStrings: { navContact: "Contact" },
            gdpr: { enabled: true, headline: "H" }, legalLinks: { termsLabel: "T", termsUrl: "/t" },
        };
        expect(withCountry(config, "RO")).toEqual({ ...config, countryCode: "RO", currency: "RON" });
        expect(withCountry({ ...config, countryCode: "RO", currency: "RON" }, "EN")).toEqual({ ...config, countryCode: "EN", currency: "USD" });
    });
});

describe("Locale (advanced): the help line and the fallback warning (§ 3.5; review-0 R4)", () => {
    const cases: [unknown, string, string, boolean][] = [
        // stored value, "Dates:", "Texts:", warning
        [undefined, "en-US", "English", false],          // absent: the documented default, no warning
        ["en-US", "en-US", "English", false],
        ["ro-RO", "ro-RO", "Romanian", false],
        ["ro_RO", "ro-RO", "Romanian", false],
        ["en-GB", "en-GB", "English", false],
        ["de-DE", "de-DE", "English", false],             // a language without a pack: German dates, English texts
        ["en_US", "en-US", "English", false],             // a spelling of en-US: not a fallback
        ["", "en-US", "English", true],                   // present but blank → falls back → warning
        ["   ", "en-US", "English", true],
        ["xx-YY", "en-US", "English", true],
        ["123", "en-US", "English", true],
    ];
    for (const [stored, dates, texts, warning] of cases) {
        it(`${JSON.stringify(stored) ?? "absent"} → Dates: ${dates}. Texts: ${texts}.${warning ? " + warning" : ""}`, () => {
            const s = localeStatus(stored);
            expect(s.dates).toBe(dates);
            expect(s.languageName).toBe(texts);
            expect(s.fallbackWarning).toBe(warning);
        });
    }
});

const renderSettings = (config: Record<string, unknown>) => {
    seed.config = config;
    try {
        return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)));
    } finally {
        seed.config = null;
    }
};
/** The card titles, in page order (`CardTitle` renders `<div class="font-semibold leading-none tracking-tight">`). */
const cardTitles = (html: string) => [...html.matchAll(/<div class="[^"]*font-semibold leading-none[^"]*">([^<]+)<\/div>/g)].map((m) => m[1]);
/** The URL Prefixes card: its field labels and input values, in order. */
function prefixFields(html: string): { label: string; value: string }[] {
    const card = html.slice(html.indexOf(">URL Prefixes<"), html.indexOf("Existing links using old prefixes will stop working."));
    return [...card.matchAll(/<label[^>]*>([^<]+)<\/label><input[^>]*value="([^"]*)"/g)].map((m) => ({ label: m[1], value: m[2] }));
}

const CONTENT = { id: "t1", name: "Content", commerceEnabled: false, urlPrefixes: { ...URL_PREFIX_DEFAULTS }, integrations: { contactEmail: "owner@content.test" } };
const COMMERCE = {
    id: "t2", name: "Shop", commerceEnabled: true, currency: "RON", urlPrefixes: { ...URL_PREFIX_DEFAULTS, product: "/produs" },
    enabledPaymentMethods: ["cash_on_delivery", "bank_transfer"], searchBar: { enabled: true, placeholder: "Caută" },
    commerceBar: { enabled: true }, integrations: { contactEmail: "owner@shop.test" },
};
const CATALOG = {
    id: "t3", name: "Catalog", commerceEnabled: false, catalogMode: true, searchBar: { enabled: true, placeholder: "Search" },
    urlPrefixes: { ...URL_PREFIX_DEFAULTS, interest: "/my-list" }, integrations: { contactEmail: "owner@catalog.test" },
};

describe("Settings — a non-catalog site renders byte-equal to 3912c5d (rule 2)", () => {
    // The files under __markup__/ were written by the first run of this test on the unchanged tree (3912c5d).
    it("content site", async () => {
        await expect(renderSettings(CONTENT)).toMatchFileSnapshot("./__markup__/settings.content.html");
    });
    it("commerce site", async () => {
        await expect(renderSettings(COMMERCE)).toMatchFileSnapshot("./__markup__/settings.commerce.html");
    });
});

describe("Settings — the cards of each site kind (§ 4.5)", () => {
    it("catalog: the Catalog card with the design text and no control; no Commerce card", () => {
        const html = renderSettings(CATALOG);
        expect(cardTitles(html)).toContain("Catalog");
        expect(cardTitles(html)).not.toContain("Commerce");
        expect(html).toContain("A catalog site: products without prices, stock or ordering. Visitors collect an interest list and send it to the contact e-mail below (Notifications).");
        expect(html).not.toContain("Enable Commerce");
        // "below": the Notifications card (contact e-mail) follows the Catalog card.
        expect(cardTitles(html).indexOf("Notifications")).toBeGreaterThan(cardTitles(html).indexOf("Catalog"));
    });
    it("catalog: Digital Sales (Paddle) and Product Search shown; the commerce-only cards hidden", () => {
        const titles = cardTitles(renderSettings(CATALOG));
        expect(titles).toContain("Digital Sales (Paddle)");
        expect(titles).toContain("Product Search");
        for (const t of ["Commerce Bar", "Payment Methods", "Bank Transfer Details", "Order Celebration"]) expect(titles).not.toContain(t);
    });
    it("Product Search: shown under commerceEnabled or catalog, hidden on a content site", () => {
        expect(cardTitles(renderSettings(CONTENT))).not.toContain("Product Search");
        expect(cardTitles(renderSettings(COMMERCE))).toContain("Product Search");
        expect(cardTitles(renderSettings(CATALOG))).toContain("Product Search");
    });
    it("URL Prefixes on a catalog: product, category, shop, search, interest list (bound to urlPrefixes.interest) — CA-D2", () => {
        expect(prefixFields(renderSettings(CATALOG))).toEqual([
            { label: "Product", value: "/product" },
            { label: "Category", value: "/category" },
            { label: "Shop", value: "/shop" },
            { label: "Search", value: "/search" },
            { label: "Interest list", value: "/my-list" },
        ]);
    });
    it("URL Prefixes on a non-catalog site: the seven fields, unchanged; no interest list", () => {
        expect(prefixFields(renderSettings(CONTENT)).map((f) => f.label)).toEqual(["Product", "Category", "Cart", "Checkout", "Shop", "Account", "Search"]);
    });
});
