// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveLocaleStrings, RO_PACK } from "@amodx/shared";

/**
 * LOCALE-1A — texts that appear only after an interaction or a client fetch, so never in the server HTML
 * (docs/slices/locale-1.md § 8.5 "client-only states"): each 1a component mounted with React in jsdom (the pattern
 * of interest-toggle.test.ts), with the EN and the RO table from the real resolver, and each state driven.
 * Mocked: Next's link/navigation, NextAuth's session hooks, and `fetch` — the component code is real.
 */

const session = vi.hoisted(() => ({ data: null as null | object, signIn: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: session.data }), signIn: session.signIn }));
vi.mock("next/navigation", () => ({ usePathname: () => "/blog/post" }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));

import { Navbar } from "@/components/Navbar";
import { CommentsSection } from "@/components/CommentsSection";
import { SocialShare } from "@/components/SocialShare";
import { QuickContact } from "@/components/QuickContact";
import { DynamicForm } from "@/components/DynamicForm";
import { CookieConsent } from "@/components/CookieConsent";

const EN = resolveLocaleStrings({}).strings.site;
const RO = resolveLocaleStrings({ locale: "ro-RO" }).strings.site;
const TABLES = [["EN", EN], ["RO", RO]] as const;

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
    session.data = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
function mount(el: React.ReactElement) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(el); });
}
const text = () => host.textContent ?? "";
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
const buttonByText = (t: string) => [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === t)!;

const navStrings = (s: typeof EN) => ({ navAllOf: s.navAllOf, navContact: s.navContact, navToggleMenu: s.navToggleMenu, navViewAll: s.navViewAll, navContactUs: s.navContactUs });
const LINKS = [{ label: "Services", href: "/services", children: [{ label: "Design", href: "/design" }] }];

describe("[1a-client] Navbar", () => {
    for (const [name, s] of TABLES) {
        it(`[1a-client] ${name}: dropdown open → navAllOf; mobile menu open → navViewAll and navContactUs; aria-label navToggleMenu`, () => {
            mount(createElement(Navbar, { siteName: "Site", links: LINKS, strings: navStrings(s) }));
            expect(host.querySelector("button[aria-label]")!.getAttribute("aria-label")).toBe(s.navToggleMenu);
            expect(text()).toContain(s.navContact);
            click(buttonByText("Services"));                                      // desktop dropdown
            expect(text()).toContain(name === "EN" ? "Services (All)" : "Services (toate)");
            click(buttonByText("Services"));                                      // close it again
            click(host.querySelector("button[aria-label]")!);                     // mobile menu
            expect(text()).toContain(s.navContactUs);
            const mobileServices = [...host.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "Services").at(-1)!;
            click(mobileServices);
            expect(text()).toContain(s.navViewAll);
        });
    }
});

describe("[1a-client] CommentsSection", () => {
    const commentStrings = (s: typeof EN) => ({
        commentsPostFailed: s.commentsPostFailed, commentsHeading: s.commentsHeading, commentsEmpty: s.commentsEmpty, commentsClosed: s.commentsClosed,
        commentsPlaceholder: s.commentsPlaceholder, commentsPost: s.commentsPost, commentsJoin: s.commentsJoin, commentsSignIn: s.commentsSignIn,
    });
    const CREATED = "2026-10-31T12:00:00.000Z";
    const listFetch = () => vi.fn(async () => ({
        ok: true, headers: { get: () => "application/json" },
        json: async () => ({ items: [{ id: "c1", authorName: "Ana", content: "Bravo", createdAt: CREATED }] }),
    }));

    it("[1a-client] EN tenant: fetched list → heading with count; the date uses the runtime default (dateLocale absent, unchanged)", async () => {
        vi.stubGlobal("fetch", listFetch());
        mount(createElement(CommentsSection, { pageId: "p", mode: "Enabled", strings: commentStrings(EN) }));
        await flush();
        expect(text()).toContain("Discussion (1)");
        expect(text()).toContain(new Date(CREATED).toLocaleDateString());
    });

    it("[1a-client] RO tenant: heading in Romanian; the date uses the tenant locale ro-RO", async () => {
        vi.stubGlobal("fetch", listFetch());
        mount(createElement(CommentsSection, { pageId: "p", mode: "Enabled", strings: commentStrings(RO), dateLocale: "ro-RO" }));
        await flush();
        expect(text()).toContain("Discuție (1)");
        expect(text()).toContain(new Date(CREATED).toLocaleDateString("ro-RO"));
    });

    for (const [name, s] of TABLES) {
        it(`[1a-client] ${name}: empty list, locked thread (leading space kept), signed-out join and sign-in`, async () => {
            vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: { get: () => "application/json" }, json: async () => ({ items: [] }) })));
            mount(createElement(CommentsSection, { pageId: "p", mode: "Locked", strings: commentStrings(s) }));
            await flush();
            expect(text()).toContain(s.commentsEmpty);
            expect(host.querySelector(".bg-muted\\/50")!.textContent).toBe(" " + s.commentsClosed);
            act(() => root!.render(createElement(CommentsSection, { pageId: "p", mode: "Enabled", strings: commentStrings(s) })));
            expect(text()).toContain(s.commentsJoin);
            expect(text()).toContain(s.commentsSignIn);
        });

        it(`[1a-client] ${name}: signed in → placeholder and Post; a failed post → the commentsPostFailed alert`, async () => {
            session.data = { user: { name: "Ana", image: "" } };
            const fetchMock = vi.fn(async (_url: string, init?: any) => {
                if (init?.method === "POST") throw new TypeError("network");
                return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ items: [] }) };
            });
            vi.stubGlobal("fetch", fetchMock);
            const alert = vi.fn();
            vi.stubGlobal("alert", alert);
            mount(createElement(CommentsSection, { pageId: "p", mode: "Enabled", strings: commentStrings(s) }));
            await flush();
            const textarea = host.querySelector("textarea")!;
            expect(textarea.getAttribute("placeholder")).toBe(s.commentsPlaceholder);
            const post = host.querySelector("form button")!;
            expect(post.textContent).toBe(" " + s.commentsPost);
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
            act(() => { setter.call(textarea, "Hello"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
            await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
            await flush();
            expect(alert).toHaveBeenCalledWith(s.commentsPostFailed);
        });
    }
});

describe("[1a-client] SocialShare", () => {
    for (const [name, s] of TABLES) {
        it(`[1a-client] ${name}: label and the five button titles (rendered in the browser only)`, () => {
            mount(createElement(SocialShare, { title: "Post", strings: {
                shareLabel: s.shareLabel, shareOnX: s.shareOnX, shareOnLinkedIn: s.shareOnLinkedIn, shareOnFacebook: s.shareOnFacebook, shareByEmail: s.shareByEmail, shareCopyLink: s.shareCopyLink,
            } }));
            expect(host.querySelector("span")!.textContent).toBe(s.shareLabel);
            const titles = [...host.querySelectorAll("[title]")].map((e) => e.getAttribute("title"));
            expect(titles).toEqual([s.shareOnX, s.shareOnLinkedIn, s.shareOnFacebook, s.shareByEmail, s.shareCopyLink]);
        });
    }
});

describe("[1a-client] QuickContact", () => {
    for (const [name, s] of TABLES) {
        it(`[1a-client] ${name}: call / email titles; WhatsApp stays a brand name; a tenant label wins`, () => {
            const strings = { quickContactCall: s.quickContactCall, quickContactEmail: s.quickContactEmail };
            mount(createElement("div", null,
                createElement(QuickContact, { type: "phone", value: "1", strings }),
                createElement(QuickContact, { type: "email", value: "a@b.c", strings }),
                createElement(QuickContact, { type: "whatsapp", value: "1", strings }),
                createElement(QuickContact, { type: "phone", value: "1", label: "Hotline", strings })));
            expect([...host.querySelectorAll("a")].map((a) => a.getAttribute("title"))).toEqual([s.quickContactCall, s.quickContactEmail, "WhatsApp", "Hotline"]);
        });
    }
});

describe("[1a-client] DynamicForm (no importer in the repo today — a graph orphan; its texts are proven here only)", () => {
    const formStrings = (s: typeof EN) => ({ formSubmissionFailed: s.formSubmissionFailed, formErrorShort: s.formErrorShort, formSelectPlaceholder: s.formSelectPlaceholder, formSubmitting: s.formSubmitting });
    const props = (s: typeof EN) => ({
        formSlug: "f", formName: "F", tenantId: "t", apiUrl: "https://api.test", submitButtonText: "Send", successMessage: "Thanks",
        fields: [{ id: "c", label: "Choice", type: "select" as const, required: false, options: ["A"] }], strings: formStrings(s),
    });
    const submit = async () => { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

    for (const [name, s] of TABLES) {
        it(`[1a-client] ${name}: select placeholder; submitting state; a failed answer without an error → formSubmissionFailed`, async () => {
            let answer: (v: any) => void = () => {};
            vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { answer = r; })));
            mount(createElement(DynamicForm, props(s)));
            expect(host.querySelector("option")!.textContent).toBe(s.formSelectPlaceholder);
            await submit();
            expect(host.querySelector("button")!.textContent).toBe(s.formSubmitting);
            await act(async () => { answer({ ok: false, json: async () => ({}) }); });
            await flush();
            expect(host.querySelector("p.text-red-500")!.textContent).toBe(s.formSubmissionFailed);
        });

        it(`[1a-client] ${name}: an error without a message → formErrorShort; the server's error text is shown as sent`, async () => {
            vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(""); }));
            mount(createElement(DynamicForm, props(s)));
            await submit();
            await flush();
            expect(host.querySelector("p.text-red-500")!.textContent).toBe(s.formErrorShort);
            act(() => root!.unmount()); root = null; document.body.innerHTML = "";
            vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Limit reached" }) })));
            mount(createElement(DynamicForm, props(s)));
            await submit();
            await flush();
            expect(host.querySelector("p.text-red-500")!.textContent).toBe("Limit reached");
        });
    }
});

describe("[1a-client] CookieConsent (the banner renders only in the browser, after mount)", () => {
    it("[1a-client] EN and RO: headline, description and the three buttons are the props the layout passes", async () => {
        for (const [name, s] of TABLES) {
            mount(createElement(CookieConsent, { tenantId: `t-${name}`, config: {
                headline: s.cookieHeadline, description: s.cookieDescription, denyAll: s.cookieDenyAll, necessaryOnly: s.cookieNecessaryOnly, acceptAll: s.cookieAcceptAll,
            } }));
            await flush();
            expect(host.querySelector("h3")!.textContent).toBe(s.cookieHeadline);
            expect(host.querySelector("p")!.textContent).toBe(s.cookieDescription);
            expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual([s.cookieDenyAll, s.cookieNecessaryOnly, s.cookieAcceptAll]);
            if (name === "RO") expect(s.cookieAcceptAll).toBe(RO_PACK.gdpr.acceptAll);
            act(() => root!.unmount()); root = null; document.body.innerHTML = "";
        }
    });
});

// review-0 R3: § 5.2 pattern D at one direct reader of each client-only component — the tenant table resolved with a
// stored override absent / "" / "X", passed as the layout/SitePage pass it; expected values written out (§ 6.1).
describe("[1a-client] § 5.2 pattern D — client-only readers: absent → default, \"\" → empty, \"X\" → X (EN and RO)", () => {
    const site = (locale: string, siteStrings?: Record<string, string>) => resolveLocaleStrings({ locale, ...(siteStrings ? { siteStrings } : {}) }).strings.site;
    for (const [lang, locale, shareLabel, submitting] of [["EN", "en-US", "Share:", "Submitting..."], ["RO", "ro-RO", "Distribuie:", "Se trimite..."]] as const) {
        it(`[1a-client] D SocialShare shareLabel, ${lang}`, () => {
            for (const [stored, expected] of [[undefined, shareLabel], ["", ""], ["Spread it:", "Spread it:"]] as const) {
                const s = site(locale, stored === undefined ? undefined : { shareLabel: stored });
                mount(createElement(SocialShare, { title: "Post", strings: {
                    shareLabel: s.shareLabel, shareOnX: s.shareOnX, shareOnLinkedIn: s.shareOnLinkedIn, shareOnFacebook: s.shareOnFacebook, shareByEmail: s.shareByEmail, shareCopyLink: s.shareCopyLink,
                } }));
                expect(host.querySelector("span")!.textContent).toBe(expected);
                act(() => root!.unmount()); root = null; document.body.innerHTML = "";
            }
        });
        it(`[1a-client] D DynamicForm formSubmitting, ${lang}`, async () => {
            for (const [stored, expected] of [[undefined, submitting], ["", ""], ["Wait...", "Wait..."]] as const) {
                const s = site(locale, stored === undefined ? undefined : { formSubmitting: stored });
                vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
                mount(createElement(DynamicForm, {
                    formSlug: "f", formName: "F", tenantId: "t", apiUrl: "https://api.test", submitButtonText: "Send", successMessage: "Thanks", fields: [],
                    strings: { formSubmissionFailed: s.formSubmissionFailed, formErrorShort: s.formErrorShort, formSelectPlaceholder: s.formSelectPlaceholder, formSubmitting: s.formSubmitting },
                }));
                await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
                expect(host.querySelector("button")!.textContent).toBe(expected);
                act(() => root!.unmount()); root = null; document.body.innerHTML = "";
            }
        });
    }
});
