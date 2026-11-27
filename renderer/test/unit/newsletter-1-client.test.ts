// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LANGUAGE_PACKS, newsletterTexts, resolveLocaleStrings } from "@amodx/shared";
import { RENDER_LOADERS } from "@amodx/plugins/render";
import { PopupManager } from "@/components/PopupManager";

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md) — the browser side of the signup, in jsdom:
 *  - the `newsletter` block (loaded through `RENDER_LOADERS`, the built `@amodx/plugins/render` RenderBlocks uses):
 *    the submit body to the same-origin proxy `/api/leads` (the exact consent line drawn), the thanks text, and the
 *    locale failure text (never the server's text);
 *  - the popup (scope item 5, ruling 11): a stored newsletter popup without the opt-in draws exactly as before (link,
 *    no field); with `collectEmail: true` and the texts of the answer it draws the same form (CTA text = button label).
 * Mocked: `fetch` (the proxy and the public popups answer). Real: the components and the resolver.
 */
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const EN = newsletterTexts(resolveLocaleStrings({ locale: "en-US" }));
const RO = newsletterTexts(resolveLocaleStrings({ locale: "ro-RO" }));
let Newsletter: React.FC<any>;
beforeAll(async () => { Newsletter = (await RENDER_LOADERS["newsletter"]()).default; });

let root: Root | null = null;
let host: HTMLDivElement;
function mount(el: React.ReactElement) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(el); });
}
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    vi.unstubAllGlobals();
    sessionStorage.clear();
});
const flush = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

async function fillAndSubmit(email: string) {
    const input = host.querySelector<HTMLInputElement>('input[name="email"]')!;
    const box = host.querySelector<HTMLInputElement>('input[name="consent"]')!;
    expect(box.required).toBe(true);
    await act(async () => { input.value = email; box.checked = true; });
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
}

describe("the newsletter block in the browser", () => {
    it("submits { email, source: \"newsletter\", consentText: the line drawn, consentLocale: its locale, recaptchaToken: null } to /api/leads; success → the thanks text", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "Subscribed" }), { status: 201 }));
        vi.stubGlobal("fetch", fetchMock);
        mount(createElement(Newsletter, { attrs: { headline: "News", _newsletter: RO }, tenantId: "t1", strings: {} }));
        expect(host.textContent).toContain(RO.consent);
        expect(host.querySelector<HTMLInputElement>('input[name="email"]')!.placeholder).toBe(LANGUAGE_PACKS.ro.site.newsletterEmailPlaceholder);
        expect(host.querySelector("label.sr-only")!.textContent).toBe(LANGUAGE_PACKS.ro.site.newsletterEmail);
        await fillAndSubmit("cititor@example.test");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/leads");
        expect(init.method).toBe("POST");
        expect(JSON.parse(String(init.body))).toEqual({ email: "cititor@example.test", source: "newsletter", consentText: RO.consent, consentLocale: "ro-RO", recaptchaToken: null });
        expect(host.textContent).toContain(LANGUAGE_PACKS.ro.site.newsletterThanks);
        expect(host.querySelector("form")).toBeNull();
    });

    it("while the answer is pending the button shows the locale \"subscribing\" text and is disabled", async () => {
        let release!: (r: Response) => void;
        vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { release = r; })));
        mount(createElement(Newsletter, { attrs: { _newsletter: RO }, tenantId: "t1", strings: {} }));
        await fillAndSubmit("cititor@example.test");
        const button = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        expect(button.textContent).toBe(LANGUAGE_PACKS.ro.site.newsletterSubscribing);
        expect(button.disabled).toBe(true);
        await act(async () => { release(new Response("{}", { status: 201 })); });
        await flush();
        expect(host.textContent).toContain(RO.thanks);
    });

    it("an error answer → the locale failure text, never the server's text; the form stays", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Submission Failed" }), { status: 409 })));
        mount(createElement(Newsletter, { attrs: { _newsletter: EN }, tenantId: "t1", strings: {} }));
        await fillAndSubmit("reader@example.test");
        expect(host.textContent).toContain(EN.failed);
        expect(host.textContent).not.toContain("Submission Failed");
        expect(host.querySelector("form")).not.toBeNull();
    });
});

describe("the newsletter popup (ruling 11, scope item 5)", () => {
    const POPUP = { id: "p1", type: "newsletter", headline: "Stay in touch", body: "<p>Monthly news.</p>", ctaText: "Read the blog", ctaLink: "/blog", trigger: "page_load", triggerValue: "0", showOnPages: [], showOncePerSession: true };
    async function popupWith(answer: Record<string, unknown>) {
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (String(url).endsWith("/public/popups")) return new Response(JSON.stringify(answer), { status: 200 });
            return new Response("{}", { status: 201 });
        }));
        mount(createElement(PopupManager, { tenantId: "t1", apiUrl: "https://api.example.test", currentPath: "/" }));
        await flush(20);
        await flush(20);
    }

    it("a stored newsletter popup without the opt-in draws as before: headline, body, the link button; no field, no box", async () => {
        await popupWith({ items: [POPUP] });
        expect(host.textContent).toContain("Stay in touch");
        const link = host.querySelector("a");
        expect(link?.getAttribute("href")).toBe("/blog");
        expect(link?.textContent).toBe("Read the blog");
        expect(host.querySelector("form, input")).toBeNull();
    });

    it("opted in with the answer's texts: the form in place of the link; the CTA text is the button label", async () => {
        await popupWith({ items: [{ ...POPUP, collectEmail: true }], newsletter: EN });
        expect(host.querySelector("a")).toBeNull();
        expect(host.querySelector('input[name="email"]')).not.toBeNull();
        expect(host.textContent).toContain(EN.consent);
        expect(host.querySelector('button[type="submit"]')?.textContent).toBe("Read the blog");
    });

    it("opted in but the answer has no texts, or another popup type with the flag: the link popup as before", async () => {
        await popupWith({ items: [{ ...POPUP, collectEmail: true }] });
        expect(host.querySelector("form")).toBeNull();
        expect(host.querySelector("a")?.getAttribute("href")).toBe("/blog");
        act(() => root?.unmount()); root = null; host.remove(); sessionStorage.clear();
        await popupWith({ items: [{ ...POPUP, type: "announcement", collectEmail: true }], newsletter: EN });
        expect(host.querySelector("form")).toBeNull();
        expect(host.querySelector("a")?.getAttribute("href")).toBe("/blog");
    });
});
