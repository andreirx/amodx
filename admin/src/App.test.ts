// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBrowserRouter, createMemoryRouter, matchRoutes, RouterProvider } from "react-router-dom";
import { getCurrentUser } from "aws-amplify/auth";

// Keep the production route table and guard, real layout/menu/login; replace external I/O only.
vi.mock("aws-amplify/auth", () => ({ getCurrentUser: vi.fn(), signIn: vi.fn(), confirmSignIn: vi.fn(), signOut: vi.fn() }));
vi.mock("react-router-dom", async (original) => ({
    ...await original<typeof import("react-router-dom")>(),
    createBrowserRouter: vi.fn(() => ({})), // importing the table must not install a browser router in this test
}));
vi.mock("@/context/AuthContext", () => ({
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({ userRole: "EDITOR" }),
}));
vi.mock("@/context/TenantContext", () => ({
    TenantProvider: ({ children }: { children: ReactNode }) => children,
    useTenant: () => ({ tenants: [], currentTenant: null, isLoading: false }),
}));
vi.mock("@/lib/api", () => ({ apiRequest: vi.fn(async () => ({ items: [] })) }));
vi.mock("@/components/editor/BlockEditor", () => ({ BlockEditor: () => null }));

import { appRoutes } from "./App";
import SchedulingPlanner from "@/pages/SchedulingPlanner";
import ContentList from "@/pages/ContentList";

let root: Root;
let host: HTMLDivElement;
let router: ReturnType<typeof createMemoryRouter> | undefined;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(getCurrentUser).mockResolvedValue({ username: "test-user", userId: "test-user" });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    router?.dispose();
    router = undefined;
    host.remove();
});

async function mount(path: string) {
    router = createMemoryRouter(appRoutes, { initialEntries: [path] });
    await act(async () => { root.render(createElement(RouterProvider, { router: router! })); });
}

describe("F3 protected not-found route", () => {
    it("the production table resolves unknown paths to the shell's wildcard; known paths stay unchanged", () => {
        expect(createBrowserRouter).toHaveBeenCalledWith(appRoutes);
        for (const path of ["/scheduling/courses", "/mistyped/path"]) {
            const matches = matchRoutes(appRoutes, path)!;
            expect(matches.map((m) => m.route.path)).toEqual(["/", "*"]);
            expect(matches.at(-1)!.route.element).toBe(appRoutes[1].children!.at(-1)!.element);
        }
        expect(matchRoutes(appRoutes, "/scheduling/planner")!.at(-1)!.route.element.type).toBe(SchedulingPlanner);
        expect(matchRoutes(appRoutes, "/")!.at(-1)!.route.element.type).toBe(ContentList);
    });
    it("signed in: Page not found inside the normal menu, with a link to /", async () => {
        await mount("/scheduling/courses");
        expect(host.querySelector("h1")?.textContent).toBe("Page not found");
        const links = [...host.querySelectorAll("a")];
        expect(links.find((a) => a.textContent === "Go to start page")?.getAttribute("href")).toBe("/");
        expect(links.find((a) => a.textContent === "Pages")?.getAttribute("href")).toBe("/");
        expect(links.find((a) => a.textContent === "Settings")?.getAttribute("href")).toBe("/settings");
        expect(host.textContent).not.toContain("Unexpected Application Error");
    });
    it.each(["/scheduling/courses?week=2026-12-07", "/scheduling/planner?tenant=test-tenant"])(
        "signed out: %s uses the existing login redirect with path and query kept", async (path) => {
            vi.mocked(getCurrentUser).mockRejectedValue(new Error("signed out"));
            await mount(path);
            expect(router!.state.location.pathname).toBe("/login");
            expect(router!.state.location.search).toBe(`?next=${encodeURIComponent(path)}`);
            expect(host.querySelector("h1")?.textContent).not.toBe("Page not found");
            expect(host.textContent).not.toContain("Go to start page");
        },
    );
});
