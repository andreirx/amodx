/**
 * SCHED-1E1 — the parts the appointment admin routes share (docs/slices/sched-1.md § 10.3 routes of `sched-1e`,
 * § 5.5, § 6.3 consumer rows "Planner week", "All-resource appointments", "Day edits"). PROTOTYPE.
 *
 * - `zonedSettings`: the stored time zone a route needs when it reads or writes local wall time (week, day edits,
 *   copy-week, appointments read; manual slot and move slot for the `{{when}}` of their mail). § 4.1 gives the zone
 *   no default ("a default zone would shift every time of a tenant elsewhere"), so a tenant without one answers 409
 *   `timezoneNotSet` (local decision of SCHED-1E1, recorded in the build report).
 * - `applyDayEdit`: the one write path of `PUT …/days` and `POST …/days/copy-week` (same write, retry and errors,
 *   § 10.3): reads before the write, `editResourceDays`, then the audit at once (before any display read, review
 *   S1E1-R04), then the `outsideHours` answer through `readIntervals` (the § 5.5 `activeEntries` list function of
 *   `scheduling-db.ts`) and `planDay` per changed date.
 * - `slotWriteAnswer`: every refusal of a manual appointment or an admin slot move → its HTTP answer.
 * - `readTenantBeforeWrite` (review S1E1-R01): the ONE way an appointment route that writes reads its tenant — the
 *   record CONSISTENT, every stored scheduling attribute parsed (`readSchedulingTenant`: a malformed `scheduling` or
 *   `schedulingEmailConfig` → 500 `storedDataInvalid`), BEFORE the route's first write. Rule: every appt-*.ts route
 *   that writes calls it first (the eight writers; table-driven test "S1E1-R01" in scheduling-appt.test.ts).
 * - `slotNames` (review S1E1-R05): the names in an answer belong to the EXACT booking that answer describes; a name
 *   read earlier is reused only when its resource is that booking's resource, else the names are read for it.
 *
 * Abstraction lines:
 * - `applyDayEdit` — users: appt-days-edit.ts, appt-days-copy-week.ts; axis: none (one rule for both edit kinds,
 *   which § 10.3 states once: "same write, retry and errors as the PUT"); rejected: the read / write / audit /
 *   answer block written twice.
 * - `readTenantBeforeWrite` — users: the eight writing routes (services create/update/delete, availability put,
 *   `applyDayEdit` for days and copy-week, manual appointment, move slot); axis: none (one rule); rejected: eight
 *   hand-written reads (the omission review S1E1-R01 found in four of them).
 * - `slotNames` — users: appt-appointments-create.ts, appt-move-slot.ts; axis: none; rejected: pairing a pre-read
 *   name with whatever booking the write returned.
 * - `slotWriteAnswer` — users: appt-appointments-create.ts, appt-move-slot.ts; axis: the refusal kinds of
 *   `scheduling-db.ts` (closed sum, exhaustive `switch`: a new kind breaks the compile here); rejected: one mapping
 *   per route.
 */
import {
    activeEntries, instantToLocal, localDaySpan, planDay,
    type Booking, type ContainerEntry, type DaysEdit, type DaysEditError, type Instant, type LocalDate, type SchedulingSettings, type TimeZone,
} from "@amodx/shared";
import { z } from "zod";
import { publishAudit } from "../../lib/events.js";
import {
    editResourceDays, getAvailability, getResource, iso, readIntervals,
    type BookingDisplayView, type MoveSlotRefusal, type SchedulingStore,
} from "../../lib/scheduling-db.js";
import { answer, readSchedulingTenant, refusal, type Answer, type SchedulingTenant } from "../common.js";
import type { AdminContext } from "./common.js";
import { changeFailureAnswer } from "./bookings-cancel.js";
import { bookingNames, type BookingNames } from "./booking-dto.js";

/** An id sent in a body (a resource or a service): 1-100 characters, no `#` (a `#` would make a key ambiguous). */
export const IdSchema = z.string().min(1).max(100).refine((v) => !v.includes("#"), { message: "Must not contain #." });

/** The tenant's scheduling settings with the time zone present. */
export type ZonedSettings = SchedulingSettings & { timezone: TimeZone };

/** The settings of a tenant whose stored `scheduling.timezone` is set; otherwise the 409 `timezoneNotSet` answer. */
export function zonedSettings(tenant: SchedulingTenant): { ok: true; value: ZonedSettings } | { ok: false; answer: Answer } {
    const timezone = tenant.scheduling?.timezone;
    if (tenant.scheduling === undefined || timezone === undefined) {
        return { ok: false, answer: refusal(409, "timezoneNotSet", "Set the time zone in the scheduling settings first.") };
    }
    return { ok: true, value: { ...tenant.scheduling, timezone } };
}

/**
 * Review S1E1-R01: the tenant of a write route, read CONSISTENTLY with every stored scheduling attribute parsed by its
 * shared schema (a malformed value throws `StoredDataInvalidError` → 500 `storedDataInvalid` through `guarded`, logged
 * by key). No record → 404. Call it before the route's first write.
 */
export async function readTenantBeforeWrite(tenantId: string): Promise<{ ok: true; tenant: SchedulingTenant } | { ok: false; answer: Answer }> {
    const tenant = await readSchedulingTenant(tenantId, true);
    if (tenant === undefined) return { ok: false, answer: refusal(404, "notFound", "Site not found.") };
    return { ok: true, tenant };
}

/**
 * Review S1E1-R05: the names of the EXACT booking an answer describes. `known` (a resource read before the write) is
 * reused only when it is that booking's resource; otherwise the names are read for the booking (display read).
 */
export async function slotNames(store: SchedulingStore, tenantId: string, booking: Booking, known: { id: string; name: string } | undefined)
    : Promise<BookingNames> {
    if (known !== undefined && booking.what.resourceId === known.id) {
        return { resourceName: known.name };
    }
    return bookingNames(store, tenantId, booking);
}

/** § 4.4: the display reference of a booking is `B-` and the first 8 characters of its id, upper case. */
export function refOfBookingId(bookingId: string): string {
    return `B-${bookingId.slice(0, 8).toUpperCase()}`;
}

/** The instant span from the start of local date `first` to the end of local date `last` (both included). */
export function localDatesSpan(first: LocalDate, last: LocalDate, tz: TimeZone): { start: Instant; end: Instant } {
    return { start: localDaySpan(first, tz).start, end: localDaySpan(last, tz).end };
}

/** One booking interval as the appointments read shows it (§ 10.3); the planner adds `expiresAt`. */
export type AppointmentEntryDTO = {
    bookingId: string; ref: string; start: string; end: string; state: "held" | "confirmed"; customerName: string; serviceName: string;
};

/**
 * § 6.3 consumer rows "Planner week" and "All-resource appointments": times and state from the `RESDAY#` entry (`x`
 * present = held), ref, customer name and service name from the `BOOKING#` display view.
 */
export function appointmentEntry(e: ContainerEntry, view: BookingDisplayView): AppointmentEntryDTO {
    let serviceName: string;
    switch (view.what.kind) {
        case "slot": serviceName = view.what.serviceName; break;
        default: {
            const never: never = view.what.kind;
            throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
        }
    }
    return {
        bookingId: e.bookingId, ref: view.ref, start: iso(e.s), end: iso(e.e),
        state: e.x === undefined ? "confirmed" : "held", customerName: view.who.name, serviceName,
    };
}

/** § 10.3: 400 with the `DaysEditError` kind as the code, and its context. */
function daysEditRefusal(e: DaysEditError): Answer {
    switch (e.kind) {
        case "rangeInverted": return refusal(400, "rangeInverted", "The first date is after the last date.");
        case "rangeTooLong": return refusal(400, "rangeTooLong", `One edit covers at most ${e.maxDays} dates.`, { maxDays: e.maxDays });
        case "startsInPast": return refusal(400, "startsInPast", "The edit starts before today.", { today: e.today });
        case "sourceTooOld": return refusal(400, "sourceTooOld", "The source week starts too far in the past.", { oldest: e.oldest });
        case "weekdayMismatch": return refusal(400, "weekdayMismatch", "The source and the target start on different weekdays.");
        case "targetOverlapsSource": return refusal(400, "targetOverlapsSource", "The target weeks include the source week.");
        case "tooManyDays": return refusal(400, "tooManyDays", `A resource can have at most ${e.max} edited dates.`, { max: e.max });
        default: {
            const never: never = e;
            throw new Error(`Unhandled refusal ${JSON.stringify(never)}`);
        }
    }
}

/**
 * The day edit of § 10.3 for one resource. Order:
 * 1. before the write (each failure answers with nothing changed): the tenant record (`readTenantBeforeWrite`:
 *    consistent, every stored scheduling attribute parsed; its time zone gives `today`, which decides the edit); the time zone
 *    (409 `timezoneNotSet`); the resource, CONSISTENT (404 decides whether the write runs; its name is the audit
 *    title); the defaults (display read for the answer, read here so a broken stored item answers before the write);
 * 2. `editResourceDays`: the versioned Put of `DAYS#<r>` (one retry, then 503 `busy`); a `DaysEditError` → 400;
 * 3. right after the commit, before any display read (review S1E1-R04): one main-table audit event (§ 6.5 point 2):
 *    the admin's email, the resource name, the dates, the kind and the count of changed dates; never a ref; no `ip`;
 * 4. then `outsideHours`: one `readIntervals` over the local days from the first to the last changed date, then per
 *    changed date `activeEntries` on that local day and `planDay`; refs from the ids (no BatchGet). A stored `RESDAY#`
 *    item that fails its schema here answers 500 although the edit stands and its audit event was sent (recorded limit).
 */
export async function applyDayEdit(input: {
    ctx: AdminContext; store: SchedulingStore; resourceId: string; edit: DaysEdit; action: string;
    details: Record<string, string | number>;
}): Promise<Answer> {
    const { ctx, store, resourceId, edit } = input;
    const { tenantId, auth } = ctx;
    const read = await readTenantBeforeWrite(tenantId);
    if (!read.ok) return read.answer;
    const settings = zonedSettings(read.tenant);
    if (!settings.ok) return settings.answer;
    const tz = settings.value.timezone;
    const resource = await getResource(store, tenantId, resourceId, true);
    if (resource === undefined) return refusal(404, "notFound", "Resource not found.");
    const rules = await getAvailability(store, tenantId, resourceId, false);

    const now = Date.now();
    const edited = await editResourceDays(store, tenantId, resourceId, edit, instantToLocal(now, tz).date);
    if (!edited.ok) {
        if (edited.error.kind === "busy") return refusal(503, "busy", "Busy, please try again.");
        return daysEditRefusal(edited.error);
    }
    const { changed, days } = edited.value;
    await publishAudit({
        tenantId,
        actor: { id: auth.sub, email: auth.email },
        action: input.action,
        target: { id: resourceId, title: resource.name },
        details: { ...input.details, changedDates: changed.length },
    });

    const outsideHours: string[] = [];
    if (changed.length > 0) {
        const entries = await readIntervals(store, tenantId, resourceId, localDatesSpan(changed[0], changed[changed.length - 1], tz), now);
        for (const date of changed) {
            const day = planDay({ rules, days, date, entries: activeEntries(entries, localDaySpan(date, tz), now), tz, now });
            switch (day.kind) {
                case "planned":
                    for (const id of day.outsideHours) {
                        const ref = refOfBookingId(id);
                        if (!outsideHours.includes(ref)) outsideHours.push(ref);
                    }
                    break;
                case "past": break; // not reachable: `changed` holds no date before today − 6 (§ 5.5 pruning)
                default: {
                    const never: never = day;
                    throw new Error(`Unhandled day ${JSON.stringify(never)}`);
                }
            }
        }
    }

    return answer(200, { changed, outsideHours });
}

/**
 * Every refusal of `createManualAppointment` (a subset) and `moveSlot` → its answer. `notFound` is the route's own
 * 404 (the service or resource of a manual appointment; the booking of a move). The visitor-only kinds (`inPast`,
 * `beyondHorizon`, `notEligible`, `notOnGrid`, `outsideAvailability`) are not produced for an admin (§ 5.2: admin
 * writes skip `slotDecision`); they are mapped so the switch stays exhaustive.
 */
export function slotWriteAnswer(r: MoveSlotRefusal, notFound: Answer): Answer {
    switch (r.kind) {
        case "slotTaken": return refusal(409, "slotTaken", "Another booking overlaps this time.");
        case "resourceUnavailable": return refusal(409, "resourceUnavailable", "The resource does not exist or is being removed.");
        case "inPast":
        case "beyondHorizon":
        case "notEligible":
        case "notOnGrid":
        case "outsideAvailability":
            return refusal(409, r.kind, "This time cannot be booked.");
        case "notFound": return notFound;
        case "notActive":
        case "notConfirmed":
        case "tooLate":
        case "stale":
        case "busy":
            return changeFailureAnswer(r);
        default: {
            const never: never = r;
            throw new Error(`Unhandled refusal ${JSON.stringify(never)}`);
        }
    }
}
