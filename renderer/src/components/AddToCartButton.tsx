"use client";

import { useState, useMemo } from "react";
import { useCart } from "@/context/CartContext";
import { useTenantUrl } from "@/lib/routing";
import { ShoppingCart, Check, Minus, Plus } from "lucide-react";

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
}

export function AddToCartButton({
    productId, title, slug, imageLink, price, salePrice,
    currency, availability, variants, personalizations, volumePricing,
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

    // Effective price (considering variant override, sale, volume)
    const effectiveUnitPrice = useMemo(() => {
        if (activeVariantOption?.priceOverride) {
            return parseFloat(activeVariantOption.priceOverride);
        }
        // Volume pricing
        if (volumePricing.length > 0) {
            const sorted = [...volumePricing].sort((a, b) => b.minQuantity - a.minQuantity);
            const tier = sorted.find(t => quantity >= t.minQuantity);
            if (tier) return parseFloat(tier.price);
        }
        return parseFloat(salePrice || price);
    }, [activeVariantOption, salePrice, price, volumePricing, quantity]);

    // Personalization total cost
    const personalizationCost = useMemo(() => {
        return personalizations.reduce((sum, p) => {
            if (personalizationValues[p.id] && parseFloat(p.addedCost) > 0) {
                return sum + parseFloat(p.addedCost);
            }
            return sum;
        }, 0);
    }, [personalizations, personalizationValues]);

    const lineTotal = (effectiveUnitPrice + personalizationCost) * quantity;

    // Check variant availability
    const isOutOfStock = availability !== "in_stock" && availability !== "preorder";
    const variantOutOfStock = activeVariantOption?.availability === "out_of_stock";
    const canAdd = !isOutOfStock && !variantOutOfStock;

    function handleAddToCart() {
        setError("");

        // Validate required personalizations
        for (const p of personalizations) {
            if (p.required && !personalizationValues[p.id]?.trim()) {
                setError(`Please fill in "${p.label}"`);
                return;
            }
        }

        // Validate variant selection
        for (const v of variants) {
            if (!selectedVariants[v.id]) {
                setError(`Please select ${v.name}`);
                return;
            }
        }

        const variantLabel = variants.length > 0
            ? variants.map(v => `${v.name}: ${selectedVariants[v.id]}`).join(", ")
            : undefined;

        const cartPersonalizations = personalizations
            .filter(p => personalizationValues[p.id]?.trim())
            .map(p => ({
                label: p.label,
                value: personalizationValues[p.id].trim(),
                addedCost: parseFloat(p.addedCost) || 0,
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
            quantity,
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
                        {parseFloat(p.addedCost) > 0 && (
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
                            <option value="">Select...</option>
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
                            Added to Cart!
                        </>
                    ) : !canAdd ? (
                        variantOutOfStock ? "Variant Unavailable" : "Out of Stock"
                    ) : (
                        <>
                            <ShoppingCart className="h-4 w-4" />
                            Add to Cart — {lineTotal.toFixed(2)} {currency}
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
                    View Cart
                </a>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
    );
}
