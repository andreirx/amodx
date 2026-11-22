// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * SCHED-1F2 — the courses and groups page (docs/slices/sched-1.md § 4.3, § 5.4, § 10.3; screen parts of rows F1, F4,
 * F5, F6, F8 of § 17.3, and ruling S1F1-LANGUAGE-CONSIST of § 25). Pure functions are tested directly; the page is also
 * mounted (jsdom) with the tenant context, Amplify and `apiRequest` replaced (records "<path>" for a read and
 * "<METHOD> <path>" for a write; an answer may be a function returning a promise the test resolves later).
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
        if (answer instanceof Error) throw answer;
        return typeof answer === "function" ? (answer as () => Promise<unknown>)() : answer;
    }),
}));

import { ApiError } from "@/lib/api";
import SchedulingCourses, {
    CAPACITY_TEXT, cancelPreview, coursePayload, groupErrorText, languageTags, meetingsBody, quickMeetings, runCancelText,
    runCreateBody, runFormOf, runLabel, runMoveText, runStateText, runUpdateBody,
    type CourseDTO, type RosterRow, type RunAdminDTO, type RunForm,
} from "./SchedulingCourses";

const TZ = "Europe/Bucharest";
const COURSE: CourseDTO = { id: "c1", name: "Bijuterie începători", defaultCapacity: 12, languages: ["ro", "en"] };
const run = (over: Partial<RunAdminDTO> = {}): RunAdminDTO => ({
    id: "run-1aaaaaaa", courseId: "c1", meetings: [{ date: "2027-02-06", start: "10:00", end: "13:00" }, { date: "2027-02-07", start: "10:00", end: "13:00" }],
    timezone: TZ, capacity: 12, taken: 3, overCapacityBy: 0, trainerIds: ["r1"], language: "ro", status: "open",
    firstStart: "2027-02-06T08:00:00.000Z", lastEnd: "2027-02-07T11:00:00.000Z", ...over,
});
const form = (over: Partial<RunForm> = {}): RunForm => ({
    rows: [{ date: "2027-02-06", start: "10:00", end: "13:00" }], capacity: "12", trainerIds: ["r1"], language: "", groupLink: "", status: "open", ...over,
});
const api = (status: number, body: Record<string, unknown>) => new ApiError(status, body, `API Error (${status})`);

describe("coursePayload — POST/PUT /scheduling/admin/courses", () => {
    it("a valid form → name trimmed, number capacity, language tags", () => {
        expect(coursePayload({ name: " Atelier ", defaultCapacity: "12", languages: "ro, en" }))
            .toEqual({ ok: true, body: { name: "Atelier", defaultCapacity: 12, languages: ["ro", "en"] } });
        expect(languageTags(" ro,en  de ")).toEqual(["ro", "en", "de"]);
        expect(coursePayload({ name: "A", defaultCapacity: "1", languages: "" })).toEqual({ ok: true, body: { name: "A", defaultCapacity: 1, languages: [] } });
    });

    it("capacity 46 → the server's 45 text; 0, 2.5 and blank refused; a language twice, 11 languages and an empty name refused", () => {
        expect(coursePayload({ name: "A", defaultCapacity: "46", languages: "" })).toEqual({ ok: false, error: `defaultCapacity: ${CAPACITY_TEXT}` });
        for (const c of ["0", "2.5", ""]) expect(coursePayload({ name: "A", defaultCapacity: c, languages: "" }).ok).toBe(false);
        expect(coursePayload({ name: "A", defaultCapacity: "5", languages: "ro, ro" })).toEqual({ ok: false, error: "languages: Each language once." });
        expect(coursePayload({ name: "A", defaultCapacity: "5", languages: "a b c d e f g h i j k" }).ok).toBe(false);
        expect(coursePayload({ name: "  ", defaultCapacity: "5", languages: "" }).ok).toBe(false);
    });
});

describe("F1 meetings — the quick add and the § 5.4 checks before sending", () => {
    it("F1 quick add: 3 days in a row across a month end, one time range for all", () => {
        expect(quickMeetings({ kind: "days", from: "2027-01-30", count: "3" }, "10:00", "13:00")).toEqual({ ok: true, rows: [
            { date: "2027-01-30", start: "10:00", end: "13:00" }, { date: "2027-01-31", start: "10:00", end: "13:00" }, { date: "2027-02-01", start: "10:00", end: "13:00" },
        ] });
    });

    it("F1 quick add: picked dates are sorted and each kept once; empty picks, 0 or 61 days and an end before the start are refused", () => {
        expect(quickMeetings({ kind: "dates", dates: ["2027-02-13", "2027-02-06", "2027-02-13"] }, "09:00", "12:00"))
            .toEqual({ ok: true, rows: [{ date: "2027-02-06", start: "09:00", end: "12:00" }, { date: "2027-02-13", start: "09:00", end: "12:00" }] });
        expect(quickMeetings({ kind: "dates", dates: [] }, "09:00", "12:00").ok).toBe(false);
        expect(quickMeetings({ kind: "days", from: "2027-02-06", count: "0" }, "09:00", "12:00").ok).toBe(false);
        expect(quickMeetings({ kind: "days", from: "2027-02-06", count: "61" }, "09:00", "12:00").ok).toBe(false);
        expect(quickMeetings({ kind: "days", from: "2027-02-06", count: "2" }, "12:00", "09:00")).toEqual({ ok: false, error: "The end time must be after the start time." });
    });

    it("F1 each MeetingError is named with the row number: empty, endNotAfterStart, overlap, nonexistentLocalTime, tooMany", () => {
        const m = (date: string, start: string, end: string) => ({ date, start, end });
        expect(meetingsBody([], TZ)).toEqual({ ok: false, error: "A group needs at least one meeting." });
        expect(meetingsBody([m("2027-02-06", "10:00", "13:00"), m("2027-02-07", "10:00", "09:00")], TZ)).toEqual({ ok: false, error: "Meeting 2 ends before it starts." });
        expect(meetingsBody([m("2027-02-06", "10:00", "13:00"), m("2027-02-06", "12:00", "14:00")], TZ)).toEqual({ ok: false, error: "Meetings 1 and 2 overlap." });
        // Europe/Bucharest springs forward 2027-03-28 03:00 → 04:00.
        const gap = meetingsBody([m("2027-03-28", "03:30", "05:00")], TZ);
        expect(gap.ok).toBe(false);
        if (!gap.ok) expect(gap.error).toMatch(/^Meeting 1: that time does not exist/);
        const many = Array.from({ length: 61 }, (_, i) => m(`2027-${String(4 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, "10:00", "11:00"));
        expect(meetingsBody(many, TZ)).toEqual({ ok: false, error: "A group has at most 60 meetings." });
        expect(meetingsBody([m("2027-02-30", "10:00", "11:00")], TZ).ok).toBe(false);
    });

    it("F1 meetings are sent in the rows' order, so a server index names the same row", () => {
        const rows = [{ date: "2027-02-07", start: "10:00", end: "13:00" }, { date: "2027-02-06", start: "10:00", end: "13:00" }];
        expect(meetingsBody(rows, TZ)).toEqual({ ok: true, meetings: rows });
        expect(groupErrorText(api(400, { code: "endNotAfterStart", error: "x", index: 1 }))).toBe("Meeting 2 ends before it starts.");
        expect(groupErrorText(api(400, { code: "overlap", error: "x", a: 0, b: 2 }))).toBe("Meetings 1 and 3 overlap.");
    });
});

describe("F1 runCreateBody — POST …/courses/{c}/runs", () => {
    it("F1 a valid form → meetings, capacity, trainers; no language and no link are omitted (notSet, D7)", () => {
        expect(runCreateBody(form(), TZ)).toEqual({ ok: true, body: {
            meetings: [{ date: "2027-02-06", start: "10:00", end: "13:00" }], capacity: 12, trainerIds: ["r1"],
        } });
        expect(runCreateBody(form({ language: "ro", groupLink: " https://chat.whatsapp.com/abc " }), TZ))
            .toMatchObject({ ok: true, body: { language: "ro", groupLink: "https://chat.whatsapp.com/abc" } });
    });

    it("F1 trainerIds [] refused before sending; capacity 46 → the 45 text; an http: group link refused", () => {
        expect(runCreateBody(form({ trainerIds: [] }), TZ)).toEqual({ ok: false, error: "trainerIds: Choose at least one trainer." });
        expect(runCreateBody(form({ capacity: "46" }), TZ)).toEqual({ ok: false, error: `capacity: ${CAPACITY_TEXT}` });
        expect(runCreateBody(form({ groupLink: "http://chat.whatsapp.com/abc" }), TZ)).toEqual({ ok: false, error: "groupLink: Must be an https: URL." });
    });

    it("F1 the server's 400 texts reach the admin (capacity text, issues list)", () => {
        expect(groupErrorText(api(400, { code: "invalid", error: "The request is not valid.", issues: [{ path: "capacity", message: CAPACITY_TEXT }] })))
            .toBe(`The request is not valid: capacity: ${CAPACITY_TEXT}`);
    });
});

describe("runUpdateBody — PUT …/runs/{r} sends only the changed fields", () => {
    it("F6 a capacity below the seats taken is sent (nobody is removed); the group then shows 'over capacity by N'", () => {
        expect(runUpdateBody(runFormOf(run(), COURSE), run())).toEqual({ ok: false, error: "Nothing changed." });
        expect(runUpdateBody({ ...runFormOf(run(), COURSE), capacity: "2" }, run())).toEqual({ ok: true, body: { capacity: 2 } });
        expect(runStateText(run({ capacity: 2, taken: 3, overCapacityBy: 1 }), Date.parse("2027-01-01T00:00:00Z"))).toBe("Open, over capacity by 1");
        expect(runStateText(run({ capacity: 3, taken: 3 }), Date.parse("2027-01-01T00:00:00Z"))).toBe("Open, full");
        expect(runStateText(run({ status: "closed" }), Date.parse("2027-02-06T09:00:00Z"))).toBe("Closed to new bookings on the site, started");
        expect(runStateText(run({ status: "cancelled", taken: 0 }), Date.parse("2027-03-01T00:00:00Z"))).toBe("Cancelled");
    });

    it("F8 the group link: set, changed, removed (null); unchanged → not sent", () => {
        const plain = runFormOf(run(), COURSE);
        expect(runUpdateBody({ ...plain, groupLink: "https://chat.whatsapp.com/x" }, run())).toEqual({ ok: true, body: { groupLink: "https://chat.whatsapp.com/x" } });
        const linked = run({ groupLink: "https://chat.whatsapp.com/x" });
        expect(runUpdateBody({ ...runFormOf(linked, COURSE), groupLink: "" }, linked)).toEqual({ ok: true, body: { groupLink: null } });
        expect(runUpdateBody({ ...runFormOf(linked, COURSE), capacity: "10" }, linked)).toEqual({ ok: true, body: { capacity: 10 } });
    });

    it("language to 'not set' → null; trainers in another order are the same list; status open → closed", () => {
        const f = runFormOf(run({ trainerIds: ["r1", "r2"] }), COURSE);
        expect(runUpdateBody({ ...f, language: "" }, run({ trainerIds: ["r1", "r2"] }))).toEqual({ ok: true, body: { language: null } });
        expect(runUpdateBody({ ...f, trainerIds: ["r2", "r1"] }, run({ trainerIds: ["r1", "r2"] }))).toEqual({ ok: false, error: "Nothing changed." });
        expect(runUpdateBody({ ...f, status: "closed" }, run({ trainerIds: ["r1", "r2"] }))).toEqual({ ok: true, body: { status: "closed" } });
    });

    it("S1F1-LANGUAGE-CONSIST a group whose language left the course's list is shown normally and saved without re-sending it", () => {
        const de = run({ language: "de" });
        expect(runLabel(de)).toBe("2027-02-06 – 2027-02-07 (2 meetings), de");
        expect(runFormOf(de, COURSE).language).toBe("de");
        expect(runUpdateBody({ ...runFormOf(de, COURSE), capacity: "8" }, de)).toEqual({ ok: true, body: { capacity: 8 } });
    });
});

describe("answers of a run move and a run cancel in plain words", () => {
    it("F4 move: the saved move, the people in the group, the mails accepted for sending, and those whose place changed — no delivery claim", () => {
        expect(runMoveText({ run: run({ taken: 3 }), mailed: 3, notSentPlacementChanged: 0 }))
            .toBe('The group was moved; the new meetings are saved. 3 people are in the group. "Moved" mails accepted for sending: 3.');
        const mixed = runMoveText({ run: run({ taken: 4 }), mailed: 1, notSentPlacementChanged: 1 });
        expect(mixed).toContain('"Moved" mails accepted for sending: 1.');
        expect(mixed).toContain("1 person's place changed at the same time; this move sent them no notice.");
        // R3: nothing says that a mail reached a person, or that another move mailed someone.
        expect(mixed).not.toMatch(/\bwere mailed\b|\bwas mailed\b|that move mailed/);
    });

    it("F5 cancel: unplaced, cancelled, not sent and token-cleanup counts; notices attempted, not counted; cleanup counted in bookings", () => {
        expect(runCancelText({ unplaced: 2, cancelled: 1, notSentPlacementChanged: 0, tokenCleanupFailed: 0 })).toBe(
            'The group was cancelled. 2 people are now without a group. 1 unconfirmed place was cancelled. '
            + 'The "No group" and "Cancelled" notices are sent when those mails are on; this answer does not count them.');
        const all = runCancelText({ unplaced: 1, cancelled: 0, notSentPlacementChanged: 1, tokenCleanupFailed: 2 });
        expect(all).toContain("1 person is now without a group");
        expect(all).toContain("1 person's place changed at the same time; this cancel sent them no notice.");
        expect(all).toContain("For 2 cancelled bookings the old links could not all be deleted; the cancellation stands.");
        expect(runCancelText({ unplaced: 0, cancelled: 1, notSentPlacementChanged: 0, tokenCleanupFailed: 1 }))
            .toContain("For 1 cancelled booking the old links could not all be deleted");
    });

    it("F5 the confirmation counts from the roster: confirmed → without a group, held → cancelled", () => {
        const row = (state: RosterRow["state"]): RosterRow => ({ bookingId: state, ref: "B-1", name: "N", email: "n@example.com", state, source: "visitor" });
        const p = cancelPreview([row("confirmed"), row("confirmed"), row("held")]);
        expect([p.unplace, p.cancel]).toEqual([2, 1]);
        expect(p.text).toBe('2 people become "without a group" and stay in the course. 1 unconfirmed place is cancelled. A cancelled group cannot be opened again.');
    });

    it("409 refusals as plain text: languageInUse, courseInUse, runFull, runCancelled", () => {
        expect(groupErrorText(api(409, { code: "languageInUse", error: "x", languages: ["en"] }))).toContain("uses en");
        expect(groupErrorText(api(409, { code: "courseInUse", error: "x" }))).toContain("cannot be deleted");
        expect(groupErrorText(api(409, { code: "runFull", error: "x", capacity: 12 }))).toContain("full (12 places)");
        expect(groupErrorText(api(409, { code: "runCancelled", error: "x" }))).toBe("The group is cancelled. Choose another group.");
    });

    it("no hard-coded colour in SchedulingCourses.tsx or SchedulingRoster.tsx (CLAUDE.md Critical Rule 6)", () => {
        for (const file of ["SchedulingCourses.tsx", "SchedulingRoster.tsx"]) {
            const text = readFileSync(join(import.meta.dirname, file), "utf8");
            expect({ file, hex: text.match(/#[0-9a-fA-F]{3,8}\b/g), rgb: text.match(/\brgba?\(/g), other: text.match(/\bhsla?\(|\boklch\(/g) })
                .toEqual({ file, hex: null, rgb: null, other: null });
        }
    });
});

// ---------------------------------------------------------------------------------------------------------------
// The mounted page
// ---------------------------------------------------------------------------------------------------------------

let root: Root | null = null;
let host: HTMLDivElement;
const nav: { go: NavigateFunction | null; at: string } = { go: null, at: "" };
function Nav() {
    nav.go = useNavigate();
    const l = useLocation();
    nav.at = `${l.pathname}${l.search}`;
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
                createElement(Route, { path: "/scheduling/courses", element: createElement(SchedulingCourses) }),
                createElement(Route, { path: "/elsewhere", element: null }))));
    });
    await flush();
}
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const buttons = (text: string) => [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await flush(); };
async function type(el: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
const lastBody = (call: string) => JSON.parse(state.bodies[state.calls.lastIndexOf(call)]!);
const COURSE_B: CourseDTO = { id: "c2", name: "Atelier avansați", defaultCapacity: 10, languages: ["ro"] };
const SETUP = {
    "/scheduling/admin/courses": { courses: [COURSE, COURSE_B] },
    "/scheduling/admin/resources": { resources: [{ id: "r1", name: "Ana", hasFeed: false }] },
    "/settings": { schedulingEnabled: false, scheduling: { timezone: TZ } },
};

describe("the mounted page", () => {
    it("R1 course c1's groups answer arriving after c2 was chosen (and after c2's answer) is dropped", async () => {
        const c1 = deferred<unknown>();
        const c2 = deferred<unknown>();
        state.answers = { ...SETUP, "/scheduling/admin/courses/c1/runs": () => c1.promise, "/scheduling/admin/courses/c2/runs": () => c2.promise };
        await mount("/scheduling/courses?course=c1");
        await act(async () => { void nav.go!("/scheduling/courses?course=c2"); });
        await flush();
        await act(async () => { c2.resolve({ runs: [run({ id: "run-c2", courseId: "c2", language: null })] }); });
        await flush();
        await act(async () => { c1.resolve({ runs: [run({ id: "run-c1", language: "en" })] }); });
        await flush();
        expect(document.body.textContent).toContain("Groups of Atelier avansați");
        expect(document.body.textContent).toContain("language not set");
        expect(document.body.textContent).not.toContain("(2 meetings), en");
        expect(document.body.textContent).toContain("Scheduling is off for this site");
    });

    it("F1 F8 new group: 3 days in a row with one time range, a trainer and a group link → one POST with those meetings", async () => {
        state.answers = {
            ...SETUP, "/scheduling/admin/courses/c1/runs": { runs: [] },
            "POST /scheduling/admin/courses/c1/runs": run(),
        };
        await mount("/scheduling/courses?course=c1");
        await click(button("New group")!);
        await type(document.querySelector("#quick-from") as HTMLInputElement, "2027-02-06");
        await type(document.querySelector("#quick-count") as HTMLInputElement, "3");
        await click(button("Add these meetings")!);
        expect(document.querySelectorAll('[aria-label$=" date"]').length).toBe(3);
        await type(document.querySelector('[aria-label="Meeting 3 start"]') as HTMLInputElement, "14:00");
        await type(document.querySelector('[aria-label="Meeting 3 end"]') as HTMLInputElement, "17:00");
        const trainer = [...document.querySelectorAll('input[type="checkbox"]')][0] as HTMLInputElement;
        await click(trainer);
        await type(document.querySelector("#run-link") as HTMLInputElement, "https://chat.whatsapp.com/abc");
        await click(button("Create group")!);
        expect(lastBody("POST /scheduling/admin/courses/c1/runs")).toEqual({
            meetings: [
                { date: "2027-02-06", start: "10:00", end: "13:00" }, { date: "2027-02-07", start: "10:00", end: "13:00" },
                { date: "2027-02-08", start: "14:00", end: "17:00" },
            ],
            capacity: 12, trainerIds: ["r1"], groupLink: "https://chat.whatsapp.com/abc",
        });
        expect(document.body.textContent).toContain("Group created.");
    });

    it("F5 cancel: the confirmation counts the roster; after the cancel the answer counts are shown in plain words", async () => {
        const people = [
            { bookingId: "b1", ref: "B-1", name: "Ana", email: "ana@example.com", state: "confirmed", source: "visitor" },
            { bookingId: "b2", ref: "B-2", name: "Ion", email: "ion@example.com", state: "held", expiresAt: "2027-01-01T10:00:00.000Z", source: "visitor" },
        ];
        state.answers = {
            ...SETUP, "/scheduling/admin/courses/c1/runs": { runs: [run({ taken: 2 })] },
            "/scheduling/admin/courses/c1/runs/run-1aaaaaaa/roster": { run: run({ taken: 2 }), people },
            "POST /scheduling/admin/courses/c1/runs/run-1aaaaaaa/cancel": { unplaced: 1, cancelled: 1, notSentPlacementChanged: 0, tokenCleanupFailed: 0 },
        };
        await mount("/scheduling/courses?course=c1");
        await click(button("Cancel group")!);
        expect(document.body.textContent).toContain('1 person becomes "without a group" and stays in the course. 1 unconfirmed place is cancelled.');
        await click(button("Cancel the group")!);
        expect(state.calls).toContain("POST /scheduling/admin/courses/c1/runs/run-1aaaaaaa/cancel");
        expect(document.body.textContent).toContain("The group was cancelled. 1 person is now without a group. 1 unconfirmed place was cancelled.");
    });

    it("a course with groups: the 409 courseInUse is shown as plain text", async () => {
        state.answers = {
            ...SETUP, "/scheduling/admin/courses/c1/runs": { runs: [] },
            "DELETE /scheduling/admin/courses/c1": api(409, { code: "courseInUse", error: "The course has groups or people without a group." }),
        };
        await mount("/scheduling/courses?course=c1");
        vi.spyOn(window, "confirm").mockReturnValue(true);
        await click(document.querySelector('[aria-label="Delete Bijuterie începători"]') as HTMLButtonElement);
        expect(document.body.textContent).toContain("This course cannot be deleted: it has groups (cancelled groups count too) or people without a group.");
    });

    // Review R1: completions apply their effects only within the selection lifetime they started in (useSelectionLifetime,
    // dialog identity).
    /** The course whose groups are shown ("Groups of <name>" is the groups card's title). */
    const shownCourse = () => (document.body.textContent ?? "").match(/Groups of (Bijuterie începători|Atelier avansați|Nou)/)?.[0] ?? "";

    it("R1 a course created while the admin chose another course: the answer does not change the selection", async () => {
        const created = deferred<unknown>();
        state.answers = {
            ...SETUP, "/scheduling/admin/courses/c1/runs": { runs: [] }, "/scheduling/admin/courses/c2/runs": { runs: [] },
            "POST /scheduling/admin/courses": () => created.promise,
        };
        await mount("/scheduling/courses?course=c1");
        await click(button("New course")!);
        await type(document.querySelector("#course-name") as HTMLInputElement, "Nou");
        await click(button("Add course")!);
        await act(async () => { void nav.go!("/scheduling/courses?course=c2"); });
        await flush();
        await act(async () => { created.resolve({ id: "c3", name: "Nou", defaultCapacity: 12, languages: [] }); });
        await flush();
        expect(shownCourse()).toContain("Groups of Atelier avansați");
    });

    it("R1 a course deleted while the admin chose another course: the answer does not change the selection", async () => {
        const deleted = deferred<unknown>();
        state.answers = {
            ...SETUP, "/scheduling/admin/courses/c1/runs": { runs: [] }, "/scheduling/admin/courses/c2/runs": { runs: [] },
            "DELETE /scheduling/admin/courses/c1": () => deleted.promise,
        };
        await mount("/scheduling/courses?course=c1");
        vi.spyOn(window, "confirm").mockReturnValue(true);
        await click(document.querySelector('[aria-label="Delete Bijuterie începători"]') as HTMLButtonElement);
        await act(async () => { void nav.go!("/scheduling/courses?course=c2"); });
        await flush();
        await act(async () => { deleted.resolve({}); });
        await flush();
        expect(shownCourse()).toContain("Groups of Atelier avansați");
    });

    it("R1 a saved course form closes; a form opened during the save stays open with its own values", async () => {
        const saved = deferred<unknown>();
        state.answers = { ...SETUP, "/scheduling/admin/courses/c1/runs": { runs: [] }, "PUT /scheduling/admin/courses/c1": () => saved.promise };
        await mount("/scheduling/courses?course=c1");
        await click(buttons("Edit")[0]);
        await click(button("Save course")!);
        await click(buttons("Edit")[1]); // the form of c2, opened while c1's save is in flight
        await act(async () => { saved.resolve(COURSE); });
        await flush();
        expect((document.querySelector("#course-name") as HTMLInputElement | null)?.value).toBe("Atelier avansați");
    });

    it("R1 a group dialog's completion closes only itself: an Edit dialog opened after it stays open; F1 'not set' names the visitor rule with a language preference", async () => {
        const moved = deferred<unknown>();
        state.answers = {
            ...SETUP, "/scheduling/admin/courses/c1/runs": { runs: [run()] },
            "POST /scheduling/admin/courses/c1/runs/run-1aaaaaaa/move": () => moved.promise,
        };
        await mount("/scheduling/courses?course=c1");
        await click(button("Move")!);
        await click(button("Move the group")!);
        await click(button("Close")!);
        await click(buttons("Edit").at(-1)!); // the group's Edit
        expect(button("Save group")).toBeDefined();
        await act(async () => { moved.resolve({ run: run(), mailed: 2, notSentPlacementChanged: 0 }); });
        await flush();
        expect(button("Save group")).toBeDefined();
        expect(document.body.textContent).toContain('"Moved" mails accepted for sending: 2.');
        const notSet = [...(document.querySelector("#run-language") as HTMLSelectElement).options].find((o) => o.value === "");
        expect(notSet?.textContent).toBe("Not set (the first site booking with a language preference sets it; your placements do not)");
    });

    // Review-1 R1: a lifetime ends on a selection change or unmount and never comes back (A → B → A).
    const NOU: CourseDTO = { id: "c3", name: "Nou", defaultCapacity: 12, languages: [] };

    it("R1 A → B → A before an old create answer resolves: the answer does not change the selection", async () => {
        const created = deferred<unknown>();
        state.answers = {
            ...SETUP, "/scheduling/admin/courses": { courses: [COURSE, COURSE_B, NOU] },
            "/scheduling/admin/courses/c1/runs": { runs: [] }, "/scheduling/admin/courses/c2/runs": { runs: [] },
            "/scheduling/admin/courses/c3/runs": { runs: [] }, "POST /scheduling/admin/courses": () => created.promise,
        };
        await mount("/scheduling/courses?course=c1");
        await click(button("New course")!);
        await type(document.querySelector("#course-name") as HTMLInputElement, "Nou");
        await click(button("Add course")!);
        await act(async () => { void nav.go!("/scheduling/courses?course=c2"); });
        await flush();
        await act(async () => { void nav.go!("/scheduling/courses?course=c1"); });
        await flush();
        await act(async () => { created.resolve(NOU); });
        await flush();
        expect(nav.at).toBe("/scheduling/courses?course=c1");
        expect(shownCourse()).toBe("Groups of Bijuterie începători");
    });

    it("R1 leaving the page during course creation: the answer does not navigate back", async () => {
        const created = deferred<unknown>();
        state.answers = { ...SETUP, "/scheduling/admin/courses/c1/runs": { runs: [] }, "POST /scheduling/admin/courses": () => created.promise };
        await mount("/scheduling/courses?course=c1");
        await click(button("New course")!);
        await type(document.querySelector("#course-name") as HTMLInputElement, "Nou");
        await click(button("Add course")!);
        await act(async () => { void nav.go!("/elsewhere"); });
        await flush();
        await act(async () => { created.resolve(NOU); });
        await flush();
        expect(nav.at).toBe("/elsewhere");
    });

    it("R1 A → B → A while a group dialog's write is pending: neither the dialog nor its notice comes back", async () => {
        const moved = deferred<unknown>();
        state.answers = {
            ...SETUP, "/scheduling/admin/courses/c1/runs": { runs: [run()] }, "/scheduling/admin/courses/c2/runs": { runs: [] },
            "POST /scheduling/admin/courses/c1/runs/run-1aaaaaaa/move": () => moved.promise,
        };
        await mount("/scheduling/courses?course=c1");
        await click(button("Move")!);
        await click(button("Move the group")!);
        await act(async () => { void nav.go!("/scheduling/courses?course=c2"); });
        await flush();
        await act(async () => { void nav.go!("/scheduling/courses?course=c1"); });
        await flush();
        expect(button("Move the group")).toBeUndefined(); // the old dialog does not reappear
        await act(async () => { moved.resolve({ run: run(), mailed: 2, notSentPlacementChanged: 0 }); });
        await flush();
        expect(document.body.textContent).not.toContain("accepted for sending");
    });
});
