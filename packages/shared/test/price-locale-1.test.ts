// PRICE-LOCALE-1 (docs/slices/price-locale-1.md § 1 item 1) — a price text with a decimal comma is read by the
// tenant's locale. Each `it` names the taxonomy row it binds (record § 4). Pure: no I/O.
import { describe, expect, it } from "vitest";
import { linePrice, localeUsesDecimalComma, parseMoney, toMachineFormPriceInputs, type LinePriceInputs, type LinePriceResult } from "../src/index";

const priced = (r: LinePriceResult) => {
    if (r.kind !== "priced") throw new Error(`expected priced, got ${JSON.stringify(r)}`);
    return r;
};

describe("localeUsesDecimalComma — read from the locale's own number format", () => {
    it("ro-RO, de-DE → true; en-US, en-GB → false", () => {
        expect(["ro-RO", "de-DE", "en-US", "en-GB"].map(localeUsesDecimalComma)).toEqual([true, true, false, false]);
    });

    it("absent, malformed or unknown locale → false (the en-US default)", () => {
        expect([undefined, "", "123", "not a locale"].map(localeUsesDecimalComma)).toEqual([false, false, false, false]);
    });

    it("a locale whose decimal separator is neither a comma nor a point (ar-EG) → false", () => {
        expect(localeUsesDecimalComma("ar-EG")).toBe(false);
    });
});

describe("parseMoney — ro-RO (a decimal-comma locale)", () => {
    it("12,50 / 12,5 / 0,99 → 12.5 / 12.5 / 0.99", () => {
        expect(["12,50", "12,5", "0,99"].map((t) => parseMoney(t, "ro-RO"))).toEqual([12.5, 12.5, 0.99]);
    });

    it("1.250,50 → 1250.5 (points are group separators); 1.250,5 → 1250.5; 1250,50 → 1250.5", () => {
        expect(["1.250,50", "1.250,5", "1250,50", "1.000.000,00"].map((t) => parseMoney(t, "ro-RO"))).toEqual([1250.5, 1250.5, 1250.5, 1000000]);
    });

    it("12.50 / 1.250 / 99 → 12.5 / 1.25 / 99 (a text without a comma is machine form)", () => {
        expect(["12.50", "1.250", "99"].map((t) => parseMoney(t, "ro-RO"))).toEqual([12.5, 1.25, 99]);
    });

    it("12,50,1 / 1,250.50 / -12,50 / 12,50 lei / abc / \"\" → failure for each", () => {
        for (const t of ["12,50,1", "1,250.50", "-12,50", "12,50 lei", "abc", "", "   "]) {
            expect(parseMoney(t, "ro-RO"), t).toBeUndefined();
        }
    });

    it("more failures: a space as group separator, a group that is not three digits, a point after the comma, a comma alone", () => {
        for (const t of ["1 250,50", "1.25,50", "12.50,5", "1,250.5", ",", ".", "1.250.000", "+12,50", "12,50€", "1e3", "12,5e1"]) {
            expect(parseMoney(t, "ro-RO"), t).toBeUndefined();
        }
    });

    it(",50 and 12, mirror the machine forms .50 and 12. (both accepted today): 0.5 and 12", () => {
        expect([".50", "12."].map((t) => parseMoney(t, "en-US"))).toEqual([0.5, 12]);
        expect([",50", "12,", "1.250,"].map((t) => parseMoney(t, "ro-RO"))).toEqual([0.5, 12, 1250]);
    });

    it("surrounding spaces are trimmed, as for machine text", () => {
        expect(parseMoney("  12,50 ", "ro-RO")).toBe(12.5);
    });
});

describe("parseMoney — en-US (a decimal-point locale): as today", () => {
    it("12.50 → 12.5", () => {
        expect(parseMoney("12.50", "en-US")).toBe(12.5);
    });

    it("12,50 and 1,250.50 → failure (as today)", () => {
        expect(parseMoney("12,50", "en-US")).toBeUndefined();
        expect(parseMoney("1,250.50", "en-US")).toBeUndefined();
    });
});

describe("parseMoney — the rule follows the locale, not a language list", () => {
    it("de-DE (another comma locale) 12,50 → 12.5; en-GB (another point locale) 12,50 → failure", () => {
        expect(parseMoney("12,50", "de-DE")).toBe(12.5);
        expect(parseMoney("12,50", "en-GB")).toBeUndefined();
    });

    it("de-CH (German language, decimal point) 12,50 → failure", () => {
        expect(parseMoney("12,50", "de-CH")).toBeUndefined();
    });

    it("absent or unknown locale: 12.50 → 12.5; 12,50 → failure (the en-US default)", () => {
        for (const locale of [undefined, "123", "xx-invalid-!!"]) {
            expect(parseMoney("12.50", locale)).toBe(12.5);
            expect(parseMoney("12,50", locale)).toBeUndefined();
        }
    });

    it("the locale is normalised: ro_RO and ro-ro read like ro-RO", () => {
        expect(parseMoney("12,50", "ro_RO")).toBe(12.5);
        expect(parseMoney("12,50", "ro-ro")).toBe(12.5);
    });
});

describe("linePrice — the locale reaches every text the rule reads", () => {
    it("ro-RO: price 12,50, tier 10,00 at 5 → 12.50 at 1; 50.00 at 5", () => {
        const inputs = { price: "12,50", volumePricing: [{ minQuantity: 5, price: "10,00" }] };
        expect(priced(linePrice(inputs, 1, "ro-RO")).lineTotal.toFixed(2)).toBe("12.50");
        expect(priced(linePrice(inputs, 5, "ro-RO")).lineTotal.toFixed(2)).toBe("50.00");
    });

    it("ro-RO: salePrice, priceOverride and addedCost with a comma", () => {
        expect(priced(linePrice({ price: "20,00", salePrice: "15,50" }, 2, "ro-RO"))).toEqual({ kind: "priced", unitPrice: 15.5, addedCost: 0, lineTotal: 31 });
        expect(priced(linePrice({ price: "20,00", priceOverride: "25,25" }, 1, "ro-RO")).unitPrice).toBe(25.25);
        expect(priced(linePrice({ price: "12,50", addedCosts: ["5,5"] }, 2, "ro-RO"))).toEqual({ kind: "priced", unitPrice: 12.5, addedCost: 5.5, lineTotal: 36 });
    });

    it("en-US: price 12,50 → invalid-price (as today)", () => {
        expect(linePrice({ price: "12,50" }, 1, "en-US")).toEqual({ kind: "invalid-price", source: "price", text: "12,50" });
        expect(linePrice({ price: "12.50", addedCosts: ["5,5"] }, 1, "en-US")).toEqual({ kind: "invalid-price", source: "addedCost", text: "5,5" });
    });

    it("byte identity: point texts give the same result in en-US, ro-RO and with no locale", () => {
        const inputs = { price: "100.00", salePrice: "80.00", volumePricing: [{ minQuantity: 5, price: "70.00" }], addedCosts: ["5"] };
        for (const q of [1, 5]) {
            const expected = linePrice(inputs, q, undefined);
            expect(linePrice(inputs, q, "en-US")).toEqual(expected);
            expect(linePrice(inputs, q, "ro-RO")).toEqual(expected);
        }
    });
});

describe("toMachineFormPriceInputs — the cart item stores machine form (ruling PL1-CART-WIRING = N)", () => {
    const machine = (inputs: LinePriceInputs, locale: string | undefined) => {
        const r = toMachineFormPriceInputs(inputs, locale);
        if (r.kind !== "machine-form") throw new Error(`expected machine-form, got ${JSON.stringify(r)}`);
        return r.inputs;
    };

    it("ro-RO: price 12,50, tier 10,00 at 5, added cost 5,5 → 12.50, 10.00, 5.5; the cart's locale-free linePrice gives 12.50 at 1 and 50.00 at 5", () => {
        const inputs = machine({ price: "12,50", volumePricing: [{ minQuantity: 5, price: "10,00" }], addedCosts: ["5,5", ""] }, "ro-RO");
        expect(inputs).toEqual({ price: "12.50", volumePricing: [{ minQuantity: 5, price: "10.00" }], addedCosts: ["5.5", ""] });
        expect(priced(linePrice({ ...inputs, addedCosts: [] }, 1, undefined)).lineTotal.toFixed(2)).toBe("12.50");
        expect(priced(linePrice({ ...inputs, addedCosts: [] }, 5, undefined)).lineTotal.toFixed(2)).toBe("50.00");
    });

    it("ro-RO: 1.250,50 → 1250.50; ,50 → .50; a machine text stays as written (10.00, 99)", () => {
        expect(machine({ price: "1.250,50" }, "ro-RO").price).toBe("1250.50");
        expect(machine({ price: ",50" }, "ro-RO").price).toBe(".50");
        expect(machine({ price: "10.00", volumePricing: [{ minQuantity: 2, price: "99" }] }, "ro-RO")).toEqual({ price: "10.00", volumePricing: [{ minQuantity: 2, price: "99" }], addedCosts: [] });
    });

    it("the same line total from the raw texts with the locale and from the machine form without it", () => {
        const raw: LinePriceInputs = { price: "12,50", salePrice: "11,25", volumePricing: [{ minQuantity: 5, price: "10,00" }], addedCosts: ["0,75"] };
        const m = machine(raw, "ro-RO");
        for (const q of [1, 4, 5, 9]) expect(linePrice(m, q, undefined)).toEqual(linePrice(raw, q, "ro-RO"));
    });

    it("a point tenant's product without salePrice or override: every kept text is the text as written", () => {
        const raw = { price: "100.00", volumePricing: [{ minQuantity: 5, price: "75.00" }], addedCosts: ["5"] };
        expect(machine(raw, "en-US")).toEqual(raw);
        expect(machine(raw, undefined)).toEqual(raw);
    });

    it("a point tenant's product with salePrice, with a chosen priceOverride, or with spaces: the stored inputs keep fewer texts (trimmed), but linePrice gives the same result at every quantity", () => {
        const tiers = [{ minQuantity: 5, price: "75.00" }, { minQuantity: 10, price: "70.00" }];
        const cases: LinePriceInputs[] = [
            { price: "100.00", salePrice: "80.00", volumePricing: tiers, addedCosts: ["5"] },
            { price: "100.00", salePrice: "80.00", volumePricing: tiers, priceOverride: "120.00", addedCosts: ["5", ""] },
            { price: " 100.00 ", volumePricing: [{ minQuantity: 5, price: " 75.00" }], addedCosts: [" 5 "] },
        ];
        expect(machine(cases[0], "en-US")).toEqual({ salePrice: "80.00", volumePricing: tiers, addedCosts: ["5"] });
        expect(machine(cases[1], "en-US")).toEqual({ priceOverride: "120.00", addedCosts: ["5", ""] });
        expect(machine(cases[2], "en-US")).toEqual({ price: "100.00", volumePricing: [{ minQuantity: 5, price: "75.00" }], addedCosts: ["5"] });
        for (const raw of cases) {
            const m = machine(raw, "en-US");
            for (const q of [1, 4, 5, 9, 10, 50]) expect(linePrice(m, q, undefined)).toEqual(linePrice(raw, q, "en-US"));
        }
    });

    it("a point tenant's product with a malformed tier the quantity does not select: linePrice prices quantity 1, but the conversion refuses (the item is not added)", () => {
        const raw = { price: "12.50", volumePricing: [{ minQuantity: 5, price: "10,00" }] };
        expect(priced(linePrice(raw, 1, "en-US")).lineTotal).toBe(12.5);
        expect(toMachineFormPriceInputs(raw, "en-US")).toEqual({ kind: "invalid-price", source: "volumePricing", text: "10,00" });
    });

    it("only the texts the rule can select are kept: a chosen priceOverride hides the rest; a non-empty salePrice hides price", () => {
        expect(machine({ price: "abc", salePrice: "zz", volumePricing: [{ minQuantity: 5, price: "x" }], priceOverride: "25,00", addedCosts: ["1,5"] }, "ro-RO"))
            .toEqual({ priceOverride: "25.00", addedCosts: ["1.5"] });
        expect(machine({ price: "abc", salePrice: "9,99" }, "ro-RO")).toEqual({ salePrice: "9.99", volumePricing: [], addedCosts: [] });
    });

    it("a usable text that does not parse → invalid-price with its source (the item is not added)", () => {
        expect(toMachineFormPriceInputs({ price: "12,50" }, "en-US")).toEqual({ kind: "invalid-price", source: "price", text: "12,50" });
        expect(toMachineFormPriceInputs({ price: "12,50", volumePricing: [{ minQuantity: 5, price: "10,00,1" }] }, "ro-RO")).toEqual({ kind: "invalid-price", source: "volumePricing", text: "10,00,1" });
        expect(toMachineFormPriceInputs({ price: "12,50", addedCosts: ["5 lei"] }, "ro-RO")).toEqual({ kind: "invalid-price", source: "addedCost", text: "5 lei" });
        expect(toMachineFormPriceInputs({ price: "1", priceOverride: "-3" }, "ro-RO")).toEqual({ kind: "invalid-price", source: "priceOverride", text: "-3" });
        expect(toMachineFormPriceInputs({ salePrice: "" }, "ro-RO")).toEqual({ kind: "invalid-price", source: "price", text: "" });
    });
});
