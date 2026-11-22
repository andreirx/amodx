/**
 * SCHED-1G2 — pure helpers of the hosted booking pages that the BROWSER code uses (docs/slices/sched-1.md § 10.1,
 * § 8.2): the visitor DTOs as the renderer reads them (§ 10.2), the refusal-code → text table, `{placeholder}` filling,
 * time formatting in the tenant's zone, local-date arithmetic for the week view, and the link token read from the URL
 * fragment. No I/O, no React. The server half (page language, texts from the language packs) is `booking-text.ts`.
 *
 * NO RUNTIME IMPORT FROM `@amodx/shared` here (type-only imports are erased). Measured (build report, step 3): when the
 * booking tree's client components import `@amodx/shared` (its index re-exports every module), Turbopack regroups the
 * client chunks of EVERY existing page (2 more chunk files per page), which breaks the byte identity of existing tenant
 * pages (rows cm1-identity-*, sched1g-preserve). So `fillText` is a local copy of the shared `fillTemplate` rule.
 *
 * Abstraction line: this module — users: the book flow, the manage view and the pickers (browser), and the two server
 * pages (types); axis: none (one rule each); rejected: a copy of each helper in both pages.
 */
import type { CompleteLanguagePack } from "@amodx/shared";

/** Every booking text key (`packages/shared/src/language-packs/types.ts` `BookingStrings`). */
export type BookingTexts = CompleteLanguagePack["booking"];
export type BookingTextKey = keyof BookingTexts;

/**
 * Replaces each `{name}` of `template` with `String(values[name])`; a placeholder without a value stays as written.
 * The rule of `fillTemplate` (`packages/shared/src/locale-strings.ts`), copied for the reason in the header; the unit
 * test compares the two on the same inputs.
 */
export function fillText(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole);
}

// ── Visitor DTOs (§ 10.2, as the deployed backend answers them: backend/src/scheduling/visitor/*.ts) ──────────────
// Copies of the backend types, which the renderer cannot import. `BookingViewDTO.state` has no `"expired"`: the
// backend answers an expired hold with 410 `expired` on every route that returns a view (ruling S1D2-EXPIRED-VIEW = A,
// § 25); the backend type still lists it (backend/src/scheduling/visitor/dto.ts; this slice's allocation there is
// the slot `serviceId` only, ruling SCHED-1G2-SLOT-MOVE-ID = A).
export type LocalDate = string;
export type OfferDTO = {
    timezone: string;
    services: { id: string; name: string; durationMin: number }[];
    courses: { id: string; name: string; languages: string[] }[];
};
export type SlotsDTO = {
    timezone: string; serviceId: string; durationMin: number; lastBookableDate: LocalDate;
    days: { date: LocalDate; starts: string[] }[];
};
export type RunDTO = {
    runId: string; courseId: string; timezone: string; language: string | null;
    meetings: { date: LocalDate; start: string; end: string }[]; seatsLeft: number;
};
export type ProposalDTO = { kind: "proposed"; run: RunDTO; othersCount: number } | { kind: "choose"; runs: RunDTO[] } | { kind: "noneOpen" };
export type HoldResult =
    | { ref: string; state: "held"; expiresAt: string; emailMasked: string }
    | { ref: string; state: "confirmed"; emailMasked: string };
export type BookingViewDTO = {
    ref: string; state: "held" | "confirmed"; expiresAt?: string;
    what:
        | { kind: "slot"; serviceId: string; serviceName: string; start: string; end: string; timezone: string }
        | { kind: "seat"; courseName: string; run: Omit<RunDTO, "seatsLeft">; groupLink?: string }
        | { kind: "unplaced"; courseName: string; proposal: ProposalDTO };
    who: { name: string; emailMasked: string };
    can: { confirm: boolean; cancel: boolean; move: boolean };
    changeCutoff?: string;
};

// ── Refusal texts ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The visitor text of each refusal code (§ 10.2 visitor routes, § 8.4 link answers, the renderer proxy's own codes).
 * A code that is not listed (a future backend code, a broken answer, a network failure) → `errGeneric`.
 */
export const REFUSAL_TEXT: Readonly<Record<string, BookingTextKey>> = {
    // body, access, switch
    invalid: "errInvalid", tooLarge: "errInvalid", notAvailable: "errNotAvailable", forbidden: "errUnavailable",
    notFound: "errNotFound",
    // reCAPTCHA (§ 9.1) and the proxy's configuration answer
    verificationRequired: "errVerificationRequired", verificationFailed: "errVerificationFailed",
    verificationUnavailable: "errUnavailable", unavailable: "errUnavailable",
    // slot and seat decisions
    slotTaken: "errSlotTaken", notOnGrid: "errNotOnGrid", inPast: "errInPast", beyondHorizon: "errBeyondHorizon",
    notEligible: "errNotEligible", outsideAvailability: "errOutsideAvailability", resourceUnavailable: "errResourceUnavailable",
    runFull: "errRunFull", runClosed: "errRunClosed", runCancelled: "errRunCancelled", runStarted: "errRunStarted",
    languageMismatch: "errLanguageMismatch",
    // intent replay (§ 7.2) and limits (§ 9)
    intentReused: "errIntentReused", intentClosed: "errIntentClosed",
    tooManyForEmail: "errTooManyForEmail", tooManyFromAddress: "errTooManyFromAddress",
    busy: "errBusy", mailFailed: "errMailFailed",
    // link answers (§ 8.4)
    linkNotValid: "errLinkNotValid", expired: "errExpired", cancelled: "errCancelled", tooLate: "errTooLate",
    notConfirmed: "errNotConfirmed", paidContactTenant: "errPaidContactTenant", stale: "errStale",
    // slots range (a page defect, never a visitor input)
    rangeInverted: "errRange", rangeTooLong: "errRange",
    // server
    storedDataInvalid: "errServer", internal: "errServer",
};

/** The text key of a refusal code; unknown → `errGeneric`. */
export function refusalTextKey(code: string | undefined): BookingTextKey {
    return code !== undefined && Object.prototype.hasOwnProperty.call(REFUSAL_TEXT, code) ? REFUSAL_TEXT[code] : "errGeneric";
}

/**
 * S1G2-R4 — the recovery the page offers with a refusal. Rule: a refusal text that asks the visitor to act names an
 * action the page itself offers; no text asks to reload the browser page (the manage page keeps the link token in memory
 * only, so a reload would lose it).
 *  - `newBooking`: the booking or the form can no longer be used → a token-free way to start a new booking;
 *  - `refresh`: the booking changed meanwhile → read it again with the token kept in memory;
 *  - `none`: the text alone (the visitor corrects the input or tries again).
 */
export type RefusalRecovery = "newBooking" | "refresh" | "none";
export function refusalRecovery(code: string | undefined): RefusalRecovery {
    switch (code) {
        case "expired": case "intentReused": case "intentClosed": return "newBooking";
        case "stale": return "refresh";
        default: return "none";
    }
}

/**
 * The token-free address of a new booking from the page the visitor is on: the public base (`/_booking` on a domain,
 * `/_site/<id>/_booking` on a preview host) with the page's `lang` and `frame` parameters kept, nothing else.
 */
export function newBookingHref(location: { pathname: string; search: string }, base: string): string {
    const from = new URLSearchParams(location.search);
    const keep = new URLSearchParams();
    for (const name of ["lang", "frame"]) {
        const v = from.getAll(name);
        if (v.length === 1) keep.set(name, v[0]);
    }
    const qs = keep.toString();
    return `${base}${qs ? `?${qs}` : ""}`;
}

// ── Time ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A UTC instant (ISO text) as date and time in `timeZone`, e.g. "Mon, 1 Dec 2026, 10:00". */
export function formatInstant(iso: string, locale: string, timeZone: string): string {
    return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        .format(new Date(iso));
}

/** `formatInstant` followed by the zone's name, e.g. "Mon, 1 Dec 2026, 10:00 (Europe/Bucharest)" (§ 10.1: the zone is named). */
export function formatInstantWithZone(iso: string, locale: string, timeZone: string): string {
    return `${formatInstant(iso, locale, timeZone)} (${timeZone})`;
}

/** A UTC instant (ISO text) as the time of day in `timeZone`, e.g. "10:00". */
export function formatTime(iso: string, locale: string, timeZone: string): string {
    return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** A local date `YYYY-MM-DD` as a weekday and date, e.g. "Monday, 1 December 2026" (no zone: it is a calendar date). */
export function formatLocalDate(date: LocalDate, locale: string): string {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" })
        .format(new Date(`${date}T12:00:00Z`));
}

/** The local calendar date of `instant` (ms) in `timeZone`, as `YYYY-MM-DD`. */
export function localDateIn(instant: number, timeZone: string): LocalDate {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `date` plus `days` calendar days (negative allowed). */
export function addDays(date: LocalDate, days: number): LocalDate {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// ── The link token (§ 8.2) ─────────────────────────────────────────────────────────────────────────────────────────

/** § 8.1 token format: 32 random bytes, base64url without padding. */
export const LINK_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/**
 * Reads the link token from the URL fragment `#t=<token>` and REMOVES the fragment from the address bar
 * (`history.replaceState`, path and query kept), whatever the fragment holds. Returns the token, or `null` when there
 * is no fragment or its `t` is not in the token format (the page then shows "open the link from your email" without
 * a request). The token stays in the caller's memory only; it is sent in POST bodies, never in a URL.
 */
export function takeLinkToken(
    location: { hash: string; pathname: string; search: string },
    history: { replaceState(data: unknown, unused: string, url?: string): void },
): string | null {
    const hash = location.hash;
    if (hash === "" || hash === "#") return null;
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    const token = new URLSearchParams(hash.slice(1)).get("t");
    return token !== null && LINK_TOKEN_FORMAT.test(token) ? token : null;
}
