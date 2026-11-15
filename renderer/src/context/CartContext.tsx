"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { linePrice, roundToCents, type LinePriceInputs, type PriceChangedLine } from "@amodx/shared";

export interface CartItem {
    productId: string;
    productTitle: string;
    productImage: string;
    productSlug: string;
    quantity: number;
    /** The unit price at add time. Read only for an item without `priceInputs` (saved before ORDER-PRICE-1). */
    unitPrice: number;
    currency: string;
    selectedVariant?: string;
    /** `id`: the product's personalization id; absent on an item saved before ORDER-PRICE-1. */
    personalizations: { id?: string; label: string; value: string; addedCost: number }[];
    /**
     * ORDER-PRICE-1: the product's price data for the shared rule (`linePrice`); absent on an item saved before.
     * PRICE-LOCALE-1 (ruling PL1-CART-WIRING = N): `AddToCartButton` stores every text in MACHINE FORM (digits and an
     * optional decimal point), so the cart reads them without a locale.
     */
    priceInputs?: LinePriceInputs;
}

/**
 * ORDER-PRICE-1 (docs/slices/order-price-1.md § 1 item 4): the line total of a cart item at its CURRENT quantity — the
 * one browser copy of the line arithmetic (the cart subtotal, the cart page and the checkout read it). An item with
 * `priceInputs` is priced by the shared rule, the rule the order handler charges (NaN when its price data does not
 * parse — the order handler refuses that line). An item saved before ORDER-PRICE-1 keeps the arithmetic of that time
 * on its stored `unitPrice`. PRICE-LOCALE-1: the stored texts are machine form, so `linePrice` gets no locale
 * (`undefined` = machine form only); an item whose stored text still does not parse keeps the named failure (NaN).
 */
export function cartLineTotal(item: CartItem): number {
    if (item.priceInputs) {
        const priced = linePrice(item.priceInputs, item.quantity, undefined);
        return priced.kind === "priced" ? priced.lineTotal : NaN;
    }
    const personalizationCost = item.personalizations.reduce((s, p) => s + p.addedCost, 0);
    return (item.unitPrice + personalizationCost) * item.quantity;
}

interface CouponState {
    code: string;
    discount: number;
}

interface CartContextType {
    items: CartItem[];
    addItem: (item: Omit<CartItem, "quantity"> & { quantity?: number }) => void;
    removeItem: (productId: string, selectedVariant?: string) => void;
    updateQuantity: (productId: string, quantity: number, selectedVariant?: string) => void;
    clearCart: () => void;
    takeServerUnitPrices: (lines: readonly PriceChangedLine[]) => void;
    subtotal: number;
    itemCount: number;
    cartPrefix: string;
    coupon: CouponState | null;
    setCoupon: (coupon: CouponState | null) => void;
}

const CartContext = createContext<CartContextType | null>(null);

function getCartKey(tenantId: string) {
    return `amodx_cart_${tenantId}`;
}

function getItemKey(item: { productId: string; selectedVariant?: string }) {
    return item.selectedVariant ? `${item.productId}__${item.selectedVariant}` : item.productId;
}

/**
 * ORDER-CONFIRM-1: the line of a `price-changed` answer that priced this cart item — same product, same variant (an
 * absent and an empty variant are the same, as in the cart's item key) and same quantity — or `undefined`. Read by
 * `takeServerUnitPrices` and by the checkout's order summary.
 */
export function priceChangedLineOf(item: Pick<CartItem, "productId" | "selectedVariant" | "quantity">, lines: readonly PriceChangedLine[]): PriceChangedLine | undefined {
    return lines.find(l => getItemKey(l) === getItemKey(item) && l.quantity === item.quantity);
}

export function CartProvider({ children, tenantId, cartPrefix }: { children: ReactNode; tenantId: string; cartPrefix: string }) {
    const [items, setItems] = useState<CartItem[]>([]);
    const [coupon, setCouponState] = useState<CouponState | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(getCartKey(tenantId));
            if (raw) setItems(JSON.parse(raw));
            const couponRaw = localStorage.getItem(`${getCartKey(tenantId)}_coupon`);
            if (couponRaw) setCouponState(JSON.parse(couponRaw));
        } catch {}
        setLoaded(true);
    }, [tenantId]);

    useEffect(() => {
        if (!loaded) return;
        localStorage.setItem(getCartKey(tenantId), JSON.stringify(items));
    }, [items, tenantId, loaded]);

    useEffect(() => {
        if (!loaded) return;
        if (coupon) {
            localStorage.setItem(`${getCartKey(tenantId)}_coupon`, JSON.stringify(coupon));
        } else {
            localStorage.removeItem(`${getCartKey(tenantId)}_coupon`);
        }
    }, [coupon, tenantId, loaded]);

    const setCoupon = useCallback((c: CouponState | null) => setCouponState(c), []);

    const addItem = useCallback((item: Omit<CartItem, "quantity"> & { quantity?: number }) => {
        setItems(prev => {
            const key = getItemKey(item);
            const existing = prev.find(i => getItemKey(i) === key);
            if (existing) {
                return prev.map(i =>
                    getItemKey(i) === key
                        ? { ...i, quantity: i.quantity + (item.quantity || 1) }
                        : i
                );
            }
            return [...prev, { ...item, quantity: item.quantity || 1 }];
        });
    }, []);

    const removeItem = useCallback((productId: string, selectedVariant?: string) => {
        setItems(prev => prev.filter(i => getItemKey(i) !== getItemKey({ productId, selectedVariant })));
    }, []);

    const updateQuantity = useCallback((productId: string, quantity: number, selectedVariant?: string) => {
        if (quantity <= 0) {
            removeItem(productId, selectedVariant);
            return;
        }
        setItems(prev => prev.map(i =>
            getItemKey(i) === getItemKey({ productId, selectedVariant })
                ? { ...i, quantity }
                : i
        ));
    }, [removeItem]);

    /**
     * ORDER-CONFIRM-1 (docs/slices/order-confirm-1.md § 1 item 4): after a `price-changed` answer, each cart item that
     * matches an answer line (same product, variant and quantity) takes the server's unit price. `priceInputs` becomes
     * `{ price: <unit price as machine text> }` — the server's unit price already holds the added costs, so there are no
     * `addedCosts` — and `unitPrice` the same number. An item saved before ORDER-PRICE-1 (no `priceInputs`) gets
     * `priceInputs` too, so `cartLineTotal` never falls back to its old `unitPrice` (nor adds its personalization costs
     * a second time). The item's volume tiers are not kept: the answer has none (a later quantity change across a tier
     * shows the flat price; the next order then gets one more `price-changed` answer). Other items are not changed.
     */
    const takeServerUnitPrices = useCallback((lines: readonly PriceChangedLine[]) => {
        setItems(prev => prev.map(i => {
            const line = priceChangedLineOf(i, lines);
            if (!line) return i;
            return { ...i, unitPrice: line.unitPrice, priceInputs: { price: line.unitPrice.toFixed(2) } };
        }));
    }, []);

    const clearCart = useCallback(() => {
        setItems([]);
        setCouponState(null);
    }, []);

    const subtotal = roundToCents(items.reduce((sum, item) => sum + cartLineTotal(item), 0));

    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return (
        <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, takeServerUnitPrices, subtotal, itemCount, cartPrefix, coupon, setCoupon }}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error("useCart must be used within CartProvider");
    return ctx;
}
