// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * SHOP-LOOK-1E (record docs/slices/shop-look-1e.md § 3) — the submissions page shows a submission in the shape the
 * corrected handler stores (`backend/src/forms/public-submit.ts`): `data` keyed by field LABEL with cleaned values (a
 * string, a number, a boolean), `submitterEmail` at the top level. The real page in jsdom (its load effect runs);
 * replaced: the tenant context, Amplify, and `apiRequest` (the form definition and one stored submission).
 */
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ tenants: [], currentTenant: { id: "t1", name: "T", domain: "t.test" }, selectTenant: () => {}, refreshTenants: async () => {} }),
}));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));
const FORM = {
    id: "form-1", name: "Contact", slug: "contact", status: "active",
    fields: [
        { id: "8b1d-uuid-name", label: "Name", type: "text", required: true },
        { id: "8b1d-uuid-mail", label: "E-mail", type: "email", required: true },
        { id: "8b1d-uuid-interest", label: "Primary interest", type: "select", required: false, options: ["Hardwood", "Carpet"] },
        { id: "8b1d-uuid-rooms", label: "Rooms", type: "number", required: false },
        { id: "8b1d-uuid-terms", label: "Terms", type: "checkbox", required: true },
        { id: "8b1d-uuid-msg", label: "Message", type: "textarea", required: false },
    ],
};
/** A record as the corrected handler writes it (forms-public-submit.test.ts "each field type …"). */
const SUBMISSION = {
    id: "s1", tenantId: "t1", formId: "form-1", formName: "Contact", status: "new", createdAt: "2026-11-16T10:00:00.000Z",
    data: { Name: "Ana", "E-mail": "ana@example.com", "Primary interest": "Carpet", Rooms: 3, Terms: true, Message: "" },
    submitterEmail: "ana@example.com",
};
vi.mock("@/lib/api", () => ({
    apiRequest: vi.fn(async (path: string) => {
        if (path === "/forms/form-1") return FORM;
        if (path === "/forms/form-1/submissions") return { items: [SUBMISSION] };
        throw new Error(`unexpected ${path}`);
    }),
}));

import FormSubmissions from "./FormSubmissions";

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

describe("FormSubmissions — a submission stored by the corrected handler", () => {
    it("one column per field (the label), each cell the value stored under that label, then the submitter email", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        act(() => {
            root = createRoot(host);
            root.render(createElement(MemoryRouter, { initialEntries: ["/forms/form-1/submissions"] },
                createElement(Routes, null, createElement(Route, { path: "/forms/:id/submissions", element: createElement(FormSubmissions) }))));
        });
        for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        const headers = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
        expect(headers).toEqual(["Status", "Name", "E-mail", "Primary interest", "Rooms", "Terms", "Message", "Email", "Submitted At"]);
        const cells = [...host.querySelectorAll("tbody tr td")].map((td) => td.textContent);
        // Label-keyed values are shown with String(): a checkbox reads "true" / "false" (the "Yes" / "No" form is used
        // only for values stored under the field id — finding F-1E-SUBMISSIONS-CHECKBOX); a blank value reads "".
        expect(cells.slice(0, 8)).toEqual(["new", "Ana", "ana@example.com", "Carpet", "3", "true", "", "ana@example.com"]);
    });
});
