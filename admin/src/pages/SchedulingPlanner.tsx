import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, Plus, Trash2 } from "lucide-react";
import {
    DaySettingSchema, LocalDateSchema, LocalTimeSchema, PersonSchema, instantToLocal, localDaySpan, localToInstant,
    type Actor, type AvailabilityRule, type BookingSource, type BookingState, type BookingWhat, type DayOverride, type DaySetting,
    type Eligibility, type HistoryEntry, type Instant, type LocalDate, type LocalWindow, type Person, type Placement, type TimeZone,
} from "@amodx/shared";
import { schedulingErrorText } from "./Scheduling";

/*
 * SCHED-1E2 (docs/slices/sched-1.md § 23, § 10.3 routes of `sched-1e`) — the week planner of one resource. English UI.
 * PROTOTYPE.
 *
 * One read per resource and week (`GET …/resources/{r}/week?start=<Monday>`) gives every day: its source (weekly
 * hours, edited hours, day off), its windows, the part an edit removed, the open time, the bookings and holds, and the
 * bookings outside the hours. The page draws that answer; it decides nothing the server decides. Writes: a day or a
 * range (`PUT …/days`), "copy this week to the next N weeks" (`POST …/days/copy-week`), a manual appointment
 * (`POST /scheduling/admin/appointments`) and a move (`POST …/bookings/{id}/move-slot`). After every write the week is
 * read again. Times are shown in the zone of the answer (`WeekPlanDTO.timezone`), never the browser's.
 *
 * The page also opens the link of the weekly mail (§ 11.4, § 23.5): `?tenant=<id>&week=<date>`. `plannerAccess`
 * decides, after the tenant list has loaded, whether to show the week, switch to the link's site (once; the switch
 * reloads the page), or show "You do not have access to this site." — and no scheduling request is sent unless it
 * says "show" (review-0 R1: also after an in-app navigation).
 *
 * The pure functions and `useSelectionData` below are exported for SchedulingPlanner.test.ts (as Scheduling.tsx does)
 * and are used by SchedulingAppointments.tsx and SchedulingAppointmentsBooking.tsx.
 */

// ---------------------------------------------------------------------------------------------------------------
// DTOs of § 10.3 as the backend sends them (backend/src/scheduling/admin/appt-week.ts, booking-dto.ts)
// ---------------------------------------------------------------------------------------------------------------

export type ResourceDTO = { id: string; name: string; hasFeed: boolean };
export type ServiceDTO = { id: string; name: string; durationMin: number; eligibility: Eligibility };
export type PlannerEntry = {
    bookingId: string; ref: string; start: string; end: string; state: "held" | "confirmed"; expiresAt?: string;
    customerName: string; serviceName: string;
};
export type DayDTO = { date: LocalDate } & (
    | { kind: "past"; entries: PlannerEntry[] }
    | {
        kind: "planned"; source: "default" | DayOverride["kind"]; windows: LocalWindow[]; removed: LocalWindow[];
        note?: string; entries: PlannerEntry[]; open: { start: string; end: string }[]; outsideHours: string[];
    });
export type WeekPlanDTO = {
    timezone: TimeZone; resourceId: string; resourceName: string; lastBookableDate: LocalDate;
    defaults: AvailabilityRule[]; days: DayDTO[];
};
export type DayEditResult = { changed: LocalDate[]; outsideHours: string[] };
export type PlacementDTO = { kind: "slot"; resourceId: string; start: string; end: string };
export type HistoryEntryDTO =
    | { action: "created"; at: string; state: "held" | "confirmed"; placement: PlacementDTO }
    | { action: "confirmed"; at: string }
    | { action: "cancelled"; at: string; by: Actor }
    | { action: "moved"; at: string; by: Actor; from: PlacementDTO; to: PlacementDTO };
export type BookingAdminDTO = {
    id: string; ref: string; rev: number;
    what: { kind: "slot"; serviceId: string; serviceName: string; resourceId: string; resourceName: string | null; start: string; end: string };
    state:
        | { kind: "held"; expiresAt: string; mail: "pending" | "sent" | "failed" }
        | { kind: "confirmed"; at: string }
        | { kind: "cancelled"; at: string; by: Actor };
    source: BookingSource; who: Person; createdAt: string; updatedAt: string;
    history: HistoryEntryDTO[];
};

/*
 * Review-0 R5 (row A14): the DTO unions above are copies (the admin cannot import backend code), so an exhaustive
 * `switch` over a copy alone would not break when the shared union gains a variant. Rule: every copied union that the
 * admin switches on is tied to its shared union by `Same` below — a variant added to (or removed from) either side
 * makes `Same` false and this declaration a compile error, which then sends the reader to the switches over the copy.
 * `DayDTO.source` and `Actor`/`BookingSource` are the shared types themselves, so their switches break directly.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;
export type SharedUnionLinks = [
    Expect<Same<HistoryEntryDTO["action"], HistoryEntry["action"]>>,
    Expect<Same<PlacementDTO["kind"], Placement["kind"]>>,
    Expect<Same<BookingAdminDTO["what"]["kind"], BookingWhat["kind"]>>,
    Expect<Same<BookingAdminDTO["state"]["kind"], BookingState["kind"]>>,
];
/** Witness that `Same` refuses one variant more (verified on every typecheck: the line must stay an error). */
// @ts-expect-error — a fifth history action is not the same union
export type SharedUnionLinkWitness = Expect<Same<HistoryEntryDTO["action"], HistoryEntry["action"] | "fifthAction">>;

// ---------------------------------------------------------------------------------------------------------------
// Dates and times (pure). Local dates are "YYYY-MM-DD" strings; calendar arithmetic needs no zone.
// ---------------------------------------------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function isLocalDateText(text: string): boolean {
    return LocalDateSchema.safeParse(text).success;
}

/** `date` plus `days` calendar days. `date` must be a real date. */
export function addDays(date: LocalDate, days: number): LocalDate {
    return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday, Monday 1 … Sunday 7. */
export function weekdayOf(date: LocalDate): number {
    const js = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return js === 0 ? 7 : js;
}

/** The Monday of the week that contains `date`. */
export function mondayOf(date: LocalDate): LocalDate {
    return addDays(date, 1 - weekdayOf(date));
}

/** The local date of `now` in `tz` (the tenant's "today"). */
export function todayIn(tz: TimeZone, now: number): LocalDate {
    return instantToLocal(now, tz).date;
}

function minutesOf(time: string): number {
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function hhmm(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** An instant (ISO) as local text in `tz`: "Mon 2026-12-07 09:00". */
export function formatWhen(iso: string, tz: TimeZone): string {
    const l = instantToLocal(Date.parse(iso), tz);
    return `${WEEKDAYS[weekdayOf(l.date) - 1]} ${l.date} ${l.time}`;
}

/** The UTC offset of `tz` at `at`, as text: "UTC+3", "UTC+5:30", "UTC-4". */
function offsetText(at: Instant, tz: TimeZone): string {
    const l = instantToLocal(at, tz);
    const minutes = Math.round((Date.parse(`${l.date}T${l.time}:00.000Z`) - (at - (((at % MINUTE_MS) + MINUTE_MS) % MINUTE_MS))) / MINUTE_MS);
    const abs = Math.abs(minutes);
    return `UTC${minutes < 0 ? "-" : "+"}${Math.floor(abs / 60)}${abs % 60 === 0 ? "" : `:${String(abs % 60).padStart(2, "0")}`}`;
}

/**
 * The instant of a window bound (local wall time `time` on `date`). Review-0 R3 and § 5.5: "a window bound in a spring
 * gap is taken at the first local minute that exists after it"; an ambiguous (autumn) time is the earlier instant
 * (`localToInstant`). The server's `planDay` uses the same rule, so the drawn hours and the answer's `open` agree.
 */
function boundInstant(date: LocalDate, time: string, tz: TimeZone): Instant {
    for (let m = minutesOf(time); m < 1440; m++) {
        const at = localToInstant(date, hhmm(m), tz);
        if (at.ok) return at.value;
    }
    return localDaySpan(date, tz).end;
}

// ---------------------------------------------------------------------------------------------------------------
// The planner link (§ 23.5; rows E17, E19, E20, E24)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The page query (E24): `tenant` (empty → absent), `week` (a real date → the Monday of its week; absent or malformed
 * → `null`, the caller shows the current week), `resource` (empty → absent).
 */
export function parsePlannerQuery(search: string): { tenant: string | null; week: LocalDate | null; resource: string | null } {
    const q = new URLSearchParams(search);
    const text = (key: string) => {
        const v = q.get(key);
        return v === null || v.trim() === "" ? null : v;
    };
    const week = text("week");
    return { tenant: text("tenant"), week: week !== null && isLocalDateText(week) ? mondayOf(week) : null, resource: text("resource") };
}

export type PlannerAccess =
    | { kind: "wait" }                        // the tenant list is loading
    | { kind: "noSite" }                      // no link tenant and no current site
    | { kind: "show" }                        // the current site is the one to show
    | { kind: "switch"; tenantId: string }    // the link names another site of the user's list: select it (reloads)
    | { kind: "noAccess" };                   // the link names a site the user's list does not have

/**
 * § 23.5: what the page does with the link's `tenant`. The list is `TenantContext.tenants` (what `GET /tenants`
 * allows this user). The backend still checks the role per tenant: this decides only what the page asks for.
 */
export function plannerAccess(input: {
    loading: boolean; linkTenant: string | null; currentTenantId: string | null; tenantIds: string[];
}): PlannerAccess {
    if (input.loading) return { kind: "wait" };
    if (input.linkTenant === null || input.linkTenant === input.currentTenantId) {
        return input.currentTenantId === null ? { kind: "noSite" } : { kind: "show" };
    }
    return input.tenantIds.includes(input.linkTenant) ? { kind: "switch", tenantId: input.linkTenant } : { kind: "noAccess" };
}

// ---------------------------------------------------------------------------------------------------------------
// Data that belongs to the current selection (review-0 R1)
// ---------------------------------------------------------------------------------------------------------------

/** The identity of a selection (tenant, resource, week, booking, …); used only for equality. */
export function selectionKey(parts: string[]): string {
    return JSON.stringify(parts);
}

/**
 * Review-0 R1 — one rule for every scheduling admin screen: data is shown, and writes are offered, only when the data
 * was loaded for the CURRENT selection. `key` names the selection (`null` = nothing may be requested: no request is
 * sent). The hook:
 * - requests `fetch()` whenever `key` changes, and on `reload()`;
 * - applies an answer (data or error) only when it answers the LATEST request this hook made — an answer for an older
 *   selection, or an older reload of the same one, is dropped;
 * - returns `data`/`error` only when they were loaded for `key`; while the new selection loads, both are `null`.
 * A write takes its target from the data it was offered with, and the page reads again after it.
 *
 * Abstraction line: `useSelectionData` — users: SchedulingPlanner (setup, week), SchedulingAppointments (lists,
 * weekly hours), SchedulingAppointmentsBooking (booking); axis: none (one rule); rejected: a hand-written guard per
 * request (the form of the defect review-0 R1 found in all three pages).
 */
export function useSelectionData<T>(key: string | null, fetch: () => Promise<T>): {
    data: T | null; error: string | null; reload: () => Promise<void>;
} {
    const fetchRef = useRef(fetch);
    fetchRef.current = fetch;
    const keyRef = useRef(key);
    keyRef.current = key;
    const latest = useRef(0);
    const [state, setState] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
    const reload = useCallback(async () => {
        const requested = keyRef.current;
        const n = ++latest.current;
        if (requested === null) return;
        try {
            const data = await fetchRef.current();
            if (n === latest.current) setState({ key: requested, data, error: null });
        } catch (e) {
            if (n === latest.current) setState({ key: requested, data: null, error: plannerErrorText(e) });
        }
    }, []);
    useEffect(() => { void reload(); }, [key, reload]);
    const current = state !== null && state.key === key ? state : null;
    return { data: current?.data ?? null, error: current?.error ?? null, reload };
}

// ---------------------------------------------------------------------------------------------------------------
// The week view model (pure; row E15 through these tests and the operator's staging look)
// ---------------------------------------------------------------------------------------------------------------

/**
 * One stretch of a day's timeline, `[from, to)` in minutes ELAPSED since the day's local midnight (review-0 R3: not
 * wall-clock minutes, so a day of 23 or 25 hours keeps every real minute once and has no minute that does not exist):
 * - `open`: bookable time (`DayDTO.open`);
 * - `taken`: inside the hours and taken by a booking (the bookings are drawn over it);
 * - `removed`: weekly hours that a day edit took away (`DayDTO.removed`) — shown apart from `closed`;
 * - `closed`: outside the hours and not removed by an edit.
 * `fromText`/`toText`: the local times in the answer's zone (with the UTC offset on a clock-change day).
 */
export type SegmentKind = "open" | "taken" | "removed" | "closed";
export type Segment = { kind: SegmentKind; from: number; to: number; fromText: string; toText: string };
export type EntryView = {
    bookingId: string; ref: string; customerName: string; serviceName: string; state: "held" | "confirmed";
    /** Elapsed minutes on this day, clipped to the day. */
    from: number; to: number;
    /** "09:00–10:00" (a time on another day carries its date; on a clock-change day each time carries its offset). */
    timeText: string;
    /** "Held until 09:30" for a hold, else `null`. */
    heldText: string | null;
    outsideHours: boolean;
};
export type DayView = {
    date: LocalDate; label: string; isToday: boolean;
    kind: "past" | "planned";
    /** Minutes in this local day: 1440, or 1380 / 1500 on a clock-change day. */
    length: number;
    /** On a clock-change day: the sentence that says so; else `null`. */
    clockChange: string | null;
    /** On a clock-change day: the whole local hours at their elapsed position (the shared hour axis is wrong there). */
    marks: { at: number; text: string }[];
    /** The day's hours in words (also the non-colour form of the segments). */
    hoursText: string;
    removedText: string | null;
    note: string | null;
    /** `default` when the day follows the weekly hours; `null` for a past day. */
    source: "default" | DayOverride["kind"] | null;
    windows: LocalWindow[];
    segments: Segment[];
    entries: EntryView[];
    /** A day edit is accepted only from today on (§ 5.5 `startsInPast`). */
    editable: boolean;
    /** § 23.3: visitors cannot book this day yet. */
    afterHorizon: boolean;
    isLastBookable: boolean;
};
export type WeekView = {
    timezone: TimeZone; resourceName: string; weekStart: LocalDate; lastBookableDate: LocalDate;
    /** The elapsed minutes the grid draws, whole hours. */
    range: { from: number; to: number };
    days: DayView[];
};

type DayClock = { date: LocalDate; tz: TimeZone; start: Instant; end: Instant; length: number; changeDay: boolean };

function dayClock(date: LocalDate, tz: TimeZone): DayClock {
    const span = localDaySpan(date, tz);
    const length = Math.round((span.end - span.start) / MINUTE_MS);
    return { date, tz, start: span.start, end: span.end, length, changeDay: length !== 1440 };
}

/** Elapsed minutes of an instant on the day, clipped to `[0, length]`. */
function elapsed(clock: DayClock, at: Instant): number {
    return Math.min(clock.length, Math.max(0, Math.round((at - clock.start) / MINUTE_MS)));
}

/** Local text of an instant seen from the day: "HH:MM" (date added when another day; offset on a clock-change day). */
function localText(clock: DayClock, at: Instant): string {
    const l = instantToLocal(at, clock.tz);
    const base = l.date === clock.date ? l.time : `${l.date} ${l.time}`;
    return clock.changeDay ? `${base} (${offsetText(at, clock.tz)})` : base;
}

function windowsText(windows: { start: string; end: string }[]): string {
    return windows.map((w) => `${w.start}–${w.end}`).join(", ");
}

/** The timeline of a planned day: each elapsed minute classified from the answer's intervals, then joined. */
function daySegments(day: Extract<DayDTO, { kind: "planned" }>, clock: DayClock): Segment[] {
    const cls = new Array<SegmentKind>(clock.length).fill("closed");
    const mark = (start: Instant, end: Instant, kind: SegmentKind) => {
        for (let m = elapsed(clock, start); m < elapsed(clock, end); m++) cls[m] = kind;
    };
    for (const w of day.removed) mark(boundInstant(day.date, w.start, clock.tz), boundInstant(day.date, w.end, clock.tz), "removed");
    for (const w of day.windows) mark(boundInstant(day.date, w.start, clock.tz), boundInstant(day.date, w.end, clock.tz), "taken");
    for (const o of day.open) mark(Date.parse(o.start), Date.parse(o.end), "open");
    const out: { kind: SegmentKind; from: number; to: number }[] = [];
    for (let m = 0; m < clock.length; m++) {
        const last = out[out.length - 1];
        if (last !== undefined && last.kind === cls[m]) last.to = m + 1;
        else out.push({ kind: cls[m], from: m, to: m + 1 });
    }
    return out.map((s) => ({
        ...s, fromText: localText(clock, clock.start + s.from * MINUTE_MS), toText: localText(clock, clock.start + s.to * MINUTE_MS),
    }));
}

function entryView(e: PlannerEntry, clock: DayClock, outside: boolean): EntryView {
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    return {
        bookingId: e.bookingId, ref: e.ref, customerName: e.customerName, serviceName: e.serviceName, state: e.state,
        from: elapsed(clock, start), to: elapsed(clock, end),
        timeText: `${localText(clock, start)}–${localText(clock, end)}`,
        heldText: e.state === "held" && e.expiresAt !== undefined ? `Held until ${localText(clock, Date.parse(e.expiresAt))}` : null,
        outsideHours: outside,
    };
}

/** On a clock-change day, every whole local hour at its elapsed position (an hour that repeats is listed twice). */
function hourMarks(clock: DayClock): { at: number; text: string }[] {
    if (!clock.changeDay) return [];
    const marks: { at: number; text: string }[] = [];
    for (let m = 0; m < clock.length; m++) {
        const at = clock.start + m * MINUTE_MS;
        if (instantToLocal(at, clock.tz).time.endsWith(":00")) marks.push({ at: m, text: localText(clock, at) });
    }
    return marks;
}

function dayView(day: DayDTO, tz: TimeZone, today: LocalDate, lastBookableDate: LocalDate): DayView {
    const clock = dayClock(day.date, tz);
    const base = {
        date: day.date, label: `${WEEKDAYS[weekdayOf(day.date) - 1]} ${day.date}`, isToday: day.date === today,
        length: clock.length, marks: hourMarks(clock),
        clockChange: !clock.changeDay ? null
            : clock.length < 1440 ? "Clocks go forward on this day (it is shorter): the hours are marked in this column."
                : "Clocks go back on this day (it is longer): the hours are marked in this column.",
        editable: day.date >= today, afterHorizon: day.date > lastBookableDate, isLastBookable: day.date === lastBookableDate,
    };
    switch (day.kind) {
        case "past":
            return {
                ...base, kind: "past", hoursText: "Past (hours no longer kept)", removedText: null, note: null, source: null,
                windows: [], segments: [], entries: day.entries.map((e) => entryView(e, clock, false)),
            };
        case "planned": {
            let hoursText: string;
            switch (day.source) {
                case "default": hoursText = day.windows.length === 0 ? "Closed (no weekly hours)" : `Weekly hours ${windowsText(day.windows)}`; break;
                case "dayHours": hoursText = `Edited hours ${windowsText(day.windows)}`; break;
                case "dayOff": hoursText = "Day off"; break;
                default: {
                    const never: never = day.source;
                    throw new Error(`Unhandled source ${String(never)}`);
                }
            }
            return {
                ...base, kind: "planned", hoursText,
                removedText: day.removed.length === 0 ? null : `Removed by this day's edit: ${windowsText(day.removed)}`,
                note: day.note ?? null, source: day.source, windows: day.windows,
                segments: daySegments(day, clock),
                entries: day.entries.map((e) => entryView(e, clock, day.outsideHours.includes(e.ref))),
            };
        }
        default: {
            const never: never = day;
            throw new Error(`Unhandled day ${JSON.stringify(never)}`);
        }
    }
}

const DEFAULT_RANGE = { from: 8 * 60, to: 18 * 60 };

/**
 * The grid of one week: each day's view and the elapsed minutes the grid draws — from the earliest to the latest
 * minute that is open, taken, removed by an edit, or booked in the week, widened to whole hours (08:00-18:00 when the
 * week has none).
 */
export function weekView(week: WeekPlanDTO, today: LocalDate): WeekView {
    const days = week.days.map((d) => dayView(d, week.timezone, today, week.lastBookableDate));
    let from = Infinity;
    let to = -Infinity;
    for (const d of days) {
        for (const s of d.segments) if (s.kind !== "closed") { from = Math.min(from, s.from); to = Math.max(to, s.to); }
        for (const e of d.entries) { from = Math.min(from, e.from); to = Math.max(to, e.to); }
    }
    const longest = Math.max(1440, ...days.map((d) => d.length));
    const range = from === Infinity ? DEFAULT_RANGE
        : { from: Math.floor(from / 60) * 60, to: Math.min(longest, Math.max(Math.ceil(to / 60) * 60, Math.floor(from / 60) * 60 + 60)) };
    return {
        timezone: week.timezone, resourceName: week.resourceName, weekStart: week.days[0]?.date ?? "",
        lastBookableDate: week.lastBookableDate, range, days,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Request bodies and answers (pure)
// ---------------------------------------------------------------------------------------------------------------

export type WindowRow = { start: string; end: string };
export type DayForm = { kind: "dayHours" | "dayOff" | "default"; windows: WindowRow[]; note: string };

function issueText(prefix: string, issue: { path: PropertyKey[]; message: string }): string {
    return `${[prefix, ...issue.path.map(String)].join(".")}: ${issue.message}`;
}

/** The `value` of a day edit, checked with the shared `DaySettingSchema` (the server's schema); an error names the field. */
export function daySettingOf(form: DayForm): { ok: true; value: DaySetting } | { ok: false; error: string } {
    const note = form.note.trim() === "" ? {} : { note: form.note.trim() };
    let raw: unknown;
    switch (form.kind) {
        case "dayHours": raw = { kind: "dayHours", windows: form.windows.map((w) => ({ start: w.start.trim(), end: w.end.trim() })), ...note }; break;
        case "dayOff": raw = { kind: "dayOff", ...note }; break;
        case "default": raw = { kind: "default" }; break;
        default: {
            const never: never = form.kind;
            throw new Error(`Unhandled kind ${String(never)}`);
        }
    }
    const parsed = DaySettingSchema.safeParse(raw);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: issueText("value", parsed.error.issues[0]) };
}

/** `POST …/days/copy-week`: this week onto the next `weeks` weeks (1-52, § 4.5). */
export function copyWeekBody(weekStart: LocalDate, weeksText: string)
    : { ok: true; body: { sourceStart: LocalDate; targetStart: LocalDate; weeks: number } } | { ok: false; error: string } {
    const weeks = Number(weeksText);
    if (weeksText.trim() === "" || !Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
        return { ok: false, error: "weeks: Enter a whole number of weeks from 1 to 52." };
    }
    return { ok: true, body: { sourceStart: weekStart, targetStart: addDays(weekStart, 7), weeks } };
}

/**
 * What the page says after a day edit (§ 23.4: the edit stands; bookings outside the new hours stay and are listed by
 * their reference until the admin moves or cancels each one).
 */
export function editResultText(r: DayEditResult): { message: string; conflicts: string[] } {
    const message = r.changed.length === 0 ? "Saved. No date changed." : `Saved. ${r.changed.length} date(s) changed.`;
    if (r.outsideHours.length === 0) return { message, conflicts: [] };
    return {
        message: `${message} ${r.outsideHours.length} booking(s) are now outside the hours. They stay booked and nobody was mailed: move or cancel each one.`,
        conflicts: r.outsideHours,
    };
}

/** The instant (ISO) of a local date and time in `tz`; an error text for a malformed value or a time in a clock gap. */
export function startInstant(date: string, time: string, tz: TimeZone): { ok: true; value: string } | { ok: false; error: string } {
    if (!isLocalDateText(date.trim())) return { ok: false, error: "date: Enter a date as YYYY-MM-DD." };
    if (!LocalTimeSchema.safeParse(time.trim()).success) return { ok: false, error: "time: Enter a time as HH:MM." };
    const at = localToInstant(date.trim(), time.trim(), tz);
    if (!at.ok) return { ok: false, error: "time: This time does not exist on that date (the clock moves forward)." };
    return { ok: true, value: new Date(at.value).toISOString() };
}

export type AppointmentForm = { serviceId: string; date: string; time: string; name: string; email: string; phone: string; channel: string };

/**
 * `POST /scheduling/admin/appointments`: the body, or the first problem (the server's `PersonSchema` for the person).
 * Any existing service with any resource (review-0 R2, § 5.2: the admin books any service for any resource; visitor
 * eligibility does not apply).
 */
export function manualAppointmentBody(form: AppointmentForm, resourceId: string, tz: TimeZone)
    : { ok: true; body: { serviceId: string; resourceId: string; start: string; who: Person; channel: string } } | { ok: false; error: string } {
    if (form.serviceId === "") return { ok: false, error: "serviceId: Choose a service." };
    const start = startInstant(form.date, form.time, tz);
    if (!start.ok) return start;
    const who = PersonSchema.safeParse({
        email: form.email.trim(), name: form.name.trim(), ...(form.phone.trim() === "" ? {} : { phone: form.phone.trim() }),
    });
    if (!who.success) return { ok: false, error: issueText("who", who.error.issues[0]) };
    const channel = form.channel.trim();
    if (channel.length < 1 || channel.length > 40) return { ok: false, error: "channel: 1 to 40 characters (for example: phone)." };
    return { ok: true, body: { serviceId: form.serviceId, resourceId, start: start.value, who: who.data, channel } };
}

/** `POST /scheduling/admin/bookings/{id}/move-slot`: the new start and resource, on the `rev` the admin saw. */
export function moveSlotBody(form: { date: string; time: string; resourceId: string }, tz: TimeZone, rev: number)
    : { ok: true; body: { start: string; resourceId: string; rev: number } } | { ok: false; error: string } {
    if (form.resourceId === "") return { ok: false, error: "resourceId: Choose a resource." };
    const start = startInstant(form.date, form.time, tz);
    if (!start.ok) return start;
    return { ok: true, body: { start: start.value, resourceId: form.resourceId, rev } };
}

/** The text of a failed call: a 400 `invalid` lists its issues (path and message); otherwise as `schedulingErrorText`. */
export function plannerErrorText(e: unknown): string {
    if (e instanceof ApiError && e.body !== null && typeof e.body === "object") {
        const body = e.body as { code?: string; issues?: { path: string; message: string }[] };
        if (body.code === "invalid" && Array.isArray(body.issues) && body.issues.length > 0) {
            return `The request is not valid: ${body.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`;
        }
    }
    return schedulingErrorText(e);
}

// ---------------------------------------------------------------------------------------------------------------
// The appointment dialog: a manual appointment (from a planner day) or a move (from the planner or the booking page)
// ---------------------------------------------------------------------------------------------------------------

export type AppointmentDialogMode =
    /** `services`: every service of the site (review-0 R2: visitor eligibility does not limit the admin, § 5.2). */
    | { kind: "create"; resourceId: string; date: LocalDate; services: ServiceDTO[] }
    | { kind: "move"; booking: BookingAdminDTO; resources: ResourceDTO[] };

export function AppointmentDialog({ mode, tz, onClose, onDone }: {
    mode: AppointmentDialogMode; tz: TimeZone; onClose: () => void; onDone: (booking: BookingAdminDTO) => void;
}) {
    const slot = mode.kind === "move" && mode.booking.what.kind === "slot" ? mode.booking.what : null;
    const startLocal = slot !== null ? instantToLocal(Date.parse(slot.start), tz) : null;
    const [form, setForm] = useState<AppointmentForm>({
        serviceId: "", date: mode.kind === "create" ? mode.date : startLocal?.date ?? "", time: startLocal?.time ?? "09:00",
        name: "", email: "", phone: "", channel: "phone",
    });
    const [resourceId, setResourceId] = useState(slot?.resourceId ?? "");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit() {
        let request: { path: string; body: unknown };
        if (mode.kind === "create") {
            const built = manualAppointmentBody(form, mode.resourceId, tz);
            if (!built.ok) { setError(built.error); return; }
            request = { path: "/scheduling/admin/appointments", body: built.body };
        } else {
            const built = moveSlotBody({ date: form.date, time: form.time, resourceId }, tz, mode.booking.rev);
            if (!built.ok) { setError(built.error); return; }
            request = { path: `/scheduling/admin/bookings/${encodeURIComponent(mode.booking.id)}/move-slot`, body: built.body };
        }
        setBusy(true);
        setError(null);
        try {
            onDone(await apiRequest(request.path, { method: "POST", body: JSON.stringify(request.body) }) as BookingAdminDTO);
        } catch (e) {
            setError(plannerErrorText(e));
        } finally {
            setBusy(false);
        }
    }

    const field = (key: keyof AppointmentForm, label: string, props: Record<string, string> = {}) => (
        <div className="space-y-1">
            <Label htmlFor={`appt-${key}`}>{label}</Label>
            <Input id={`appt-${key}`} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
        </div>
    );

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{mode.kind === "create" ? "Add an appointment" : `Move ${mode.booking.ref}`}</DialogTitle>
                    <DialogDescription>
                        {mode.kind === "create"
                            ? `Confirmed at once; the customer gets the "Confirmed" mail with a link. Times are in ${tz}. You can book outside the hours.`
                            : `The customer gets the "Moved" mail. Times are in ${tz}. You can move outside the hours.`}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
                    {mode.kind === "create" && (
                        <div className="space-y-1">
                            <Label htmlFor="appt-service">Service</Label>
                            <select id="appt-service" className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
                                <option value="">Choose a service…</option>
                                {mode.services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>)}
                            </select>
                            {mode.services.length === 0 && <p className="text-xs text-muted-foreground">No service yet. Add one under Services and weekly hours.</p>}
                        </div>
                    )}
                    {mode.kind === "move" && (
                        <div className="space-y-1">
                            <Label htmlFor="appt-resource">Resource</Label>
                            <select id="appt-resource" className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                                {mode.resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        {field("date", "Date", { type: "date" })}
                        {field("time", "Start time", { type: "time", step: "300" })}
                    </div>
                    {mode.kind === "create" && (
                        <>
                            {field("name", "Customer name")}
                            {field("email", "Customer email", { type: "email" })}
                            {field("phone", "Phone (optional)")}
                            {field("channel", "Booked by (for example: phone, in person)")}
                        </>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Close</Button>
                    <Button onClick={submit} disabled={busy}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {mode.kind === "create" ? "Add appointment" : "Move"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// The day edit dialog: one day or a range of dates
// ---------------------------------------------------------------------------------------------------------------

const MAX_WINDOWS = 8; // § 4.5 windows per day

function DayEditDialog({ initial, onClose, onSave }: {
    initial: { from: LocalDate; to: LocalDate; form: DayForm; single: boolean };
    onClose: () => void;
    onSave: (from: LocalDate, to: LocalDate, value: DaySetting) => Promise<string | null>;
}) {
    const [from, setFrom] = useState(initial.from);
    const [to, setTo] = useState(initial.to);
    const [form, setForm] = useState<DayForm>(initial.form);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function save() {
        if (!isLocalDateText(from) || !isLocalDateText(to)) { setError("from/to: Enter the dates as YYYY-MM-DD."); return; }
        const value = daySettingOf(form);
        if (!value.ok) { setError(value.error); return; }
        setBusy(true);
        setError(await onSave(from, to, value.value));
        setBusy(false);
    }
    const setWindow = (i: number, key: keyof WindowRow, v: string) =>
        setForm({ ...form, windows: form.windows.map((w, j) => (j === i ? { ...w, [key]: v } : w)) });

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{initial.single ? `Edit ${from}` : "Edit a range of dates"}</DialogTitle>
                    <DialogDescription>
                        An edit replaces the weekly hours of each date. Later changes of the weekly hours do not reach an edited
                        date until you set it back to the weekly hours. Bookings stay; the answer lists those outside the new hours.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
                    {!initial.single && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1"><Label htmlFor="edit-from">From</Label><Input id="edit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                            <div className="space-y-1"><Label htmlFor="edit-to">To (included)</Label><Input id="edit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-4 text-sm">
                        {([["dayHours", "These hours"], ["dayOff", "Day off"], ["default", "Weekly hours (remove the edit)"]] as const).map(([kind, label]) => (
                            <label key={kind} className="flex items-center gap-2">
                                <input type="radio" name="day-kind" checked={form.kind === kind} onChange={() => setForm({ ...form, kind })} /> {label}
                            </label>
                        ))}
                    </div>
                    {form.kind === "dayHours" && (
                        <div className="space-y-2">
                            {form.windows.map((w, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <Input aria-label={`Window ${i + 1} start`} type="time" step="300" value={w.start} onChange={(e) => setWindow(i, "start", e.target.value)} />
                                    <span>–</span>
                                    <Input aria-label={`Window ${i + 1} end`} type="time" step="300" value={w.end} onChange={(e) => setWindow(i, "end", e.target.value)} />
                                    <Button variant="outline" size="sm" aria-label="Remove window" onClick={() => setForm({ ...form, windows: form.windows.filter((_, j) => j !== i) })}>
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </div>
                            ))}
                            {form.windows.length < MAX_WINDOWS && (
                                <Button variant="outline" size="sm" onClick={() => setForm({ ...form, windows: [...form.windows, { start: "09:00", end: "17:00" }] })}>
                                    <Plus className="mr-1 h-3 w-3" /> Add hours
                                </Button>
                            )}
                            <p className="text-xs text-muted-foreground">Times on 5-minute steps, sorted, not overlapping; at most {MAX_WINDOWS} per day.</p>
                        </div>
                    )}
                    {form.kind !== "default" && (
                        <div className="space-y-1">
                            <Label htmlFor="edit-note">Note (only you see it)</Label>
                            <Input id="edit-note" maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Close</Button>
                    <Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------

/** Visual form of each stretch: a fill AND a pattern or border AND a word, so colour is never the only difference. */
const SEGMENT_STYLE: Record<SegmentKind, { className: string; label: string }> = {
    open: { className: "bg-background border-l-4 border-primary", label: "Open" },
    taken: { className: "bg-background", label: "" },
    removed: { className: "bg-destructive/10 bg-[repeating-linear-gradient(45deg,var(--destructive)_0_1px,transparent_1px_7px)]", label: "Removed" },
    closed: { className: "bg-muted bg-[repeating-linear-gradient(135deg,var(--border)_0_2px,transparent_2px_8px)]", label: "Closed" },
};

const PX_PER_MIN = 0.9;

function Legend() {
    const swatch = (cls: string) => <span className={`inline-block h-4 w-6 rounded-sm border ${cls}`} />;
    return (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">{swatch(SEGMENT_STYLE.open.className)} Open (bookable)</span>
            <span className="flex items-center gap-1">{swatch("bg-primary")} Booked</span>
            <span className="flex items-center gap-1">{swatch("border-2 border-dashed border-primary bg-primary/10")} Held (waiting for the customer)</span>
            <span className="flex items-center gap-1">{swatch(SEGMENT_STYLE.closed.className)} Closed</span>
            <span className="flex items-center gap-1">{swatch(SEGMENT_STYLE.removed.className)} Removed by a day edit</span>
            <span className="flex items-center gap-1"><span className="font-semibold text-destructive">⚠ Outside hours</span> a booking outside the day's hours</span>
        </div>
    );
}

type Setup = { tz: string | null; enabled: boolean; resources: ResourceDTO[]; services: ServiceDTO[] };
/** A write's target, taken from the data the action was offered with (review-0 R1). */
type Target = { key: string; resourceId: string };

export default function SchedulingPlanner() {
    const { tenants, currentTenant, isLoading, selectTenant } = useTenant();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const query = parsePlannerQuery(location.search);
    const access = plannerAccess({
        loading: isLoading, linkTenant: query.tenant, currentTenantId: currentTenant?.id ?? null, tenantIds: tenants.map((t) => t.id),
    });

    // E19: select the link's site once; `selectTenant` stores it and reloads this same path, after which the two are equal.
    const switchTo = access.kind === "switch" ? access.tenantId : null;
    const switched = useRef<string | null>(null);
    useEffect(() => {
        if (switchTo !== null && switched.current !== switchTo) {
            switched.current = switchTo;
            selectTenant(switchTo);
        }
    }, [switchTo]);

    // Every request is keyed by the selection and sent only while access is "show" (E20, also after in-app navigation).
    const tenantId = access.kind === "show" ? currentTenant?.id ?? null : null;
    const setup = useSelectionData<Setup>(tenantId === null ? null : selectionKey([tenantId]), async () => {
        const [settings, res, svc] = await Promise.all([
            apiRequest("/settings"), apiRequest("/scheduling/admin/resources"), apiRequest("/scheduling/admin/services"),
        ]);
        const tz = typeof settings.scheduling?.timezone === "string" ? settings.scheduling.timezone : null;
        return { tz, enabled: settings.schedulingEnabled === true, resources: res.resources, services: svc.services };
    });
    const s = setup.data;
    const resourceId = s === null ? null : s.resources.some((r) => r.id === query.resource) ? query.resource : s.resources[0]?.id ?? null;
    const weekStart = s?.tz ? query.week ?? mondayOf(todayIn(s.tz, Date.now())) : null;
    const weekKey = tenantId !== null && resourceId !== null && weekStart !== null ? selectionKey([tenantId, resourceId, weekStart]) : null;
    const week = useSelectionData<WeekPlanDTO>(weekKey, () =>
        apiRequest(`/scheduling/admin/resources/${encodeURIComponent(resourceId ?? "")}/week?start=${weekStart}`));
    const weekKeyRef = useRef(weekKey);
    weekKeyRef.current = weekKey;

    // Messages, dialogs and errors of an action belong to the selection they were made in.
    const [actionError, setActionError] = useState<{ key: string | null; text: string } | null>(null);
    const [notice, setNotice] = useState<{ key: string; message: string; conflicts: string[] } | null>(null);
    const [dayEdit, setDayEdit] = useState<{ target: Target; from: LocalDate; to: LocalDate; form: DayForm; single: boolean } | null>(null);
    const [appointment, setAppointment] = useState<{ key: string; mode: AppointmentDialogMode } | null>(null);
    const [copyWeeks, setCopyWeeks] = useState("4");
    const [jumpDate, setJumpDate] = useState("");
    useEffect(() => { setDayEdit(null); setAppointment(null); }, [weekKey]);

    const shown = week.data; // only ever the week of `weekKey`
    const target: Target | null = shown !== null && weekKey !== null ? { key: weekKey, resourceId: shown.resourceId } : null;
    const fail = (key: string | null, e: unknown) => setActionError({ key, text: plannerErrorText(e) });

    function go(changes: { week?: LocalDate; resource?: string }) {
        const next = new URLSearchParams(searchParams);
        if (changes.week !== undefined) next.set("week", changes.week);
        if (changes.resource !== undefined) next.set("resource", changes.resource);
        setSearchParams(next);
    }

    async function saveDays(t: Target, from: LocalDate, to: LocalDate, value: DaySetting): Promise<string | null> {
        try {
            const result: DayEditResult = await apiRequest(`/scheduling/admin/resources/${encodeURIComponent(t.resourceId)}/days`, {
                method: "PUT", body: JSON.stringify({ from, to, value }),
            });
            setNotice({ key: t.key, ...editResultText(result) });
            setActionError(null);
            setDayEdit(null);
            await week.reload();
            return null;
        } catch (e) {
            return plannerErrorText(e);
        }
    }
    async function quickDay(t: Target, date: LocalDate, value: DaySetting, question: string) {
        if (!confirm(question)) return;
        const failure = await saveDays(t, date, date, value);
        if (failure !== null) setActionError({ key: t.key, text: failure });
    }
    async function copyWeek(t: Target, start: LocalDate) {
        const built = copyWeekBody(start, copyWeeks);
        if (!built.ok) { setActionError({ key: t.key, text: built.error }); return; }
        if (!confirm(`The next ${built.body.weeks} week(s) from ${built.body.targetStart} will match this week: its day edits are copied, and the other days of those weeks go back to the weekly hours.`)) return;
        try {
            const result: DayEditResult = await apiRequest(`/scheduling/admin/resources/${encodeURIComponent(t.resourceId)}/days/copy-week`, {
                method: "POST", body: JSON.stringify(built.body),
            });
            setNotice({ key: t.key, ...editResultText(result) });
            setActionError(null);
            await week.reload();
        } catch (e) {
            fail(t.key, e);
        }
    }
    async function openMove(t: Target, bookingId: string) {
        try {
            const booking: BookingAdminDTO = await apiRequest(`/scheduling/admin/bookings/${encodeURIComponent(bookingId)}`);
            if (weekKeyRef.current !== t.key) return; // the selection changed while the booking was read
            setAppointment({ key: t.key, mode: { kind: "move", booking, resources: s?.resources ?? [] } });
        } catch (e) {
            fail(t.key, e);
        }
    }

    const header = (
        <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><CalendarDays className="h-7 w-7" /> Week planner</h1>
            <p className="text-muted-foreground">
                Every week is open with the weekly hours. Edit a day or a range of dates, or copy a week onto the next weeks.{" "}
                <Link className="underline" to="/scheduling/appointments">Services and weekly hours</Link>
            </p>
        </div>
    );

    switch (access.kind) {
        case "wait":
        case "switch":
            return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;
        case "noSite":
            return <div className="p-8">Select a site.</div>;
        case "noAccess":
            return <div className="p-8 space-y-6">{header}<p>You do not have access to this site.</p></div>;
        case "show":
            break;
        default: {
            const never: never = access;
            throw new Error(`Unhandled access ${JSON.stringify(never)}`);
        }
    }

    const errorText = setup.error ?? week.error ?? (actionError !== null && actionError.key === weekKey ? actionError.text : null);
    const errorBox = errorText && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{errorText}</div>;
    if (s === null) return <div className="p-8 space-y-6">{header}{errorBox || <div className="flex justify-center"><Loader2 className="animate-spin" /></div>}</div>;
    if (s.tz === null) {
        return (
            <div className="p-8 space-y-6">{header}
                <p>Set the site's time zone first: <Link className="underline" to="/scheduling">Scheduling settings</Link>.</p>
            </div>
        );
    }
    if (s.resources.length === 0) {
        return <div className="p-8 space-y-6">{header}<p>No resources yet. Add one under <Link className="underline" to="/scheduling">Scheduling</Link>.</p></div>;
    }
    const tz = s.tz;

    const today = shown ? todayIn(shown.timezone, Date.now()) : null;
    const view = shown && today ? weekView(shown, today) : null;
    const rangeFrom = view?.range.from ?? 0;
    const rangeLen = view ? view.range.to - view.range.from : 1;
    const height = rangeLen * PX_PER_MIN;
    const top = (m: number) => `${((Math.max(m, rangeFrom) - rangeFrom) / rangeLen) * 100}%`;
    const span = (a: number, b: number) => `${((Math.min(b, rangeFrom + rangeLen) - Math.max(a, rangeFrom)) / rangeLen) * 100}%`;
    const hours = view ? Array.from({ length: rangeLen / 60 }, (_, i) => rangeFrom + i * 60).filter((m) => m < 1440) : [];
    const shownNotice = notice !== null && notice.key === weekKey ? notice : null;

    return (
        <div className="p-8 space-y-6">
            {header}
            {!s.enabled && (
                <p className="rounded-md border p-3 text-sm">Scheduling is off for this site: visitors cannot book yet. You can prepare the weeks now.</p>
            )}
            {errorBox}
            {shownNotice && (
                <div className="rounded-md border p-3 text-sm space-y-1">
                    <p>{shownNotice.message}</p>
                    {shownNotice.conflicts.length > 0 && (
                        <ul className="list-disc pl-5 font-semibold text-destructive">
                            {shownNotice.conflicts.map((ref) => <li key={ref}>⚠ {ref} — outside the hours</li>)}
                        </ul>
                    )}
                </div>
            )}

            <Card>
                <CardHeader className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                            <Label htmlFor="planner-resource">Resource</Label>
                            <select id="planner-resource" className="rounded-md border bg-background px-3 py-2 text-sm"
                                value={resourceId ?? ""} onChange={(e) => go({ resource: e.target.value })}>
                                {s.resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                        </div>
                        {weekStart && (
                            <div className="flex flex-wrap items-center gap-1">
                                <Button variant="outline" size="sm" onClick={() => go({ week: addDays(weekStart, -28) })}><ChevronsLeft className="h-4 w-4" /> 4 weeks</Button>
                                <Button variant="outline" size="sm" onClick={() => go({ week: addDays(weekStart, -7) })}><ChevronLeft className="h-4 w-4" /> Week</Button>
                                <Button variant="outline" size="sm" onClick={() => go({ week: mondayOf(todayIn(tz, Date.now())) })}>This week</Button>
                                <Button variant="outline" size="sm" onClick={() => go({ week: addDays(weekStart, 7) })}>Week <ChevronRight className="h-4 w-4" /></Button>
                                <Button variant="outline" size="sm" onClick={() => go({ week: addDays(weekStart, 28) })}>4 weeks <ChevronsRight className="h-4 w-4" /></Button>
                                <Input aria-label="Go to date" type="date" className="w-40" value={jumpDate} onChange={(e) => setJumpDate(e.target.value)} />
                                <Button variant="outline" size="sm" disabled={!isLocalDateText(jumpDate)} onClick={() => go({ week: mondayOf(jumpDate) })}>Go</Button>
                            </div>
                        )}
                    </div>
                    {view && target && (
                        <>
                            <CardTitle>{view.resourceName}: week of {view.weekStart} to {addDays(view.weekStart, 6)}</CardTitle>
                            <CardDescription>
                                Times in {view.timezone}. Visitors can book until {view.lastBookableDate} (the booking horizon).
                            </CardDescription>
                            <div className="flex flex-wrap items-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => setDayEdit({
                                    target, from: today !== null && view.weekStart < today ? today : view.weekStart, to: addDays(view.weekStart, 6),
                                    form: { kind: "dayOff", windows: [{ start: "09:00", end: "17:00" }], note: "" }, single: false,
                                })}>Edit a range of dates</Button>
                                <span className="text-sm">Copy this week to the next</span>
                                <Input aria-label="Number of weeks" type="number" min={1} max={52} className="w-20" value={copyWeeks} onChange={(e) => setCopyWeeks(e.target.value)} />
                                <span className="text-sm">weeks</span>
                                <Button variant="outline" size="sm" onClick={() => copyWeek(target, view.weekStart)}>Copy</Button>
                            </div>
                            <Legend />
                        </>
                    )}
                </CardHeader>
                <CardContent>
                    {!view || !target ? (!errorText && <div className="flex justify-center"><Loader2 className="animate-spin" /></div>) : (
                        <div className="flex gap-1 overflow-x-auto">
                            <div className="relative w-12 shrink-0 text-xs text-muted-foreground" style={{ height, marginTop: 112 }}>
                                {hours.map((m) => <div key={m} className="absolute" style={{ top: top(m) }}>{hhmm(m)}</div>)}
                            </div>
                            {view.days.map((d) => (
                                <div key={d.date} data-day={d.date} className={`min-w-[9rem] flex-1 ${d.isToday ? "ring-2 ring-primary rounded-md" : ""}`}>
                                    <div className="h-28 space-y-1 overflow-y-auto p-1 text-xs">
                                        <div className="font-semibold">{d.label}{d.isToday ? " (today)" : ""}</div>
                                        <div>{d.hoursText}</div>
                                        {d.removedText && <div className="italic">{d.removedText}</div>}
                                        {d.note && <div className="italic">Note: {d.note}</div>}
                                        {d.clockChange && <div className="font-semibold">{d.clockChange}</div>}
                                        {d.isLastBookable && <div className="font-semibold">Last day visitors can book</div>}
                                        {d.afterHorizon && <div className="text-muted-foreground">After the booking horizon: visitors cannot book yet</div>}
                                    </div>
                                    <div className={`relative overflow-hidden rounded-md border ${d.afterHorizon ? "opacity-70" : ""}`} style={{ height }}>
                                        {d.kind === "past" && <div className="absolute inset-0 bg-muted p-1 text-[10px]">Past</div>}
                                        {d.segments.filter((g) => g.to > rangeFrom && g.from < rangeFrom + rangeLen).map((g) => (
                                            <div key={`${g.kind}-${g.from}`} title={`${SEGMENT_STYLE[g.kind].label || "Booked"} ${g.fromText}–${g.toText}`}
                                                className={`absolute inset-x-0 px-1 text-[10px] ${SEGMENT_STYLE[g.kind].className}`}
                                                style={{ top: top(g.from), height: span(g.from, g.to) }}>
                                                {(g.to - g.from) * PX_PER_MIN >= 14 && SEGMENT_STYLE[g.kind].label}
                                            </div>
                                        ))}
                                        {d.marks.filter((k) => k.at >= rangeFrom && k.at < rangeFrom + rangeLen).map((k) => (
                                            <div key={`mark-${k.at}`} className="absolute right-0 z-10 bg-background px-1 text-[9px]" style={{ top: top(k.at) }}>{k.text}</div>
                                        ))}
                                        {/* Review-0 R4: the block is the booking's true occupancy only; its full text and actions are in the list below. */}
                                        {d.entries.map((e) => (
                                            <div key={e.bookingId} data-entry-block={e.ref} aria-hidden="true"
                                                className={`absolute inset-x-1 overflow-hidden rounded px-1 text-[10px] leading-tight ${e.state === "held" ? "border-2 border-dashed border-primary bg-primary/10" : "bg-primary text-primary-foreground"} ${e.outsideHours ? "ring-2 ring-destructive" : ""}`}
                                                style={{ top: top(e.from), height: span(e.from, e.to) }}
                                                title={`${e.ref} ${e.timeText} ${e.customerName} · ${e.serviceName}`}>
                                                {e.outsideHours ? "⚠ " : ""}{e.ref}
                                            </div>
                                        ))}
                                    </div>
                                    {d.entries.length > 0 && (
                                        <ul className="space-y-1 p-1 text-xs" aria-label={`Bookings on ${d.date}`}>
                                            {d.entries.map((e) => (
                                                <li key={e.bookingId} data-entry={e.ref} className={`rounded border p-1 ${e.state === "held" ? "border-dashed" : ""}`}>
                                                    <div className="font-semibold">
                                                        {e.outsideHours && <span className="text-destructive">⚠ Outside hours · </span>}
                                                        {e.state === "held" ? "Held · " : "Booked · "}{e.ref}
                                                    </div>
                                                    <div>{e.timeText}</div>
                                                    <div>{e.customerName} · {e.serviceName}</div>
                                                    {e.heldText && <div>{e.heldText}</div>}
                                                    <div className="flex gap-2">
                                                        <Link className="underline" to={`/scheduling/bookings/${encodeURIComponent(e.bookingId)}`}>Details</Link>
                                                        {e.state === "confirmed" && <button className="underline" onClick={() => openMove(target, e.bookingId)}>Move</button>}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {d.kind === "planned" && (
                                        <div className="flex flex-wrap gap-1 p-1">
                                            {d.editable && (
                                                <>
                                                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setDayEdit({
                                                        target, from: d.date, to: d.date, single: true,
                                                        form: { kind: "dayHours", windows: d.windows.length > 0 ? d.windows.map((w) => ({ ...w })) : [{ start: "09:00", end: "17:00" }], note: d.note ?? "" },
                                                    })}>Edit hours</Button>
                                                    {d.source !== "dayOff" && (
                                                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => quickDay(target, d.date, { kind: "dayOff" }, `Make ${d.date} a day off? Its bookings stay and are listed.`)}>Day off</Button>
                                                    )}
                                                    {d.source !== "default" && (
                                                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => quickDay(target, d.date, { kind: "default" }, `Set ${d.date} back to the weekly hours?`)}>Weekly hours</Button>
                                                    )}
                                                </>
                                            )}
                                            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setAppointment({
                                                key: target.key, mode: { kind: "create", resourceId: target.resourceId, date: d.date, services: s.services },
                                            })}><Plus className="h-3 w-3" /> Appointment</Button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {dayEdit && dayEdit.target.key === weekKey && (
                <DayEditDialog initial={dayEdit} onClose={() => setDayEdit(null)} onSave={(from, to, value) => saveDays(dayEdit.target, from, to, value)} />
            )}
            {appointment && appointment.key === weekKey && view && (
                <AppointmentDialog mode={appointment.mode} tz={view.timezone} onClose={() => setAppointment(null)}
                    onDone={(b) => {
                        setAppointment(null);
                        setNotice({ key: appointment.key, message: `${b.ref} saved.`, conflicts: [] });
                        void week.reload();
                    }} />
            )}
        </div>
    );
}
