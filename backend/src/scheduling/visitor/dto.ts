/**
 * SCHED-1D2 — the visitor DTOs of docs/slices/sched-1.md § 10.2: `RunDTO`, `ProposalDTO`, `HoldResult`,
 * `BookingViewDTO`. Pure builders over stored records; the proposal is the kernel's `propose` (§ 5.4).
 *
 * Data rules (rows D5, D9): no answer carries a booking id or a link token; the availability DTOs (offer, slots, runs,
 * proposal) carry no resource id or name, no trainer, no email, phone or customer name — `seatsLeft` is a count. A
 * `BookingViewDTO` is shown only to the holder of that booking's link: it carries the booking's own `ref`, the
 * person's name and the MASKED email, never the resource.
 */
import { activeSeats, changeDecision, confirmDecision, propose, type Booking, type Course, type Instant, type Meeting, type RunLanguage } from "@amodx/shared";
import { iso, listRuns, type RunRecord, type SchedulingStore } from "../../lib/scheduling-db.js";
import type { Place, VisitorSettings } from "./common.js";

const HOUR_MS = 3_600_000;

export type RunDTO = {
    runId: string; courseId: string; timezone: string; language: string | null;
    meetings: { date: string; start: string; end: string }[]; seatsLeft: number;
};
export type ProposalDTO = { kind: "proposed"; run: RunDTO; othersCount: number } | { kind: "choose"; runs: RunDTO[] } | { kind: "noneOpen" };
export type HoldResult =
    | { ref: string; state: "held"; expiresAt: string; emailMasked: string }
    | { ref: string; state: "confirmed"; emailMasked: string };
export type BookingViewDTO = {
    ref: string; state: "held" | "confirmed" | "expired"; expiresAt?: string;
    what:
        | { kind: "slot"; serviceName: string; start: string; end: string; timezone: string }
        | { kind: "seat"; courseName: string; run: Omit<RunDTO, "seatsLeft">; groupLink?: string }
        | { kind: "unplaced"; courseName: string; proposal: ProposalDTO };
    who: { name: string; emailMasked: string };
    can: { confirm: boolean; cancel: boolean; move: boolean };
    changeCutoff?: string;
};

function languageTag(language: RunLanguage): string | null {
    switch (language.kind) {
        case "notSet": return null;
        case "set": return language.tag;
        default: {
            const never: never = language;
            throw new Error(`Unhandled language ${JSON.stringify(never)}`);
        }
    }
}

const meetingsDTO = (meetings: Meeting[]) => meetings.map((m) => ({ date: m.date, start: m.start, end: m.end }));

/** A run as a visitor sees it: no trainer, no group link, the free seats as a count. */
export function runDTO(run: RunRecord, now: Instant): RunDTO {
    return {
        runId: run.id, courseId: run.courseId, timezone: run.timezone, language: languageTag(run.language),
        meetings: meetingsDTO(run.meetings), seatsLeft: Math.max(0, run.capacity - activeSeats(run.seats, now)),
    };
}

/**
 * § 5.4 proposal for a person's language (absent = every language). `all` (`all=1`, § 10.2): `choose` with every
 * candidate the proposal considered (the proposed run and the others), by first meeting then run id — the order of
 * the kernel's `choose`.
 */
export function proposalDTO(runs: RunRecord[], personLanguage: string | undefined, all: boolean, now: Instant): ProposalDTO {
    const byId = new Map(runs.map((r) => [r.id, r]));
    const p = propose(runs.map((run) => ({ run, taken: activeSeats(run.seats, now), firstStart: Date.parse(run.firstStartIso) })), personLanguage, now);
    const dto = (id: string) => runDTO(byId.get(id) as RunRecord, now);
    switch (p.kind) {
        case "noneOpen": return { kind: "noneOpen" };
        case "choose": return { kind: "choose", runs: p.runs.map(dto) };
        case "proposed": {
            if (!all) return { kind: "proposed", run: dto(p.run), othersCount: p.others.length };
            const ordered = [p.run, ...p.others].map((id) => byId.get(id) as RunRecord)
                .sort((a, b) => a.firstStartIso.localeCompare(b.firstStartIso) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            return { kind: "choose", runs: ordered.map((r) => runDTO(r, now)) };
        }
        default: {
            const never: never = p;
            throw new Error(`Unhandled proposal ${JSON.stringify(never)}`);
        }
    }
}

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

/** The start the change window counts back from (§ 5.3): a slot's start, a seat's first meeting; none when unplaced. */
export function changeStart(b: Booking, place: Place): Instant | null {
    const what = b.what;
    switch (what.kind) {
        case "slot": return what.start;
        case "seat": return place.run !== undefined ? Date.parse(place.run.firstStartIso) : null;
        case "unplaced": return null;
        default: {
            const never: never = what;
            throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
        }
    }
}

/**
 * § 10.2 `BookingViewDTO` of an active-or-expired booking (a cancelled booking has no link, § 8.4). `state: "expired"`
 * = held and `now >= expiresAt` (derived, § 4.4); the page then offers a new booking. `can` comes from the kernel's
 * `confirmDecision` / `changeDecision` with the customer's rules. The proposal of an unplaced booking reads the
 * course's runs (AP4, display). `place` comes from `readPlace`, which guarantees the course (and the run of a seat).
 */
export async function bookingViewDTO(store: SchedulingStore, tenantId: string, b: Booking, place: Place,
    settings: VisitorSettings, now: Instant): Promise<BookingViewDTO> {
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
            what = { kind: "slot", serviceName: w.serviceName, start: iso(w.start), end: iso(w.end), timezone: settings.timezone };
            break;
        case "seat": {
            const run = place.run as RunRecord;
            const { seatsLeft: _left, ...visible } = runDTO(run, now);
            what = {
                kind: "seat", courseName: (place.course as Course).name, run: visible,
                ...(b.state.kind === "confirmed" && run.groupLink !== undefined ? { groupLink: run.groupLink } : {}),
            };
            break;
        }
        case "unplaced": {
            const runs = await listRuns(store, tenantId, w.courseId, false);
            what = { kind: "unplaced", courseName: (place.course as Course).name, proposal: proposalDTO(runs, b.who.language, false, now) };
            break;
        }
        default: {
            const never: never = w;
            throw new Error(`Unhandled booking ${JSON.stringify(never)}`);
        }
    }
    const start = changeStart(b, place);
    const confirm = confirmDecision(b, now);
    return {
        ref: b.ref, state, ...(expiresAt !== undefined ? { expiresAt } : {}), what,
        who: { name: b.who.name, emailMasked: emailMasked(b.who.email) },
        can: {
            confirm: confirm.ok && confirm.value === "apply",
            cancel: changeDecision(b, start, now, settings.changeCutoffHours, "cancel", "customer").ok,
            move: changeDecision(b, start, now, settings.changeCutoffHours, "move", "customer").ok,
        },
        ...(start !== null ? { changeCutoff: iso(start - settings.changeCutoffHours * HOUR_MS) } : {}),
    };
}
