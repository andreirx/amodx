import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveLocaleStrings } from "@amodx/shared";
import { countInputs, draftFromSettings, labelsSaveBody, overrideCount, resetSection, setCountText, setText, SECTION_HOME, SECTION_KEYS } from "./Labels";

/**
 * LOCALE-1A — the Labels page's save rules (docs/slices/locale-1.md § 7.1; admin unit checks of § 10 row `locale-1a`):
 * the save keeps `gdpr.enabled`, `gdpr.position` and the four legal URLs; a cleared label is deleted; Reset touches
 * only the label fields (or only its own section's keys); only changed attributes are sent. Pure helpers, node env.
 * LOCALE-1B: the catalog part (`catalogStrings`) and the "Product pages & search" section (commerce-part keys shared by
 * commerce and catalog sites) have one input per key; a count key has one input per plural category of the tenant's
 * language; their Reset works as in 1a.
 * LOCALE-1D: the commerce section holds the 80 commerce-only keys of § 6.2 (cards per page: product buying, header,
 * cart, checkout, account, order confirmation, order tracking); the site section holds `errorTryAgain`.
 */

const LOADED = {
    id: "t1",
    commerceEnabled: true,
    commerceStrings: { addToCart: "Pune în coș", futureKey: "kept", broken: 7 },
    siteStrings: { navContact: "Scrie-ne" },
    gdpr: { enabled: false, position: "top", headline: "Cookie-uri", acceptAll: "" },
    legalLinks: {
        termsUrl: "/t", privacyUrl: "/p", anpcUrl: "https://anpc", anpcSalUrl: "https://sal",
        termsLabel: "Termeni", anpcSalLabel: "SAL",
    },
};

describe("draftFromSettings", () => {
    it("copies the four stored homes; a label counts only when it is a non-empty text", () => {
        const d = draftFromSettings(LOADED);
        expect(d.commerce).toEqual(LOADED.commerceStrings);
        expect(d.catalog).toEqual({});
        expect(d.site).toEqual(LOADED.siteStrings);
        expect(d.labels).toEqual({ cookieHeadline: "Cookie-uri", legalTermsLabel: "Termeni", legalDisputeResolutionLabel: "SAL" });
    });
    it("a tenant with none of the attributes → an empty draft", () => {
        expect(draftFromSettings({ id: "t2" })).toEqual({ commerce: {}, catalog: {}, site: {}, labels: {} });
    });
});

describe("labelsSaveBody", () => {
    it("nothing changed → an empty body (no PUT)", () => {
        expect(labelsSaveBody(LOADED, draftFromSettings(LOADED))).toEqual({});
    });

    it("a label edit sends gdpr whole with enabled and position kept, and nothing else", () => {
        const d = setText(draftFromSettings(LOADED), "labels", "cookieDenyAll", "Refuz");
        expect(labelsSaveBody(LOADED, d)).toEqual({
            gdpr: { enabled: false, position: "top", headline: "Cookie-uri", acceptAll: "", denyAll: "Refuz" },
        });
    });

    it("a cleared label is deleted from the object sent; the four legal URLs are kept", () => {
        const d = setText(draftFromSettings(LOADED), "labels", "legalTermsLabel", "");
        expect(labelsSaveBody(LOADED, d)).toEqual({
            legalLinks: { termsUrl: "/t", privacyUrl: "/p", anpcUrl: "https://anpc", anpcSalUrl: "https://sal", anpcSalLabel: "SAL" },
        });
    });

    it("a stored empty label the owner did not touch stays as stored (no write of a change nobody made)", () => {
        const d = setText(draftFromSettings(LOADED), "labels", "cookieHeadline", "Cookie-uri noi");
        expect((labelsSaveBody(LOADED, d).gdpr as any).acceptAll).toBe("");
    });

    it("site and commerce edits go to siteStrings / commerceStrings; unknown and non-string stored keys are kept", () => {
        let d = setText(draftFromSettings(LOADED), "site", "breadcrumbHome", "Acasă");
        d = setText(d, "commerce", "addToCart", "");
        expect(labelsSaveBody(LOADED, d)).toEqual({
            siteStrings: { navContact: "Scrie-ne", breadcrumbHome: "Acasă" },
            commerceStrings: { futureKey: "kept", broken: 7 },
        });
    });

    it("an empty input never writes \"\" (it removes the override)", () => {
        const d = setText(draftFromSettings(LOADED), "site", "navContact", "");
        expect(labelsSaveBody(LOADED, d)).toEqual({ siteStrings: {} });
    });

    it("a label on a tenant without gdpr/legalLinks creates the object with only that field", () => {
        const loaded = { id: "t2" };
        const d = setText(draftFromSettings(loaded), "labels", "legalPrivacyLabel", "Privacy");
        expect(labelsSaveBody(loaded, d)).toEqual({ legalLinks: { privacyLabel: "Privacy" } });
    });
});

describe("Reset to the language defaults", () => {
    it("the cookie & legal Reset deletes only the nine label fields: enabled, position and URLs stay", () => {
        const d = resetSection(draftFromSettings(LOADED), "labels");
        expect(overrideCount(draftFromSettings(LOADED), "labels")).toBe(3);
        expect(labelsSaveBody(LOADED, d)).toEqual({
            gdpr: { enabled: false, position: "top", acceptAll: "" },
            legalLinks: { termsUrl: "/t", privacyUrl: "/p", anpcUrl: "https://anpc", anpcSalUrl: "https://sal" },
        });
    });

    it("the site Reset removes the site overrides only; the commerce Reset removes known commerce keys only", () => {
        const site = resetSection(draftFromSettings(LOADED), "site");
        expect(labelsSaveBody(LOADED, site)).toEqual({ siteStrings: {} });
        const commerce = resetSection(draftFromSettings(LOADED), "commerce");
        expect(overrideCount(draftFromSettings(LOADED), "commerce")).toBe(1);
        expect(labelsSaveBody(LOADED, commerce)).toEqual({ commerceStrings: { futureKey: "kept", broken: 7 } });
    });

    it("the sections do not overlap, and the site section never holds a cookie/legal key", () => {
        const all = [...SECTION_KEYS.site, ...SECTION_KEYS.labels, ...SECTION_KEYS.catalog, ...SECTION_KEYS.product, ...SECTION_KEYS.commerce];
        expect(new Set(all).size).toBe(all.length);
        expect(SECTION_KEYS.labels).toHaveLength(9);
        // LOCALE-1D: + errorTryAgain (the checkout's generic error; site part).
        expect(SECTION_KEYS.site).toHaveLength(43);
        // LOCALE-1B: 28 commerce-part keys in "Product pages & search" (21 new + 7 a catalog renders); the rest are
        // commerce-only: 70 before LOCALE-1D, + its 80 keys = 150 (the commerce part has 178 keys).
        expect(SECTION_KEYS.product).toHaveLength(28);
        expect(SECTION_KEYS.commerce).toHaveLength(150);
        expect(SECTION_KEYS.catalog).toHaveLength(39);
    });

    it("LOCALE-1B: the catalog Reset removes the catalogStrings keys only; the product-pages Reset removes only its commerce keys", () => {
        const loaded = {
            catalogMode: true,
            catalogStrings: { interestAdd: "Vreau", facetsCount: { other: "{n} de articole" }, futureKey: "kept" },
            commerceStrings: { shopTitle: "Catalog", searchButton: "Caută", addToCart: "Pune în coș" },
        };
        const d = draftFromSettings(loaded);
        expect(overrideCount(d, "catalog")).toBe(2);
        expect(labelsSaveBody(loaded, resetSection(d, "catalog"))).toEqual({ catalogStrings: { futureKey: "kept" } });
        expect(overrideCount(d, "product")).toBe(2);
        expect(labelsSaveBody(loaded, resetSection(d, "product"))).toEqual({ commerceStrings: { addToCart: "Pune în coș" } });
        expect(overrideCount(d, "commerce")).toBe(1);
    });
});

describe("LOCALE-1B — count keys: one input per plural category of the tenant's language", () => {
    const loaded = { locale: "ro-RO", catalogMode: true, catalogStrings: { facetsCount: { few: "{n} articole", one: "{n} articol" } } };
    const ctx = (settings: Record<string, unknown>) => {
        const r = resolveLocaleStrings(settings);
        return { draft: draftFromSettings(settings), defaults: r.defaults, language: r.language };
    };

    it("a Romanian tenant edits one / few / other; the placeholders are the Romanian defaults; the stored texts fill the inputs", () => {
        const { draft, defaults, language } = ctx(loaded);
        expect(countInputs(draft, defaults, language, "catalog", "facetsCount")).toEqual([
            { category: "one", value: "{n} articol", placeholder: "{n} produs" },
            { category: "few", value: "{n} articole", placeholder: "{n} produse" },
            { category: "other", value: "", placeholder: "{n} de produse" },
        ]);
    });

    it("an English tenant edits one / other, with the English defaults", () => {
        const { draft, defaults, language } = ctx({ commerceEnabled: true });
        expect(countInputs(draft, defaults, language, "commerce", "productCount")).toEqual([
            { category: "one", value: "", placeholder: "{n} product" },
            { category: "other", value: "", placeholder: "{n} products" },
        ]);
    });

    it("a category edit writes the object of texts; clearing the last category removes the key; other categories are kept", () => {
        let d = setCountText(draftFromSettings(loaded), "catalog", "facetsCount", "other", "{n} de articole");
        expect(labelsSaveBody(loaded, d)).toEqual({ catalogStrings: { facetsCount: { few: "{n} articole", one: "{n} articol", other: "{n} de articole" } } });
        d = setCountText(setCountText(draftFromSettings(loaded), "catalog", "facetsCount", "few", ""), "catalog", "facetsCount", "one", "");
        expect(labelsSaveBody(loaded, d)).toEqual({ catalogStrings: {} });
        // a stored category the tenant's language does not use (English `two`) is kept by an edit of another one
        const mixed = { catalogStrings: { facetsCount: { two: "kept" } } };
        expect(labelsSaveBody(mixed, setCountText(draftFromSettings(mixed), "catalog", "facetsCount", "one", "1 item")))
            .toEqual({ catalogStrings: { facetsCount: { two: "kept", one: "1 item" } } });
    });
});

describe("one input per key: the page's inputs are exactly each Reset's scope (review-0 R2)", () => {
    // The inputs as written in the page source: `<F … field="k" />` and, for a count key, `<CountF … field="k" />`
    // (section defaults to "commerce") — a deterministic read of the JSX, so a key added to a Reset scope without an
    // input (or the reverse) fails here.
    const source = readFileSync(new URL("./Labels.tsx", import.meta.url), "utf8");
    const inputs: Record<string, string[]> = { commerce: [], site: [], labels: [], catalog: [], product: [] };
    for (const m of source.matchAll(/<(?:F|CountF)\b([^>]*?)\/>/g)) {
        const field = /field="([^"]+)"/.exec(m[1])?.[1];
        const section = /section="([^"]+)"/.exec(m[1])?.[1] ?? "commerce";
        if (field) inputs[section].push(field);
    }

    for (const section of ["commerce", "site", "labels", "catalog", "product"] as const) {
        it(`${section}: every key the Reset covers has exactly one input, and every input is a key it covers`, () => {
            expect(inputs[section].length).toBe(new Set(inputs[section]).size);
            expect([...inputs[section]].sort()).toEqual([...SECTION_KEYS[section]].sort());
        });
    }

    it("LOCALE-1B: every count key's input is a CountF, every other key's an F; the product section edits commerceStrings", () => {
        const countFields = [...source.matchAll(/<CountF\b([^>]*?)\/>/g)].map((m) => /field="([^"]+)"/.exec(m[1])![1]).sort();
        expect(countFields).toEqual(["facetsCount", "interestWidgetLabel", "productCount", "reviewsSummary", "searchResultCount"]);
        expect(SECTION_HOME.product).toBe("commerce");
    });

    it("LOCALE-1D: the commerce Reset covers the 80 commerce-only keys of 1d (each with one input) and the stored copies of an old \"apply pack\"", () => {
        const added = ["metaCartTitle", "personalizationRequired", "cartWidgetTotal", "calendarMo", "orderStatusAnnulled", "myAccount", "codPayOnDelivery", "orderStepPending", "orderHistoryAnnulled", "items"];
        for (const k of added) {
            expect(SECTION_KEYS.commerce, k).toContain(k);
            expect(inputs.commerce.filter((f) => f === k), k).toHaveLength(1);
        }
        expect(inputs.site).toContain("errorTryAgain");
        // A Romanian shop that holds copies written by the removed "Overwrite All Texts" (§ 4.2): Reset removes all of them.
        const loaded = { locale: "ro-RO", commerceEnabled: true, commerceStrings: { addToCart: "Adaugă în coș", checkout: "Finalizare comandă", signIn: "Autentificare", futureKey: "kept" } };
        const d = draftFromSettings(loaded);
        expect(overrideCount(d, "commerce")).toBe(3);
        expect(labelsSaveBody(loaded, resetSection(d, "commerce"))).toEqual({ commerceStrings: { futureKey: "kept" } });
    });

    it("the reviewer's reproduction: an emptyCart override counts 1, has an input, and Reset removes only it", () => {
        const loaded = { commerceStrings: { emptyCart: "Coșul e gol", futureKey: "kept" } };
        const d = draftFromSettings(loaded);
        expect(overrideCount(d, "commerce")).toBe(1);
        expect(inputs.commerce).toContain("emptyCart");
        expect(labelsSaveBody(loaded, resetSection(d, "commerce"))).toEqual({ commerceStrings: { futureKey: "kept" } });
    });
});
