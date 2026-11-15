// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * SHOP-LOOK-1E (record docs/slices/shop-look-1e.md § 3) — the `form` block's picker in the REAL BlockEditor (jsdom): the
 * editor injects `fetchFormsFn` (`GET /forms`, the list the Forms page shows) into the block's storage, and the block
 * editor offers the tenant's forms by name. Replaced: `apiRequest` (records the path), the toolbar, the media picker and
 * the upload helper (not under test).
 */
const api = vi.hoisted(() => ({ calls: [] as string[], fail: false }));
vi.mock("@/lib/api", () => ({
    apiRequest: vi.fn(async (path: string) => {
        api.calls.push(path);
        if (api.fail) throw new Error("API Error (500): down");
        if (path === "/forms") return { items: [
            { id: "1", name: "Contact us", slug: "contact", status: "active", createdAt: "2026-11-02" },
            { id: "2", name: "Old survey", slug: "survey", status: "disabled", createdAt: "2026-11-01" },
        ] };
        return { items: [] };
    }),
}));
vi.mock("./Toolbar", () => ({ Toolbar: () => null }));
vi.mock("@/components/MediaPicker", () => ({ MediaPicker: () => null }));
vi.mock("@/lib/upload", () => ({ uploadFile: vi.fn() }));

import { BlockEditor } from "./BlockEditor";

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    api.calls = [];
    api.fail = false;
});
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function mountWithForm(attrs: Record<string, unknown>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(createElement(BlockEditor, { initialContent: [{ type: "form", attrs }], onChange: () => {} })); });
    await flush();
}
const pickerOptions = () => [...host.querySelectorAll("select")].find((s) => s.closest("[data-node-view-wrapper]") && [...s.options].some((o) => o.text.includes("form") || o.text.includes("Contact")))!;

describe("BlockEditor → the form block's picker", () => {
    it("the editor calls GET /forms once and offers each form by name (a disabled one marked); the stored slug is selected", async () => {
        await mountWithForm({ formSlug: "contact", eyebrow: "", headline: "", text: "", card: false, blockWidth: "content" });
        expect(api.calls.filter((p) => p === "/forms")).toEqual(["/forms"]);
        const select = pickerOptions();
        expect([...select.options].map((o) => [o.value, o.text])).toEqual([["", "Pick a form…"], ["contact", "Contact us"], ["survey", "Old survey (disabled)"]]);
        expect(select.value).toBe("contact");
        expect(host.textContent).not.toContain("the site shows nothing");
    });

    it("a stored slug of a disabled form: the note says the site shows nothing", async () => {
        await mountWithForm({ formSlug: "survey", eyebrow: "", headline: "", text: "", card: false, blockWidth: "content" });
        expect(host.textContent).toContain("Form disabled — the site shows nothing.");
    });

    it("the list fails to load: no form offered, the stored slug kept as an option, no throw", async () => {
        api.fail = true;
        vi.spyOn(console, "error").mockImplementation(() => {});
        await mountWithForm({ formSlug: "contact", eyebrow: "", headline: "", text: "", card: false, blockWidth: "content" });
        const select = [...host.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "contact"))!;
        expect([...select.options].map((o) => [o.value, o.text])).toEqual([["", "No forms found"], ["contact", "contact"]]);
    });
});
