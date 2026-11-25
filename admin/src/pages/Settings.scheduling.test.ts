// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

// SCHED-MENU-1: real pages, Sidebar and TenantProvider. Only auth and HTTP are replaced.
// The in-memory server is private to each test; it cannot read credentials or contact AWS.
const state = vi.hoisted(() => ({
    settings: {} as Record<string, any>,
    calls: [] as { path: string; method: string; body?: Record<string, any> }[],
    rejectSave: false,
    rejectSettingsRead: false,
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ userRole: "TENANT_ADMIN" }) }));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
    ...(await original<typeof import("@/lib/api")>()),
    apiRequest: async (path: string, options?: { method?: string; body?: string }) => {
        const method = options?.method ?? "GET";
        const body = options?.body ? JSON.parse(options.body) : undefined;
        state.calls.push({ path, method, body });
        if (path === "/tenants") return { items: [{ id: "a", name: "Site A", domain: "a.test",
            schedulingEnabled: state.settings.schedulingEnabled === true, commerceEnabled: state.settings.commerceEnabled === true }] };
        if (path === "/settings" && method === "PUT") {
            if (state.rejectSave) throw new Error("Save refused");
            state.settings = { ...state.settings, ...body };
            return {};
        }
        if (path === "/settings") {
            if (state.rejectSettingsRead) throw new Error("Settings could not be read");
            return structuredClone(state.settings);
        }
        if (path === "/settings/secrets") return {};
        if (path === "/categories" || path === "/service-keys") return { items: [] };
        if (path === "/scheduling/admin/resources") return { resources: [{ id: "r1", name: "Dr A", hasFeed: false }] };
        if (path === "/scheduling/admin/services") return { services: [] };
        if (path === "/scheduling/admin/email-templates") return {
            defaults: Object.fromEntries(["hold", "confirmed", "cancelled", "moved", "reminder", "weekAhead"]
                .map(key => [key, { subject: key, body: key, sendToCustomer: true, sendToAdmin: true }])), overrides: {},
        };
        if (path === "/scheduling/admin/resources/r1/week?start=2026-12-07") return {
            resourceId: "r1", resourceName: "Dr A", timezone: "Europe/Bucharest",
            lastBookableDate: "2027-01-26", defaults: [],
            days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-12-${String(7 + i).padStart(2, "0")}`,
                kind: "planned", source: "default", windows: [], removed: [], entries: [], open: [], outsideHours: [] })),
        };
        throw new Error(`Unexpected local test request: ${method} ${path}`);
    },
}));

import { TenantProvider } from "@/context/TenantContext";
import { Sidebar } from "@/components/layout/Sidebar";
import SettingsPage from "./Settings";
import SchedulingPage from "./Scheduling";
import SchedulingPlanner from "./SchedulingPlanner";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    state.settings = { id: "a", name: "Site A", domain: "a.test", commerceEnabled: false, schedulingEnabled: false };
    state.calls = [];
    state.rejectSave = false;
    state.rejectSettingsRead = false;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    vi.restoreAllMocks();
});
async function mount(page: typeof SettingsPage, path = "/settings") {
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [path] },
        createElement(TenantProvider, null, createElement(Sidebar), createElement("main", null, createElement(page))))));
}
const main = () => host.querySelector("main")!;
const button = (name: string) => [...main().querySelectorAll("button")].find(b => b.textContent?.trim() === name)!;
const checkbox = (name: string) => [...main().querySelectorAll("label")].find(l => l.textContent?.includes(name))!.querySelector("input")!;
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function type(element: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
const nav = () => [...host.querySelectorAll("a")].filter(a => !main().contains(a)).map(a => [a.textContent?.trim(), a.getAttribute("href")]);
const saves = () => state.calls.filter(c => c.method === "PUT");

describe("SCHED-MENU-1 — settings saves update both menu switches through the real TenantProvider", () => {
    it("fresh browser: switch on, set the required time zone, save → two scheduling links; switch off and save → no links", async () => {
        await mount(SettingsPage);
        expect(localStorage.getItem("AMODX_TENANT_ID")).toBe("a");
        expect(nav().some(([, href]) => href?.startsWith("/scheduling"))).toBe(false);
        expect(main().textContent).toContain("Enable individual appointments, confirmed by an emailed link.");
        const cards = [...main().querySelectorAll(".rounded-xl")];
        const commerce = cards.findIndex(c => c.textContent?.includes("Enable Commerce"));
        expect(cards[commerce + 1].textContent).toContain("Enable scheduling");
        await click(checkbox("Enable scheduling"));
        await type(main().querySelector("#settings-scheduling-timezone")!, "Europe/Bucharest");
        // Unsaved edits do not change navigation.
        expect(nav().some(([, href]) => href?.startsWith("/scheduling"))).toBe(false);
        await click(button("Save Changes"));
        expect(saves()[0].body).toMatchObject({ schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" } });
        expect(nav()).toEqual(expect.arrayContaining([
            ["Appointments", "/scheduling/planner"], ["Scheduling settings", "/scheduling"],
        ]));
        expect(state.calls.filter(c => c.path === "/tenants")).toHaveLength(2);
        await click(checkbox("Enable scheduling"));
        await click(button("Save Changes"));
        expect(saves()[1].body).toMatchObject({ schedulingEnabled: false, scheduling: { timezone: "Europe/Bucharest" } });
        expect(nav().some(([, href]) => href?.startsWith("/scheduling"))).toBe(false);
    });

    it("commerce uses the same refresh path: Customers appears after save and disappears after the next save", async () => {
        await mount(SettingsPage);
        expect(nav()).not.toContainEqual(["Customers", "/customers"]);
        await click(checkbox("Enable Commerce"));
        await click(button("Save Changes"));
        expect(saves()[0].body?.commerceEnabled).toBe(true);
        expect(nav()).toContainEqual(["Customers", "/customers"]);
        await click(checkbox("Enable Commerce"));
        await click(button("Save Changes"));
        expect(saves()[1].body?.commerceEnabled).toBe(false);
        expect(nav()).not.toContainEqual(["Customers", "/customers"]);
    });

    it("a failed save leaves the scheduling menu off and shows the error", async () => {
        await mount(SettingsPage);
        await click(checkbox("Enable scheduling"));
        await type(main().querySelector("#settings-scheduling-timezone")!, "UTC");
        state.rejectSave = true;
        await click(button("Save Changes"));
        expect(main().textContent).toContain("Save refused");
        expect(nav().some(([, href]) => href?.startsWith("/scheduling"))).toBe(false);
        expect(state.calls.filter(c => c.path === "/tenants")).toHaveLength(1);
    });

    it("changing the initial time zone keeps existing scheduling limits", async () => {
        state.settings = { ...state.settings, schedulingEnabled: true, scheduling: {
            timezone: "UTC", holdMinutes: 60, changeCutoffHours: 12, reminderHours: 0, bookingHorizonWeeks: 3,
        } };
        await mount(SettingsPage);
        await type(main().querySelector("#settings-scheduling-timezone")!, "Europe/Bucharest");
        await click(button("Save Changes"));
        expect(saves()[0].body?.scheduling).toEqual({
            timezone: "Europe/Bucharest", holdMinutes: 60, changeCutoffHours: 12, reminderHours: 0, bookingHorizonWeeks: 3,
        });
    });
});

describe("SCHED-MENU-1 — Scheduling settings never changes the enable flag", () => {
    it("a failed settings read shows the error, not an unsupported claim that scheduling is off", async () => {
        state.rejectSettingsRead = true;
        await mount(SchedulingPage, "/scheduling");
        expect(main().textContent).toBe("Settings could not be read");
        expect(main().textContent).not.toContain("Scheduling is off for this site.");
        expect(main().querySelector("input, button")).toBeNull();
    });

    it("direct address while off: only the sentence and Settings link; no switch, forms or scheduling requests", async () => {
        await mount(SchedulingPage, "/scheduling");
        expect(main().textContent).toBe("Scheduling is off for this site.Settings");
        expect(main().querySelector("a")?.getAttribute("href")).toBe("/settings");
        expect(main().querySelector("input, button")).toBeNull();
        expect(state.calls.some(c => c.path.startsWith("/scheduling"))).toBe(false);
    });

    it("settings and mail-template Save buttons send no schedulingEnabled; the on/off controls are absent", async () => {
        state.settings = { ...state.settings, schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" } };
        await mount(SchedulingPage, "/scheduling");
        expect(main().textContent).not.toMatch(/Turn (on|off) scheduling|Enable scheduling/);
        await type(main().querySelector("#sched-holdMinutes")!, "45");
        await click(button("Save settings"));
        expect(saves()[0]).toEqual({ path: "/settings", method: "PUT", body: {
            scheduling: { timezone: "Europe/Bucharest", holdMinutes: 45, changeCutoffHours: 24, reminderHours: 24, bookingHorizonWeeks: 8 },
        } });
        await click(button("Save all templates"));
        expect(Object.keys(saves()[1].body!)).toEqual(["schedulingEmailConfig"]);
        for (const save of saves()) expect(save.body).not.toHaveProperty("schedulingEnabled");
    });

    it("mail link in a fresh browser still selects its allowed site and opens the requested week", async () => {
        state.settings = { ...state.settings, schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" } };
        expect(localStorage.getItem("AMODX_TENANT_ID")).toBeNull();
        await mount(SchedulingPlanner, "/scheduling/planner?tenant=a&week=2026-12-07");
        expect(localStorage.getItem("AMODX_TENANT_ID")).toBe("a");
        expect(main().textContent).toContain("Dr A: week of 2026-12-07");
        expect(state.calls.filter(c => c.path.endsWith("/week?start=2026-12-07"))).toHaveLength(1);
        expect(main().querySelector('a[href="/scheduling/appointments"]')).not.toBeNull();
    });
});
