// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveLocaleStrings, type PriceChangedAnswer } from "@amodx/shared";

/**
 * ORDER-CONFIRM-1 (docs/slices/order-confirm-1.md § 1 items 1, 4) — the browser side of "an order is created only with
 * a total the visitor saw". Same style as `order-checkout-1.test.ts`. Real: `CartProvider` (jsdom localStorage),
 * `cartLineTotal`, `CheckoutPageView`, the shared types. Mocked: the tenant URL hook, Next's router (a spy on `push`),
 * NextAuth, reCAPTCHA, the FB pixel and `fetch` (the order answers). Each `it` names the taxonomy row it binds.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/lib/routing", () => ({ useTenantUrl: () => ({ getUrl: (p: string) => p }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/lib/fbpixel", () => ({ trackFBEvent: () => {} }));
vi.mock("@/hooks/useRecaptcha", () => ({ useRecaptcha: () => ({ execute: async () => null }) }));

import { CartProvider, cartLineTotal, useCart, type CartItem } from "@/context/CartContext";
import { CheckoutPageView } from "@/components/CheckoutPageView";

const EN = resolveLocaleStrings({}).strings;
/** The text the order handler puts in `message` for a ro-RO tenant without an override (the ro pack's pricesChanged). */
const RO_MESSAGE = resolveLocaleStrings({ locale: "ro-RO" }).strings.commerce.pricesChanged;
const CHECKOUT_STRINGS = { ...EN.commerce, errorTryAgain: EN.site.errorTryAgain };
const CART_KEY = "amodx_cart_t1";
const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";
/** Cart: 2 × 10.00 (priceInputs) + 1 × "Size: L" 4.00; shipping 5; coupon −2 → the checkout shows 27.00. */
const ITEM_1: CartItem = { productId: P1, productTitle: "Rug", productImage: "", productSlug: "rug", quantity: 2, unitPrice: 10, currency: "USD", personalizations: [], priceInputs: { price: "10.00" } };
const ITEM_2: CartItem = { productId: P2, productTitle: "Mat", productImage: "", productSlug: "mat", quantity: 1, unitPrice: 4, currency: "USD", selectedVariant: "Size: L", personalizations: [], priceInputs: { price: "4.00" } };
/** The server's figures: P1 now 12.00, P2 now 6.00, shipping 7, discount 1.50 → 39.50. */
const ANSWER: PriceChangedAnswer = {
    code: "price-changed", error: "Prices have changed. Check the new total, then place the order again.", message: RO_MESSAGE,
    total: 39.5, subtotal: 30, shippingCost: 7, couponDiscount: 1.5,
    items: [{ productId: P1, quantity: 2, unitPrice: 12, totalPrice: 24 }, { productId: P2, selectedVariant: "Size: L", quantity: 1, unitPrice: 6, totalPrice: 6 }],
};

let root: Root | null = null;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
/** The cart actions, read by a probe mounted inside the same provider (the checkout has no quantity control). */
let cart: ReturnType<typeof useCart>;
function CartProbe() { cart = useCart(); return null; }

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(CART_KEY, JSON.stringify([ITEM_1, ITEM_2]));
    localStorage.setItem(`${CART_KEY}_coupon`, JSON.stringify({ code: "TEN", discount: 2 }));
    push.mockReset();
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

/** `fetch` answers each order request with the next answer of the list (status, JSON). */
function answers(...list: [number, unknown][]) {
    fetchMock = vi.fn();
    for (const [status, json] of list) fetchMock.mockImplementationOnce(async () => ({ ok: status < 300, status, json: async () => json }));
    vi.stubGlobal("fetch", fetchMock);
}

function mountCheckout() {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
        root = createRoot(host);
        root.render(createElement(CartProvider, {
            tenantId: "t1", cartPrefix: "/cart",
            children: [
                createElement(CartProbe, { key: "probe" }),
                createElement(CheckoutPageView, {
                    key: "checkout", tenantId: "t1", apiUrl: "", confirmPrefix: "/checkout/confirmation", cartPrefix: "/cart",
                    freeDeliveryThreshold: 0, flatShippingCost: 5, currency: "USD", strings: CHECKOUT_STRINGS,
                }),
            ],
        }));
    });
    const email = host.querySelector('input[type="email"]') as HTMLInputElement;
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "buyer@example.com");
        email.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
const submit = async () => {
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
};
const sent = (n: number) => JSON.parse((fetchMock.mock.calls[n] as any)[1].body);
/** The order summary's figures, as the visitor reads them (line totals, subtotal, discount, shipping, total). */
function summary() {
    const box = [...host.querySelectorAll("h2")].find((h) => h.textContent === CHECKOUT_STRINGS.orderSummary)!.parentElement!;
    const lines = [...box.querySelectorAll(".space-y-3 > div > span")].map((s) => s.textContent);
    const rows = [...box.querySelectorAll(".border-t > div")].map((d) => [...d.querySelectorAll("span")].map((s) => s.textContent).join(" = "));
    return { lines, rows };
}
const storedCart = (): CartItem[] => JSON.parse(localStorage.getItem(CART_KEY)!);
const statusText = () => host.querySelector('[role="status"]')?.textContent ?? null;

describe("ORDER-CONFIRM-1 — the checkout states the total it shows", () => {
    it("first press: the request carries the shown total (27.00) as expectedTotal, a number", async () => {
        answers([201, { orderId: "o-1", orderNumber: "PPB-0001", couponDiscount: 2 }]);
        mountCheckout();
        expect(summary().rows).toContain("Total = 27.00 USD");
        await submit();
        expect(sent(0).expectedTotal).toBe(27);
        expect(push).toHaveBeenCalledTimes(1);
    });
});

describe("ORDER-CONFIRM-1 — checkout: 409 price-changed", () => {
    it("the server's line totals, subtotal, shipping, discount and total are shown; the answer's message (the tenant's pricesChanged text) is shown; no navigation; the cart is not cleared", async () => {
        answers([409, ANSWER]);
        mountCheckout();
        await submit();
        expect(push).not.toHaveBeenCalled();
        expect(summary()).toEqual({
            lines: ["24.00 USD", "6.00 USD"],
            rows: ["Subtotal = 30.00 USD", "Discount (TEN) = -1.50 USD", "Shipping = 7.00 USD", "Total = 39.50 USD"],
        });
        expect(RO_MESSAGE).toBe("Prețurile s-au schimbat. Verifică noul total, apoi plasează din nou comanda.");
        expect(statusText()).toBe(RO_MESSAGE);
        expect(host.textContent).not.toContain(EN.commerce.orderFailed);
        expect(storedCart().map((i) => i.productId)).toEqual([P1, P2]);
        expect(JSON.parse(localStorage.getItem(`${CART_KEY}_coupon`)!)).toEqual({ code: "TEN", discount: 2 });
    });

    it("the cart items take the server's unit prices: the cart page's line function (cartLineTotal) gives the server's line totals", async () => {
        answers([409, ANSWER]);
        mountCheckout();
        await submit();
        const items = storedCart();
        expect(items.map((i) => [i.unitPrice, i.priceInputs])).toEqual([[12, { price: "12.00" }], [6, { price: "6.00" }]]);
        expect(items.map(cartLineTotal)).toEqual([24, 6]);
        expect(cart.subtotal).toBe(30);
    });

    it("second press after the 409: the request carries the server's total (39.5) as expectedTotal; then the order is placed", async () => {
        answers([409, ANSWER], [201, { orderId: "o-2", orderNumber: "PPB-0002", couponDiscount: 1.5 }]);
        mountCheckout();
        await submit();
        await submit();
        expect(sent(0).expectedTotal).toBe(27);
        expect(sent(1).expectedTotal).toBe(39.5);
        expect(push).toHaveBeenCalledWith(`/checkout/confirmation?id=o-2&email=${encodeURIComponent("buyer@example.com")}`);
    });

    it("cart changed after the 409 (a quantity): the override is gone; figures come from the cart again", async () => {
        answers([409, ANSWER], [201, { orderId: "o-3", orderNumber: "PPB-0003", couponDiscount: 2 }]);
        mountCheckout();
        await submit();
        act(() => cart.updateQuantity(P1, 3));
        // 3 × 12.00 (the server's unit price, now in the cart) + 6.00 = 42; shipping 5 and discount 2 from the page → 45.
        expect(summary()).toEqual({
            lines: ["36.00 USD", "6.00 USD"],
            rows: ["Subtotal = 42.00 USD", "Discount (TEN) = -2.00 USD", "Shipping = 5.00 USD", "Total = 45.00 USD"],
        });
        expect(statusText()).toBeNull();
        await submit();
        expect(sent(1).expectedTotal).toBe(45);
    });

    it("cart changed after the 409 (an item removed): the override is gone", async () => {
        answers([409, ANSWER]);
        mountCheckout();
        await submit();
        act(() => cart.removeItem(P2, "Size: L"));
        expect(summary().rows).toContain("Total = 27.00 USD"); // 24 − 2 + 5
        expect(statusText()).toBeNull();
    });
});

describe("ORDER-CONFIRM-1 — checkout: a price-changed answer without a usable message", () => {
    for (const [name, message] of [["absent", undefined], ["blank", "  "]] as const) {
        it(`message ${name} → the answer's error text is shown, with the server's figures`, async () => {
            const { message: _m, ...rest } = ANSWER;
            answers([409, message === undefined ? rest : { ...rest, message }]);
            mountCheckout();
            await submit();
            expect(statusText()).toBe(ANSWER.error);
            expect(summary().rows).toContain("Total = 39.50 USD");
            expect(push).not.toHaveBeenCalled();
        });
    }
});

describe("ORDER-CONFIRM-1 — checkout: another refusal takes today's error path", () => {
    for (const status of [400, 403, 500]) {
        it(`${status} with an error text → the text is shown as sent; no override; the cart's figures stay`, async () => {
            answers([status, { error: `refused ${status}` }]);
            mountCheckout();
            await submit();
            expect(host.textContent).toContain(`refused ${status}`);
            expect(statusText()).toBeNull();
            expect(summary().rows).toContain("Total = 27.00 USD");
            expect(storedCart()[0].priceInputs).toEqual({ price: "10.00" });
            expect(push).not.toHaveBeenCalled();
        });
    }

    it("409 without code price-changed → today's error path (the text as sent)", async () => {
        answers([409, { error: "conflict" }]);
        mountCheckout();
        await submit();
        expect(host.textContent).toContain("conflict");
        expect(statusText()).toBeNull();
    });
});

describe("ORDER-CONFIRM-1 — a cart item saved before order-price-1 (only unitPrice)", () => {
    it("an old price → 409, then the item shows the server's price (never its old unitPrice, its added cost not counted twice)", async () => {
        const legacy = { productId: P1, productTitle: "Rug", productImage: "", productSlug: "rug", quantity: 2, unitPrice: 10, currency: "USD",
            personalizations: [{ label: "Engraving", value: "AB", addedCost: 5 }] };
        localStorage.setItem(CART_KEY, JSON.stringify([legacy]));
        localStorage.removeItem(`${CART_KEY}_coupon`);
        // The legacy arithmetic: (10 + 5) × 2 = 30, + shipping 5 → 35 shown. The server: unit 17.00 (12 + 5) → 34 + 5 = 39.
        const answer: PriceChangedAnswer = { ...ANSWER, total: 39, subtotal: 34, shippingCost: 5, couponDiscount: 0,
            items: [{ productId: P1, quantity: 2, unitPrice: 17, totalPrice: 34 }] };
        answers([409, answer]);
        mountCheckout();
        expect(summary().rows).toContain("Total = 35.00 USD");
        await submit();
        expect(sent(0).expectedTotal).toBe(35);
        expect(summary().lines).toEqual(["34.00 USD"]);
        const [item] = storedCart();
        expect(item.priceInputs).toEqual({ price: "17.00" });
        expect(item.unitPrice).toBe(17);
        expect(cartLineTotal(item)).toBe(34);
        // After a quantity change the override is gone; the item is still priced from the server's unit price.
        act(() => cart.updateQuantity(P1, 1));
        expect(summary().lines).toEqual(["17.00 USD"]);
    });
});
