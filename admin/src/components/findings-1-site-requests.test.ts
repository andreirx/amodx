// @vitest-environment jsdom
// FINDINGS-1 Part 4 (docs/slices/findings-1.md) — before a site is selected the admin sends neither `GET /content`
// (AdminLayout's link list) nor `GET /system/invalidation` (InvalidationBanner's poll); once a site is selected each
// is sent once. The real components run; the tenant/auth contexts and `apiRequest` are replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ currentTenant: null as null | { id: string; name: string; domain: string } }));
vi.mock("@/context/TenantContext", () => ({
    TenantProvider: ({ children }: { children: ReactNode }) => children,
    useTenant: () => ({ tenants: state.currentTenant ? [state.currentTenant] : [], currentTenant: state.currentTenant, isLoading: false }),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ userRole: "GLOBAL_ADMIN" }) }));
vi.mock("@/lib/api", () => ({ apiRequest: vi.fn(async () => ({ items: [], pending: false })) }));
vi.mock("@/components/layout/Sidebar", () => ({ Sidebar: () => null }));

import { apiRequest } from "@/lib/api";
import { InvalidationBanner } from "@/components/InvalidationBanner";
import AdminLayout from "@/components/layout/AdminLayout";

const SITE = { id: "t1", name: "Site", domain: "site.test" };
const calls = (path: string) => vi.mocked(apiRequest).mock.calls.filter((c) => c[0] === path);

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(apiRequest).mockClear();
    state.currentTenant = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

const render = async (element: ReturnType<typeof createElement>) => {
    await act(async () => { root.render(createElement(MemoryRouter, null, element)); });
};

describe("FINDINGS-1 Part 4 — AdminLayout GET /content", () => {
    it("no site selected → no request", async () => {
        await render(createElement(AdminLayout));
        expect(calls("/content")).toHaveLength(0);
    });

    it("site selected → one request", async () => {
        state.currentTenant = SITE;
        await render(createElement(AdminLayout));
        expect(calls("/content")).toHaveLength(1);
    });

    it("no site, then the site is selected (first sign-in) → one request, after the selection", async () => {
        await render(createElement(AdminLayout));
        expect(calls("/content")).toHaveLength(0);
        state.currentTenant = SITE;
        await render(createElement(AdminLayout));
        expect(calls("/content")).toHaveLength(1);
    });
});

describe("FINDINGS-1 Part 4 — InvalidationBanner GET /system/invalidation", () => {
    it("no site selected → no request", async () => {
        await render(createElement(InvalidationBanner));
        expect(calls("/system/invalidation")).toHaveLength(0);
    });

    it("site selected → one request", async () => {
        state.currentTenant = SITE;
        await render(createElement(InvalidationBanner));
        expect(calls("/system/invalidation")).toHaveLength(1);
    });

    it("no site, then the site is selected (first sign-in) → one request, after the selection", async () => {
        await render(createElement(InvalidationBanner));
        expect(calls("/system/invalidation")).toHaveLength(0);
        state.currentTenant = SITE;
        await render(createElement(InvalidationBanner));
        expect(calls("/system/invalidation")).toHaveLength(1);
    });
});
