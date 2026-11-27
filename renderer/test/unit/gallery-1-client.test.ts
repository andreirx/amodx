// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { LANGUAGE_PACKS, galleryTexts, resolveLocaleStrings } from "@amodx/shared";
import { RENDER_LOADERS } from "@amodx/plugins/render";

/**
 * GALLERY-1 (docs/slices/gallery-1.md, rulings 3, 8, 9) — the `gallery` block in the browser, in jsdom, loaded through
 * `RENDER_LOADERS` (the built `@amodx/plugins/render` RenderBlocks uses). Every case starts as the page does: the block
 * rendered on the server with NO browser globals (`window`, `document` undefined), that HTML in a browser document, then
 * hydrated — both error channels (console and `onRecoverableError`) must stay empty and the server's nodes are kept.
 *
 * jsdom 28 has `HTMLDialogElement` but no `showModal`/`close` (as test/unit/quote-request.test.ts): stubbed here, test-only.
 * The stub does what the platform does for the component: `showModal` sets `open`; `close` clears it and fires `close`.
 * Focus trapping, the inert page and the first focus inside the dialog are the browser's and are not claimed by these
 * rows; the return of focus to the tile is the component's and is.
 */
const EN = galleryTexts(resolveLocaleStrings({ locale: "en-US" }));
const RO = galleryTexts(resolveLocaleStrings({ locale: "ro-RO" }));
const ITEMS = Array.from({ length: 30 }, (_, i) => ({
    src: `https://img.test/large-${i + 1}.jpg`, thumb: `https://img.test/thumb-${i + 1}.jpg`,
    alt: `Room ${i + 1}`, ...(i === 2 ? { caption: "The blue room", width: 1600, height: 1200 } : {}),
}));
let Gallery: React.FC<any>;
let root: Root | undefined;
/** Every address a `new Image()` was given (the photo loaded ahead). */
let ahead: string[] = [];

beforeAll(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Gallery = (await RENDER_LOADERS["gallery"]()).default;
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
        if (!this.hasAttribute("open")) return;
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
    };
});
afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    ahead = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** Server render without browser globals, then hydrate that HTML; asserts no hydration warning or error. */
async function hydrate(attrs: Record<string, unknown>) {
    const element = createElement(Gallery, { attrs, tenantId: "t1", strings: {} });
    let html: string;
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    try { html = renderToString(element); } finally { vi.unstubAllGlobals(); }
    vi.stubGlobal("Image", class { set src(value: string) { ahead.push(value); } });
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const serverNode = host.firstChild;
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args); });
    await act(async () => { root = hydrateRoot(host, element, { onRecoverableError: (error) => { errors.push(error); } }); });
    expect(errors).toEqual([]);
    expect(host.firstChild).toBe(serverNode);
    consoleError.mockRestore();
    return { host, html };
}

const tile = (host: HTMLElement, i: number) => host.querySelectorAll<HTMLAnchorElement>("a[data-gallery-index]")[i];
const dialog = (host: HTMLElement) => host.querySelector("dialog")!;
const photo = (host: HTMLElement) => dialog(host).querySelector("img");
const counter = (host: HTMLElement) => dialog(host).querySelector('p[aria-live="polite"]')!.textContent;
const button = (host: HTMLElement, name: string) => dialog(host).querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
/** A left click on the tile's photo (the event bubbles to the link), as a visitor's tap; returns whether the component let
 *  it through (did not cancel it). A document listener, after the component's, records that and then cancels the
 *  navigation, which jsdom does not implement. */
function clickTile(host: HTMLElement, i: number, init: MouseEventInit = {}): boolean {
    let letThrough = true;
    const record = (e: Event) => { letThrough = !e.defaultPrevented; e.preventDefault(); };
    document.addEventListener("click", record, { once: true });
    act(() => { tile(host, i).querySelector("img")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })); });
    return letThrough;
}
const key = (host: HTMLElement, k: string) => act(() => { dialog(host).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
function swipe(host: HTMLElement, from: [number, number], to: [number, number]) {
    const touch = (type: string, list: "touches" | "changedTouches", [x, y]: [number, number]) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, list, { value: [{ clientX: x, clientY: y }] });
        Object.defineProperty(e, list === "touches" ? "changedTouches" : "touches", { value: [] });
        return e;
    };
    act(() => { dialog(host).dispatchEvent(touch("touchstart", "touches", from)); });
    act(() => { dialog(host).dispatchEvent(touch("touchend", "changedTouches", to)); });
}

describe("GALLERY-1 viewer (browser)", () => {
    it("ruling 3: server render without window/document = the first browser render — hydration keeps the server nodes, no warning; the viewer starts closed and holds no photo", async () => {
        const { host, html } = await hydrate({ items: ITEMS, columns: "3", _gallery: EN });
        const parsed = document.createElement("div");
        parsed.innerHTML = html;                                    // the server HTML as the document parses it (void tags)
        expect(host.innerHTML).toBe(parsed.innerHTML);
        expect(dialog(host).open).toBe(false);
        expect(photo(host)).toBeNull();
        expect(ahead).toEqual([]);
    });

    it("a tap on tile 3 opens the viewer there: the large photo (not the tile file) with its sizes, the caption, the counter from the locale template; the next photo is fetched ahead", async () => {
        const { host } = await hydrate({ items: ITEMS, _gallery: EN });
        expect(clickTile(host, 2)).toBe(false);                    // the link is not followed
        expect(dialog(host).open).toBe(true);
        expect(dialog(host).querySelectorAll("img")).toHaveLength(1);
        expect(photo(host)!.getAttribute("src")).toBe("https://img.test/large-3.jpg");
        expect(photo(host)!.getAttribute("alt")).toBe("Room 3");
        expect([photo(host)!.getAttribute("width"), photo(host)!.getAttribute("height")]).toEqual(["1600", "1200"]);
        expect(dialog(host).textContent).toContain("The blue room");
        expect(counter(host)).toBe("3 of 30");
        expect(ahead).toEqual(["https://img.test/large-4.jpg"]);
    });

    it("Next / Previous buttons and the arrow keys step; the steps wrap around at both ends; each step fetches only the next photo ahead", async () => {
        const { host } = await hydrate({ items: ITEMS, _gallery: EN });
        clickTile(host, 29);
        expect(counter(host)).toBe("30 of 30");
        act(() => button(host, EN.next).click());
        expect([counter(host), photo(host)!.getAttribute("src")]).toEqual(["1 of 30", "https://img.test/large-1.jpg"]);
        act(() => button(host, EN.previous).click());
        expect(counter(host)).toBe("30 of 30");
        key(host, "ArrowRight");
        key(host, "ArrowRight");
        expect(counter(host)).toBe("2 of 30");
        key(host, "ArrowLeft");
        expect(counter(host)).toBe("1 of 30");
        expect(ahead).toEqual(["https://img.test/large-1.jpg", "https://img.test/large-2.jpg", "https://img.test/large-1.jpg", "https://img.test/large-2.jpg", "https://img.test/large-3.jpg", "https://img.test/large-2.jpg"]);
        expect(dialog(host).querySelectorAll("img")).toHaveLength(1);
    });

    it("a swipe to the left = next, to the right = previous; a short or mostly vertical travel does not step", async () => {
        const { host } = await hydrate({ items: ITEMS, _gallery: EN });
        clickTile(host, 4);
        swipe(host, [300, 200], [200, 210]);
        expect(counter(host)).toBe("6 of 30");
        swipe(host, [100, 200], [250, 190]);
        expect(counter(host)).toBe("5 of 30");
        swipe(host, [300, 200], [280, 200]);
        swipe(host, [300, 100], [240, 300]);
        expect(counter(host)).toBe("5 of 30");
    });

    for (const [how, closeIt] of [
        ["Escape", (host: HTMLElement) => key(host, "Escape")],
        ["the Close button", (host: HTMLElement) => act(() => button(host, EN.close).click())],
        ["a click on the empty area around the photo", (host: HTMLElement) => act(() => { (photo(host)!.parentElement as HTMLElement).click(); })],
    ] as const) {
        it(`ruling 8: ${how} closes the viewer; focus returns to the tile that opened it; the photo is gone`, async () => {
            const { host } = await hydrate({ items: ITEMS, _gallery: EN });
            clickTile(host, 6);
            key(host, "ArrowRight");
            closeIt(host);
            expect(dialog(host).open).toBe(false);
            expect(document.activeElement).toBe(tile(host, 6));
            expect(photo(host)).toBeNull();
            expect(counter(host)).toBe("");
        });
    }

    it("a click on the photo itself does not close the viewer", async () => {
        const { host } = await hydrate({ items: ITEMS, _gallery: EN });
        clickTile(host, 0);
        act(() => photo(host)!.click());
        expect(dialog(host).open).toBe(true);
    });

    it("a click with a modifier key (a new tab) or another button keeps the browser's action: the viewer does not open", async () => {
        const { host } = await hydrate({ items: ITEMS, _gallery: EN });
        for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
            expect(clickTile(host, 1, init), JSON.stringify(init)).toBe(true);
            expect(dialog(host).open).toBe(false);
        }
    });

    it("one photo: no Previous / Next, the arrow keys do not step, the photo is not fetched ahead", async () => {
        const { host } = await hydrate({ items: [ITEMS[0]], _gallery: EN });
        clickTile(host, 0);
        expect(counter(host)).toBe("1 of 1");
        expect(dialog(host).querySelectorAll("button")).toHaveLength(1);
        key(host, "ArrowRight");
        expect(counter(host)).toBe("1 of 1");
        expect(ahead).toEqual([]);
    });

    it("ruling 2: a Romanian page — the counter is the Romanian template, the buttons carry the Romanian names", async () => {
        const { host } = await hydrate({ items: ITEMS, _gallery: RO });
        clickTile(host, 2);
        expect(counter(host)).toBe("3 din 30");
        expect(dialog(host).getAttribute("aria-label")).toBe(LANGUAGE_PACKS.ro.site.galleryViewer);
        for (const name of [RO.close, RO.previous, RO.next]) expect(button(host, name)).not.toBeNull();
    });
});
