// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProductImageGallery, SITE_HEADER_SELECTOR } from "@/components/ProductImageGallery";

/**
 * CAT-VARIANT-GALLERY-1 (docs/slices/cat-variant-gallery-1.md § 1, taxonomy table) — the gallery's option picker.
 * The real component, mounted with React in jsdom (no Next, no server), next to a hand-built radio group named as
 * SitePage's `CatalogVariantPresenter` names it. A choice is made as a browser makes it: the radio is checked and a
 * bubbling `change` event is sent (the pattern of interest-toggle.test.ts).
 */

const MAIN = "https://img.test/main.jpg";
const GROUP = "catalog-option-color";
const OPTIONS = [
    { value: "red", imageLink: "https://img.test/red.jpg" },                                              // imageLink only
    { value: "blue", imageLink: "https://img.test/blue-1.jpg",                                            // several pictures;
        additionalImageLinks: ["https://img.test/blue-2.jpg", "https://img.test/blue-3.jpg", "https://img.test/blue-1.jpg"] }, // one repeated
    { value: "plain" },                                                                                    // no picture
];
// The derived whole-product gallery (deriveGallery): the option pictures again — the thumbnails rule 1 hides.
const WHOLE_GALLERY = ["https://img.test/red.jpg", "https://img.test/blue-1.jpg", "https://img.test/blue-2.jpg", "https://img.test/blue-3.jpg"];

let root: Root | null = null;
let host: HTMLDivElement;

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
});

/** The presenter's radio group (replaces the one before, as a navigation to another product does). */
function presenter(values: string[], checked?: string, name = GROUP) {
    document.getElementById("presenter")?.remove();
    const group = document.createElement("fieldset");
    group.id = "presenter";
    for (const v of values) {
        const input = document.createElement("input");
        input.type = "radio";
        input.name = name;
        input.value = v;
        input.checked = v === checked;
        group.appendChild(input);
    }
    document.body.prepend(group);
}

function choose(value: string) {
    const input = document.querySelector<HTMLInputElement>(`#presenter input[value="${value}"]`)!;
    act(() => { input.checked = true; input.dispatchEvent(new Event("change", { bubbles: true })); });
}

function mount(props: Record<string, unknown>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(createElement(ProductImageGallery, props as any)); });
}

const catalogProps = (extra: Record<string, unknown> = {}) => ({
    mainImage: MAIN, additionalImages: WHOLE_GALLERY.slice(1), title: "Vase", optionGroupName: GROUP, options: OPTIONS, pinnedTop: "calc(5rem + 1px)", ...extra,
});
const preview = () => host.querySelector("img")!.getAttribute("src");
const thumbnailButtons = () => [...host.querySelectorAll<HTMLButtonElement>(".grid > button")];
const thumbnails = () => thumbnailButtons().map((b) => b.querySelector("img")!.getAttribute("src"));
const counter = () => host.querySelector(".relative > span")?.textContent ?? null;
const arrows = () => host.querySelectorAll(".relative > button").length;

describe("ProductImageGallery — the variant tiles are the picker (CAT-VARIANT-GALLERY-1)", () => {
    it("[no option chosen] the preview is the product imageLink; no whole-gallery thumbnails, arrows or counter", () => {
        presenter(["red", "blue", "plain"]);
        mount(catalogProps());
        expect(preview()).toBe(MAIN);
        expect(thumbnails()).toEqual([]);
        expect(arrows()).toBe(0);
        expect(counter()).toBeNull();
    });

    it("[option with imageLink only] choosing it shows that picture; no thumbnails, arrows or counter", () => {
        presenter(["red", "blue", "plain"]);
        mount(catalogProps());
        choose("red");
        expect(preview()).toBe("https://img.test/red.jpg");
        expect(thumbnails()).toEqual([]);
        expect(arrows()).toBe(0);
        expect(counter()).toBeNull();
    });

    it("[option with imageLink + additionalImageLinks] preview = its imageLink; thumbnails = its pictures (each once); a thumbnail click and the arrows walk them", () => {
        presenter(["red", "blue", "plain"]);
        mount(catalogProps());
        choose("blue");
        expect(preview()).toBe("https://img.test/blue-1.jpg");
        expect(thumbnails()).toEqual(["https://img.test/blue-1.jpg", "https://img.test/blue-2.jpg", "https://img.test/blue-3.jpg"]);
        expect(counter()).toBe("1 / 3");
        act(() => thumbnailButtons()[1].click());
        expect(preview()).toBe("https://img.test/blue-2.jpg");
        expect(counter()).toBe("2 / 3");
        act(() => host.querySelectorAll<HTMLButtonElement>(".relative > button")[1].click()); // the "next" arrow
        expect(preview()).toBe("https://img.test/blue-3.jpg");
        choose("red");                                                                          // another option: its picture, from the start
        expect(preview()).toBe("https://img.test/red.jpg");
        expect(thumbnails()).toEqual([]);
    });

    it("[option without imageLink] choosing it leaves the preview as it is", () => {
        presenter(["red", "blue", "plain"]);
        mount(catalogProps());
        choose("plain");                                     // first choice: the product picture stays
        expect(preview()).toBe(MAIN);
        choose("blue");
        act(() => thumbnailButtons()[1].click());
        choose("plain");                                     // after a pictured option: its preview and thumbnails stay
        expect(preview()).toBe("https://img.test/blue-2.jpg");
        expect(thumbnails()).toEqual(["https://img.test/blue-1.jpg", "https://img.test/blue-2.jpg", "https://img.test/blue-3.jpg"]);
    });

    it("a change in another radio group does not change the preview", () => {
        presenter(["red", "blue", "plain"]);
        const other = document.createElement("input");
        other.type = "radio"; other.name = "something-else"; other.value = "red";
        document.body.appendChild(other);
        mount(catalogProps());
        act(() => { other.checked = true; other.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(preview()).toBe(MAIN);
    });

    it("[product without options] the gallery as before: its thumbnails shown and clickable", () => {
        mount({ mainImage: MAIN, additionalImages: ["https://img.test/b.jpg", "https://img.test/c.jpg"], title: "Vase", pinnedTop: "calc(5rem + 1px)" });
        expect(thumbnails()).toEqual([MAIN, "https://img.test/b.jpg", "https://img.test/c.jpg"]);
        expect(counter()).toBe("1 / 3");
        act(() => thumbnailButtons()[2].click());
        expect(preview()).toBe("https://img.test/c.jpg");
    });

    it("[options without any picture] the gallery as before: the whole-gallery thumbnails are the picker", () => {
        presenter(["s", "m"]);
        mount({ mainImage: MAIN, additionalImages: ["https://img.test/b.jpg"], title: "Vase", optionGroupName: GROUP, options: [{ value: "s" }, { value: "m" }], pinnedTop: "calc(5rem + 1px)" });
        expect(thumbnails()).toEqual([MAIN, "https://img.test/b.jpg"]);
        choose("m");
        expect(preview()).toBe(MAIN);
        act(() => thumbnailButtons()[1].click());
        expect(preview()).toBe("https://img.test/b.jpg");
    });

    it("[same instance, another product] no picture carries over: B with nothing checked shows B's picture; B with an option checked shows that option's", () => {
        presenter(["red", "blue", "plain"]);
        mount(catalogProps());
        choose("blue");
        act(() => thumbnailButtons()[2].click());
        expect(preview()).toBe("https://img.test/blue-3.jpg");

        // Product B: same group name (an imported product's group id can repeat), other options, nothing checked yet.
        const B_OPTIONS = [{ value: "green", imageLink: "https://img.test/green.jpg", additionalImageLinks: ["https://img.test/green-2.jpg"] }];
        presenter(["green"]);
        act(() => root!.render(createElement(ProductImageGallery, catalogProps({ mainImage: "https://img.test/b-main.jpg", options: B_OPTIONS }) as any)));
        expect(preview()).toBe("https://img.test/b-main.jpg");
        expect(thumbnails()).toEqual([]);
        expect(counter()).toBeNull();

        // Product C arrives with its option already checked (for example, the browser restored the form).
        const C_OPTIONS = [{ value: "black", imageLink: "https://img.test/black.jpg", additionalImageLinks: ["https://img.test/black-2.jpg"] }];
        presenter(["black"], "black");
        act(() => root!.render(createElement(ProductImageGallery, catalogProps({ mainImage: "https://img.test/c-main.jpg", options: C_OPTIONS }) as any)));
        expect(preview()).toBe("https://img.test/black.jpg");
        expect(counter()).toBe("1 / 2");
    });
});

/**
 * CAT-VARIANT-GALLERY-1, review-1 (header height that depends on content): after hydration the pinned gallery follows the
 * site header's REAL height. jsdom has no layout and no ResizeObserver, so these rows give the header element a height
 * (`getBoundingClientRect`) and install a recording ResizeObserver; real geometry (line breaks, wrapping at a window
 * width) is proven in a browser by test/interest-e2e/cvg1-pinned.spec.mjs.
 */
describe("ProductImageGallery — the pinned top follows the real site header (CAT-VARIANT-GALLERY-1)", () => {
    let observers: { callback: () => void; target: Element | null; disconnected: boolean }[] = [];
    const original = (globalThis as any).ResizeObserver;
    const installObserver = () => {
        observers = [];
        (globalThis as any).ResizeObserver = class {
            record = { callback: () => {}, target: null as Element | null, disconnected: false };
            constructor(callback: () => void) { this.record.callback = callback; observers.push(this.record); }
            observe(el: Element) { this.record.target = el; }
            disconnect() { this.record.disconnected = true; }
        };
    };
    afterEach(() => { (globalThis as any).ResizeObserver = original; });

    /** The layout's sticky header wrapper, with a settable rendered height in px. */
    function siteHeader(classes = "sticky top-0 z-50") {
        const header = document.createElement("div");
        header.className = classes;
        let height = 0;
        header.getBoundingClientRect = () => ({ height } as DOMRect);
        document.body.prepend(header);
        return { header, setHeight: (h: number) => { height = h; } };
    }
    const galleryRoot = () => host.firstElementChild as HTMLElement;
    /** A CSS length as jsdom's style parser stores it (it may reorder `calc()` terms). */
    const css = (value: string) => { const e = document.createElement("div"); e.style.top = value; return e.style.top; };

    it("[measured] top = the header's rendered height + 1rem; a taller header (a three-line Top Bar) moves it; unmount stops observing", () => {
        installObserver();
        const { header, setHeight } = siteHeader();
        setHeight(65);
        mount(catalogProps({ pinnedTop: "calc(5rem + 1px)" }));
        expect(document.querySelector(SITE_HEADER_SELECTOR)).toBe(header);
        expect(galleryRoot().style.top).toBe(css("calc(65px + 1rem)"));
        expect(observers).toHaveLength(1);
        expect(observers[0].target).toBe(header);
        setHeight(161);                                   // Top Bar with two <br> (3 lines) + h-24 bar: 3rem + 1rem + 6rem + 1px
        act(() => observers[0].callback());
        expect(galleryRoot().style.top).toBe(css("calc(161px + 1rem)"));
        setHeight(113);                                   // the window got wider: the announcement fits on fewer lines
        act(() => observers[0].callback());
        expect(galleryRoot().style.top).toBe(css("calc(113px + 1rem)"));
        act(() => root!.unmount());
        root = null;
        expect(observers[0].disconnected).toBe(true);
    });

    it("[measured] the editorial header (its border class) is found the same way", () => {
        installObserver();
        const { setHeight } = siteHeader("sticky top-0 z-50 border-t-[3px] border-primary");
        setHeight(100);
        mount(catalogProps({ pinnedTop: "calc(7rem + 4px)" }));
        expect(galleryRoot().style.top).toBe(css("calc(100px + 1rem)"));
    });

    it("[server value] no header element, or no ResizeObserver: the top stays the server's configuration value", () => {
        installObserver();
        mount(catalogProps({ pinnedTop: "calc(5rem + 1px)" }));
        expect(galleryRoot().style.top).toBe(css("calc(5rem + 1px)"));
        expect(observers).toHaveLength(0);
        act(() => root!.unmount());
        root = null;
        document.body.innerHTML = "";
        (globalThis as any).ResizeObserver = undefined;
        siteHeader().setHeight(200);
        mount(catalogProps({ pinnedTop: "calc(5rem + 1px)" }));
        expect(galleryRoot().style.top).toBe(css("calc(5rem + 1px)"));
    });

    it("[commerce] without pinnedTop nothing is measured and the root has no style", () => {
        installObserver();
        siteHeader().setHeight(65);
        mount({ mainImage: MAIN, additionalImages: ["https://img.test/b.jpg"], title: "Vase" });
        expect(observers).toHaveLength(0);
        expect(galleryRoot().getAttribute("style")).toBeNull();
        expect(galleryRoot().className).toBe("space-y-3");
    });
});
