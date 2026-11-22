// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * LANG-1C (docs/slices/lang-1.md § 8.6) — the CLIENT half of the language switch, mounted with React in jsdom (the pattern
 * of locale-1a-client.test.ts): after mount each link takes the PATH of the head's `<link rel="alternate" hreflang>` for
 * its language when one exists (else the language home), it reads the head again when the head changes (what a client
 * navigation does), and it writes the address in the form the menu links take (`getUrl`: the preview prefix on a
 * `/_site/<id>/…` page). A one-language Navbar (no `languageSwitch`) renders no switch and watches nothing.
 * This is the local, automated part of the row the spec checks in headless Chromium on staging (§ 8.6, NOT automated there).
 * Mocked: Next's link/navigation and NextAuth's session hook — the component code is real.
 */

const nav = vi.hoisted(() => ({ pathname: "/ro/despre" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));

import { Navbar, type LanguageSwitchLink } from "@/components/Navbar";

const STRINGS = { navAllOf: "{label} (All)", navContact: "Contact", navToggleMenu: "Menu", navViewAll: "All", navContactUs: "Contact us" };
const SWITCH: LanguageSwitchLink[] = [
    { hreflang: "en", label: "English", href: "/", current: false },
    { hreflang: "ro", label: "română", href: "/ro", current: true },
    { hreflang: "de", label: "Deutsch", href: "/de", current: false },
    { hreflang: "fr", label: "français", href: "/fr", current: false },
];

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    nav.pathname = "/ro/despre";
    vi.restoreAllMocks();
});
function mount(el: React.ReactElement) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(el); });
}
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
function setHead(pairs: [string, string][]) {
    document.head.querySelectorAll("link[rel=alternate]").forEach((l) => l.remove());
    for (const [hreflang, href] of pairs) {
        const l = document.createElement("link");
        l.rel = "alternate";
        l.setAttribute("hreflang", hreflang);
        l.href = href;
        document.head.appendChild(l);
    }
}
/** Each switch copy (desktop, mobile) as `hreflang → href`. */
const switches = () => [...host.querySelectorAll("ul[data-language-switch]")].map((ul) =>
    Object.fromEntries([...ul.querySelectorAll("a")].map((a) => [a.getAttribute("hreflang"), a.getAttribute("href")])));

describe("lang1c-switch (client half)", () => {
    it("lang1c-switch (client): the head's alternates replace the language homes; a language without an alternate keeps its home; aria-current and lang", async () => {
        setHead([["en", "https://t1.test/about"], ["ro", "https://t1.test/ro/despre"], ["de", "https://t1.test/de/uber"], ["x-default", "https://t1.test/about"]]);
        mount(createElement(Navbar, { siteName: "Site", strings: STRINGS, languageSwitch: SWITCH }));
        await flush();
        const expected = { en: "/about", ro: "/ro/despre", de: "/de/uber", fr: "/fr" };
        expect(switches()).toEqual([expected, expected]);
        const ro = host.querySelector('ul[data-language-switch] a[hreflang="ro"]')!;
        expect(ro.getAttribute("aria-current")).toBe("true");
        expect(ro.getAttribute("lang")).toBe("ro");
        expect(host.querySelectorAll('ul[data-language-switch] a[aria-current]')).toHaveLength(2);   // one per copy
    });

    it("lang1c-switch (client): the home alternate (Next writes https://<domain> for /) maps to /", async () => {
        setHead([["en", "https://t1.test"], ["ro", "https://t1.test/ro/acasa"]]);
        mount(createElement(Navbar, { siteName: "Site", strings: STRINGS, languageSwitch: SWITCH }));
        await flush();
        expect(switches()[0]).toEqual({ en: "/", ro: "/ro/acasa", de: "/de", fr: "/fr" });
    });

    it("lang1c-switch (client): the head changes (a client navigation) → the links are read again; no alternates → the homes", async () => {
        setHead([["en", "https://t1.test/about"], ["ro", "https://t1.test/ro/despre"]]);
        mount(createElement(Navbar, { siteName: "Site", strings: STRINGS, languageSwitch: SWITCH }));
        await flush();
        expect(switches()[0].ro).toBe("/ro/despre");
        setHead([["en", "https://t1.test/team"], ["ro", "https://t1.test/ro/echipa"]]);
        await flush();
        expect(switches()[0]).toEqual({ en: "/team", ro: "/ro/echipa", de: "/de", fr: "/fr" });
        setHead([]);
        await flush();
        expect(switches()[0]).toEqual({ en: "/", ro: "/ro", de: "/de", fr: "/fr" });
    });

    it("lang1c-switch (client): on a preview page the links take the preview form of the menu links (no trailing slash)", async () => {
        nav.pathname = "/_site/t1/ro/despre";
        setHead([["ro", "https://t1.test/ro/despre"], ["en", "https://t1.test/about"]]);
        mount(createElement(Navbar, { siteName: "Site", strings: STRINGS, languageSwitch: SWITCH }));
        await flush();
        expect(switches()[0]).toEqual({ en: "/_site/t1/about", ro: "/_site/t1/ro/despre", de: "/_site/t1/de", fr: "/_site/t1/fr" });
        setHead([]);
        await flush();
        expect(switches()[0].en).toBe("/_site/t1");
    });

    it("lang1c-switch-identity (client): without languageSwitch no switch is rendered and the head is not watched", async () => {
        const observe = vi.spyOn(MutationObserver.prototype, "observe");
        setHead([["en", "https://t1.test/about"], ["ro", "https://t1.test/ro/despre"]]);
        mount(createElement(Navbar, { siteName: "Site", strings: STRINGS }));
        await flush();
        expect(host.querySelector("[data-language-switch]")).toBeNull();
        expect(observe).not.toHaveBeenCalled();
    });
});
