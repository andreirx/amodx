// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route, useNavigate, type NavigateFunction } from "react-router-dom";

/*
 * SCHED-1F2 — the people of a course (docs/slices/sched-1.md § 4.4, § 5.4, § 10.3; screen parts of rows F2, F3, F5,
 * F7, F9 of § 17.3) and the group move on the booking page. Pure functions are tested directly (the CSV export of F9
 * among them); the pages are also mounted (jsdom) with the tenant context, Amplify and `apiRequest` replaced (records
 * "<path>" for a read and "<METHOD> <path>" for a write; an answer may be a function returning a promise).
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
import SchedulingRoster, {
    ROSTER_CSV_COLUMNS, csvCell, manualSeatBody, moveSeatTarget, moveTargets, rosterCsv, rosterCsvFileName, rosterSourceText,
    rosterStateText, seatNotice, type PersonForm,
} from "./SchedulingRoster";
import SchedulingAppointmentsBooking from "./SchedulingAppointmentsBooking";
import type { CourseDTO, RosterRow, RunAdminDTO } from "./SchedulingCourses";
import type { BookingAdminDTO } from "./SchedulingPlanner";

const TZ = "Europe/Bucharest";
const COURSE: CourseDTO = { id: "c1", name: "Bijuterie începători", defaultCapacity: 12, languages: ["ro", "en"] };
const run = (over: Partial<RunAdminDTO> = {}): RunAdminDTO => ({
    id: "run-1aaaaaaa", courseId: "c1", meetings: [{ date: "2027-02-06", start: "10:00", end: "13:00" }],
    timezone: TZ, capacity: 12, taken: 2, overCapacityBy: 0, trainerIds: ["r1"], language: "ro", status: "open",
    firstStart: "2027-02-06T08:00:00.000Z", lastEnd: "2027-02-06T11:00:00.000Z", ...over,
});
const ANA: RosterRow = {
    bookingId: "b1", ref: "B-11111111", name: "Ana Ionescu", email: "ana@example.com", phone: "+40 721 000 000", language: "ro",
    state: "confirmed", source: "manual", channel: "transfer",
};
const ION: RosterRow = {
    bookingId: "b2", ref: "B-22222222", name: "Ion Țăranu", email: "ion@example.com", state: "held", expiresAt: "2027-01-10T08:30:00.000Z", source: "visitor",
};

describe("F9 CSV export — pure, from the roster JSON", () => {
    it("F9 csvCell: a value starting with =, +, -, @, tab or CR gets a leading ' (not run as a formula)", () => {
        expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
        expect(csvCell("+40 721")).toBe("'+40 721");
        expect(csvCell("-1")).toBe("'-1");
        expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
        expect(csvCell("\tx")).toBe("'\tx");
        expect(csvCell("\rx")).toBe("\"'\rx\"");
        expect(csvCell("a=b")).toBe("a=b"); // only the first character counts
    });

    it("F9 csvCell: RFC 4180 — a comma, a double quote or a line break puts the field in quotes, quotes doubled; others stay bare", () => {
        expect(csvCell("Ionescu, Ana")).toBe("\"Ionescu, Ana\"");
        expect(csvCell("Ana \"Mica\"")).toBe("\"Ana \"\"Mica\"\"\"");
        expect(csvCell("line1\nline2")).toBe("\"line1\nline2\"");
        expect(csvCell("Țăranu")).toBe("Țăranu");
        expect(csvCell("")).toBe("");
    });

    it("F9 rosterCsv: BOM, the stated columns, CRLF lines, Romanian letters, held-until in the group's zone, guarded phone", () => {
        const text = rosterCsv([ANA, ION], TZ);
        expect(text.startsWith("﻿")).toBe(true);
        expect(text.endsWith("\r\n")).toBe(true);
        const lines = text.slice(1).split("\r\n");
        expect(lines[0]).toBe(ROSTER_CSV_COLUMNS.join(","));
        expect(lines[0]).toBe("Reference,Name,Email,Phone,Language,State,Held until,Source,Channel");
        expect(lines[1]).toBe("B-11111111,Ana Ionescu,ana@example.com,'+40 721 000 000,ro,confirmed,,By hand,transfer");
        expect(lines[2]).toBe("B-22222222,Ion Țăranu,ion@example.com,,,held,2027-01-10 10:30,Site,");
        expect(lines.length).toBe(4); // header, two people, the empty string after the last CRLF
        // UTF-8 with BOM in the file: the Blob the page builds encodes the text as UTF-8 (EF BB BF first).
        const bytes = new TextEncoder().encode(text);
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    });

    it("F9 the file name: course, the group's first date and its short id; characters a file system refuses are removed", () => {
        expect(rosterCsvFileName(COURSE.name, run())).toBe("Bijuterie-începători_2027-02-06_group-run-1aaa.csv");
        expect(rosterCsvFileName("A/B: \"x\"?", run({ id: "1a2b3c4d5e" }))).toBe("AB-x_2027-02-06_group-1a2b3c4d.csv");
        expect(rosterCsvFileName("   ", run())).toBe("course_2027-02-06_group-run-1aaa.csv");
    });
});

describe("roster words", () => {
    it("F2 a held place shows its expiry in the given zone; a confirmed place says so; the source words", () => {
        expect(rosterStateText(ION, TZ)).toBe("Held until Sun 2027-01-10 10:30");
        expect(rosterStateText(ANA, TZ)).toBe("Confirmed");
        expect([ANA, ION, { ...ION, source: "order" as const }].map(rosterSourceText)).toEqual(["By hand", "Site", "Order"]);
    });
});

describe("F3 moving a person", () => {
    it("F3 targets: every group of the course but cancelled ones and the person's own; closed, other-language and full groups are offered", () => {
        const runs = [
            run({ id: "own" }), run({ id: "closed", status: "closed" }), run({ id: "en", language: "en" }),
            run({ id: "full", taken: 12 }), run({ id: "gone", status: "cancelled" }),
        ];
        expect(moveTargets(runs, "own").map((r) => r.id)).toEqual(["closed", "en", "full"]);
        expect(moveTargets(runs, null).map((r) => r.id)).toEqual(["own", "closed", "en", "full"]);
    });

    it("F3 the choice → runId: a group id, null for 'without a group', nothing chosen refused", () => {
        expect(moveSeatTarget("run:r2")).toEqual({ ok: true, runId: "r2" });
        expect(moveSeatTarget("unplaced")).toEqual({ ok: true, runId: null });
        expect(moveSeatTarget("").ok).toBe(false);
        expect(moveSeatTarget("run:").ok).toBe(false);
    });
});

describe("F7 manual entry — POST /scheduling/admin/seats", () => {
    const form: PersonForm = { name: " Maria ", email: " Maria@Example.COM ", phone: "", language: "", channel: " cash ", runId: "" };

    it("F7 without a group → no runId (the person is 'without a group'); with a group → its runId", () => {
        const none = manualSeatBody(form, "c1");
        expect(none).toEqual({ ok: true, body: { courseId: "c1", who: { name: "Maria", email: "maria@example.com" }, channel: "cash" } });
        if (none.ok) expect("runId" in none.body).toBe(false);
        expect(manualSeatBody({ ...form, runId: "r1", language: "ro", phone: "0721" }, "c1")).toEqual({ ok: true, body: {
            courseId: "c1", runId: "r1", who: { name: "Maria", email: "maria@example.com", phone: "0721", language: "ro" }, channel: "cash",
        } });
    });

    it("F7 a bad email, an empty name and an empty channel are refused before sending", () => {
        expect(manualSeatBody({ ...form, email: "nope" }, "c1").ok).toBe(false);
        expect(manualSeatBody({ ...form, name: " " }, "c1").ok).toBe(false);
        expect(manualSeatBody({ ...form, channel: " " }, "c1")).toEqual({ ok: false, error: "channel: 1 to 40 characters (for example: phone, transfer, cash)." });
    });
});

describe("R2 R3 notices describe the booking the server returned, and claim no delivery", () => {
    const runs = [run(), run({ id: "run-2bbbbbbb", language: "en", meetings: [{ date: "2027-03-06", start: "10:00", end: "13:00" }], groupLink: "https://chat.whatsapp.com/x" })];
    const saved = (what: BookingAdminDTO["what"]): BookingAdminDTO => ({
        id: "b1", ref: "B-11111111", rev: 5, what, state: { kind: "confirmed", at: "2026-11-01T10:00:00.000Z" },
        source: { kind: "visitor" }, who: { email: "a@example.com", name: "A" }, createdAt: "2026-11-01T10:00:00.000Z",
        updatedAt: "2026-11-01T10:00:00.000Z", history: [],
    });
    const seatIn = (runId: string) => saved({ kind: "seat", courseId: "c1", courseName: "C", runId, firstStart: null });
    const unplaced = saved({ kind: "unplaced", courseId: "c1", courseName: "C" });

    it("R2 asked for group r2, the answer is 'without a group': the notice says so and that this move sent no notice", () => {
        expect(seatNotice("moved", unplaced, "run-2bbbbbbb", runs)).toBe(
            "The move is saved, but another change was saved at the same time: you asked to place it in the group 2027-03-06 (1 meeting), en. "
            + "B-11111111 is now without a group. This move sent no notice.");
    });

    it("R2 asked for 'without a group', the answer is a seat in another group: the returned group is named", () => {
        expect(seatNotice("moved", seatIn("run-1aaaaaaa"), null, runs)).toBe(
            "The move is saved, but another change was saved at the same time: you asked to place it without a group. "
            + "B-11111111 is now in the group 2027-02-06 (1 meeting), ro. This move sent no notice.");
        expect(seatNotice("moved", seatIn("run-1aaaaaaa"), "run-2bbbbbbb", runs)).toContain("is now in the group 2027-02-06 (1 meeting), ro.");
    });

    it("R2 R3 as asked: the place as saved, and the mail as attempted (never 'gets the mail'); a manual entry names the group link", () => {
        const moved = seatNotice("moved", seatIn("run-2bbbbbbb"), "run-2bbbbbbb", runs);
        expect(moved).toBe('The move is saved. B-11111111 is now in the group 2027-03-06 (1 meeting), en. The "Moved" mail is sent when that mail is on; this answer does not say whether it was sent.');
        const added = seatNotice("added", seatIn("run-2bbbbbbb"), "run-2bbbbbbb", runs);
        expect(added).toContain('The "Confirmed" mail with a link and the group link is sent when that mail is on');
        for (const text of [moved, added, seatNotice("moved", unplaced, null, runs)]) expect(text).not.toMatch(/gets the|was mailed|were mailed/);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// The mounted pages
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
                createElement(Route, { path: "/scheduling/courses/:courseId/roster", element: createElement(SchedulingRoster) }),
                createElement(Route, { path: "/scheduling/bookings/:bookingId", element: createElement(SchedulingAppointmentsBooking) }))));
    });
    await flush();
}
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const buttons = (text: string) => [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await flush(); };
async function choose(el: HTMLSelectElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
}
async function type(el: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
const lastBody = (call: string) => JSON.parse(state.bodies[state.calls.lastIndexOf(call)]!);
const R1 = run();
const R2 = run({ id: "run-2bbbbbbb", language: "en", meetings: [{ date: "2027-03-06", start: "10:00", end: "13:00" }], firstStart: "2027-03-06T08:00:00.000Z", lastEnd: "2027-03-06T11:00:00.000Z", taken: 0 });
const booking = (over: Partial<BookingAdminDTO> = {}): BookingAdminDTO => ({
    id: "b1", ref: "B-11111111", rev: 4,
    what: { kind: "seat", courseId: "c1", courseName: COURSE.name, runId: R1.id, firstStart: R1.firstStart },
    state: { kind: "confirmed", at: "2026-11-01T10:00:00.000Z" },
    source: { kind: "manual", adminEmail: "admin@example.com", channel: "transfer" }, who: { email: "ana@example.com", name: "Ana Ionescu", language: "ro" },
    createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", history: [], ...over,
});
const BASE = {
    "/scheduling/admin/courses": { courses: [COURSE] },
    "/scheduling/admin/resources": { resources: [{ id: "r1", name: "Ana", hasFeed: false }] },
    "/settings": { schedulingEnabled: true, scheduling: { timezone: TZ } },
    "/scheduling/admin/courses/c1/runs": { runs: [R2, R1] },
    "/scheduling/admin/courses/c1/unplaced": { people: [] },
};

describe("the mounted roster page", () => {
    it("F2 the group's people: name, email, phone, language, held with its expiry, confirmed, source and channel; a held place has no Move", async () => {
        state.answers = { ...BASE, "/scheduling/admin/courses/c1/runs/run-1aaaaaaa/roster": { run: R1, people: [ANA, ION] } };
        await mount("/scheduling/courses/c1/roster?group=run-1aaaaaaa");
        const text = document.body.textContent ?? "";
        for (const part of ["Ana Ionescu", "ana@example.com", "+40 721 000 000", "Confirmed", "By hand (transfer)", "Ion Țăranu", "Held until Sun 2027-01-10 10:30", "Site"]) {
            expect({ part, shown: text.includes(part) }).toEqual({ part, shown: true });
        }
        expect(buttons("Move").length).toBe(1);
        expect(text).toContain("Can be moved after the customer confirms");
    });

    it("R1 group g1's roster arriving after g2 was chosen (and after g2's roster) is dropped", async () => {
        const g1 = deferred<unknown>();
        const g2 = deferred<unknown>();
        state.answers = {
            ...BASE, "/scheduling/admin/courses/c1/runs/run-1aaaaaaa/roster": () => g1.promise,
            "/scheduling/admin/courses/c1/runs/run-2bbbbbbb/roster": () => g2.promise,
        };
        await mount("/scheduling/courses/c1/roster?group=run-1aaaaaaa");
        await choose(document.querySelector("#roster-group") as HTMLSelectElement, "run-2bbbbbbb");
        await act(async () => { g2.resolve({ run: R2, people: [ION] }); });
        await flush();
        await act(async () => { g1.resolve({ run: R1, people: [ANA] }); });
        await flush();
        expect(document.body.textContent).toContain("Ion Țăranu");
        expect(document.body.textContent).not.toContain("Ana Ionescu");
    });

    it("F3 move a confirmed person into a group of another language: the booking's rev is read, then one move-seat with that rev", async () => {
        state.answers = {
            ...BASE, "/scheduling/admin/courses/c1/runs/run-1aaaaaaa/roster": { run: R1, people: [ANA] },
            "/scheduling/admin/bookings/b1": booking(),
            "POST /scheduling/admin/bookings/b1/move-seat": booking({ rev: 5, what: { kind: "seat", courseId: "c1", courseName: COURSE.name, runId: R2.id, firstStart: R2.firstStart } }),
        };
        await mount("/scheduling/courses/c1/roster?group=run-1aaaaaaa");
        await click(button("Move")!);
        const select = document.querySelector("#move-target") as HTMLSelectElement;
        expect([...select.options].map((o) => o.value)).toEqual(["", "unplaced", "run:run-2bbbbbbb"]);
        await choose(select, "run:run-2bbbbbbb");
        await click(buttons("Move").at(-1)!);
        expect(lastBody("POST /scheduling/admin/bookings/b1/move-seat")).toEqual({ runId: "run-2bbbbbbb", rev: 4 });
        expect(document.body.textContent).toContain('The move is saved. B-11111111 is now in the group 2027-03-06 (1 meeting), en. The "Moved" mail is sent when that mail is on; this answer does not say whether it was sent.');
    });

    it("F5 a person without a group is placed into a group; a cancelled group is not offered; a 409 runCancelled is plain text", async () => {
        const unplacedAna = booking({ what: { kind: "unplaced", courseId: "c1", courseName: COURSE.name } });
        state.answers = {
            ...BASE, "/scheduling/admin/courses/c1/runs": { runs: [R1, run({ id: "gone", status: "cancelled" })] },
            "/scheduling/admin/courses/c1/unplaced": { people: [ANA] },
            "/scheduling/admin/bookings/b1": unplacedAna,
            "POST /scheduling/admin/bookings/b1/move-seat": new ApiError(409, { code: "runCancelled", error: "The group is cancelled." }, "API Error (409)"),
        };
        await mount("/scheduling/courses/c1/roster");
        await click(button("Place into a group")!);
        const select = document.querySelector("#move-target") as HTMLSelectElement;
        expect([...select.options].map((o) => o.value)).toEqual(["", "run:run-1aaaaaaa"]);
        await choose(select, "run:run-1aaaaaaa");
        await click(button("Move")!);
        expect(lastBody("POST /scheduling/admin/bookings/b1/move-seat")).toEqual({ runId: "run-1aaaaaaa", rev: 4 });
        expect(document.body.textContent).toContain("The group is cancelled. Choose another group.");
    });

    it("F7 manual entry without a group: POST /scheduling/admin/seats with no runId; the notice says 'without a group'", async () => {
        state.answers = { ...BASE, "POST /scheduling/admin/seats": booking({ ref: "B-33333333", what: { kind: "unplaced", courseId: "c1", courseName: COURSE.name } }) };
        await mount("/scheduling/courses/c1/roster");
        await click(button("Add a person")!);
        await type(document.querySelector("#person-name") as HTMLInputElement, "Maria");
        await type(document.querySelector("#person-email") as HTMLInputElement, "maria@example.com");
        await click(button("Add person")!);
        expect(lastBody("POST /scheduling/admin/seats")).toEqual({ courseId: "c1", who: { name: "Maria", email: "maria@example.com" }, channel: "phone" });
        expect(document.body.textContent).toContain('Added and confirmed. B-33333333 is now without a group. The "Confirmed" mail with a link is sent when that mail is on; this answer does not say whether it was sent.');
    });

    it("F9 Export CSV downloads the shown roster as UTF-8 with BOM under the course/date/group file name", async () => {
        state.answers = { ...BASE, "/scheduling/admin/courses/c1/runs/run-1aaaaaaa/roster": { run: R1, people: [ANA] } };
        let blob: Blob | null = null;
        let fileName = "";
        (URL as any).createObjectURL = (b: Blob) => { blob = b; return "blob:x"; };
        (URL as any).revokeObjectURL = () => {};
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { fileName = this.download; });
        await mount("/scheduling/courses/c1/roster?group=run-1aaaaaaa");
        await click(button("Export CSV")!);
        expect(fileName).toBe("Bijuterie-începători_2027-02-06_group-run-1aaa.csv");
        // jsdom's Blob has no stream(); FileReader gives its bytes.
        const bytes = await new Promise<Uint8Array>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
            reader.readAsArrayBuffer(blob!);
        });
        expect((blob as Blob | null)?.type).toBe("text/csv;charset=utf-8");
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        expect(new TextDecoder().decode(bytes)).toContain("Ana Ionescu");
    });
});

describe("the booking page — move-seat of a group booking", () => {
    it("F3 a confirmed seat: 'Move to another group' reads the course's groups, then one move-seat with the shown rev", async () => {
        state.answers = {
            "/settings": { scheduling: { timezone: TZ } }, "/scheduling/admin/resources": { resources: [] },
            "/scheduling/admin/bookings/b1": booking(), "/scheduling/admin/courses/c1/runs": { runs: [R1, R2] },
            "POST /scheduling/admin/bookings/b1/move-seat": booking({ rev: 5, what: { kind: "unplaced", courseId: "c1", courseName: COURSE.name } }),
        };
        await mount("/scheduling/bookings/b1");
        await click(button("Move to another group")!);
        expect(state.calls).toContain("/scheduling/admin/courses/c1/runs");
        await choose(document.querySelector("#move-target") as HTMLSelectElement, "unplaced");
        await click(button("Move")!);
        expect(lastBody("POST /scheduling/admin/bookings/b1/move-seat")).toEqual({ runId: null, rev: 4 });
        expect(document.body.textContent).toContain('The move is saved. B-11111111 is now without a group. The "No group" mail is sent when that mail is on;');
    });

    it("a held seat offers no group move", async () => {
        state.answers = {
            "/settings": { scheduling: { timezone: TZ } }, "/scheduling/admin/resources": { resources: [] },
            "/scheduling/admin/bookings/b1": booking({ state: { kind: "held", expiresAt: "2027-01-10T08:30:00.000Z", mail: "sent" } }),
        };
        await mount("/scheduling/bookings/b1");
        expect(document.body.textContent).toContain("Booking B-11111111");
        expect(button("Move to another group")).toBeUndefined();
    });
});

describe("R1 asynchronous completions apply only to the state they were started for", () => {
    const BEA: RosterRow = { ...ANA, bookingId: "b3", ref: "B-33333333", name: "Bea Pop", email: "bea@example.com" };

    it("R1 two 'Move' reads for different people: the earlier person's answer arriving last does not replace the later person's dialog", async () => {
        const ana = deferred<unknown>();
        const bea = deferred<unknown>();
        state.answers = {
            ...BASE, "/scheduling/admin/courses/c1/runs/run-1aaaaaaa/roster": { run: R1, people: [ANA, BEA] },
            "/scheduling/admin/bookings/b1": () => ana.promise, "/scheduling/admin/bookings/b3": () => bea.promise,
        };
        await mount("/scheduling/courses/c1/roster?group=run-1aaaaaaa");
        await click(buttons("Move")[0]); // Ana
        await click(buttons("Move")[1]); // Bea
        await act(async () => { bea.resolve(booking({ id: "b3", ref: "B-33333333", who: { email: "bea@example.com", name: "Bea Pop" } })); });
        await flush();
        await act(async () => { ana.resolve(booking()); });
        await flush();
        expect(document.body.textContent).toContain("Move B-33333333");
        expect(document.body.textContent).not.toContain("Move B-11111111");
    });

    it("R1 a 'Show more' page read before the list was read again (after a write) is not appended to the new list", async () => {
        const second = deferred<unknown>();
        let firstPages = 0;
        state.answers = {
            ...BASE,
            "/scheduling/admin/courses/c1/unplaced": async () => (++firstPages === 1 ? { people: [ANA], cursor: "k1" } : { people: [ANA] }),
            "/scheduling/admin/courses/c1/unplaced?cursor=k1": () => second.promise,
            "POST /scheduling/admin/seats": booking({ ref: "B-44444444", what: { kind: "unplaced", courseId: "c1", courseName: COURSE.name } }),
        };
        await mount("/scheduling/courses/c1/roster");
        await click(button("Show more")!);
        await click(button("Add a person")!);
        await type(document.querySelector("#person-name") as HTMLInputElement, "Maria");
        await type(document.querySelector("#person-email") as HTMLInputElement, "maria@example.com");
        await click(button("Add person")!); // the write reads the first page again: no cursor now
        expect(firstPages).toBe(2);
        await act(async () => { second.resolve({ people: [BEA], cursor: "k2" }); });
        await flush();
        expect(document.body.textContent).not.toContain("Bea Pop");
        expect(button("Show more")).toBeUndefined();
    });

    it("R1 a roster dialog's completion closes only itself: an Add dialog opened after it stays open", async () => {
        const moved = deferred<unknown>();
        state.answers = {
            ...BASE, "/scheduling/admin/courses/c1/runs/run-1aaaaaaa/roster": { run: R1, people: [ANA] },
            "/scheduling/admin/bookings/b1": booking(), "POST /scheduling/admin/bookings/b1/move-seat": () => moved.promise,
        };
        await mount("/scheduling/courses/c1/roster?group=run-1aaaaaaa");
        await click(button("Move")!);
        await choose(document.querySelector("#move-target") as HTMLSelectElement, "unplaced");
        await click(buttons("Move").at(-1)!);
        await click(button("Close")!);
        await click(button("Add a person")!);
        expect(button("Add person")).toBeDefined();
        await act(async () => { moved.resolve(booking({ rev: 5, what: { kind: "unplaced", courseId: "c1", courseName: COURSE.name } })); });
        await flush();
        expect(button("Add person")).toBeDefined();
        expect(document.body.textContent).toContain("B-11111111 is now without a group.");
    });

    it("R1 R2 booking page: the move dialog's completion closes only itself, and the notice names the returned place", async () => {
        const moved = deferred<unknown>();
        state.answers = {
            "/settings": { scheduling: { timezone: TZ } }, "/scheduling/admin/resources": { resources: [] },
            "/scheduling/admin/bookings/b1": booking(), "/scheduling/admin/courses/c1/runs": { runs: [R1, R2] },
            "POST /scheduling/admin/bookings/b1/move-seat": () => moved.promise,
        };
        await mount("/scheduling/bookings/b1");
        await click(button("Move to another group")!);
        await choose(document.querySelector("#move-target") as HTMLSelectElement, "run:run-2bbbbbbb");
        await click(button("Move")!);
        await click(button("Close")!);
        await click(button("Move to another group")!); // a second dialog, opened while the first move is in flight
        expect(document.querySelector("#move-target")).not.toBeNull();
        await act(async () => { moved.resolve(booking({ rev: 6, what: { kind: "unplaced", courseId: "c1", courseName: COURSE.name } })); });
        await flush();
        expect(document.querySelector("#move-target")).not.toBeNull();
        expect(document.body.textContent).toContain("you asked to place it in the group 2027-03-06 (1 meeting), en. B-11111111 is now without a group. This move sent no notice.");
    });

    // Review-1 R1: lifetimes end on a selection change, unmount or list refresh, and never come back.
    it("R1 A → B → A before an old 'Move' read resolves: no dialog opens", async () => {
        const ana = deferred<unknown>();
        state.answers = {
            ...BASE, "/scheduling/admin/courses/c1/runs/run-1aaaaaaa/roster": { run: R1, people: [ANA] },
            "/scheduling/admin/courses/c1/runs/run-2bbbbbbb/roster": { run: R2, people: [] },
            "/scheduling/admin/bookings/b1": () => ana.promise,
        };
        await mount("/scheduling/courses/c1/roster?group=run-1aaaaaaa");
        await click(button("Move")!);
        await choose(document.querySelector("#roster-group") as HTMLSelectElement, "run-2bbbbbbb");
        await choose(document.querySelector("#roster-group") as HTMLSelectElement, "run-1aaaaaaa");
        await act(async () => { ana.resolve(booking()); });
        await flush();
        expect(document.querySelector("#move-target")).toBeNull();
    });

    it("R1 an old 'Show more' answer arriving while the refreshed first page is pending is not shown, then or after", async () => {
        const oldPage = deferred<unknown>();
        const refreshed = deferred<unknown>();
        let firstPages = 0;
        state.answers = {
            ...BASE,
            "/scheduling/admin/courses/c1/unplaced": () => (++firstPages === 1 ? Promise.resolve({ people: [ANA], cursor: "k1" }) : refreshed.promise),
            "/scheduling/admin/courses/c1/unplaced?cursor=k1": () => oldPage.promise,
            "POST /scheduling/admin/seats": booking({ ref: "B-44444444", what: { kind: "unplaced", courseId: "c1", courseName: COURSE.name } }),
        };
        await mount("/scheduling/courses/c1/roster");
        await click(button("Show more")!);
        await click(button("Add a person")!);
        await type(document.querySelector("#person-name") as HTMLInputElement, "Maria");
        await type(document.querySelector("#person-email") as HTMLInputElement, "maria@example.com");
        await click(button("Add person")!);
        expect(firstPages).toBe(2); // the refresh is pending
        await act(async () => { oldPage.resolve({ people: [BEA] }); });
        await flush();
        expect(document.body.textContent).not.toContain("Bea Pop");
        await act(async () => { refreshed.resolve({ people: [ANA] }); });
        await flush();
        expect(document.body.textContent).not.toContain("Bea Pop");
    });

    it("R1 an old 'Show more' rejection arriving after the refresh shows no error", async () => {
        const oldPage = deferred<unknown>();
        let firstPages = 0;
        state.answers = {
            ...BASE,
            "/scheduling/admin/courses/c1/unplaced": async () => (++firstPages === 1 ? { people: [ANA], cursor: "k1" } : { people: [ANA] }),
            "/scheduling/admin/courses/c1/unplaced?cursor=k1": () => oldPage.promise.then(() => {
                throw new ApiError(503, { code: "busy", error: "Busy, please try again." }, "API Error (503)");
            }),
            "POST /scheduling/admin/seats": booking({ ref: "B-44444444", what: { kind: "unplaced", courseId: "c1", courseName: COURSE.name } }),
        };
        await mount("/scheduling/courses/c1/roster");
        await click(button("Show more")!);
        await click(button("Add a person")!);
        await type(document.querySelector("#person-name") as HTMLInputElement, "Maria");
        await type(document.querySelector("#person-email") as HTMLInputElement, "maria@example.com");
        await click(button("Add person")!);
        expect(firstPages).toBe(2);
        await act(async () => { oldPage.resolve(undefined); });
        await flush();
        expect(document.body.textContent).not.toContain("busy");
        expect(document.body.textContent).toContain("B-44444444 is now without a group."); // the write's notice stays
    });
});
