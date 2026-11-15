// ORDER-PRICE-1 (docs/slices/order-price-1.md § 1 item 1) — the one price rule of an order line. Each `it` names the
// taxonomy row it binds (record § "Evidence taxonomy"). Pure: no I/O.
import { describe, expect, it } from "vitest";
import { OrderInputSchema, linePrice, roundToCents, type LinePriceResult } from "../src/index";

const priced = (r: LinePriceResult) => {
    if (r.kind !== "priced") throw new Error(`expected priced, got ${JSON.stringify(r)}`);
    return r;
};

describe("linePrice — the unit price", () => {
    it("price only, quantity 2 → unit = price; total = 2 × price", () => {
        expect(priced(linePrice({ price: "12.50" }, 2))).toEqual({ kind: "priced", unitPrice: 12.5, addedCost: 0, lineTotal: 25 });
    });

    it("salePrice set → unit = sale price", () => {
        expect(priced(linePrice({ price: "100.00", salePrice: "80.00" }, 1)).unitPrice).toBe(80);
    });

    it("salePrice \"\" → unit = price (an empty text is absent, as the browser's `salePrice || price`)", () => {
        expect(priced(linePrice({ price: "100.00", salePrice: "" }, 1)).unitPrice).toBe(100);
    });

    it("tiers [{5, \"9\"}, {10, \"8\"}], quantity 1 / 5 / 9 / 10 / 50 → base / 9 / 9 / 8 / 8", () => {
        const inputs = { price: "10", volumePricing: [{ minQuantity: 5, price: "9" }, { minQuantity: 10, price: "8" }] };
        expect([1, 5, 9, 10, 50].map((q) => priced(linePrice(inputs, q)).unitPrice)).toEqual([10, 9, 9, 8, 8]);
        expect(priced(linePrice(inputs, 10)).lineTotal).toBe(80);
    });

    it("tiers given in any order → the same result", () => {
        const ordered = { price: "10", volumePricing: [{ minQuantity: 5, price: "9" }, { minQuantity: 10, price: "8" }] };
        const reversed = { price: "10", volumePricing: [{ minQuantity: 10, price: "8" }, { minQuantity: 5, price: "9" }] };
        for (const q of [1, 5, 9, 10, 50]) expect(linePrice(reversed, q)).toEqual(linePrice(ordered, q));
    });

    it("the caller's tier array is not reordered (pure)", () => {
        const tiers = [{ minQuantity: 5, price: "9" }, { minQuantity: 10, price: "8" }];
        linePrice({ price: "10", volumePricing: tiers }, 10);
        expect(tiers.map((t) => t.minQuantity)).toEqual([5, 10]);
    });

    it("tiers and salePrice, quantity under the first tier → sale price", () => {
        const inputs = { price: "100", salePrice: "80", volumePricing: [{ minQuantity: 5, price: "75" }] };
        expect(priced(linePrice(inputs, 4)).unitPrice).toBe(80);
        expect(priced(linePrice(inputs, 5)).unitPrice).toBe(75);
    });

    it("chosen option with priceOverride (with tiers present) → the override (the browser's precedence)", () => {
        const inputs = { price: "50", salePrice: "48", volumePricing: [{ minQuantity: 2, price: "40" }], priceOverride: "45" };
        expect(priced(linePrice(inputs, 1)).unitPrice).toBe(45);
        expect(priced(linePrice(inputs, 10)).unitPrice).toBe(45);
    });

    it("chosen option without priceOverride → tier or base rule", () => {
        const inputs = { price: "50", volumePricing: [{ minQuantity: 2, price: "40" }] };
        expect(priced(linePrice({ ...inputs, priceOverride: undefined }, 1)).unitPrice).toBe(50);
        expect(priced(linePrice({ ...inputs, priceOverride: "" }, 2)).unitPrice).toBe(40);
    });
});

describe("linePrice — the added cost", () => {
    it("one added cost \"5\", unit \"12.50\", quantity 2 → unit + cost = 17.5; total 35 (never 25.001)", () => {
        const r = priced(linePrice({ price: "12.50", addedCosts: ["5"] }, 2));
        expect(r.unitPrice + r.addedCost).toBe(17.5);
        expect(r.lineTotal).toBe(35);
    });

    it("added cost \"0\", \"\", absent → adds 0", () => {
        expect(priced(linePrice({ price: "10", addedCosts: ["0"] }, 1)).addedCost).toBe(0);
        expect(priced(linePrice({ price: "10", addedCosts: [""] }, 1)).addedCost).toBe(0);
        expect(priced(linePrice({ price: "10", addedCosts: ["  "] }, 1)).addedCost).toBe(0);
        expect(priced(linePrice({ price: "10", addedCosts: [] }, 1)).addedCost).toBe(0);
        expect(priced(linePrice({ price: "10" }, 1)).addedCost).toBe(0);
    });

    it("two added costs → their sum", () => {
        expect(priced(linePrice({ price: "10", addedCosts: ["5", "2.50"] }, 2))).toEqual({ kind: "priced", unitPrice: 10, addedCost: 7.5, lineTotal: 35 });
    });
});

describe("linePrice — named failures (never NaN, never 0)", () => {
    it("price \"\", \"abc\", negative, absent → invalid-price from `price`", () => {
        for (const price of ["", "abc", "-5", undefined]) {
            expect(linePrice({ price }, 1)).toEqual({ kind: "invalid-price", source: "price", text: price ?? "" });
        }
    });

    it("text that parseFloat would half-read (\"12,50\", \"12abc\", \"1e3\", \"0x10\") → invalid-price", () => {
        for (const price of ["12,50", "12abc", "1e3", "0x10", "Infinity", "NaN"]) {
            expect(linePrice({ price }, 1).kind, price).toBe("invalid-price");
        }
    });

    it("a tier price that does not parse → invalid-price from `volumePricing`", () => {
        expect(linePrice({ price: "10", volumePricing: [{ minQuantity: 2, price: "x" }] }, 2))
            .toEqual({ kind: "invalid-price", source: "volumePricing", text: "x" });
    });

    it("an override that does not parse → invalid-price from `priceOverride`", () => {
        expect(linePrice({ price: "10", priceOverride: "ten" }, 1)).toEqual({ kind: "invalid-price", source: "priceOverride", text: "ten" });
    });

    it("a salePrice that does not parse → invalid-price from `salePrice`", () => {
        expect(linePrice({ price: "10", salePrice: "-1" }, 1)).toEqual({ kind: "invalid-price", source: "salePrice", text: "-1" });
    });

    it("an added cost that does not parse → invalid-price from `addedCost`", () => {
        expect(linePrice({ price: "10", addedCosts: ["5", "five"] }, 1)).toEqual({ kind: "invalid-price", source: "addedCost", text: "five" });
    });

    it("only the selected text is parsed: a bad base price does not fail a line the tier prices", () => {
        expect(priced(linePrice({ price: "", volumePricing: [{ minQuantity: 2, price: "8" }] }, 2)).unitPrice).toBe(8);
    });

    it("surrounding spaces and a bare decimal form parse", () => {
        expect(priced(linePrice({ price: " 12.5 " }, 1)).unitPrice).toBe(12.5);
        expect(priced(linePrice({ price: ".5" }, 2)).lineTotal).toBe(1);
        expect(priced(linePrice({ price: "0" }, 3)).lineTotal).toBe(0);
    });
});

describe("rounding to cents", () => {
    it("totals with float noise (0.1 + 0.2 class) → rounded to cents", () => {
        expect(priced(linePrice({ price: "0.1", addedCosts: ["0.2"] }, 1)).lineTotal).toBe(0.3);
        expect(priced(linePrice({ price: "0.1" }, 3)).lineTotal).toBe(0.3);
        expect(priced(linePrice({ price: "19.99" }, 3)).lineTotal).toBe(59.97);
        expect(roundToCents(0.1 + 0.2)).toBe(0.3);
        expect(roundToCents(1.005)).toBe(1.01);
        expect(roundToCents(2.675)).toBe(2.68);
        expect(roundToCents(25.001)).toBe(25);
    });
});

describe("OrderInputSchema — the personalization `id` is optional (§ 1 item 3)", () => {
    const order = (personalizations: unknown) => ({
        items: [{ productId: "c0000000-0000-4000-8000-000000000002", quantity: 1, personalizations }],
        customerEmail: "a@b.test", customerName: "A", paymentMethod: "cod",
    });

    it("the checkout's payload before this slice ({label, value, addedCost}) is accepted; addedCost is stripped", () => {
        const r = OrderInputSchema.safeParse(order([{ label: "Engraving", value: "AB", addedCost: "5" }]));
        expect(r.success).toBe(true);
        expect(r.success && r.data.items[0].personalizations).toEqual([{ label: "Engraving", value: "AB" }]);
    });

    it("a personalization with id is accepted and keeps the id", () => {
        const r = OrderInputSchema.safeParse(order([{ id: "engr", label: "Engraving", value: "AB" }]));
        expect(r.success && r.data.items[0].personalizations).toEqual([{ id: "engr", label: "Engraving", value: "AB" }]);
    });
});
