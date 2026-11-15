// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OrderInputSchema, resolveLocaleStrings } from "@amodx/shared";

/**
 * ORDER-CHECKOUT-1 (docs/slices/order-checkout-1.md § 1 items 1-2) — the browser side.
 * (1) The payment value the checkout sends — read from the checkout's own state and radio buttons, never a copied
 *     literal — passes the real `OrderInputSchema`.
 * (2) The confirmation address carries the `orderId` of the order answer.
 * Real: `CartProvider` (jsdom localStorage), `CheckoutPageView`, the shared schema. Mocked: the tenant URL hook (identity),
 * Next's router (a spy on `push`), NextAuth, reCAPTCHA, the FB pixel and `fetch` (the order answer).
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/lib/routing", () => ({ useTenantUrl: () => ({ getUrl: (p: string) => p }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/lib/fbpixel", () => ({ trackFBEvent: () => {} }));
vi.mock("@/hooks/useRecaptcha", () => ({ useRecaptcha: () => ({ execute: async () => null }) }));

import { CartProvider } from "@/context/CartContext";
import { CheckoutPageView } from "@/components/CheckoutPageView";

const EN = resolveLocaleStrings({}).strings;
const CHECKOUT_STRINGS = { ...EN.commerce, errorTryAgain: EN.site.errorTryAgain };
const CONFIRM = "/checkout/confirmation";
const EMAIL = "buyer@example.com";
const ITEM = {
    productId: "c0000000-0000-4000-8000-000000000001", productTitle: "Rug", productImage: "", productSlug: "rug",
    quantity: 1, unitPrice: 10, currency: "USD", personalizations: [], priceInputs: { price: "10.00" },
};

let root: Root | null = null;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("amodx_cart_t1", JSON.stringify([ITEM]));
    push.mockReset();
    answer({ orderId: "o-123", orderNumber: "PPB-0007", couponDiscount: 0 });
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

/** The order answer `fetch` gives (201, JSON). */
function answer(json: unknown) {
    fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => json }));
    vi.stubGlobal("fetch", fetchMock);
}

function mountCheckout(extra: Record<string, unknown> = {}) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
        root = createRoot(host);
        root.render(createElement(CartProvider, {
            tenantId: "t1", cartPrefix: "/cart",
            children: createElement(CheckoutPageView, {
                tenantId: "t1", apiUrl: "", confirmPrefix: CONFIRM, cartPrefix: "/cart", freeDeliveryThreshold: 0,
                flatShippingCost: 0, currency: "USD", strings: CHECKOUT_STRINGS, ...extra,
            }),
        }));
    });
    const email = host.querySelector('input[type="email"]') as HTMLInputElement;
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, EMAIL);
        email.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
const submit = async () => {
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
};
const sentBody = () => JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
/**
 * The sent body through the real schema. Only the texts a visitor types and this test does not (name, street, city,
 * county) get a value; `paymentMethod` and the items stay exactly as the checkout sent them.
 */
const parseSent = (sent: any) => OrderInputSchema.safeParse({
    ...sent, customerName: "Ana Pop", shippingAddress: { ...sent.shippingAddress, street: "Main 1", city: "Town", county: "County" },
});

describe("ORDER-CHECKOUT-1 — the checkout's payment value passes the real schema", () => {
    it("the default value (no enabledPaymentMethods given) is sent and accepted", async () => {
        mountCheckout();
        await submit();
        const sent = sentBody();
        expect(sent.paymentMethod).toBe("cash_on_delivery"); // names the value the checkout chose; the next line is the row
        expect(parseSent(sent).error).toBeUndefined();
    });

    it("each payment radio the checkout renders, when chosen, is sent as its value and accepted", async () => {
        const enabled = ["bank_transfer", "cash_on_delivery"];
        const bankTransfer = { bankName: "Bank", accountHolder: "Shop", iban: "RO49AAAA1B31007593840000" };
        mountCheckout({ enabledPaymentMethods: enabled, bankTransfer });
        // A refusal answer keeps the cart (a success clears it), so the same form submits once per radio. The request
        // body is built before the answer arrives, so the answer does not change what is checked here.
        fetchMock.mockImplementation(async () => ({ ok: false, status: 400, json: async () => ({ error: "test" }) }));
        const radios = [...host.querySelectorAll('input[type="radio"][name="paymentMethod"]')] as HTMLInputElement[];
        expect(radios.map((r) => r.value).sort()).toEqual([...enabled].sort());
        for (const radio of radios) {
            fetchMock.mockClear();
            act(() => radio.click());
            await submit();
            const sent = sentBody();
            expect(sent.paymentMethod).toBe(radio.value);
            expect(parseSent(sent).error).toBeUndefined();
        }
    });
});

describe("ORDER-CHECKOUT-1 — the confirmation address", () => {
    it("order answer { orderId: \"o-123\", … } → the address holds id=o-123", async () => {
        mountCheckout();
        await submit();
        expect(push).toHaveBeenCalledTimes(1);
        expect(push).toHaveBeenCalledWith(`${CONFIRM}?id=o-123&email=${encodeURIComponent(EMAIL)}`);
    });

    it("order answer without orderId → today's behaviour is kept: the address holds the text id=undefined", async () => {
        answer({ orderNumber: "PPB-0007" });
        mountCheckout();
        await submit();
        expect(push).toHaveBeenCalledWith(`${CONFIRM}?id=undefined&email=${encodeURIComponent(EMAIL)}`);
    });
});
