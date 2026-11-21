// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveLocaleStrings, CouponPrecheckItemSchema } from "@amodx/shared";

/**
 * COUPON-FIX-1 (ruling CF1-PRECHECK-LINES = B) — the body of the cart's coupon pre-check request: per line the
 * product, the quantity and the line total the cart shows; no categories. Same harness as `price-locale-1.test.ts`.
 * Real: `CartProvider`, `AddToCartButton`, `CartPageView`, `cartLineTotal`. Mocked: the tenant URL hook, Next's router
 * and link, NextAuth, reCAPTCHA, the FB pixel, `fetch`.
 */

vi.mock("@/lib/routing", () => ({ useTenantUrl: () => ({ getUrl: (p: string) => p }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/lib/fbpixel", () => ({ trackFBEvent: () => {} }));
vi.mock("@/hooks/useRecaptcha", () => ({ useRecaptcha: () => ({ execute: async () => "token" }) }));
vi.mock("next/link", async () => {
    const { createElement: h } = await import("react");
    return { default: ({ href, children, ...rest }: any) => h("a", { href: typeof href === "string" ? href : "#", ...rest }, children) };
});

import { CartProvider, useCart, cartLineTotal } from "@/context/CartContext";
import { AddToCartButton } from "@/components/AddToCartButton";
import { CartPageView } from "@/components/CartPageView";

const EN = resolveLocaleStrings({ locale: "en-US" }).strings;
const BUTTON_STRINGS = { ...EN.commerce, formSelectPlaceholder: EN.site.formSelectPlaceholder };
const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";

let root: Root | null = null;
let host: HTMLDivElement;
let cart: ReturnType<typeof useCart>;
function Probe() { cart = useCart(); return null; }
const tree = (children?: ReactNode) =>
    createElement(CartProvider, { tenantId: "t1", cartPrefix: "/cart", children: createElement(Fragment, null, createElement(Probe), children) });

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
    localStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(tree()); });
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const show = (children: ReactNode) => act(() => root!.render(tree(children)));
const button = (productId: string, price: string) => createElement(AddToCartButton, { key: productId,
    productId, title: `Product ${productId.slice(-1)}`, slug: "p", imageLink: "", price, currency: "USD",
    availability: "in_stock", variants: [], personalizations: [], volumePricing: [], strings: BUTTON_STRINGS,
});
const clickButtonWithText = (text: string) =>
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!.click());
const typeInto = (el: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("COUPON-FIX-1 — the cart's pre-check request body", () => {
    it("per line productId, quantity and the line total the cart shows; no categoryIds; each line parses as CouponPrecheckItem", async () => {
        show(button(P1, "25.00"));
        clickButtonWithText(BUTTON_STRINGS.addToCart);
        act(() => cart.updateQuantity(P1, 3));
        show(button(P2, "10.00"));
        clickButtonWithText(BUTTON_STRINGS.addToCart);
        expect(cart.items.map((i) => [i.productId, i.quantity])).toEqual([[P1, 3], [P2, 1]]);

        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ valid: true, discount: 7.5, couponId: "cp1", type: "percentage", value: 10 }) }));
        vi.stubGlobal("fetch", fetchMock);
        show(createElement(CartPageView, {
            checkoutPrefix: "/checkout", shopPrefix: "/shop", freeDeliveryThreshold: 0, flatShippingCost: 0, minimumOrderAmount: 0,
            currency: "USD", tenantId: "t1", apiUrl: "https://api.test", strings: EN.commerce,
        }));
        typeInto(host.querySelector(`input[placeholder="${EN.commerce.couponCode}"]`) as HTMLInputElement, "ten");
        await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent === EN.commerce.apply)!.click(); });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as any;
        expect(url).toBe("https://api.test/public/coupons/validate");
        const body = JSON.parse(init.body);
        expect(body).toEqual({
            code: "TEN", subtotal: "85", recaptchaToken: "token", // the input changes the code to capitals as the visitor types
            items: [{ productId: P1, quantity: 3, lineTotal: 75 }, { productId: P2, quantity: 1, lineTotal: 10 }],
        });
        expect(body.items.map((i: any) => i.lineTotal)).toEqual(cart.items.map((i) => cartLineTotal(i)));
        for (const line of body.items) expect(CouponPrecheckItemSchema.safeParse(line).success).toBe(true);
        expect(cart.coupon).toEqual({ code: "TEN", discount: 7.5 });
    });
});
