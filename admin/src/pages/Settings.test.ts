import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
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

import SettingsPage, { localeStatus, withCountry, withSiteLanguage, withContactForSave, ContactChannelsCard, COMMERCE_BAR_DESCRIPTION, COMMERCE_BAR_FALLBACK_NOTE } from "./Settings";

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

/**
 * CAT-QUOTE-1 — the preservation policy (operator ruling CQ-ADMIN-PRESERVATION = A, 2026-11-02): the __markup__ captures
 * stay the immutable 3912c5d artefacts, never regenerated; the comparison removes EXACTLY two named things and nothing
 * else:
 *   EXCLUSION 1 — the Contact channels card element: the markup of `ContactChannelsCard` rendered alone for the same
 *     config (it starts `<div class="rounded-xl border bg-card text-card-foreground shadow">` and holds the title
 *     "Contact channels"); it must occur exactly once;
 *   EXCLUSION 2 — the sentence appended to the Commerce Bar description, " " + COMMERCE_BAR_FALLBACK_NOTE, matched with
 *     the whole description text and its closing `</div>` (exactly once on a shop with the Commerce Bar on; never
 *     elsewhere).
 * Why not the base re-capture: a re-capture from 29a2282 cannot change these files (the base has no card), and a capture
 * from the candidate is forbidden; the comparison is therefore narrowed by these two named exclusions (record D-8).
 */
const EXCLUSION_2 = `${COMMERCE_BAR_DESCRIPTION} ${COMMERCE_BAR_FALLBACK_NOTE}</div>`;
function withoutCatQuote(html: string, config: Record<string, unknown>, notes: number): string {
    const card = renderToStaticMarkup(createElement(ContactChannelsCard, { config, setConfig: () => {} }));
    expect(card.startsWith('<div class="rounded-xl border bg-card text-card-foreground shadow">') && card.includes(">Contact channels<"), "EXCLUSION 1 is the card element").toBe(true);
    expect(html.split(card).length - 1, "EXCLUSION 1 occurs once").toBe(1);
    expect(html.split(EXCLUSION_2).length - 1, "EXCLUSION 2 occurrences").toBe(notes);
    return html.replace(card, "").split(EXCLUSION_2).join(`${COMMERCE_BAR_DESCRIPTION}</div>`);
}

describe("Settings — a non-catalog site renders byte-equal to 3912c5d (rule 2), minus the CAT-QUOTE-1 additions", () => {
    // The files under __markup__/ were written by the first run of this test on the unchanged tree (3912c5d).
    it("content site", async () => {
        await expect(withoutCatQuote(renderSettings(CONTENT), CONTENT, 0)).toMatchFileSnapshot("./__markup__/settings.content.html");
    });
    it("commerce site", async () => {
        await expect(withoutCatQuote(renderSettings(COMMERCE), COMMERCE, 1)).toMatchFileSnapshot("./__markup__/settings.commerce.html");
    });
    it("controls: any other mutation of the rendered page still fails — one attribute elsewhere, one text, one attribute inside the Commerce Bar card", async () => {
        const capture = (name: string) => readFileSync(new URL(`./__markup__/settings.${name}.html`, import.meta.url), "utf8");
        const content = renderSettings(CONTENT), commerce = renderSettings(COMMERCE);
        expect(withoutCatQuote(content, CONTENT, 0)).toBe(capture("content"));            // positive control
        expect(withoutCatQuote(commerce, COMMERCE, 1)).toBe(capture("commerce"));
        const once = (html: string, from: string, to: string) => { expect(html.split(from).length - 1, from).toBe(1); return html.replace(from, to); };
        const mutations: [string, string, Record<string, unknown>, number][] = [
            [once(content, 'placeholder="owner@client-site.com"', 'placeholder="owner@client-site.co"'), "content", CONTENT, 0],
            [once(content, ">Notifications<", ">Notificatons<"), "content", CONTENT, 0],
            [once(commerce, 'placeholder="0762 271 715"', 'placeholder="0762 271 716"'), "commerce", COMMERCE, 1],
        ];
        for (const [html, name, config, notes] of mutations) expect(withoutCatQuote(html, config, notes)).not.toBe(capture(name));
    });
});

describe("Settings — Contact channels (CAT-QUOTE-1)", () => {
    // Operator ruling R3 (2026-11-02): the card on every kind; "Send interest lists to" catalog-only (lists exist only there).
    it("the card on every site kind, before Notifications; the interest-list destination only on a catalog (ruling R3)", () => {
        for (const config of [CONTENT, COMMERCE, CATALOG]) {
            const titles = cardTitles(renderSettings(config));
            expect(titles.indexOf("Contact channels"), String(config.name)).toBeGreaterThan(-1);
            expect(titles.indexOf("Notifications") - titles.indexOf("Contact channels"), String(config.name)).toBe(1);
        }
        expect(renderSettings(CATALOG)).toContain("Send interest lists to");
        expect(renderSettings(CONTENT)).not.toContain("Send interest lists to");
        expect(renderSettings(COMMERCE)).not.toContain("Send interest lists to");
    });
    it("the inputs show the stored channels; the destination radio follows interestListEmail", () => {
        const html = renderSettings({ ...CATALOG, contactChannels: { phone: "0721 000", whatsapp: "40721", email: "office@catalog.test" } });
        const card = html.slice(html.indexOf(">Contact channels<"), html.indexOf(">Notifications<"));
        expect([...card.matchAll(/<input[^>]*value="([^"]*)"/g)].map((m) => m[1])).toEqual(["0721 000", "40721", "office@catalog.test"]);
        expect(card).toMatch(/<input type="radio" name="interest-list-email" checked=""\/>Visitor contact e-mail \(default\)/);
        const separate = renderSettings({ ...CATALOG, interestListEmail: "lists@catalog.test" });
        const card2 = separate.slice(separate.indexOf(">Contact channels<"), separate.indexOf(">Notifications<"));
        expect(card2).toMatch(/checked=""\/>A separate address/);
        expect(card2).toContain('value="lists@catalog.test"');
    });
    it("the card names the three surfaces that fall back to it (F-CQ-1: the Top Bar and Quick contact have no Settings control)", () => {
        expect(renderSettings(CONTENT)).toContain("Also used by the Top Bar, the Commerce Bar and the floating Quick contact when their own value is empty.");
    });
    it("the fallback note on the Commerce Bar card (the Top Bar and Quick contact have no Settings card)", () => {
        expect(renderSettings(COMMERCE)).toContain(">Utility bar above the navbar with phone, social links, cart total, and optional CTA button. Phone and WhatsApp: defaults from Contact channels when empty.</div>");
    });
});

describe("withContactForSave — the PUT body of the two contact attributes", () => {
    it("untouched attributes stay as loaded (absent stays absent): the body of a save without a change is unchanged", () => {
        expect(withContactForSave(CONTENT)).toEqual(CONTENT);
        const loaded = { ...CATALOG, contactChannels: { phone: "0721" }, interestListEmail: "lists@catalog.test" };
        expect(withContactForSave(loaded)).toEqual(loaded);
    });
    it("channels trimmed, an empty channel removed; {} when every channel was cleared", () => {
        expect(withContactForSave({ contactChannels: { phone: " 0721 000 ", whatsapp: "  ", email: "a@b.test " } })).toEqual({ contactChannels: { phone: "0721 000", email: "a@b.test" } });
        expect(withContactForSave({ contactChannels: { phone: "", email: "" } })).toEqual({ contactChannels: {} });
    });
    it("the destination: the contact e-mail → null (removes the stored address); a separate address trimmed; left empty → null", () => {
        expect(withContactForSave({ interestListEmail: null })).toEqual({ interestListEmail: null });
        expect(withContactForSave({ interestListEmail: " lists@b.test " })).toEqual({ interestListEmail: "lists@b.test" });
        expect(withContactForSave({ interestListEmail: "  " })).toEqual({ interestListEmail: null });
    });
});

describe("Settings — the cards of each site kind (§ 4.5)", () => {
    it("catalog: the Catalog card with the design text and no control; no Commerce card", () => {
        const html = renderSettings(CATALOG);
        expect(cardTitles(html)).toContain("Catalog");
        expect(cardTitles(html)).not.toContain("Commerce");
        // CAT-QUOTE-1 (ruling R4): the text names Contact channels → "Send interest lists to" and the default fallback.
        expect(html).toContain("A catalog site: products without prices, stock or ordering. Visitors collect an interest list and send it to the address chosen in Contact channels → Send interest lists to (by default the visitor contact e-mail, Notifications → Contact Email).");
        expect(html).not.toContain("contact e-mail below (Notifications)");
        expect(html).not.toContain("Enable Commerce");
        // Both cards it names follow the Catalog card.
        expect(cardTitles(html).indexOf("Contact channels")).toBeGreaterThan(cardTitles(html).indexOf("Catalog"));
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
    it("URL Prefixes copy on a catalog says catalog, not commerce (CAT-ADMIN-2, F-CA-IMPL-2; non-catalog: the captures above)", () => {
        const html = renderSettings(CATALOG);
        expect(html).toContain("Configure URL paths for catalog pages. Must start with &quot;/&quot; (e.g. &quot;/produs&quot; or &quot;/product&quot;).");
        expect(html).toContain("Changing these will update how catalog URLs are generated and resolved. Existing links using old prefixes will stop working.");
        expect(html).not.toContain("commerce pages");
        expect(html).not.toContain("commerce URLs");
    });
});
