"use client";

import { useCart } from "@/context/CartContext";
import { useTenantUrl } from "@/lib/routing";
import { useRouter } from "next/navigation";
import { useState, FormEvent } from "react";

const ROMANIAN_COUNTIES = [
    "Alba", "Arad", "Arges", "Bacau", "Bihor", "Bistrita-Nasaud", "Botosani",
    "Brasov", "Braila", "Bucuresti", "Buzau", "Caras-Severin", "Calarasi",
    "Cluj", "Constanta", "Covasna", "Dambovita", "Dolj", "Galati", "Giurgiu",
    "Gorj", "Harghita", "Hunedoara", "Ialomita", "Iasi", "Ilfov", "Maramures",
    "Mehedinti", "Mures", "Neamt", "Olt", "Prahova", "Satu Mare", "Salaj",
    "Sibiu", "Suceava", "Teleorman", "Timis", "Tulcea", "Vaslui", "Valcea", "Vrancea"
];

interface CheckoutProps {
    tenantId: string;
    apiUrl: string;
    confirmPrefix: string;
    cartPrefix: string;
    freeDeliveryThreshold: number;
    flatShippingCost: number;
    currency: string;
    bankTransfer?: { bankName?: string; accountHolder?: string; iban?: string; swift?: string; referencePrefix?: string };
}

export function CheckoutPageView({ tenantId, apiUrl, confirmPrefix, cartPrefix, freeDeliveryThreshold, flatShippingCost, currency, bankTransfer }: CheckoutProps) {
    const { items, subtotal, clearCart } = useCart();
    const { getUrl } = useTenantUrl();
    const router = useRouter();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [form, setForm] = useState({
        customerName: "",
        customerEmail: "",
        customerPhone: "",
        street: "",
        city: "",
        county: "",
        postalCode: "",
        notes: "",
        paymentMethod: "cash_on_delivery" as "cash_on_delivery" | "bank_transfer",
    });

    const shippingCost = freeDeliveryThreshold > 0 && subtotal >= freeDeliveryThreshold ? 0 : flatShippingCost;
    const total = subtotal + shippingCost;

    const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

    if (items.length === 0) {
        return (
            <main className="max-w-4xl mx-auto py-20 px-6 text-center">
                <h1 className="text-3xl font-bold mb-4">Your cart is empty</h1>
                <p className="text-muted-foreground mb-8">Add some products before checking out.</p>
            </main>
        );
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const orderItems = items.map(item => ({
                productId: item.productId,
                productTitle: item.productTitle,
                productImage: item.productImage,
                productSlug: item.productSlug,
                quantity: item.quantity,
                unitPrice: String(item.unitPrice),
                totalPrice: String((item.unitPrice + item.personalizations.reduce((s, p) => s + p.addedCost, 0)) * item.quantity),
                personalizations: item.personalizations.map(p => ({
                    label: p.label,
                    value: p.value,
                    addedCost: String(p.addedCost),
                })),
                selectedVariant: item.selectedVariant,
            }));

            const body = {
                customerName: form.customerName,
                customerEmail: form.customerEmail,
                customerPhone: form.customerPhone,
                shippingAddress: {
                    street: form.street,
                    city: form.city,
                    county: form.county,
                    postalCode: form.postalCode,
                    country: "Romania",
                    notes: form.notes,
                },
                items: orderItems,
                paymentMethod: form.paymentMethod,
                currency,
            };

            const res = await fetch(`${apiUrl}/public/orders`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-tenant-id": tenantId,
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: "Order failed" }));
                throw new Error(data.error || `Order failed (${res.status})`);
            }

            const order = await res.json();

            // Store order data in sessionStorage for the confirmation page
            sessionStorage.setItem("amodx_last_order", JSON.stringify(order));

            clearCart();
            router.push(getUrl(`${confirmPrefix}?id=${order.id}&email=${encodeURIComponent(form.customerEmail)}`));
        } catch (err: any) {
            setError(err.message || "Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="max-w-6xl mx-auto py-12 px-6">
            <h1 className="text-3xl font-bold tracking-tight mb-8">Checkout</h1>

            <form onSubmit={handleSubmit}>
                <div className="grid lg:grid-cols-3 gap-12">
                    {/* Form */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Contact */}
                        <section>
                            <h2 className="text-lg font-bold mb-4">Contact Information</h2>
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">Full Name *</label>
                                    <input required value={form.customerName} onChange={e => update("customerName", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Email *</label>
                                    <input required type="email" value={form.customerEmail} onChange={e => update("customerEmail", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium mb-1">Phone</label>
                                    <input value={form.customerPhone} onChange={e => update("customerPhone", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" placeholder="+40..." />
                                </div>
                            </div>
                        </section>

                        {/* Shipping Address */}
                        <section>
                            <h2 className="text-lg font-bold mb-4">Shipping Address</h2>
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium mb-1">Street Address *</label>
                                    <input required value={form.street} onChange={e => update("street", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">City *</label>
                                    <input required value={form.city} onChange={e => update("city", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">County *</label>
                                    <select required value={form.county} onChange={e => update("county", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
                                        <option value="">Select county...</option>
                                        {ROMANIAN_COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Postal Code</label>
                                    <input value={form.postalCode} onChange={e => update("postalCode", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Delivery Notes</label>
                                    <input value={form.notes} onChange={e => update("notes", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" placeholder="Apartment, floor, etc." />
                                </div>
                            </div>
                        </section>

                        {/* Payment Method */}
                        <section>
                            <h2 className="text-lg font-bold mb-4">Payment Method</h2>
                            <div className="space-y-3">
                                <label className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${form.paymentMethod === "cash_on_delivery" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
                                    <input type="radio" name="paymentMethod" value="cash_on_delivery" checked={form.paymentMethod === "cash_on_delivery"} onChange={e => update("paymentMethod", e.target.value)} className="accent-primary" />
                                    <div>
                                        <p className="font-medium text-sm">Cash on Delivery</p>
                                        <p className="text-xs text-muted-foreground">Pay when you receive your order</p>
                                    </div>
                                </label>
                                {bankTransfer && (
                                    <label className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${form.paymentMethod === "bank_transfer" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
                                        <input type="radio" name="paymentMethod" value="bank_transfer" checked={form.paymentMethod === "bank_transfer"} onChange={e => update("paymentMethod", e.target.value)} className="accent-primary" />
                                        <div>
                                            <p className="font-medium text-sm">Bank Transfer</p>
                                            <p className="text-xs text-muted-foreground">Transfer to {bankTransfer.bankName} - {bankTransfer.iban}</p>
                                        </div>
                                    </label>
                                )}
                            </div>
                        </section>
                    </div>

                    {/* Order Summary */}
                    <div className="lg:col-span-1">
                        <div className="border rounded-lg p-6 sticky top-24 space-y-4">
                            <h2 className="font-bold text-lg">Order Summary</h2>

                            <div className="space-y-3 max-h-64 overflow-y-auto">
                                {items.map((item) => {
                                    const personalizationCost = item.personalizations.reduce((s, p) => s + p.addedCost, 0);
                                    const lineTotal = (item.unitPrice + personalizationCost) * item.quantity;
                                    return (
                                        <div key={item.selectedVariant ? `${item.productId}__${item.selectedVariant}` : item.productId} className="flex gap-3 text-sm">
                                            <div className="w-12 h-12 bg-muted rounded overflow-hidden shrink-0">
                                                {item.productImage && <img src={item.productImage} alt="" className="w-full h-full object-cover" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="truncate font-medium">{item.productTitle}</p>
                                                <p className="text-muted-foreground">x{item.quantity}</p>
                                            </div>
                                            <span className="font-medium whitespace-nowrap">{lineTotal.toFixed(2)} {item.currency}</span>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="border-t pt-3 space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Subtotal</span>
                                    <span>{subtotal.toFixed(2)} {currency}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Shipping</span>
                                    <span>{shippingCost === 0 ? "Free" : `${shippingCost.toFixed(2)} ${currency}`}</span>
                                </div>
                                <div className="border-t pt-2 flex justify-between font-bold text-base">
                                    <span>Total</span>
                                    <span>{total.toFixed(2)} {currency}</span>
                                </div>
                            </div>

                            {error && (
                                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-3">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="block w-full text-center py-3 rounded-md font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                            >
                                {loading ? "Placing Order..." : "Place Order"}
                            </button>

                            <p className="text-xs text-muted-foreground text-center">
                                By placing your order, you agree to our terms and conditions.
                            </p>
                        </div>
                    </div>
                </div>
            </form>
        </main>
    );
}
