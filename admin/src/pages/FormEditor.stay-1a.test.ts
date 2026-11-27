// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, createMemoryRouter, RouterProvider } from "react-router-dom";

/**
 * STAY-1A (docs/slices/stay-1.md § 2, ruling 9) — the form editor: the field picker offers "Date"; a date field has the
 * "Not before today" switch (`min: "today"`); the "Date Order" card (the pair rule) shows only when the form has two or
 * more date fields; the save sends the rule, `null` to remove one the form had, nothing for a form that never had one.
 * The real page in jsdom; replaced: the tenant context, Amplify, `apiRequest`. Admin texts English.
 */
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ tenants: [], currentTenant: { id: "t1", name: "T", domain: "t.test" }, selectTenant: () => {}, refreshTenants: async () => {} }),
}));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));
const api = vi.hoisted(() => ({
    form: null as any, calls: [] as { path: string; init?: any }[],
    /** Per-id forms for the transition rows; a Promise = an answer the test releases later. */
    forms: {} as Record<string, any>,
}));
vi.mock("@/lib/api", () => ({
    apiRequest: vi.fn(async (path: string, init?: any) => {
        api.calls.push({ path, init });
        const id = path.startsWith("/forms/") ? path.slice("/forms/".length) : null;
        if (!init && id !== null && Object.hasOwn(api.forms, id)) return api.forms[id];
        if (path === "/forms/f1" && !init) return api.form;
        return {};
    }),
}));

import FormEditor, { FIELD_TYPES, dateOrderToSave, dateOrderStateOf } from "./FormEditor";

const ARR = { id: "f-arr", label: "Arrival", type: "date" as const, required: true, placeholder: "", options: [], min: "today" as const };
const DEP = { id: "f-dep", label: "Departure", type: "date" as const, required: false, placeholder: "", options: [] };
const ROOM = { id: "f-room", label: "Room", type: "text" as const, required: true, placeholder: "", options: [] };

describe("the field picker", () => {
    it("offers the eight types in order, Date last", () => {
        expect(FIELD_TYPES).toEqual([
            { value: "text", label: "Text" }, { value: "email", label: "Email" }, { value: "phone", label: "Phone" },
            { value: "textarea", label: "Textarea" }, { value: "select", label: "Select" }, { value: "checkbox", label: "Checkbox" },
            { value: "number", label: "Number" }, { value: "date", label: "Date" },
        ]);
    });
});

describe("dateOrderToSave (pure)", () => {
    const fields = [ARR, DEP, ROOM];
    it("neither picked → no rule; both → the rule", () => {
        expect(dateOrderToSave(fields, { earlier: null, later: null })).toEqual({ ok: true, value: null });
        expect(dateOrderToSave(fields, { earlier: "f-arr", later: "f-dep" })).toEqual({ ok: true, value: { earlier: "f-arr", later: "f-dep" } });
    });
    it("one picked, or the same field twice → an error (the save stops)", () => {
        expect(dateOrderToSave(fields, { earlier: "f-arr", later: null }).ok).toBe(false);
        expect(dateOrderToSave(fields, { earlier: "f-arr", later: "f-arr" })).toEqual({ ok: false, error: "Date order: choose two different date fields." });
    });
    it("fewer than two date fields (the pickers hidden) → no rule, whatever was picked", () => {
        expect(dateOrderToSave([ARR, ROOM], { earlier: "f-arr", later: "f-dep" })).toEqual({ ok: true, value: null });
        expect(dateOrderToSave([ROOM], { earlier: "f-arr", later: "f-dep" })).toEqual({ ok: true, value: null });
    });
    it("two date fields: a picked id that is no longer a date field counts as not picked (the picker shows None)", () => {
        const NEW = { ...DEP, id: "f-new", label: "Check-out" };
        expect(dateOrderToSave([ARR, NEW, ROOM], { earlier: "f-arr", later: "f-dep" }).ok).toBe(false);
        expect(dateOrderToSave([ARR, DEP, ROOM], { earlier: "f-arr", later: "f-room" }).ok).toBe(false);
    });
});

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { api.calls = []; api.forms = {}; });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

async function open(form: any) {
    api.form = { id: "f1", name: "Request a stay", slug: "stay", status: "active", submitButtonText: "Send", successMessage: "", notifyEmail: "", ...form };
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
        root = createRoot(host);
        root.render(createElement(MemoryRouter, { initialEntries: ["/forms/f1"] },
            createElement(Routes, null,
                createElement(Route, { path: "/forms/:id", element: createElement(FormEditor) }),
                createElement(Route, { path: "/forms", element: createElement("p", null, "list") }))));
    });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const titles = () => [...host.querySelectorAll("h3, [class*='font-semibold']")].map((e) => e.textContent);
const switchOf = (text: string) => [...host.querySelectorAll("label")].find((l) => l.textContent === text)?.querySelector("input") as HTMLInputElement | undefined;
const save = async () => {
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save")!;
    await act(async () => { button.click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const putBody = () => JSON.parse(api.calls.find((c) => c.init?.method === "PUT")!.init.body);

describe("the editor page", () => {
    it("two date fields: the Date Order card; the Not before today switch on the date fields only, checked by min", async () => {
        await open({ fields: [ARR, DEP, ROOM], dateOrder: { earlier: "f-arr", later: "f-dep" } });
        expect(titles()).toContain("Date Order");
        const switches = [...host.querySelectorAll("label")].filter((l) => l.textContent === "Not before today").map((l) => (l.querySelector("input") as HTMLInputElement).checked);
        expect(switches).toEqual([true, false]);
    });

    it("one date field: no Date Order card", async () => {
        await open({ fields: [ARR, ROOM] });
        expect(titles()).not.toContain("Date Order");
        expect(switchOf("Not before today")!.checked).toBe(true);
    });

    it("save: the fields with min, and the rule as loaded", async () => {
        await open({ fields: [ARR, DEP, ROOM], dateOrder: { earlier: "f-arr", later: "f-dep" } });
        await save();
        const body = putBody();
        expect(body.dateOrder).toEqual({ earlier: "f-arr", later: "f-dep" });
        expect(body.fields.map((f: any) => [f.id, f.type, f.min])).toEqual([["f-arr", "date", "today"], ["f-dep", "date", undefined], ["f-room", "text", undefined]]);
    });

    it("save: the switch turned off removes min", async () => {
        await open({ fields: [ARR, ROOM] });
        act(() => { switchOf("Not before today")!.click(); });
        await save();
        expect("min" in putBody().fields[0]).toBe(false);
    });

    it("save: a form that had a rule and now has one date field sends dateOrder null; a form that never had one sends no key", async () => {
        await open({ fields: [ARR, ROOM], dateOrder: { earlier: "f-arr", later: "f-dep" } });
        await save();
        expect(putBody().dateOrder).toBeNull();
        act(() => root?.unmount()); root = null; document.body.innerHTML = ""; api.calls = [];
        await open({ fields: [ROOM] });
        await save();
        expect("dateOrder" in putBody()).toBe(false);
    });
});

// F-STAY1A-EDITOR-RULE-LEAK (review-0): ONE editor stays mounted across `/forms/:id` changes (App.tsx: one route
// `forms/:id`). The rule state belongs to the form on screen: it resets at each change and every loaded answer sets it;
// an answer for a form no longer on screen is ignored.
describe("the editor across form changes (same mounted editor)", () => {
    const form = (id: string, over: Record<string, unknown> = {}) => ({
        id, name: `Form ${id}`, slug: id, status: "active", submitButtonText: "Send", successMessage: "", notifyEmail: "",
        fields: [ARR, DEP, ROOM], ...over,
    });
    let router: ReturnType<typeof createMemoryRouter>;
    const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
    async function mountAt(path: string) {
        router = createMemoryRouter([
            { path: "/forms/:id", element: createElement(FormEditor) },
            { path: "/forms", element: createElement("p", null, "list") },
        ], { initialEntries: [path] });
        host = document.createElement("div");
        document.body.appendChild(host);
        act(() => { root = createRoot(host); root.render(createElement(RouterProvider, { router })); });
        await settle();
    }
    const go = async (path: string) => { await act(async () => { await router.navigate(path); }); await settle(); };
    const lastWrite = () => { const c = api.calls.filter((x) => x.init?.method === "PUT" || x.init?.method === "POST").at(-1)!; return { path: c.path, body: JSON.parse(c.init.body) }; };

    it("dateOrderStateOf: a rule → its ids; absent or malformed → none", () => {
        expect(dateOrderStateOf({ earlier: "a", later: "b" })).toEqual({ draft: { earlier: "a", later: "b" }, had: true });
        for (const v of [undefined, null, "a>b", { earlier: "a" }, { earlier: 1, later: "b" }]) {
            expect(dateOrderStateOf(v)).toEqual({ draft: { earlier: null, later: null }, had: false });
        }
    });

    it("F1 with a rule → F2 (same field ids, no rule): saving F2 sends no dateOrder (the reviewer's reproduction)", async () => {
        api.forms = { f1: form("f1", { dateOrder: { earlier: "f-arr", later: "f-dep" } }), f2: form("f2") };
        await mountAt("/forms/f1");
        await go("/forms/f2");
        await save();
        const write = lastWrite();
        expect(write.path).toBe("/forms/f2");
        expect(write.body.name).toBe("Form f2");
        expect("dateOrder" in write.body).toBe(false);
    });

    it("F1 without a rule → F2 with a rule: saving F2 sends F2's rule", async () => {
        api.forms = { f1: form("f1"), f2: form("f2", { dateOrder: { earlier: "f-arr", later: "f-dep" } }) };
        await mountAt("/forms/f1");
        await go("/forms/f2");
        await save();
        expect(lastWrite()).toMatchObject({ path: "/forms/f2", body: { dateOrder: { earlier: "f-arr", later: "f-dep" } } });
    });

    it("F1 with a rule → New: the new form's save sends no dateOrder", async () => {
        api.forms = { f1: form("f1", { dateOrder: { earlier: "f-arr", later: "f-dep" } }) };
        await mountAt("/forms/f1");
        await go("/forms/new");
        await save();
        const write = lastWrite();
        expect(write.path).toBe("/forms");
        expect("dateOrder" in write.body).toBe(false);
    });

    it("a late answer for F1 (with a rule) after the move to F2 is ignored: saving F2 sends F2 only", async () => {
        let releaseF1!: (v: unknown) => void;
        api.forms = { f1: new Promise((r) => { releaseF1 = r; }), f2: form("f2") };
        await mountAt("/forms/f1");
        await go("/forms/f2");
        await act(async () => { releaseF1(form("f1", { name: "Late F1", dateOrder: { earlier: "f-arr", later: "f-dep" } })); });
        await settle();
        await save();
        const write = lastWrite();
        expect(write.path).toBe("/forms/f2");
        expect(write.body.name).toBe("Form f2");
        expect("dateOrder" in write.body).toBe(false);
    });
});
