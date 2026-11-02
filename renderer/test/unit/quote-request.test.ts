// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveLocaleStrings, type ContactChannels } from "@amodx/shared";
import { QuoteRequest, quoteActions, quoteMessage, type QuoteRequestStrings } from "@/components/QuoteRequest";
import { InterestToggle } from "@/components/InterestShortlist";

/**
 * CAT-QUOTE-1 (docs/slices/cat-quote-1.md § 3 items 2 and 3; packet rules 3, 5 and 7 "jsdom") — the "Request a quote"
 * button and dialog, and the low-key interest link. The real components, mounted with React in jsdom (no Next, no
 * server). The texts are the tenant table's catalog keys as the server passes them (EN and RO packs, resolved).
 */

const quoteStrings = (locale?: string): QuoteRequestStrings => {
    const c = resolveLocaleStrings(locale ? { locale } : {}).strings.catalog;
    return { quoteButton: c.quoteButton, quoteTitle: c.quoteTitle, quoteCall: c.quoteCall, quoteWhatsApp: c.quoteWhatsApp, quoteEmail: c.quoteEmail, quoteMessage: c.quoteMessage, quoteClose: c.quoteClose };
};
const RO = quoteStrings("ro-RO");
const EN = quoteStrings();
const ALL: ContactChannels = { phone: "+40 721-000 111", whatsapp: "+40 721 000 111", email: "office@glam.test" };
const URL_A = "https://glam.test/product/stejar-mixt";
const GROUP = "catalog-option-format";

let root: Root | null = null;
let host: HTMLDivElement;

/**
 * jsdom 28 has `HTMLDialogElement` but no `showModal`/`close` (ruling R2 option a: stubbed here, test-only). The stub
 * does what the platform does for the component: `showModal` sets `open`; `close` clears it and fires `close`.
 * Containment and the inert background are the browser's and are not claimed by these rows.
 */
beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
        if (!this.hasAttribute("open")) return;
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
    };
});
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
});

/** The presenter's radio group as SitePage renders it. */
function presenter(values: string[], checked?: string) {
    const group = document.createElement("fieldset");
    for (const v of values) {
        const input = document.createElement("input");
        input.type = "radio";
        input.name = GROUP;
        input.value = v;
        input.checked = v === checked;
        group.appendChild(input);
    }
    document.body.prepend(group);
}
function mount(element: ReturnType<typeof createElement>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(element); });
}
const quote = (over: Partial<Parameters<typeof QuoteRequest>[0]> = {}) =>
    createElement(QuoteRequest, { channels: ALL, productTitle: "Stejar Mixt", productUrl: URL_A, optionGroupName: GROUP, strings: RO, ...over });
const button = () => host.querySelector<HTMLButtonElement>("button[data-quote-request]")!;
/** The open dialog, or null (the closed `<dialog>` is always in the markup). */
const dialog = () => host.querySelector<HTMLDialogElement>("dialog[open]");
const closedDialog = () => host.querySelector<HTMLDialogElement>("dialog")!;
const actions = () => [...host.querySelectorAll<HTMLAnchorElement>("a[data-quote-action]")].map((a) => ({ kind: a.dataset.quoteAction, text: a.textContent, href: a.getAttribute("href") }));
/** A key pressed on the focused element (inside the dialog when it is open). */
const key = (k: string) => act(() => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

describe("QuoteRequest — texts, links, keyboard", () => {
    it("RO texts: the button, the dialog title, the three actions (WhatsApp as the brand name) and close, in Romanian", () => {
        mount(quote());
        expect(button().textContent).toBe("Cere ofertă");
        expect(dialog()).toBeNull();
        expect(closedDialog().querySelector("h2")!.textContent).toBe("Cere-ne o ofertă");   // in the markup, closed
        act(() => button().click());
        expect(dialog()!.querySelector("h2")!.textContent).toBe("Cere-ne o ofertă");
        expect(dialog()!.getAttribute("aria-labelledby")).toBe(dialog()!.querySelector("h2")!.id);
        expect(actions().map((a) => a.text)).toEqual(["Sună-ne", "WhatsApp", "Trimite un e-mail"]);
        expect([...dialog()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Închide"]);
    });

    it("EN texts: the English pack values", () => {
        mount(quote({ strings: EN }));
        expect(button().textContent).toBe("Request a quote");
        act(() => button().click());
        expect(dialog()!.querySelector("h2")!.textContent).toBe("Ask us for a quote");
        expect(actions().map((a) => a.text)).toEqual(["Call us", "WhatsApp", "Send an e-mail"]);
    });

    it("the hrefs: tel: without spaces, wa.me with the digits and the message, mailto with subject = title and body = the message — with a chosen variant", () => {
        presenter(["Natur", "Rustic"], "Rustic");
        mount(quote());
        act(() => button().click());
        const msg = `Bună! Aș vrea o ofertă pentru Stejar Mixt, varianta Rustic: ${URL_A}`;
        expect(actions()).toEqual([
            { kind: "call", text: "Sună-ne", href: "tel:+40721-000111" },
            { kind: "whatsapp", text: "WhatsApp", href: `https://wa.me/40721000111?text=${encodeURIComponent(msg)}` },
            { kind: "email", text: "Trimite un e-mail", href: `mailto:office@glam.test?subject=${encodeURIComponent("Stejar Mixt")}&body=${encodeURIComponent(msg)}` },
        ]);
        expect(host.querySelector('a[data-quote-action="whatsapp"]')!.getAttribute("target")).toBe("_blank");
        expect(host.querySelector('a[data-quote-action="whatsapp"]')!.getAttribute("rel")).toBe("noopener noreferrer");
        // No price, no code: the message holds exactly the title, the variant and the URL.
        expect(decodeURIComponent(actions()[1].href!.split("?text=")[1])).toBe(msg);
    });

    it("the message without a variant: nothing checked, or a product without options → the variant segment is dropped", () => {
        presenter(["Natur", "Rustic"]);
        mount(quote());
        act(() => button().click());
        const msg = `Bună! Aș vrea o ofertă pentru Stejar Mixt: ${URL_A}`;
        expect(actions()[1].href).toBe(`https://wa.me/40721000111?text=${encodeURIComponent(msg)}`);
        act(() => root!.render(quote({ optionGroupName: undefined, strings: EN })));
        expect(decodeURIComponent(actions()[2].href!.split("&body=")[1])).toBe(`Hello! I would like a quote for Stejar Mixt: ${URL_A}`);
    });

    it("REGRESSION (review-0 R2): a radio changed while the dialog is open → the three links follow it", () => {
        presenter(["Natur", "Rustic"], "Natur");
        mount(quote());
        act(() => button().click());
        expect(decodeURIComponent(actions()[1].href!.split("?text=")[1])).toContain(", varianta Natur:");
        const rustic = document.querySelector<HTMLInputElement>('input[value="Rustic"]')!;
        act(() => { rustic.checked = true; rustic.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(dialog()).not.toBeNull();
        const msg = `Bună! Aș vrea o ofertă pentru Stejar Mixt, varianta Rustic: ${URL_A}`;
        expect(actions().map((a) => a.href)).toEqual([
            "tel:+40721-000111",
            `https://wa.me/40721000111?text=${encodeURIComponent(msg)}`,
            `mailto:office@glam.test?subject=${encodeURIComponent("Stejar Mixt")}&body=${encodeURIComponent(msg)}`,
        ]);
        // A change of ANOTHER radio group is not the presenter's: ignored.
        const other = document.createElement("input");
        other.type = "radio"; other.name = "something-else"; other.value = "X"; document.body.appendChild(other);
        act(() => { other.checked = true; other.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(decodeURIComponent(actions()[1].href!.split("?text=")[1])).toBe(msg);
    });

    it("the variant is read when the dialog opens: a choice changed after a close is in the next message", () => {
        presenter(["Natur", "Rustic"], "Natur");
        mount(quote({ strings: EN }));
        act(() => button().click());
        expect(decodeURIComponent(actions()[1].href!.split("?text=")[1])).toContain(", option Natur:");
        key("Escape");
        (document.querySelector<HTMLInputElement>(`input[value="Rustic"]`)!).checked = true;
        act(() => button().click());
        expect(decodeURIComponent(actions()[1].href!.split("?text=")[1])).toContain(", option Rustic:");
    });

    it("keyboard: open moves focus to the first action; Escape closes and returns focus to the button; so do Close and the backdrop", () => {
        mount(quote());
        act(() => button().click());
        expect(dialog()!.tagName).toBe("DIALOG");
        expect(button().getAttribute("aria-expanded")).toBe("true");
        expect(document.activeElement).toBe(host.querySelector('a[data-quote-action="call"]'));
        key("Escape");
        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(button());
        expect(button().getAttribute("aria-expanded")).toBe("false");

        act(() => button().click());
        act(() => [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Închide")!.click());
        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(button());

        act(() => button().click());
        act(() => { dialog()!.click(); });                                         // the backdrop: a click whose target is the <dialog>
        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(button());

        act(() => button().click());
        act(() => { dialog()!.querySelector("h2")!.click(); });                    // inside the panel: stays open
        expect(dialog()).not.toBeNull();
        key("Enter");
        expect(dialog()).not.toBeNull();
    });

    it("channels: e-mail only → one action; none → nothing rendered", () => {
        mount(quote({ channels: { email: "office@glam.test" } }));
        act(() => button().click());
        expect(actions().map((a) => a.kind)).toEqual(["email"]);
        act(() => root!.render(quote({ channels: {} })));
        expect(host.innerHTML).toBe("");
    });
});

describe("quoteMessage / quoteActions (pure)", () => {
    it("only a […] segment that holds {variant} is conditional; other brackets and a title's brackets stay as written", () => {
        const t = "[Promo] {product}[ ({variant})] — {url}";
        expect(quoteMessage(t, { product: "Lemn [X]", url: "u" })).toBe("[Promo] Lemn [X] — u");
        expect(quoteMessage(t, { product: "Lemn [X]", variant: "Doi", url: "u" })).toBe("[Promo] Lemn [X] (Doi) — u");
        // A tenant template without the segment: {variant} becomes the option, or nothing.
        expect(quoteMessage("{product} {variant}", { product: "P", url: "u" })).toBe("P ");
        // A value is never read as a placeholder or a segment.
        expect(quoteMessage("{product}[, {variant}]", { product: "{url}", variant: "[{product}]", url: "u" })).toBe("{url}, [{product}]");
    });

    it("quoteActions: the order Call, WhatsApp, E-mail; a missing channel has no action", () => {
        expect(quoteActions({ whatsapp: "07-21", phone: "0721 000" }, "m", "s")).toEqual([
            { kind: "call", href: "tel:0721000" },
            { kind: "whatsapp", href: "https://wa.me/0721?text=m" },
        ]);
        expect(quoteActions({}, "m", "s")).toEqual([]);
        expect(quoteActions({ email: "a@b.test" }, "a b&c", "x?y")).toEqual([{ kind: "email", href: "mailto:a@b.test?subject=x%3Fy&body=a%20b%26c" }]);
    });
});

describe("InterestToggle variant=\"link\" (CAT-QUOTE-1 § 3 item 3)", () => {
    const RO_TOGGLE = (() => {
        const c = resolveLocaleStrings({ locale: "ro-RO" }).strings.catalog;
        return { interestAdd: c.interestAdd, interestAdded: c.interestAdded, interestListFull: c.interestListFull };
    })();
    const props = { tenantId: "t-link", productId: "p", title: "Stejar Mixt", slug: "stejar-mixt", optionGroupName: GROUP, options: [], strings: RO_TOGGLE };

    it("a text link with the page variant's behaviour: the chosen option in the label, marks and unmarks the product with it", () => {
        presenter(["Natur", "Rustic"], "Rustic");
        mount(createElement(InterestToggle, { ...props, variant: "link" as const }));
        const b = host.querySelector<HTMLButtonElement>("button[data-interest-toggle]")!;
        expect(b.className).toContain("underline");
        expect(b.className).not.toContain("border");
        expect(b.textContent).toBe("Mă interesează (Rustic)");
        act(() => b.click());
        expect(b.getAttribute("aria-pressed")).toBe("true");
        expect(b.textContent).toBe("În lista mea");
        expect(JSON.parse(localStorage.getItem("amodx:interest:t-link")!).items).toEqual([expect.objectContaining({ productId: "p", optionValue: "Rustic" })]);
        act(() => b.click());
        expect(JSON.parse(localStorage.getItem("amodx:interest:t-link")!).items).toEqual([]);
    });

    it("the card variant is unchanged (bordered, no option in the label)", () => {
        presenter(["Natur"], "Natur");
        mount(createElement(InterestToggle, { ...props, variant: "card" as const }));
        const b = host.querySelector<HTMLButtonElement>("button[data-interest-toggle]")!;
        expect(b.className).toContain("rounded-md border");
        expect(b.textContent).toBe("Mă interesează");
    });
});
