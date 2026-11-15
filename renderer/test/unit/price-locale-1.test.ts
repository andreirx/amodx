// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveLocaleStrings } from "@amodx/shared";

/**
 * PRICE-LOCALE-1 (docs/slices/price-locale-1.md § 1; ruling PL1-CART-WIRING = N) — the browser side. The product page's
 * button reads the price texts with the tenant locale (prop `priceLocale` from `SitePage`) and stores the cart item's
 * price inputs in MACHINE FORM; the cart, the cart page and the checkout read them without a locale. Same harness as
 * `order-price-1.test.ts`. Real: `CartProvider` (jsdom localStorage; it takes no locale), `AddToCartButton`,
 * `CartPageView`, `CheckoutPageView`, the shared parser. Mocked: the tenant URL hook, Next's router and link, NextAuth,
 * reCAPTCHA, the FB pixel — none of them reads a price.
 */

vi.mock("@/lib/routing", () => ({ useTenantUrl: () => ({ getUrl: (p: string) => p }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/lib/fbpixel", () => ({ trackFBEvent: () => {} }));
vi.mock("@/hooks/useRecaptcha", () => ({ useRecaptcha: () => ({ execute: async () => null }) }));
vi.mock("next/link", async () => {
    const { createElement: h } = await import("react");
    return { default: ({ href, children, ...rest }: any) => h("a", { href: typeof href === "string" ? href : "#", ...rest }, children) };
});

import { CartProvider, useCart, cartLineTotal } from "@/context/CartContext";
import { AddToCartButton } from "@/components/AddToCartButton";
import { CartPageView } from "@/components/CartPageView";
import { CheckoutPageView } from "@/components/CheckoutPageView";

const RO = resolveLocaleStrings({ locale: "ro-RO" }).strings;
const BUTTON_STRINGS = { ...RO.commerce, formSelectPlaceholder: RO.site.formSelectPlaceholder };
const CHECKOUT_STRINGS = { ...RO.commerce, errorTryAgain: RO.site.errorTryAgain };
const CART_KEY = "amodx_cart_t1";
const RO_TIER = [{ minQuantity: 5, price: "10,00" }];

let root: Root | null = null;
let host: HTMLDivElement;
let cart: ReturnType<typeof useCart>;
function Probe() { cart = useCart(); return null; }

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

/** Mounts the real provider exactly as `Providers.tsx` does (no locale), with `children` inside it. */
function mount(children?: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
        root = createRoot(host);
        root.render(createElement(CartProvider, { tenantId: "t1", cartPrefix: "/cart", children: createElement(Fragment, null, createElement(Probe), children) }));
    });
}
/** Replaces the provider's children (the cart state stays in localStorage). */
function show(children: ReactNode) {
    act(() => root!.render(createElement(CartProvider, { tenantId: "t1", cartPrefix: "/cart", children: createElement(Fragment, null, createElement(Probe), children) })));
}

const buttonProps = (extra: Record<string, unknown> = {}) => ({
    productId: "c0000000-0000-4000-8000-000000000001", title: "Covor", slug: "covor", imageLink: "", price: "12,50", currency: "RON",
    availability: "in_stock", variants: [], personalizations: [], volumePricing: RO_TIER, strings: BUTTON_STRINGS, ...extra,
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
const cartView = () => createElement(CartPageView, {
    checkoutPrefix: "/checkout", shopPrefix: "/shop", freeDeliveryThreshold: 0, flatShippingCost: 0, minimumOrderAmount: 0,
    currency: "RON", tenantId: "t1", apiUrl: "", strings: RO.commerce,
});
const checkoutView = () => createElement(CheckoutPageView, {
    tenantId: "t1", apiUrl: "", confirmPrefix: "/checkout/confirm", cartPrefix: "/cart", freeDeliveryThreshold: 0,
    flatShippingCost: 0, currency: "RON", strings: CHECKOUT_STRINGS,
});

describe("product page and cart, tenant ro-RO, product 12,50, tier 10,00 at 5", () => {
    it("the button: 12.50 at 1; 50.00 at 5; the cart item holds machine form and its line and subtotal are 50", () => {
        mount(createElement(AddToCartButton, buttonProps({ priceLocale: "ro-RO" })));
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — 12.50 RON`);
        for (let i = 0; i < 4; i++) plus();
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — 50.00 RON`);
        act(() => addButton().click());
        expect(cart.items[0]).toMatchObject({ quantity: 5, unitPrice: 10 });
        expect(cart.items[0].priceInputs).toEqual({ price: "12.50", volumePricing: [{ minQuantity: 5, price: "10.00" }], addedCosts: [] });
        expect(JSON.parse(localStorage.getItem(CART_KEY)!)[0].priceInputs.price).toBe("12.50"); // no comma text stored
        expect(cartLineTotal(cart.items[0])).toBe(50);
        expect(cart.subtotal).toBe(50);
        act(() => cart.updateQuantity(cart.items[0].productId, 1));
        expect(cart.subtotal).toBe(12.5);
    });

    it("the cart page and the checkout (no locale anywhere in the cart): 50.00 RON at 5; the request's totalPrice is \"50\"", async () => {
        mount(createElement(AddToCartButton, buttonProps({ priceLocale: "ro-RO" })));
        for (let i = 0; i < 4; i++) plus();
        act(() => addButton().click());
        show(cartView());
        expect(host.textContent).toContain("50.00 RON");
        expect(host.textContent).not.toContain("NaN");
        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ orderId: "o1", orderNumber: "PPB-0001" }) }));
        vi.stubGlobal("fetch", fetchMock);
        show(checkoutView());
        expect(host.textContent).toContain("50.00 RON");
        expect(host.textContent).not.toContain("NaN");
        await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).items[0].totalPrice).toBe("50");
    });

    it("the stored price text is still shown as stored ((25,00 RON), (+5,5 RON)); the cart item holds 25.00 and 5.5", () => {
        const variants = [{ id: "g1", name: "Mărime", options: [{ value: "M" }, { value: "L", priceOverride: "25,00" }] }];
        const personalizations = [{ id: "engr", label: "Gravură", type: "text", required: false, addedCost: "5,5" }];
        mount(createElement(AddToCartButton, buttonProps({ priceLocale: "ro-RO", variants, personalizations })));
        expect(host.textContent).toContain("(25,00 RON)");
        expect(host.textContent).toContain("(+5,5 RON)");
        act(() => [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("L"))!.click());
        typeInto(host.querySelector("input")!, "AB");
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — 30.50 RON`); // 25 + 5.5
        act(() => addButton().click());
        expect(cart.items[0].personalizations).toEqual([{ id: "engr", label: "Gravură", value: "AB", addedCost: 5.5 }]);
        expect(cart.items[0].priceInputs).toEqual({ priceOverride: "25.00", addedCosts: ["5.5"] });
        expect(cart.subtotal).toBe(30.5);
    });
});

describe("a price text that does not parse at add time: the item is not added", () => {
    it("decimal-point tenant, product 12,50: the button shows NaN, as before this slice; a click adds nothing", () => {
        mount(createElement(AddToCartButton, buttonProps({ volumePricing: [] })));
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — NaN RON`);
        act(() => addButton().click());
        expect(cart.items).toEqual([]);
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — NaN RON`); // no "added" state
    });

    it("ro-RO, a tier text that does not parse (10,00,1), quantity 1: the shown total is 12.50, but the item is not added", () => {
        mount(createElement(AddToCartButton, buttonProps({ priceLocale: "ro-RO", volumePricing: [{ minQuantity: 5, price: "10,00,1" }] })));
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — 12.50 RON`);
        act(() => addButton().click());
        expect(cart.items).toEqual([]);
    });
});

describe("a decimal-point tenant with point prices: the same shown output, numbers and order request", () => {
    it("a product without salePrice or override: the kept texts are the texts as written (100.00, 75.00, 5)", () => {
        const personalizations = [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5" }];
        mount(createElement(AddToCartButton, buttonProps({ price: "100.00", volumePricing: [{ minQuantity: 5, price: "75.00" }], personalizations })));
        typeInto(host.querySelector("input")!, "AB");
        act(() => addButton().click());
        expect(cart.items[0].priceInputs).toEqual({ price: "100.00", volumePricing: [{ minQuantity: 5, price: "75.00" }], addedCosts: ["5"] });
        expect(cart.subtotal).toBe(105);
    });

    it("salePrice and a chosen priceOverride: the stored inputs keep only the texts the rule reads; the button, the cart line at every quantity and the order request equal the raw rule", async () => {
        const { linePrice } = await import("@amodx/shared");
        const tiers = [{ minQuantity: 5, price: "75.00" }];
        const variants = [{ id: "g1", name: "Size", options: [{ value: "S" }, { value: "L", priceOverride: "120.00" }] }];
        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ orderId: "o1", orderNumber: "PPB-0001" }) }));
        vi.stubGlobal("fetch", fetchMock);
        for (const [option, raw, stored] of [
            ["S", { price: "100.00", salePrice: "80.00", volumePricing: tiers, addedCosts: [] }, { salePrice: "80.00", volumePricing: tiers, addedCosts: [] }],
            ["L", { price: "100.00", salePrice: "80.00", volumePricing: tiers, priceOverride: "120.00", addedCosts: [] }, { priceOverride: "120.00", addedCosts: [] }],
        ] as const) {
            localStorage.clear();
            mount(createElement(AddToCartButton, buttonProps({ price: "100.00", salePrice: "80.00", currency: "USD", volumePricing: tiers, variants })));
            act(() => [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(option))!.click());
            expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — ${(linePrice(raw, 1, undefined) as any).lineTotal.toFixed(2)} USD`);
            act(() => addButton().click());
            expect(cart.items[0].priceInputs).toEqual(stored);
            for (const q of [1, 4, 5, 9]) {
                act(() => cart.updateQuantity(cart.items[0].productId, q, cart.items[0].selectedVariant));
                expect(cartLineTotal(cart.items[0])).toBe((linePrice(raw, q, undefined) as any).lineTotal);
            }
            show(checkoutView());
            fetchMock.mockClear();
            await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
            const sent = JSON.parse((fetchMock.mock.calls[0] as any)[1].body).items[0];
            expect(sent.totalPrice).toBe(String((linePrice(raw, 9, undefined) as any).lineTotal));
            act(() => root?.unmount()); root = null; document.body.innerHTML = "";
        }
    });

    it("a malformed tier the quantity does not select (10,00 at 5), quantity 1: the button shows 12.50, but a click adds nothing (before: added and orderable at 1)", () => {
        mount(createElement(AddToCartButton, buttonProps({ price: "12.50", currency: "USD", volumePricing: [{ minQuantity: 5, price: "10,00" }] })));
        expect(addButton().textContent).toBe(`${BUTTON_STRINGS.addToCart} — 12.50 USD`);
        act(() => addButton().click());
        expect(cart.items).toEqual([]);
    });

    it("an added cost 5,5 on a point tenant: no (+…) label (before: parseFloat read 5 and showed it)", () => {
        const personalizations = [{ id: "engr", label: "Engraving", type: "text", required: false, addedCost: "5,5" }];
        mount(createElement(AddToCartButton, buttonProps({ price: "12.50", volumePricing: [], personalizations })));
        expect(host.textContent).not.toContain("(+5,5");
    });

    it("an item saved by order-price-1 with a raw comma text keeps linePrice's named failure in the cart (NaN); no migration", () => {
        localStorage.setItem(CART_KEY, JSON.stringify([{
            productId: "p1", productTitle: "Covor", productImage: "", productSlug: "covor", quantity: 1, unitPrice: NaN, currency: "RON",
            personalizations: [], priceInputs: { price: "12,50", volumePricing: [], addedCosts: [] },
        }]));
        mount();
        expect(Number.isNaN(cartLineTotal(cart.items[0]))).toBe(true);
    });
});
