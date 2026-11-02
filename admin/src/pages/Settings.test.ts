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
// CAT-THEME-1 (review-0 R-CT-3): `seed.tab` starts the page's theme tab (its only `useState("light")`, `Settings.tsx`
// `activeTab`) as "dark", so a connected render shows what the dark tab's controls read. `null` leaves it untouched.
const seed = vi.hoisted(() => ({ config: null as null | Record<string, unknown>, tab: null as null | "dark" }));
vi.mock("react", async (importOriginal) => {
    const React = await importOriginal<typeof import("react")>();
    const isEmptyObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0;
    const useState = ((init: unknown) => React.useState(seed.config && isEmptyObject(init) ? seed.config : seed.tab && init === "light" ? seed.tab : init)) as typeof React.useState;
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

import SettingsPage, { localeStatus, withCountry, withSiteLanguage, withContactForSave, withThemeKey, TypographyDetails, ThemeColorDetails, ShapeAndCards, FooterWidthControl, HEADER_WIDTH_OPTIONS, PAGE_WIDTH_OPTIONS } from "./Settings";

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
 * The three wider widths in the two width lists are Radix `SelectItem`s, which a closed Select does not render: they add
 * no byte; the lists are pinned below (`HEADER_WIDTH_OPTIONS`, `PAGE_WIDTH_OPTIONS`).
 */
const THEME_GROUPS = (config: Record<string, any>) => [
    renderToStaticMarkup(createElement(TypographyDetails, { theme: config.theme, onChange: () => {} })),
    renderToStaticMarkup(createElement(ThemeColorDetails, { theme: config.theme, onChange: () => {} })),
    renderToStaticMarkup(createElement(ShapeAndCards, { theme: config.theme, onChange: () => {} })),
    renderToStaticMarkup(createElement(FooterWidthControl, { config, setConfig: () => {} })),
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

describe("Settings — a non-catalog site renders byte-equal to the 0865ac6 re-take (rule 4), minus the CAT-THEME-1 groups", () => {
    it("content site", async () => {
        await expect(withoutCatTheme(renderSettings(CONTENT), CONTENT)).toMatchFileSnapshot("./__markup__/settings.content.html");
    });
    it("commerce site", async () => {
        await expect(withoutCatTheme(renderSettings(COMMERCE), COMMERCE)).toMatchFileSnapshot("./__markup__/settings.commerce.html");
    });
    it("controls: any other mutation of the rendered page still fails — one attribute elsewhere, one text, one attribute inside the Commerce Bar card, one byte next to a removed group", async () => {
        const capture = (name: string) => readFileSync(new URL(`./__markup__/settings.${name}.html`, import.meta.url), "utf8");
        const content = renderSettings(CONTENT), commerce = renderSettings(COMMERCE);
        expect(withoutCatTheme(content, CONTENT)).toBe(capture("content"));            // positive control
        expect(withoutCatTheme(commerce, COMMERCE)).toBe(capture("commerce"));
        const once = (html: string, from: string, to: string) => { expect(html.split(from).length - 1, from).toBe(1); return html.replace(from, to); };
        const footer = THEME_GROUPS(CONTENT)[3];
        const mutations: [string, string, Record<string, unknown>][] = [
            [once(content, 'placeholder="owner@client-site.com"', 'placeholder="owner@client-site.co"'), "content", CONTENT],
            [once(content, ">Notifications<", ">Notificatons<"), "content", CONTENT],
            [once(commerce, 'placeholder="0762 271 715"', 'placeholder="0762 271 716"'), "commerce", COMMERCE],
            [once(content, footer, `${footer} `), "content", CONTENT],
        ];
        for (const [html, name, config] of mutations) expect(withoutCatTheme(html, config)).not.toBe(capture(name));
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
