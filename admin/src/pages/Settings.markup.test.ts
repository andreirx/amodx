// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

/**
 * REFACTOR-SETTINGS-1 (docs/slices/refactor-settings-1.md § Proofs) — the acceptance oracle of the move of
 * `Settings.tsx` into `settings/*`. The snapshot files under `__markup__/refactor-settings-1/` were written by this
 * test on the UNTOUCHED page (before any move); after the move they must be byte-identical. A difference is a changed
 * screen or a changed save. Re-capture (`vitest -u`) only for a slice that changes the screen on purpose, and only with
 * a listed, reviewed diff: the slice lists, BEFORE its change, which captures change and why; AFTER, it shows for every
 * changed capture a diff that holds only the listed lines (first used by SETTINGS-FINDINGS-1,
 * docs/slices/settings-findings-1.md § Expected capture changes). Never re-capture to "fix" an unexplained difference.
 *
 * Means (ruling 3): the page loads its data in effects, so the server render of Settings.test.ts (no effects) cannot
 * reach every state (the MailerLite "stored" flag, the merged secrets, the loaded categories, the custom themes). This
 * file mounts the real page in jsdom, as Settings.scheduling.test.ts does (no new library), with `@/lib/api` replaced
 * by an in-memory answer per state, waits until the requests are answered, and stores the page's DOM
 * (`innerHTML`). Only the HTTP module, the tenant and auth contexts and Amplify are replaced; the page runs its real
 * effects, its real handlers and its real Save.
 *
 * Per state: (1) the markup after the load and the listed interactions (one per section that only a click reaches);
 * (2) the PUT /settings body of Save, unchanged draft; (3) a "sweep": every enabled text field, textarea, colour,
 * range, checkbox, radio and native select of the page gets a value from its position (re-queried after each change,
 * so fields that a change shows are swept too), every "Add…" button present at the start is clicked once, then the
 * markup and the Save body. The sweep pins what each moved handler writes. Radix Selects are not driven (jsdom has no
 * pointer capture); their handlers are pinned by the review of the moved lines only.
 */

type Answer = Record<string, unknown>;
type State = {
    role: "TENANT_ADMIN" | "EDITOR";
    settings: Answer;
    secrets?: Answer;
    categories?: unknown[] | "fail";
    /** The stored custom themes `GET /themes` answers; "fail" = the request is refused (SETTINGS-FINDINGS-1). */
    themes?: Answer[] | "fail";
};

const api = vi.hoisted(() => ({
    state: null as null | State,
    calls: [] as { path: string; method: string; body?: unknown }[],
    themes: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/api", async (original) => ({
    ...(await original<typeof import("@/lib/api")>()),
    apiRequest: async (path: string, options?: { method?: string; body?: string }) => {
        const method = options?.method ?? "GET";
        const body = options?.body ? JSON.parse(options.body) : undefined;
        api.calls.push({ path, method, body });
        const s = api.state!;
        if (path === "/settings" && method === "PUT") return {};
        if (path === "/settings") return structuredClone(s.settings);
        if (path === "/settings/secrets") return structuredClone(s.secrets ?? {});
        if (path === "/categories") {
            if (s.categories === "fail") throw new Error("categories refused");
            return { items: structuredClone(s.categories ?? []) };
        }
        if (path === "/service-keys") return { items: [] };
        if (path === "/themes" && method === "POST") { api.themes.push({ id: `theme-${api.themes.length + 1}`, ...body }); return {}; }
        if (path === "/themes") {
            if (s.themes === "fail") throw new Error("themes refused");
            return { items: structuredClone(api.themes) };
        }
        throw new Error(`Unexpected local test request: ${method} ${path}`);
    },
}));
const auth = vi.hoisted(() => ({ role: "TENANT_ADMIN" as string }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ userRole: auth.role }) }));
const refreshTenants = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ tenants: [], currentTenant: { id: "t", name: "T", domain: "t.test" }, selectTenant: () => {}, refreshTenants }),
}));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));

import SettingsPage from "./Settings";
import { TenantConfigSchema } from "@amodx/shared";

// ── The states (ruling 3). Every card that renders under a condition is on in one state and off in another. ─────────

/** (a) A new site: only what a created tenant record surely holds. Admin; nothing stored; no category. */
const EMPTY: State = { role: "TENANT_ADMIN", settings: { id: "t-empty", name: "New site", domain: "new.test" }, categories: [] };

/** (b) A shop with every optional section filled (admin; MailerLite stored; secrets merged; categories loaded). */
const SHOP: State = {
    role: "TENANT_ADMIN",
    settings: {
        id: "t-shop", name: "Shop", domain: "shop.test", description: "Floors since 1998", schemaType: "LocalBusiness",
        logo: "https://cdn.test/logo.png", commerceEnabled: true, currency: "RON", countryCode: "RO", locale: "ro-RO",
        homePageSlug: "/home", hideSocialSharing: true, celebrationEnabled: true,
        schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" },
        header: {
            showLogo: false, showTitle: true, contentMaxWidth: "max-w-[1440px]", contentPageMaxWidth: "max-w-5xl", navHeight: "h-20",
            navHeightScrolled: "h-14", logoHeight: "h-16", logoHeightScrolled: "h-10", titleSize: "text-2xl", titleSizeScrolled: "text-xl",
            backgroundColor: "#f5f1ea", textColor: "#1f2937", tagline: "Since 1998", categoryBarIds: ["c2", "c1", "gone", "c3"],
        },
        footer: {
            contentMaxWidth: "max-w-[1600px]", backgroundColor: "#111111", textColor: "#fafafa", brandText: "Floors since 1998.",
            columns: [{ heading: "Explore", links: [{ label: "Guides", href: "/guides" }, { label: "Blog", href: "/blog" }] }],
        },
        theme: {
            fontHeading: "Prata", fontBody: "Lato", fontNav: "Inter", fontWeights: [300, 500], headingWeight: 600,
            backgroundColor: "#ffffff", textColor: "#111111", primaryColor: "#aa3300", primaryForeground: "#ffffff",
            secondaryColor: "#eeeeee", surfaceColor: "#fafafa", mutedColor: "#6b6b6b", borderColor: "#d4d4d4",
            shape: "editorial", cardImage: "landscape", cardCategoryLine: true, radius: "0.75rem", mode: "light",
        },
        darkTheme: { fontHeading: "DarkHead", fontBody: "DarkBody", backgroundColor: "#000000", textColor: "#eeeeee", primaryColor: "#ff8800" },
        urlPrefixes: { product: "/produs", category: "/categorie", cart: "/cos", checkout: "/comanda", checkoutConfirmation: "/multumim", shop: "/magazin", account: "/cont", search: "/cauta" },
        commerceBar: {
            enabled: true, height: "h-12", fontSize: "text-base", iconSize: "h-6 w-6", phone: "0762 000 111", whatsappNumber: "+40762000111",
            socialLinks: [{ platform: "instagram", url: "https://instagram.com/shop" }, { platform: "facebook", url: "https://facebook.com/shop" }],
            ctaButton: { text: "Winter sale", url: "/sale" },
        },
        searchBar: { enabled: true, placeholder: "Caută" },
        enabledPaymentMethods: ["cash_on_delivery", "bank_transfer"],
        companyDetails: { legalName: "SC Shop SRL", cui: "RO1", tradeRegister: "J40/1/2020", phone: "+40 700", address: "Str. 1", email: "office@shop.test" },
        legalLinks: { termsUrl: "/termeni", privacyUrl: "/confidentialitate", anpcUrl: "https://anpc.ro/x", anpcSalUrl: "https://ec.europa.eu/odr" },
        contactChannels: { phone: " 0721 000 111 ", whatsapp: "  ", email: "office@shop.test " },
        navLinks: [
            { label: "Home", href: "/" },
            { label: "Shop", href: "/magazin", children: [{ label: "Carpet", href: "/categorie/carpet" }, { label: "Vinyl", href: "/categorie/vinyl" }] },
        ],
        footerLinks: [{ label: "About", href: "/about" }],
        gdpr: { enabled: false, position: "top" },
        recaptcha: { threshold: 0.7 },
        pageEffect: { type: "none" },
        integrations: {
            contactEmail: "owner@shop.test", orderProcessingEmail: "orders@shop.test", googleAnalyticsId: "G-SHOP",
            analytics: { provider: "umami", url: "https://stats.test/script.js", websiteId: "uuid-1" },
            paddle: { environment: "production", clientToken: "live_123" },
            bankTransfer: { bankName: "ING", accountHolder: "SC Shop SRL", iban: "RO49AAAA", swift: "INGBROBU", referencePrefix: "PPB" },
            mailerlite: { groupId: "112233" },
            braveApiKey: "brave-1",
            google: { clientId: "id.apps.googleusercontent.com" },
        },
    },
    secrets: { recaptcha: { siteKey: "site-key", secretKey: "secret-key" }, integrations: { google: { clientSecret: "GOCSPX-1" } } },
    categories: [{ id: "c1", name: "Carpet" }, { id: "c2", name: "Vinyl" }, { id: "c3", name: "Old stock", status: "hidden" }, { id: "c4", name: "Tiles" }],
};

/** (c) A site in a second language: Romanian default, extra languages, an own menu for one of them, a rule message. */
const LANG: State = {
    role: "TENANT_ADMIN",
    settings: {
        id: "t-lang", name: "Bilingual", domain: "lang.test", locale: "ro-RO", countryCode: "RO", currency: "RON",
        languages: ["en", "de"],
        navLinks: [{ label: "Acasă", href: "/" }], footerLinks: [{ label: "Contact", href: "/contact" }],
        navLinksByLang: { en: [{ label: "Home", href: "/en" }, { label: "Menu", href: "/en/menu", children: [{ label: "Lunch", href: "/en/lunch" }] }] },
        footerLinksByLang: { fr: [] },
        integrations: { contactEmail: "owner@lang.test", mailerlite: true },
    },
    categories: "fail",
};

/** (d) A catalog, seen by an editor (not an admin): no secret cards; a separate interest-list address; a locale that falls back. */
const CATALOG: State = {
    role: "EDITOR",
    settings: {
        id: "t-cat", name: "Catalog", domain: "cat.test", catalogMode: true, commerceEnabled: false, locale: "xx-YY",
        schedulingEnabled: false, searchBar: { enabled: true, placeholder: "Search" },
        urlPrefixes: { product: "/product", category: "/category", shop: "/shop", search: "/search", interest: "/my-list" },
        contactChannels: { phone: "0721", email: "office@cat.test" }, interestListEmail: " lists@cat.test ",
        integrations: { contactEmail: "owner@cat.test", analytics: { provider: "plausible" } },
        navLinks: [], footerLinks: [],
    },
    categories: [{ id: "c1", name: "Rugs" }],
};

/** (e) A shop with commerce on and the optional parts off: bar off, no bank transfer, empty link lists. */
const SHOP_BARE: State = {
    role: "TENANT_ADMIN",
    settings: {
        id: "t-bare", name: "Bare shop", domain: "bare.test", commerceEnabled: true, commerceBar: { enabled: false },
        enabledPaymentMethods: ["cash_on_delivery"], navLinks: [], footerLinks: [], schedulingEnabled: false,
        integrations: { contactEmail: "owner@bare.test", analytics: { provider: "none" }, mailerlite: { groupId: "9" } },
    },
    categories: [],
};

const STATES: [name: string, state: State, interact?: () => Promise<void>][] = [
    ["empty", EMPTY],
    ["shop", SHOP, async () => {
        // The dark tab (the Theme card and the Typography card read darkTheme), then back to light at the end.
        await click(buttonByText("Dark Mode"));
        snapshots.push(["dark-tab", host.innerHTML]);
        await click(buttonByText("Light Mode"));
        // The Save Theme dialog: name, Save Theme → POST /themes, the custom theme listed (GET /themes).
        await click(host.querySelector<HTMLButtonElement>('button[title="Save current styles as Theme"]')!);
        snapshots.push(["save-theme-dialog", document.body.innerHTML]);
        await type(document.body.querySelector<HTMLInputElement>('input[placeholder="e.g. Winter Sale 2025"]')!, "Winter");
        await click([...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save Theme")!);
        await settle();
        // The custom theme applied as a preset (the light tab writes theme).
        await click([...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Winter")!);
        // The Country apply dialog: Apply Country → the dialog → Apply (writes countryCode and currency).
        await click(buttonByText("Apply Country"));
        snapshots.push(["country-dialog", document.body.innerHTML]);
        await click([...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Apply")!);
    }],
    ["lang", LANG, async () => {
        // The menu-language selector: choose "en" (own nav list → "Use the default menu"; no footer list → the note).
        await choose(host.querySelectorAll<HTMLSelectElement>("select")[[...host.querySelectorAll("select")].findIndex((s) => s.textContent?.includes("Default (ro)"))], "en");
    }],
    ["catalog", CATALOG],
    ["shop-bare", SHOP_BARE, async () => {
        // MailerLite: Disconnect (stored and now null → the "will be disconnected" line).
        await click(buttonByText("Disconnect MailerLite"));
    }],
];

// ── Driving the page ────────────────────────────────────────────────────────────────────────────────────────────

let root: Root;
let host: HTMLDivElement;
let snapshots: [string, string][] = [];
const buttonByText = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
/** Until every request is answered; and, when the sweep turned the page effect on, until the plugin's preview has
 *  finished its GPU check (jsdom has no WebGPU: it ends at "Preview unavailable"), so the markup does not depend on timing. */
async function settle() {
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    for (let i = 0; i < 200 && host.textContent?.includes("Detecting GPU..."); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(host.textContent, "the effect preview has finished its check").not.toContain("Detecting GPU...");
}
async function click(element: HTMLElement) {
    expect(element, "the element to click exists").toBeTruthy();
    await act(async () => element.click());
}
async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
async function choose(element: HTMLSelectElement, value: string) {
    expect(element, "the select exists").toBeTruthy();
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event("change", { bubbles: true }));
    });
}
async function mount(state: State) {
    api.state = state;
    api.themes = state.themes === "fail" ? [] : structuredClone(state.themes ?? []);
    auth.role = state.role;
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(SettingsPage))));
    await settle();
    expect(host.textContent, "the page has loaded").toContain("Save Changes");
}
async function saveBody(): Promise<unknown> {
    const before = api.calls.length;
    await click(buttonByText("Save Changes"));
    await settle();
    const puts = api.calls.slice(before).filter((c) => c.path === "/settings" && c.method === "PUT");
    expect(puts, "one PUT /settings per Save").toHaveLength(1);
    return puts[0].body;
}

const FIELDS = "input, textarea, select";
/** Every enabled field of the page, in DOM order, gets a value from its position; the list is re-read after each change. */
async function sweep() {
    const adds = [...host.querySelectorAll("button")].filter((b) => !b.disabled && /^Add\b/.test(b.textContent?.trim() ?? ""));
    for (const b of adds) if (host.contains(b) && !b.disabled) await click(b);
    for (let i = 0; i < host.querySelectorAll(FIELDS).length; i++) {
        const el = host.querySelectorAll<HTMLElement>(FIELDS)[i];
        if ((el as HTMLInputElement).disabled) continue;
        if (el instanceof HTMLSelectElement) {
            if (el.getAttribute("aria-hidden") === "true") continue;
            const options = [...el.options].filter((o) => !o.disabled);
            if (options.length) await choose(el, options[options.length - 1].value);
            continue;
        }
        const input = el as HTMLInputElement;
        switch (input.type) {
            case "file": continue;
            case "checkbox": case "radio": await click(input); continue;
            case "color": await type(input, `#${(i * 4099).toString(16).padStart(6, "0").slice(-6)}`); continue;
            case "range": await type(input, "0.3"); continue;
            default: await type(input, `v${i}`);
        }
    }
}

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    // The preview link reads the runtime config first (as Settings.test.ts fixes it): no `.env*` input.
    (window as any).AMODX_CONFIG = { VITE_RENDERER_URL: "https://renderer.test" };
    // jsdom has no matchMedia; the page effect's preview (plugins' EffectPreview) asks it for reduced motion.
    window.matchMedia = ((media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    api.calls = [];
    snapshots = [];
    refreshTenants.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = "";
});

const file = (name: string) => `./__markup__/refactor-settings-1/${name}`;

describe("Settings — markup and Save body per state (REFACTOR-SETTINGS-1 acceptance oracle)", () => {
    for (const [name, state, interact] of STATES) {
        it(`${name}: the loaded page, its interactions and the Save body`, async () => {
            await mount(state);
            snapshots.push(["loaded", host.innerHTML]);
            if (interact) {
                await interact();
                snapshots.push(["after-interactions", host.innerHTML]);
            }
            const body = await saveBody();
            for (const [step, html] of snapshots) await expect(html).toMatchFileSnapshot(file(`${name}.${step}.html`));
            await expect(JSON.stringify(body, null, 2) + "\n").toMatchFileSnapshot(file(`${name}.save.json`));
            await expect(JSON.stringify(api.calls.map((c) => `${c.method} ${c.path}`), null, 2) + "\n").toMatchFileSnapshot(file(`${name}.requests.json`));
        });
        it(`${name}: the sweep — every field changed, every Add clicked, then the markup and the Save body`, async () => {
            await mount(state);
            await sweep();
            await settle();
            const html = host.innerHTML;
            const body = await saveBody();
            await expect(html).toMatchFileSnapshot(file(`${name}.sweep.html`));
            await expect(JSON.stringify(body, null, 2) + "\n").toMatchFileSnapshot(file(`${name}.sweep.save.json`));
        });
    }
});

// ── SETTINGS-FINDINGS-1 (docs/slices/settings-findings-1.md) — one regression test per finding, same harness ─────────

const inputsShowing = (value: string) => [...host.querySelectorAll("input")].filter((i) => i.value === value);
const STORED_THEME = { id: "stored-1", name: "Stored Autumn", theme: { primaryColor: "#123456" } };

/**
 * Item 7: the record `backend/src/tenant/create.ts` writes for `{ name: "First Save", domain: "first.test" }` (the same
 * `TenantConfigSchema.parse` of the same object, then the transaction's PK, SK and Domain), at a fixed time and creator.
 * Never saved through the screen. The backend test `backend/test/unit/settings-findings-1.test.ts` checks that the real
 * GET handlers answer exactly these two answers for the record the real create handler writes.
 */
const CREATED = TenantConfigSchema.parse({
    id: "first-save", domain: "first.test", name: "First Save", status: "LIVE", plan: "Pro",
    theme: { primaryColor: "#000000", fontHeading: "Inter", fontBody: "Inter" },
    integrations: {}, catalogMode: false, createdAt: "2026-11-27T00:00:00.000Z", ownerId: "u1", createdBy: "u1",
});
const FIRST_SAVE: State = {
    role: "TENANT_ADMIN",
    settings: { PK: "SYSTEM", SK: "TENANT#first-save", ...CREATED, Domain: CREATED.domain },
    // GET /settings/secrets for a record without a stored secret (settings-secrets.ts: `|| ""` for each field).
    secrets: { recaptcha: { secretKey: "" }, integrations: { google: { clientSecret: "" }, braveApiKey: "" } },
    categories: [],
};
const findingsFile = (name: string) => `./__markup__/settings-findings-1/${name}`;

describe("Settings — SETTINGS-FINDINGS-1 regression tests", () => {
    it("item 1 (F-RS1-THEMES-NOT-LOADED): the saved themes are listed when the page opens, for an admin and for an editor", async () => {
        for (const state of [SHOP, CATALOG]) {
            await mount({ ...state, themes: [STORED_THEME] });
            expect(buttonByText("Stored Autumn"), `${state.role}: the stored theme is listed on open`).toBeTruthy();
            expect(api.calls.filter((c) => c.path === "/themes" && c.method === "GET"), `${state.role}: one load`).toHaveLength(1);
            await act(async () => root.unmount());
            root = createRoot(host);
            api.calls = [];
        }
    });

    it("item 1: a refused theme load leaves the page working — a warning, an empty list, no error on the page", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            await mount({ ...EMPTY, themes: "fail" });
            expect(warn.mock.calls.some((c) => c[0] === "Failed to load themes"), "the warning").toBe(true);
            expect(host.textContent).not.toContain("themes refused");
            expect(buttonByText("Stored Autumn")).toBeUndefined();
            expect(await saveBody(), "Save still works").toBeTruthy();
        } finally {
            warn.mockRestore();
        }
    });

    it("item 2 (F-RS1-INTERFACE-READS-LIGHT): on the dark tab the Border Radius field shows and writes theme.radius, the value the renderer reads", async () => {
        await mount(SHOP);
        await click(buttonByText("Dark Mode"));
        const radius = [...host.querySelectorAll("label")].find((l) => l.textContent?.trim() === "Border Radius")!.parentElement!.querySelector("input")!;
        expect(radius.value, "the dark tab shows theme.radius").toBe("0.75rem");
        await type(radius, "1rem");
        expect(radius.value, "the field shows the value it wrote").toBe("1rem");
        const body = await saveBody() as { theme: Record<string, unknown>; darkTheme: Record<string, unknown> };
        expect(body.theme.radius).toBe("1rem");
        expect(body.darkTheme.radius, "no dark-theme radius is stored (nothing reads it)").toBeUndefined();
    });

    it("item 3 (F-RS1-MODE-TODO): no Mode control and no TODO text; a stored theme.mode is sent back unchanged", async () => {
        await mount(SHOP);
        expect(host.textContent).not.toContain("TODO");
        expect([...host.querySelectorAll("label")].some((l) => /^Mode\b/.test(l.textContent?.trim() ?? ""))).toBe(false);
        expect((await saveBody() as { theme: Record<string, unknown> }).theme.mode).toBe("light");
    });

    it("item 4 (F-RS1-DUP-FONT-FIELDS): one Heading and one Body font field, on each tab", async () => {
        await mount(SHOP);
        expect(inputsShowing("Prata"), "light: heading font fields").toHaveLength(1);
        expect(inputsShowing("Lato"), "light: body font fields").toHaveLength(1);
        await click(buttonByText("Dark Mode"));
        expect(inputsShowing("DarkHead"), "dark: heading font fields").toHaveLength(1);
        expect(inputsShowing("DarkBody"), "dark: body font fields").toHaveLength(1);
    });

    it("item 7: the first Save of a site never saved through the screen — the answers served and the Save body (unchanged draft)", async () => {
        await mount(FIRST_SAVE);
        const body = await saveBody();
        await expect(JSON.stringify({ settings: FIRST_SAVE.settings, secrets: FIRST_SAVE.secrets }, null, 2) + "\n").toMatchFileSnapshot(findingsFile("first-save.answers.json"));
        await expect(JSON.stringify(body, null, 2) + "\n").toMatchFileSnapshot(findingsFile("first-save.save.json"));
    });
});
