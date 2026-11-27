// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * GALLERY-1 (docs/slices/gallery-1.md, scope item 5; ruling 5) — the gallery block's editor in the REAL BlockEditor with
 * the REAL MediaPicker (jsdom): BlockEditor injects `pickManyFn` into the block's storage; "Add photos" opens the picker
 * in its multi-select mode; several images are marked in one step and added in the order marked; description and
 * caption per photo; move up / move down / remove. And the single pick the image block uses (`pickFn`) still takes one
 * click, sets the one address and closes. Replaced: `apiRequest` (the asset list), the toolbar and the upload helper.
 */
const ASSETS = [
    { id: "a1", fileName: "garden.jpg", fileType: "image/jpeg", publicUrl: "https://cdn.test/garden.jpg" },
    { id: "a2", fileName: "room.jpg", fileType: "image/jpeg", publicUrl: "https://cdn.test/room.jpg" },
    { id: "a3", fileName: "tour.mp4", fileType: "video/mp4", publicUrl: "https://cdn.test/tour.mp4" },
    { id: "a4", fileName: "pool.jpg", fileType: "image/jpeg", publicUrl: "https://cdn.test/pool.jpg" },
];
vi.mock("@/lib/api", () => ({ apiRequest: vi.fn(async (path: string) => (path === "/assets" ? { items: ASSETS } : { items: [] })) }));
vi.mock("./Toolbar", () => ({ Toolbar: () => null }));
vi.mock("@/lib/upload", () => ({ uploadFile: vi.fn() }));

import { BlockEditor } from "./BlockEditor";

let root: Root | null = null;
let host: HTMLDivElement;
let changes: any[][] = [];
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    changes = [];
});
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function mount(blocks: unknown[]) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(createElement(BlockEditor, { initialContent: blocks, onChange: (json: any[]) => changes.push(json) })); });
    await flush();
}
const buttonByText = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); };
/** The picker dialog (Radix renders it in a portal under body), or null when closed. */
const picker = () => document.querySelector<HTMLElement>('[role="dialog"]');
const pickerTile = (fileName: string) => [...picker()!.querySelectorAll("button")].find((b) => b.textContent?.includes(fileName));
const lastGallery = () => changes.at(-1)!.find((b: any) => b.type === "gallery");
const GALLERY = (items: unknown[] = []) => ({ type: "gallery", attrs: { items, columns: "3", blockWidth: "content" } });

describe("BlockEditor → the gallery block: several photos in one pick (ruling 5)", () => {
    it("\"Add photos\" opens the picker in multi-select mode on images only; two marked → \"Add 2 items\" appends them in the order marked, with empty descriptions; the picker closes", async () => {
        await mount([GALLERY([{ src: "https://cdn.test/old.jpg", alt: "Old", thumb: "https://cdn.test/old-t.jpg" }])]);
        await click(buttonByText(host, "Add photos"));
        expect(picker()).not.toBeNull();
        expect(picker()!.textContent).toContain("Select Images");
        expect(pickerTile("tour.mp4")).toBeUndefined();               // images only
        const add = () => buttonByText(picker()!, "Add 0 items") ?? buttonByText(picker()!, "Add 1 item") ?? buttonByText(picker()!, "Add 2 items");
        expect(add()!.disabled).toBe(true);
        await click(pickerTile("room.jpg"));
        await click(pickerTile("garden.jpg"));
        expect(pickerTile("room.jpg")!.getAttribute("aria-pressed")).toBe("true");
        expect(pickerTile("pool.jpg")!.getAttribute("aria-pressed")).toBe("false");
        expect(picker()).not.toBeNull();                              // marking does not close
        await click(buttonByText(picker()!, "Add 2 items"));
        expect(picker()).toBeNull();
        expect(lastGallery().attrs.items).toEqual([
            { src: "https://cdn.test/old.jpg", alt: "Old", thumb: "https://cdn.test/old-t.jpg" },
            { src: "https://cdn.test/room.jpg", alt: "" },
            { src: "https://cdn.test/garden.jpg", alt: "" },
        ]);
    });

    it("a second click unmarks; a new opening starts with nothing marked", async () => {
        await mount([GALLERY()]);
        await click(buttonByText(host, "Add photos"));
        await click(pickerTile("pool.jpg"));
        await click(pickerTile("pool.jpg"));
        expect(pickerTile("pool.jpg")!.getAttribute("aria-pressed")).toBe("false");
        await click(pickerTile("pool.jpg"));
        await click(buttonByText(picker()!, "Add 1 item"));
        await click(buttonByText(host, "Add photos"));
        expect(buttonByText(picker()!, "Add 0 items")!.disabled).toBe(true);
        expect(lastGallery().attrs.items).toEqual([{ src: "https://cdn.test/pool.jpg", alt: "" }]);
    });

    it("per photo: description and caption; move up / move down / remove are buttons (keyboard-reachable) that reorder the stored list", async () => {
        await mount([GALLERY([{ src: "https://cdn.test/1.jpg", alt: "One" }, { src: "https://cdn.test/2.jpg", alt: "Two", width: 800, height: 600 }, { src: "https://cdn.test/3.jpg", alt: "Three" }])]);
        const input = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
        const setValue = async (el: HTMLInputElement, value: string) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
            await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
            await flush();
        };
        await setValue(input("Photo 2: caption"), "The blue room");
        expect(lastGallery().attrs.items[1]).toEqual({ src: "https://cdn.test/2.jpg", alt: "Two", width: 800, height: 600, caption: "The blue room" });
        await setValue(input("Photo 1: description"), "The garden");
        expect(lastGallery().attrs.items[0].alt).toBe("The garden");
        await click(host.querySelector('button[aria-label="Move photo 3 up"]'));
        expect(lastGallery().attrs.items.map((i: any) => i.src)).toEqual(["https://cdn.test/1.jpg", "https://cdn.test/3.jpg", "https://cdn.test/2.jpg"]);
        await click(host.querySelector('button[aria-label="Move photo 1 down"]'));
        expect(lastGallery().attrs.items.map((i: any) => i.src)).toEqual(["https://cdn.test/3.jpg", "https://cdn.test/1.jpg", "https://cdn.test/2.jpg"]);
        expect(host.querySelector<HTMLButtonElement>('button[aria-label="Move photo 1 up"]')!.disabled).toBe(true);
        expect(host.querySelector<HTMLButtonElement>('button[aria-label="Move photo 3 down"]')!.disabled).toBe(true);
        await click(host.querySelector('button[aria-label="Remove photo 2"]'));
        expect(lastGallery().attrs.items.map((i: any) => i.src)).toEqual(["https://cdn.test/3.jpg", "https://cdn.test/2.jpg"]);
    });
});

describe("BlockEditor → the image block: the single pick is unchanged", () => {
    it("LIBRARY opens the picker in single mode (no Add button, every media kind); one click sets the one address and closes", async () => {
        await mount([{ type: "image", attrs: { src: "", alt: "", caption: "", width: "full", blockWidth: "content" } }]);
        await click(buttonByText(host, "LIBRARY"));
        expect(picker()!.textContent).toContain("Select Media");
        expect(pickerTile("tour.mp4")).toBeDefined();
        expect([...picker()!.querySelectorAll("button")].some((b) => /^Add \d/.test(b.textContent ?? ""))).toBe(false);
        expect(pickerTile("room.jpg")!.hasAttribute("aria-pressed")).toBe(false);
        await click(pickerTile("room.jpg"));
        expect(picker()).toBeNull();
        expect(changes.at(-1)!.find((b: any) => b.type === "image").attrs.src).toBe("https://cdn.test/room.jpg");
    });
});
