/**
 * SCHED-1D1 — `BookingAdminDTO` (docs/slices/sched-1.md § 10.3), the booking as the admin screen sees it, with its
 * `history` (SCHED-AUDIT-PII = C: the admin reads booking events here, never in the main-table audit log).
 * Every Instant becomes a UTC ISO string; the names of the resource and the course are read beside the booking.
 * Users: GET booking, POST booking cancel (also for its mail), POST customer lookup.
 *
 * Nullable fields (operator ruling S1D1-R03, approved 2026-11-22; recorded in the specification at closeout):
 * `courseName` and a seat's `firstStart` are `string | null`, as `resourceName` already is in § 10.3. The rule:
 * `null` ONLY when the referenced item no longer exists — `courseName` when the `COURSE#` item is gone, `firstStart`
 * when the `RUN#` item is gone (a cancelled booking can outlive both); otherwise the value. Pinned by the R03 tests in
 * test/unit/scheduling-admin.test.ts (one per field and case).
 */
import type { Actor, Booking, BookingSource, HistoryEntry, Instant, Person, Placement } from "@amodx/shared";
import { getCourse, getResource, getRun, iso, type SchedulingStore } from "../../lib/scheduling-db.js";

export type PlacementDTO =
    | { kind: "slot"; resourceId: string; start: string; end: string }
    | { kind: "seat"; runId: string }
    | { kind: "unplaced" };

export type HistoryEntryDTO =
    | { action: "created"; at: string; state: "held" | "confirmed"; placement: PlacementDTO }
    | { action: "confirmed"; at: string }
    | { action: "cancelled"; at: string; by: Actor }
    | { action: "moved"; at: string; by: Actor; from: PlacementDTO; to: PlacementDTO };

export type BookingAdminDTO = {
    id: string; ref: string; rev: number;
    what:
        | { kind: "slot"; serviceId: string; serviceName: string; resourceId: string; resourceName: string | null; start: string; end: string }
        | { kind: "seat"; courseId: string; courseName: string | null; runId: string; firstStart: string | null }
        | { kind: "unplaced"; courseId: string; courseName: string | null };
    state:
        | { kind: "held"; expiresAt: string; mail: "pending" | "sent" | "failed" }
        | { kind: "confirmed"; at: string }
        | { kind: "cancelled"; at: string; by: Actor };
    source: BookingSource; who: Person; createdAt: string; updatedAt: string;
    history: HistoryEntryDTO[];
};

/**
 * The names a DTO (and a mail) shows beside the stored booking. `runTimezone`: the zone of a seat's run, in which its
 * meetings are shown (never the tenant's current zone, § 6.3).
 */
export type BookingNames = { resourceName: string | null; courseName: string | null; firstStart: Instant | null; runTimezone: string | null };

function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

function placementDTO(p: Placement): PlacementDTO {
    switch (p.kind) {
        case "slot": return { kind: "slot", resourceId: p.resourceId, start: iso(p.start), end: iso(p.end) };
        case "seat": return { kind: "seat", runId: p.runId };
        case "unplaced": return { kind: "unplaced" };
        default: return assertNever(p);
    }
}

function historyEntryDTO(e: HistoryEntry): HistoryEntryDTO {
    switch (e.action) {
        case "created": return { action: "created", at: iso(e.at), state: e.state, placement: placementDTO(e.placement) };
        case "confirmed": return { action: "confirmed", at: iso(e.at) };
        case "cancelled": return { action: "cancelled", at: iso(e.at), by: e.by };
        case "moved": return { action: "moved", at: iso(e.at), by: e.by, from: placementDTO(e.from), to: placementDTO(e.to) };
        default: return assertNever(e);
    }
}

/** Pure: the stored booking and its names → the DTO. */
export function bookingAdminDTO(b: Booking, names: BookingNames): BookingAdminDTO {
    let what: BookingAdminDTO["what"];
    switch (b.what.kind) {
        case "slot":
            what = {
                kind: "slot", serviceId: b.what.serviceId, serviceName: b.what.serviceName, resourceId: b.what.resourceId,
                resourceName: names.resourceName, start: iso(b.what.start), end: iso(b.what.end),
            };
            break;
        case "seat":
            what = {
                kind: "seat", courseId: b.what.courseId, courseName: names.courseName, runId: b.what.runId,
                firstStart: names.firstStart === null ? null : iso(names.firstStart),
            };
            break;
        case "unplaced":
            what = { kind: "unplaced", courseId: b.what.courseId, courseName: names.courseName };
            break;
        default: return assertNever(b.what);
    }
    let state: BookingAdminDTO["state"];
    switch (b.state.kind) {
        case "held": state = { kind: "held", expiresAt: iso(b.state.expiresAt), mail: b.state.mail }; break;
        case "confirmed": state = { kind: "confirmed", at: iso(b.state.at) }; break;
        case "cancelled": state = { kind: "cancelled", at: iso(b.state.at), by: b.state.by }; break;
        default: return assertNever(b.state);
    }
    return {
        id: b.id, ref: b.ref, rev: b.rev, what, state, source: b.source, who: b.who,
        createdAt: iso(b.createdAt), updatedAt: iso(b.updatedAt), history: b.history.map(historyEntryDTO),
    };
}

/** The names of one booking (display reads, not consistent): its resource, or its course and run. */
export async function bookingNames(store: SchedulingStore, tenantId: string, b: Booking): Promise<BookingNames> {
    const what = b.what;
    switch (what.kind) {
        case "slot": {
            const resource = await getResource(store, tenantId, what.resourceId, false);
            return { resourceName: resource?.name ?? null, courseName: null, firstStart: null, runTimezone: null };
        }
        case "seat": {
            const [course, run] = await Promise.all([
                getCourse(store, tenantId, what.courseId, false),
                getRun(store, tenantId, what.courseId, what.runId, false),
            ]);
            return {
                resourceName: null, courseName: course?.name ?? null,
                firstStart: run === undefined ? null : Date.parse(run.firstStartIso), runTimezone: run?.timezone ?? null,
            };
        }
        case "unplaced": {
            const course = await getCourse(store, tenantId, what.courseId, false);
            return { resourceName: null, courseName: course?.name ?? null, firstStart: null, runTimezone: null };
        }
        default: return assertNever(what);
    }
}
