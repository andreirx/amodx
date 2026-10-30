// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InterestToggle } from "@/components/InterestShortlist";

/**
 * CAT-INTEREST-1, review-0 F4 — the product-page toggle binds the chosen option to the CURRENT product. The real
 * component, mounted with React in jsdom (no Next, no server). The reviewer's reproduction: product A with "red"
 * checked, then the SAME component instance re-rendered for product B with nothing checked (what a client navigation
 * that keeps the component does) — before the fix it still showed and saved "red" for B.
 * (SitePage also keys the presenter and the toggle by product, so a real navigation remounts both; this row pins the
 * component's own rule, independent of that key.)
 */

let root: Root | null = null;
let host: HTMLDivElement;

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
});

/** The presenter's radio group as SitePage renders it (`catalog-option-<group id>`). */
function presenter(values: string[], checked?: string) {
    const group = document.createElement("fieldset");
    group.id = "presenter";
    for (const v of values) {
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "catalog-option-format";
        input.value = v;
        input.checked = v === checked;
        group.appendChild(input);
    }
    document.getElementById("presenter")?.remove();
    document.body.prepend(group);
}

const props = (productId: string) => ({
    tenantId: `t-f4-${productId}`, productId, title: `Product ${productId}`, slug: productId,
    optionGroupName: "catalog-option-format", options: [], variant: "page" as const,
});
const button = () => host.querySelector("button")!;
const saved = (tenantId: string) => JSON.parse(localStorage.getItem(`amodx:interest:${tenantId}`) ?? "{\"items\":[]}").items;

describe("InterestToggle — the option belongs to the current product (review-0 F4)", () => {
    it("product A with red checked → product B with nothing checked: no option shown, B saved WITHOUT an option", () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        presenter(["red", "blue"], "red");
        act(() => { root = createRoot(host); root.render(createElement(InterestToggle, props("a"))); });
        expect(button().textContent).toBe("Mă interesează (red)");

        presenter(["green", "yellow"]);                 // product B's presenter, nothing chosen yet
        act(() => root!.render(createElement(InterestToggle, { ...props("b"), tenantId: "t-f4-a" })));
        expect(button().textContent).toBe("Mă interesează");

        act(() => button().click());
        expect(saved("t-f4-a")).toEqual([expect.objectContaining({ productId: "b" })]);
        expect(saved("t-f4-a")[0]).not.toHaveProperty("optionValue");
    });

    it("product B with an option checked when it arrives → that option, not A's", () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        presenter(["red", "blue"], "blue");
        act(() => { root = createRoot(host); root.render(createElement(InterestToggle, props("a"))); });
        presenter(["green", "yellow"], "yellow");
        act(() => root!.render(createElement(InterestToggle, { ...props("b"), tenantId: "t-f4-a" })));
        expect(button().textContent).toBe("Mă interesează (yellow)");
    });

    it("a change in the presenter after mount is followed", () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        presenter(["red", "blue"]);
        act(() => { root = createRoot(host); root.render(createElement(InterestToggle, props("c"))); });
        expect(button().textContent).toBe("Mă interesează");
        const blue = document.querySelector<HTMLInputElement>('input[value="blue"]')!;
        act(() => { blue.checked = true; blue.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(button().textContent).toBe("Mă interesează (blue)");
    });
});
