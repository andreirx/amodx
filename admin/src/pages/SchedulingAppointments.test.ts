// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route, useNavigate, type NavigateFunction } from "react-router-dom";

/*
 * SCHED-1E2 — the appointment setup page and the booking page (docs/slices/sched-1.md § 4.2, § 10.3, § 23.5). Pure-logic
 * tests (no markup), as Scheduling.test.ts: the service and weekly-hours bodies, and the booking history lines.
 * Replaced: the tenant and auth contexts and Amplify (imported by the pages and by `@/lib/api`), and `apiRequest`
 * (records "<path>" for a read, "<METHOD> <path>" for a write; an answer may be a function returning a promise the
 * test resolves later). Review-0 R1: both pages mounted (jsdom) with answers that arrive late or out of order.
 */
const state = vi.hoisted(() => ({ calls: [] as string[], bodies: [] as (string | null)[], answers: {} as Record<string, unknown> }));
vi.mock("@/context/TenantContext", () => ({ useTenant: () => ({ currentTenant: { id: "A", name: "Site A", domain: "a.example" } }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ userRole: "EDITOR" }) }));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/api")>()),
    apiRequest: vi.fn(async (path: string, options?: { method?: string; body?: string }) => {
        const call = options?.method && options.method !== "GET" ? `${options.method} ${path}` : path;
        state.calls.push(call);
        state.bodies.push(options?.body ?? null);
        if (!(call in state.answers)) throw new Error(`unexpected request ${call}`);
        const answer = state.answers[call];
        return typeof answer === "function" ? (answer as () => Promise<unknown>)() : answer;
    }),
}));

import SchedulingAppointments, { servicePayload, rulesPayload, type ServiceForm } from "./SchedulingAppointments";
import SchedulingAppointmentsBooking, { historyLine } from "./SchedulingAppointmentsBooking";
import type { BookingAdminDTO } from "./SchedulingPlanner";

describe("servicePayload — POST/PUT /scheduling/admin/services", () => {
    const form: ServiceForm = { name: " Consult ", durationMin: "30", eligibility: "all", resourceIds: [] };

    it("a valid form → the § 10.3 body (name trimmed, number duration, eligibility sum)", () => {
        expect(servicePayload(form)).toEqual({ ok: true, body: { name: "Consult", durationMin: 30, eligibility: { kind: "all" } } });
        expect(servicePayload({ ...form, eligibility: "only", resourceIds: ["r1", "r2"] }))
            .toEqual({ ok: true, body: { name: "Consult", durationMin: 30, eligibility: { kind: "only", resourceIds: ["r1", "r2"] } } });
    });

    it("the shared ServiceSchema bounds: duration 7, 0, 485, blank and an empty name are refused, naming the field", () => {
        for (const d of ["7", "0", "485", "", "2.5"]) {
            const p = servicePayload({ ...form, durationMin: d });
            expect({ d, ok: p.ok }).toEqual({ d, ok: false });
            if (!p.ok) expect(p.error).toMatch(/^durationMin: /);
        }
        const noName = servicePayload({ ...form, name: "  " });
        expect(noName.ok).toBe(false);
        if (!noName.ok) expect(noName.error).toMatch(/^name: /);
    });

    it("'only these resources' with none chosen is refused before sending", () => {
        expect(servicePayload({ ...form, eligibility: "only", resourceIds: [] }).ok).toBe(false);
    });
});

describe("rulesPayload — PUT /scheduling/admin/resources/{r}/availability", () => {
    it("rows → rules sorted by weekday and start; an empty list is valid (no weekly hours)", () => {
        expect(rulesPayload([
            { weekday: "2", start: "09:00", end: "12:00" }, { weekday: "1", start: "13:00", end: "17:00" }, { weekday: "1", start: "09:00", end: "12:00" },
        ])).toEqual({ ok: true, body: { rules: [
            { weekday: 1, start: "09:00", end: "12:00" }, { weekday: 1, start: "13:00", end: "17:00" }, { weekday: 2, start: "09:00", end: "12:00" },
        ] } });
        expect(rulesPayload([])).toEqual({ ok: true, body: { rules: [] } });
    });

    it("end before start, a malformed time and weekday 8 are refused with the row named", () => {
        const back = rulesPayload([{ weekday: "1", start: "09:00", end: "12:00" }, { weekday: "1", start: "12:00", end: "09:00" }]);
        expect(back.ok).toBe(false);
        if (!back.ok) expect(back.error).toMatch(/^rules\.1\.end: /);
        expect(rulesPayload([{ weekday: "1", start: "9", end: "12:00" }]).ok).toBe(false);
        expect(rulesPayload([{ weekday: "8", start: "09:00", end: "12:00" }]).ok).toBe(false);
    });
});

describe("historyLine — the booking's history in the site's zone (exhaustive over the four actions)", () => {
    const tz = "Europe/Bucharest";
    const name = (id: string) => (id === "r1" ? "Dr. A" : "(removed resource)");
    const slot = { kind: "slot" as const, resourceId: "r1", start: "2026-12-07T07:00:00.000Z", end: "2026-12-07T07:30:00.000Z" };

    it("created, confirmed, cancelled, moved", () => {
        expect(historyLine({ action: "created", at: "2026-12-01T08:00:00.000Z", state: "held", placement: slot }, tz, name))
            .toBe("Tue 2026-12-01 10:00: created (held), Mon 2026-12-07 09:00 with Dr. A");
        expect(historyLine({ action: "confirmed", at: "2026-12-01T08:05:00.000Z" }, tz, name)).toBe("Tue 2026-12-01 10:05: confirmed");
        expect(historyLine({ action: "cancelled", at: "2026-12-02T08:00:00.000Z", by: { kind: "customer" } }, tz, name))
            .toBe("Wed 2026-12-02 10:00: cancelled by the customer");
        expect(historyLine({
            action: "moved", at: "2026-12-02T09:00:00.000Z", by: { kind: "admin", email: "a@example.com" },
            from: slot, to: { ...slot, resourceId: "r9", start: "2026-12-08T08:00:00.000Z" },
        }, tz, name)).toBe("Wed 2026-12-02 11:00: moved by a@example.com from Mon 2026-12-07 09:00 with Dr. A to Tue 2026-12-08 10:00 with (removed resource)");
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Review-0 R1 — data and writes belong to the current selection
// ---------------------------------------------------------------------------------------------------------------

let root: Root | null = null;
let host: HTMLDivElement;
const nav: { go: NavigateFunction | null } = { go: null };
function Nav() {
    nav.go = useNavigate();
    return null;
}
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    state.calls = [];
    state.bodies = [];
    state.answers = {};
    vi.restoreAllMocks();
});
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}
async function mount(url: string) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
        root = createRoot(host);
        root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Nav),
            createElement(Routes, null,
                createElement(Route, { path: "/scheduling/appointments", element: createElement(SchedulingAppointments) }),
                createElement(Route, { path: "/scheduling/bookings/:bookingId", element: createElement(SchedulingAppointmentsBooking) }))));
    });
    await flush();
}
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await flush(); };
const RESOURCES = [{ id: "r1", name: "Dr. A", hasFeed: false }, { id: "r2", name: "Dr. B", hasFeed: false }];

describe("R1 — weekly hours: the rows shown and saved are the selected resource's", () => {
    it("R1 r1's hours answer arriving after r2 was chosen (and after r2's answer) is dropped; Save sends r2's rows to r2", async () => {
        const r1 = deferred<unknown>();
        const r2 = deferred<unknown>();
        state.answers = {
            "/scheduling/admin/services": { services: [] }, "/scheduling/admin/resources": { resources: RESOURCES },
            "/scheduling/admin/resources/r1/availability": () => r1.promise,
            "/scheduling/admin/resources/r2/availability": () => r2.promise,
            "PUT /scheduling/admin/resources/r2/availability": { rules: [{ weekday: 2, start: "10:00", end: "12:00" }] },
        };
        await mount("/scheduling/appointments");
        const select = host.querySelector("#hours-resource") as HTMLSelectElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "r2");
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await flush();
        expect(button("Save weekly hours")).toBeUndefined(); // nothing to save while r2 loads
        await act(async () => { r2.resolve({ rules: [{ weekday: 2, start: "10:00", end: "12:00" }] }); });
        await flush();
        await act(async () => { r1.resolve({ rules: [{ weekday: 1, start: "09:00", end: "17:00" }] }); });
        await flush();
        expect((host.querySelector('[aria-label="Rule 1 weekday"]') as HTMLSelectElement).value).toBe("2");
        expect((host.querySelector('[aria-label="Rule 1 start"]') as HTMLInputElement).value).toBe("10:00");
        await click(button("Save weekly hours")!);
        const i = state.calls.findIndex((c) => c.startsWith("PUT "));
        expect(state.calls[i]).toBe("PUT /scheduling/admin/resources/r2/availability");
        expect(JSON.parse(state.bodies[i]!)).toEqual({ rules: [{ weekday: 2, start: "10:00", end: "12:00" }] });
    });
});

describe("R1 — booking page: the booking shown and acted on is the route's booking", () => {
    const booking = (id: string, ref: string): BookingAdminDTO => ({
        id, ref, rev: 1,
        what: { kind: "slot", serviceId: "s1", serviceName: "Consult", resourceId: "r1", resourceName: "Dr. A", start: "2026-12-07T07:00:00.000Z", end: "2026-12-07T07:30:00.000Z" },
        state: { kind: "confirmed", at: "2026-12-01T10:00:00.000Z" },
        source: { kind: "visitor" }, who: { email: "ana@example.com", name: "Ana" },
        createdAt: "2026-12-01T10:00:00.000Z", updatedAt: "2026-12-01T10:00:00.000Z",
        history: [{ action: "confirmed", at: "2026-12-01T10:00:00.000Z" }],
    });

    const answers = (b1: () => Promise<BookingAdminDTO>, b2: () => Promise<BookingAdminDTO>) => ({
        "/settings": { scheduling: { timezone: "Europe/Bucharest" } }, "/scheduling/admin/resources": { resources: RESOURCES },
        "/scheduling/admin/bookings/b1": b1, "/scheduling/admin/bookings/b2": b2,
        "POST /scheduling/admin/bookings/b2/cancel": booking("b2", "B-22222222"),
    });

    it("R1 after an in-app move from a shown b1 to b2, b1 is neither shown nor actionable while b2 loads; then Cancel goes to b2", async () => {
        const second = deferred<BookingAdminDTO>();
        state.answers = answers(async () => booking("b1", "B-11111111"), () => second.promise);
        await mount("/scheduling/bookings/b1");
        expect(host.textContent).toContain("Booking B-11111111");
        await act(async () => { void nav.go!("/scheduling/bookings/b2"); });
        await flush();
        expect(host.textContent).not.toContain("B-11111111");
        expect(button("Cancel booking")).toBeUndefined();
        expect(button("Move")).toBeUndefined();
        await act(async () => { second.resolve(booking("b2", "B-22222222")); });
        await flush();
        vi.spyOn(window, "confirm").mockReturnValue(true);
        await click(button("Cancel booking")!);
        expect(state.calls.filter((c) => c.startsWith("POST "))).toEqual(["POST /scheduling/admin/bookings/b2/cancel"]);
    });

    it("R1 b1's answer arriving after the route moved to b2 (and after b2's answer) is dropped", async () => {
        const first = deferred<BookingAdminDTO>();
        const second = deferred<BookingAdminDTO>();
        state.answers = answers(() => first.promise, () => second.promise);
        await mount("/scheduling/bookings/b1");
        await act(async () => { void nav.go!("/scheduling/bookings/b2"); });
        await flush();
        await act(async () => { second.resolve(booking("b2", "B-22222222")); });
        await flush();
        await act(async () => { first.resolve(booking("b1", "B-11111111")); });
        await flush();
        expect(state.calls).toContain("/scheduling/admin/bookings/b1");
        expect(host.textContent).toContain("Booking B-22222222");
        expect(host.textContent).not.toContain("B-11111111");
    });
});
