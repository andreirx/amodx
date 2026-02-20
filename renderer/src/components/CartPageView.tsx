"use client";

import { useCart } from "@/context/CartContext";
import { useTenantUrl } from "@/lib/routing";
import Link from "next/link";
import { Minus, Plus, Trash2, Tag } from "lucide-react";
import { useState } from "react";

interface CartPageProps {
    checkoutPrefix: string;
    shopPrefix: string;
    freeDeliveryThreshold: number;
    flatShippingCost: number;
    minimumOrderAmount: number;
    currency: string;
    tenantId: string;
    apiUrl: string;
    contentMaxWidth?: string;
}

export function CartPageView({ checkoutPrefix, shopPrefix, freeDeliveryThreshold, flatShippingCost, minimumOrderAmount, currency, tenantId, apiUrl, contentMaxWidth = "max-w-6xl" }: CartPageProps) {
    const { items, removeItem, updateQuantity, subtotal, itemCount, coupon, setCoupon } = useCart();
    const { getUrl } = useTenantUrl();

    const [couponCode, setCouponCode] = useState(coupon?.code || "");
    const [couponError, setCouponError] = useState("");
    const [couponLoading, setCouponLoading] = useState(false);

    const couponDiscount = coupon?.discount || 0;
    const shippingCost = freeDeliveryThreshold > 0 && subtotal >= freeDeliveryThreshold ? 0 : flatShippingCost;
    const total = subtotal + shippingCost - couponDiscount;
    const meetsMinimum = minimumOrderAmount <= 0 || subtotal >= minimumOrderAmount;

    async function applyCoupon() {
        if (!couponCode.trim() || !apiUrl) return;
        setCouponError("");
        setCouponLoading(true);
        try {
            const res = await fetch(`${apiUrl}/public/coupons/validate`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
                body: JSON.stringify({ code: couponCode.trim(), subtotal: String(subtotal), items: items.map(i => ({ productId: i.productId })) }),
            });
            const data = await res.json();
            if (data.valid) {
                setCoupon({ code: couponCode.trim().toUpperCase(), discount: parseFloat(data.discount) });
            } else {
                setCouponError(data.reason || "Invalid coupon");
                setCoupon(null);
            }
        } catch {
            setCouponError("Could not validate coupon");
        } finally {
            setCouponLoading(false);
        }
    }

    function removeCoupon() {
        setCouponCode("");
        setCoupon(null);
        setCouponError("");
    }

    if (items.length === 0) {
        return (
            <main className={`${contentMaxWidth} mx-auto py-20 px-6 text-center`}>
                <div className="text-6xl mb-6">🛒</div>
                <h1 className="text-3xl font-bold mb-4">Your cart is empty</h1>
                <p className="text-muted-foreground mb-8">Browse our products and add something you like.</p>
                <Link href={getUrl(shopPrefix)} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
                    Continue Shopping
                </Link>
            </main>
        );
    }

    return (
        <main className={`${contentMaxWidth} mx-auto py-12 px-6`}>
            <h1 className="text-3xl font-bold tracking-tight mb-8">Shopping Cart ({itemCount})</h1>

            <div className="grid lg:grid-cols-3 gap-12">
                {/* Items */}
                <div className="lg:col-span-2 space-y-4">
                    {items.map((item) => {
                        const personalizationCost = item.personalizations.reduce((s, p) => s + p.addedCost, 0);
                        const lineTotal = (item.unitPrice + personalizationCost) * item.quantity;
                        const itemKey = item.selectedVariant ? `${item.productId}__${item.selectedVariant}` : item.productId;

                        return (
                            <div key={itemKey} className="flex gap-4 p-4 border rounded-lg">
                                {/* Image */}
                                <div className="w-20 h-20 bg-muted rounded-md overflow-hidden shrink-0">
                                    {item.productImage ? (
                                        <img src={item.productImage} alt={item.productTitle} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-2xl">🛍</div>
                                    )}
                                </div>

                                {/* Details */}
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-medium text-sm truncate">{item.productTitle}</h3>
                                    {item.selectedVariant && (
                                        <p className="text-xs text-muted-foreground mt-0.5">{item.selectedVariant}</p>
                                    )}
                                    {item.personalizations.length > 0 && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {item.personalizations.map((p, i) => (
                                                <span key={i}>{p.label}: {p.value}{p.addedCost > 0 ? ` (+${p.addedCost} ${item.currency})` : ""}{i < item.personalizations.length - 1 ? " | " : ""}</span>
                                            ))}
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between mt-3">
                                        {/* Quantity Controls */}
                                        <div className="flex items-center border rounded-md">
                                            <button onClick={() => updateQuantity(item.productId, item.quantity - 1, item.selectedVariant)} className="px-2 py-1 hover:bg-muted transition-colors">
                                                <Minus className="h-3 w-3" />
                                            </button>
                                            <span className="px-3 py-1 text-sm font-medium min-w-[2rem] text-center">{item.quantity}</span>
                                            <button onClick={() => updateQuantity(item.productId, item.quantity + 1, item.selectedVariant)} className="px-2 py-1 hover:bg-muted transition-colors">
                                                <Plus className="h-3 w-3" />
                                            </button>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <span className="font-semibold text-sm">{lineTotal.toFixed(2)} {item.currency}</span>
                                            <button onClick={() => removeItem(item.productId, item.selectedVariant)} className="text-muted-foreground hover:text-red-500 transition-colors">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    <Link href={getUrl(shopPrefix)} className="inline-flex items-center text-sm text-primary hover:underline mt-4">
                        &larr; Continue Shopping
                    </Link>
                </div>

                {/* Order Summary */}
                <div className="lg:col-span-1">
                    <div className="border rounded-lg p-6 sticky top-24 space-y-4">
                        <h2 className="font-bold text-lg">Order Summary</h2>

                        {/* Coupon Input */}
                        <div>
                            {coupon ? (
                                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-md px-3 py-2 text-sm">
                                    <div className="flex items-center gap-2">
                                        <Tag className="h-3.5 w-3.5 text-green-600" />
                                        <span className="font-medium text-green-700">{coupon.code}</span>
                                        <span className="text-green-600">-{coupon.discount.toFixed(2)} {currency}</span>
                                    </div>
                                    <button onClick={removeCoupon} className="text-green-600 hover:text-red-500 text-xs underline">Remove</button>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <input
                                        value={couponCode}
                                        onChange={e => setCouponCode(e.target.value.toUpperCase())}
                                        placeholder="Coupon code"
                                        className="flex-1 border rounded-md px-3 py-2 text-sm"
                                        onKeyDown={e => e.key === "Enter" && applyCoupon()}
                                    />
                                    <button onClick={applyCoupon} disabled={couponLoading} className="px-3 py-2 border rounded-md text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
                                        {couponLoading ? "..." : "Apply"}
                                    </button>
                                </div>
                            )}
                            {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
                        </div>

                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Subtotal</span>
                                <span>{subtotal.toFixed(2)} {currency}</span>
                            </div>
                            {couponDiscount > 0 && (
                                <div className="flex justify-between text-green-600">
                                    <span>Discount</span>
                                    <span>-{couponDiscount.toFixed(2)} {currency}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Shipping</span>
                                <span>{shippingCost === 0 ? "Free" : `${shippingCost.toFixed(2)} ${currency}`}</span>
                            </div>
                            <div className="border-t pt-2 flex justify-between font-bold text-base">
                                <span>Total</span>
                                <span>{total.toFixed(2)} {currency}</span>
                            </div>
                        </div>

                        {/* Free delivery progress */}
                        {freeDeliveryThreshold > 0 && subtotal < freeDeliveryThreshold && (
                            <div className="text-sm">
                                <div className="flex justify-between text-muted-foreground mb-1">
                                    <span>Free delivery from {freeDeliveryThreshold} {currency}</span>
                                    <span>{((subtotal / freeDeliveryThreshold) * 100).toFixed(0)}%</span>
                                </div>
                                <div className="w-full bg-muted rounded-full h-2">
                                    <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${Math.min((subtotal / freeDeliveryThreshold) * 100, 100)}%` }} />
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Add {(freeDeliveryThreshold - subtotal).toFixed(2)} {currency} more for free delivery
                                </p>
                            </div>
                        )}

                        {!meetsMinimum && (
                            <p className="text-sm text-amber-600">
                                Minimum order: {minimumOrderAmount} {currency}. Add {(minimumOrderAmount - subtotal).toFixed(2)} {currency} more.
                            </p>
                        )}

                        <Link
                            href={meetsMinimum ? getUrl(checkoutPrefix) : "#"}
                            className={`block w-full text-center py-3 rounded-md font-medium transition-opacity ${meetsMinimum ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-muted text-muted-foreground cursor-not-allowed"}`}
                            onClick={(e) => !meetsMinimum && e.preventDefault()}
                        >
                            Proceed to Checkout
                        </Link>
                    </div>
                </div>
            </div>
        </main>
    );
}
