import { describe, it, expect } from "vitest";
import { URL_PREFIX_DEFAULTS, UrlPrefixesSchema, urlPrefixesOf } from "../src/index";

/**
 * CDL-2 — `urlPrefixesOf`, the one path rule (docs/slices/catalog-data-labels-1.md § 7.1, ruling § 9 item 5): per key,
 * the stored non-blank text, else `URL_PREFIX_DEFAULTS[key]`. One `it` per row of the packet's evidence taxonomy
 * (record docs/slices/cdl-2.md § 5).
 */
const KEYS = Object.keys(URL_PREFIX_DEFAULTS) as (keyof typeof URL_PREFIX_DEFAULTS)[];
const FULL = {
    product: "/produs", category: "/categorie", cart: "/cos", checkout: "/comanda", shop: "/magazin",
    account: "/cont", search: "/cauta", interest: "/lista-mea", checkoutConfirmation: "/multumim",
};

describe("CDL-2 urlPrefixesOf — the saved path, else the English default", () => {
    it("stored urlPrefixes absent → every key = its default", () => {
        expect(urlPrefixesOf(undefined)).toEqual(URL_PREFIX_DEFAULTS);
    });

    it("stored urlPrefixes full object → every key = the stored value", () => {
        expect(urlPrefixesOf(FULL)).toEqual(FULL);
        expect([...KEYS].sort()).toEqual(Object.keys(FULL).sort());   // the fixture covers every key
    });

    it("stored urlPrefixes partial (only interest) → stored keys kept; every other key = its default", () => {
        expect(urlPrefixesOf({ interest: "/lista-mea" })).toEqual({ ...URL_PREFIX_DEFAULTS, interest: "/lista-mea" });
        expect(urlPrefixesOf({ product: "/produs", checkoutConfirmation: "/multumim" }))
            .toEqual({ ...URL_PREFIX_DEFAULTS, product: "/produs", checkoutConfirmation: "/multumim" });
    });

    it("a stored key \"\" or whitespace → that key = its default; a non-blank value is kept as stored (not trimmed)", () => {
        expect(urlPrefixesOf({ ...FULL, shop: "", interest: "   ", checkout: "\t\n" }))
            .toEqual({ ...FULL, shop: "/shop", interest: "/my-list", checkout: "/checkout" });
        expect(urlPrefixesOf({ shop: " /magazin " }).shop).toBe(" /magazin ");
    });

    it("a stored key that is not a text (number, null, object, array, boolean) → that key = its default", () => {
        expect(urlPrefixesOf({ product: 5, category: null, cart: { a: 1 }, checkout: ["/x"], shop: true, search: "/cauta" }))
            .toEqual({ ...URL_PREFIX_DEFAULTS, search: "/cauta" });
    });

    it("stored urlPrefixes not an object (text, array, null, number) → as absent", () => {
        for (const stored of ["/produs", ["/produs"], null, 7, true]) {
            expect(urlPrefixesOf(stored), JSON.stringify(stored)).toEqual(URL_PREFIX_DEFAULTS);
        }
    });

    it("unknown stored keys are not copied; the answer has exactly the keys of URL_PREFIX_DEFAULTS", () => {
        expect(Object.keys(urlPrefixesOf({ ...FULL, extra: "/x" })).sort()).toEqual([...KEYS].sort());
    });

    it("the answer is a new object: neither the input nor URL_PREFIX_DEFAULTS is returned or changed", () => {
        const stored = { interest: "/lista-mea" };
        const out = urlPrefixesOf(stored);
        expect(out).not.toBe(URL_PREFIX_DEFAULTS);
        out.shop = "/changed";
        expect(URL_PREFIX_DEFAULTS.shop).toBe("/shop");
        expect(stored).toEqual({ interest: "/lista-mea" });
    });

    it("the schema holds the same keys as the defaults (checkoutConfirmation included)", () => {
        expect(UrlPrefixesSchema.parse({})).toEqual(URL_PREFIX_DEFAULTS);
        expect(UrlPrefixesSchema.parse({ checkoutConfirmation: "/multumim" }).checkoutConfirmation).toBe("/multumim");
    });
});
