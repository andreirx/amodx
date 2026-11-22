/**
 * SCHED-1F1 — the parts the group admin routes share (docs/slices/sched-1.md § 10.3 routes of `sched-1f`, § 4.3,
 * § 5.4, § 6.5, § 7.4, § 7.6, § 11.1). PROTOTYPE.
 *
 * - `runAdminDTO`: § 10.3 `RunAdminDTO` from a stored run (`taken` = active seats at `now`; `overCapacityBy` § 13).
 * - `rosterRow`: § 10.3 `RosterRow` from a booking roster view (AP7 / AP8 projection); `undefined` for a booking that is
 *   not active (cancelled, or held and expired), so a list shows exactly the active people (row F2).
 * - `runAuditTitle`: § 6.5 point 2 — a run's audit title is the course name and the run's first local date.
 * - `MeetingsBodySchema` + `meetingErrorAnswer`: the meetings of a run create or move are checked by the kernel's
 *   `validateMeetings` (inside `createRun` / `moveRun`); the body schema checks only the field formats, so every
 *   `MeetingError` reaches the client with its kind as the code (row F1).
 * - `checkTrainers`: § 10.3 "trainers 1-10, exist, not retiring", read CONSISTENTLY before the write (it decides
 *   whether the write runs). The store's resource guard closes the race for a run with a future meeting (§ 7.6).
 * - `seatWriteAnswer`: every refusal of a manual seat or an admin person move → its HTTP answer.
 * - `seatPlace`: the course and run an answer and a mail show for the EXACT booking a write returned (rule of review
 *   S1E1-R05 applied to seats): a run read before the write is reused only when it is that booking's run.
 * - `hasPlacement` (review S1F1-R01, one rule for every group notice sent after a commit): a notice is about one
 *   placement (the run a run move moved, the course a run cancel or a person move unplaced into, the run a person was
 *   moved to); it is built from the booking the mint returned and sent ONLY when that booking still has that
 *   placement. Otherwise it is not sent: the booking moved on in between, and its own change sent or will send the
 *   notice that is true. The run loops count such notices in their answer (`notSentPlacementChanged`).
 * - `sendGroupAdminMail`: the two group mails `sendVisitorMail` (visitor/mail.ts) does not send as § 11.1 states:
 *   `unplaced` (not one of its keys) and `cancelled` after an ADMIN run cancel (no owner copy: § 11.1 sends the owner
 *   copy of `cancelled` on a customer cancel only; `sendVisitorMail` sends it whenever `sendToAdmin` is on).
 *
 * Abstraction lines:
 * - `sendGroupAdminMail` — users: group-runs-cancel.ts (`unplaced`, `cancelled`), group-move-seat.ts (`unplaced`);
 *   axis: none (one recipient rule for the two admin-side group mails); rejected: extending `sendVisitorMail`
 *   (visitor/mail.ts is outside this slice's allocation; proposed in notes-for-human.md), or two render-and-send copies.
 * - `seatPlace` — users: group-seats-create.ts, group-move-seat.ts; axis: none; rejected: pairing a pre-read run with
 *   whatever booking the write returned.
 * - `seatWriteAnswer` — users: group-seats-create.ts, group-move-seat.ts; axis: the refusal kinds of
 *   `scheduling-db.ts` (closed sum, exhaustive `switch`: a new kind breaks the compile here); rejected: one mapping per
 *   route.
 * - `checkTrainers` — users: group-runs-create.ts, group-runs-update.ts; axis: none; rejected: two copies of the
 *   read-and-refuse block.
 * - `hasPlacement` — users: group-runs-move.ts, group-runs-cancel.ts, group-move-seat.ts; axis: none (one rule);
 *   rejected: a per-route check (review S1F1-R01 found the two loops each missing it).
 * The DTO builders and `meetingErrorAnswer` are plain functions with two or more callers each.
 */
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import {
    LocalDateSchema, LocalTimeSchema, activeSeats, bookingBase,
    type Booking, type Course, type Instant, type MeetingError, type RunLanguage,
} from "@amodx/shared";
import { z } from "zod";
import { formatFromHeader } from "../../lib/email-from.js";
import { getResource, getRun, type BookingRosterView, type ManualSeatRefusal, type MoveSeatRefusal, type RunRecord, type SchedulingStore } from "../../lib/scheduling-db.js";
import { renderSchedulingMail, resolveTemplate } from "../../lib/scheduling-email.js";
import { refusal, type Answer, type SchedulingTenant } from "../common.js";
import type { Place } from "../visitor/common.js";
import { changeFailureAnswer, whenText } from "./bookings-cancel.js";
import type { BookingNames } from "./booking-dto.js";

const ses = new SESClient({});

/** § 4.5 / § 10.3: the text of a capacity above 45 (SCHED-SEAT-BOUND = A). */
export const CAPACITY_TEXT = "A group in this version holds at most 45 people.";
/** Run capacity in a request: an integer 1-45; above 45 → 400 with `CAPACITY_TEXT` as the issue message. */
export const CapacityBodySchema = z.number().int().min(1).max(45, { message: CAPACITY_TEXT });

/** The meetings of a request: formats only; order, overlap, count and local-time existence are `validateMeetings`. */
export const MeetingsBodySchema = z.array(z.object({ date: LocalDateSchema, start: LocalTimeSchema, end: LocalTimeSchema }).strict());

/** § 10.3 `RunAdminDTO`. */
export type RunAdminDTO = {
    id: string; courseId: string; meetings: { date: string; start: string; end: string }[]; timezone: string; capacity: number;
    taken: number; overCapacityBy: number; trainerIds: string[]; language: string | null; groupLink?: string;
    status: "open" | "closed" | "cancelled"; firstStart: string; lastEnd: string;
};

/** § 10.3 `RosterRow`. */
export type RosterRow = {
    bookingId: string; ref: string; name: string; email: string; phone?: string; language?: string;
    state: "held" | "confirmed"; expiresAt?: string; source: "visitor" | "manual" | "order"; channel?: string;
};

function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

function languageTag(language: RunLanguage): string | null {
    switch (language.kind) {
        case "notSet": return null;
        case "set": return language.tag;
        default: return assertNever(language);
    }
}

export function runAdminDTO(run: RunRecord, now: Instant): RunAdminDTO {
    const taken = activeSeats(run.seats, now);
    return {
        id: run.id, courseId: run.courseId,
        meetings: run.meetings.map((m) => ({ date: m.date, start: m.start, end: m.end })),
        timezone: run.timezone, capacity: run.capacity, taken, overCapacityBy: Math.max(0, taken - run.capacity),
        trainerIds: [...run.trainerIds], language: languageTag(run.language),
        ...(run.groupLink !== undefined ? { groupLink: run.groupLink } : {}),
        status: run.status, firstStart: run.firstStartIso, lastEnd: run.lastEndIso,
    };
}

/** § 6.5 point 2: course name and the run's first local date (meetings are stored sorted by `validateMeetings`). */
export function runAuditTitle(courseName: string, run: RunRecord): string {
    return `${courseName} ${run.meetings[0].date}`;
}

/** § 6.5 point 2: the dates and counts of a run's meetings (no booking data). */
export function runAuditDates(run: RunRecord): { firstDate: string; lastDate: string; meetings: number } {
    return { firstDate: run.meetings[0].date, lastDate: run.meetings[run.meetings.length - 1].date, meetings: run.meetings.length };
}

/** A roster row, or `undefined` when the booking is not active at `now` (cancelled; held and expired). */
export function rosterRow(v: BookingRosterView, now: Instant): RosterRow | undefined {
    let state: RosterRow["state"];
    let expiresAt: string | undefined;
    switch (v.state.kind) {
        case "held":
            if (now >= v.state.expiresAt) return undefined;
            state = "held";
            expiresAt = new Date(v.state.expiresAt).toISOString();
            break;
        case "confirmed": state = "confirmed"; break;
        case "cancelled": return undefined;
        default: return assertNever(v.state);
    }
    let channel: string | undefined;
    switch (v.source.kind) {
        case "manual": channel = v.source.channel; break;
        case "visitor":
        case "order": break;
        default: return assertNever(v.source);
    }
    return {
        bookingId: v.id, ref: v.ref, name: v.who.name, email: v.who.email,
        ...(v.who.phone !== undefined ? { phone: v.who.phone } : {}),
        ...(v.who.language !== undefined ? { language: v.who.language } : {}),
        state, ...(expiresAt !== undefined ? { expiresAt } : {}),
        source: v.source.kind, ...(channel !== undefined ? { channel } : {}),
    };
}

/** Row F1: 400 with the `MeetingError` kind as the code, and its context. */
export function meetingErrorAnswer(e: MeetingError): Answer {
    switch (e.kind) {
        case "empty": return refusal(400, "empty", "A group needs at least one meeting.");
        case "endNotAfterStart": return refusal(400, "endNotAfterStart", "A meeting ends before it starts.", { index: e.index });
        case "overlap": return refusal(400, "overlap", "Two meetings overlap.", { a: e.a, b: e.b });
        case "nonexistentLocalTime": return refusal(400, "nonexistentLocalTime", "A meeting time does not exist on that day (clock change).", { index: e.index });
        case "tooMany": return refusal(400, "tooMany", `A group has at most ${e.max} meetings.`, { max: e.max });
        default: return assertNever(e);
    }
}

/** A language of a request must be one of the course's languages (§ 4.3). `null` when it is, else the 400 answer. */
export function languageNotOffered(course: Course, language: string, path: string): Answer | null {
    return course.languages.includes(language) ? null
        : refusal(400, "invalid", "The request is not valid.", { issues: [{ path, message: "Must be one of the course's languages." }] });
}

/**
 * § 10.3 trainers "exist, not retiring", one CONSISTENT read per trainer (≤ 10): an unknown id → 400 `invalid` naming
 * its path; a resource under removal → 409 `resourceUnavailable`; `null` when every trainer passes.
 */
export async function checkTrainers(store: SchedulingStore, tenantId: string, trainerIds: string[]): Promise<Answer | null> {
    const resources = await Promise.all(trainerIds.map((id) => getResource(store, tenantId, id, true)));
    const issues = resources.flatMap((r, i) => (r === undefined ? [{ path: `trainerIds.${i}`, message: "Unknown resource." }] : []));
    if (issues.length > 0) return refusal(400, "invalid", "The request is not valid.", { issues });
    if (resources.some((r) => r?.retiring !== undefined)) {
        return refusal(409, "resourceUnavailable", "A trainer does not exist or is being removed.");
    }
    return null;
}

/**
 * Every refusal of `createManualSeat` and `moveSeat` (admin) → its answer. `notFound` is the route's own 404. The
 * visitor-only seat kinds (`runClosed`, `runStarted`, `languageMismatch`) and the customer-only change kinds are not
 * produced for an admin (§ 5.4 admin rules, § 5.3); they are mapped so the switch stays exhaustive.
 */
export function seatWriteAnswer(r: ManualSeatRefusal | MoveSeatRefusal, notFound: Answer): Answer {
    switch (r.kind) {
        case "runFull": return refusal(409, "runFull", "The group is full.", { capacity: r.capacity });
        case "runCancelled": return refusal(409, "runCancelled", "The group is cancelled.");
        case "runClosed": return refusal(409, "runClosed", "The group is closed.");
        case "runStarted": return refusal(409, "runStarted", "The group has started.");
        case "languageMismatch": return refusal(409, "languageMismatch", "The group has another language.", { run: r.run, person: r.person });
        case "notFound": return notFound;
        case "notActive":
        case "notConfirmed":
        case "tooLate":
        case "paidContactTenant":
        case "stale":
        case "busy":
            return changeFailureAnswer(r);
        default: return assertNever(r);
    }
}

/**
 * The course and run of the EXACT booking a seat write returned (review S1E1-R05 rule): `known` (a run read before
 * the write) is reused only when it is that booking's run; otherwise the run is read for it (display read, after the
 * commit — recorded limit: a failure of that read answers 500 although the write stands). `course` is the course read
 * before the write: a person move stays inside the booking's own course (§ 10.3), so it is always that booking's course.
 */
export async function seatPlace(store: SchedulingStore, tenantId: string, booking: Booking, course: Course, known: RunRecord | undefined)
    : Promise<Place> {
    const what = booking.what;
    switch (what.kind) {
        case "seat": {
            if (known !== undefined && known.id === what.runId) return { course, run: known };
            const run = await getRun(store, tenantId, what.courseId, what.runId, false);
            if (run === undefined) throw new Error("[scheduling] seat booking without its run");
            return { course, run };
        }
        case "unplaced": return { course };
        case "slot": return {};
        default: return assertNever(what);
    }
}

/** The placement a group notice is about (§ 4.4 `BookingWhat` of a group booking). */
export type GroupPlacement = { kind: "seat"; courseId: string; runId: string } | { kind: "unplaced"; courseId: string };

/** Review S1F1-R01: `true` when the booking as saved still has the placement the notice is about. */
export function hasPlacement(b: Booking, about: GroupPlacement): boolean {
    switch (about.kind) {
        case "seat": return b.what.kind === "seat" && b.what.courseId === about.courseId && b.what.runId === about.runId;
        case "unplaced": return b.what.kind === "unplaced" && b.what.courseId === about.courseId;
        default: return assertNever(about);
    }
}

/** The names a `BookingAdminDTO` shows for a group booking and its place (§ 10.3, ruling S1D1-R03). */
export function placeNames(place: Place): BookingNames {
    return {
        resourceName: null, courseName: place.course?.name ?? null,
        firstStart: place.run !== undefined ? Date.parse(place.run.firstStartIso) : null, runTimezone: place.run?.timezone ?? null,
    };
}

/**
 * The two admin-side group mails of § 11.1 that `sendVisitorMail` does not send as stated:
 * - `unplaced` (run cancelled; admin moves a person out of a run): the customer when `sendToCustomer` is on, with the
 *   link of `token` (the page shows the new proposal); an owner copy when `sendToAdmin` is on (never with the link).
 * - `cancelled` after an admin run cancel: the customer when `sendToCustomer` is on, no link (the tokens are deleted,
 *   § 7.6); NO owner copy (§ 11.1: the owner copy is for a customer cancel).
 * `{{when}}` is `whenText` (one rule for every mail); `{{groupLink}}` and `{{expiresAt}}` are empty (F8: the group
 * link is only in the `confirmed` mail of a seat). Returns the customer copy's outcome; never throws for a send
 * failure; logs carry the booking id and the error name only.
 */
export async function sendGroupAdminMail(input: {
    key: "unplaced" | "cancelled"; tenantId: string; tenant: SchedulingTenant; booking: Booking; place: Place; token: string | null;
}): Promise<"sent" | "failed" | "off"> {
    const { key, tenantId, tenant, booking: b, place, token } = input;
    const template = resolveTemplate(key, tenant.templates);
    const from = process.env.SES_FROM_EMAIL ?? "";
    const origin = process.env.RENDERER_CLOUDFRONT_ORIGIN ?? "";
    let ownerCopy: boolean;
    switch (key) {
        case "unplaced": ownerCopy = template.sendToAdmin; break;
        case "cancelled": ownerCopy = false; break;
        default: return assertNever(key);
    }
    const vars = (link: string) => ({
        ref: b.ref, customerName: b.who.name, serviceName: "", courseName: place.course?.name ?? "",
        when: whenText(b, placeNames(place), tenant.scheduling?.timezone), expiresAt: "", link, groupLink: "",
        siteName: tenant.name ?? "",
    });
    const send = async (to: string, link: string) => {
        const mail = renderSchedulingMail(template, vars(link));
        await ses.send(new SendEmailCommand({
            Source: formatFromHeader(tenant.name, from),
            Destination: { ToAddresses: [to] },
            Message: { Subject: { Data: mail.subject }, Body: { Text: { Data: mail.body } } },
        }));
    };

    let outcome: "sent" | "failed" | "off" = "off";
    if (template.sendToCustomer) {
        if (!from || (token !== null && !origin)) {
            console.error(`[scheduling] ${key} mail not sent: sender or link base not configured`, b.id);
            outcome = "failed";
        } else {
            const link = token === null ? "" : `${bookingBase({ id: tenantId, domain: tenant.domain }, origin)}/_booking/manage#t=${token}`;
            try {
                await send(b.who.email, link);
                outcome = "sent";
            } catch (e) {
                console.error(`[scheduling] ${key} mail failed`, b.id, e instanceof Error ? e.name : "unknown");
                outcome = "failed";
            }
        }
    }
    if (ownerCopy && tenant.contactEmail !== undefined && from) {
        try {
            await send(tenant.contactEmail, "");
        } catch (e) {
            console.error(`[scheduling] ${key} owner copy failed`, b.id, e instanceof Error ? e.name : "unknown");
        }
    }
    return outcome;
}
