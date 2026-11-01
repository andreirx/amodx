// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { fillTemplate, resolveLocaleStrings } from "@amodx/shared";
// The § 8.5 extraction (locale-1/extract.mjs: the module proof.mjs re-exports; importable under jsdom).
import { extractVisibleText, textChanges } from "../serving-contract/locale-1/extract.mjs";

/**
 * LOCALE-1D (docs/slices/locale-1.md § 8.5 "client-only states", § 16.2 items 4-5) — the commerce views render their
 * forms, lists and messages only in the browser (the cart lives in localStorage, the session and the account data are
 * fetched), so the serving captures show at most their empty states. Here each view is mounted in jsdom and every
 * state is driven: the cart with items and a coupon (applied, refused, check failed), the checkout form (company and
 * billing fields, both payment methods, the delivery date picker, the three order errors), the account page (loading,
 * signed out, profile with every order status, no orders, edit, saving), the add-to-cart control (validation errors,
 * added), the commerce bar and the navbar account links.
 *
 * Two oracles per state:
 *  1. EN (an en-US tenant): the markup after every step equals `locale-1d-client-before.json`, rendered by THIS file
 *     from the slice's start commit 92adbba (capture mode, `LOCALE_1D_CAPTURE=<file>`; procedure in the record). The
 *     texts a formatter takes from the runtime default (the month name, the birthday, the loyalty points — kept for an
 *     en-US tenant, § 16.2 item 4) are replaced by a token on both sides and checked separately against the runtime
 *     default, so the capture does not depend on the machine's locale.
 *  2. RO (a ro-RO tenant): every visible-text change against the EN render (§ 8.5 extraction, locale-1/proof.mjs) is
 *     explained by one declared key of the state (EN value → RO value) or a declared formatted value, and every declared
 *     key whose RO value differs from its EN value changes. Nothing else may differ.
 * Mocked: the cart hook, NextAuth, Next's link/router, the tenant URL hook, reCAPTCHA, the FB pixel and `fetch`. Real:
 * the five components and the resolver. The props are a superset that the 92adbba components also accept.
 */

const cart = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
const auth = vi.hoisted(() => ({ data: null as null | object, status: "unauthenticated" as string }));
vi.mock("@/context/CartContext", () => ({ useCart: () => cart.state }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: auth.data, status: auth.status }), signOut: () => {}, signIn: () => {} }));
vi.mock("@/lib/routing", () => ({ useTenantUrl: () => ({ getUrl: (p: string) => p }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/" }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
vi.mock("@/lib/fbpixel", () => ({ trackFBEvent: () => {} }));
vi.mock("@/hooks/useRecaptcha", () => ({ useRecaptcha: () => ({ execute: async () => null }) }));

import { CartPageView } from "@/components/CartPageView";
import { CheckoutPageView, DeliveryDatePicker } from "@/components/CheckoutPageView";
import { AccountPageView } from "@/components/AccountPageView";
import { AddToCartButton } from "@/components/AddToCartButton";
import { CommerceBar } from "@/components/CommerceBar";
import { Navbar } from "@/components/Navbar";

// Node's URL: the jsdom environment replaces the global `URL` with one that does not resolve file: URLs.
const BEFORE_FILE = fileURLToPath(new NodeURL("./locale-1d-client-before.json", import.meta.url));
const CAPTURE = process.env.LOCALE_1D_CAPTURE;

type Lang = "en" | "ro";
const LOCALE: Record<Lang, string> = { en: "en-US", ro: "ro-RO" };
/** The flat table a view receives from SitePage / the layout: every site and commerce key (a superset of each view's
 *  keys, so the 92adbba components, which take the whole commerce object, accept the same props). */
const TABLE: Record<Lang, Record<string, any>> = {
    en: { ...resolveLocaleStrings({}).strings.site, ...resolveLocaleStrings({}).strings.commerce },
    ro: { ...resolveLocaleStrings({ locale: "ro-RO" }).strings.site, ...resolveLocaleStrings({ locale: "ro-RO" }).strings.commerce },
};
/** `formatLocale` only for a non-en-US tenant (SitePage `formatLocaleProp`). */
const fmt = (lang: Lang) => (lang === "ro" ? { formatLocale: LOCALE.ro } : {});

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    auth.data = null; auth.status = "unauthenticated";
    vi.unstubAllGlobals();
});
function mount(el: React.ReactElement) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(el); });
}
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
const byText = (sel: string, t: string) => [...host.querySelectorAll(sel)].find((b) => (b.textContent ?? "").trim() === t)!;
const checkboxNear = (t: string) => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => i.parentElement?.textContent?.includes(t))!;
function typeInto(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function submitForm() {
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
}

const ITEM = (over: Record<string, unknown> = {}) => ({
    productId: "p1", productTitle: "Rug", productSlug: "rug", productImage: "", quantity: 2, unitPrice: 40, currency: "USD", personalizations: [], ...over,
});
function setCart(items: ReturnType<typeof ITEM>[], coupon: null | { code: string; discount: number } = null) {
    const subtotal = items.reduce((s, i) => s + (i.unitPrice + (i.personalizations as any[]).reduce((a, p) => a + p.addedCost, 0)) * i.quantity, 0);
    cart.state = {
        items, subtotal, itemCount: items.reduce((n, i) => n + i.quantity, 0), coupon, cartPrefix: "/cart",
        removeItem: () => {}, updateQuantity: () => {}, setCoupon: () => {}, clearCart: () => {}, addItem: () => {},
    };
}
const response = (status: number, body: unknown, jsonFails = false) => ({ ok: status < 400, status, json: async () => { if (jsonFails) throw new Error("not JSON"); return body; } });

// ── The runtime-default formatter texts of an en-US tenant (§ 16.2 item 4), tokenised for the capture ──────────────
const MONTH = { year: 2026, month: 10 };   // November 2026 (0-based month), the first available delivery month
const BIRTHDAY = "1990-05-17";
const POINTS = 12345;
const runtimeTexts = () => ({
    "{month}": new Date(MONTH.year, MONTH.month, 1).toLocaleString("default", { month: "long", year: "numeric" }),
    "{birthday}": new Date(BIRTHDAY + "T00:00:00").toLocaleDateString(),
    "{points}": POINTS.toLocaleString(),
});
/** Replaces each runtime-default text by its token (EN only: the RO render uses the tenant locale). */
function tokenise(html: string): string {
    let out = html;
    for (const [token, text] of Object.entries(runtimeTexts())) out = out.split(`>${text}<`).join(`>${token}<`);
    return out;
}

// ── The states ───────────────────────────────────────────────────────────────────────────────────────────────────
/** A declared change: a key of the flat table (filled with `values`, placed in `frame`), or a formatted value. */
type Spec = { key: string; values?: (lang: Lang) => Record<string, string | number>; frame?: string } | { formatted: (lang: Lang) => string; frame?: string };
/** `title`: the literal test-title prefix of the state (cited by locale-1/1d/coverage.json). */
type State = { title: string; run: (lang: Lang) => Promise<string[]>; keys: Spec[] };
const K = (key: string, frame?: string, values?: (lang: Lang) => Record<string, string | number>): Spec => ({ key, frame, values });
const keys = (...names: string[]) => names.map((n) => K(n));
/** An empty placeholder (the EN value of `phonePlaceholder` and the three company placeholders is "") is not an item of
 *  the § 8.5 extraction; here it is made one, so a Romanian placeholder where EN has none is a CHANGE of one item, not a
 *  different structure. Applied to both sides of every RO comparison. */
const EMPTY = "∅";
const extract = (html: string) => extractVisibleText(html.replace(/placeholder=""/g, `placeholder="${EMPTY}"`));
const render = (lang: Lang, s: Spec) => {
    const text = "key" in s ? fillTemplate(TABLE[lang][s.key], s.values?.(lang) ?? {}) : s.formatted(lang);
    return (s.frame ?? "{text}").replace("{text}", text || EMPTY);
};
const dateText = (iso: string, lang: Lang, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleDateString(LOCALE[lang], opts);

const BANK = { bankName: "Test Bank", accountHolder: "Shop SRL", iban: "RO49AAAA1B31007593840000", swift: "AAAARO22" };
const checkoutProps = (lang: Lang, over: Record<string, unknown> = {}) => ({
    tenantId: "t1", apiUrl: "", confirmPrefix: "/checkout/confirmare", cartPrefix: "/cart", freeDeliveryThreshold: 0, flatShippingCost: 10,
    currency: "USD", strings: TABLE[lang], locale: LOCALE[lang], ...fmt(lang), ...over,
});
const cartProps = (lang: Lang, over: Record<string, unknown> = {}) => ({
    checkoutPrefix: "/checkout", shopPrefix: "/shop", freeDeliveryThreshold: 0, flatShippingCost: 0, minimumOrderAmount: 0, currency: "USD",
    tenantId: "t1", apiUrl: "https://api.test", strings: TABLE[lang], ...over,
});
const accountProps = (lang: Lang) => ({ currency: "USD", checkoutPrefix: "/checkout", shopPrefix: "/shop", askBirthday: true, strings: TABLE[lang], ...fmt(lang) });
const ORDERS = ["placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled", "on_hold"].map((status, i) => ({
    orderNumber: `T-${i + 1}`, total: "10.00", status, createdAt: "2026-10-15T12:00:00.000Z", orderId: `o${i + 1}`,
}));
const CUSTOMER = { email: "ana@test", name: "Ana Pop", phone: "0700 000 000", birthday: BIRTHDAY, loyaltyPoints: POINTS, defaultAddress: { street: "Str. 1", city: "Cluj", county: "Cluj", postalCode: "400001", country: "RO" } };
function accountFetch(orders: unknown[], customer: unknown) {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method === "POST") return new Promise(() => {});           // the save stays pending: the "Saving..." state
        if (url === "/api/account/orders") return response(200, { orders });
        if (url === "/api/profile") return response(200, customer);
        throw new Error(`unexpected fetch ${url}`);
    }));
}
const atcProps = (lang: Lang, over: Record<string, unknown> = {}) => ({
    productId: "p1", title: "Rug", slug: "rug", imageLink: "", price: "80.00", currency: "USD", availability: "in_stock",
    variants: [], personalizations: [], volumePricing: [], strings: TABLE[lang], ...over,
});
const navProps = (lang: Lang) => ({
    siteName: "Shop", commerceEnabled: true, accountPrefix: "/account", commerceStrings: TABLE[lang],
    strings: { navAllOf: TABLE[lang].navAllOf, navContact: TABLE[lang].navContact, navToggleMenu: TABLE[lang].navToggleMenu, navViewAll: TABLE[lang].navViewAll, navContactUs: TABLE[lang].navContactUs },
});
const barProps = (lang: Lang) => ({ currency: "USD", accountPrefix: "/account", labels: TABLE[lang] });
const snap = () => host.innerHTML;

const STATES: Record<string, State> = {
    "cart-empty": {
        title: "[1d-client] cart-empty",
        run: async (lang) => { setCart([]); mount(createElement(CartPageView, cartProps(lang) as any)); return [snap()]; },
        keys: keys("emptyCart", "emptyCartMessage", "continueShopping"),
    },
    "cart-items": {
        title: "[1d-client] cart-items",
        run: async (lang) => {
            setCart([ITEM(), ITEM({ productId: "p2", productTitle: "Mat", selectedVariant: "Size: M", quantity: 1, personalizations: [{ label: "Monogram", value: "AB", addedCost: 5 }] })]);
            mount(createElement(CartPageView, cartProps(lang, { freeDeliveryThreshold: 200, flatShippingCost: 10, minimumOrderAmount: 150 }) as any));
            return [snap()];
        },
        keys: [K("shoppingCart", "{text} (3)"), K("continueShopping", "← {text}"), ...keys("orderSummary", "couponCode", "apply", "subtotal", "shipping", "total", "proceedToCheckout"),
            K("freeDeliveryFrom", "{text} 200 USD"), K("addMoreForFreeDelivery", "{text} USD", () => ({ amount: "75.00" })), K("minimumOrder", "{text}: 150 USD")],
    },
    "cart-coupon": {
        title: "[1d-client] cart-coupon",
        run: async (lang) => {
            setCart([ITEM({ quantity: 5 })], { code: "SAVE5", discount: 5 });
            mount(createElement(CartPageView, cartProps(lang, { freeDeliveryThreshold: 100, flatShippingCost: 10 }) as any));
            return [snap()];
        },
        keys: [K("shoppingCart", "{text} (5)"), K("continueShopping", "← {text}"), ...keys("orderSummary", "remove", "subtotal", "discount", "shipping", "freeShipping", "total", "proceedToCheckout")],
    },
    "cart-coupon-refused": {
        title: "[1d-client] cart-coupon-refused",
        run: async (lang) => {
            setCart([ITEM()]);
            mount(createElement(CartPageView, cartProps(lang) as any));
            const out: string[] = [];
            typeInto(host.querySelector<HTMLInputElement>("input")!, "BAD");
            vi.stubGlobal("fetch", vi.fn(async () => response(200, { valid: false })));
            click(byText("button", TABLE[lang].apply)); await flush(); out.push(snap());
            vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
            click(byText("button", TABLE[lang].apply)); await flush(); out.push(snap());
            return out;
        },
        keys: [K("shoppingCart", "{text} (2)"), K("continueShopping", "← {text}"), ...keys("orderSummary", "couponCode", "apply", "subtotal", "shipping", "freeShipping", "total", "proceedToCheckout", "invalidCoupon", "couponValidateFailed")],
    },
    "checkout-empty": {
        title: "[1d-client] checkout-empty",
        run: async (lang) => { setCart([]); mount(createElement(CheckoutPageView, checkoutProps(lang) as any)); return [snap()]; },
        keys: keys("emptyCart", "checkoutEmptyMessage"),
    },
    "checkout-form": {
        title: "[1d-client] checkout-form",
        run: async (lang) => {
            setCart([ITEM(), ITEM({ productId: "p2", productTitle: "Mat", quantity: 1, personalizations: [{ label: "Monogram", value: "AB", addedCost: 5 }] })], { code: "SAVE5", discount: 5 });
            mount(createElement(CheckoutPageView, checkoutProps(lang, {
                bankTransfer: BANK, enabledPaymentMethods: ["cash_on_delivery", "bank_transfer"], availableCountries: ["Romania", "Moldova"],
                availableCounties: ["Cluj", "Ilfov"], askBirthday: true,
            }) as any));
            const out = [snap()];
            click(checkboxNear(TABLE[lang].orderAsCompany)); out.push(snap());
            click(checkboxNear(TABLE[lang].useSameAsShipping)); out.push(snap());
            return out;
        },
        keys: [...keys("checkout", "billingDetails", "phone", "birthdayHint", "orderAsCompany", "shippingAddress", "selectCountry", "selectCounty", "postalCode", "deliveryNotes",
            "deliveryNotesPlaceholder", "useSameAsShipping", "paymentMethod", "cashOnDelivery", "cashOnDeliveryDesc", "bankTransfer", "orderSummary", "subtotal", "shipping", "total",
            "placeOrder", "termsAgreement", "companyName", "taxId", "registrationNumber", "vatNumber", "billingAddress", "country", "taxIdPlaceholder", "registrationNumberPlaceholder", "vatNumberPlaceholder"),
            K("firstName", "{text} *"), K("lastName", "{text} *"), K("email", "{text} *"), K("birthday"), K("country", "{text} *"), K("streetAddress", "{text} *"), K("city", "{text} *"),
            K("county", "{text} *"), K("discount", "{text} (SAVE5)"), K("phonePlaceholder"),
            K("bankTransferTo", undefined, () => ({ bank: BANK.bankName, iban: BANK.iban }))],
    },
    "checkout-dates": {
        title: "[1d-client] checkout-dates",
        run: async (lang) => {
            setCart([ITEM()]);
            vi.stubGlobal("fetch", vi.fn(async () => response(200, { dates: ["2026-11-03", "2026-11-05"] })));
            mount(createElement(CheckoutPageView, checkoutProps(lang, { apiUrl: "https://api.test", askBirthday: false }) as any));
            await flush();
            const out = [snap()];
            click(byText("button", "3")); out.push(snap());
            return out;
        },
        keys: [...keys("checkout", "billingDetails", "phone", "orderAsCompany", "shippingAddress", "postalCode", "deliveryNotes", "deliveryNotesPlaceholder",
            "useSameAsShipping", "paymentMethod", "cashOnDelivery", "cashOnDeliveryDesc", "orderSummary", "subtotal", "shipping", "total", "placeOrder", "termsAgreement", "phonePlaceholder",
            "preferredDeliveryDate", "calendarMo", "calendarTu", "calendarWe", "calendarTh", "calendarFr", "calendarSa", "calendarSu"),
            K("firstName", "{text} *"), K("lastName", "{text} *"), K("email", "{text} *"), K("streetAddress", "{text} *"), K("city", "{text} *"), K("county", "{text} *"),
            { formatted: (lang) => (lang === "en" ? "{month}" : new Date(MONTH.year, MONTH.month, 1).toLocaleString(LOCALE.ro, { month: "long", year: "numeric" })) },
            K("deliveryDateSelected", undefined, (lang) => ({ date: dateText("2026-11-03T00:00:00", lang, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) })),
            { formatted: (lang) => dateText("2026-11-03T00:00:00", lang, { day: "numeric", month: "short" }) }],
    },
    "checkout-errors": {
        title: "[1d-client] checkout-errors",
        run: async (lang) => {
            setCart([ITEM()]);
            mount(createElement(CheckoutPageView, checkoutProps(lang, { askBirthday: false }) as any));
            const out: string[] = [];
            vi.stubGlobal("fetch", vi.fn(async () => response(500, null, true)));          // not JSON → "Order failed"
            await submitForm(); out.push(snap());
            vi.stubGlobal("fetch", vi.fn(async () => response(422, {})));                  // JSON without `error` → "Order failed (422)"
            await submitForm(); out.push(snap());
            vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(""); }));          // no message → the generic error
            await submitForm(); out.push(snap());
            return out;
        },
        keys: [...keys("checkout", "billingDetails", "phone", "orderAsCompany", "shippingAddress", "postalCode", "deliveryNotes", "deliveryNotesPlaceholder",
            "useSameAsShipping", "paymentMethod", "cashOnDelivery", "cashOnDeliveryDesc", "orderSummary", "subtotal", "shipping", "total", "placeOrder", "termsAgreement", "phonePlaceholder",
            "orderFailed", "errorTryAgain"),
            K("firstName", "{text} *"), K("lastName", "{text} *"), K("email", "{text} *"), K("streetAddress", "{text} *"), K("city", "{text} *"), K("county", "{text} *"),
            K("orderFailedStatus", undefined, () => ({ status: 422 }))],
    },
    // Iteration 1 (review-0 R2): the three texts that were checked at prop level only, now at their reader.
    "checkout-placing": {
        title: "[1d-client] checkout-placing",
        run: async (lang) => {
            setCart([ITEM()]);
            mount(createElement(CheckoutPageView, checkoutProps(lang, { askBirthday: false }) as any));
            vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));                 // the order request stays pending
            await submitForm();
            return [snap()];
        },
        keys: [...keys("checkout", "billingDetails", "phone", "orderAsCompany", "shippingAddress", "postalCode", "deliveryNotes", "deliveryNotesPlaceholder",
            "useSameAsShipping", "paymentMethod", "cashOnDelivery", "cashOnDeliveryDesc", "orderSummary", "subtotal", "shipping", "total", "placingOrder", "termsAgreement", "phonePlaceholder"),
            K("firstName", "{text} *"), K("lastName", "{text} *"), K("email", "{text} *"), K("streetAddress", "{text} *"), K("city", "{text} *"), K("county", "{text} *")],
    },
    "date-picker-loading": {
        title: "[1d-client] date-picker-loading",
        // The picker's own loading branch (no CheckoutPageView state reaches it: the page mounts it only after loading).
        run: async (lang) => {
            mount(createElement(DeliveryDatePicker, { availableDates: [], selectedDate: "", onSelect: () => {}, loading: true, strings: TABLE[lang], ...fmt(lang) } as any));
            return [snap()];
        },
        keys: keys("deliveryDatesLoading"),
    },
    "add-to-cart-option-sold-out": {
        title: "[1d-client] add-to-cart-option-sold-out",
        // The selected option becomes out of stock while the control is mounted (new product data, same component): the
        // control shows variantUnavailable. (An option that is out of stock at mount is a disabled button.)
        run: async (lang) => {
            setCart([]);
            const variants = (sizeS: Record<string, string>) => [{ id: "size", name: "Size", options: [{ value: "S", ...sizeS }, { value: "M" }] }];
            mount(createElement(AddToCartButton, atcProps(lang, { variants: variants({}) }) as any));
            click(byText("button", "S"));
            act(() => { root!.render(createElement(AddToCartButton, atcProps(lang, { variants: variants({ availability: "out_of_stock" }) }) as any)); });
            return [snap()];
        },
        keys: keys("variantUnavailable"),
    },
    "account-loading": {
        title: "[1d-client] account-loading",
        run: async (lang) => { auth.status = "loading"; mount(createElement(AccountPageView, accountProps(lang) as any)); return [snap()]; },
        keys: [],
    },
    "account-signed-out": {
        title: "[1d-client] account-signed-out",
        run: async (lang) => { mount(createElement(AccountPageView, accountProps(lang) as any)); await flush(); return [snap()]; },
        keys: keys("myAccount", "accountSignInPrompt", "signInWithGoogle"),
    },
    "account-profile": {
        title: "[1d-client] account-profile",
        run: async (lang) => {
            auth.data = { user: { email: "ana@test", name: "Ana Pop" } }; auth.status = "authenticated";
            accountFetch(ORDERS, CUSTOMER);
            mount(createElement(AccountPageView, accountProps(lang) as any)); await flush();
            return [snap()];
        },
        keys: [...keys("myAccount", "signOut", "profileHeading", "edit", "accountName", "email", "phone", "birthday", "loyaltyPoints", "defaultAddress", "orderHistory",
            "orderStatusPlaced", "orderStatusConfirmed", "orderStatusPrepared", "orderStatusShipped", "orderStatusDelivered", "orderStatusCancelled", "orderStatusAnnulled"),
            { formatted: (lang) => (lang === "en" ? "{birthday}" : new Date(BIRTHDAY + "T00:00:00").toLocaleDateString(LOCALE.ro)) },
            { formatted: (lang) => (lang === "en" ? "{points}" : POINTS.toLocaleString(LOCALE.ro)) },
            { formatted: (lang) => dateText("2026-10-15T12:00:00.000Z", lang, { year: "numeric", month: "short", day: "numeric" }) }],
    },
    "account-no-orders": {
        title: "[1d-client] account-no-orders",
        run: async (lang) => {
            auth.data = { user: { email: "ana@test" } }; auth.status = "authenticated";
            accountFetch([], { email: "ana@test", name: "", phone: "" });
            mount(createElement(AccountPageView, accountProps(lang) as any)); await flush();
            return [snap()];
        },
        keys: keys("myAccount", "signOut", "profileHeading", "edit", "accountName", "email", "phone", "birthday", "birthdayHint", "orderHistory", "noOrdersYet", "startShopping"),
    },
    "account-edit": {
        title: "[1d-client] account-edit",
        run: async (lang) => {
            auth.data = { user: { email: "ana@test", name: "Ana Pop" } }; auth.status = "authenticated";
            accountFetch([], CUSTOMER);
            mount(createElement(AccountPageView, accountProps(lang) as any)); await flush();
            click(host.querySelector("h2 + button")!);                                   // "Edit", next to the Profile heading
            const out = [snap()];
            await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
            out.push(snap());
            return out;
        },
        keys: keys("myAccount", "signOut", "profileHeading", "accountName", "email", "phone", "phonePlaceholder", "birthday", "birthdayHint", "save", "saving", "cancel",
            "orderHistory", "noOrdersYet", "startShopping"),
    },
    "add-to-cart": {
        title: "[1d-client] add-to-cart",
        run: async (lang) => {
            setCart([]);
            const out: string[] = [];
            mount(createElement(AddToCartButton, atcProps(lang) as any)); out.push(snap());
            act(() => root?.unmount()); document.body.innerHTML = "";
            mount(createElement(AddToCartButton, atcProps(lang, { availability: "out_of_stock" }) as any)); out.push(snap());
            act(() => root?.unmount()); document.body.innerHTML = "";
            mount(createElement(AddToCartButton, atcProps(lang, {
                variants: [{ id: "size", name: "Size", options: [{ value: "S" }, { value: "M", availability: "out_of_stock" }] }],
                personalizations: [
                    { id: "mono", label: "Monogram", type: "text", required: true, addedCost: "0" },
                    { id: "color", label: "Color", type: "select", required: false, options: ["Red"], addedCost: "0" },
                ],
            }) as any));
            out.push(snap());
            const addButton = () => [...host.querySelectorAll("button")].at(-1)!;
            click(addButton()); out.push(snap());                                          // the required personalization is empty
            typeInto(host.querySelector<HTMLInputElement>('input[placeholder="Monogram"]')!, "AB");
            click(addButton()); out.push(snap());                                          // no option selected
            click(byText("button", "S"));
            click(addButton()); out.push(snap());                                          // added
            return out;
        },
        keys: [K("addToCart", "{text} — 80.00 USD"), K("outOfStock"), K("formSelectPlaceholder"), K("addedToCart"), K("viewCart"),
            K("personalizationRequired", undefined, () => ({ label: "Monogram" })), K("variantRequired", undefined, () => ({ name: "Size" }))],
    },
    "commerce-bar": {
        title: "[1d-client] commerce-bar",
        run: async (lang) => {
            setCart([ITEM()]);
            const out: string[] = [];
            mount(createElement(CommerceBar, barProps(lang) as any)); out.push(snap());
            act(() => root?.unmount()); document.body.innerHTML = "";
            auth.data = { user: { email: "ana@test" } };
            mount(createElement(CommerceBar, barProps(lang) as any)); out.push(snap());
            return out;
        },
        keys: [K("signIn"), K("accountLabel"), K("cartWidgetTotal", undefined, () => ({ total: "80", currency: "USD" }))],
    },
    "navbar-account": {
        title: "[1d-client] navbar-account",
        run: async (lang) => {
            setCart([]);
            const out: string[] = [];
            mount(createElement(Navbar, navProps(lang) as any)); out.push(snap());
            click(host.querySelector(`button[aria-label="${TABLE[lang].navToggleMenu}"]`)!); out.push(snap());
            act(() => root?.unmount()); document.body.innerHTML = "";
            auth.data = { user: { email: "ana@test" } };
            mount(createElement(Navbar, navProps(lang) as any)); out.push(snap());
            click(host.querySelector(`button[aria-label="${TABLE[lang].navToggleMenu}"]`)!); out.push(snap());
            return out;
        },
        keys: [K("signIn"), K("accountLabel"), K("myAccount"), K("navContact"), K("navToggleMenu"), K("navContactUs")],
    },
};

if (CAPTURE) {
    // Capture mode (run once from the start commit 92adbba, record docs/slices/locale-1d.md): write the EN markup of every
    // state, tokenised; assert nothing else.
    describe("[locale-1d] capture", () => {
        it("writes the EN markup of every state", async () => {
            const states: Record<string, string[]> = {};
            for (const [name, st] of Object.entries(STATES)) {
                states[name] = (await st.run("en")).map(tokenise);
                act(() => root?.unmount()); root = null; document.body.innerHTML = ""; auth.data = null; auth.status = "unauthenticated"; vi.unstubAllGlobals();
            }
            writeFileSync(CAPTURE, JSON.stringify({ commit: process.env.LOCALE_1D_COMMIT ?? "", states }, null, 2) + "\n");
        });
    });
} else {
    const before: { commit: string; states: Record<string, string[]> } = JSON.parse(readFileSync(BEFORE_FILE, "utf8"));

    describe("[1d-client] the en-US markup of every client-only commerce state equals the 92adbba capture (§ 16.2 item 4)", () => {
        it("the capture is from the start commit and holds every state", () => {
            expect(before.commit).toBe("92adbba");
            expect(Object.keys(before.states).sort()).toEqual(Object.keys(STATES).sort());
        });
        for (const [name, st] of Object.entries(STATES)) {
            it(`${st.title}: EN markup after every step equals 92adbba`, async () => {
                const now = (await st.run("en")).map(tokenise);
                expect(now).toEqual(before.states[name]);
            });
        }
        it("[1d-client] the en-US formatter texts keep the runtime default (month name, birthday, loyalty points)", async () => {
            // The tokenised capture holds the token where today's code rendered the runtime-default text; the current render
            // must hold that same runtime text at that place (so the token stands for "the runtime default", nothing else).
            const dates = await STATES["checkout-dates"].run("en");
            expect(dates[0]).toContain(`>${runtimeTexts()["{month}"]}<`);
            act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals();
            const profile = await STATES["account-profile"].run("en");
            expect(profile[0]).toContain(`>${runtimeTexts()["{birthday}"]}<`);
            expect(profile[0]).toContain(`>${runtimeTexts()["{points}"]}<`);
            expect(before.states["checkout-dates"][0]).toContain(">{month}<");
            expect(before.states["account-profile"][0]).toContain(">{birthday}<");
        });
    });

    // Iteration 1 (review-0 R1): pattern D (§ 5.2) at the readers of the new keys whose code once fell back on another
    // text — the seven account status badges and the two checkout order errors (and the generic error): override absent →
    // the language default; "" → empty; "X" → "X". SitePage passes a D key as resolved (`pick`; locale-1d-server-render
    // test), so the table below is what the view receives. A status without a key still renders as stored.
    describe("[1d-client] preservation (§ 5.2 pattern D): absent → language default, \"\" → empty, \"X\" → X", () => {
        const STATUS_KEYS = ["orderStatusPlaced", "orderStatusConfirmed", "orderStatusPrepared", "orderStatusShipped", "orderStatusDelivered", "orderStatusCancelled", "orderStatusAnnulled"];
        const variants = (lang: Lang) => ({ absent: TABLE[lang], empty: (keysOf: string[]) => ({ ...TABLE[lang], ...Object.fromEntries(keysOf.map((k) => [k, ""])) }), own: (keysOf: string[]) => ({ ...TABLE[lang], ...Object.fromEntries(keysOf.map((k) => [k, `X-${k}`])) }) });
        for (const lang of ["en", "ro"] as Lang[]) {
            it(`[1d-client] ${lang} account status badges: the seven orderStatus keys; a legacy status stays raw`, async () => {
                const badges = async (strings: Record<string, unknown>) => {
                    auth.data = { user: { email: "ana@test" } }; auth.status = "authenticated";
                    accountFetch(ORDERS, CUSTOMER);
                    mount(createElement(AccountPageView, { ...accountProps(lang), strings } as any)); await flush();
                    const out = [...host.querySelectorAll("span.px-2.py-1.rounded")].map((b) => b.textContent);
                    act(() => root?.unmount()); root = null; document.body.innerHTML = "";
                    return out;
                };
                const v = variants(lang);
                expect(await badges(v.absent)).toEqual([...STATUS_KEYS.map((k) => TABLE[lang][k]), "on_hold"]);
                expect(await badges(v.empty(STATUS_KEYS))).toEqual([...STATUS_KEYS.map(() => ""), "on_hold"]);
                expect(await badges(v.own(STATUS_KEYS))).toEqual([...STATUS_KEYS.map((k) => `X-${k}`), "on_hold"]);
            });
            it(`[1d-client] ${lang} checkout order errors: orderFailed, orderFailedStatus, errorTryAgain; a server error text passes through`, async () => {
                const errorAfter = async (strings: Record<string, unknown>, reply: () => Promise<unknown>) => {
                    setCart([ITEM()]);
                    mount(createElement(CheckoutPageView, { ...checkoutProps(lang, { askBirthday: false }), strings } as any));
                    vi.stubGlobal("fetch", vi.fn(reply));
                    await submitForm();
                    const box = host.querySelector(".bg-red-50");
                    act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals();
                    return box === null ? null : box.textContent;
                };
                const notJson = async () => response(500, null, true), noError = async () => response(422, {}), thrown = async () => { throw new Error(""); };
                const v = variants(lang);
                const cases: [string, () => Promise<unknown>, (t: Record<string, any>) => string][] = [
                    ["orderFailed", notJson, (t) => t.orderFailed],
                    ["orderFailedStatus", noError, (t) => fillTemplate(t.orderFailedStatus, { status: 422 })],
                    ["errorTryAgain", thrown, (t) => t.errorTryAgain],
                ];
                for (const [key, reply, text] of cases) {
                    expect(await errorAfter(v.absent, reply), `${key} absent`).toBe(text(TABLE[lang]));
                    expect(await errorAfter(v.empty([key]), reply), `${key} ""`).toBe(null);          // empty error text: no error box
                    expect(await errorAfter(v.own([key]), reply), `${key} X`).toBe(text(v.own([key])));
                }
                // A server error text is shown as sent, whatever the table says.
                expect(await errorAfter(v.empty(["orderFailed", "orderFailedStatus"]), async () => response(400, { error: "Out of stock: Rug" }))).toBe("Out of stock: Rug");
            });
        }
    });

    describe("[1d-client] RO tenant: every visible change of every state is a declared key (EN → RO) or a declared formatted value", () => {
        for (const [name, st] of Object.entries(STATES)) {
            it(`${st.title}: RO texts`, async () => {
                const en = (await st.run("en")).map(tokenise);
                act(() => root?.unmount()); root = null; document.body.innerHTML = ""; auth.data = null; auth.status = "unauthenticated"; vi.unstubAllGlobals();
                const ro = await st.run("ro");
                expect(ro).toHaveLength(en.length);
                const problems: string[] = [];
                const changed = new Set<number>();
                en.forEach((html, step) => {
                    const changes = textChanges(extract(html), extract(ro[step]));
                    for (const c of changes) {
                        // Every declared spec with this exact pair is credited (two keys may share one).
                        const matching = st.keys.map((s, i) => (render("en", s) === c.from && render("ro", s) === c.to ? i : -1)).filter((i) => i >= 0);
                        if (matching.length === 0) problems.push(`step ${step}: unexplained change ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
                        else matching.forEach((i) => changed.add(i));
                    }
                });
                st.keys.forEach((s, i) => {
                    const label = "key" in s ? s.key : "a formatted value";
                    if (render("en", s) !== render("ro", s)) { if (!changed.has(i)) problems.push(`declared ${label} did not change (${render("en", s)} → ${render("ro", s)})`); }
                    else if (!ro.some((html) => extract(html).some((x) => x.text === render("ro", s)))) problems.push(`declared ${label} (same in RO: ${render("ro", s)}) is not shown`);
                });
                expect(problems).toEqual([]);
            });
        }
    });
}
