// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useLayoutEffect, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { FBPixel } from "@/components/FBPixel";
import { FBPixelLoader } from "@/components/FBPixelLoader";
import { CookieConsent } from "@/components/CookieConsent";
import { FBPurchaseEvent } from "@/components/FBPurchaseEvent";
import { trackFBEvent } from "@/lib/fbpixel";

// Same boundary seam as the other headless renderer suites: Next's external CJS
// Script resolves a second React instance in this monorepo. Keep its supplied bytes
// visible, without simulating Next's scheduler/cache. Run those bytes explicitly below.
vi.mock("next/script", () => ({
    default: ({ strategy, children, ...props }: any) => createElement("script", { ...props, "data-strategy": strategy }, children),
}));
// Real consent hook/banner/inline loader. jsdom resource loading is OFF: no external
// SDK download. This proves the Script boundary and queue, not browser network/Next delivery.
const tenantId = "pixel-consent-1";
const pixelId = "5551234567";
const accepted = { necessary: true, analytics: true, marketing: true };
const necessary = { necessary: true, analytics: false, marketing: false };
const config = {
    headline: "Cookies", description: "Choose cookies", denyAll: "Deny all",
    necessaryOnly: "Necessary only", acceptAll: "Accept all",
};
const browser = window as Window & { AMODX_CONSENT?: unknown; _fbq?: unknown };
let root: Root | undefined;
let firstCommit = false;
const consentRead = vi.fn();
const fetchMock = vi.fn(async () => ({ ok: true }));

// This layout effect runs before passive consent effects. The global getter below
// fails if consent is read during SSR or the first client render, even when Next Script
// itself returns null (so a hydration-error assertion alone could miss that defect).
function FirstCommitProbe() {
    useLayoutEffect(() => { firstCommit = true; }, []);
    return createElement("p", null, "Pixel consent test");
}
function page() {
    return createElement("main", null,
        createElement(FirstCommitProbe),
        createElement(FBPixelLoader, { pixelId }),
        createElement(CookieConsent, { tenantId, config }),
    );
}

async function hydrate(element: ReactElement) {
    firstCommit = false;
    let html: string;
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    try { html = renderToString(element); } finally {
        vi.unstubAllGlobals();
        vi.stubGlobal("fetch", fetchMock);
    }
    expect(consentRead).not.toHaveBeenCalled();
    expect(html).not.toMatch(/fb-pixel|facebook\.(net|com)|noscript/);
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const serverNode = host.firstChild;
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args); });
    await act(async () => {
        root = hydrateRoot(host, element, { onRecoverableError: (error) => { errors.push(error); } });
    });
    expect(errors).toEqual([]);
    expect(host.firstChild).toBe(serverNode);
    consoleError.mockRestore();
    return { host, html };
}
function expectNoPixel() {
    expect(document.querySelectorAll('#fb-pixel, noscript, [src*="facebook.net"], [src*="facebook.com"]')).toHaveLength(0);
    expect(window.fbq).toBeUndefined();
    expect(browser._fbq).toBeUndefined();
}

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
    let consent: unknown;
    Object.defineProperty(browser, "AMODX_CONSENT", {
        configurable: true,
        get: () => {
            consentRead();
            expect(firstCommit, "consent must not be read before the first commit").toBe(true);
            return consent;
        },
        set: (value) => { consent = value; },
    });
    fetchMock.mockClear();
    consentRead.mockClear();
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    localStorage.clear();
    delete browser.AMODX_CONSENT;
    delete window.fbq;
    delete browser._fbq;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("PIXEL-CONSENT-1", () => {
    it("server FBPixel only mounts the consent-gated client loader with the tenant's id; it emits nothing itself", async () => {
        const element = await FBPixel({ pixelId });
        expect(element.type).toBe(FBPixelLoader);
        expect(element.props).toEqual({ pixelId });
    });

    it("P2/P5 no choice: no loader, image or fbq before or after hydration; helpers drop events", async () => {
        await hydrate(page());
        expectNoPixel();
        for (const event of ["AddToCart", "InitiateCheckout", "Purchase"]) trackFBEvent(event, { value: 12 });
        await act(async () => root!.render(createElement(FBPurchaseEvent, {
            orderId: "pixel-consent-1-order", value: 12, currency: "USD", items: [{ id: "p1", quantity: 1 }],
        })));
        expectNoPixel();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    for (const label of ["Necessary only", "Deny all"]) {
        it(`P3/P5 ${label}: no pixel on the current page or a subsequent hydration`, async () => {
            const { host } = await hydrate(page());
            await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click());
            expectNoPixel();
            expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/consent", expect.any(Object));
            expect(JSON.parse(localStorage.getItem(`amodx-consent-${tenantId}`)!).consent).toEqual(necessary);
            act(() => root!.unmount());
            root = undefined;
            consentRead.mockClear();
            await hydrate(page());
            expectNoPixel();
        });
    }

    it("P3 analytics alone is not marketing consent", async () => {
        browser.AMODX_CONSENT = { ...accepted, marketing: false };
        await hydrate(page());
        expectNoPixel();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("P4/P5 accepting now renders the loader without reload; stored acceptance hydrates without an early consent read", async () => {
        const { host } = await hydrate(page());
        expectNoPixel();
        await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Accept all")!.click());
        const loader = document.querySelector("#fb-pixel")!;
        expect(loader.getAttribute("data-strategy")).toBe("afterInteractive");
        expect(loader.textContent).toContain(`fbq('init', '${pixelId}')`);
        expect(loader.textContent).toContain("fbq('track', 'PageView')");
        expect(document.querySelectorAll("noscript, img")).toHaveLength(0);
        window.eval(loader.textContent!);
        expect([...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")))
            .toEqual(["https://connect.facebook.net/en_US/fbevents.js"]);
        const queue = (window.fbq as unknown as { queue: IArguments[] }).queue;
        expect(queue.map((args) => [...args])).toEqual([["init", pixelId], ["track", "PageView"]]);
        // Positive control for the same helpers that dropped events before loading.
        for (const event of ["AddToCart", "InitiateCheckout", "Purchase"]) trackFBEvent(event, { value: 12 });
        expect(queue.slice(2).map((args) => [...args])).toEqual([
            ["track", "AddToCart", { value: 12 }], ["track", "InitiateCheckout", { value: 12 }], ["track", "Purchase", { value: 12 }],
        ]);
        expect(JSON.parse(localStorage.getItem(`amodx-consent-${tenantId}`)!).consent).toEqual(accepted);
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/consent", expect.any(Object));
        act(() => root!.unmount());
        root = undefined;
        consentRead.mockClear();
        document.body.innerHTML = "";
        await hydrate(page());
        // Stored consent also renders the loader after mount. The test does NOT run
        // it twice or claim to test Next's load-cache/de-duplication.
        expect(document.querySelectorAll("#fb-pixel")).toHaveLength(1);
    });
});
