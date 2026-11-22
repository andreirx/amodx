// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * SCHED-1E2 — the week planner and the planner link (docs/slices/sched-1.md § 23.5; rows E15, E17-E21, E24 of § 17.3).
 * Pure functions are tested directly; the link rows E17, E19, E20 and the sign-in row E18 also mount the real page
 * (jsdom, react-dom) with the tenant context, `apiRequest` and Amplify replaced, so "no scheduling request is sent" and
 * "selectTenant once" are observed on the page, not inferred from a helper.
 * Review-0 regressions: R1 (answers that arrive late or for an older selection; in-app navigation to a link of another
 * site), R2 (manual appointment with a service visitors cannot book on that resource), R3 (clock-change days), R4 (a
 * 5-minute and a 30-minute booking: full text and actions do not depend on the block's height).
 * `apiRequest` records "<path>" for a read and "<METHOD> <path>" for a write; an answer may be a function (a promise
 * the test resolves later).
 */
const state = vi.hoisted(() => ({
    tenant: { tenants: [] as { id: string; name: string; domain: string }[], currentTenant: null as { id: string; name: string; domain: string } | null, isLoading: false },
    selectTenant: [] as string[],
    calls: [] as string[],
    answers: {} as Record<string, unknown>,
    bodies: [] as (string | null)[],
    signIn: { isSignedIn: true, nextStep: { signInStep: "DONE" } } as unknown,
}));
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ ...state.tenant, selectTenant: (id: string) => { state.selectTenant.push(id); }, refreshTenants: async () => {} }),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ userRole: "EDITOR" }) }));
vi.mock("aws-amplify/auth", () => ({
    signOut: vi.fn(), fetchAuthSession: vi.fn(),
    signIn: vi.fn(async () => state.signIn),
    confirmSignIn: vi.fn(async () => ({ isSignedIn: true })),
}));
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

import SchedulingPlanner, {
    addDays, mondayOf, weekdayOf, todayIn, formatWhen, parsePlannerQuery, plannerAccess, weekView, daySettingOf, copyWeekBody,
    editResultText, startInstant, manualAppointmentBody, moveSlotBody, plannerErrorText,
    type WeekPlanDTO, type DayDTO, type AppointmentForm, type Segment, type BookingAdminDTO,
} from "./SchedulingPlanner";
import LoginPage, { isSafeReturnPath, afterSignInPath, loginPathFor } from "./Login";
import { ApiError } from "@/lib/api";

const TZ = "Europe/Bucharest"; // UTC+2 in December

// ---------------------------------------------------------------------------------------------------------------
// Week arithmetic and the page query
// ---------------------------------------------------------------------------------------------------------------

describe("week arithmetic (pure)", () => {
    it("addDays crosses months and years; weekdayOf is ISO; mondayOf gives the week's Monday", () => {
        expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
        expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
        expect(weekdayOf("2026-12-07")).toBe(1);
        expect(weekdayOf("2026-12-13")).toBe(7);
        expect(mondayOf("2026-12-09")).toBe("2026-12-07");
        expect(mondayOf("2026-12-13")).toBe("2026-12-07");
        expect(mondayOf("2026-12-07")).toBe("2026-12-07");
        expect(mondayOf("2027-01-01")).toBe("2026-12-28");
    });

    it("todayIn and formatWhen use the given zone, never the browser's", () => {
        // 2026-12-06T22:30Z is Monday 00:30 in Bucharest, still Sunday in UTC.
        expect(todayIn(TZ, Date.parse("2026-12-06T22:30:00Z"))).toBe("2026-12-07");
        expect(todayIn("UTC", Date.parse("2026-12-06T22:30:00Z"))).toBe("2026-12-06");
        expect(formatWhen("2026-12-07T07:00:00.000Z", TZ)).toBe("Mon 2026-12-07 09:00");
    });
});

describe("E24 — planner page query (absent / valid / malformed)", () => {
    it("E24 no tenant and no week → both absent (the current site's current week)", () => {
        expect(parsePlannerQuery("")).toEqual({ tenant: null, week: null, resource: null });
    });
    it("E24 week=2026-12-07 → that week; week=2026-12-09 → the week that contains it (Monday 2026-12-07)", () => {
        expect(parsePlannerQuery("?week=2026-12-07").week).toBe("2026-12-07");
        expect(parsePlannerQuery("?week=2026-12-09").week).toBe("2026-12-07");
    });
    it("E24 week=garbage (and other malformed dates) → absent: the current week", () => {
        for (const w of ["garbage", "2026-12-32", "12/07/2026", "2026-02-30", ""]) expect(parsePlannerQuery(`?week=${w}`).week).toBeNull();
    });
    it("E24 tenant= empty → absent (no switch)", () => {
        expect(parsePlannerQuery("?tenant=&week=2026-12-07").tenant).toBeNull();
        expect(plannerAccess({ loading: false, linkTenant: parsePlannerQuery("?tenant=").tenant, currentTenantId: "B", tenantIds: ["A", "B"] }))
            .toEqual({ kind: "show" });
        expect(parsePlannerQuery("?tenant=a&week=2026-12-07")).toEqual({ tenant: "a", week: "2026-12-07", resource: null });
    });
});

describe("plannerAccess (§ 23.5, pure)", () => {
    const base = { loading: false, currentTenantId: "B", tenantIds: ["A", "B"] };
    it("E17 link tenant = current tenant → show (no switch)", () => {
        expect(plannerAccess({ ...base, linkTenant: "B" })).toEqual({ kind: "show" });
    });
    it("E19 link tenant A in the user's list, current B → switch to A; after the reload (current A) → show", () => {
        expect(plannerAccess({ ...base, linkTenant: "A" })).toEqual({ kind: "switch", tenantId: "A" });
        expect(plannerAccess({ ...base, currentTenantId: "A", linkTenant: "A" })).toEqual({ kind: "show" });
    });
    it("E20 link tenant C not in the list → noAccess; while the list loads → wait (nothing decided)", () => {
        expect(plannerAccess({ ...base, linkTenant: "C" })).toEqual({ kind: "noAccess" });
        expect(plannerAccess({ ...base, loading: true, linkTenant: "C" })).toEqual({ kind: "wait" });
    });
    it("no link tenant and no current site → noSite; a link tenant with no current site (after sign-in) → switch", () => {
        expect(plannerAccess({ ...base, currentTenantId: null, linkTenant: null })).toEqual({ kind: "noSite" });
        expect(plannerAccess({ ...base, currentTenantId: null, linkTenant: "A" })).toEqual({ kind: "switch", tenantId: "A" });
    });
});

// ---------------------------------------------------------------------------------------------------------------
// E21, E18 — the return path
// ---------------------------------------------------------------------------------------------------------------

describe("E21 — isSafeReturnPath", () => {
    it("E21 the seven examples of § 23.5: the planner link accepted, the six others rejected", () => {
        expect(isSafeReturnPath("/scheduling/planner?tenant=a&week=2026-12-07")).toBe(true);
        for (const p of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/a//b", ""]) {
            expect({ p, safe: isSafeReturnPath(p) }).toEqual({ p, safe: false });
        }
    });
    it("E21 /%2F%2Fevil.example is a same-origin path (accepted); a newline and 2001 characters are rejected; 2000 accepted", () => {
        expect(isSafeReturnPath("/%2F%2Fevil.example")).toBe(true);
        expect(isSafeReturnPath("/scheduling\n/planner")).toBe(false);
        expect(isSafeReturnPath("/a b")).toBe(false);
        expect(isSafeReturnPath("/a\u0085b")).toBe(false);
        expect(isSafeReturnPath("/" + "a".repeat(2000))).toBe(false);
        expect(isSafeReturnPath("/" + "a".repeat(1999))).toBe(true);
    });
});

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    state.calls = [];
    state.selectTenant = [];
    state.answers = {};
    state.bodies = [];
    vi.useRealTimers();
    vi.restoreAllMocks();
    state.tenant = { tenants: [], currentTenant: null, isLoading: false };
    state.signIn = { isSignedIn: true, nextStep: { signInStep: "DONE" } };
});
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

const nav: { go: NavigateFunction | null } = { go: null };
function Nav() {
    nav.go = useNavigate();
    return null;
}
function WhereAmI() {
    const l = useLocation();
    return createElement("div", { id: "where" }, `${l.pathname}${l.search}`);
}
async function mount(url: string, page: "login" | "planner") {
    host = document.createElement("div");
    document.body.appendChild(host);
    const element = createElement(MemoryRouter, { initialEntries: [url] }, createElement(Nav),
        createElement(Routes, null,
            createElement(Route, { path: "/login", element: createElement(LoginPage) }),
            createElement(Route, { path: "/scheduling/planner", element: page === "planner" ? createElement(SchedulingPlanner) : createElement(WhereAmI) }),
            createElement(Route, { path: "*", element: createElement(WhereAmI) })));
    act(() => { root = createRoot(host); root.render(element); });
    await flush();
}
const setInput = (selector: string, value: string) => {
    const el = host.querySelector(selector) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
};
const submit = async () => {
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
};

describe("E18 — the guard keeps the path; the sign-in returns to it", () => {
    const link = "/scheduling/planner?tenant=a&week=2026-12-07";

    it("E18 loginPathFor encodes path and query into next; URLSearchParams gives it back; afterSignInPath without next → /", () => {
        const login = loginPathFor("/scheduling/planner", "?tenant=a&week=2026-12-07");
        expect(login).toBe("/login?next=%2Fscheduling%2Fplanner%3Ftenant%3Da%26week%3D2026-12-07");
        expect(new URLSearchParams(login.slice("/login".length)).get("next")).toBe(link);
        expect(afterSignInPath(link)).toBe(link);
        expect(afterSignInPath(null)).toBe("/");
        expect(afterSignInPath("//evil.example")).toBe("/");
    });

    it("E18 password sign-in with next → the planner with the same tenant and week", async () => {
        await mount(loginPathFor("/scheduling/planner", "?tenant=a&week=2026-12-07"), "login");
        setInput("#email", "admin@example.com");
        setInput("#password", "secret-1");
        await submit();
        expect(host.querySelector("#where")?.textContent).toBe(link);
    });

    it("E18 the new-password step with next → the planner with the same tenant and week", async () => {
        state.signIn = { isSignedIn: false, nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" } };
        await mount(loginPathFor("/scheduling/planner", "?tenant=a&week=2026-12-07"), "login");
        setInput("#email", "admin@example.com");
        setInput("#password", "temporary");
        await submit();
        setInput("#new-password", "a-new-password");
        await submit();
        expect(host.querySelector("#where")?.textContent).toBe(link);
    });

    it("E18 a sign-in without next goes to / as today; an unsafe next goes to /", async () => {
        await mount("/login", "login");
        setInput("#email", "admin@example.com");
        setInput("#password", "secret-1");
        await submit();
        expect(host.querySelector("#where")?.textContent).toBe("/");
        act(() => root?.unmount());
        await mount(`/login?next=${encodeURIComponent("//evil.example")}`, "login");
        setInput("#email", "admin@example.com");
        setInput("#password", "secret-1");
        await submit();
        expect(host.querySelector("#where")?.textContent).toBe("/");
    });
});

// ---------------------------------------------------------------------------------------------------------------
// E17, E19, E20 — the planner page with the link
// ---------------------------------------------------------------------------------------------------------------

const SITE_A = { id: "A", name: "Site A", domain: "a.example" };
const SITE_B = { id: "B", name: "Site B", domain: "b.example" };

function plannedDay(date: string, over: Partial<Extract<DayDTO, { kind: "planned" }>> = {}): DayDTO {
    return { date, kind: "planned", source: "default", windows: [], removed: [], entries: [], open: [], outsideHours: [], ...over };
}
function weekOf(start: string, days: DayDTO[] = []): WeekPlanDTO {
    const all = Array.from({ length: 7 }, (_, i) => days[i] ?? plannedDay(addDays(start, i)));
    return { timezone: TZ, resourceId: "r1", resourceName: "Dr. A", lastBookableDate: "2027-01-26", defaults: [], days: all };
}
function plannerAnswers(start: string) {
    state.answers = {
        "/settings": { schedulingEnabled: true, scheduling: { timezone: TZ } },
        "/scheduling/admin/resources": { resources: [{ id: "r1", name: "Dr. A", hasFeed: false }] },
        "/scheduling/admin/services": { services: [] },
        [`/scheduling/admin/resources/r1/week?start=${start}`]: weekOf(start),
    };
}
const schedulingCalls = () => state.calls.filter((c) => c.startsWith("/scheduling/") || c === "/settings");

describe("the planner link on the page (§ 23.5)", () => {
    it("E17 signed in, current tenant = the link's tenant: the week of `week` is shown; no tenant switch, no reload", async () => {
        state.tenant = { tenants: [SITE_A, SITE_B], currentTenant: SITE_A, isLoading: false };
        plannerAnswers("2026-12-07");
        await mount("/scheduling/planner?tenant=A&week=2026-12-09", "planner");
        expect(state.selectTenant).toEqual([]);
        expect(state.calls).toContain("/scheduling/admin/resources/r1/week?start=2026-12-07");
        expect(host.textContent).toContain("Dr. A: week of 2026-12-07 to 2026-12-13");
        expect(host.textContent).toContain(`Times in ${TZ}`);
    });

    it("E19 current tenant B, link tenant A in the list: selectTenant(A) once and no scheduling request; after the reload the week of A is shown, no second switch", async () => {
        state.tenant = { tenants: [SITE_A, SITE_B], currentTenant: SITE_B, isLoading: false };
        await mount("/scheduling/planner?tenant=A&week=2026-12-07", "planner");
        expect(state.selectTenant).toEqual(["A"]);
        expect(schedulingCalls()).toEqual([]);
        // A re-render (the context updates again before the reload lands) does not switch twice.
        act(() => root?.render(createElement(MemoryRouter, { initialEntries: ["/scheduling/planner?tenant=A&week=2026-12-07"] }, createElement(Nav),
            createElement(Routes, null,
                createElement(Route, { path: "/login", element: createElement(LoginPage) }),
                createElement(Route, { path: "/scheduling/planner", element: createElement(SchedulingPlanner) }),
                createElement(Route, { path: "*", element: createElement(WhereAmI) })))));
        await flush();
        expect(state.selectTenant).toEqual(["A"]);
        // The reload: a new page life whose stored tenant is A.
        act(() => root?.unmount());
        state.tenant = { tenants: [SITE_A, SITE_B], currentTenant: SITE_A, isLoading: false };
        plannerAnswers("2026-12-07");
        await mount("/scheduling/planner?tenant=A&week=2026-12-07", "planner");
        expect(state.selectTenant).toEqual(["A"]);
        expect(host.textContent).toContain("week of 2026-12-07");
    });

    it("E19 while the tenant list loads nothing is decided and nothing is requested", async () => {
        state.tenant = { tenants: [], currentTenant: null, isLoading: true };
        await mount("/scheduling/planner?tenant=A&week=2026-12-07", "planner");
        expect(state.selectTenant).toEqual([]);
        expect(schedulingCalls()).toEqual([]);
    });

    it("E20 link tenant C not in the user's list: 'You do not have access to this site.'; the current tenant stays B; no scheduling request", async () => {
        state.tenant = { tenants: [SITE_A, SITE_B], currentTenant: SITE_B, isLoading: false };
        await mount("/scheduling/planner?tenant=C&week=2026-12-07", "planner");
        expect(host.textContent).toContain("You do not have access to this site.");
        expect(state.selectTenant).toEqual([]);
        expect(state.calls).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// E15 — the week view model (the operator's staging look covers the drawing)
// ---------------------------------------------------------------------------------------------------------------

const kinds = (segments: Segment[]) => segments.map(({ kind, from, to }) => ({ kind, from, to }));
const entry = (id: string, start: string, end: string, state: "held" | "confirmed" = "confirmed", expiresAt?: string) => ({
    bookingId: id, ref: `B-${id.toUpperCase()}`, start, end, state, ...(expiresAt ? { expiresAt } : {}), customerName: "Ana", serviceName: "Consult",
});

describe("E15 — weekView: open time, bookings and unavailable time are distinct", () => {

    it("E15 the § 5.5 example: edited hours 09-12 and 13-17, a booking 12-13 → closed / open / removed / open / closed; the booking marked outside hours", () => {
        const day = plannedDay("2026-12-07", {
            source: "dayHours", windows: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }], removed: [{ start: "12:00", end: "13:00" }],
            entries: [entry("aaaaaaaa", "2026-12-07T10:00:00.000Z", "2026-12-07T11:00:00.000Z")],
            open: [{ start: "2026-12-07T07:00:00.000Z", end: "2026-12-07T10:00:00.000Z" }, { start: "2026-12-07T11:00:00.000Z", end: "2026-12-07T15:00:00.000Z" }],
            outsideHours: ["B-AAAAAAAA"],
        });
        const v = weekView(weekOf("2026-12-07", [day]), "2026-12-01").days[0];
        expect(kinds(v.segments)).toEqual([
            { kind: "closed", from: 0, to: 540 }, { kind: "open", from: 540, to: 720 }, { kind: "removed", from: 720, to: 780 },
            { kind: "open", from: 780, to: 1020 }, { kind: "closed", from: 1020, to: 1440 },
        ]);
        expect(v.hoursText).toBe("Edited hours 09:00–12:00, 13:00–17:00");
        expect(v.removedText).toBe("Removed by this day's edit: 12:00–13:00");
        expect(v.entries).toEqual([expect.objectContaining({ ref: "B-AAAAAAAA", from: 720, to: 780, timeText: "12:00–13:00", outsideHours: true, heldText: null })]);
    });

    it("E15 a default day with a hold inside the hours: open / taken / open; the hold says until when; not outside hours", () => {
        const day = plannedDay("2026-12-08", {
            windows: [{ start: "09:00", end: "17:00" }],
            entries: [entry("bbbbbbbb", "2026-12-08T08:00:00.000Z", "2026-12-08T08:30:00.000Z", "held", "2026-12-07T08:15:00.000Z")],
            open: [{ start: "2026-12-08T07:00:00.000Z", end: "2026-12-08T08:00:00.000Z" }, { start: "2026-12-08T08:30:00.000Z", end: "2026-12-08T15:00:00.000Z" }],
        });
        const v = weekView(weekOf("2026-12-07", [plannedDay("2026-12-07"), day]), "2026-12-01").days[1];
        expect(kinds(v.segments.filter((s) => s.kind !== "closed"))).toEqual([
            { kind: "open", from: 540, to: 600 }, { kind: "taken", from: 600, to: 630 }, { kind: "open", from: 630, to: 1020 },
        ]);
        expect(v.hoursText).toBe("Weekly hours 09:00–17:00");
        expect(v.entries[0]).toMatchObject({ state: "held", heldText: "Held until 2026-12-07 10:15", outsideHours: false });
    });

    it("E15 a day off: the default hours it took away are 'removed', not plain 'closed'; a cross-midnight booking is clipped to the day", () => {
        const day = plannedDay("2026-12-08", {
            source: "dayOff", removed: [{ start: "09:00", end: "17:00" }], note: "Training",
            entries: [entry("cccccccc", "2026-12-07T21:30:00.000Z", "2026-12-07T22:30:00.000Z")], outsideHours: ["B-CCCCCCCC"],
        });
        const v = weekView(weekOf("2026-12-07", [plannedDay("2026-12-07"), day]), "2026-12-01");
        expect(kinds(v.days[1].segments)).toEqual([{ kind: "closed", from: 0, to: 540 }, { kind: "removed", from: 540, to: 1020 }, { kind: "closed", from: 1020, to: 1440 }]);
        expect(v.days[1].hoursText).toBe("Day off");
        expect(v.days[1].note).toBe("Training");
        expect(v.days[1].entries[0]).toMatchObject({ from: 0, to: 30, timeText: "2026-12-07 23:30–00:30", outsideHours: true });
        expect(v.range).toEqual({ from: 0, to: 1020 });
    });

    it("E15 a default day with no weekly hours is 'Closed (no weekly hours)'; an empty week draws 08:00-18:00", () => {
        const v = weekView(weekOf("2026-12-07"), "2026-12-01");
        expect(v.days[0].hoursText).toBe("Closed (no weekly hours)");
        expect(kinds(v.days[0].segments)).toEqual([{ kind: "closed", from: 0, to: 1440 }]);
        expect(v.range).toEqual({ from: 480, to: 1080 });
    });

    it("E15 a past day keeps its bookings and offers no edit; days before today are not editable; the horizon is marked", () => {
        const days: DayDTO[] = [{ date: "2026-12-07", kind: "past", entries: [entry("dddddddd", "2026-12-07T08:00:00.000Z", "2026-12-07T09:00:00.000Z")] }];
        const week = { ...weekOf("2026-12-07", days), lastBookableDate: "2026-12-09" };
        const v = weekView(week, "2026-12-08");
        expect(v.days[0]).toMatchObject({ kind: "past", segments: [], editable: false, hoursText: "Past (hours no longer kept)" });
        expect(v.days[0].entries).toHaveLength(1);
        expect(v.days.map((d) => d.editable)).toEqual([false, true, true, true, true, true, true]);
        expect(v.days.map((d) => d.isToday)).toEqual([false, true, false, false, false, false, false]);
        expect(v.days.map((d) => d.isLastBookable)).toEqual([false, false, true, false, false, false, false]);
        expect(v.days.map((d) => d.afterHorizon)).toEqual([false, false, false, true, true, true, true]);
        expect(v.lastBookableDate).toBe("2026-12-09");
    });

    it("E15 no hard-coded colour in SchedulingPlanner.tsx (CSS variables only, CLAUDE.md Critical Rule 6)", () => {
        const source = readFileSync(join(import.meta.dirname, "SchedulingPlanner.tsx"), "utf8");
        expect(source.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
        expect(source.match(/\brgba?\(/g)).toBeNull();
        expect(source.match(/\bhsla?\(|\boklch\(/g)).toBeNull();
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Request bodies and answers
// ---------------------------------------------------------------------------------------------------------------

describe("day edits, copy week, conflicts", () => {
    it("daySettingOf builds each DaySetting kind with the shared schema; a malformed window names the field", () => {
        expect(daySettingOf({ kind: "dayOff", windows: [], note: " Sick " })).toEqual({ ok: true, value: { kind: "dayOff", note: "Sick" } });
        expect(daySettingOf({ kind: "default", windows: [{ start: "x", end: "y" }], note: "ignored" })).toEqual({ ok: true, value: { kind: "default" } });
        expect(daySettingOf({ kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }], note: "" }))
            .toEqual({ ok: true, value: { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] } });
        const bad = daySettingOf({ kind: "dayHours", windows: [{ start: "09:03", end: "12:00" }], note: "" });
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.error).toMatch(/^value\.windows\.0\.start: /);
        expect(daySettingOf({ kind: "dayHours", windows: [], note: "" }).ok).toBe(false);
        expect(daySettingOf({ kind: "dayHours", windows: [{ start: "12:00", end: "09:00" }], note: "" }).ok).toBe(false);
    });

    it("copyWeekBody: this week onto the next N weeks (1-52)", () => {
        expect(copyWeekBody("2026-12-07", "4")).toEqual({ ok: true, body: { sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks: 4 } });
        for (const w of ["0", "53", "2.5", "", "x"]) expect(copyWeekBody("2026-12-07", w).ok).toBe(false);
    });

    it("editResultText lists the booking references outside the new hours (§ 23.4)", () => {
        expect(editResultText({ changed: ["2026-12-08"], outsideHours: [] })).toEqual({ message: "Saved. 1 date(s) changed.", conflicts: [] });
        const r = editResultText({ changed: ["2026-12-08", "2026-12-09"], outsideHours: ["B-AAAAAAAA", "B-BBBBBBBB"] });
        expect(r.conflicts).toEqual(["B-AAAAAAAA", "B-BBBBBBBB"]);
        expect(r.message).toContain("2 booking(s) are now outside the hours");
        expect(editResultText({ changed: [], outsideHours: [] }).message).toBe("Saved. No date changed.");
    });
});

describe("manual appointment and move bodies", () => {
    const form: AppointmentForm = { serviceId: "s1", date: "2026-12-07", time: "09:00", name: "Ana Pop", email: " Ana@Example.com ", phone: "", channel: "phone" };

    it("the start is the local time in the tenant's zone; a time in the spring gap is refused", () => {
        expect(startInstant("2026-12-07", "09:00", TZ)).toEqual({ ok: true, value: "2026-12-07T07:00:00.000Z" });
        expect(startInstant("2027-03-28", "03:30", TZ)).toEqual({ ok: false, error: "time: This time does not exist on that date (the clock moves forward)." });
        expect(startInstant("2026-12-32", "09:00", TZ).ok).toBe(false);
        expect(startInstant("2026-12-07", "9", TZ).ok).toBe(false);
    });

    it("manualAppointmentBody: the § 10.3 body with the person normalized by the shared schema; the first problem named", () => {
        expect(manualAppointmentBody(form, "r1", TZ)).toEqual({ ok: true, body: {
            serviceId: "s1", resourceId: "r1", start: "2026-12-07T07:00:00.000Z", who: { email: "ana@example.com", name: "Ana Pop" }, channel: "phone",
        } });
        expect(manualAppointmentBody({ ...form, serviceId: "" }, "r1", TZ)).toEqual({ ok: false, error: "serviceId: Choose a service." });
        const badMail = manualAppointmentBody({ ...form, email: "nope" }, "r1", TZ);
        expect(badMail.ok).toBe(false);
        if (!badMail.ok) expect(badMail.error).toMatch(/^who\.email: /);
        expect(manualAppointmentBody({ ...form, channel: " " }, "r1", TZ).ok).toBe(false);
        const withPhone = manualAppointmentBody({ ...form, phone: " 0722 " }, "r1", TZ);
        if (withPhone.ok) expect(withPhone.body.who.phone).toBe("0722");
    });

    it("moveSlotBody carries the rev the admin saw", () => {
        expect(moveSlotBody({ date: "2026-12-08", time: "10:30", resourceId: "r2" }, TZ, 3))
            .toEqual({ ok: true, body: { start: "2026-12-08T08:30:00.000Z", resourceId: "r2", rev: 3 } });
        expect(moveSlotBody({ date: "2026-12-08", time: "10:30", resourceId: "" }, TZ, 3).ok).toBe(false);
    });

    it("plannerErrorText lists a 400's issues; other refusals show the server's reason", () => {
        expect(plannerErrorText(new ApiError(400, { code: "invalid", error: "The request is not valid.", issues: [{ path: "from", message: "Must be a real date YYYY-MM-DD." }] }, "m")))
            .toBe("The request is not valid: from: Must be a real date YYYY-MM-DD.");
        expect(plannerErrorText(new ApiError(409, { code: "slotTaken", error: "Another booking overlaps this time." }, "m"))).toBe("Another booking overlaps this time.");
        expect(plannerErrorText(new ApiError(400, { code: "startsInPast", error: "The edit starts before today.", today: "2026-12-08" }, "m"))).toBe("The edit starts before today.");
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Review-0 regressions
// ---------------------------------------------------------------------------------------------------------------

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}
const choose = (select: HTMLSelectElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
};
const typeInto = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (root: ParentNode, text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await flush(); };
const atDecemberFirst = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-12-01T10:00:00Z")); };
const RESOURCES = [{ id: "r1", name: "Dr. A", hasFeed: false }, { id: "r2", name: "Dr. B", hasFeed: false }];
const SETTINGS = { schedulingEnabled: true, scheduling: { timezone: TZ } };
const bookingDTO = (id: string, ref: string): BookingAdminDTO => ({
    id, ref, rev: 1,
    what: { kind: "slot", serviceId: "s2", serviceName: "Only r2", resourceId: "r1", resourceName: "Dr. A", start: "2026-12-07T07:00:00.000Z", end: "2026-12-07T07:30:00.000Z" },
    state: { kind: "confirmed", at: "2026-12-01T10:00:00.000Z" },
    source: { kind: "manual", adminEmail: "a@example.com", channel: "phone" }, who: { email: "ana@example.com", name: "Ana Pop" },
    createdAt: "2026-12-01T10:00:00.000Z", updatedAt: "2026-12-01T10:00:00.000Z",
    history: [{ action: "confirmed", at: "2026-12-01T10:00:00.000Z" }],
});

describe("R1 — the planner shows and edits only the current selection", () => {
    it("R1 the resource changes while its old week loads: no grid until the new week; the old answer arriving last is dropped; the edit goes to the shown resource", async () => {
        atDecemberFirst();
        state.tenant = { tenants: [SITE_A], currentTenant: SITE_A, isLoading: false };
        const oldWeek = deferred<WeekPlanDTO>();
        const newWeek = deferred<WeekPlanDTO>();
        state.answers = {
            "/settings": SETTINGS, "/scheduling/admin/resources": { resources: RESOURCES }, "/scheduling/admin/services": { services: [] },
            "/scheduling/admin/resources/r1/week?start=2026-12-07": () => oldWeek.promise,
            "/scheduling/admin/resources/r2/week?start=2026-12-07": () => newWeek.promise,
            "PUT /scheduling/admin/resources/r2/days": { changed: ["2026-12-07"], outsideHours: [] },
        };
        await mount("/scheduling/planner?week=2026-12-07", "planner");
        await act(async () => { choose(host.querySelector("#planner-resource") as HTMLSelectElement, "r2"); });
        await flush();
        expect(button(host, "Day off")).toBeUndefined(); // nothing to act on while the r2 week loads
        await act(async () => { newWeek.resolve({ ...weekOf("2026-12-07"), resourceId: "r2", resourceName: "Dr. B" }); });
        await flush();
        await act(async () => { oldWeek.resolve(weekOf("2026-12-07")); });
        await flush();
        expect(host.textContent).toContain("Dr. B: week of 2026-12-07");
        expect(host.textContent).not.toContain("Dr. A: week of");
        vi.spyOn(window, "confirm").mockReturnValue(true);
        await click(button(host, "Day off")!);
        expect(state.calls.filter((c) => c.startsWith("PUT "))).toEqual(["PUT /scheduling/admin/resources/r2/days"]);
    });

    it("E20 R1 in-app navigation to the link of a site not in the list: the no-access text, no request for that week, and the week answer in flight is not shown", async () => {
        state.tenant = { tenants: [SITE_A, SITE_B], currentTenant: SITE_A, isLoading: false };
        const pending = deferred<WeekPlanDTO>();
        plannerAnswers("2026-12-07");
        state.answers["/scheduling/admin/resources/r1/week?start=2026-12-07"] = () => pending.promise;
        await mount("/scheduling/planner?tenant=A&week=2026-12-07", "planner");
        const before = state.calls.length;
        await act(async () => { void nav.go!("/scheduling/planner?tenant=C&week=2026-12-14"); });
        await flush();
        await act(async () => { pending.resolve(weekOf("2026-12-07")); });
        await flush();
        expect(host.textContent).toContain("You do not have access to this site.");
        expect(host.textContent).not.toContain("week of 2026-12-07");
        expect(state.calls.slice(before)).toEqual([]);
        expect(state.selectTenant).toEqual([]);
    });
});

describe("R2 — a manual appointment is not limited by visitor eligibility (§ 5.2)", () => {
    it("R2 on resource r1, a service visitors may book only with r2 is offered, and the request names r1 and that service", async () => {
        atDecemberFirst();
        state.tenant = { tenants: [SITE_A], currentTenant: SITE_A, isLoading: false };
        plannerAnswers("2026-12-07");
        state.answers["/scheduling/admin/services"] = { services: [{ id: "s2", name: "Only r2", durationMin: 30, eligibility: { kind: "only", resourceIds: ["r2"] } }] };
        state.answers["POST /scheduling/admin/appointments"] = bookingDTO("b1", "B-11111111");
        await mount("/scheduling/planner?week=2026-12-07", "planner");
        await click(button(host, "Appointment")!);
        const service = document.querySelector("#appt-service") as HTMLSelectElement;
        expect([...service.options].map((o) => o.value)).toEqual(["", "s2"]);
        await act(async () => { choose(service, "s2"); });
        await act(async () => { typeInto(document.querySelector("#appt-name") as HTMLInputElement, "Ana Pop"); });
        await act(async () => { typeInto(document.querySelector("#appt-email") as HTMLInputElement, "ana@example.com"); });
        await click(button(document, "Add appointment")!);
        const i = state.calls.indexOf("POST /scheduling/admin/appointments");
        expect(i).toBeGreaterThanOrEqual(0);
        expect(JSON.parse(state.bodies[i]!)).toMatchObject({ serviceId: "s2", resourceId: "r1", start: "2026-12-07T07:00:00.000Z" });
    });
});

describe("R3 — clock-change days keep every real minute once (Europe/Bucharest)", () => {
    it("R3 spring forward 2027-03-28: a window 03:30-06:00 starts at 04:00 (the gap end); no minute of the gap is open or taken; the day has 23 hours", () => {
        const day = plannedDay("2027-03-28", {
            source: "dayHours", windows: [{ start: "03:30", end: "06:00" }],
            open: [{ start: "2027-03-28T01:00:00.000Z", end: "2027-03-28T03:00:00.000Z" }],
        });
        const v = weekView({ ...weekOf("2027-03-22", [...Array.from({ length: 6 }, (_, i) => plannedDay(addDays("2027-03-22", i))), day]) }, "2027-03-01").days[6];
        expect(v.length).toBe(1380);
        expect(kinds(v.segments)).toEqual([{ kind: "closed", from: 0, to: 180 }, { kind: "open", from: 180, to: 300 }, { kind: "closed", from: 300, to: 1380 }]);
        expect(v.segments.some((g) => g.kind === "taken")).toBe(false);
        expect(v.segments[1]).toMatchObject({ fromText: "04:00 (UTC+3)", toText: "06:00 (UTC+3)" });
        expect(v.clockChange).toContain("Clocks go forward");
        expect(v.marks.map((k) => k.text).slice(2, 4)).toEqual(["02:00 (UTC+2)", "04:00 (UTC+3)"]);
    });

    it("R3 fall back 2027-10-31: a booking 00:30Z-01:30Z keeps its real hour (03:30 UTC+3 – 03:30 UTC+2) and is taken, not open; the day has 25 hours", () => {
        const day = plannedDay("2027-10-31", {
            windows: [{ start: "03:00", end: "05:00" }],
            entries: [entry("eeeeeeee", "2027-10-31T00:30:00.000Z", "2027-10-31T01:30:00.000Z")],
            open: [{ start: "2027-10-31T00:00:00.000Z", end: "2027-10-31T00:30:00.000Z" }, { start: "2027-10-31T01:30:00.000Z", end: "2027-10-31T03:00:00.000Z" }],
        });
        const v = weekView(weekOf("2027-10-25", [...Array.from({ length: 6 }, (_, i) => plannedDay(addDays("2027-10-25", i))), day]), "2027-10-01").days[6];
        expect(v.length).toBe(1500);
        expect(kinds(v.segments)).toEqual([
            { kind: "closed", from: 0, to: 180 }, { kind: "open", from: 180, to: 210 }, { kind: "taken", from: 210, to: 270 },
            { kind: "open", from: 270, to: 360 }, { kind: "closed", from: 360, to: 1500 },
        ]);
        expect(v.entries[0]).toMatchObject({ from: 210, to: 270, timeText: "03:30 (UTC+3)–03:30 (UTC+2)" });
        expect(v.marks.filter((k) => k.text.startsWith("03:00"))).toEqual([{ at: 180, text: "03:00 (UTC+3)" }, { at: 240, text: "03:00 (UTC+2)" }]);
        expect(v.clockChange).toContain("Clocks go back");
    });

    it("R3 an ordinary day carries no offsets and no own hour marks", () => {
        const v = weekView(weekOf("2026-12-07"), "2026-12-01").days[0];
        expect(v).toMatchObject({ length: 1440, clockChange: null, marks: [] });
        expect(v.segments[0]).toMatchObject({ fromText: "00:00", toText: "2026-12-08 00:00" });
    });
});

describe("R4 — short bookings: full text and actions do not depend on the block's height", () => {
    it("R4 a 5-minute booking and an adjacent 30-minute hold: each has its own list entry with time, customer, service and actions; the blocks keep their true height", async () => {
        atDecemberFirst();
        state.tenant = { tenants: [SITE_A], currentTenant: SITE_A, isLoading: false };
        plannerAnswers("2026-12-07");
        state.answers["/scheduling/admin/resources/r1/week?start=2026-12-07"] = weekOf("2026-12-07", [plannedDay("2026-12-07", {
            windows: [{ start: "09:00", end: "17:00" }],
            entries: [entry("ffffffff", "2026-12-07T07:00:00.000Z", "2026-12-07T07:05:00.000Z"),
                entry("gggggggg", "2026-12-07T07:05:00.000Z", "2026-12-07T07:35:00.000Z", "held", "2026-12-01T10:30:00.000Z")],
            open: [{ start: "2026-12-07T07:35:00.000Z", end: "2026-12-07T15:00:00.000Z" }],
        })]);
        await mount("/scheduling/planner?week=2026-12-07", "planner");
        const short = host.querySelector('[data-entry="B-FFFFFFFF"]') as HTMLElement;
        expect(short.textContent).toContain("Booked · B-FFFFFFFF");
        expect(short.textContent).toContain("09:00–09:05");
        expect(short.textContent).toContain("Ana · Consult");
        expect(short.querySelector("a")?.textContent).toBe("Details");
        expect(button(short, "Move")).toBeDefined();
        const held = host.querySelector('[data-entry="B-GGGGGGGG"]') as HTMLElement;
        expect(held.textContent).toContain("Held · B-GGGGGGGG");
        expect(held.textContent).toContain("09:05–09:35");
        expect(held.textContent).toContain("Held until 2026-12-01 12:30");
        expect(button(held, "Move")).toBeUndefined(); // a hold is moved by the customer's link, not here
        // Range 09:00-17:00 = 480 minutes: the blocks are 5/480 and 30/480 of the column.
        const height = (ref: string) => parseFloat((host.querySelector(`[data-entry-block="${ref}"]`) as HTMLElement).style.height);
        expect(height("B-FFFFFFFF")).toBeCloseTo((5 / 480) * 100, 6);
        expect(height("B-GGGGGGGG")).toBeCloseTo((30 / 480) * 100, 6);
    });
});
