// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * STAY-1A (docs/slices/stay-1.md § 2, Build record) — the submissions page shows a stored date (`YYYY-MM-DD`, keyed by
 * label as the submit handler stores it) in the site's locale (`currentTenant.locale`, ro-RO here). The real page in
 * jsdom; replaced: the tenant context, Amplify, `apiRequest`. As FormSubmissions.shop-look-1e.test.ts.
 */
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ tenants: [], currentTenant: { id: "t1", name: "T", domain: "t.test", locale: "ro-RO" }, selectTenant: () => {}, refreshTenants: async () => {} }),
}));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));
const FORM = {
    id: "form-stay", name: "Request a stay", slug: "stay", status: "active",
    fields: [
        { id: "f-room", label: "Room", type: "text", required: true },
        { id: "f-arr", label: "Arrival", type: "date", required: true, min: "today" },
        { id: "f-dep", label: "Departure", type: "date", required: false },
    ],
    dateOrder: { earlier: "f-arr", later: "f-dep" },
};
const SUBMISSION = {
    id: "s1", tenantId: "t1", formId: "form-stay", formName: "Request a stay", status: "new", createdAt: "2026-11-27T10:00:00.000Z",
    data: { Room: "Blue room", Arrival: "2026-12-01", Departure: "" }, submitterEmail: null,
};
vi.mock("@/lib/api", () => ({
    apiRequest: vi.fn(async (path: string) => {
        if (path === "/forms/form-stay") return FORM;
        if (path === "/forms/form-stay/submissions") return { items: [SUBMISSION] };
        throw new Error(`unexpected ${path}`);
    }),
}));

import FormSubmissions from "./FormSubmissions";

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

describe("FormSubmissions — a stay request", () => {
    it("the arrival in the site's locale (01.12.2026 for ro-RO); the empty departure blank; the text unchanged", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        act(() => {
            root = createRoot(host);
            root.render(createElement(MemoryRouter, { initialEntries: ["/forms/form-stay/submissions"] },
                createElement(Routes, null, createElement(Route, { path: "/forms/:id/submissions", element: createElement(FormSubmissions) }))));
        });
        for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        const cells = [...host.querySelectorAll("tbody tr td")].map((td) => td.textContent);
        expect(cells.slice(0, 4)).toEqual(["new", "Blue room", "01.12.2026", ""]);
    });
});
