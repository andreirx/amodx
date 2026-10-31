import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { draftFromSettings, labelsSaveBody, overrideCount, resetSection, setText, SECTION_KEYS } from "./Labels";

/**
 * LOCALE-1A — the Labels page's save rules (docs/slices/locale-1.md § 7.1; admin unit checks of § 10 row `locale-1a`):
 * the save keeps `gdpr.enabled`, `gdpr.position` and the four legal URLs; a cleared label is deleted; Reset touches
 * only the label fields (or only its own section's keys); only changed attributes are sent. Pure helpers, node env.
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
    it("copies the three stored homes; a label counts only when it is a non-empty text", () => {
        const d = draftFromSettings(LOADED);
        expect(d.commerce).toEqual(LOADED.commerceStrings);
        expect(d.site).toEqual(LOADED.siteStrings);
        expect(d.labels).toEqual({ cookieHeadline: "Cookie-uri", legalTermsLabel: "Termeni", legalDisputeResolutionLabel: "SAL" });
    });
    it("a tenant with none of the attributes → an empty draft", () => {
        expect(draftFromSettings({ id: "t2" })).toEqual({ commerce: {}, site: {}, labels: {} });
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
        const all = [...SECTION_KEYS.site, ...SECTION_KEYS.labels, ...SECTION_KEYS.commerce];
        expect(new Set(all).size).toBe(all.length);
        expect(SECTION_KEYS.labels).toHaveLength(9);
        expect(SECTION_KEYS.site).toHaveLength(42);
        expect(SECTION_KEYS.commerce).toHaveLength(77);
    });
});

describe("one input per key: the page's inputs are exactly each Reset's scope (review-0 R2)", () => {
    // The inputs as written in the page source: `<F … field="k" />` (part defaults to "commerce") — a deterministic
    // read of the JSX, so a key added to a Reset scope without an input (or the reverse) fails here.
    const source = readFileSync(new URL("./Labels.tsx", import.meta.url), "utf8");
    const inputs: Record<string, string[]> = { commerce: [], site: [], labels: [] };
    for (const m of source.matchAll(/<F\b([^>]*?)\/>/g)) {
        const field = /field="([^"]+)"/.exec(m[1])?.[1];
        const part = /part="([^"]+)"/.exec(m[1])?.[1] ?? "commerce";
        if (field) inputs[part].push(field);
    }

    for (const part of ["commerce", "site", "labels"] as const) {
        it(`${part}: every key the Reset covers has exactly one input, and every input is a key it covers`, () => {
            expect(inputs[part].length).toBe(new Set(inputs[part]).size);
            expect([...inputs[part]].sort()).toEqual([...SECTION_KEYS[part]].sort());
        });
    }

    it("the reviewer's reproduction: an emptyCart override counts 1, has an input, and Reset removes only it", () => {
        const loaded = { commerceStrings: { emptyCart: "Coșul e gol", futureKey: "kept" } };
        const d = draftFromSettings(loaded);
        expect(overrideCount(d, "commerce")).toBe(1);
        expect(inputs.commerce).toContain("emptyCart");
        expect(labelsSaveBody(loaded, resetSection(d, "commerce"))).toEqual({ commerceStrings: { futureKey: "kept" } });
    });
});
