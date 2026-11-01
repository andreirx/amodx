// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, writeFileSync } from "node:fs";
import { getCountryPack, resolveLocaleStrings } from "@amodx/shared";
import { BEFORE_FILE, FREE_TEXT, withFreeText, type Snapshot, type StateName } from "./cmrc-counties-1-fields";

/**
 * CMRC-COUNTIES-1 (docs/slices/cmrc-counties-1.md) — the county field of the checkout form, shipping and billing, with a
 * product in the cart (the serving fixtures never reach this state: the cart lives in localStorage, so the server
 * renders "Your cart is empty"). Real: `CheckoutPageView`. Mocked: the cart hook (one item), Next's router, NextAuth,
 * the tenant URL hook, reCAPTCHA and the FB pixel — none of them shapes the county field.
 *
 * Oracle for "today's markup": `cmrc-counties-1-before.json`, rendered by THIS file from commit 959f288 (capture mode,
 * procedure in the record § 3). Each state is rendered twice: as mounted (billing = shipping) and with
 * "use same address for billing" unchecked (the billing county field shown).
 */

vi.mock("@/context/CartContext", () => ({
    useCart: () => ({
        items: [{ productId: "p1", productTitle: "Rug", productSlug: "rug", productImage: "", quantity: 1, unitPrice: 10, currency: "USD", personalizations: [] }],
        subtotal: 10, clearCart: () => {}, coupon: null,
    }),
}));
vi.mock("@/lib/routing", () => ({ useTenantUrl: () => ({ getUrl: (p: string) => p }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/lib/fbpixel", () => ({ trackFBEvent: () => {} }));
vi.mock("@/hooks/useRecaptcha", () => ({ useRecaptcha: () => ({ execute: async () => null }) }));

import { CheckoutPageView } from "@/components/CheckoutPageView";

const RO_REGIONS = getCountryPack("RO").address.regions.map((r) => r.name);
/** LOCALE-1D: the English texts the view receives (the EN table; the former English-defaults export is gone). */
const EN = resolveLocaleStrings({}).strings;
const EN_TEXT = EN.commerce;
const CHECKOUT_STRINGS = { ...EN.commerce, errorTryAgain: EN.site.errorTryAgain };
const CONFIGURED = ["Cluj", "Ilfov"];
/** The prop sets of the states; `apiUrl: ""` keeps the delivery-date fetch off. */
const STATES: Record<StateName, { availableCounties: string[]; defaultRegions: string[] }> = {
    "ro-regions": { availableCounties: [], defaultRegions: RO_REGIONS },          // today's checkout of EVERY tenant without counties
    "configured-ro": { availableCounties: CONFIGURED, defaultRegions: RO_REGIONS },
    "configured-en": { availableCounties: CONFIGURED, defaultRegions: [] },
    "no-list": { availableCounties: [], defaultRegions: [] },                    // country without regions, no configured counties
};

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

function mountState(name: StateName) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
        root = createRoot(host);
        root.render(createElement(CheckoutPageView, {
            tenantId: "t1", apiUrl: "", confirmPrefix: "/checkout/confirm", cartPrefix: "/cart", freeDeliveryThreshold: 0, flatShippingCost: 0,
            currency: "USD", strings: CHECKOUT_STRINGS, ...STATES[name],
        }));
    });
}
const sameAsShippingBox = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => i.parentElement?.textContent?.includes(EN_TEXT.useSameAsShipping))!;
/** The county fields of a form: the element after each `County *` label (shipping first, billing second). */
function countyFieldsIn(el: Element) {
    return [...el.querySelectorAll("label")].filter((l) => l.textContent === `${EN_TEXT.county} *`).map((l) => l.nextElementSibling!);
}

function render(name: StateName): Snapshot {
    mountState(name);
    const mounted = host.innerHTML;
    act(() => { sameAsShippingBox().click(); });
    const out = { mounted, billingShown: host.innerHTML };
    act(() => root?.unmount()); root = null; document.body.innerHTML = "";
    return out;
}

const CAPTURE = process.env.CMRC_COUNTIES_1_CAPTURE;

if (CAPTURE) {
    // Capture mode (run once against 959f288, record § 3): write today's markup of every state; assert nothing else.
    describe("[cmrc-counties-1] capture", () => {
        it("writes the markup of every state", () => {
            const states = Object.fromEntries((Object.keys(STATES) as StateName[]).map((n) => [n, render(n)]));
            writeFileSync(CAPTURE, JSON.stringify({ commit: process.env.CMRC_COUNTIES_1_COMMIT ?? "", states }, null, 2) + "\n");
        });
    });
} else {
    const before: { commit: string; states: Record<StateName, Snapshot> } = JSON.parse(readFileSync(BEFORE_FILE, "utf8"));
    const countyFields = (html: string) => {
        const div = document.createElement("div");
        div.innerHTML = html;
        return countyFieldsIn(div);
    };
    const type = (el: HTMLInputElement, v: string) => act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    describe("[cmrc-counties-1] county field of the checkout form", () => {
        it("the before oracle is the 959f288 capture and today's RO select is the 42-county list", () => {
            expect(before.commit).toBe("959f288");
            const [shipping, billing] = countyFields(before.states["ro-regions"].billingShown);
            for (const field of [shipping, billing]) {
                expect(field.tagName).toBe("SELECT");
                expect([...field.querySelectorAll("option")].map((o) => o.textContent)).toEqual([EN_TEXT.selectCounty, ...RO_REGIONS]);
            }
            expect(RO_REGIONS).toHaveLength(42);
        });

        for (const name of ["ro-regions", "configured-ro", "configured-en"] as const) {
            it(`${name}: a non-empty list → today's <select> exactly (whole form byte-identical to 959f288, shipping and billing)`, () => {
                const now = render(name);
                expect(now.mounted).toBe(before.states[name].mounted);
                expect(now.billingShown).toBe(before.states[name].billingShown);
            });
        }

        it("configured counties win over the country's regions (configured-ro = configured-en), shipping and billing", () => {
            const fields = countyFields(render("configured-ro").billingShown);
            expect(fields).toHaveLength(2);
            for (const f of fields) expect([...f.querySelectorAll("option")].map((o) => o.value)).toEqual(["", ...CONFIGURED]);
            expect(render("configured-en").billingShown).toBe(render("configured-ro").billingShown);
        });

        it("no-list (country without regions — EN or absent — and no configured counties): both fields are a required free-text input, same label, same form fields `county` / `billingCounty`", async () => {
            const fields = countyFields(render("no-list").billingShown);
            expect(fields.map((f) => f.outerHTML)).toEqual([FREE_TEXT, FREE_TEXT]);
            // The typed texts are what the form submits (POST /public/orders body): shipping `county`, billing `billingCounty`.
            const posted: any[] = [];
            vi.stubGlobal("fetch", async (_url: string, init: any) => { posted.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "o1" }), { status: 200 }); });
            mountState("no-list");
            act(() => { sameAsShippingBox().click(); });
            const [shipping, billing] = countyFieldsIn(host) as HTMLInputElement[];
            type(shipping, "Texas");
            type(billing, "Travis County");
            await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
            vi.unstubAllGlobals();
            expect(posted).toHaveLength(1);
            expect(posted[0].shippingAddress.county).toBe("Texas");
            expect(posted[0].billingDetails.billingCounty).toBe("Travis County");
        });

        it("L-EN-COUNTIES markup: today's page of an en-US shop (ro-regions, 959f288) with each county <select> replaced by the free-text input is exactly the page now (no-list); the text items are checked on this same function in cmrc-counties-1-site-page.test.ts", () => {
            for (const view of ["mounted", "billingShown"] as const) {
                const was = before.states["ro-regions"][view];
                expect(countyFields(was).map((f) => f.tagName)).toEqual(view === "mounted" ? ["SELECT"] : ["SELECT", "SELECT"]);
                expect(render("no-list")[view]).toBe(withFreeText(was));
            }
        });
    });
}
