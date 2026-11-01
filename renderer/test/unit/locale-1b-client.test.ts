// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveLocaleStrings } from "@amodx/shared";

/**
 * LOCALE-1B — the catalog texts that appear only after an interaction or a client fetch, so never in the server HTML
 * (docs/slices/locale-1.md § 8.5 "client-only states"): the interest toggle, every state of the interest-list page and
 * the search bar's dropdown, mounted with React in jsdom with the EN and the RO table from the real resolver.
 * The expected texts are WRITTEN OUT (§ 6.3: RO = the literal the component held before 1b; EN = the new copy), so a
 * pack value that drifts fails here. Mocked: Next's link/navigation and `fetch` — the component code is real.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/lista-mea", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));

import { InterestToggle, InterestListPage, InterestWidget } from "@/components/InterestShortlist";
import { SearchBar } from "@/components/SearchBar";

const TABLES = {
    EN: resolveLocaleStrings({}).strings,
    RO: resolveLocaleStrings({ locale: "ro-RO" }).strings,
} as const;

/** The expected texts, per table (§ 6.3 "EN default (proposed)" and "Today"). */
const WANT = {
    EN: {
        add: "I'm interested", added: "In my list", full: "Your list already has 50 products. Remove one to add another.",
        title: "My list", empty: "Your list is empty. Press “I'm interested” on the products you like.", browse: "See the products",
        sentTitle: "Your list was sent", sentBody: "Thank you! We received your list and will contact you soon.",
        excluded: "These products were not included because they are no longer available: Old Oak.",
        previously: "Your earlier list was received. The products below were not sent yet.",
        expired: "This product is no longer in the catalog. Choose it again from the current products.",
        unavailable: "This product is not available now and will not be sent.",
        optionGone: "The chosen option is no longer offered. Choose the option again.",
        collection: "Collection Classic", remove: "Remove Oak Plank from the list",
        contact: "Your contact details", name: "Name", email: "E-mail", phone: "Phone", message: "Message", submit: "Send the list",
        noneAvailable: "The list has no available products. Choose the products again.",
        invalid: "Check your details: your name, a valid e-mail address, the phone (at most 40 characters) and the message (at most 2000 characters).",
        check: "We could not check the list now. Try again in a few moments.",
        allGone: "The products in the list are no longer available. Choose the products again.",
        send: "The list could not be sent. Try again.",
        network: "The list could not be sent. Check your connection and try again.",
        searchSearching: "Searching...", searchNoResults: "No products found", viewAllResults: "View all results", searchButton: "Search",
    },
    RO: {
        add: "Mă interesează", added: "În lista mea", full: "Lista are deja 50 de produse. Scoateți un produs ca să adăugați altul.",
        title: "Lista mea", empty: "Lista este goală. Apăsați „Mă interesează” la produsele care vă plac.", browse: "Vedeți produsele",
        sentTitle: "Lista a fost trimisă", sentBody: "Vă mulțumim! Am primit lista dumneavoastră și vă vom contacta în curând.",
        excluded: "Aceste produse nu au fost incluse, pentru că nu mai sunt disponibile: Old Oak.",
        previously: "Lista trimisă anterior a fost primită. Produsele de mai jos nu au fost trimise încă.",
        expired: "Produsul nu mai este în catalog. Alegeți-l din nou din produsele actuale.",
        unavailable: "Produsul nu este disponibil momentan și nu va fi trimis.",
        optionGone: "Varianta aleasă nu mai este oferită. Alegeți din nou varianta dorită.",
        collection: "Colecția Classic", remove: "Scoateți Oak Plank din listă",
        contact: "Datele dumneavoastră de contact", name: "Nume", email: "E-mail", phone: "Telefon", message: "Mesaj", submit: "Trimite lista",
        noneAvailable: "Lista nu are produse disponibile. Alegeți din nou produsele dorite.",
        invalid: "Verificați datele: numele, o adresă de e-mail validă, telefonul (cel mult 40 de caractere) și mesajul (cel mult 2000 de caractere).",
        check: "Nu am putut verifica lista acum. Încercați din nou peste câteva momente.",
        allGone: "Produsele din listă nu mai sunt disponibile. Alegeți din nou produsele dorite.",
        send: "Lista nu a putut fi trimisă. Încercați din nou.",
        network: "Lista nu a putut fi trimisă. Verificați conexiunea și încercați din nou.",
        searchSearching: "Se caută...", searchNoResults: "Nu s-au găsit produse", viewAllResults: "Vezi toate rezultatele", searchButton: "Caută",
    },
} as const;

let root: Root | null = null;
let host: HTMLDivElement;
let tenantSeq = 0;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
function mount(el: React.ReactElement) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(el); });
}
const text = () => (host.textContent ?? "").replace(/\s+/g, " ");
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); }); };
/** A tenant id never used before in this file: the component keeps one store per tenant for the page's lifetime. */
const freshTenant = () => `t-1b-${++tenantSeq}`;
const item = (productId: string, title: string, extra: Record<string, unknown> = {}) => ({ productId, title, slug: productId, addedAt: "2026-10-31T00:00:00.000Z", ...extra });
const store = (tenantId: string, value: object) => localStorage.setItem(`amodx:interest:${tenantId}`, JSON.stringify(value));
const toggleStrings = (c: (typeof TABLES)["EN"]["catalog"]) => ({ interestAdd: c.interestAdd, interestAdded: c.interestAdded, interestListFull: c.interestListFull });
const listStrings = (c: (typeof TABLES)["EN"]["catalog"]) => ({
    interestListTitle: c.interestListTitle, interestBrowse: c.interestBrowse, interestSentTitle: c.interestSentTitle,
    interestSentBody: c.interestSentBody, interestExcludedIntro: c.interestExcludedIntro, interestEmpty: c.interestEmpty,
    interestAdd: c.interestAdd, interestErrorNoneAvailable: c.interestErrorNoneAvailable, interestErrorInvalid: c.interestErrorInvalid,
    interestErrorCheck: c.interestErrorCheck, interestErrorAllGone: c.interestErrorAllGone, interestErrorSend: c.interestErrorSend,
    interestErrorNetwork: c.interestErrorNetwork, interestPreviouslySent: c.interestPreviouslySent,
    interestContactHeading: c.interestContactHeading, interestName: c.interestName, interestEmail: c.interestEmail,
    interestPhone: c.interestPhone, interestMessage: c.interestMessage, interestSubmit: c.interestSubmit,
    interestRowExpired: c.interestRowExpired, interestRowUnavailable: c.interestRowUnavailable,
    interestRowOptionGone: c.interestRowOptionGone, interestCollection: c.interestCollection, interestRemove: c.interestRemove,
});
const listPage = (tenantId: string, c: (typeof TABLES)["EN"]["catalog"]) =>
    createElement(InterestListPage, { tenantId, apiUrl: "https://api.test", productPrefix: "/product", shopPrefix: "/shop", contentMaxWidth: "max-w-4xl", strings: listStrings(c) });

/** `fetch` answering the resolve call with `products`, and the submission with `submit` (a Response-like or a throw). */
function stubFetch(products: object[], submit?: { status: number; body: object } | "throw") {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (url.endsWith("/public/interest/resolve")) return { ok: true, status: 200, json: async () => ({ products }) };
        if (submit === "throw") throw new TypeError("network down");
        return { ok: submit!.status < 300, status: submit!.status, json: async () => submit!.body };
    }));
}
/** Types into a React-controlled input (the native setter, then an input event). */
function type(selector: string, value: string) {
    const el = host.querySelector<HTMLInputElement>(selector)!;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
    act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function submit() {
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
}
const ACTIVE = (productId: string, extra: Record<string, unknown> = {}) => ({ productId, status: "active", title: productId, slug: productId, optionValues: [], ...extra });

for (const name of ["EN", "RO"] as const) {
    const c = TABLES[name].catalog;
    const want = WANT[name];

    describe(`[1b-client] ${name} interest toggle`, () => {
        it(`[1b-client] ${name} toggle: interestAdd, then interestAdded after a click`, () => {
            mount(createElement(InterestToggle, { tenantId: freshTenant(), productId: "p1", title: "Oak", slug: "oak", strings: toggleStrings(c) }));
            expect(host.querySelector("button")!.textContent).toBe(want.add);
            act(() => host.querySelector("button")!.click());
            expect(host.querySelector("button")!.textContent).toBe(want.added);
        });

        it(`[1b-client] ${name} toggle: a full list (50 items) shows interestListFull`, () => {
            const tenantId = freshTenant();
            store(tenantId, { items: Array.from({ length: 50 }, (_, i) => item(`x${i}`, `X${i}`)) });
            mount(createElement(InterestToggle, { tenantId, productId: "p51", title: "One more", slug: "one-more", strings: toggleStrings(c) }));
            act(() => host.querySelector("button")!.click());
            expect(host.querySelector("[role=status]")!.textContent).toBe(want.full);
        });
    });

    describe(`[1b-client] ${name} interest list page`, () => {
        it(`[1b-client] ${name} list page empty: interestListTitle, interestEmpty with {action} = interestAdd, interestBrowse`, async () => {
            mount(listPage(freshTenant(), c));
            await flush();
            expect(host.querySelector("h1")!.textContent).toBe(want.title);
            expect(text()).toContain(want.empty);
            expect(host.querySelector('a[href="/shop"]')!.textContent).toBe(want.browse);
        });

        it(`[1b-client] ${name} list page sent: interestSentTitle, interestSentBody, interestExcludedIntro`, async () => {
            const tenantId = freshTenant();
            store(tenantId, { items: [], sent: { submissionId: "s1", droppedTitles: ["Old Oak"] } });
            mount(listPage(tenantId, c));
            await flush();
            expect(host.querySelector("h1")!.textContent).toBe(want.sentTitle);
            expect(text()).toContain(want.sentBody);
            expect(host.querySelector("[data-interest-not-included]")!.textContent!.replace(/\s+/g, " ").trim()).toBe(want.excluded);
        });

        it(`[1b-client] ${name} list page rows: interestRowExpired, interestRowUnavailable, interestRowOptionGone, interestCollection, interestRemove, interestPreviouslySent, the form labels and interestSubmit`, async () => {
            const tenantId = freshTenant();
            store(tenantId, {
                items: [item("a", "Oak Plank"), item("b", "Ash"), item("c", "Elm", { optionValue: "120" }), item("d", "Pine")],
                sent: { submissionId: "s0", droppedTitles: [] },
            });
            stubFetch([{ productId: "a", status: "absent" }, { productId: "b", status: "not-available" }, ACTIVE("c", { collection: "Classic" }), ACTIVE("d")]);
            mount(listPage(tenantId, c));
            await flush();
            const row = (id: string) => host.querySelector(`[data-interest-item="${id}"]`)!;
            expect(row("a").textContent).toContain(want.expired);
            expect(row("b").textContent).toContain(want.unavailable);
            expect(row("c").textContent).toContain(want.optionGone);
            expect(row("c").querySelector("[data-interest-collection]")!.textContent).toBe(want.collection);
            expect(row("a").querySelector("button")!.getAttribute("aria-label")).toBe(want.remove);
            expect(host.querySelector("[data-interest-previous-sent]")!.textContent).toBe(want.previously);
            expect(host.querySelector("h2")!.textContent).toBe(want.contact);
            const labels = [...host.querySelectorAll("label")].map((l) => l.firstChild!.textContent);
            expect(labels).toEqual([want.name, want.email, want.phone, want.message]);
            expect(host.querySelector('button[type="submit"]')!.textContent).toBe(want.submit);
        });

        it(`[1b-client] ${name} list page errors: interestErrorNoneAvailable (nothing sendable), interestErrorInvalid (bad e-mail)`, async () => {
            const gone = freshTenant();
            store(gone, { items: [item("a", "Oak")] });
            stubFetch([{ productId: "a", status: "absent" }]);
            mount(listPage(gone, c));
            await flush();
            await submit();
            expect(host.querySelector("[role=alert]")!.textContent).toBe(want.noneAvailable);
            act(() => root?.unmount());

            const invalid = freshTenant();
            store(invalid, { items: [item("d", "Pine")] });
            stubFetch([ACTIVE("d")]);
            mount(listPage(invalid, c));
            await flush();
            type("#interest-name", "Ana");
            type("#interest-email", "not-an-email");
            await submit();
            expect(host.querySelector("[role=alert]")!.textContent).toBe(want.invalid);
        });

        for (const [label, answer, key] of [
            ["503 → interestErrorCheck", { status: 503, body: {} }, "check"],
            ["400 with dropped → interestErrorAllGone", { status: 400, body: { dropped: ["d"] } }, "allGone"],
            ["500 → interestErrorSend", { status: 500, body: {} }, "send"],
            ["a network failure → interestErrorNetwork", "throw", "network"],
        ] as const) {
            it(`[1b-client] ${name} list page send: ${label}`, async () => {
                const tenantId = freshTenant();
                store(tenantId, { items: [item("d", "Pine")] });
                stubFetch([ACTIVE("d")], answer);
                mount(listPage(tenantId, c));
                await flush();
                type("#interest-name", "Ana");
                type("#interest-email", "ana@example.test");
                await submit();
                expect(host.querySelector("[role=alert]")!.textContent).toBe(want[key]);
            });
        }
    });

    describe(`[1b-client] ${name} search bar dropdown`, () => {
        it(`[1b-client] ${name} search bar: the four labels it is given — button, no results, searching, view all results`, async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const s = TABLES[name].commerce;
            const answers: ((v: object) => void)[] = [];
            vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => answers.push((body) => resolve({ ok: true, json: async () => body })))));
            mount(createElement(SearchBar, {
                placeholder: "p", tenantId: "t", apiUrl: "https://api.test",
                labels: { searchButton: s.searchButton, searchNoResults: s.searchNoResults, searchSearching: s.searchSearching, viewAllResults: s.viewAllResults },
            }));
            expect(host.querySelector('button[type="submit"]')!.textContent).toBe(want.searchButton);
            type("input", "oak");
            await act(async () => { vi.advanceTimersByTime(2000); });
            await act(async () => { answers.shift()!({ items: [] }); });
            expect(text()).toContain(want.searchNoResults);                  // the dropdown is open, no result
            type("input", "oak plank");
            await act(async () => { vi.advanceTimersByTime(2000); });
            expect(text()).toContain(want.searchSearching);                  // a second search while the dropdown is open
            await act(async () => { answers.shift()!({ items: [{ id: "1", title: "Oak Plank", slug: "oak-plank", currency: "USD" }] }); });
            expect(text()).toContain(want.viewAllResults);
        });
    });
}

// ── LOCALE1B-WIDGET: the header widget (texts from the layout through Navbar) ──────────────────────────────────────
const WIDGET_WANT = {
    EN: { title: "My list", labels: ["My list: 0 products", "My list: 1 product", "My list: 2 products", "My list: 20 products"],
        warning: "This browser cannot save the list. We keep it while this page stays open.", ack: "Got it" },
    RO: { title: "Lista mea", labels: ["Lista mea: 0 produse", "Lista mea: 1 produs", "Lista mea: 2 produse", "Lista mea: 20 de produse"],
        warning: "Lista nu poate fi salvată în acest browser; o păstrăm cât timp pagina rămâne deschisă.", ack: "Am înțeles" },
} as const;
const widgetStrings = (c: (typeof TABLES)["EN"]["catalog"]) => ({
    interestListTitle: c.interestListTitle, interestWidgetLabel: c.interestWidgetLabel,
    interestStorageWarning: c.interestStorageWarning, interestStorageAck: c.interestStorageAck,
});

for (const name of ["EN", "RO"] as const) {
    const c = TABLES[name].catalog;
    const want = WIDGET_WANT[name];
    describe(`[1b-client] ${name} header widget`, () => {
        it(`[1b-client] ${name} widget: interestListTitle, and interestWidgetLabel (aria-label) for 0, 1, 2 and 20 items — each plural category`, () => {
            [0, 1, 2, 20].forEach((n, i) => {
                const tenantId = freshTenant();
                if (n > 0) store(tenantId, { items: Array.from({ length: n }, (_, k) => item(`w${k}`, `W${k}`)) });
                mount(createElement(InterestWidget, { tenantId, listPrefix: "/lista-mea", strings: widgetStrings(c) }));
                const link = host.querySelector("[data-interest-widget]")!;
                expect(link.getAttribute("aria-label")).toBe(want.labels[i]);
                expect(link.querySelector("span.text-sm")!.textContent).toBe(want.title);
                act(() => root?.unmount());
                root = null;
                document.body.innerHTML = "";
            });
        });

        it(`[1b-client] ${name} widget: storage fails → interestStorageWarning with the interestStorageAck button, which hides the notice`, () => {
            const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
            try {
                mount(createElement(InterestWidget, { tenantId: freshTenant(), listPrefix: "/lista-mea", strings: widgetStrings(c) }));
                const notice = host.querySelector("[role=status]")!;
                expect(notice.firstChild!.textContent).toBe(want.warning);
                const ack = notice.querySelector("button")!;
                expect(ack.textContent).toBe(want.ack);
                act(() => ack.click());
                expect(host.querySelector("[role=status]")).toBeNull();
            } finally {
                spy.mockRestore();
            }
        });
    });
}
