import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LANGUAGE_PACKS, URL_PREFIX_DEFAULTS } from "@amodx/shared";

/**
 * CAT-ADMIN-1 (docs/slices/cat-admin-1.md § 4.5, CA-D2) — the page rendered per site kind with react-dom/server in
 * the admin's node test environment (no DOM). Replaced: the tenant and auth contexts, Amplify, `window` (the page
 * reads `window.AMODX_CONFIG` while rendering), and ONE test-only state seed — the page's only empty-object initial
 * state is `config` (`useState<Partial<TenantConfig>>({})`); the seed starts it as the fixture config, because
 * react-dom/server never runs the effect that loads `/settings`. `seed.config = null` leaves React untouched.
 */
// CAT-THEME-1 (review-0 R-CT-3): `seed.tab` starts the page's theme tab (its only `useState("light")`, `Settings.tsx`
// `activeTab`) as "dark", so a connected render shows what the dark tab's controls read. `null` leaves it untouched.
// CDL-2 (review-0 CDL2-R3): `seed.capture`, when set, records what a headless save test needs and changes no output —
// every `setConfig` argument (the seeded state's setter; react-dom/server ignores a call after the render, so the test
// applies the recorded updater itself, as React would), and the props of every `Input` and `Button` rendered (the
// wrappers below render the real component with the same props). `null` = no recording.
type Capture = { configUpdates: unknown[]; inputs: Record<string, any>[]; buttons: Record<string, any>[] };
const seed = vi.hoisted(() => ({ config: null as null | Record<string, unknown>, tab: null as null | "dark", capture: null as null | Capture }));
vi.mock("react", async (importOriginal) => {
    const React = await importOriginal<typeof import("react")>();
    const isEmptyObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0;
    const useState = ((init: unknown) => {
        const seeded = !!seed.config && isEmptyObject(init);
        const [value, set] = React.useState(seeded ? seed.config : seed.tab && init === "light" ? seed.tab : init);
        const capture = seed.capture;
        return seeded && capture ? [value, (u: unknown) => { capture.configUpdates.push(u); set(u as any); }] : [value, set];
    }) as typeof React.useState;
    return { ...React, default: { ...React, useState }, useState };
});
vi.mock("@/components/ui/input", async (importOriginal) => {
    const real = await importOriginal<typeof import("@/components/ui/input")>();
    const { createElement: h } = await import("react");
    return { ...real, Input: (props: any) => { seed.capture?.inputs.push(props); return h(real.Input, props); } };
});
vi.mock("@/components/ui/button", async (importOriginal) => {
    const real = await importOriginal<typeof import("@/components/ui/button")>();
    const { createElement: h } = await import("react");
    return { ...real, Button: (props: any) => { seed.capture?.buttons.push(props); return h(real.Button, props); } };
});
const api = vi.hoisted(() => ({ apiRequest: vi.fn(async (..._args: unknown[]) => ({})) }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), apiRequest: api.apiRequest }));
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

import SettingsPage, { localeStatus, withCountry, withSiteLanguage, withContactForSave, withThemeKey, withFooterKey, withHeaderKey, TypographyDetails, ThemeColorDetails, ShapeAndCards, FooterWidthControl, FooterColorControls, HeaderColorControls, HeaderTaglineAndCategoryBarControls, FooterBrandAndColumnsControls, HEADER_WIDTH_OPTIONS, PAGE_WIDTH_OPTIONS, LanguageListControls, MenuLanguageSelect, languageName, withLanguageAdded, withLanguageRemoved, linksFor, withLinksFor } from "./Settings";

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
    it("German and French (lang-1d; docs/slices/lang-1.md § 10) write de-DE and fr-FR with no admin code change; no other field changes", () => {
        const config = { id: "t1", locale: "en-US", commerceStrings: { addToCart: "x" } };
        expect(withSiteLanguage(config, "de")).toEqual({ ...config, locale: "de-DE" });
        expect(withSiteLanguage(config, "fr")).toEqual({ ...config, locale: "fr-FR" });
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
        ["de-DE", "de-DE", "German", false],              // a language with a pack (lang-1d): German dates, German texts
        ["fr-FR", "fr-FR", "French", false],              // a language with a pack (lang-1d): French dates, French texts
        ["es-ES", "es-ES", "English", false],             // a language without a pack: Spanish dates, English texts
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
    it("precondition of the es-ES case: es has no pack", () => {
        expect(Object.prototype.hasOwnProperty.call(LANGUAGE_PACKS, "es")).toBe(false);
    });
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
 * CAT-THEME-1 — the preservation policy (packet rule 4; record docs/slices/cat-theme-1-impl.md § 3). The two captures
 * under __markup__/ were RE-TAKEN ONCE from the base commit 0865ac6 (the raw page render of that commit's own test setup
 * — mocks, fixtures and `renderSettings` as in this file — in a throwaway worktree; never from the candidate). They
 * replace the 3912c5d artefacts, which cat-quote-1 compared minus its two named exclusions: 0865ac6 holds those
 * additions, so they are part of the capture now and are no longer excluded. The comparison removes EXACTLY the four
 * theme-detail groups this slice added, each as its own render for the same config (each a native-element or `Input`
 * group with no React `useId`, the LAST child of its parent, so the rest of the page and its ids are unchanged), and each
 * must occur exactly once:
 *   TypographyDetails (Typography card), ThemeColorDetails (Theme card, Palette), ShapeAndCards (Theme card, light tab),
 *   FooterWidthControl (Navbar & Layout card).
 * BULK-PURGE-FOOTER-1 (Part B rule 3; procedure of cat-theme-1-impl.md § 5) adds exactly ONE group, the new controls:
 *   FooterColorControls (Navbar & Layout card, right after the footer width; both share ONE child slot of the card — a
 *   fragment — because React's useId width depends on the parent's child count: a new sibling re-numbered the card's
 *   Radix Select ids, OBSERVED). The captures are NOT re-taken (they hold none of the new controls); the controls below
 *   include one byte next to this group.
 * HEADER-COLOURS-1 (docs/slices/header-colours-1.md; same procedure) adds exactly ONE group, the new controls:
 *   HeaderColorControls (Navbar & Layout card, first in the same fragment slot as the two footer groups, so the card's
 *   child count and its Radix ids are unchanged). The captures are NOT re-taken; the controls below include one byte next
 *   to this group.
 * SHOP-LOOK-1A (docs/slices/shop-look-1a.md; same procedure) adds exactly TWO groups, the new controls:
 *   HeaderTaglineAndCategoryBarControls (first in the same fragment slot; rendered with `categories: null`, as the page
 *   renders before its categories load) and FooterBrandAndColumnsControls (last in the slot). The captures are NOT
 *   re-taken; the controls below include one byte next to each group.
 * The three wider widths in the two width lists are Radix `SelectItem`s, which a closed Select does not render: they add
 * no byte; the lists are pinned below (`HEADER_WIDTH_OPTIONS`, `PAGE_WIDTH_OPTIONS`).
 */
const THEME_GROUPS = (config: Record<string, any>) => [
    renderToStaticMarkup(createElement(TypographyDetails, { theme: config.theme, onChange: () => {} })),
    renderToStaticMarkup(createElement(ThemeColorDetails, { theme: config.theme, onChange: () => {} })),
    renderToStaticMarkup(createElement(ShapeAndCards, { theme: config.theme, onChange: () => {} })),
    renderToStaticMarkup(createElement(FooterWidthControl, { config, setConfig: () => {} })),
    renderToStaticMarkup(createElement(FooterColorControls, { config, setConfig: () => {} })),
    renderToStaticMarkup(createElement(HeaderColorControls, { config, setConfig: () => {} })),
    renderToStaticMarkup(createElement(HeaderTaglineAndCategoryBarControls, { config, setConfig: () => {}, categories: null })),
    renderToStaticMarkup(createElement(FooterBrandAndColumnsControls, { config, setConfig: () => {} })),
];
function withoutCatTheme(html: string, config: Record<string, unknown>): string {
    let out = html;
    for (const group of THEME_GROUPS(config)) {
        expect(group.length, "a group renders markup").toBeGreaterThan(0);
        expect(out.split(group).length - 1, `the group occurs once: ${group.slice(0, 80)}`).toBe(1);
        out = out.replace(group, "");
    }
    return out;
}

/**
 * CDL-2 (docs/slices/catalog-data-labels-1.md § 14 item 2; record docs/slices/cdl-2.md) — ONE listed insertion: the
 * order-confirmation field (`urlPrefixes.checkoutConfirmation`), on a non-catalog site, directly after the Checkout field
 * (same condition as Cart and Checkout). The captures are NOT re-taken. The comparison removes EXACTLY this markup
 * (label, input class, placeholder = the default, value = the tenant's stored segment); it must occur exactly once and
 * directly after the Checkout field's closing tag, so every other byte of the page stays pinned. Plain elements, no React
 * `useId`: the rest of the page is unchanged.
 */
const INPUT_CLASS = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";
const LABEL_CLASS = "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70";
const confirmationField = (value: string) =>
    `<div class="space-y-2"><label class="${LABEL_CLASS}">Confirmation (after Checkout)</label><input class="${INPUT_CLASS}" placeholder="/confirmation" value="${value}"/></div>`;
function withoutCdl2(html: string, config: { urlPrefixes: Record<string, string> }): string {
    const field = confirmationField(config.urlPrefixes.checkoutConfirmation);
    const checkoutEnd = `placeholder="/checkout" value="${config.urlPrefixes.checkout}"/></div>`;
    expect(html.split(field).length - 1, "the confirmation field occurs once").toBe(1);
    expect(html.split(checkoutEnd + field).length - 1, "the confirmation field directly follows the Checkout field").toBe(1);
    return html.replace(field, "");
}

/**
 * LANG-1A (docs/slices/lang-1.md § 10; same procedure) — ONE listed insertion: the Languages controls
 * (`LanguageListControls`), shown for every site, as the LAST child of the "Language & Country" card's content, directly
 * after the Currency field. Native elements and `Input` only (no React `useId`); the card's content goes from 2 to 3
 * children, which keeps the width of React's tree ids, so no Radix id of the page moves (the comparison below would
 * fail otherwise). The captures are NOT re-taken. The comparison removes EXACTLY the group's own render for the same
 * config; it must occur exactly once and directly after the Currency field. The menu-language selector
 * (`MenuLanguageSelect`) renders only with extra languages, so it adds no byte to these fixtures.
 */
const CURRENCY_END = "Auto-filled from the country. Override if needed.</p></div></div>";
const languageGroup = (config: Record<string, unknown>) => renderToStaticMarkup(createElement(LanguageListControls, { config, setConfig: () => {} }));
function withoutLang1a(html: string, config: Record<string, unknown>): string {
    const group = languageGroup(config);
    expect(group.length, "the Languages group renders markup").toBeGreaterThan(0);
    expect(html.split(group).length - 1, "the Languages group occurs once").toBe(1);
    expect(html.split(CURRENCY_END + group).length - 1, "the Languages group directly follows the Currency field").toBe(1);
    return html.replace(group, "");
}

/**
 * ADMIN-ENGLISH-2 (packet rule 3; record docs/slices/admin-english-2.md § 3) — the example placeholders became English.
 * The captures are NOT re-taken: they keep the Romanian examples. The comparison replaces, in the CAPTURE text, exactly
 * the old example texts by the new ones; each must occur exactly `count` times in each capture (a replacement that
 * matches nothing, or more often, fails), so every other byte of the page stays pinned. The commerce fixture's VALUE
 * `/produs` (tenant data, `COMMERCE.urlPrefixes.product`) is not a placeholder and is not replaced.
 */
const ENGLISH_EXAMPLES: [from: string, to: string, count: number][] = [
    ['placeholder="Str. Example nr. 1, București"', 'placeholder="1 Example Street, Example City"', 1],
    [" (e.g. &quot;/produs&quot; or &quot;/product&quot;).", " (e.g. &quot;/product&quot;).", 1],
    ['placeholder="/produs"', 'placeholder="/product"', 1],
    ['placeholder="/categorie"', 'placeholder="/category"', 1],
    ['placeholder="/cos"', 'placeholder="/cart"', 1],
    ['placeholder="/comanda"', 'placeholder="/checkout"', 1],
    ['placeholder="/magazin"', 'placeholder="/shop"', 1],
];
/** The capture `settings.<name>.html` as stored, with the ENGLISH_EXAMPLES replacements applied (each count asserted). */
function capture(name: "content" | "commerce", replacements = ENGLISH_EXAMPLES): string {
    let out = readFileSync(new URL(`./__markup__/settings.${name}.html`, import.meta.url), "utf8");
    for (const [from, to, count] of replacements) {
        expect(out.split(from).length - 1, `${name} capture: ${from}`).toBe(count);
        out = out.split(from).join(to);
    }
    return out;
}

describe("Settings — a non-catalog site renders byte-equal to the 0865ac6 re-take (rule 4), minus the CAT-THEME-1 groups and the CDL-2 field, with the ADMIN-ENGLISH-2 example texts", () => {
    it("content site", () => {
        expect(withoutCatTheme(withoutCdl2(withoutLang1a(renderSettings(CONTENT), CONTENT), CONTENT), CONTENT)).toBe(capture("content"));
    });
    it("commerce site", () => {
        expect(withoutCatTheme(withoutCdl2(withoutLang1a(renderSettings(COMMERCE), COMMERCE), COMMERCE), COMMERCE)).toBe(capture("commerce"));
    });
    it("control (CDL-2): without the listed removal the comparison fails; a moved, doubled or changed field is refused", () => {
        for (const [name, config] of [["content", CONTENT], ["commerce", COMMERCE]] as const) {
            const html = renderSettings(config);
            expect(withoutCatTheme(html, config), name).not.toBe(capture(name));
            const field = confirmationField(config.urlPrefixes.checkoutConfirmation);
            const moved = html.replace(field, "").replace(">URL Prefixes<", `>URL Prefixes<${field}`);
            expect(() => withoutCdl2(moved, config), `${name} moved`).toThrow();
            expect(() => withoutCdl2(html.replace(field, field + field), config), `${name} doubled`).toThrow();
            expect(() => withoutCdl2(html.replace(field, field.replace('placeholder="/confirmation"', 'placeholder="/confirmations"')), config), `${name} changed`).toThrow();
        }
    });
    it("control (LANG-1A): without the listed removal the comparison fails; a moved, doubled or preceded group is refused; a byte after it fails", () => {
        for (const [name, config] of [["content", CONTENT], ["commerce", COMMERCE]] as const) {
            const html = renderSettings(config);
            const group = languageGroup(config);
            expect(withoutCatTheme(withoutCdl2(html, config), config), name).not.toBe(capture(name));
            const moved = html.replace(group, "").replace(">URL Prefixes<", `>URL Prefixes<${group}`);
            expect(() => withoutLang1a(moved, config), `${name} moved`).toThrow();
            expect(() => withoutLang1a(html.replace(group, group + group), config), `${name} doubled`).toThrow();
            expect(() => withoutLang1a(html.replace(CURRENCY_END, `${CURRENCY_END}<i></i>`), config), `${name} byte before`).toThrow();
            expect(withoutCatTheme(withoutCdl2(withoutLang1a(html.replace(group, `${group} `), config), config), config), `${name} byte after`).not.toBe(capture(name));
        }
    });
    it("control: with any one ADMIN-ENGLISH-2 replacement removed, the comparison fails", () => {
        const pages = [["content", renderSettings(CONTENT), CONTENT], ["commerce", renderSettings(COMMERCE), COMMERCE]] as const;
        for (const [name, html, config] of pages) {
            for (let i = 0; i < ENGLISH_EXAMPLES.length; i++) {
                const without = ENGLISH_EXAMPLES.filter((_, j) => j !== i);
                expect(withoutCatTheme(withoutCdl2(withoutLang1a(html, config), config), config), `${name} without ${ENGLISH_EXAMPLES[i][0]}`).not.toBe(capture(name, without));
            }
        }
    });
    it("controls: any other mutation of the rendered page still fails — one attribute elsewhere, one text, one attribute inside the Commerce Bar card, one byte next to a removed group", async () => {
        const content = renderSettings(CONTENT), commerce = renderSettings(COMMERCE);
        expect(withoutCatTheme(withoutCdl2(withoutLang1a(content, CONTENT), CONTENT), CONTENT)).toBe(capture("content"));            // positive control
        expect(withoutCatTheme(withoutCdl2(withoutLang1a(commerce, COMMERCE), COMMERCE), COMMERCE)).toBe(capture("commerce"));
        const once = (html: string, from: string, to: string) => { expect(html.split(from).length - 1, from).toBe(1); return html.replace(from, to); };
        const footer = THEME_GROUPS(CONTENT)[3];
        const footerColours = THEME_GROUPS(COMMERCE)[4];
        const headerColours = THEME_GROUPS(CONTENT)[5];
        const taglineAndBar = THEME_GROUPS(COMMERCE)[6];
        const brandAndColumns = THEME_GROUPS(CONTENT)[7];
        const mutations: [string, "content" | "commerce", Record<string, unknown>][] = [
            [once(commerce, footerColours, `${footerColours}<i></i>`), "commerce", COMMERCE],
            [once(content, headerColours, `${headerColours} `), "content", CONTENT],
            [once(commerce, headerColours, `<b></b>${headerColours}`), "commerce", COMMERCE],
            [once(commerce, taglineAndBar, `${taglineAndBar}<i></i>`), "commerce", COMMERCE],
            [once(content, brandAndColumns, ` ${brandAndColumns}`), "content", CONTENT],
            [once(content, 'placeholder="owner@client-site.com"', 'placeholder="owner@client-site.co"'), "content", CONTENT],
            [once(content, ">Notifications<", ">Notificatons<"), "content", CONTENT],
            [once(commerce, 'placeholder="0762 271 715"', 'placeholder="0762 271 716"'), "commerce", COMMERCE],
            [once(content, footer, `${footer} `), "content", CONTENT],
        ];
        for (const [html, name, config] of mutations) expect(withoutCatTheme(withoutCdl2(withoutLang1a(html, config), config as typeof CONTENT), config)).not.toBe(capture(name));
    });
});

/** The elements of a rendered component's tree (function components are not called; props are inspected). */
function elements(node: any): any[] {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children)];
}
const changes = () => { const calls: [string, unknown][] = []; return { calls, onChange: (k: string, v: unknown) => { calls.push([k, v]); } }; };

describe("Settings — the theme details (CAT-THEME-1)", () => {
    it("the groups are mounted where packet rule 4 places them, on every site kind", () => {
        for (const config of [CONTENT, COMMERCE, CATALOG]) {
            const html = renderSettings(config);
            const at = (needle: string) => { const i = html.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
            expect(at(">Nav Font (Google Fonts)<")).toBeGreaterThan(at(">Body Font (Google Fonts)<"));
            expect(at(">Additional Weights<")).toBeGreaterThan(at(">Nav Font (Google Fonts)<"));
            expect(at(">Heading Weight<")).toBeGreaterThan(at(">Additional Weights<"));
            expect(at(">Muted Text<")).toBeGreaterThan(at(">Surface<"));
            expect(at(">Hairlines<")).toBeGreaterThan(at(">Muted Text<"));
            expect(at(">Shape<")).toBeGreaterThan(at(">Hairlines<"));
            expect(at(">Cards<")).toBeGreaterThan(at(">Shape<"));
            expect(at(">Footer Width<")).toBeGreaterThan(at(">Home Page Slug<"));
            expect(at(">Footer Width<")).toBeLessThan(at(">Navbar &amp; Layout<") + 20000);
        }
    });
    it("the width lists: today's entries kept, 1440 / 1600 / 1920 offered for the header (and the footer) and the pages", () => {
        expect(HEADER_WIDTH_OPTIONS.map(([v]) => v)).toEqual(["max-w-5xl", "max-w-6xl", "max-w-7xl", "max-w-screen-xl", "max-w-[1440px]", "max-w-screen-2xl", "max-w-[1600px]", "max-w-[1700px]", "max-w-[1920px]", "max-w-full"]);
        expect(PAGE_WIDTH_OPTIONS.map(([v]) => v)).toEqual(["max-w-2xl", "max-w-3xl", "max-w-4xl", "max-w-5xl", "max-w-6xl", "max-w-7xl", "max-w-[1440px]", "max-w-[1600px]", "max-w-[1920px]"]);
        const footer = renderToStaticMarkup(createElement(FooterWidthControl, { config: {}, setConfig: () => {} }));
        expect([...footer.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(["", ...HEADER_WIDTH_OPTIONS.map(([v]) => v)]);
        expect(footer).toContain('<option value="" selected="">Same as header</option>');
    });
    it("the stored values are shown; absent shows the defaults (as today)", () => {
        const set = { fontNav: "Inter", fontWeights: [300, 500], headingWeight: 300, mutedColor: "#6b6b6b", borderColor: "#d4d4d4", shape: "editorial", cardImage: "landscape", cardCategoryLine: true };
        const typo = renderToStaticMarkup(createElement(TypographyDetails, { theme: set as any, onChange: () => {} }));
        expect(typo).toContain('value="Inter"');
        expect([...typo.matchAll(/<input type="checkbox" checked=""\/>(\d+)/g)].map((m) => m[1])).toEqual(["300", "500"]);
        expect(typo).toContain('<option value="300" selected="">300</option>');
        const colours = renderToStaticMarkup(createElement(ThemeColorDetails, { theme: set as any, onChange: () => {} }));
        expect(colours).toContain('value="#6b6b6b"');
        expect(colours).toContain('value="#d4d4d4"');
        const shape = renderToStaticMarkup(createElement(ShapeAndCards, { theme: set as any, onChange: () => {} }));
        expect(shape).toContain('<option value="editorial" selected="">');
        expect(shape).toContain('<option value="landscape" selected="">');
        expect(shape).toMatch(/<input type="checkbox" checked=""\/>/);
        const none = renderToStaticMarkup(createElement(ShapeAndCards, { theme: undefined, onChange: () => {} }));
        expect(none).toContain('<option value="default" selected="">Default</option>');
        expect(none).toContain('<option value="square" selected="">Square image</option>');
        expect(none).not.toContain('checked=""');
        expect(renderToStaticMarkup(createElement(TypographyDetails, { theme: undefined, onChange: () => {} }))).toContain('<option value="" selected="">Default (as today)</option>');
    });
    // Review-0 R-CT-3: the Typography controls read the theme the page writes (the selected tab). A connected render of
    // the real page with DIFFERENT light and dark values, on each tab; the write rule is `withThemeKey`, which the page's
    // `updateTheme` calls with the same tab (react-dom/server runs no events, so the click itself is not driven here).
    it("connected page: on each tab the Typography controls (heading, body, nav font, weights, heading weight) show THAT tab's theme", () => {
        const light = { fontHeading: "LightHead", fontBody: "LightBody", fontNav: "LightNav", fontWeights: [500], headingWeight: 300 };
        const dark = { fontHeading: "DarkHead", fontBody: "DarkBody", fontNav: "DarkNav", fontWeights: [800], headingWeight: 600 };
        const config = { ...CONTENT, theme: light, darkTheme: dark };
        const typographyOf = (html: string) => html.slice(html.indexOf(">Typography<"), html.indexOf("Light Mode"));
        const shown = (html: string) => {
            const card = typographyOf(html);
            return {
                inputs: [...card.matchAll(/<input[^>]*placeholder="[^"]*"[^>]*value="([^"]*)"/g)].map((m) => m[1]),
                weights: [...card.matchAll(/<input type="checkbox" checked=""\/>(\d+)/g)].map((m) => m[1]),
                heading: /<option value="(\d+)" selected="">/.exec(card)?.[1],
            };
        };
        expect(shown(renderSettings(config))).toEqual({ inputs: ["LightHead", "LightBody", "LightNav"], weights: ["500"], heading: "300" });
        seed.tab = "dark";
        try {
            const html = renderSettings(config);
            expect(html).toContain(">Dark Mode Overrides<");                      // precondition: the dark tab is selected
            expect(shown(html)).toEqual({ inputs: ["DarkHead", "DarkBody", "DarkNav"], weights: ["800"], heading: "600" });
            expect(typographyOf(html)).toContain(renderToStaticMarkup(createElement(TypographyDetails, { theme: dark as any, onChange: () => {} })));
        } finally {
            seed.tab = null;
        }
    });
    it("the write rule: the light tab writes theme, the dark tab writes darkTheme (a copy of theme when absent); the other is untouched", () => {
        const config = { theme: { fontWeights: [500] }, darkTheme: { fontWeights: [800] } } as any;
        expect(withThemeKey(config, "dark", "fontWeights", [300, 800])).toEqual({ theme: { fontWeights: [500] }, darkTheme: { fontWeights: [300, 800] } });
        expect(withThemeKey(config, "light", "fontNav", undefined)).toEqual({ theme: { fontWeights: [500], fontNav: undefined }, darkTheme: { fontWeights: [800] } });
        expect(withThemeKey({ theme: { fontNav: "A" } } as any, "dark", "headingWeight", 600)).toEqual({ theme: { fontNav: "A" }, darkTheme: { fontNav: "A", headingWeight: 600 } });
    });
    it("clearing a control removes its key (undefined); the weights are kept ascending; Same as header stores footer {}", () => {
        const c = changes();
        const typo = elements(TypographyDetails({ theme: { fontWeights: [500] } as any, onChange: c.onChange }));
        const boxes = typo.filter((e) => e.type === "input" && e.props.type === "checkbox");
        expect(boxes.length).toBe(7);
        boxes[2].props.onChange({ target: { checked: true } });                 // 300 on
        boxes[3].props.onChange({ target: { checked: false } });                // 500 off → empty list → removed
        const navFont = typo.find((e) => e.props?.placeholder === "Leave empty to keep the body font");
        navFont.props.onChange({ target: { value: "" } });
        const heading = typo.find((e) => e.type === "select");
        heading.props.onChange({ target: { value: "" } });
        heading.props.onChange({ target: { value: "600" } });
        expect(c.calls).toEqual([["fontWeights", [300, 500]], ["fontWeights", undefined], ["fontNav", undefined], ["headingWeight", undefined], ["headingWeight", 600]]);
        const s = changes();
        const shape = elements(ShapeAndCards({ theme: undefined, onChange: s.onChange }));
        const [shapeSelect, cardSelect] = shape.filter((e) => e.type === "select");
        shapeSelect.props.onChange({ target: { value: "default" } });
        shapeSelect.props.onChange({ target: { value: "editorial" } });
        cardSelect.props.onChange({ target: { value: "square" } });
        shape.find((e) => e.type === "input").props.onChange({ target: { checked: false } });
        expect(s.calls).toEqual([["shape", undefined], ["shape", "editorial"], ["cardImage", undefined], ["cardCategoryLine", undefined]]);
        const k = changes();
        const colours = elements(ThemeColorDetails({ theme: undefined, onChange: k.onChange }));
        colours[1].props.onChange("");
        expect(k.calls).toEqual([["mutedColor", undefined]]);
        let saved: any;
        elements(FooterWidthControl({ config: { footer: { contentMaxWidth: "max-w-[1440px]" } }, setConfig: (x) => { saved = x; } })).find((e) => e.type === "select").props.onChange({ target: { value: "" } });
        expect(saved.footer).toEqual({});
    });
});

describe("Settings — the footer colours (BULK-PURGE-FOOTER-1 Part B rule 3)", () => {
    it("the group is mounted right after the footer width, in the Navbar & Layout card, on every site kind", () => {
        for (const config of [CONTENT, COMMERCE, CATALOG]) {
            const html = renderSettings(config);
            const width = html.indexOf(">Footer Width<"), colours = html.indexOf(">Footer Colours<");
            expect(width, String(config.name)).toBeGreaterThan(-1);
            expect(colours, String(config.name)).toBeGreaterThan(width);
            expect(html.indexOf(renderToStaticMarkup(createElement(FooterColorControls, { config, setConfig: () => {} }))), String(config.name))
                .toBe(html.indexOf(renderToStaticMarkup(createElement(FooterWidthControl, { config, setConfig: () => {} }))) + renderToStaticMarkup(createElement(FooterWidthControl, { config, setConfig: () => {} })).length);
        }
    });
    it("absent: both inputs empty (theme default); stored: the values are shown", () => {
        const none = renderToStaticMarkup(createElement(FooterColorControls, { config: {}, setConfig: () => {} }));
        expect([...none.matchAll(/<input class="[^"]*font-mono[^"]*" value="([^"]*)"/g)].map((m) => m[1])).toEqual(["", ""]);
        expect(none).toContain("Empty = theme default (light and dark).");
        const set = renderToStaticMarkup(createElement(FooterColorControls, { config: { footer: { backgroundColor: "#1f2937", textColor: "#f9fafb" } }, setConfig: () => {} }));
        expect([...set.matchAll(/<input class="[^"]*font-mono[^"]*" value="([^"]*)"/g)].map((m) => m[1])).toEqual(["#1f2937", "#f9fafb"]);
    });
    it("a colour sets its key, an emptied input removes it; the width and the other colour are kept — and the width control keeps the colours", () => {
        let saved: any;
        const config = { footer: { contentMaxWidth: "max-w-[1440px]", textColor: "#f9fafb" } } as any;
        const inputs = elements(FooterColorControls({ config, setConfig: (x) => { saved = x; } })).filter((e) => typeof e.props?.onChange === "function");
        expect(inputs.length).toBe(2);                                         // the two ColorInputs (props inspected, not called)
        inputs[0].props.onChange("#1f2937");
        expect(saved.footer).toEqual({ contentMaxWidth: "max-w-[1440px]", textColor: "#f9fafb", backgroundColor: "#1f2937" });
        inputs[1].props.onChange("");
        expect(saved.footer).toEqual({ contentMaxWidth: "max-w-[1440px]" });
        elements(FooterWidthControl({ config: { footer: { contentMaxWidth: "max-w-[1440px]", backgroundColor: "#1f2937" } }, setConfig: (x) => { saved = x; } }))
            .find((e) => e.type === "select").props.onChange({ target: { value: "" } });
        expect(saved.footer).toEqual({ backgroundColor: "#1f2937" });
        expect(withFooterKey({}, "textColor", "")).toEqual({ footer: {} });
    });
});

describe("Settings — the header colours (HEADER-COLOURS-1)", () => {
    const render = (config: Record<string, any>) => renderToStaticMarkup(createElement(HeaderColorControls, { config, setConfig: () => {} }));
    const values = (html: string) => [...html.matchAll(/<input class="[^"]*font-mono[^"]*" value="([^"]*)"/g)].map((m) => m[1]);
    it("the group is mounted in the Navbar & Layout card, directly before the footer width, on every site kind", () => {
        for (const config of [CONTENT, COMMERCE, CATALOG]) {
            const html = renderSettings(config);
            const card = html.indexOf(">Navbar &amp; Layout<"), group = html.indexOf(render(config));
            expect(card, String(config.name)).toBeGreaterThan(-1);
            expect(group, String(config.name)).toBeGreaterThan(card);
            expect(html.split(">Header Colours<").length - 1, String(config.name)).toBe(1);
            expect(html.indexOf(renderToStaticMarkup(createElement(FooterWidthControl, { config, setConfig: () => {} }))), String(config.name)).toBe(group + render(config).length);
        }
    });
    it("absent: both inputs empty (theme default), with the help line; stored: the values are shown", () => {
        const none = render({});
        expect(none).toContain(">Header Colours<");
        expect(values(none)).toEqual(["", ""]);
        expect(none).toContain("Empty = theme default (light and dark).");
        expect(values(render({ header: { backgroundColor: "#f5f1ea", textColor: "#1f2937" } }))).toEqual(["#f5f1ea", "#1f2937"]);
    });
    it("set, then cleared: saved under header.backgroundColor / header.textColor; clearing removes the key; the other header keys are kept", () => {
        let saved: any;
        const config = { header: { showLogo: true, navHeight: "h-20", textColor: "#1f2937" } } as any;
        const inputs = elements(HeaderColorControls({ config, setConfig: (x) => { saved = x; } })).filter((e) => typeof e.props?.onChange === "function");
        expect(inputs.length).toBe(2);                                         // the two ColorInputs: Background, Text
        inputs[0].props.onChange("#f5f1ea");
        expect(saved.header).toEqual({ showLogo: true, navHeight: "h-20", textColor: "#1f2937", backgroundColor: "#f5f1ea" });
        inputs[1].props.onChange("");
        expect(saved.header).toEqual({ showLogo: true, navHeight: "h-20" });
        expect(Object.hasOwn(saved.header, "textColor")).toBe(false);
        const set = withHeaderKey({ header: saved.header }, "backgroundColor", "#f5f1ea");
        expect(withHeaderKey(set, "backgroundColor", "").header).toEqual({ showLogo: true, navHeight: "h-20" });
        expect(withHeaderKey({}, "textColor", "")).toEqual({ header: {} });
        expect(config.header).toEqual({ showLogo: true, navHeight: "h-20", textColor: "#1f2937" });   // the draft is not mutated
    });
});

// SHOP-LOOK-1A (docs/slices/shop-look-1a.md, taxonomy row "admin: clear a field"): the tagline, the category bar picker,
// the footer brand text and the footer columns. Every control sets its key; clearing it removes the key (never "" or []).
describe("Settings — tagline, category bar, footer brand text and columns (SHOP-LOOK-1A)", () => {
    const CATS = [{ id: "c1", name: "Carpet" }, { id: "c2", name: "Vinyl" }, { id: "c3", name: "Old stock", status: "hidden" }];
    const header = (config: Record<string, any>, categories: any = CATS) => renderToStaticMarkup(createElement(HeaderTaglineAndCategoryBarControls, { config, setConfig: () => {}, categories }));
    const footer = (config: Record<string, any>) => renderToStaticMarkup(createElement(FooterBrandAndColumnsControls, { config, setConfig: () => {} }));
    /** The rendered element tree of a group, with `setConfig` recording what it was given. */
    const tree = (component: any, props: Record<string, unknown>) => { const saved: any[] = []; return { saved, all: elements(component({ ...props, setConfig: (x: unknown) => saved.push(x) })) }; };
    const byLabel = (all: any[], label: string) => all.filter((e) => e.props?.["aria-label"] === label);

    it("both groups are in the Navbar & Layout card on every site kind: the header group first in the slot (before Header Colours), the footer group last (after Footer Colours)", () => {
        for (const config of [CONTENT, COMMERCE, CATALOG]) {
            const html = renderSettings(config);
            const card = html.indexOf(">Navbar &amp; Layout<");
            const first = html.indexOf(renderToStaticMarkup(createElement(HeaderTaglineAndCategoryBarControls, { config, setConfig: () => {}, categories: null })));
            const colours = renderToStaticMarkup(createElement(HeaderColorControls, { config, setConfig: () => {} }));
            expect(first, String(config.name)).toBeGreaterThan(card);
            expect(html.indexOf(colours), String(config.name)).toBe(first + header(config, null).length);
            const footerColours = renderToStaticMarkup(createElement(FooterColorControls, { config, setConfig: () => {} }));
            expect(html.indexOf(footer(config)), String(config.name)).toBe(html.indexOf(footerColours) + footerColours.length);
            for (const label of [">Tagline<", ">Category Bar<", ">Footer Brand Text<", ">Footer Columns<"]) expect(html.split(label).length - 1, `${config.name} ${label}`).toBe(1);
        }
    });

    it("absent: empty tagline, no bar row, empty brand text, no column; stored: the values are shown (names from the category list, in the stored order)", () => {
        const none = header({});
        expect(none).toContain('maxLength="60" placeholder="e.g. Since 1998" value=""');
        expect(none).toContain("Add a category…");
        expect(none).not.toContain('aria-label="Remove"');
        const set = header({ header: { tagline: "Since 1998", categoryBarIds: ["c2", "c1"] } });
        expect(set).toContain('value="Since 1998"');
        expect(set.indexOf(">Vinyl<")).toBeLessThan(set.indexOf(">Carpet<"));
        expect([...set.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(["", "c3"]);     // only the categories not picked
        const empty = footer({});
        expect(empty).toContain('maxLength="400"></textarea>');
        expect(empty).not.toContain('aria-label="Remove column"');
        const columns = footer({ footer: { brandText: "Since 1998.", columns: [{ heading: "Explore", links: [{ label: "Guides", href: "/guides" }] }] } });
        expect(columns).toContain(">Since 1998.</textarea>");
        for (const v of ['value="Explore"', 'value="Guides"', 'value="/guides"']) expect(columns).toContain(v);
    });

    it("a picked id with no category is named as skipped; a hidden one too; before the list loads, the id is shown and the picker is off", () => {
        const html = header({ header: { categoryBarIds: ["c3", "gone"] } });
        expect(html).toContain(">Old stock (hidden: skipped on the site)<");
        expect(html).toContain(">gone (not found: skipped on the site)<");
        const loading = header({ header: { categoryBarIds: ["c1"] } }, null);
        expect(loading).toContain(">c1<");
        expect(loading).toMatch(/<select [^>]*disabled=""[^>]*><option value="" selected="">Categories not loaded<\/option><\/select>/);
    });

    it("tagline: set → saved under header.tagline; cleared or whitespace only → the key removed; the other header keys kept; the draft not mutated", () => {
        const config = { header: { navHeight: "h-20", backgroundColor: "#f5f1ea" } };
        const { saved, all } = tree(HeaderTaglineAndCategoryBarControls, { config, categories: CATS });
        const input = all.find((e) => e.props?.placeholder === "e.g. Since 1998");
        input.props.onChange({ target: { value: "Since 1998" } });
        expect(saved.at(-1).header).toEqual({ navHeight: "h-20", backgroundColor: "#f5f1ea", tagline: "Since 1998" });
        for (const cleared of ["", "   "]) {
            input.props.onChange({ target: { value: cleared } });
            expect(saved.at(-1).header, JSON.stringify(cleared)).toEqual({ navHeight: "h-20", backgroundColor: "#f5f1ea" });
            expect(Object.hasOwn(saved.at(-1).header, "tagline")).toBe(false);
        }
        expect(withHeaderKey({ header: { tagline: "x" } } as any, "tagline", "").header).toEqual({});
        expect(config.header).toEqual({ navHeight: "h-20", backgroundColor: "#f5f1ea" });
    });

    it("category bar: pick appends in order; up / down reorder; remove drops; removing the last one removes the key", () => {
        const config = { header: { navHeight: "h-20", categoryBarIds: ["c1", "c2"] } };
        const { saved, all } = tree(HeaderTaglineAndCategoryBarControls, { config, categories: CATS });
        all.find((e) => e.type === "select").props.onChange({ target: { value: "c3" } });
        expect(saved.at(-1).header).toEqual({ navHeight: "h-20", categoryBarIds: ["c1", "c2", "c3"] });
        all.find((e) => e.type === "select").props.onChange({ target: { value: "" } });            // the prompt option: no change
        expect(saved).toHaveLength(1);
        byLabel(all, "Move down")[0].props.onClick();
        expect(saved.at(-1).header.categoryBarIds).toEqual(["c2", "c1"]);
        byLabel(all, "Move up")[1].props.onClick();
        expect(saved.at(-1).header.categoryBarIds).toEqual(["c2", "c1"]);
        expect(byLabel(all, "Move up")[0].props.disabled).toBe(true);
        expect(byLabel(all, "Move down")[1].props.disabled).toBe(true);
        byLabel(all, "Remove")[0].props.onClick();
        expect(saved.at(-1).header).toEqual({ navHeight: "h-20", categoryBarIds: ["c2"] });
        const one = tree(HeaderTaglineAndCategoryBarControls, { config: { header: { navHeight: "h-20", categoryBarIds: ["c2"] } }, categories: CATS });
        byLabel(one.all, "Remove")[0].props.onClick();
        expect(one.saved.at(-1).header).toEqual({ navHeight: "h-20" });
        expect(Object.hasOwn(one.saved.at(-1).header, "categoryBarIds")).toBe(false);
        expect(config.header.categoryBarIds).toEqual(["c1", "c2"]);
    });

    it("category bar: at 12 picked ids the picker is off (the limit of PUT /settings)", () => {
        const twelve = Array.from({ length: 12 }, (_, i) => `x${i}`);
        const html = header({ header: { categoryBarIds: twelve } });
        expect(html).toMatch(/<select [^>]*disabled=""[^>]*><option value="" selected="">12 categories is the limit<\/option>/);
    });

    it("footer brand text: set → footer.brandText; cleared or whitespace only → the key removed; the colours and width kept", () => {
        const config = { footer: { contentMaxWidth: "max-w-7xl", backgroundColor: "#111111" } };
        const { saved, all } = tree(FooterBrandAndColumnsControls, { config });
        const area = all.find((e) => e.type === "textarea");
        area.props.onChange({ target: { value: "Floors since 1998." } });
        expect(saved.at(-1).footer).toEqual({ contentMaxWidth: "max-w-7xl", backgroundColor: "#111111", brandText: "Floors since 1998." });
        for (const cleared of ["", " \n "]) {
            area.props.onChange({ target: { value: cleared } });
            expect(saved.at(-1).footer).toEqual({ contentMaxWidth: "max-w-7xl", backgroundColor: "#111111" });
        }
    });

    it("footer columns: add a column and a link, edit them, remove the link and the column; removing the last column removes the key; 4 columns and 12 links are the limits", () => {
        const { saved, all } = tree(FooterBrandAndColumnsControls, { config: { footer: { backgroundColor: "#111111" } } });
        const addColumn = all.find((e) => Array.isArray(e.props?.children) && e.props.children.includes(" Add Column"));
        addColumn.props.onClick();
        expect(saved.at(-1).footer).toEqual({ backgroundColor: "#111111", columns: [{ heading: "", links: [] }] });
        const config = { footer: { backgroundColor: "#111111", columns: [{ heading: "Explore", links: [{ label: "Guides", href: "/guides" }] }] } };
        const edit = tree(FooterBrandAndColumnsControls, { config });
        edit.all.find((e) => e.props?.placeholder === "Heading (e.g. Explore)").props.onChange({ target: { value: "Learn" } });
        expect(edit.saved.at(-1).footer.columns).toEqual([{ heading: "Learn", links: [{ label: "Guides", href: "/guides" }] }]);
        edit.all.find((e) => e.props?.placeholder === "URL (e.g. /about)").props.onChange({ target: { value: "/learn" } });
        expect(edit.saved.at(-1).footer.columns).toEqual([{ heading: "Explore", links: [{ label: "Guides", href: "/learn" }] }]);
        byLabel(edit.all, "Remove link")[0].props.onClick();
        expect(edit.saved.at(-1).footer.columns).toEqual([{ heading: "Explore", links: [] }]);
        byLabel(edit.all, "Remove column")[0].props.onClick();
        expect(edit.saved.at(-1).footer).toEqual({ backgroundColor: "#111111" });
        expect(Object.hasOwn(edit.saved.at(-1).footer, "columns")).toBe(false);
        expect(config.footer.columns[0].heading).toBe("Explore");                                      // the draft is not mutated
        const full = { footer: { columns: Array.from({ length: 4 }, (_, i) => ({ heading: `H${i}`, links: Array.from({ length: 12 }, (_, j) => ({ label: `L${j}`, href: `/${j}` })) })) } };
        const html = footer(full);
        expect(html).toMatch(/disabled=""[^>]*>[^<]*<svg[^>]*>.*?<\/svg> Add Column</);
        expect(html.split(/disabled=""[^>]*>[^<]*<svg[^>]*>(?:(?!<\/button>).)*? Add Link</).length - 1).toBe(4);
        expect(withFooterKey({ footer: { columns: [] } } as any, "columns", [])).toEqual({ footer: {} });
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
    it("URL Prefixes on a non-catalog site: the eight fields — CDL-2 adds Confirmation directly after Checkout; no interest list", () => {
        expect(prefixFields(renderSettings(CONTENT)).map((f) => f.label)).toEqual(["Product", "Category", "Cart", "Checkout", "Confirmation (after Checkout)", "Shop", "Account", "Search"]);
    });
    it("CDL-2 (§ 14 item 2): the Confirmation field shows urlPrefixes.checkoutConfirmation; a catalog has no such field", () => {
        const stored = { ...COMMERCE, urlPrefixes: { ...COMMERCE.urlPrefixes, checkoutConfirmation: "/multumim" } };
        expect(prefixFields(renderSettings(stored)).find((f) => f.label === "Confirmation (after Checkout)")).toEqual({ label: "Confirmation (after Checkout)", value: "/multumim" });
        expect(prefixFields(renderSettings(CATALOG)).map((f) => f.label)).not.toContain("Confirmation (after Checkout)");
    });
    // ADMIN-ENGLISH-2 (record § 2): a URL-prefix placeholder shows the real default of its prefix, never another example.
    // CDL2-R3 (review-0): the save path, run headless. The real `onChange` of the Confirmation field (`updateUrlPrefix`)
    // gives one `setConfig` updater; applied to the seeded state it is the next state; the page rendered with that
    // state gives the real Save button, whose `save()` sends `withContactForSave(config)` to `PUT /settings`.
    it("CDL-2 (§ 14 item 2): typing /multumim in the Confirmation field and pressing Save sends urlPrefixes.checkoutConfirmation = \"/multumim\" in the PUT /settings body; every other prefix is kept", async () => {
        const capture = (): Capture => (seed.capture = { configUpdates: [], inputs: [], buttons: [] });
        const win = globalThis.window as any;
        win.location = { reload: vi.fn() };
        api.apiRequest.mockClear();
        try {
            const first = capture();
            renderSettings(COMMERCE);
            const fields = first.inputs.filter((p) => p.placeholder === "/confirmation");
            expect(fields).toHaveLength(1);
            expect(fields[0].value).toBe(URL_PREFIX_DEFAULTS.checkoutConfirmation);
            fields[0].onChange({ target: { value: "/multumim" } });
            expect(first.configUpdates).toHaveLength(1);
            const update = first.configUpdates[0];
            const next = typeof update === "function" ? update(COMMERCE) : update;
            expect(next.urlPrefixes).toEqual({ ...COMMERCE.urlPrefixes, checkoutConfirmation: "/multumim" });

            const second = capture();
            renderSettings(next);
            const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map(textOf).join("") : "");
            const saves = second.buttons.filter((b) => textOf(b.children).trim() === "Save Changes");
            expect(saves).toHaveLength(1);
            await saves[0].onClick();
            expect(api.apiRequest).toHaveBeenCalledTimes(1);
            const [path, options] = api.apiRequest.mock.calls[0] as [string, RequestInit];
            expect(path).toBe("/settings");
            expect(options.method).toBe("PUT");
            const body = JSON.parse(String(options.body));
            expect(body.urlPrefixes).toEqual({ ...COMMERCE.urlPrefixes, checkoutConfirmation: "/multumim" });
            expect(body.urlPrefixes.checkoutConfirmation).toBe("/multumim");
            expect(win.location.reload).toHaveBeenCalledTimes(1);
            // Control: the Checkout field's onChange writes checkout, not the confirmation key.
            const third = capture();
            renderSettings(COMMERCE);
            third.inputs.find((p) => p.placeholder === "/checkout")!.onChange({ target: { value: "/comanda" } });
            const u = third.configUpdates[0];
            expect((typeof u === "function" ? u(COMMERCE) : u).urlPrefixes).toEqual({ ...COMMERCE.urlPrefixes, checkout: "/comanda" });
        } finally {
            seed.capture = null;
            delete win.location;
        }
    });
    it("URL Prefixes: each placeholder is URL_PREFIX_DEFAULTS of its field, on a non-catalog site and on a catalog", () => {
        const KEY: Record<string, keyof typeof URL_PREFIX_DEFAULTS> = {
            Product: "product", Category: "category", Cart: "cart", Checkout: "checkout", "Confirmation (after Checkout)": "checkoutConfirmation",
            Shop: "shop", Account: "account", Search: "search", "Interest list": "interest",
        };
        for (const [config, count] of [[CONTENT, 8], [COMMERCE, 8], [CATALOG, 5]] as const) {
            const html = renderSettings(config);
            const card = html.slice(html.indexOf(">URL Prefixes<"), html.indexOf("Existing links using old prefixes will stop working."));
            const fields = [...card.matchAll(/<label[^>]*>([^<]+)<\/label><input[^>]*placeholder="([^"]*)"/g)].map((m) => [m[1], m[2]]);
            expect(fields.length, String(config.name)).toBe(count);
            for (const [label, placeholder] of fields) expect(placeholder, `${config.name}: ${label}`).toBe(URL_PREFIX_DEFAULTS[KEY[label]]);
        }
    });
    it("URL Prefixes copy on a catalog says catalog, not commerce (CAT-ADMIN-2, F-CA-IMPL-2; non-catalog: the captures above)", () => {
        const html = renderSettings(CATALOG);
        expect(html).toContain("Configure URL paths for catalog pages. Must start with &quot;/&quot; (e.g. &quot;/product&quot;).");
        expect(html).toContain("Changing these will update how catalog URLs are generated and resolved. Existing links using old prefixes will stop working.");
        expect(html).not.toContain("commerce pages");
        expect(html).not.toContain("commerce URLs");
    });
});

/**
 * LANG-1A (docs/slices/lang-1.md § 10) — the Languages controls and the menu and footer lists per language. Pure helpers
 * and server renders; the save rule shown is the shared `languageSettingsProblem` that PUT /settings runs.
 */
describe("Settings — languages (LANG-1A)", () => {
    const TWO = { ...CONTENT, locale: "ro-RO", languages: ["en"], navLinks: [{ label: "Acasă", href: "/" }], footerLinks: [{ label: "Contact", href: "/contact" }] };

    it("L1A-ADMIN-LANGUAGES: the controls show the default language, each extra language, the help text and the delay sentence", () => {
        const html = languageGroup(TWO);
        expect(html).toContain("Default language: Romanian (ro)");
        expect(html).toContain("English (en) — pages under /en/");
        expect(html).toContain("A change to the language list can take a few minutes to show on every page.");
        expect(html).toContain("Adding a language makes the existing pages under its prefix pages of that language.");
        expect(languageGroup(CONTENT)).toContain("Default language: English (en)");
        expect(languageName("de")).toBe("German");
    });

    it("L1A-ADMIN-LANGUAGES: a list the save rule refuses shows the rule's message (the default subtag; a key of a removed language)", () => {
        expect(languageGroup({ ...TWO, languages: ["ro"] })).toContain("languages: &quot;ro&quot; is the default language of the site");
        expect(languageGroup({ ...TWO, navLinksByLang: { de: [] } })).toContain("navLinksByLang: &quot;de&quot; is not in the site&#x27;s languages.");
        expect(languageGroup(TWO)).not.toContain("text-destructive\">languages");
    });

    it("L1A-ADMIN-LANGUAGES: add and remove — removing a language removes its menu and footer lists; the list and maps are sent even when empty", () => {
        const added = withLanguageAdded(CONTENT, "de");
        expect(added.languages).toEqual(["de"]);
        const withMenus = { ...TWO, languages: ["en", "de"], navLinksByLang: { en: [{ label: "Home", href: "/en" }], de: [] }, footerLinksByLang: { en: [] } };
        const removed = withLanguageRemoved(withMenus, "en");
        expect(removed.languages).toEqual(["de"]);
        expect(removed.navLinksByLang).toEqual({ de: [] });
        expect(removed.footerLinksByLang).toEqual({});
        const none = withLanguageRemoved(removed, "de");
        expect(none.languages).toEqual([]);
        expect(none.navLinksByLang).toEqual({});
        // A map never stored stays absent; a malformed entry can be removed.
        expect(Object.hasOwn(withLanguageRemoved({ ...CONTENT, languages: ["de", 5] as any }, 5), "navLinksByLang")).toBe(false);
        expect(withLanguageRemoved({ ...CONTENT, languages: ["de", 5] as any }, 5).languages).toEqual(["de"]);
    });

    it("L1A-ADMIN-MENUS: the default list is navLinks / footerLinks exactly as before; a language edits its own list; undefined = use the default menu", () => {
        expect(linksFor(TWO, "navLinks", null)).toBe(TWO.navLinks);
        expect(withLinksFor(TWO, "footerLinks", null, [])).toEqual({ ...TWO, footerLinks: [] });
        expect(linksFor(TWO, "navLinks", "en")).toBeUndefined();
        const own = withLinksFor(TWO, "navLinks", "en", [{ label: "Home", href: "/en" }]);
        expect(own.navLinksByLang).toEqual({ en: [{ label: "Home", href: "/en" }] });
        expect(own.navLinks).toBe(TWO.navLinks);
        expect(linksFor(own, "navLinks", "en")).toEqual([{ label: "Home", href: "/en" }]);
        expect(withLinksFor(own, "navLinks", "en", undefined).navLinksByLang).toEqual({});
    });

    it("L1A-ADMIN-MENUS: the Language selector is in both link cards only when the site has extra languages", () => {
        const withLangs = renderSettings(TWO);
        expect(withLangs.match(/<option value="" selected="">Default \(ro\)<\/option>/g)).toHaveLength(2);
        expect(withLangs).toContain("<option value=\"en\">English (en)</option>");
        for (const config of [CONTENT, COMMERCE, CATALOG]) expect(renderSettings(config)).not.toMatch(/>Default \([a-z]{2,3}\)<\/option>/);
        const select = renderToStaticMarkup(createElement(MenuLanguageSelect, { config: TWO, setConfig: () => {}, field: "navLinks", language: "en", setLanguage: () => {} }));
        expect(select).toContain("Uses the default list. Add a link to give en its own list.");
        const ownList = { ...TWO, navLinksByLang: { en: [] } };
        expect(renderToStaticMarkup(createElement(MenuLanguageSelect, { config: ownList, setConfig: () => {}, field: "navLinks", language: "en", setLanguage: () => {} }))).toContain(">Use the default menu<");
    });
});
