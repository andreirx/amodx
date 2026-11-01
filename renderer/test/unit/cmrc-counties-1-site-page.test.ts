import { describe, it, expect, vi } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { COMMERCE_STRINGS_DEFAULTS, URL_PREFIX_DEFAULTS, getCountryPack } from "@amodx/shared";
import { extractVisibleText } from "../serving-contract/locale-1/proof.mjs";
import { BEFORE_FILE, withFreeText, type Snapshot, type StateName } from "./cmrc-counties-1-fields";

/**
 * CMRC-COUNTIES-1 (docs/slices/cmrc-counties-1.md) — what the server passes to the checkout form, per tenant country,
 * and the visible-text items of ledger row L-EN-COUNTIES.
 *
 * Real: `SitePage` (the checkout and cart branches, `getCommerceStrings`). Mocked: the DynamoDB reads (`@/lib/dynamo`),
 * Next's runtime-coupled modules, and the two commerce views, which print the props they receive (their rendering of
 * those props is checked in cmrc-counties-1-checkout.test.ts).
 */

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(), getPosts: vi.fn(), getDeliveryConfig: vi.fn(),
    getProductBySlug: vi.fn(), getCategoryBySlug: vi.fn(), getProductsByCategory: vi.fn(), getAllCategories: vi.fn(async () => []),
    getActiveProducts: vi.fn(), getCatalogListing: vi.fn(), searchProducts: vi.fn(), getOrderForCustomer: vi.fn(),
    getProductReviews: vi.fn(), getSiteReviews: vi.fn(), getProductById: vi.fn(), hasActivePopups: vi.fn(async () => false),
}));
vi.mock("@/lib/dynamo", () => dynamo);
vi.mock("next/navigation", () => ({
    permanentRedirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    usePathname: () => "/",
}));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn(async () => null) }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
const { probe } = vi.hoisted(() => ({
    probe: (tag: string) => (props: any) => (globalThis as any).__react.createElement(tag, { "data-props": JSON.stringify(props) }),
}));
(globalThis as any).__react = React;
vi.mock("@/components/CheckoutPageView", () => ({ CheckoutPageView: probe("checkout-probe") }));
vi.mock("@/components/CartPageView", () => ({ CartPageView: probe("cart-probe") }));

import { SitePage } from "@/components/SitePage";

const RO_REGIONS = getCountryPack("RO").address.regions.map((r) => r.name);
const CONFIGURED = ["Cluj", "Ilfov"];

function tenant(extra: Record<string, unknown> = {}) {
    return {
        id: "t1", name: "Shop", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: URL_PREFIX_DEFAULTS, commerceEnabled: true, catalogMode: false, ...extra,
    };
}
const decoded = (html: string) => html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
async function propsOf(tag: "checkout-probe" | "cart-probe", config: Record<string, unknown>, delivery: Record<string, unknown> | null = null) {
    dynamo.getTenantConfig.mockResolvedValue(config);
    dynamo.getDeliveryConfig.mockResolvedValue(delivery);
    const slug = tag === "checkout-probe" ? URL_PREFIX_DEFAULTS.checkout : URL_PREFIX_DEFAULTS.cart;
    const el = await SitePage({ siteId: "t1", slug: [slug.replace(/^\//, "")], preview: false, basePath: "", sessionToken: null, query: {}, cacheable: true });
    const html = renderToStaticMarkup(el as any);
    const m = html.match(new RegExp(`<${tag} data-props="([^"]*)"`));
    if (!m) throw new Error(`${tag} not rendered: ${html.slice(0, 200)}`);
    return JSON.parse(decoded(m[1]));
}

describe("[cmrc-counties-1] SitePage → CheckoutPageView: the region list follows the tenant's real country", () => {
    it("countryCode absent → no regions (EN, not the former Romanian fallback)", async () => {
        const p = await propsOf("checkout-probe", tenant());
        expect(p.defaultRegions).toEqual([]);
        expect(p.availableCounties).toEqual([]);
    });
    it("countryCode EN → no regions", async () => {
        expect((await propsOf("checkout-probe", tenant({ countryCode: "EN" }))).defaultRegions).toEqual([]);
    });
    it("countryCode RO → the 42 Romanian counties of the RO country pack", async () => {
        const p = await propsOf("checkout-probe", tenant({ countryCode: "RO" }));
        expect(p.defaultRegions).toEqual(RO_REGIONS);
        expect(p.defaultRegions).toHaveLength(42);
    });
    it("configured availableCounties reach the form whatever the country (they win in CheckoutPageView)", async () => {
        for (const countryCode of [undefined, "EN", "RO"]) {
            const p = await propsOf("checkout-probe", tenant(countryCode ? { countryCode } : {}), { availableCounties: CONFIGURED });
            expect(p.availableCounties, String(countryCode)).toEqual(CONFIGURED);
        }
    });
});

describe("[cmrc-counties-1] COUNTIES-TEXT-LAYER = off: commerce texts do not follow the country", () => {
    it("countryCode RO, no stored keys → the English defaults (checkout and cart), key order unchanged", async () => {
        for (const tag of ["checkout-probe", "cart-probe"] as const) {
            const { strings } = await propsOf(tag, tenant({ countryCode: "RO" }));
            expect(strings, tag).toEqual(COMMERCE_STRINGS_DEFAULTS);
            expect(Object.keys(strings), tag).toEqual(Object.keys(COMMERCE_STRINGS_DEFAULTS));
        }
        // The RO pack HAS a text layer (so the check above is not vacuous): merging it would have changed this text.
        expect(getCountryPack("RO").defaultStrings.checkout).not.toBe(COMMERCE_STRINGS_DEFAULTS.checkout);
    });
    it("a stored commerceStrings key still overrides the English default (layer order: defaults → tenant)", async () => {
        const { strings } = await propsOf("checkout-probe", tenant({ countryCode: "RO", commerceStrings: { checkout: "Finalizare" } }));
        expect(strings.checkout).toBe("Finalizare");
        expect(strings.county).toBe(COMMERCE_STRINGS_DEFAULTS.county);
    });
});

describe("[cmrc-counties-1] ledger row L-EN-COUNTIES — the visible-text items (§ 8.5 extraction, locale-1/proof.mjs)", () => {
    const before: { commit: string; states: Record<StateName, Snapshot> } = JSON.parse(readFileSync(BEFORE_FILE, "utf8"));
    const lost = [COMMERCE_STRINGS_DEFAULTS.selectCounty, ...RO_REGIONS].map((text) => ({ kind: "text", text }));
    for (const [view, fields] of [["mounted", 1], ["billingShown", 2]] as const) {
        it(`${view}: today's form (959f288, ro-regions) → the form with the free-text field loses exactly "${COMMERCE_STRINGS_DEFAULTS.selectCounty}" and the 42 county names at each of its ${fields} county field(s); every other item is equal and in order`, () => {
            expect(before.commit).toBe("959f288");
            const was = extractVisibleText(before.states["ro-regions"][view]);
            const now = extractVisibleText(withFreeText(before.states["ro-regions"][view]));
            expect(was.length - now.length).toBe(43 * fields);
            // Rebuild `was` from `now` by inserting the 43 items at each placeholder position of `was`.
            const starts = was.flatMap((item, i) => (item.text === COMMERCE_STRINGS_DEFAULTS.selectCounty ? [i] : []));
            expect(starts).toHaveLength(fields);
            const rebuilt = [...now];
            for (const at of starts) rebuilt.splice(at, 0, ...lost);
            expect(rebuilt).toEqual(was);
            // The label stays: one "County *" item per field, before and after.
            for (const list of [was, now]) expect(list.filter((i) => i.text === `${COMMERCE_STRINGS_DEFAULTS.county} *`)).toHaveLength(fields);
        });
    }
});
