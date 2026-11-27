// The order line price rule (ORDER-PRICE-1) and the money-text parser (PRICE-LOCALE-1).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { normalizeLocale } from "./locale-strings.js";
import type { VolumePricingTier } from "./products.js";

// --- ORDER LINE PRICE (ORDER-PRICE-1, docs/slices/order-price-1.md § 1 item 1) ---

/**
 * The price data of one order line, as the product stores it (money is text). `priceOverride` is the `priceOverride`
 * of the chosen option of the product's FIRST variant group (absent when nothing is chosen or the option has none).
 * `addedCosts` are the `addedCost` texts of the personalizations the line carries. The renderer's cart stores this
 * object as is (a browser-boundary DTO), so it must stay plain JSON.
 */
export interface LinePriceInputs {
    price?: string;
    salePrice?: string;
    volumePricing?: readonly VolumePricingTier[];
    priceOverride?: string;
    addedCosts?: readonly string[];
}

/** The input field whose money text did not parse. */
export type LinePriceSource = "price" | "salePrice" | "volumePricing" | "priceOverride" | "addedCost";

export type LinePriceResult =
    | { kind: "priced"; unitPrice: number; addedCost: number; lineTotal: number }
    | { kind: "invalid-price"; source: LinePriceSource; text: string };

/**
 * Machine money text: digits with an optional decimal point, nothing else (no sign, exponent, comma or currency).
 * Every import and every stored or computed value uses this form.
 */
const MONEY_TEXT = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * PRICE-LOCALE-1: money text with a decimal comma, read only for a locale that writes a decimal comma. The integer part
 * is plain digits or digits grouped by points in groups of three (`1.250`); then the comma and optional decimals. The
 * forms `,50` and `12,` mirror the machine forms `.50` and `12.`. No sign, space, currency, or second comma.
 */
const DECIMAL_COMMA_MONEY_TEXT = /^(?:(?:\d{1,3}(?:\.\d{3})+|\d+),\d*|,\d+)$/;

/**
 * PRICE-LOCALE-1 (docs/slices/price-locale-1.md § 1 item 1): true when the tenant's locale writes decimals with a comma
 * — read from the locale's own number format (`Intl.NumberFormat(locale).formatToParts`, the `decimal` part), never from
 * a list of languages. `ro-RO`, `de-DE` → true; `en-US`, `en-GB` → false. The locale is normalised first, so an absent
 * or unknown value is `en-US` (false). A locale whose decimal separator is neither a comma nor a point (e.g. `ar-EG`,
 * U+066B) → false: it reads machine text only. Never throws.
 */
export function localeUsesDecimalComma(locale: string | undefined): boolean {
    const decimal = new Intl.NumberFormat(normalizeLocale(locale)).formatToParts(1.5).find((part) => part.type === "decimal");
    return decimal?.value === ",";
}

/**
 * The machine form of a money text (PRICE-LOCALE-1), or `undefined` when the text does not parse. A machine text is
 * returned trimmed and otherwise as written (`"10.00"` stays `"10.00"`); a decimal-comma text read by a decimal-comma
 * locale is rewritten without its group points and with a decimal point (`"1.250,50"` → `"1250.50"`, `",50"` →
 * `".50"`). The result always matches `MONEY_TEXT` and is a finite number. The grammar is `parseMoney`'s.
 */
function machineMoneyText(text: string | undefined, locale: string | undefined): string | undefined {
    if (typeof text !== "string") return undefined;
    const trimmed = text.trim();
    let machine: string;
    if (trimmed.includes(",") && localeUsesDecimalComma(locale)) {
        if (!DECIMAL_COMMA_MONEY_TEXT.test(trimmed)) return undefined;
        machine = trimmed.replace(/\./g, "").replace(",", ".");
    } else {
        if (!MONEY_TEXT.test(trimmed)) return undefined;
        machine = trimmed;
    }
    return Number.isFinite(Number(machine)) ? machine : undefined;
}

/**
 * THE money-text parser (PRICE-LOCALE-1 § 1 items 1-2): a stored price text (`price`, `salePrice`, a tier `price`,
 * `priceOverride`, `addedCost`) → its number, read by the tenant's locale. Every text: machine form (digits, optional
 * decimal point; `12.50` → 12.5, `1.250` → 1.25). A locale that writes a decimal comma (`localeUsesDecimalComma`) also
 * reads a text WITH a comma: the comma is the decimal separator and points are group separators (`12,50` → 12.5,
 * `1.250,50` → 1250.5). Anything else (a comma in a point locale, a sign, letters, a currency, a space, two commas,
 * blank text, absent) → `undefined`. Pure; never throws.
 */
export function parseMoney(text: string | undefined, locale: string | undefined): number | undefined {
    const machine = machineMoneyText(text, locale);
    return machine === undefined ? undefined : Number(machine);
}

/**
 * Rounds an amount to cents, half up. `toPrecision(15)` first removes binary float noise (0.1 + 0.2, 1.005 × 100),
 * so the rounding acts on the decimal value the arithmetic meant. For amounts ≥ 0 (every money value here).
 */
export function roundToCents(amount: number): number {
    return Math.round(Number((amount * 100).toPrecision(15))) / 100;
}

/**
 * ORDER-CONFIRM-1 (docs/slices/order-confirm-1.md § 1 item 2): true when two amounts are the same number of whole cents
 * after `roundToCents` (75, 75.004 and 75.00000000000001 are equal; 75 and 75.01 are not). The order handler's one
 * comparison of the visitor's `expectedTotal` with its own total. Pure.
 */
export function sameAmountInCents(a: number, b: number): boolean {
    return roundToCents(a) === roundToCents(b);
}

/**
 * THE price rule of one order line — the product page, the cart, the checkout and the order handler all use it.
 * Unit price: the chosen first-group option's `priceOverride` when it is non-empty; else the volume tier with the
 * largest `minQuantity` ≤ `quantity`; else `salePrice` when non-empty; else `price`. Added cost: the sum of
 * `addedCosts` (an empty text adds 0). Line total: (unit price + added cost) × quantity, rounded to cents.
 * Only the money texts the rule selects are parsed, each by `parseMoney` with the tenant's `locale` (PRICE-LOCALE-1;
 * absent → `en-US`); one that does not parse (or is absent where the rule needs it) gives `invalid-price` with its
 * source — never NaN, never 0. Pure.
 */
export function linePrice(inputs: LinePriceInputs, quantity: number, locale: string | undefined): LinePriceResult {
    let source: LinePriceSource;
    let text: string | undefined;
    const tiers = inputs.volumePricing ?? [];
    const tier = [...tiers].sort((a, b) => b.minQuantity - a.minQuantity).find((t) => quantity >= t.minQuantity);
    if (inputs.priceOverride) {
        source = "priceOverride"; text = inputs.priceOverride;
    } else if (tier) {
        source = "volumePricing"; text = tier.price;
    } else if (inputs.salePrice) {
        source = "salePrice"; text = inputs.salePrice;
    } else {
        source = "price"; text = inputs.price;
    }
    const unitPrice = parseMoney(text, locale);
    if (unitPrice === undefined) return { kind: "invalid-price", source, text: text ?? "" };

    let addedCost = 0;
    for (const costText of inputs.addedCosts ?? []) {
        if (typeof costText === "string" && costText.trim() === "") continue;
        const cost = parseMoney(costText, locale);
        if (cost === undefined) return { kind: "invalid-price", source: "addedCost", text: costText };
        addedCost += cost;
    }
    return { kind: "priced", unitPrice, addedCost, lineTotal: roundToCents((unitPrice + addedCost) * quantity) };
}

export type MachineFormPriceInputs =
    | { kind: "machine-form"; inputs: LinePriceInputs }
    | { kind: "invalid-price"; source: LinePriceSource; text: string };

/**
 * PRICE-LOCALE-1 (ruling PL1-CART-WIRING = N): the price data of a cart line in MACHINE FORM, so the cart can call
 * `linePrice(inputs, quantity, undefined)` without a locale. It keeps exactly the texts `linePrice` can select at some
 * quantity, each rewritten by `machineMoneyText` with the tenant's `locale`:
 * - a non-empty `priceOverride` → only it (the rule then reads nothing else);
 * - otherwise every tier price, and the base: `salePrice` when non-empty, else `price` (a `price` hidden by a non-empty
 *   `salePrice` is never read and is omitted);
 * - every `addedCost` (a blank one stays `""`, which `linePrice` adds as 0).
 * The first of those texts that does not parse (or a base that is absent) → `invalid-price` with its source: the caller
 * does not store the line. Pure.
 */
export function toMachineFormPriceInputs(inputs: LinePriceInputs, locale: string | undefined): MachineFormPriceInputs {
    const convert = (source: LinePriceSource, text: string | undefined): string | MachineFormPriceInputs => {
        const machine = machineMoneyText(text, locale);
        return machine ?? { kind: "invalid-price", source, text: text ?? "" };
    };
    const addedCosts: string[] = [];
    for (const costText of inputs.addedCosts ?? []) {
        if (typeof costText === "string" && costText.trim() === "") { addedCosts.push(""); continue; }
        const machine = convert("addedCost", costText);
        if (typeof machine !== "string") return machine;
        addedCosts.push(machine);
    }
    if (inputs.priceOverride) {
        const priceOverride = convert("priceOverride", inputs.priceOverride);
        if (typeof priceOverride !== "string") return priceOverride;
        return { kind: "machine-form", inputs: { priceOverride, addedCosts } };
    }
    const volumePricing: VolumePricingTier[] = [];
    for (const tier of inputs.volumePricing ?? []) {
        const price = convert("volumePricing", tier.price);
        if (typeof price !== "string") return price;
        volumePricing.push({ ...tier, price });
    }
    if (inputs.salePrice) {
        const salePrice = convert("salePrice", inputs.salePrice);
        if (typeof salePrice !== "string") return salePrice;
        return { kind: "machine-form", inputs: { salePrice, volumePricing, addedCosts } };
    }
    const price = convert("price", inputs.price);
    if (typeof price !== "string") return price;
    return { kind: "machine-form", inputs: { price, volumePricing, addedCosts } };
}
