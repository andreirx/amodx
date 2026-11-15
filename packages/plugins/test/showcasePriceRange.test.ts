import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RENDER_LOADERS } from "../src/render";
import { blockStrings, resolveLocaleStrings } from "@amodx/shared";

/**
 * PRICE-LOCALE-1 (docs/slices/price-locale-1.md; ruling PL1-SHOWCASE = C, narrowed) — the category showcase card's
 * price range. The renderer's server pass gives `_priceRange` (computed by the shared parser) only for a decimal-comma
 * tenant's product whose price texts hold a comma; the card prints it. Without it the card's reading is exactly as before
 * (parseFloat — recorded debt F-PL1-9). Harness of `reviewsCarousel.test.ts`: `renderToStaticMarkup`, no DOM; the
 * server prefetch (`prefetchedProducts`) is present, so the browser fallback fetch never runs.
 */

const STRINGS = blockStrings(resolveLocaleStrings({ locale: "ro-RO" }), { catalogMode: false });
const Showcase = (await RENDER_LOADERS["categoryShowcase"]()).default;

const product = (extra: Record<string, unknown>) => ({
    id: "p1", title: "Covor", slug: "covor", price: "12,50", currency: "RON", availability: "in_stock", ...extra,
});
const markup = (products: unknown[]) => renderToStaticMarkup(React.createElement(Showcase, {
    attrs: { categorySlug: "covoare", categoryName: "Covoare", limit: 4, columns: "4", showPrice: true, prefetchedProducts: products },
    strings: STRINGS,
}));
const priceLine = (html: string) => html.match(/<p class="text-sm text-center text-primary font-medium">(.*?)<\/p>/)?.[1];

describe("categoryShowcase card — price range (PRICE-LOCALE-1)", () => {
    it("ro-RO, price 12,50, tier 10,00, with the server's range → the range uses 10 and 12.5", () => {
        const html = markup([product({ volumePricing: [{ minQuantity: 5, price: "10,00" }], _priceRange: { min: 10, max: 12.5 } })]);
        expect(priceLine(html)).toBe("10 – 12.5 RON");
    });

    it("the same product WITHOUT the server's range → today's reading (parseFloat: 10 and 12) — why the server gives it", () => {
        const html = markup([product({ volumePricing: [{ minQuantity: 5, price: "10,00" }] })]);
        expect(priceLine(html)).toBe("10 – 12 RON");
    });

    it("point prices without a range → exactly today's output (75 – 100 USD)", () => {
        const html = markup([product({ price: "100.00", currency: "USD", volumePricing: [{ minQuantity: 5, price: "75.00" }] })]);
        expect(priceLine(html)).toBe("75 – 100 USD");
    });

    it("a range with min = max → the plain price text, as for any product whose tiers equal its price", () => {
        const html = markup([product({ volumePricing: [{ minQuantity: 5, price: "12,50" }], _priceRange: { min: 12.5, max: 12.5 } })]);
        expect(priceLine(html)).toBe("12,50 RON");
    });
});
