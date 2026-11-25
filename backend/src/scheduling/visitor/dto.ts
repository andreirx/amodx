/**
 * SCHED-1D2 — the visitor DTOs of docs/slices/sched-1.md § 10.2: `HoldResult`, `BookingViewDTO`. Pure builders over
 * stored records.
 *
 * Data rules (rows D5, D9): no answer carries a booking id or a link token; the availability DTOs (offer, slots) carry
 * no resource id or name, no email, phone or customer name. A `BookingViewDTO` is shown only to the holder of that
 * booking's link: it carries the booking's own `ref`, the person's name and the MASKED email, never the resource.
 */
import { changeDecision, confirmDecision, type Booking, type Instant } from "@amodx/shared";
import { iso } from "../../lib/scheduling-db.js";
import type { VisitorSettings } from "./common.js";

const HOUR_MS = 3_600_000;

export type HoldResult =
    | { ref: string; state: "held"; expiresAt: string; emailMasked: string }
    | { ref: string; state: "confirmed"; emailMasked: string };
export type BookingViewDTO = {
    ref: string; state: "held" | "confirmed" | "expired"; expiresAt?: string;
    // SCHED-1G2 (operator ruling SCHED-1G2-SLOT-MOVE-ID = A; § 10.2 amendment recorded at closeout): `serviceId` is the
    // booking's own stored service id, so the manage page asks for the free times of exactly that service. The offer
    // route already shows service ids to visitors: nothing private is added.
    what: { kind: "slot"; serviceId: string; serviceName: string; start: string; end: string; timezone: string };
    who: { name: string; emailMasked: string };
    can: { confirm: boolean; cancel: boolean; move: boolean };
    changeCutoff: string;
};

/** The address with all but the first character of the local part hidden: `ana.pop@example.test` → `a***@example.test`. */
export function emailMasked(email: string): string {
    const at = email.lastIndexOf("@");
    return at <= 0 ? "***" : `${email[0]}***${email.slice(at)}`;
}

/** § 10.2 `HoldResult`: never a token or an id. Only a held or confirmed booking has one. */
export function holdResult(b: Booking): HoldResult {
    const state = b.state;
    switch (state.kind) {
        case "held": return { ref: b.ref, state: "held", expiresAt: iso(state.expiresAt), emailMasked: emailMasked(b.who.email) };
        case "confirmed": return { ref: b.ref, state: "confirmed", emailMasked: emailMasked(b.who.email) };
        case "cancelled": throw new Error("[scheduling] no hold result for a cancelled booking");
        default: {
            const never: never = state;
            throw new Error(`Unhandled state ${JSON.stringify(never)}`);
        }
    }
}

/**
 * § 10.2 `BookingViewDTO` of an active-or-expired booking (a cancelled booking has no link, § 8.4). `state: "expired"`
 * = held and `now >= expiresAt` (derived, § 4.4); the page then offers a new booking. `can` comes from the kernel's
 * `confirmDecision` / `changeDecision` with the customer's rules; `changeCutoff` counts back from the slot's start.
 */
export function bookingViewDTO(b: Booking, settings: VisitorSettings, now: Instant): BookingViewDTO {
    let state: BookingViewDTO["state"];
    let expiresAt: string | undefined;
    switch (b.state.kind) {
        case "held":
            state = now < b.state.expiresAt ? "held" : "expired";
            expiresAt = iso(b.state.expiresAt);
            break;
        case "confirmed": state = "confirmed"; break;
        case "cancelled": throw new Error("[scheduling] no view of a cancelled booking");
        default: {
            const never: never = b.state;
            throw new Error(`Unhandled state ${JSON.stringify(never)}`);
        }
    }
    let what: BookingViewDTO["what"];
    const w = b.what;
    switch (w.kind) {
        case "slot":
            what = { kind: "slot", serviceId: w.serviceId, serviceName: w.serviceName, start: iso(w.start), end: iso(w.end), timezone: settings.timezone };
            break;
        default: {
            const never: never = w.kind;
            throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
        }
    }
    const confirm = confirmDecision(b, now);
    return {
        ref: b.ref, state, ...(expiresAt !== undefined ? { expiresAt } : {}), what,
        who: { name: b.who.name, emailMasked: emailMasked(b.who.email) },
        can: {
            confirm: confirm.ok && confirm.value === "apply",
            cancel: changeDecision(b, now, settings.changeCutoffHours, "cancel", "customer").ok,
            move: changeDecision(b, now, settings.changeCutoffHours, "move", "customer").ok,
        },
        changeCutoff: iso(w.start - settings.changeCutoffHours * HOUR_MS),
    };
}
