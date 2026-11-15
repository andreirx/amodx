"use client";

import { useState, useMemo } from "react";
import { useCart } from "@/context/CartContext";
import { useTenantUrl } from "@/lib/routing";
import { ShoppingCart, Check, Minus, Plus } from "lucide-react";
import { trackFBEvent } from "@/lib/fbpixel";
import { fillTemplate, linePrice, parseMoney, toMachineFormPriceInputs, type LinePriceInputs, type LocaleStrings } from "@amodx/shared";

interface VariantOption {
    value: string;
    priceOverride?: string;
    imageLink?: string;
    availability?: string;
}

interface Variant {
    id: string;
    name: string;
    options: VariantOption[];
}

interface PersonalizationOption {
    id: string;
    label: string;
    type: "text" | "select";
    required: boolean;
    maxLength?: number;
    options?: string[];
    addedCost: string;
}

interface VolumePricingTier {
    minQuantity: number;
    price: string;
}

/**
 * LOCALE-1D (docs/slices/locale-1.md § 5.2, § 5.3): the texts this control renders, resolved by `SitePage` (the F
 * rule — a stored "" falls back to the language default — is applied there for the five button texts).
 */
export type AddToCartStrings = Pick<LocaleStrings["commerce"],
    "addToCart" | "addedToCart" | "viewCart" | "outOfStock" | "variantUnavailable" | "personalizationRequired" | "variantRequired">
    & Pick<LocaleStrings["site"], "formSelectPlaceholder">;

interface AddToCartProps {
    productId: string;
    title: string;
    slug: string;
    imageLink: string;
    price: string;
    salePrice?: string;
    currency: string;
    availability: string;
    variants: Variant[];
    personalizations: PersonalizationOption[];
    volumePricing: VolumePricingTier[];
    strings: AddToCartStrings;
    /**
     * PRICE-LOCALE-1 (docs/slices/price-locale-1.md § 1): the tenant locale the price texts are read with. `SitePage`
     * passes it only for a locale that writes a decimal comma; absent → machine text only (the en-US rule), which is
     * what every decimal-point locale reads, so those tenants' props stay as they were.
     */
    priceLocale?: string;
}

export function AddToCartButton({
    productId, title, slug, imageLink, price, salePrice,
    currency, availability, variants, personalizations, volumePricing,
    strings, priceLocale,
}: AddToCartProps) {
    const { addItem, cartPrefix } = useCart();
    const { getUrl } = useTenantUrl();

    const [quantity, setQuantity] = useState(1);
    const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
    const [personalizationValues, setPersonalizationValues] = useState<Record<string, string>>({});
    const [added, setAdded] = useState(false);
    const [error, setError] = useState("");

    // Determine active variant option (for price override & availability)
    const activeVariantOption = useMemo(() => {
        if (variants.length === 0) return null;
        const v = variants[0]; // Support first variant group for now
        const selectedVal = selectedVariants[v.id];
        if (!selectedVal) return null;
        return v.options.find(o => o.value === selectedVal) || null;
    }, [variants, selectedVariants]);

    // ORDER-PRICE-1: the personalizations the cart line will carry (a non-blank value) and the price data of the
    // shared rule — the rule the order handler charges. The cart stores them (in machine form, PRICE-LOCALE-1) so the
    // line follows the quantity.
    const chosenPersonalizations = useMemo(
        () => personalizations.filter(p => personalizationValues[p.id]?.trim()),
        [personalizations, personalizationValues],
    );
    const priceInputs = useMemo<LinePriceInputs>(() => ({
        price, salePrice, volumePricing,
        priceOverride: activeVariantOption?.priceOverride,
        addedCosts: chosenPersonalizations.map(p => p.addedCost),
    }), [price, salePrice, volumePricing, activeVariantOption, chosenPersonalizations]);
    const priced = useMemo(() => linePrice(priceInputs, quantity, priceLocale), [priceInputs, quantity, priceLocale]);
    // NaN when the product's price data does not parse (as the former arithmetic showed it); the order handler refuses it.
    const effectiveUnitPrice = priced.kind === "priced" ? priced.unitPrice : NaN;
    const lineTotal = priced.kind === "priced" ? priced.lineTotal : NaN;

    // Check variant availability
    const isOutOfStock = availability !== "in_stock" && availability !== "preorder";
    const variantOutOfStock = activeVariantOption?.availability === "out_of_stock";
    const canAdd = !isOutOfStock && !variantOutOfStock;

    function handleAddToCart() {
        setError("");

        // Validate required personalizations
        for (const p of personalizations) {
            if (p.required && !personalizationValues[p.id]?.trim()) {
                setError(fillTemplate(strings.personalizationRequired, { label: p.label }));
                return;
            }
        }

        // Validate variant selection
        for (const v of variants) {
            if (!selectedVariants[v.id]) {
                setError(fillTemplate(strings.variantRequired, { name: v.name }));
                return;
            }
        }

        // PRICE-LOCALE-1 (ruling PL1-CART-WIRING = N): the cart item stores the price texts in MACHINE FORM (read here
        // with the tenant locale), so the cart needs no locale. A text the line can use that does not parse → the item
        // is not added; the button keeps showing what it showed before this slice for such a price (NaN).
        const machine = toMachineFormPriceInputs(priceInputs, priceLocale);
        if (machine.kind === "invalid-price") return;

        const variantLabel = variants.length > 0
            ? variants.map(v => `${v.name}: ${selectedVariants[v.id]}`).join(", ")
            : undefined;

        const cartPersonalizations = chosenPersonalizations
            .map(p => ({
                id: p.id,
                label: p.label,
                value: personalizationValues[p.id].trim(),
                addedCost: parseMoney(p.addedCost, priceLocale) ?? 0,
            }));

        addItem({
            productId,
            productTitle: title,
            productImage: imageLink || "",
            productSlug: slug,
            unitPrice: effectiveUnitPrice,
            currency,
            selectedVariant: variantLabel,
            personalizations: cartPersonalizations,
            priceInputs: machine.inputs,
            quantity,
        });

        trackFBEvent("AddToCart", {
            content_ids: [productId],
            content_name: title,
            content_type: "product",
            value: lineTotal,
            currency,
        });

        setAdded(true);
        setTimeout(() => setAdded(false), 2000);
    }

    return (
        <div className="space-y-4 border-t pt-6">
            {/* Variant Selectors */}
            {variants.map(v => (
                <div key={v.id}>
                    <label className="text-sm font-medium block mb-2">{v.name}</label>
                    <div className="flex flex-wrap gap-2">
                        {v.options.map(opt => {
                            const isSelected = selectedVariants[v.id] === opt.value;
                            const isUnavailable = opt.availability === "out_of_stock";
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => setSelectedVariants(prev => ({ ...prev, [v.id]: opt.value }))}
                                    disabled={isUnavailable}
                                    className={`px-4 py-2 border rounded-md text-sm font-medium transition-colors ${
                                        isSelected
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : isUnavailable
                                                ? "border-muted text-muted-foreground line-through opacity-50 cursor-not-allowed"
                                                : "border-border hover:border-primary hover:bg-muted"
                                    }`}
                                >
                                    {opt.value}
                                    {opt.priceOverride && (
                                        <span className="ml-1 text-xs opacity-75">({opt.priceOverride} {currency})</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* Personalization Inputs */}
            {personalizations.map(p => (
                <div key={p.id}>
                    <label className="text-sm font-medium block mb-1">
                        {p.label} {p.required && <span className="text-red-500">*</span>}
                        {(parseMoney(p.addedCost, priceLocale) ?? 0) > 0 && (
                            <span className="text-muted-foreground ml-1 font-normal">(+{p.addedCost} {currency})</span>
                        )}
                    </label>
                    {p.type === "text" ? (
                        <input
                            value={personalizationValues[p.id] || ""}
                            onChange={e => setPersonalizationValues(prev => ({ ...prev, [p.id]: e.target.value }))}
                            maxLength={p.maxLength}
                            placeholder={p.label}
                            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        />
                    ) : (
                        <select
                            value={personalizationValues[p.id] || ""}
                            onChange={e => setPersonalizationValues(prev => ({ ...prev, [p.id]: e.target.value }))}
                            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        >
                            <option value="">{strings.formSelectPlaceholder}</option>
                            {(p.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                    )}
                </div>
            ))}

            {/* Quantity + Add to Cart */}
            <div className="flex items-center gap-4 pt-2">
                <div className="flex items-center border rounded-md">
                    <button
                        onClick={() => setQuantity(q => Math.max(1, q - 1))}
                        className="px-3 py-2 hover:bg-muted transition-colors"
                    >
                        <Minus className="h-4 w-4" />
                    </button>
                    <span className="px-4 py-2 font-medium min-w-[3rem] text-center">{quantity}</span>
                    <button
                        onClick={() => setQuantity(q => q + 1)}
                        className="px-3 py-2 hover:bg-muted transition-colors"
                    >
                        <Plus className="h-4 w-4" />
                    </button>
                </div>

                <button
                    onClick={handleAddToCart}
                    disabled={!canAdd}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-md font-medium text-sm transition-all ${
                        added
                            ? "bg-green-600 text-white"
                            : canAdd
                                ? "bg-primary text-primary-foreground hover:opacity-90"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                    }`}
                >
                    {added ? (
                        <>
                            <Check className="h-4 w-4" />
                            {strings.addedToCart}
                        </>
                    ) : !canAdd ? (
                        variantOutOfStock ? strings.variantUnavailable : strings.outOfStock
                    ) : (
                        <>
                            <ShoppingCart className="h-4 w-4" />
                            {strings.addToCart} — {lineTotal.toFixed(2)} {currency}
                        </>
                    )}
                </button>
            </div>

            {/* View Cart link after adding */}
            {added && (
                <a
                    href={getUrl(cartPrefix)}
                    className="block text-center text-sm text-primary hover:underline"
                >
                    {strings.viewCart}
                </a>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
    );
}
