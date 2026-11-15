// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OrderItemInputSchema, resolveLocaleStrings } from "@amodx/shared";

/**
 * ORDER-PRICE-1 (docs/slices/order-price-1.md § 1 item 4) — the browser side: the product page's button, the cart and
 * the checkout price each line with the shared rule at the line's CURRENT quantity; a cart saved before keeps the old
 * arithmetic and still produces an order item the server's schema accepts. Real: `CartProvider` (with jsdom's
 * localStorage), `AddToCartButton`, `CheckoutPageView`. Mocked: the tenant URL hook, Next's router, NextAuth,
 * reCAPTCHA, the FB pixel and `fetch` — none of them computes a price.
 */

vi.mock("@/lib/routing", () => ({ useTenantUrl: () => ({ getUrl: (p: string) => p }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/lib/fbpixel", () => ({ trackFBEvent: () => {} }));
vi.mock("@/hooks/useRecaptcha", () => ({ useRecaptcha: () => ({ execute: async () => null }) }));

import { CartProvider, useCart, cartLineTotal, type CartItem } from "@/context/CartContext";
import { AddToCartButton } from "@/components/AddToCartButton";
import { CheckoutPageView } from "@/components/CheckoutPageView";

const EN = resolveLocaleStrings({}).strings;
const BUTTON_STRINGS = { ...EN.commerce, formSelectPlaceholder: EN.site.formSelectPlaceholder };
const CHECKOUT_STRINGS = { ...EN.commerce, errorTryAgain: EN.site.errorTryAgain };
const CART_KEY = "amodx_cart_t1";
const TIERS = [{ minQuantity: 5, price: "9.00" }, { minQuantity: 10, price: "8.00" }];

let root: Root | null = null;
let host: HTMLDivElement;
let cart: ReturnType<typeof useCart>;
function Probe() { cart = useCart(); return null; }

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

function mount(children?: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
        root = createRoot(host);
        root.render(createElement(CartProvider, { tenantId: "t1", cartPrefix: "/cart", children: createElement(Fragment, null, createElement(Probe), children) }));
    });
}

/** A cart item as AddToCartButton writes it from now on (priceInputs present). */
const newItem = (extra: Partial<CartItem> = {}): CartItem => ({
    productId: "p1", productTitle: "Rug", productImage: "", productSlug: "rug", quantity: 1, unitPrice: 10, currency: "USD",
    personalizations: [], priceInputs: { price: "10.00", volumePricing: TIERS, addedCosts: [] }, ...extra,
});
/** A cart item exactly as AddToCartButton wrote it BEFORE this slice: no priceInputs, no personalization id. */
const OLD_ITEM = {
    productId: "c0000000-0000-4000-8000-000000000002", productTitle: "Variant Rug", productImage: "", productSlug: "variant-rug",
    quantity: 2, unitPrice: 12.5, currency: "USD", selectedVariant: "Size: M",
    personalizations: [{ label: "Engraving", value: "AB", addedCost: 5 }],
};

describe("cart — the line follows the quantity", () => {
    it("cartLineTotal: an item with price inputs is priced at its current quantity (tiers)", () => {
        expect([1, 5, 9, 10, 50].map((quantity) => cartLineTotal(newItem({ quantity })))).toEqual([10, 45, 81, 80, 400]);
    });

    it("item with price inputs, quantity raised across a tier → the line and the subtotal follow the tier", () => {
        mount();
        act(() => cart.addItem(newItem()));
        expect(cart.subtotal).toBe(10);
        act(() => cart.updateQuantity("p1", 10));
        expect(cart.items[0].quantity).toBe(10);
        expect(cartLineTotal(cart.items[0])).toBe(80);
        expect(cart.subtotal).toBe(80);
        act(() => cart.updateQuantity("p1", 1));
        expect(cart.subtotal).toBe(10); // lowering it leaves the tier
    });

    it("the same product added twice (merged quantity crosses a tier) → the tier price", () => {
        mount();
        act(() => cart.addItem({ ...newItem(), quantity: 6 }));
        act(() => cart.addItem({ ...newItem(), quantity: 4 }));
        expect(cart.items).toHaveLength(1);
        expect(cart.items[0].quantity).toBe(10);
        expect(cart.subtotal).toBe(80);
    });

    it("item saved before this change (no price inputs, no personalization id) → today's arithmetic", () => {
        localStorage.setItem(CART_KEY, JSON.stringify([OLD_ITEM]));
        mount();
        expect(cart.items).toHaveLength(1);
        expect(cartLineTotal(cart.items[0])).toBe(35); // (12.5 + 5) × 2
        expect(cart.subtotal).toBe(35);
        act(() => cart.updateQuantity(OLD_ITEM.productId, 3, OLD_ITEM.selectedVariant));
        expect(cart.subtotal).toBe(52.5);
    });

    it("subtotal is rounded to cents (the server's subtotal rule)", () => {
        mount();
        act(() => cart.addItem(newItem({ productId: "a", priceInputs: { price: "0.10" } })));
        act(() => cart.addItem(newItem({ productId: "b", priceInputs: { price: "0.20" } })));
        expect(cart.subtotal).toBe(0.3);
    });
});

describe("AddToCartButton — the shown total and the stored cart item", () => {
    const props = (extra: Record<string, unknown> = {}) => ({
        productId: "p1", title: "Rug", slug: "rug", imageLink: "", price: "10.00", currency: "USD", availability: "in_stock",
        variants: [], personalizations: [], volumePricing: [], strings: BUTTON_STRINGS, ...extra,
    });
    const addButton = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(BUTTON_STRINGS.addToCart))!;
    const plus = () => {
        const box = [...host.querySelectorAll("div")].find((d) => d.className === "flex items-center border rounded-md")!;
        act(() => box.querySelectorAll("button")[1].click());
    };
    const typeInto = (el: HTMLInputElement, value: string) => act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    it("(a) 10 units of a product with a tier at 10 → the button shows the tier total; the cart keeps the price inputs", () => {
        mount(createElement(AddToCartButton, props({ volumePricing: TIERS })));
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — 10.00 USD`);
        for (let i = 0; i < 9; i++) plus();
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — 80.00 USD`);
        act(() => addButton().click());
        expect(cart.items[0]).toMatchObject({ quantity: 10, unitPrice: 8, priceInputs: { price: "10.00", volumePricing: TIERS, addedCosts: [] } });
        expect(cart.subtotal).toBe(80);
        expect(JSON.parse(localStorage.getItem(CART_KEY)!)[0].priceInputs.volumePricing).toEqual(TIERS);
    });

    it("(b) a variant with its own price (tiers present) → the override; the cart line keeps it at any quantity", () => {
        const variants = [{ id: "g1", name: "Size", options: [{ value: "S" }, { value: "L", priceOverride: "20.00" }] }];
        mount(createElement(AddToCartButton, props({ variants, volumePricing: TIERS })));
        act(() => [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("L"))!.click());
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — 20.00 USD`);
        act(() => addButton().click());
        expect(cart.items[0]).toMatchObject({ selectedVariant: "Size: L", priceInputs: { priceOverride: "20.00" } });
        act(() => cart.updateQuantity("p1", 10, "Size: L"));
        expect(cart.subtotal).toBe(200);
    });

    it("(c) an added cost of 5 → unit + cost; the cart personalization carries its id", () => {
        const personalizations = [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5" }];
        mount(createElement(AddToCartButton, props({ price: "12.50", personalizations })));
        typeInto(host.querySelector("input")!, "AB");
        plus();
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — 35.00 USD`);
        act(() => addButton().click());
        expect(cart.items[0].personalizations).toEqual([{ id: "engr", label: "Engraving", value: "AB", addedCost: 5 }]);
        expect(cart.items[0].priceInputs?.addedCosts).toEqual(["5"]);
        expect(cart.subtotal).toBe(35);
    });
});

describe("checkout — one line function; the request the server accepts", () => {
    const mountCheckout = () => mount(createElement(CheckoutPageView, {
        tenantId: "t1", apiUrl: "", confirmPrefix: "/checkout/confirm", cartPrefix: "/cart", freeDeliveryThreshold: 0,
        flatShippingCost: 0, currency: "USD", strings: CHECKOUT_STRINGS,
    }));
    const submit = async () => {
        await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    };
    const NEW_WITH_PERS = newItem({
        productId: "c0000000-0000-4000-8000-000000000001", quantity: 10, personalizations: [{ id: "engr", label: "Engraving", value: "AB", addedCost: 5 }],
        priceInputs: { price: "10.00", volumePricing: TIERS, addedCosts: ["5"] },
    });

    it("summary lines and subtotal use the shared rule; an old item keeps its arithmetic; the server schema accepts both items", async () => {
        localStorage.setItem(CART_KEY, JSON.stringify([NEW_WITH_PERS, OLD_ITEM]));
        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: "o1", orderNumber: "PPB-0001" }) }));
        vi.stubGlobal("fetch", fetchMock);
        mountCheckout();
        const text = host.textContent!;
        expect(text).toContain("130.00 USD"); // (8 + 5) × 10
        expect(text).toContain("35.00 USD");  // the old item
        expect(text).toContain("165.00 USD"); // subtotal
        await submit();
        const sent = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
        expect(sent.items[0].personalizations).toEqual([{ id: "engr", label: "Engraving", value: "AB", addedCost: "5" }]);
        expect(sent.items[0].totalPrice).toBe("130");
        expect(sent.items[1].personalizations).toEqual([{ label: "Engraving", value: "AB", addedCost: "5" }]);
        expect(sent.items[1].totalPrice).toBe("35");
        for (const item of sent.items) expect(OrderItemInputSchema.safeParse(item).error).toBeUndefined();
    });

    it("a server refusal (400 with an `error` text) is shown through the existing error path", async () => {
        localStorage.setItem(CART_KEY, JSON.stringify([OLD_ITEM]));
        const error = `Variant selection not recognised for product: ${OLD_ITEM.productId}`;
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error }) })));
        mountCheckout();
        await submit();
        expect(host.textContent).toContain(error);
    });
});
