/**
 * SCHED-1D1 — `BookingAdminDTO` (docs/slices/sched-1.md § 10.3), the booking as the admin screen sees it, with its
 * `history` (SCHED-AUDIT-PII = C: the admin reads booking events here, never in the main-table audit log).
 * Every Instant becomes a UTC ISO string; the name of the resource is read beside the booking (`null` when the
 * `RESOURCE#` item no longer exists, § 10.3). Users: GET booking, POST booking cancel (also for its mail), POST
 * customer lookup.
 */
import type { Actor, Booking, BookingSource, HistoryEntry, Person, Placement } from "@amodx/shared";
import { getResource, iso, type SchedulingStore } from "../../lib/scheduling-db.js";

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

/** The names a DTO shows beside the stored booking. */
export type BookingNames = { resourceName: string | null };

function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

function placementDTO(p: Placement): PlacementDTO {
    switch (p.kind) {
        case "slot": return { kind: "slot", resourceId: p.resourceId, start: iso(p.start), end: iso(p.end) };
        default: return assertNever(p.kind);
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
        default: return assertNever(b.what.kind);
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

/** The names of one booking (display read, not consistent): its resource. */
export async function bookingNames(store: SchedulingStore, tenantId: string, b: Booking): Promise<BookingNames> {
    const resource = await getResource(store, tenantId, b.what.resourceId, false);
    return { resourceName: resource?.name ?? null };
}
