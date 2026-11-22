import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Download, Loader2, UserPlus, Users } from "lucide-react";
import { PersonSchema, instantToLocal, type Person, type TimeZone } from "@amodx/shared";
import { formatWhen, selectionKey, useSelectionData, type BookingAdminDTO } from "./SchedulingPlanner";
import {
    GroupDialog, GroupSetupNotes, groupErrorText, loadGroupSetup, meetingText, runLabel, runStateText, useSelectionLifetime,
    type CourseDTO, type GroupDialogMode, type RosterRow, type RunAdminDTO,
} from "./SchedulingCourses";

/*
 * SCHED-1F2 (docs/slices/sched-1.md § 4.4, § 5.4, § 10.3 routes of `sched-1f`; rows F2, F3, F5, F7, F9 of § 17.3) —
 * the people of one course: the roster of the group chosen in `?group=` (`GET …/runs/{r}/roster`) and the people
 * without a group (`GET …/courses/{c}/unplaced`, 100 per page, "Show more" follows the cursor). English UI. PROTOTYPE.
 *
 * Per person: name, email, phone, language, state (held with its expiry, or confirmed), source and channel. Actions:
 * move a person to another group of the course or out to "without a group", and "place into a group" for a person
 * without one (`POST /scheduling/admin/bookings/{id}/move-seat` with the `rev` read just before, § 7.1); manual entry
 * with or without a group (`POST /scheduling/admin/seats`); the group's edit / move / cancel (`GroupDialog` of
 * SchedulingCourses.tsx, answers in plain words); the roster as a CSV file for Excel (row F9, built here from the
 * roster JSON: § 10.3 has no export route).
 *
 * Times: a group's times in the group's zone (`RunAdminDTO.timezone`); the expiry of a held place without a group in
 * the site's zone. Every answer belongs to the selection it was requested for (`useSelectionData`); every other
 * asynchronous completion (opening a move, "Show more", a dialog's write), every dialog and every message lives one
 * selection lifetime (`useSelectionLifetime`: it ends on a selection change or unmount and never comes back), and a
 * dialog's completion closes only that dialog (review R1). A further page of people without a group extends only the
 * first page it was read after; reading the list again ends every pending further page (success and error alike).
 * Notices after a write describe the booking the server RETURNED (`seatNotice`, review-0 R2) and claim no mail
 * delivery: the answers of these routes do not report it (review-0 R3).
 */

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------------------------------------------
// Words of a roster row (pure)
// ---------------------------------------------------------------------------------------------------------------

/** "Confirmed", or "Held until Mon 2026-12-07 10:30" in `tz` (row F2: a held place shows its expiry). */
export function rosterStateText(row: RosterRow, tz: TimeZone): string {
    switch (row.state) {
        case "confirmed": return "Confirmed";
        case "held": return row.expiresAt ? `Held until ${formatWhen(row.expiresAt, tz)}` : "Held";
        default: {
            const never: never = row.state;
            throw new Error(`Unhandled roster state ${JSON.stringify(never)}`);
        }
    }
}

/** Where the place came from (§ 4.4 `BookingSource`): the site, the admin by hand, or an order. */
export function rosterSourceText(row: RosterRow): string {
    switch (row.source) {
        case "visitor": return "Site";
        case "manual": return "By hand";
        case "order": return "Order";
        default: {
            const never: never = row.source;
            throw new Error(`Unhandled source ${JSON.stringify(never)}`);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// CSV export (pure; row F9)
// ---------------------------------------------------------------------------------------------------------------

/** The columns: the § 10.3 `RosterRow` fields a person reads (the booking id is internal; `ref` names the booking). */
export const ROSTER_CSV_COLUMNS = ["Reference", "Name", "Email", "Phone", "Language", "State", "Held until", "Source", "Channel"] as const;

/**
 * One CSV field. Formula guard first: a value that starts with `=`, `+`, `-`, `@`, tab or carriage return gets a
 * leading `'`, so a spreadsheet shows it as text and does not run it as a formula (a phone "+40…" is shown as
 * "'+40…"; that is the cost of the guard). Then RFC 4180: a field with `"`, `,`, CR or LF is put in double quotes,
 * with each `"` doubled.
 */
export function csvCell(value: string): string {
    const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * The roster as a CSV text for Excel: a UTF-8 byte order mark (so Excel reads Romanian letters), a header line, one
 * line per person, CRLF line ends (RFC 4180). "Held until" is local time in `tz` (the group's zone), "YYYY-MM-DD HH:MM".
 */
export function rosterCsv(people: RosterRow[], tz: TimeZone): string {
    const lines: string[][] = [[...ROSTER_CSV_COLUMNS]];
    for (const p of people) {
        let heldUntil = "";
        if (p.expiresAt !== undefined) {
            const l = instantToLocal(Date.parse(p.expiresAt), tz);
            heldUntil = `${l.date} ${l.time}`;
        }
        lines.push([p.ref, p.name, p.email, p.phone ?? "", p.language ?? "", p.state, heldUntil, rosterSourceText(p), p.channel ?? ""]);
    }
    return `﻿${lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/**
 * The file name: course name, the group's first meeting date, and the group's short id (two groups can start on the
 * same day): "Bijuterie-incepatori_2026-12-05_group-1a2b3c4d.csv". Characters that a file system refuses are removed;
 * letters with diacritics stay.
 */
export function rosterCsvFileName(courseName: string, run: RunAdminDTO): string {
    const course = courseName.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "course";
    return `${course}_${run.meetings[0]?.date ?? "no-date"}_group-${run.id.slice(0, 8)}.csv`;
}

function downloadText(fileName: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------------------------------------------
// Move a person (rows F3, F5) — also used by SchedulingAppointmentsBooking.tsx
// ---------------------------------------------------------------------------------------------------------------

/** The `runId` of `POST …/move-seat` from the dialog's choice: `"unplaced"` → `null`, `"run:<id>"` → the id. */
export function moveSeatTarget(choice: string): { ok: true; runId: string | null } | { ok: false; error: string } {
    if (choice === "unplaced") return { ok: true, runId: null };
    if (choice.startsWith("run:") && choice.length > 4) return { ok: true, runId: choice.slice(4) };
    return { ok: false, error: "Choose where to move this person." };
}

/**
 * The groups a person may be moved into by the admin (§ 5.4 admin rules): every group of the course that is not
 * cancelled (a cancelled group refuses, `runCancelled`) and is not the person's own. A closed or started group, and a
 * group of another language, are offered (row F3: the admin is not bound by them, and the group's language does not
 * change). A full group is offered too and the server answers `runFull`.
 */
export function moveTargets(runs: RunAdminDTO[], currentRunId: string | null): RunAdminDTO[] {
    return runs.filter((r) => r.status !== "cancelled" && r.id !== currentRunId);
}

/** A group place in words: a group of `runs` (by its label), or "without a group" for `null`. */
function groupPlaceText(runId: string | null, runs: RunAdminDTO[]): string {
    if (runId === null) return "without a group";
    const run = runs.find((r) => r.id === runId);
    return `in the group ${run ? runLabel(run) : runId}`;
}

/**
 * Review-0 R2 and R3 — the notice after a person move (`moved`, POST …/move-seat) or a manual entry (`added`, POST
 * /scheduling/admin/seats), built from the booking the server RETURNED, never from the request: the move route answers
 * with the booking as last saved, and a change saved at the same time can leave it elsewhere (group-move-seat.ts). The
 * route then sends no notice for this move (it sends one only while the booking still has the placement this move
 * wrote). No sentence says a mail was delivered: the answer does not report it (the mail can be off, or making the link
 * or sending can fail while the write stands).
 */
export function seatNotice(kind: "moved" | "added", saved: BookingAdminDTO, requestedRunId: string | null, runs: RunAdminDTO[]): string {
    const what = saved.what;
    let savedRunId: string | null;
    switch (what.kind) {
        case "seat": savedRunId = what.runId; break;
        case "unplaced": savedRunId = null; break;
        case "slot": return `${saved.ref} is an appointment, not a group place. Read the booking again.`;
        default: {
            const never: never = what;
            throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
        }
    }
    const asSaved = `${saved.ref} is now ${groupPlaceText(savedRunId, runs)}.`;
    switch (kind) {
        case "moved":
            if (savedRunId !== requestedRunId) {
                return `The move is saved, but another change was saved at the same time: you asked to place it ${groupPlaceText(requestedRunId, runs)}. ${asSaved} This move sent no notice.`;
            }
            return `The move is saved. ${asSaved} The "${requestedRunId === null ? "No group" : "Moved"}" mail is sent when that mail is on; this answer does not say whether it was sent.`;
        case "added": {
            const link = runs.find((r) => r.id === savedRunId)?.groupLink !== undefined;
            return `Added and confirmed. ${asSaved} The "Confirmed" mail with a link${link ? " and the group link" : ""} is sent when that mail is on; this answer does not say whether it was sent.`;
        }
        default: {
            const never: never = kind;
            throw new Error(`Unhandled notice ${JSON.stringify(never)}`);
        }
    }
}

/**
 * Abstraction line: `MoveSeatDialog` — users: SchedulingRoster (group roster, people without a group),
 * SchedulingAppointmentsBooking (a group booking); axis: none (one move-seat write); rejected: a second dialog.
 */
export function MoveSeatDialog({ booking, runs, onClose, onDone }: {
    booking: BookingAdminDTO; runs: RunAdminDTO[]; onClose: () => void; onDone: (notice: string) => void;
}) {
    const currentRunId = booking.what.kind === "seat" ? booking.what.runId : null;
    const targets = moveTargets(runs, currentRunId);
    const [choice, setChoice] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function move() {
        const target = moveSeatTarget(choice);
        if (!target.ok) { setError(target.error); return; }
        setBusy(true);
        setError(null);
        try {
            const saved = await apiRequest(`/scheduling/admin/bookings/${enc(booking.id)}/move-seat`, {
                method: "POST", body: JSON.stringify({ runId: target.runId, rev: booking.rev }),
            }) as BookingAdminDTO;
            onDone(seatNotice("moved", saved, target.runId, runs));
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
                    <DialogTitle>{currentRunId === null ? `Place ${booking.ref} into a group` : `Move ${booking.ref}`}</DialogTitle>
                    <DialogDescription>
                        {booking.who.name}{booking.who.language ? ` (language ${booking.who.language})` : ""}. Any group of the course
                        that is not cancelled; a group's language does not change by this move.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
                    <Label htmlFor="move-target">Move to</Label>
                    <select id="move-target" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={choice} onChange={(e) => setChoice(e.target.value)}>
                        <option value="">Choose…</option>
                        {currentRunId !== null && <option value="unplaced">Without a group</option>}
                        {targets.map((r) => <option key={r.id} value={`run:${r.id}`}>{runLabel(r)} · {r.taken}/{r.capacity} · {runStateText(r, Date.now())}</option>)}
                    </select>
                    {targets.length === 0 && <p className="text-sm text-muted-foreground">No other group of this course can take people.</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Close</Button>
                    <Button onClick={move} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Move</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Manual entry (row F7)
// ---------------------------------------------------------------------------------------------------------------

export type PersonForm = { name: string; email: string; phone: string; language: string; channel: string; runId: string /* "" = without a group */ };

/**
 * `POST /scheduling/admin/seats`: `{ courseId, runId?, who, channel }` (§ 10.3), the person checked with the shared
 * `PersonSchema` (email normalized, PD-001). No group chosen → no `runId`: the person is "without a group" (row F7).
 */
export function manualSeatBody(form: PersonForm, courseId: string)
    : { ok: true; body: { courseId: string; runId?: string; who: Person; channel: string } } | { ok: false; error: string } {
    const who = PersonSchema.safeParse({
        email: form.email.trim(), name: form.name.trim(),
        ...(form.phone.trim() === "" ? {} : { phone: form.phone.trim() }),
        ...(form.language === "" ? {} : { language: form.language }),
    });
    if (!who.success) {
        const issue = who.error.issues[0];
        return { ok: false, error: `who.${issue.path.map(String).join(".")}: ${issue.message}` };
    }
    const channel = form.channel.trim();
    if (channel.length < 1 || channel.length > 40) return { ok: false, error: "channel: 1 to 40 characters (for example: phone, transfer, cash)." };
    return { ok: true, body: { courseId, ...(form.runId !== "" ? { runId: form.runId } : {}), who: who.data, channel } };
}

function AddPersonDialog({ course, runs, runId, onClose, onDone }: {
    course: CourseDTO; runs: RunAdminDTO[]; runId: string | null; onClose: () => void; onDone: (notice: string) => void;
}) {
    const [form, setForm] = useState<PersonForm>({ name: "", email: "", phone: "", language: "", channel: "phone", runId: runId ?? "" });
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const open = runs.filter((r) => r.status !== "cancelled");

    async function add() {
        const built = manualSeatBody(form, course.id);
        if (!built.ok) { setError(built.error); return; }
        setBusy(true);
        setError(null);
        try {
            const saved = await apiRequest("/scheduling/admin/seats", { method: "POST", body: JSON.stringify(built.body) }) as BookingAdminDTO;
            onDone(seatNotice("added", saved, built.body.runId ?? null, runs));
        } catch (e) {
            setError(groupErrorText(e));
        } finally {
            setBusy(false);
        }
    }
    const field = (key: Exclude<keyof PersonForm, "language" | "runId">, label: string, type = "text") => (
        <div className="space-y-1">
            <Label htmlFor={`person-${key}`}>{label}</Label>
            <Input id={`person-${key}`} type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        </div>
    );

    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add a person to {course.name}</DialogTitle>
                    <DialogDescription>Confirmed at once. A full group refuses; a closed or started group, and another language, do not.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
                    {field("name", "Name")}
                    {field("email", "Email", "email")}
                    {field("phone", "Phone (optional)")}
                    <div className="space-y-1">
                        <Label htmlFor="person-language">Language</Label>
                        <select id="person-language" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                            <option value="">No preference</option>
                            {course.languages.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>
                    {field("channel", "Booked or paid through (for example: phone, transfer, cash)")}
                    <div className="space-y-1">
                        <Label htmlFor="person-group">Group</Label>
                        <select id="person-group" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={form.runId} onChange={(e) => setForm({ ...form, runId: e.target.value })}>
                            <option value="">Without a group</option>
                            {open.map((r) => <option key={r.id} value={r.id}>{runLabel(r)} · {r.taken}/{r.capacity}</option>)}
                        </select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Close</Button>
                    <Button onClick={add} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add person</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------

type Setup = Awaited<ReturnType<typeof loadGroupSetup>> & { runs: RunAdminDTO[] };
type Page = { people: RosterRow[]; cursor?: string };
type Dialogs =
    | { kind: "group"; mode: GroupDialogMode }
    | { kind: "move"; booking: BookingAdminDTO }
    | { kind: "add"; runId: string | null };

function PeopleTable({ people, tz, onMove, moveLabel }: {
    people: RosterRow[]; tz: TimeZone; onMove: (row: RosterRow) => void; moveLabel: string;
}) {
    if (people.length === 0) return <p className="text-sm text-muted-foreground">Nobody.</p>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                    <tr><th className="p-1">Ref</th><th className="p-1">Name</th><th className="p-1">Email</th><th className="p-1">Phone</th><th className="p-1">Language</th><th className="p-1">State</th><th className="p-1">Source</th><th className="p-1" /></tr>
                </thead>
                <tbody>
                    {people.map((p) => (
                        <tr key={p.bookingId} className="border-t">
                            <td className="p-1"><Link className="underline" to={`/scheduling/bookings/${enc(p.bookingId)}`}>{p.ref}</Link></td>
                            <td className="p-1">{p.name}</td>
                            <td className="p-1">{p.email}</td>
                            <td className="p-1">{p.phone ?? ""}</td>
                            <td className="p-1">{p.language ?? ""}</td>
                            <td className="p-1">{rosterStateText(p, tz)}</td>
                            <td className="p-1">{rosterSourceText(p)}{p.channel ? ` (${p.channel})` : ""}</td>
                            <td className="p-1">
                                {p.state === "confirmed"
                                    ? <Button variant="outline" size="sm" onClick={() => onMove(p)}>{moveLabel}</Button>
                                    : <span className="text-xs text-muted-foreground">Can be moved after the customer confirms</span>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function SchedulingRoster() {
    const { courseId } = useParams();
    const { currentTenant } = useTenant();
    const [searchParams, setSearchParams] = useSearchParams();
    const groupId = searchParams.get("group") || null;
    const courseKey = currentTenant && courseId ? selectionKey([currentTenant.id, courseId]) : null;
    const setup = useSelectionData<Setup>(courseKey, async () => {
        const [g, runs] = await Promise.all([loadGroupSetup(), apiRequest(`/scheduling/admin/courses/${enc(courseId ?? "")}/runs`)]);
        return { ...g, runs: [...(runs.runs as RunAdminDTO[])].sort((a, b) => a.firstStart.localeCompare(b.firstStart) || a.id.localeCompare(b.id)) };
    });
    const rosterKey = courseKey !== null && groupId !== null ? selectionKey([currentTenant?.id ?? "", courseId ?? "", groupId]) : null;
    const roster = useSelectionData<{ run: RunAdminDTO; people: RosterRow[] }>(rosterKey, () =>
        apiRequest(`/scheduling/admin/courses/${enc(courseId ?? "")}/runs/${enc(groupId ?? "")}/roster`));
    const unplaced = useSelectionData<Page>(courseKey, () => apiRequest(`/scheduling/admin/courses/${enc(courseId ?? "")}/unplaced`));
    // Every message, dialog and further page belongs to the page's selection: tenant, course and group.
    const pageKey = courseKey === null ? null : selectionKey([courseKey, groupId ?? ""]);
    const pageLife = useSelectionLifetime(pageKey); // dialogs, messages, opening a person move
    const pages = useSelectionLifetime(courseKey); // "Show more"
    // Further pages extend exactly the first page `base` they were read after (object identity).
    const [more, setMore] = useState<{ base: Page; people: RosterRow[]; cursor?: string } | null>(null);
    const [dialog, setDialog] = useState<{ alive: () => boolean; d: Dialogs } | null>(null);
    const openDialog = (d: Dialogs) => setDialog({ alive: pageLife.lifetime(), d });
    const [message, setMessage] = useState<{ alive: () => boolean; error: string | null; notice: string | null } | null>(null);
    const [busy, setBusy] = useState(false);

    const own = message !== null && message.alive() ? message : null;
    const extra = more !== null && unplaced.data !== null && more.base === unplaced.data ? more : null;
    const unplacedPeople = [...(unplaced.data?.people ?? []), ...(extra?.people ?? [])];
    const cursor = extra !== null ? extra.cursor : unplaced.data?.cursor;

    async function reloadAll() {
        pages.invalidate(); // a pending further page belongs to the list read before: it is dropped, answer or error
        setMore(null);
        await Promise.all([setup.reload(), roster.reload(), unplaced.reload()]);
    }
    async function showMore(base: Page, from: string, before: RosterRow[]) {
        const isCurrent = pages.start();
        setBusy(true);
        try {
            const page = await apiRequest(`/scheduling/admin/courses/${enc(courseId ?? "")}/unplaced?cursor=${enc(from)}`) as Page;
            if (!isCurrent()) return; // another course, or a later "Show more"
            setMore({ base, people: [...before, ...page.people], ...(page.cursor !== undefined ? { cursor: page.cursor } : {}) });
        } catch (e) {
            if (isCurrent()) setMessage({ alive: pageLife.lifetime(), error: groupErrorText(e), notice: null });
        } finally {
            setBusy(false);
        }
    }
    async function openMove(row: RosterRow) {
        const isCurrent = pageLife.start();
        try {
            const booking = await apiRequest(`/scheduling/admin/bookings/${enc(row.bookingId)}`) as BookingAdminDTO;
            if (!isCurrent()) return; // the selection's lifetime ended, or a later "Move" on another person
            setDialog({ alive: pageLife.lifetime(), d: { kind: "move", booking } }); // lives the selection's lifetime
        } catch (e) {
            if (isCurrent()) setMessage({ alive: pageLife.lifetime(), error: groupErrorText(e), notice: null });
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    const s = setup.data;
    const course = s?.courses.find((c) => c.id === courseId) ?? null;
    const error = setup.error ?? roster.error ?? unplaced.error ?? own?.error ?? null;
    const errorBox = error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>;
    const header = (
        <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><Users className="h-7 w-7" /> {course ? `People of ${course.name}` : "People"}</h1>
            <p className="text-muted-foreground"><Link className="underline" to={`/scheduling/courses${course ? `?course=${enc(course.id)}` : ""}`}>Courses and groups</Link></p>
        </div>
    );
    if (s === null || pageKey === null) return <div className="p-8 space-y-6">{header}{errorBox || <Loader2 className="animate-spin" />}</div>;
    if (course === null) return <div className="p-8 space-y-6">{header}<p>Course not found.</p></div>;
    const shown = roster.data; // only ever the roster of `groupId`
    const firstPage = unplaced.data; // the first page of people without a group, of this course
    const siteTz = s.tz ?? "UTC";
    // A dialog's completion closes only that dialog; its notice shows only while the dialog's lifetime lasts.
    const doneFor = (mine: { alive: () => boolean; d: Dialogs }) => (notice: string) => {
        setDialog((prev) => (prev === mine ? null : prev));
        if (mine.alive()) setMessage({ alive: mine.alive, error: null, notice });
        void reloadAll(); // reads of the CURRENT selection (useSelectionData), never of the old one
    };

    return (
        <div className="p-8 space-y-6 max-w-6xl">
            {header}
            <GroupSetupNotes tz={s.tz} enabled={s.enabled} />
            {errorBox}
            {own?.notice && <div className="rounded-md border p-3 text-sm">{own.notice}</div>}
            <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                    <Label htmlFor="roster-group">Group</Label>
                    <select id="roster-group" className="rounded-md border bg-background px-3 py-2 text-sm" value={groupId ?? ""}
                        onChange={(e) => setSearchParams(e.target.value === "" ? {} : { group: e.target.value })}>
                        <option value="">Choose a group…</option>
                        {s.runs.map((r) => <option key={r.id} value={r.id}>{runLabel(r)}{r.status === "cancelled" ? " (cancelled)" : ""}</option>)}
                    </select>
                </div>
                <Button size="sm" onClick={() => openDialog({ kind: "add", runId: shown && shown.run.status !== "cancelled" ? shown.run.id : null })}>
                    <UserPlus className="mr-1 h-4 w-4" /> Add a person
                </Button>
            </div>

            {groupId !== null && (
                <Card>
                    {shown === null ? <CardContent className="p-6"><Loader2 className="animate-spin" /></CardContent> : (
                        <>
                            <CardHeader>
                                <CardTitle>Group {runLabel(shown.run)}</CardTitle>
                                <CardDescription>
                                    {shown.run.taken} / {shown.run.capacity} places · {runStateText(shown.run, Date.now())} · times in {shown.run.timezone}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm">
                                <ul className="text-muted-foreground">{shown.run.meetings.map((m, i) => <li key={i}>{meetingText(m)}</li>)}</ul>
                                <p>Group link: {shown.run.groupLink ? <a className="underline" href={shown.run.groupLink} target="_blank" rel="noreferrer">{shown.run.groupLink}</a> : "none"}</p>
                                <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" size="sm" onClick={() => downloadText(rosterCsvFileName(course.name, shown.run), rosterCsv(shown.people, shown.run.timezone))}>
                                        <Download className="mr-1 h-3 w-3" /> Export CSV
                                    </Button>
                                    {shown.run.status !== "cancelled" && (
                                        <>
                                            <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "group", mode: { kind: "edit", course, run: shown.run, resources: s.resources } })}>Edit group</Button>
                                            <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "group", mode: { kind: "move", course, run: shown.run } })}>Move group</Button>
                                            <Button variant="outline" size="sm" onClick={() => openDialog({ kind: "group", mode: { kind: "cancel", course, run: shown.run } })}>Cancel group</Button>
                                        </>
                                    )}
                                </div>
                                <PeopleTable people={shown.people} tz={shown.run.timezone} moveLabel="Move" onMove={openMove} />
                            </CardContent>
                        </>
                    )}
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>People without a group</CardTitle>
                    <CardDescription>They stay in the course until you place them into a group. Times in {siteTz}.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {unplaced.data === null ? <Loader2 className="animate-spin" /> : (
                        <>
                            <PeopleTable people={unplacedPeople} tz={siteTz} moveLabel="Place into a group" onMove={openMove} />
                            {cursor !== undefined && firstPage !== null && (
                                <Button variant="outline" size="sm" disabled={busy} onClick={() => showMore(firstPage, cursor, extra?.people ?? [])}>Show more</Button>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            {dialog !== null && dialog.alive() && (() => {
                const d = dialog.d;
                const done = doneFor(dialog);
                switch (d.kind) {
                    case "group": return <GroupDialog mode={d.mode} onClose={() => setDialog(null)} onDone={done} />;
                    case "move": return <MoveSeatDialog booking={d.booking} runs={s.runs} onClose={() => setDialog(null)} onDone={done} />;
                    case "add": return <AddPersonDialog course={course} runs={s.runs} runId={d.runId} onClose={() => setDialog(null)} onDone={done} />;
                    default: {
                        const never: never = d;
                        throw new Error(`Unhandled dialog ${JSON.stringify(never)}`);
                    }
                }
            })()}
        </div>
    );
}
