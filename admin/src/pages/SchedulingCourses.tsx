import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { GraduationCap, Loader2, Plus, Save, Trash2 } from "lucide-react";
import {
    CourseSchema, LocalTimeSchema, RunSchema, validateMeetings,
    type BookingSource, type LocalDate, type Meeting, type MeetingError, type RunStatus, type TimeZone,
} from "@amodx/shared";
import { addDays, isLocalDateText, plannerErrorText, selectionKey, useSelectionData, weekdayOf, type ResourceDTO } from "./SchedulingPlanner";

/*
 * SCHED-1F2 (docs/slices/sched-1.md § 4.3, § 5.4, § 10.3 routes of `sched-1f`; rows F1, F4-F6, F8 of § 17.3) — the
 * courses of a site and the groups (runs) of each course. English UI. PROTOTYPE.
 *
 * Courses: `GET/POST/PUT/DELETE /scheduling/admin/courses` (name, default capacity 1-45, languages ≤ 10). The 409
 * refusals (`languageInUse`, `courseInUse`) are shown as plain text.
 * Groups of the course chosen in `?course=`: `GET …/courses/{c}/runs`; create (`POST …/runs`) with the meetings
 * editor; edit (`PUT …/runs/{r}`: capacity, trainers, language, group link, open/closed — only the changed fields
 * are sent); move (`POST …/runs/{r}/move`, new meetings; a "Moved" notice is attempted per person); cancel (`POST …/runs/{r}/cancel`) after
 * a confirmation that counts, from the group's roster, who becomes "without a group" and whose unconfirmed place is
 * cancelled. The answer counts of a move or a cancel are shown in plain words (`runMoveText`, `runCancelText`).
 *
 * Times: a group's meetings are local times in the group's own zone (`RunAdminDTO.timezone`, copied at creation,
 * § 4.3), shown with that zone; a new group gets the site's zone (`GET /settings` → `scheduling.timezone`). Every
 * route works with the switch off; group writes need the site's time zone (409 `timezoneNotSet` otherwise).
 *
 * Every answer belongs to the selection it was requested for (`useSelectionData`, review-0 R1 of `sched-1e2`), and
 * every other asynchronous completion, dialog, form and message lives one selection lifetime (`useSelectionLifetime`,
 * and "a dialog's completion closes only that dialog"; review R1 of `sched-1f2`). Notices after a write describe
 * the answer the server returned and claim no mail delivery the answer does not report (review-0 R2, R3). The pure
 * functions, the DTO types and `GroupDialog` are exported for SchedulingCourses.test.ts and for SchedulingRoster.tsx
 * (the group page offers the same edit / move / cancel).
 */

// ---------------------------------------------------------------------------------------------------------------
// DTOs of § 10.3 as the backend sends them (backend/src/scheduling/admin/group-common.ts, group-courses-*.ts)
// ---------------------------------------------------------------------------------------------------------------

export type CourseDTO = { id: string; name: string; defaultCapacity: number; languages: string[] };
export type RunAdminDTO = {
    id: string; courseId: string; meetings: Meeting[]; timezone: TimeZone; capacity: number; taken: number;
    overCapacityBy: number; trainerIds: string[]; language: string | null; groupLink?: string; status: RunStatus;
    firstStart: string; lastEnd: string;
};
/** § 10.3 `RosterRow`. `source` is the shared `BookingSource` kind, so a new source breaks every switch over it. */
export type RosterRow = {
    bookingId: string; ref: string; name: string; email: string; phone?: string; language?: string;
    state: "held" | "confirmed"; expiresAt?: string; source: BookingSource["kind"]; channel?: string;
};
/** The answers of a run move and a run cancel (group-runs-move.ts, group-runs-cancel.ts). */
export type RunMoveAnswer = { run: RunAdminDTO; mailed: number; notSentPlacementChanged: number };
export type RunCancelAnswer = { unplaced: number; cancelled: number; notSentPlacementChanged: number; tokenCleanupFailed: number };

// ---------------------------------------------------------------------------------------------------------------
// Courses (pure)
// ---------------------------------------------------------------------------------------------------------------

/** § 4.5 / § 10.3: the server's text for a capacity above 45 (group-common.ts `CAPACITY_TEXT`). */
export const CAPACITY_TEXT = "A group in this version holds at most 45 people.";

export type CourseForm = { name: string; defaultCapacity: string; languages: string };

/** "ro, en" → ["ro", "en"]: comma- or space-separated tags, empty parts dropped. */
export function languageTags(text: string): string[] {
    return text.split(/[\s,]+/).map((t) => t.trim()).filter((t) => t !== "");
}

/** A capacity field: an integer 1-45; above 45 the server's text. */
function capacityOf(text: string, field: string): { ok: true; value: number } | { ok: false; error: string } {
    const n = text.trim() === "" ? Number.NaN : Number(text.trim());
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: `${field}: Enter a whole number from 1 to 45.` };
    if (n > 45) return { ok: false, error: `${field}: ${CAPACITY_TEXT}` };
    return { ok: true, value: n };
}

/** The POST/PUT body of a course (§ 10.3 "same"), checked with the shared `CourseSchema`; each tag once. */
export function coursePayload(form: CourseForm)
    : { ok: true; body: { name: string; defaultCapacity: number; languages: string[] } } | { ok: false; error: string } {
    const capacity = capacityOf(form.defaultCapacity, "defaultCapacity");
    if (!capacity.ok) return capacity;
    const languages = languageTags(form.languages);
    if (new Set(languages).size !== languages.length) return { ok: false, error: "languages: Each language once." };
    const parsed = CourseSchema.omit({ id: true }).safeParse({ name: form.name.trim(), defaultCapacity: capacity.value, languages });
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { ok: false, error: `${issue.path.map(String).join(".")}: ${issue.message}` };
    }
    return { ok: true, body: parsed.data };
}

// ---------------------------------------------------------------------------------------------------------------
// Meetings (pure; row F1)
// ---------------------------------------------------------------------------------------------------------------

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MAX_MEETINGS = 60; // § 4.5

export type MeetingRow = { date: string; start: string; end: string };

/** One meeting as text: "Sat 2026-12-05 10:00–13:00" (local time of the group's zone). */
export function meetingText(m: Meeting): string {
    return `${DAY_NAMES[weekdayOf(m.date) - 1]} ${m.date} ${m.start}–${m.end}`;
}

/**
 * "Add several days quickly": the rows for `days` consecutive dates from `from`, or for the picked `dates` (each once,
 * in date order), all with the one time range `start`–`end`. The admin edits each row afterwards.
 */
export function quickMeetings(input: { kind: "days"; from: string; count: string } | { kind: "dates"; dates: string[] }, start: string, end: string)
    : { ok: true; rows: MeetingRow[] } | { ok: false; error: string } {
    if (!LocalTimeSchema.safeParse(start).success || !LocalTimeSchema.safeParse(end).success) {
        return { ok: false, error: "Enter the start and end time as HH:MM." };
    }
    if (end <= start) return { ok: false, error: "The end time must be after the start time." };
    let dates: LocalDate[];
    switch (input.kind) {
        case "days": {
            const count = Number(input.count.trim());
            if (!isLocalDateText(input.from)) return { ok: false, error: "Enter the first date as YYYY-MM-DD." };
            if (!Number.isInteger(count) || count < 1 || count > MAX_MEETINGS) {
                return { ok: false, error: `Enter a number of days from 1 to ${MAX_MEETINGS}.` };
            }
            dates = Array.from({ length: count }, (_, i) => addDays(input.from, i));
            break;
        }
        case "dates":
            if (input.dates.length === 0) return { ok: false, error: "Pick at least one date." };
            if (input.dates.some((d) => !isLocalDateText(d))) return { ok: false, error: "Enter each date as YYYY-MM-DD." };
            dates = [...new Set(input.dates)].sort();
            break;
        default: {
            const never: never = input;
            throw new Error(`Unhandled quick input ${JSON.stringify(never)}`);
        }
    }
    return { ok: true, rows: dates.map((date) => ({ date, start, end })) };
}

/** A `MeetingError` (kernel or server) as text; `index` is the position in the rows sent, shown from 1. */
export function meetingErrorText(e: MeetingError): string {
    switch (e.kind) {
        case "empty": return "A group needs at least one meeting.";
        case "endNotAfterStart": return `Meeting ${e.index + 1} ends before it starts.`;
        case "overlap": return `Meetings ${e.a + 1} and ${e.b + 1} overlap.`;
        case "nonexistentLocalTime": return `Meeting ${e.index + 1}: that time does not exist on that day (the clock moves forward).`;
        case "tooMany": return `A group has at most ${e.max} meetings.`;
        default: {
            const never: never = e;
            throw new Error(`Unhandled meeting error ${JSON.stringify(never)}`);
        }
    }
}

/**
 * The `meetings` of a run create or move, in the order of the rows (so a server index names the same row): the date
 * and time formats of each row (the shared schemas), then the kernel's `validateMeetings` in the group's zone (order,
 * end after start, overlap, count, clock-change gap: the server runs the same check, § 5.4; this one names the row
 * before anything is sent).
 */
export function meetingsBody(rows: MeetingRow[], tz: TimeZone): { ok: true; meetings: Meeting[] } | { ok: false; error: string } {
    const meetings: Meeting[] = [];
    for (const [i, row] of rows.entries()) {
        const m = { date: row.date.trim(), start: row.start.trim(), end: row.end.trim() };
        if (!isLocalDateText(m.date) || !LocalTimeSchema.safeParse(m.start).success || !LocalTimeSchema.safeParse(m.end).success) {
            return { ok: false, error: `Meeting ${i + 1}: enter the date as YYYY-MM-DD and the times as HH:MM.` };
        }
        meetings.push(m);
    }
    const checked = validateMeetings(meetings, tz);
    if (!checked.ok) return { ok: false, error: meetingErrorText(checked.error) };
    return { ok: true, meetings };
}

// ---------------------------------------------------------------------------------------------------------------
// Groups (pure; rows F1, F4-F6, F8)
// ---------------------------------------------------------------------------------------------------------------

export type RunForm = {
    rows: MeetingRow[]; capacity: string; trainerIds: string[]; language: string /* "" = not set */; groupLink: string;
    status: "open" | "closed";
};

function groupLinkOf(text: string): { ok: true; value: string } | { ok: false; error: string } {
    const parsed = RunSchema.shape.groupLink.unwrap().safeParse(text.trim());
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: `groupLink: ${parsed.error.issues[0].message}` };
}

function trainersOf(ids: string[]): { ok: true; value: string[] } | { ok: false; error: string } {
    if (ids.length === 0) return { ok: false, error: "trainerIds: Choose at least one trainer." };
    if (ids.length > 10) return { ok: false, error: "trainerIds: At most 10 trainers." };
    return { ok: true, value: ids };
}

export type RunCreateBody = { meetings: Meeting[]; capacity: number; trainerIds: string[]; language?: string; groupLink?: string };

/** `POST …/courses/{c}/runs`: the body (§ 10.3), or the first problem. `tz` = the site's zone (the run's, § 4.3). */
export function runCreateBody(form: RunForm, tz: TimeZone): { ok: true; body: RunCreateBody } | { ok: false; error: string } {
    const meetings = meetingsBody(form.rows, tz);
    if (!meetings.ok) return meetings;
    const capacity = capacityOf(form.capacity, "capacity");
    if (!capacity.ok) return capacity;
    const trainers = trainersOf(form.trainerIds);
    if (!trainers.ok) return trainers;
    let groupLink: string | undefined;
    if (form.groupLink.trim() !== "") {
        const link = groupLinkOf(form.groupLink);
        if (!link.ok) return link;
        groupLink = link.value;
    }
    return {
        ok: true,
        body: {
            meetings: meetings.meetings, capacity: capacity.value, trainerIds: trainers.value,
            ...(form.language !== "" ? { language: form.language } : {}), ...(groupLink !== undefined ? { groupLink } : {}),
        },
    };
}

export type RunUpdateBody = {
    capacity?: number; trainerIds?: string[]; language?: string | null; groupLink?: string | null; status?: "open" | "closed";
};

/**
 * `PUT …/runs/{r}`: ONLY the fields the admin changed (§ 10.3). So a run whose stored language is no longer in the
 * course's list (ruling S1F1-LANGUAGE-CONSIST: valid stored data) is saved without sending that language again, which
 * the server would refuse. `language: null` = not set; `groupLink: null` = remove the link (D10). Nothing changed →
 * an error, no request (the route refuses an empty body).
 */
export function runUpdateBody(form: RunForm, run: RunAdminDTO): { ok: true; body: RunUpdateBody } | { ok: false; error: string } {
    const body: RunUpdateBody = {};
    const capacity = capacityOf(form.capacity, "capacity");
    if (!capacity.ok) return capacity;
    if (capacity.value !== run.capacity) body.capacity = capacity.value;
    const sameTrainers = form.trainerIds.length === run.trainerIds.length && form.trainerIds.every((id) => run.trainerIds.includes(id));
    if (!sameTrainers) {
        const trainers = trainersOf(form.trainerIds);
        if (!trainers.ok) return trainers;
        body.trainerIds = trainers.value;
    }
    const language = form.language === "" ? null : form.language;
    if (language !== run.language) body.language = language;
    const linkText = form.groupLink.trim();
    if (linkText !== (run.groupLink ?? "")) {
        if (linkText === "") body.groupLink = null;
        else {
            const link = groupLinkOf(linkText);
            if (!link.ok) return link;
            body.groupLink = link.value;
        }
    }
    if (run.status !== "cancelled" && form.status !== run.status) body.status = form.status;
    if (Object.keys(body).length === 0) return { ok: false, error: "Nothing changed." };
    return { ok: true, body };
}

/** The form of an existing run (edit) or of a new run of `course` (create). */
export function runFormOf(run: RunAdminDTO | null, course: CourseDTO): RunForm {
    if (run === null) return { rows: [], capacity: String(course.defaultCapacity), trainerIds: [], language: "", groupLink: "", status: "open" };
    return {
        rows: run.meetings.map((m) => ({ ...m })), capacity: String(run.capacity), trainerIds: [...run.trainerIds],
        language: run.language ?? "", groupLink: run.groupLink ?? "", status: run.status === "closed" ? "closed" : "open",
    };
}

/**
 * The words of a group's state at `now`: its status, and the derived "full", "over capacity" (§ 13, row F6),
 * "started" and "ended" (F11 of § 3: "past" is derived, not stored).
 */
export function runStateText(run: RunAdminDTO, now: number): string {
    const parts: string[] = [];
    switch (run.status) {
        case "open": parts.push("Open"); break;
        case "closed": parts.push("Closed to new bookings on the site"); break;
        case "cancelled": parts.push("Cancelled"); break;
        default: {
            const never: never = run.status;
            throw new Error(`Unhandled status ${JSON.stringify(never)}`);
        }
    }
    if (run.status !== "cancelled") {
        if (run.overCapacityBy > 0) parts.push(`over capacity by ${run.overCapacityBy}`);
        else if (run.taken >= run.capacity) parts.push("full");
        if (Date.parse(run.lastEnd) <= now) parts.push("ended");
        else if (Date.parse(run.firstStart) <= now) parts.push("started");
    }
    return parts.join(", ");
}

/** A group's short label: its dates and language, e.g. "2026-12-05 – 2026-12-13 (3 meetings), ro". */
export function runLabel(run: RunAdminDTO): string {
    const first = run.meetings[0]?.date ?? "";
    const last = run.meetings[run.meetings.length - 1]?.date ?? "";
    const dates = first === last ? first : `${first} – ${last}`;
    return `${dates} (${run.meetings.length} meeting${run.meetings.length === 1 ? "" : "s"}), ${run.language ?? "language not set"}`;
}

/**
 * Row F4: the answer of a run move in plain words. Only what the answer reports (group-runs-move.ts): the move is
 * saved; `mailed` = "Moved" mails to customers that the mail service accepted (not delivered: the answer cannot know);
 * `notSentPlacementChanged` = people whose place changed at the same time, to whom this move sent no notice. The
 * number of people in the group is shown beside it; the answer does not say why a person got no mail (the mail is
 * off, or making the link or sending failed).
 */
export function runMoveText(a: RunMoveAnswer): string {
    const lines = [
        `The group was moved; the new meetings are saved. ${a.run.taken} ${a.run.taken === 1 ? "person is" : "people are"} in the group.`,
        `"Moved" mails accepted for sending: ${a.mailed}.`,
    ];
    if (a.notSentPlacementChanged > 0) {
        lines.push(`${a.notSentPlacementChanged} ${a.notSentPlacementChanged === 1 ? "person's place" : "people's places"} changed at the same time; this move sent them no notice.`);
    }
    return lines.join(" ");
}

/**
 * Row F5: the answer of a run cancel in plain words. Only what the answer reports (group-runs-cancel.ts): the counts
 * of the saved cancel; the "No group" and "Cancelled" notices are attempted but not counted (the answer has no mail
 * count); `notSentPlacementChanged` = people to whom this cancel sent no notice because their place changed at the
 * same time; `tokenCleanupFailed` = cancelled BOOKINGS whose old links could not all be deleted (one booking can have
 * several links).
 */
export function runCancelText(a: RunCancelAnswer): string {
    const lines = [
        `The group was cancelled. ${a.unplaced} ${a.unplaced === 1 ? "person is" : "people are"} now without a group.`,
        `${a.cancelled} unconfirmed ${a.cancelled === 1 ? "place was" : "places were"} cancelled.`,
        `The "No group" and "Cancelled" notices are sent when those mails are on; this answer does not count them.`,
    ];
    if (a.notSentPlacementChanged > 0) {
        lines.push(`${a.notSentPlacementChanged} ${a.notSentPlacementChanged === 1 ? "person's place" : "people's places"} changed at the same time; this cancel sent them no notice.`);
    }
    if (a.tokenCleanupFailed > 0) {
        lines.push(`For ${a.tokenCleanupFailed} cancelled ${a.tokenCleanupFailed === 1 ? "booking" : "bookings"} the old links could not all be deleted; the cancellation stands.`);
    }
    return lines.join(" ");
}

/** Row F5: what a cancel will do, from the group's roster (§ 5.4): confirmed → without a group; held → cancelled. */
export function cancelPreview(people: RosterRow[]): { unplace: number; cancel: number; text: string } {
    let unplace = 0;
    let cancel = 0;
    for (const p of people) {
        switch (p.state) {
            case "confirmed": unplace++; break;
            case "held": cancel++; break;
            default: {
                const never: never = p.state;
                throw new Error(`Unhandled roster state ${JSON.stringify(never)}`);
            }
        }
    }
    return {
        unplace, cancel,
        text: `${unplace} ${unplace === 1 ? 'person becomes "without a group" and stays' : 'people become "without a group" and stay'} in the course. `
            + `${cancel} unconfirmed ${cancel === 1 ? "place is" : "places are"} cancelled. A cancelled group cannot be opened again.`,
    };
}

/**
 * The text of a failed group call: the refusals with context are worded here (meeting positions, languages in use, a
 * full group, a course with dependents); every other refusal shows the server's reason (`plannerErrorText`).
 */
export function groupErrorText(e: unknown): string {
    if (e instanceof ApiError && e.body !== null && typeof e.body === "object") {
        const b = e.body as { code?: string; index?: number; a?: number; b?: number; max?: number; languages?: string[]; capacity?: number };
        switch (b.code) {
            case "empty": return meetingErrorText({ kind: "empty" });
            case "endNotAfterStart": return meetingErrorText({ kind: "endNotAfterStart", index: b.index ?? 0 });
            case "overlap": return meetingErrorText({ kind: "overlap", a: b.a ?? 0, b: b.b ?? 0 });
            case "nonexistentLocalTime": return meetingErrorText({ kind: "nonexistentLocalTime", index: b.index ?? 0 });
            case "tooMany": return meetingErrorText({ kind: "tooMany", max: 60 });
            case "languageInUse":
                return `A group of this course uses ${(b.languages ?? []).join(", ")}. Keep that language in the list, or change the group's language first.`;
            case "courseInUse":
                return "This course cannot be deleted: it has groups (cancelled groups count too) or people without a group.";
            case "runFull": return `The group is full (${b.capacity ?? "?"} places). Raise its capacity first, or choose another group.`;
            case "runCancelled": return "The group is cancelled. Choose another group.";
            case "notConfirmed": return "This place is not confirmed yet. It can be moved after the customer confirms it.";
            case "stale": return "The booking changed since it was read. Read it again and repeat.";
        }
    }
    return plannerErrorText(e);
}

/** DELETE answers 204 with no body; `apiRequest` throws a SyntaxError reading it only after `response.ok` (as Scheduling.tsx). */
async function deleteRequest(path: string): Promise<void> {
    try {
        await apiRequest(path, { method: "DELETE" });
    } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
    }
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------------------------------------------
// The meetings editor
// ---------------------------------------------------------------------------------------------------------------

function MeetingsEditor({ rows, setRows }: { rows: MeetingRow[]; setRows: (rows: MeetingRow[]) => void }) {
    const [mode, setMode] = useState<"days" | "dates">("days");
    const [from, setFrom] = useState("");
    const [count, setCount] = useState("3");
    const [picked, setPicked] = useState<string[]>([]);
    const [pick, setPick] = useState("");
    const [start, setStart] = useState("10:00");
    const [end, setEnd] = useState("13:00");
    const [error, setError] = useState<string | null>(null);

    function addQuick() {
        const built = quickMeetings(mode === "days" ? { kind: "days", from, count } : { kind: "dates", dates: picked }, start, end);
        if (!built.ok) { setError(built.error); return; }
        setError(null);
        setRows([...rows, ...built.rows]);
        setPicked([]);
    }
    const setRow = (i: number, key: keyof MeetingRow, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));

    return (
        <div className="space-y-3">
            <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Add several meetings</p>
                <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2"><input type="radio" name="quick-mode" checked={mode === "days"} onChange={() => setMode("days")} /> Days in a row</label>
                    <label className="flex items-center gap-2"><input type="radio" name="quick-mode" checked={mode === "dates"} onChange={() => setMode("dates")} /> Picked dates</label>
                </div>
                {mode === "days" ? (
                    <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1"><Label htmlFor="quick-from">First date</Label><Input id="quick-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                        <div className="space-y-1"><Label htmlFor="quick-count">Number of days</Label><Input id="quick-count" type="number" min={1} max={MAX_MEETINGS} className="w-24" value={count} onChange={(e) => setCount(e.target.value)} /></div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-end gap-2">
                            <div className="space-y-1"><Label htmlFor="quick-pick">Date</Label><Input id="quick-pick" type="date" value={pick} onChange={(e) => setPick(e.target.value)} /></div>
                            <Button variant="outline" size="sm" onClick={() => { if (pick !== "" && !picked.includes(pick)) setPicked([...picked, pick].sort()); }}>Pick this date</Button>
                        </div>
                        <p className="text-sm">{picked.length === 0 ? "No date picked." : picked.join(", ")}</p>
                    </div>
                )}
                <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1"><Label htmlFor="quick-start">Start</Label><Input id="quick-start" type="time" step="300" className="w-32" value={start} onChange={(e) => setStart(e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="quick-end">End</Label><Input id="quick-end" type="time" step="300" className="w-32" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
                    <Button variant="outline" size="sm" onClick={addQuick}><Plus className="mr-1 h-3 w-3" /> Add these meetings</Button>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            {rows.length === 0 && <p className="text-sm text-muted-foreground">No meetings yet.</p>}
            {rows.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-sm text-muted-foreground">{i + 1}.</span>
                    <Input aria-label={`Meeting ${i + 1} date`} type="date" className="w-40" value={row.date} onChange={(e) => setRow(i, "date", e.target.value)} />
                    <Input aria-label={`Meeting ${i + 1} start`} type="time" step="300" className="w-32" value={row.start} onChange={(e) => setRow(i, "start", e.target.value)} />
                    <span>–</span>
                    <Input aria-label={`Meeting ${i + 1} end`} type="time" step="300" className="w-32" value={row.end} onChange={(e) => setRow(i, "end", e.target.value)} />
                    <Button variant="outline" size="sm" aria-label={`Remove meeting ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
                </div>
            ))}
            {rows.length < MAX_MEETINGS && (
                <Button variant="outline" size="sm" onClick={() => setRows([...rows, { date: rows[rows.length - 1]?.date ?? "", start, end }])}>
                    <Plus className="mr-1 h-3 w-3" /> Add one meeting
                </Button>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// The group dialogs (used by this page and by SchedulingRoster.tsx)
// ---------------------------------------------------------------------------------------------------------------

export type GroupDialogMode =
    | { kind: "create"; course: CourseDTO; tz: TimeZone; resources: ResourceDTO[] }
    | { kind: "edit"; course: CourseDTO; run: RunAdminDTO; resources: ResourceDTO[] }
    | { kind: "move"; course: CourseDTO; run: RunAdminDTO }
    | { kind: "cancel"; course: CourseDTO; run: RunAdminDTO };

/**
 * One dialog per group write. `onDone(notice)` gets the plain-words result to show; the page then reads again.
 * Abstraction line: `GroupDialog` — users: SchedulingCourses (group list), SchedulingRoster (group page); axis: none
 * (one set of group writes); rejected: a copy of the four forms in each page.
 */
export function GroupDialog({ mode, onClose, onDone }: { mode: GroupDialogMode; onClose: () => void; onDone: (notice: string) => void }) {
    switch (mode.kind) {
        case "create":
        case "edit":
            return <RunFormDialog mode={mode} onClose={onClose} onDone={onDone} />;
        case "move":
            return <MoveRunDialog course={mode.course} run={mode.run} onClose={onClose} onDone={onDone} />;
        case "cancel":
            return <CancelRunDialog course={mode.course} run={mode.run} onClose={onClose} onDone={onDone} />;
        default: {
            const never: never = mode;
            throw new Error(`Unhandled group dialog ${JSON.stringify(never)}`);
        }
    }
}

function ErrorLine({ text }: { text: string | null }) {
    return text ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{text}</div> : null;
}

function RunFormDialog({ mode, onClose, onDone }: {
    mode: Extract<GroupDialogMode, { kind: "create" | "edit" }>; onClose: () => void; onDone: (notice: string) => void;
}) {
    const run = mode.kind === "edit" ? mode.run : null;
    const [form, setForm] = useState<RunForm>(runFormOf(run, mode.course));
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // S1F1-LANGUAGE-CONSIST: a stored language that left the course's list is still offered (and shown) as it is.
    const languages = run?.language && !mode.course.languages.includes(run.language) ? [...mode.course.languages, run.language] : mode.course.languages;

    async function save() {
        let request: { method: "POST" | "PUT"; path: string; body: unknown; notice: string };
        if (mode.kind === "create") {
            const built = runCreateBody(form, mode.tz);
            if (!built.ok) { setError(built.error); return; }
            request = { method: "POST", path: `/scheduling/admin/courses/${enc(mode.course.id)}/runs`, body: built.body, notice: "Group created." };
        } else {
            const built = runUpdateBody(form, mode.run);
            if (!built.ok) { setError(built.error); return; }
            request = { method: "PUT", path: `/scheduling/admin/courses/${enc(mode.course.id)}/runs/${enc(mode.run.id)}`, body: built.body, notice: "Group saved." };
        }
        setBusy(true);
        setError(null);
        try {
            await apiRequest(request.path, { method: request.method, body: JSON.stringify(request.body) });
            onDone(request.notice);
        } catch (e) {
            setError(groupErrorText(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{mode.kind === "create" ? `New group of ${mode.course.name}` : `Edit the group ${runLabel(mode.run)}`}</DialogTitle>
                    <DialogDescription>
                        {mode.kind === "create"
                            ? `Meeting times are in ${mode.tz}, the site's time zone; the group keeps this zone.`
                            : `To change the dates, use "Move" (a "Moved" notice is attempted for each person). Times are in ${mode.run.timezone}.`}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <ErrorLine text={error} />
                    {mode.kind === "create" && <MeetingsEditor rows={form.rows} setRows={(rows) => setForm({ ...form, rows })} />}
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                            <Label htmlFor="run-capacity">Capacity (1-45)</Label>
                            <Input id="run-capacity" type="number" min={1} max={45} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
                            {run !== null && <p className="text-xs text-muted-foreground">{run.taken} taken. A lower capacity removes nobody; new places wait until there is room.</p>}
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="run-language">Language</Label>
                            <select id="run-language" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                                <option value="">Not set (the first site booking with a language preference sets it; your placements do not)</option>
                                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm font-medium">Trainers (1-10)</p>
                        {mode.resources.length === 0 && <p className="text-sm text-muted-foreground">No resources yet. Add one under <Link className="underline" to="/scheduling">Scheduling</Link>.</p>}
                        <div className="flex flex-wrap gap-3 text-sm">
                            {mode.resources.map((r) => (
                                <label key={r.id} className="flex items-center gap-1">
                                    <input type="checkbox" checked={form.trainerIds.includes(r.id)} onChange={(e) => setForm({
                                        ...form, trainerIds: e.target.checked ? [...form.trainerIds, r.id] : form.trainerIds.filter((x) => x !== r.id),
                                    })} /> {r.name}
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="run-link">Group link (optional, https:, for example a WhatsApp group)</Label>
                        <Input id="run-link" value={form.groupLink} placeholder="https://chat.whatsapp.com/…" onChange={(e) => setForm({ ...form, groupLink: e.target.value })} />
                        <p className="text-xs text-muted-foreground">Included only in the "Confirmed" mail of a place in this group.</p>
                    </div>
                    {mode.kind === "edit" && (
                        <div className="flex flex-wrap gap-4 text-sm">
                            <label className="flex items-center gap-2"><input type="radio" name="run-status" checked={form.status === "open"} onChange={() => setForm({ ...form, status: "open" })} /> Open</label>
                            <label className="flex items-center gap-2"><input type="radio" name="run-status" checked={form.status === "closed"} onChange={() => setForm({ ...form, status: "closed" })} /> Closed to new bookings on the site (you can still add people)</label>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Close</Button>
                    <Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {mode.kind === "create" ? "Create group" : "Save group"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function MoveRunDialog({ course, run, onClose, onDone }: { course: CourseDTO; run: RunAdminDTO; onClose: () => void; onDone: (notice: string) => void }) {
    const [rows, setRows] = useState<MeetingRow[]>(run.meetings.map((m) => ({ ...m })));
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function move() {
        const built = meetingsBody(rows, run.timezone);
        if (!built.ok) { setError(built.error); return; }
        setBusy(true);
        setError(null);
        try {
            const answer = await apiRequest(`/scheduling/admin/courses/${enc(course.id)}/runs/${enc(run.id)}/move`, {
                method: "POST", body: JSON.stringify({ meetings: built.meetings }),
            }) as RunMoveAnswer;
            onDone(runMoveText(answer));
        } catch (e) {
            setError(groupErrorText(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Move the group {runLabel(run)}</DialogTitle>
                    <DialogDescription>
                        The new meetings replace the old ones. Everyone in the group stays in it ({run.taken} now). For each
                        person a new link is made and the "Moved" mail is attempted; the answer counts the mails accepted for
                        sending. Times are in {run.timezone}.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <ErrorLine text={error} />
                    <MeetingsEditor rows={rows} setRows={setRows} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Close</Button>
                    <Button onClick={move} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Move the group</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CancelRunDialog({ course, run, onClose, onDone }: { course: CourseDTO; run: RunAdminDTO; onClose: () => void; onDone: (notice: string) => void }) {
    // The confirmation counts the people from the group's roster, read for this group only.
    const roster = useSelectionData<{ people: RosterRow[] }>(selectionKey([course.id, run.id]), () =>
        apiRequest(`/scheduling/admin/courses/${enc(course.id)}/runs/${enc(run.id)}/roster`));
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const preview = roster.data !== null ? cancelPreview(roster.data.people) : null;

    async function cancel() {
        setBusy(true);
        setError(null);
        try {
            const answer = await apiRequest(`/scheduling/admin/courses/${enc(course.id)}/runs/${enc(run.id)}/cancel`, { method: "POST", body: "{}" }) as RunCancelAnswer;
            onDone(runCancelText(answer));
        } catch (e) {
            setError(groupErrorText(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Cancel the group {runLabel(run)}?</DialogTitle>
                    <DialogDescription>{preview ? preview.text : "Counting the people in the group…"}</DialogDescription>
                </DialogHeader>
                <ErrorLine text={error ?? roster.error} />
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Keep the group</Button>
                    <Button onClick={cancel} disabled={busy || preview === null}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cancel the group</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Ownership of asynchronous completions (review-0 R1 of sched-1f2)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Review R1 (iterations 0 and 1) — one rule for every asynchronous effect of the group screens that
 * `useSelectionData` does not carry (writes, reads that open a dialog, further list pages) and for every piece of
 * state an action leaves (an open dialog, an open form, a message): it belongs to ONE selection lifetime. A lifetime
 * of `key` starts when the hook first sees that key and ENDS — for good — when the key changes or the page unmounts;
 * coming back to the same key value (A → B → A) starts a NEW lifetime, so nothing of the old one becomes current again.
 * - `lifetime()`: a check that is true while the lifetime it was taken in lasts. A dialog, form or message stores it
 *   and is shown (and its completion applies) only while it holds.
 * - `start()`: the same, and also only while no later `start()` (or `invalidate()`) happened on this hook: the latest
 *   action of the surface wins (two "Move" reads, two "Show more" pages).
 * - `invalidate()`: ends every pending `start()` of the surface now (a refreshed list drops a pending further page).
 * The caller tests the check before EVERY effect of a completion — success, error and notice alike. The companion rule
 * for dialogs: a dialog's completion closes only THAT dialog — `setDialog(prev => prev === mine ? null : prev)`.
 * The epoch is advanced during render when the key changes, so a stale dialog or message is already hidden in the
 * render that shows the new selection.
 *
 * Abstraction line: `useSelectionLifetime` — users: SchedulingCourses (course writes, the course form, group dialogs,
 * messages), SchedulingRoster (move reads, "Show more", dialogs, messages), SchedulingAppointmentsBooking (the group
 * move); axis: none (one rule); rejected: guards compared on the key VALUE (review-1: an old action became current
 * again after A → B → A) and a hand-written guard per call (review-0: the defect in five places).
 */
export function useSelectionLifetime(key: string | null): {
    lifetime: () => () => boolean; start: () => () => boolean; invalidate: () => void;
} {
    const state = useRef({ key, epoch: 0, latest: 0 });
    if (state.current.key !== key) {
        state.current.key = key;
        state.current.epoch++;
    }
    useEffect(() => {
        const s = state.current;
        return () => { s.epoch++; }; // unmount ends the lifetime
    }, []);
    return useMemo(() => ({
        lifetime: () => {
            const e = state.current.epoch;
            return () => e === state.current.epoch;
        },
        start: () => {
            const e = state.current.epoch;
            const n = ++state.current.latest;
            return () => e === state.current.epoch && n === state.current.latest;
        },
        invalidate: () => { state.current.latest++; },
    }), []);
}

// ---------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------

type Setup = { courses: CourseDTO[]; resources: ResourceDTO[]; tz: TimeZone | null; enabled: boolean };

/** The site's courses, resources and scheduling switch and zone (one selection: the tenant). Also used by SchedulingRoster. */
export async function loadGroupSetup(): Promise<Setup> {
    const [courses, resources, settings] = await Promise.all([
        apiRequest("/scheduling/admin/courses"), apiRequest("/scheduling/admin/resources"), apiRequest("/settings"),
    ]);
    return {
        courses: courses.courses, resources: resources.resources,
        tz: typeof settings.scheduling?.timezone === "string" ? settings.scheduling.timezone : null,
        enabled: settings.schedulingEnabled === true,
    };
}

/** The scheduling-off and no-time-zone lines of the group pages. */
export function GroupSetupNotes({ tz, enabled }: { tz: TimeZone | null; enabled: boolean }) {
    return (
        <>
            {!enabled && <p className="rounded-md border p-3 text-sm">Scheduling is off for this site: visitors cannot book yet. You can prepare courses and groups now.</p>}
            {tz === null && (
                <p className="rounded-md border p-3 text-sm">
                    Set the site's time zone first: <Link className="underline" to="/scheduling">Scheduling settings</Link>. Groups, moves and manual entries need it.
                </p>
            )}
        </>
    );
}

const EMPTY_COURSE: CourseForm = { name: "", defaultCapacity: "12", languages: "" };

export default function SchedulingCourses() {
    const { currentTenant } = useTenant();
    const [searchParams, setSearchParams] = useSearchParams();
    const tenantKey = currentTenant ? selectionKey([currentTenant.id]) : null;
    const setup = useSelectionData<Setup>(tenantKey, loadGroupSetup);
    const s = setup.data;
    const wanted = searchParams.get("course");
    const course = s === null ? null : s.courses.find((c) => c.id === wanted) ?? s.courses[0] ?? null;
    const runsKey = currentTenant && course ? selectionKey([currentTenant.id, course.id]) : null;
    const runs = useSelectionData<RunAdminDTO[]>(runsKey, async () => {
        const answer = await apiRequest(`/scheduling/admin/courses/${enc(course?.id ?? "")}/runs`);
        return [...(answer.runs as RunAdminDTO[])].sort((a, b) => a.firstStart.localeCompare(b.firstStart) || a.id.localeCompare(b.id));
    });

    // `formId` names one opened course form; typing keeps it, opening another form gives a new one.
    // Lifetimes (useSelectionLifetime): the site (the course form), the chosen course (course writes), and the shown
    // groups (group dialogs and their notices).
    const siteLife = useSelectionLifetime(tenantKey);
    const courseWrites = useSelectionLifetime(selectionKey([currentTenant?.id ?? "", wanted ?? ""]));
    const groupsLife = useSelectionLifetime(runsKey);
    // `formId` names one opened course form; typing keeps it, opening another form gives a new one.
    const [editing, setEditing] = useState<{ alive: () => boolean; formId: number; id: string | null; form: CourseForm } | null>(null);
    const formIds = useRef(0);
    const openForm = (id: string | null, form: CourseForm) => setEditing({ alive: siteLife.lifetime(), formId: ++formIds.current, id, form });
    const [dialog, setDialog] = useState<{ alive: () => boolean; mode: GroupDialogMode } | null>(null);
    const openDialog = (mode: GroupDialogMode) => setDialog({ alive: groupsLife.lifetime(), mode });
    const [message, setMessage] = useState<{ alive: () => boolean; error: string | null; notice: string | null } | null>(null);
    const shownMessage = message !== null && message.alive() ? message : null;
    const error = setup.error ?? runs.error ?? shownMessage?.error ?? null;

    /** A course write: every effect of its completion, and its message, apply only while it is current (`start()`). */
    async function act(action: (isCurrent: () => boolean) => Promise<string | null>) {
        const isCurrent = courseWrites.start();
        setMessage(null);
        try {
            const notice = await action(isCurrent);
            if (isCurrent()) setMessage({ alive: courseWrites.lifetime(), error: null, notice });
        } catch (e) {
            if (isCurrent()) setMessage({ alive: courseWrites.lifetime(), error: groupErrorText(e), notice: null });
        }
    }

    const saveCourse = () => {
        if (editing === null) return;
        const target = editing;
        return act(async (isCurrent) => {
            const built = coursePayload(target.form);
            if (!built.ok) throw new Error(built.error);
            if (target.id === null) {
                const created = await apiRequest("/scheduling/admin/courses", { method: "POST", body: JSON.stringify(built.body) }) as CourseDTO;
                if (isCurrent()) setSearchParams({ course: created.id });
            } else {
                await apiRequest(`/scheduling/admin/courses/${enc(target.id)}`, { method: "PUT", body: JSON.stringify(built.body) });
            }
            // The saved form closes; a form opened after it stays open; nothing changes once the write is not current.
            if (isCurrent()) setEditing((prev) => (prev !== null && prev.formId === target.formId ? null : prev));
            await setup.reload();
            return null;
        });
    };
    // After a delete the list is read again; a selection that names the deleted course falls back to the first course.
    const removeCourse = (c: CourseDTO) => {
        if (!confirm(`Delete the course "${c.name}"? A course with groups (also cancelled ones) or people without a group cannot be deleted.`)) return;
        return act(async () => {
            await deleteRequest(`/scheduling/admin/courses/${enc(c.id)}`);
            await setup.reload();
            return `The course "${c.name}" was deleted.`;
        });
    };

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    const errorBox = error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>;
    const header = (
        <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><GraduationCap className="h-7 w-7" /> Courses and groups</h1>
            <p className="text-muted-foreground">A course has groups; a group has its meetings, its places and its people.</p>
        </div>
    );
    if (s === null || tenantKey === null) return <div className="p-8 space-y-6">{header}{errorBox || <Loader2 className="animate-spin" />}</div>;
    const now = Date.now();
    const trainerName = (id: string) => s.resources.find((r) => r.id === id)?.name ?? "(removed resource)";

    return (
        <div className="p-8 space-y-6 max-w-5xl">
            {header}
            <GroupSetupNotes tz={s.tz} enabled={s.enabled} />
            {errorBox}
            {shownMessage?.notice && <div className="rounded-md border p-3 text-sm">{shownMessage.notice}</div>}

            <Card>
                <CardHeader>
                    <CardTitle>Courses</CardTitle>
                    <CardDescription>The default capacity is the capacity of a new group. Languages: the tags offered, for example "ro, en"; none = the booking form does not ask.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {s.courses.length === 0 && <p className="text-sm text-muted-foreground">No courses yet.</p>}
                    {s.courses.map((c) => (
                        <div key={c.id} className="flex flex-wrap items-center gap-3 text-sm">
                            <button className={`font-medium underline-offset-2 hover:underline ${course?.id === c.id ? "underline" : ""}`} onClick={() => setSearchParams({ course: c.id })}>{c.name}</button>
                            <span>{c.defaultCapacity} places</span>
                            <span className="text-muted-foreground">{c.languages.length === 0 ? "no language asked" : c.languages.join(", ")}</span>
                            <Button variant="outline" size="sm" onClick={() => openForm(c.id, {
                                name: c.name, defaultCapacity: String(c.defaultCapacity), languages: c.languages.join(", "),
                            })}>Edit</Button>
                            <Button variant="outline" size="sm" aria-label={`Delete ${c.name}`} onClick={() => removeCourse(c)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                    ))}
                    {editing !== null && editing.alive() ? (
                        <div className="space-y-3 rounded-md border p-3">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                <div className="space-y-1"><Label htmlFor="course-name">Name</Label>
                                    <Input id="course-name" value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} /></div>
                                <div className="space-y-1"><Label htmlFor="course-capacity">Default capacity (1-45)</Label>
                                    <Input id="course-capacity" type="number" min={1} max={45} value={editing.form.defaultCapacity} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, defaultCapacity: e.target.value } })} /></div>
                                <div className="space-y-1"><Label htmlFor="course-languages">Languages</Label>
                                    <Input id="course-languages" value={editing.form.languages} placeholder="ro, en" onChange={(e) => setEditing({ ...editing, form: { ...editing.form, languages: e.target.value } })} /></div>
                            </div>
                            <div className="flex gap-2">
                                <Button size="sm" onClick={saveCourse}><Save className="mr-1 h-3 w-3" /> {editing.id === null ? "Add course" : "Save course"}</Button>
                                <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                            </div>
                        </div>
                    ) : (
                        <Button size="sm" onClick={() => openForm(null, EMPTY_COURSE)}><Plus className="mr-1 h-4 w-4" /> New course</Button>
                    )}
                </CardContent>
            </Card>

            {course !== null && runsKey !== null && (
                <Card>
                    <CardHeader>
                        <CardTitle>Groups of {course.name}</CardTitle>
                        <CardDescription>
                            <Link className="underline" to={`/scheduling/courses/${enc(course.id)}/roster`}>People without a group</Link>
                            {" · "}Times are in each group's own time zone.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {runs.data === null ? <Loader2 className="animate-spin" /> : runs.data.length === 0 && <p className="text-sm text-muted-foreground">No groups yet.</p>}
                        {runs.data?.map((r) => (
                            <div key={r.id} className="space-y-1 rounded-md border p-3 text-sm">
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="font-medium">{runLabel(r)}</span>
                                    <span>{r.taken} / {r.capacity} places</span>
                                    <span className="text-muted-foreground">{runStateText(r, now)}</span>
                                </div>
                                <ul className="pl-1 text-muted-foreground">
                                    {r.meetings.map((m, i) => <li key={i}>{meetingText(m)} ({r.timezone})</li>)}
                                </ul>
                                <p>Trainers: {r.trainerIds.map(trainerName).join(", ")}</p>
                                <p>Group link: {r.groupLink ? <a className="underline" href={r.groupLink} target="_blank" rel="noreferrer">{r.groupLink}</a> : "none"}</p>
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <Button asChild variant="outline" size="sm"><Link to={`/scheduling/courses/${enc(course.id)}/roster?group=${enc(r.id)}`}>People</Link></Button>
                                    {r.status !== "cancelled" && (
                                        <>
                                            <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "edit", course, run: r, resources: s.resources })}>Edit</Button>
                                            <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "move", course, run: r })}>Move</Button>
                                            <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "cancel", course, run: r })}>Cancel group</Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                        {s.tz !== null && (
                            <Button size="sm" onClick={() => openDialog({ kind: "create", course, tz: s.tz as TimeZone, resources: s.resources })}>
                                <Plus className="mr-1 h-4 w-4" /> New group
                            </Button>
                        )}
                    </CardContent>
                </Card>
            )}

            {dialog !== null && dialog.alive() && (
                <GroupDialog mode={dialog.mode} onClose={() => setDialog(null)} onDone={(notice) => {
                    const mine = dialog;
                    setDialog((prev) => (prev === mine ? null : prev)); // closes only this dialog
                    if (mine.alive()) setMessage({ alive: mine.alive, error: null, notice });
                    void runs.reload(); // a read of the CURRENT selection (useSelectionData), never of the old one
                }} />
            )}
        </div>
    );
}
