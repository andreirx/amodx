/**
 * SCHED-1A (docs/slices/sched-1.md § 4, § 5) — the scheduling kernel: domain types, their Zod schemas, and the
 * pure rules of both booking shapes (a slot with a practitioner, a seat in a group) and of the week planner.
 * Maturity: PROTOTYPE (until `sched-1i` passes on staging, § 17).
 *
 * Pure: no I/O, no clock read, no ambient zone, no AWS, no framework. `now` and the zone are parameters. The
 * kernel DETECTS; the database ENFORCES (`scheduling-db.ts`, `sched-1c`, decides on its own consistent read with
 * these functions and writes under the versions of § 7).
 *
 * Every domain union is closed, and every `switch` over one ends in `assertNever`: a new variant fails the compile
 * at each site whose assumptions changed (§ 4; the guarantee holds because `npm run typecheck` is a gate).
 * Expected failures are `Result` errors with their context, never exceptions. A thrown error means a caller broke
 * a stated precondition (an input the boundary schema refuses).
 *
 * The types are inferred from the schemas, so one definition serves the stored item, the request body and the
 * kernel (§ 4: "the same Zod schemas validate stored items and request bodies"). Schemas strip unknown keys
 * (`z.object`), because a stored DynamoDB item also carries its `PK`/`SK`.
 */
import { z } from "zod";
import { normalizeEmail } from "./normalizeEmail.js";
import {
    type Instant, type LocalDate, type TimeZone, type Result,
    addDays, daysBetween, instantToLocal, isLocalDate, isLocalTime, isTimeZone, isoWeekday,
    localDaySpan, localToInstant, localToInstantOrGapEnd, minutesOfDay, timeOfMinutes,
} from "./zoned-time.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Bounds of § 4.5 that the kernel or the schemas apply.
const MAX_SLOT_RANGE_DAYS = 62;
const MAX_STORED_DAYS = 366;
const MAX_WINDOWS_PER_DAY = 8;
const KEPT_PAST_DAYS = 6; // overrides are kept from local today − 6 on (§ 5.5)
const MAX_HISTORY = 50;
const MAX_MEETINGS = 60;
const TOKEN_VIEW_DAYS = 30;

function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });

/** Ascending code-unit order ("lowest id in string order", § 5.2). */
function byCodeUnit(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A non-empty list by type (`[T, ...T[]]`, § 4) with an upper bound. Zod 4's `.nonempty()` does not narrow the
 * type, and a bare `z.tuple` reports `[]` as a missing element at index 0; so the length is checked as an array
 * (the issue names the list), then the checked list is rebuilt as a tuple (`min(1)` ran first, so `list[0]` exists).
 */
function nonEmptyList<T extends z.ZodType>(item: T, max: number) {
    return z.array(item).min(1, { message: "At least 1 item." }).max(max, { message: `At most ${max} items.` })
        .transform((list): [z.output<T>, ...z.output<T>[]] => [list[0], ...list.slice(1)]);
}

// ---------------------------------------------------------------------------------------------------------------
// Time values (§ 4)
// ---------------------------------------------------------------------------------------------------------------

export const InstantSchema = z.number().int().nonnegative();
export const LocalDateSchema = z.string().refine(isLocalDate, { message: "Must be a real date YYYY-MM-DD." });
export const LocalTimeSchema = z.string().refine(isLocalTime, { message: "Must be a time HH:MM from 00:00 to 23:59." });
export const TimeZoneSchema = z.string().refine(isTimeZone, { message: "Must be an IANA time zone name." });
/** A local time on the 5-minute admin grid (§ 4.2: windows of one day have 5-minute boundaries). */
const GridTimeSchema = LocalTimeSchema.refine((t) => !isLocalTime(t) || minutesOfDay(t) % 5 === 0, {
    message: "Must be on a 5-minute boundary.",
});

// ---------------------------------------------------------------------------------------------------------------
// Appointment side (§ 4.2)
// ---------------------------------------------------------------------------------------------------------------

const IdSchema = z.string().min(1);
const NameSchema = z.string().min(1).max(200);
const NoteSchema = z.string().max(200);

/** § 4.2 resource guard: `retiring` present = a removal attempt holds the fence (§ 13). */
export const ResourceSchema = z.object({
    id: IdSchema,
    name: NameSchema,
    feedSecretHash: z.string().optional(),
    retiring: z.object({ attemptId: IdSchema, at: InstantSchema }).optional(),
});
export type Resource = z.infer<typeof ResourceSchema>;

/** D2: "all" and "this list" exclude each other; the list is non-empty by type. */
export const EligibilitySchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("all") }),
    z.object({ kind: z.literal("only"), resourceIds: z.tuple([IdSchema], IdSchema) }),
]);
export type Eligibility = z.infer<typeof EligibilitySchema>;

export const ServiceSchema = z.object({
    id: IdSchema,
    name: NameSchema,
    durationMin: z.number().int().min(5).max(480).multipleOf(5),
    eligibility: EligibilitySchema,
});
export type Service = z.infer<typeof ServiceSchema>;

/** D3: one weekly window in local wall time; `weekday` is ISO (Monday 1 … Sunday 7). */
export const AvailabilityRuleSchema = z.object({
    weekday: z.literal([1, 2, 3, 4, 5, 6, 7]),
    start: LocalTimeSchema,
    end: LocalTimeSchema,
}).refine((r) => !isLocalTime(r.start) || !isLocalTime(r.end) || minutesOfDay(r.end) > minutesOfDay(r.start), {
    message: "End must be after start.", path: ["end"],
});
export type AvailabilityRule = z.infer<typeof AvailabilityRuleSchema>;
/** The defaults of one resource (`AVAILABILITY#<r>.rules`, ≤ 50, § 4.5). */
export const AvailabilityRulesSchema = z.array(AvailabilityRuleSchema).max(50);

export const LocalWindowSchema = z.object({ start: GridTimeSchema, end: GridTimeSchema })
    .refine((w) => !isLocalTime(w.start) || !isLocalTime(w.end) || minutesOfDay(w.end) > minutesOfDay(w.start), {
        message: "End must be after start.", path: ["end"],
    });
export type LocalWindow = z.infer<typeof LocalWindowSchema>;

/** § 4.2: the windows of one day are sorted and do not overlap (half-open: 09:00-12:00 and 12:00-13:00 touch). */
const DayWindowsSchema = nonEmptyList(LocalWindowSchema, MAX_WINDOWS_PER_DAY).superRefine((windows, ctx) => {
    for (let i = 1; i < windows.length; i++) {
        const prev = windows[i - 1];
        const cur = windows[i];
        if (![prev.start, prev.end, cur.start, cur.end].every(isLocalTime)) return; // field issues already raised
        if (minutesOfDay(cur.start) < minutesOfDay(prev.start)) {
            ctx.addIssue({ code: "custom", path: [i, "start"], message: "Windows must be sorted by start." });
        } else if (minutesOfDay(cur.start) < minutesOfDay(prev.end)) {
            ctx.addIssue({ code: "custom", path: [i, "start"], message: "Windows must not overlap." });
        }
    }
});

const DayOffSchema = z.object({ kind: z.literal("dayOff"), note: NoteSchema.optional() });
const DayHoursSchema = z.object({ kind: z.literal("dayHours"), windows: DayWindowsSchema, note: NoteSchema.optional() });

/** D16, § 23.2: replaces the defaults of one local date. `dayHours` is non-empty, so "no hours" is only `dayOff`. */
export const DayOverrideSchema = z.discriminatedUnion("kind", [DayOffSchema, DayHoursSchema]);
export type DayOverride = z.infer<typeof DayOverrideSchema>;

/** `DAYS#<r>.days`: a date with no key follows the defaults; ≤ 366 keys (§ 4.5); each key a real date. */
export const DayOverridesSchema = z.record(LocalDateSchema, DayOverrideSchema)
    .refine((days) => Object.keys(days).length <= MAX_STORED_DAYS, { message: `At most ${MAX_STORED_DAYS} dates.` });
export type DayOverrides = z.infer<typeof DayOverridesSchema>;

/** § 5.5: `DayOverride | { kind: "default" }` — what a day edit sets; `default` removes the override of that date. */
export const DaySettingSchema = z.discriminatedUnion("kind", [...DayOverrideSchema.options, z.object({ kind: z.literal("default") })]);
export type DaySetting = z.infer<typeof DaySettingSchema>;

/** § 5.5: a range edit (≤ 366 dates, checked by `editDays`) or a copy of one week onto 1-52 next weeks (§ 4.5). */
export const DaysEditSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("set"), from: LocalDateSchema, to: LocalDateSchema, value: DaySettingSchema }),
    z.object({
        kind: z.literal("copyWeek"), sourceStart: LocalDateSchema, targetStart: LocalDateSchema,
        weeks: z.number().int().min(1).max(52),
    }),
]);
export type DaysEdit = z.infer<typeof DaysEditSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Group side (§ 4.3)
// ---------------------------------------------------------------------------------------------------------------

const LanguageTagSchema = z.string().min(1);
/** Run capacity 1-45 (SCHED-SEAT-BOUND = A, § 4.5). A course's default capacity is a run's capacity, same bound. */
const CapacitySchema = z.number().int().min(1).max(45);

export const CourseSchema = z.object({
    id: IdSchema,
    name: NameSchema,
    defaultCapacity: CapacitySchema,
    languages: z.array(LanguageTagSchema).max(10),
});
export type Course = z.infer<typeof CourseSchema>;

/** D4: one meeting in the run's zone, on one local day. Order, overlap and existence are `validateMeetings`. */
export const MeetingSchema = z.object({ date: LocalDateSchema, start: LocalTimeSchema, end: LocalTimeSchema })
    .refine((m) => !isLocalTime(m.start) || !isLocalTime(m.end) || minutesOfDay(m.end) > minutesOfDay(m.start), {
        message: "End must be after start.", path: ["end"],
    });
export type Meeting = z.infer<typeof MeetingSchema>;

/** D7: not known at first, then one tag. */
export const RunLanguageSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("notSet") }),
    z.object({ kind: z.literal("set"), tag: LanguageTagSchema }),
]);
export type RunLanguage = z.infer<typeof RunLanguageSchema>;

export const RunStatusSchema = z.enum(["open", "closed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

const HttpsUrlSchema = z.string().max(500).refine((value) => {
    try {
        return new URL(value).protocol === "https:";
    } catch {
        return false;
    }
}, { message: "Must be an https: URL." });

export const RunSchema = z.object({
    id: IdSchema,
    courseId: IdSchema,
    meetings: nonEmptyList(MeetingSchema, MAX_MEETINGS),
    timezone: TimeZoneSchema,
    capacity: CapacitySchema,
    trainerIds: nonEmptyList(IdSchema, 10),
    language: RunLanguageSchema,
    groupLink: HttpsUrlSchema.optional(),
    status: RunStatusSchema,
});
export type Run = z.infer<typeof RunSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Booking (§ 4.4)
// ---------------------------------------------------------------------------------------------------------------

const EmailSchema = z.string().email();

export const BookingWhatSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("slot"), serviceId: IdSchema, serviceName: NameSchema, resourceId: IdSchema, start: InstantSchema, end: InstantSchema }),
    z.object({ kind: z.literal("seat"), courseId: IdSchema, runId: IdSchema }),
    z.object({ kind: z.literal("unplaced"), courseId: IdSchema }),
]);
export type BookingWhat = z.infer<typeof BookingWhatSchema>;

/** Who acted on a booking: the customer (by link token only) or an admin (by email). */
export const ActorSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("customer") }),
    z.object({ kind: z.literal("admin"), email: EmailSchema }),
]);
export type Actor = z.infer<typeof ActorSchema>;

/** "Expired" is not a state: it is `held` with `now >= expiresAt` (derived). */
export const BookingStateSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("held"), expiresAt: InstantSchema, mail: z.enum(["pending", "sent", "failed"]) }),
    z.object({ kind: z.literal("confirmed"), at: InstantSchema }),
    z.object({ kind: z.literal("cancelled"), at: InstantSchema, by: ActorSchema }),
]);
export type BookingState = z.infer<typeof BookingStateSchema>;

export const PlacementSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("slot"), resourceId: IdSchema, start: InstantSchema, end: InstantSchema }),
    z.object({ kind: z.literal("seat"), runId: IdSchema }),
    z.object({ kind: z.literal("unplaced") }),
]);
export type Placement = z.infer<typeof PlacementSchema>;

/** SCHED-AUDIT-PII = C (§ 22 point 1): one entry per change of `what` or `state`. */
export const HistoryEntrySchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("created"), at: InstantSchema, state: z.enum(["held", "confirmed"]), placement: PlacementSchema }),
    z.object({ action: z.literal("confirmed"), at: InstantSchema }),
    z.object({ action: z.literal("cancelled"), at: InstantSchema, by: ActorSchema }),
    z.object({ action: z.literal("moved"), at: InstantSchema, by: ActorSchema, from: PlacementSchema, to: PlacementSchema }),
]);
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const BookingSourceSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("visitor") }),
    z.object({ kind: z.literal("order"), orderId: IdSchema, line: z.number().int().nonnegative() }),
    z.object({ kind: z.literal("manual"), adminEmail: EmailSchema, channel: z.string().min(1).max(40) }),
]);
export type BookingSource = z.infer<typeof BookingSourceSchema>;

/**
 * PD-001: the email is normalized first and validated after (`normalizeEmail` ordering rule), so the stored value
 * is the validated one. Parsing a raw request email yields the normalized form; a stored one parses unchanged.
 */
export const PersonSchema = z.object({
    email: z.string().transform(normalizeEmail).pipe(EmailSchema),
    name: NameSchema,
    phone: z.string().max(40).optional(),
    language: LanguageTagSchema.optional(),
});
export type Person = z.infer<typeof PersonSchema>;

/**
 * The stored `BOOKING#` record. `history` is non-empty (the creating Put writes one entry and no write removes the
 * last one) and holds at most 50 entries; after truncation it need not start with `created` (§ 4.4).
 */
export const BookingSchema = z.object({
    id: IdSchema,
    ref: z.string().regex(/^B-[0-9A-F]{8}$/),
    rev: z.number().int().min(1),
    what: BookingWhatSchema,
    state: BookingStateSchema,
    source: BookingSourceSchema,
    who: PersonSchema,
    tokenHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(20),
    intentId: IdSchema.optional(),
    heldUntil: InstantSchema.optional(),
    reminderSentFor: InstantSchema.optional(),
    createdAt: InstantSchema,
    updatedAt: InstantSchema,
    history: z.array(HistoryEntrySchema).min(1).max(MAX_HISTORY),
});
export type Booking = z.infer<typeof BookingSchema>;

/** One value of `RESDAY#<r>#<utcDate>.entries` (§ 6.2): `x` present = held until `x`; `rev` = the booking's `rev`. */
export const ResDayEntrySchema = z.object({ s: InstantSchema, e: InstantSchema, x: InstantSchema.optional(), rev: z.number().int().min(1) });
/** A `RESDAY#` entry with its map key, as the kernel reads it (§ 5). */
export type ContainerEntry = z.infer<typeof ResDayEntrySchema> & { bookingId: string };

/** One value of `RUN#.seats` (§ 6.2): `x` present = held until `x`; absent = confirmed. */
export const SeatEntrySchema = z.object({ x: InstantSchema.optional() });
export type SeatEntry = z.infer<typeof SeatEntrySchema>;

// ---------------------------------------------------------------------------------------------------------------
// Tenant settings (§ 4.1). Referenced by `TenantConfigSchema` in index.ts as OPTIONAL fields with no top-level
// default: a tenant without them parses exactly as before. Absent `schedulingEnabled` = off.
// ---------------------------------------------------------------------------------------------------------------

export const SchedulingSettingsSchema = z.object({
    /** No default: a default zone would shift every time of a tenant elsewhere. Enabling without it → 400 (`sched-1d`). */
    timezone: TimeZoneSchema.optional(),
    holdMinutes: z.number().int().min(5).max(1440).default(30),
    changeCutoffHours: z.number().int().min(0).max(168).default(24),
    reminderHours: z.number().int().min(0).max(168).default(24),
    bookingHorizonWeeks: z.number().int().min(1).max(52).default(8),
});
export type SchedulingSettings = z.infer<typeof SchedulingSettingsSchema>;

/** The seven mail keys of § 11.1. Defaults and the sending rules per key live in `scheduling-email.ts` (`sched-1d`). */
export const SchedulingEmailKeySchema = z.enum(["hold", "confirmed", "cancelled", "moved", "unplaced", "reminder", "weekAhead"]);
export type SchedulingEmailKey = z.infer<typeof SchedulingEmailKeySchema>;

/** A tenant override of one mail. An absent `sendTo…` means the key's default (no schema default here, § 11.1 `weekAhead`). */
export const SchedulingEmailTemplateSchema = z.object({
    subject: z.string(),
    body: z.string(),
    sendToCustomer: z.boolean().optional(),
    sendToAdmin: z.boolean().optional(),
});
export type SchedulingEmailTemplate = z.infer<typeof SchedulingEmailTemplateSchema>;

export const SchedulingEmailConfigSchema = z.object({
    templates: z.partialRecord(SchedulingEmailKeySchema, SchedulingEmailTemplateSchema).default({}),
});
export type SchedulingEmailConfig = z.infer<typeof SchedulingEmailConfigSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers of the rules
// ---------------------------------------------------------------------------------------------------------------

type Span = { start: number; end: number };

function entryActive(entry: { x?: Instant }, now: Instant): boolean {
    return entry.x === undefined || now < entry.x;
}

function isEligible(eligibility: Eligibility, resourceId: string): boolean {
    switch (eligibility.kind) {
        case "all": return true;
        case "only": return eligibility.resourceIds.includes(resourceId);
        default: return assertNever(eligibility);
    }
}

/** A window of `date` as instants; bounds in a spring gap move to the gap's end. `null` when nothing of it exists. */
function windowInstants(date: LocalDate, window: LocalWindow, tz: TimeZone): Span | null {
    const start = localToInstantOrGapEnd(date, window.start, tz);
    const end = localToInstantOrGapEnd(date, window.end, tz);
    return end > start ? { start, end } : null;
}

/** `base` minus every interval of `cuts` (half-open), sorted by start. Works on minutes and on instants. */
function subtract(base: Span[], cuts: Span[]): Span[] {
    let pieces = base.map((b) => ({ start: b.start, end: b.end }));
    for (const cut of cuts) {
        const next: Span[] = [];
        for (const p of pieces) {
            if (cut.end <= p.start || p.end <= cut.start) {
                next.push(p);
                continue;
            }
            if (p.start < cut.start) next.push({ start: p.start, end: cut.start });
            if (cut.end < p.end) next.push({ start: cut.end, end: p.end });
        }
        pieces = next;
    }
    return pieces.sort((a, b) => a.start - b.start);
}

/**
 * The ONE grid rule (used by `availableSlots` and `slotDecision`): the grid points of one resource on one local
 * date, busy intervals and `now` aside, each with whether its slot FITS its window. Grid membership and fit are two
 * separate facts (review R4): `slotDecision` refuses a grid point that does not fit as `outsideAvailability`, and
 * keeps `notOnGrid` for a start that is not a grid point. Each window gives the wall times `windowStart + k ×
 * duration` with a wall start inside the window; a start whose local time does not exist is dropped; an ambiguous
 * one is the earlier instant.
 *
 * Containment rule (review R1): `start + duration <= windowEnd` is checked on INSTANTS against the window's instant
 * span (`windowInstants`, the same conversion `planDay` uses), never on wall minutes. On a day with a clock change
 * the wall difference and the elapsed time differ: Bucharest 2027-03-28 02:30-04:30 lasts one hour, so a 120-minute
 * slot from 02:30 would end at 05:30 local. Wall minutes only place the grid (grid points with a wall start inside
 * the window); the instant check alone decides the fit. On a day with no clock change both measures are equal.
 */
function gridPoints(rules: AvailabilityRule[], override: DayOverride | undefined, date: LocalDate, durationMin: number,
    tz: TimeZone): { start: Instant; fits: boolean }[] {
    const points = new Map<Instant, boolean>(); // start → fits (in at least one window)
    const durationMs = durationMin * MINUTE_MS;
    for (const w of dayWindows(rules, override, date).windows) {
        const span = windowInstants(date, w, tz);
        if (span === null) continue;
        const end = minutesOfDay(w.end);
        for (let m = minutesOfDay(w.start); m < end; m += durationMin) {
            const at = localToInstant(date, timeOfMinutes(m), tz);
            if (!at.ok) continue;
            const fits = span.start <= at.value && at.value + durationMs <= span.end;
            points.set(at.value, (points.get(at.value) ?? false) || fits);
        }
    }
    return [...points].sort(([a], [b]) => a - b).map(([start, fits]) => ({ start, fits }));
}

// ---------------------------------------------------------------------------------------------------------------
// Appointment shape (§ 5.2)
// ---------------------------------------------------------------------------------------------------------------

export type SlotRefusal =
    | { kind: "inPast" }
    | { kind: "beyondHorizon"; lastBookableDate: LocalDate }
    | { kind: "notEligible" }
    | { kind: "resourceUnavailable" }
    | { kind: "notOnGrid" }
    | { kind: "outsideAvailability" };

/**
 * § 5.2 slots offered to a visitor. One element per local day `from`…`to` (days after `lastBookableDate` have no
 * starts). A fenced resource (`retiring` present) offers nothing: its hold would fail the resource guard, and
 * `slotDecision` refuses it (`resourceUnavailable`).
 */
export function availableSlots(input: {
    service: Service; resources: Resource[]; rules: Record<string, AvailabilityRule[]>;
    days: Record<string, DayOverrides>; busy: { resourceId: string; start: Instant; end: Instant }[];
    from: LocalDate; to: LocalDate; lastBookableDate: LocalDate; tz: TimeZone; now: Instant;
}): Result<{ day: LocalDate; starts: { start: Instant; freeResourceIds: string[] }[] }[],
    { kind: "rangeInverted" } | { kind: "rangeTooLong"; maxDays: 62 }> {
    const { service, resources, rules, days, busy, from, to, lastBookableDate, tz, now } = input;
    if (from > to) return err({ kind: "rangeInverted" });
    if (daysBetween(from, to) + 1 > MAX_SLOT_RANGE_DAYS) return err({ kind: "rangeTooLong", maxDays: 62 });

    const eligible = resources
        .filter((r) => isEligible(service.eligibility, r.id) && r.retiring === undefined)
        .map((r) => r.id)
        .sort(byCodeUnit);
    const durationMs = service.durationMin * MINUTE_MS;
    const out: { day: LocalDate; starts: { start: Instant; freeResourceIds: string[] }[] }[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
        const free = new Map<Instant, string[]>();
        if (day <= lastBookableDate) {
            for (const resourceId of eligible) {
                const own = busy.filter((b) => b.resourceId === resourceId);
                for (const { start, fits } of gridPoints(rules[resourceId] ?? [], days[resourceId]?.[day], day, service.durationMin, tz)) {
                    if (!fits) continue;
                    const end = start + durationMs;
                    if (start <= now) continue;
                    if (own.some((b) => start < b.end && b.start < end)) continue;
                    free.set(start, [...(free.get(start) ?? []), resourceId]);
                }
            }
        }
        const starts = [...free].sort(([a], [b]) => a - b).map(([start, freeResourceIds]) => ({ start, freeResourceIds }));
        out.push({ day, starts });
    }
    return ok(out);
}

/**
 * § 5.2 re-check of a visitor's start at write time (holds and visitor moves). Checks in the spec's order: past,
 * horizon, eligibility, fence, then the grid of the start's local date. Busy intervals are not checked here (the
 * container's `overlapCheck` does it). Grid classification (review R4): a grid point whose slot fits → accepted; a
 * grid point whose slot overruns its window → `outsideAvailability`; a start inside a window that is not a grid
 * point → `notOnGrid`; any other start → `outsideAvailability`.
 */
export function slotDecision(input: {
    service: Service; resource: Resource; rules: AvailabilityRule[]; days: DayOverrides;
    start: Instant; lastBookableDate: LocalDate; tz: TimeZone; now: Instant;
}): Result<{ end: Instant }, SlotRefusal> {
    const { service, resource, rules, days, start, lastBookableDate, tz, now } = input;
    if (start <= now) return err({ kind: "inPast" });
    const local = instantToLocal(start, tz);
    if (local.date > lastBookableDate) return err({ kind: "beyondHorizon", lastBookableDate });
    if (!isEligible(service.eligibility, resource.id)) return err({ kind: "notEligible" });
    if (resource.retiring !== undefined) return err({ kind: "resourceUnavailable" });
    const override = days[local.date] as DayOverride | undefined;
    const point = gridPoints(rules, override, local.date, service.durationMin, tz).find((p) => p.start === start);
    if (point !== undefined) {
        // On the grid: accepted when the slot fits its window in elapsed time, else the time is not available.
        return point.fits ? ok({ end: start + service.durationMin * MINUTE_MS }) : err({ kind: "outsideAvailability" });
    }
    const insideAWindow = dayWindows(rules, override, local.date).windows.some((w) => {
        const span = windowInstants(local.date, w, tz);
        return span !== null && span.start <= start && start < span.end;
    });
    return err(insideAWindow ? { kind: "notOnGrid" } : { kind: "outsideAvailability" });
}

/** § 5.2: the candidate overlaps an active entry (held unexpired or confirmed) other than `self`. Half-open. */
export function overlapCheck(candidate: { start: Instant; end: Instant }, entries: ContainerEntry[], now: Instant,
    self?: string): Result<void, { kind: "overlap"; bookingId: string }> {
    for (const entry of entries) {
        if (entry.bookingId === self || !entryActive(entry, now)) continue;
        if (candidate.start < entry.e && entry.s < candidate.end) return err({ kind: "overlap", bookingId: entry.bookingId });
    }
    return ok(undefined);
}

/** § 5.2 "any available": the lowest id in string order. Precondition: the list is not empty (`availableSlots` never lists a start with no free resource). */
export function pickResource(freeResourceIds: string[]): string {
    if (freeResourceIds.length === 0) throw new RangeError("pickResource needs at least one free resource");
    return [...freeResourceIds].sort(byCodeUnit)[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Common rules (§ 5.3)
// ---------------------------------------------------------------------------------------------------------------

export type ConfirmRefusal = { kind: "expired"; at: Instant } | { kind: "cancelled" };
export type ChangeRefusal =
    | { kind: "tooLate"; cutoff: Instant }
    | { kind: "notActive"; state: "expired" | "cancelled" }
    | { kind: "notConfirmed" }
    | { kind: "paidContactTenant" };

/** Held and not expired, or confirmed. */
export function isActive(state: BookingState, now: Instant): boolean {
    switch (state.kind) {
        case "held": return now < state.expiresAt;
        case "confirmed": return true;
        case "cancelled": return false;
        default: return assertNever(state);
    }
}

export function holdExpiry(now: Instant, holdMinutes: number): Instant {
    return now + holdMinutes * MINUTE_MS;
}

/** § 5.3 confirm: held and `now < expiresAt` → apply; confirmed → noop; held expired → `expired`; cancelled → `cancelled`. */
export function confirmDecision(b: Booking, now: Instant): Result<"apply" | "noop", ConfirmRefusal> {
    const state = b.state;
    switch (state.kind) {
        case "held": return now < state.expiresAt ? ok("apply") : err({ kind: "expired", at: state.expiresAt });
        case "confirmed": return ok("noop");
        case "cancelled": return err({ kind: "cancelled" });
        default: return assertNever(state);
    }
}

/**
 * The start the customer's change window counts back from: a slot's own start; for a seat, `startOf` (the run's
 * first meeting, read by the caller from `RUN#`); none for `unplaced` ("always inside the window").
 */
function changeWindowStart(what: BookingWhat, startOf: Instant | null): Instant | null {
    switch (what.kind) {
        case "slot": return what.start;
        case "seat": return startOf;
        case "unplaced": return null;
        default: return assertNever(what);
    }
}

/** § 5.3, the same for customer and admin: cancel any active booking; move only a confirmed one. */
function actionAllowed(action: "cancel" | "move", confirmed: boolean): Result<void, ChangeRefusal> {
    switch (action) {
        case "cancel": return ok(undefined);
        case "move": return confirmed ? ok(undefined) : err({ kind: "notConfirmed" });
        default: return assertNever(action);
    }
}

/**
 * § 5.3 customer change (link) and admin change. A booking that is not active (cancelled, or held and expired) is
 * refused for every actor. Customer: an `order` booking → `paidContactTenant`; a move needs `confirmed`; both before
 * `start − cutoffHours`. Admin: cancel any active booking; move confirmed bookings (an unplaced booking is
 * confirmed); no time window.
 *
 * Every decision here dispatches by `switch` with `assertNever` (review R2): state, actor, action and source. A
 * new variant of any of them fails the compile here instead of taking an `else` branch.
 */
export function changeDecision(b: Booking, startOf: Instant | null, now: Instant, cutoffHours: number,
    action: "cancel" | "move", actor: "customer" | "admin"): Result<void, ChangeRefusal> {
    const state = b.state;
    let confirmed: boolean;
    switch (state.kind) {
        case "cancelled": return err({ kind: "notActive", state: "cancelled" });
        case "held":
            if (now >= state.expiresAt) return err({ kind: "notActive", state: "expired" });
            confirmed = false;
            break;
        case "confirmed":
            confirmed = true;
            break;
        default: return assertNever(state);
    }
    switch (actor) {
        case "admin": return actionAllowed(action, confirmed);
        case "customer": {
            const source = b.source;
            switch (source.kind) {
                case "order": return err({ kind: "paidContactTenant" });
                case "visitor":
                case "manual": break;
                default: return assertNever(source);
            }
            const allowed = actionAllowed(action, confirmed);
            if (!allowed.ok) return allowed;
            const start = changeWindowStart(b.what, startOf);
            if (start !== null) {
                const cutoff = start - cutoffHours * HOUR_MS;
                if (now >= cutoff) return err({ kind: "tooLate", cutoff });
            }
            return ok(undefined);
        }
        default: return assertNever(actor);
    }
}

/** The end the link's 30 days count from: a slot's end; for a seat, `endOf` (the run's last meeting end); none for `unplaced`. */
function viewEnd(what: BookingWhat, endOf: Instant | null): Instant | null {
    switch (what.kind) {
        case "slot": return what.end;
        case "seat": return endOf;
        case "unplaced": return null;
        default: return assertNever(what);
    }
}

/** § 5.3 token view: valid while not cancelled and `now < end + 30 days`; `unplaced` is valid while unplaced. */
export function tokenView(b: Booking, endOf: Instant | null, now: Instant): "valid" | "gone" {
    switch (b.state.kind) {
        case "cancelled": return "gone";
        case "held":
        case "confirmed": break;
        default: return assertNever(b.state);
    }
    const end = viewEnd(b.what, endOf);
    return end === null || now < end + TOKEN_VIEW_DAYS * DAY_MS ? "valid" : "gone";
}

/** § 4.4: `h` + `e`, keeping the newest 50 (the oldest is dropped). */
export function appendHistory(h: HistoryEntry[], e: HistoryEntry): HistoryEntry[] {
    const next = [...h, e];
    return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/**
 * § 5.3 link base: `https://<domain>` when `domain` is set (non-empty) and does not end with `.localhost` (the
 * placeholder of tenant creation, G7); else `<cloudFrontOrigin>/_site/<id>`.
 */
export function bookingBase(tenant: { id: string; domain?: string }, cloudFrontOrigin: string): string {
    const domain = tenant.domain;
    if (domain !== undefined && domain !== "" && !domain.endsWith(".localhost")) return `https://${domain}`;
    return `${cloudFrontOrigin}/_site/${tenant.id}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Group shape (§ 5.4)
// ---------------------------------------------------------------------------------------------------------------

export type SeatRefusal =
    | { kind: "runCancelled" }
    | { kind: "runClosed" }
    | { kind: "runStarted" }
    | { kind: "runFull"; capacity: number }
    | { kind: "languageMismatch"; run: string; person: string };

export type Proposal =
    | { kind: "proposed"; run: string; others: string[] }
    | { kind: "choose"; runs: string[] }
    | { kind: "noneOpen" };

export type MeetingError =
    | { kind: "empty" }
    | { kind: "endNotAfterStart"; index: number }
    | { kind: "overlap"; a: number; b: number }
    | { kind: "nonexistentLocalTime"; index: number }
    | { kind: "tooMany"; max: 60 };

/** Held unexpired + confirmed seats, without `excluding`. */
export function activeSeats(seats: Record<string, SeatEntry>, now: Instant, excluding?: string): number {
    return Object.entries(seats).filter(([id, seat]) => id !== excluding && entryActive(seat, now)).length;
}

/**
 * § 5.4 seats. Visitor: refused when cancelled, closed, started (`now >= firstStart`), full, or the language is
 * incompatible (a run `set` to another tag than the person's; no person language fits every run). Admin: refused
 * only when cancelled or full, and never changes the language.
 */
export function seatDecision(run: Run, seatsTaken: number, firstStart: Instant, person: Person,
    actor: "visitor" | "admin", now: Instant): Result<{ languageAfter: RunLanguage }, SeatRefusal> {
    switch (actor) {
        case "visitor": {
            switch (run.status) {
                case "cancelled": return err({ kind: "runCancelled" });
                case "closed": return err({ kind: "runClosed" });
                case "open": break;
                default: return assertNever(run.status);
            }
            if (now >= firstStart) return err({ kind: "runStarted" });
            if (seatsTaken >= run.capacity) return err({ kind: "runFull", capacity: run.capacity });
            const language = run.language;
            switch (language.kind) {
                case "notSet":
                    return ok({ languageAfter: person.language === undefined ? language : { kind: "set", tag: person.language } });
                case "set":
                    if (person.language !== undefined && person.language !== language.tag) {
                        return err({ kind: "languageMismatch", run: language.tag, person: person.language });
                    }
                    return ok({ languageAfter: language });
                default: return assertNever(language);
            }
        }
        case "admin": {
            switch (run.status) {
                case "cancelled": return err({ kind: "runCancelled" });
                case "closed":
                case "open": break;
                default: return assertNever(run.status);
            }
            if (seatsTaken >= run.capacity) return err({ kind: "runFull", capacity: run.capacity });
            return ok({ languageAfter: run.language });
        }
        default: return assertNever(actor);
    }
}

/** § 4.3: only an `open` run takes new visitor seats (`closed` stops them; `cancelled` is final). */
function offeredToVisitors(status: RunStatus): boolean {
    switch (status) {
        case "open": return true;
        case "closed":
        case "cancelled": return false;
        default: return assertNever(status);
    }
}

function languageFits(language: RunLanguage, personLanguage: string | undefined): boolean {
    switch (language.kind) {
        case "notSet": return true;
        case "set": return personLanguage === undefined || language.tag === personLanguage;
        default: return assertNever(language);
    }
}

/**
 * § 5.4 proposal (D6, D7). Candidates: open, not started, not full, language compatible. With a partly filled
 * candidate: the most taken, then the earliest first meeting, then the lowest id; `others` = the other candidates
 * by first meeting. With only empty candidates: `choose` them all by first meeting.
 */
export function propose(runs: { run: Run; taken: number; firstStart: Instant }[], personLanguage: string | undefined,
    now: Instant): Proposal {
    const candidates = runs.filter((c) => offeredToVisitors(c.run.status) && now < c.firstStart && c.taken < c.run.capacity
        && languageFits(c.run.language, personLanguage));
    if (candidates.length === 0) return { kind: "noneOpen" };
    const byFirstMeeting = [...candidates].sort((a, b) => a.firstStart - b.firstStart || byCodeUnit(a.run.id, b.run.id));
    const partlyFilled = candidates.filter((c) => c.taken > 0);
    if (partlyFilled.length === 0) return { kind: "choose", runs: byFirstMeeting.map((c) => c.run.id) };
    const best = [...partlyFilled].sort((a, b) => b.taken - a.taken || a.firstStart - b.firstStart || byCodeUnit(a.run.id, b.run.id))[0];
    return { kind: "proposed", run: best.run.id, others: byFirstMeeting.filter((c) => c !== best).map((c) => c.run.id) };
}

/**
 * § 5.4 meetings: 1-60, each `end > start`, each local time exists, no overlap (as instants in `tz`); sorted by
 * start on output. Indexes in errors are positions in the input list.
 */
export function validateMeetings(m: Meeting[], tz: TimeZone): Result<[Meeting, ...Meeting[]], MeetingError> {
    if (m.length === 0) return err({ kind: "empty" });
    if (m.length > MAX_MEETINGS) return err({ kind: "tooMany", max: 60 });
    const spans: { index: number; start: Instant; end: Instant }[] = [];
    for (let index = 0; index < m.length; index++) {
        const meeting = m[index];
        if (minutesOfDay(meeting.end) <= minutesOfDay(meeting.start)) return err({ kind: "endNotAfterStart", index });
        const start = localToInstant(meeting.date, meeting.start, tz);
        const end = localToInstant(meeting.date, meeting.end, tz);
        if (!start.ok || !end.ok) return err({ kind: "nonexistentLocalTime", index });
        spans.push({ index, start: start.value, end: end.value });
    }
    spans.sort((a, b) => a.start - b.start || a.index - b.index);
    for (let k = 1; k < spans.length; k++) {
        if (spans[k].start < spans[k - 1].end) return err({ kind: "overlap", a: spans[k - 1].index, b: spans[k].index });
    }
    const sorted = spans.map((s) => m[s.index]);
    return ok([sorted[0], ...sorted.slice(1)]);
}

/** § 5.4 cancel a run: confirmed seats → unplaced; held unexpired → cancelled; expired entries ignored. Ids sorted. */
export function cancelRunEffects(seats: Record<string, SeatEntry>, now: Instant): { toUnplace: string[]; toCancel: string[] } {
    const toUnplace: string[] = [];
    const toCancel: string[] = [];
    for (const id of Object.keys(seats).sort(byCodeUnit)) {
        const x = seats[id].x;
        if (x === undefined) toUnplace.push(id);
        else if (now < x) toCancel.push(id);
    }
    return { toUnplace, toCancel };
}

// ---------------------------------------------------------------------------------------------------------------
// Week planner (§ 5.5; D16-D18)
// ---------------------------------------------------------------------------------------------------------------

export type PlannedDay =
    | { kind: "past"; date: LocalDate; entries: string[] }
    | {
        kind: "planned"; date: LocalDate; source: "default" | "dayHours" | "dayOff"; windows: LocalWindow[];
        removed: LocalWindow[]; note?: string; entries: string[]; open: { start: Instant; end: Instant }[];
        outsideHours: string[];
    };

export type DaysEditError =
    | { kind: "rangeInverted" }
    | { kind: "rangeTooLong"; maxDays: 366 }
    | { kind: "startsInPast"; today: LocalDate }
    | { kind: "sourceTooOld"; oldest: LocalDate }
    | { kind: "weekdayMismatch" }
    | { kind: "targetOverlapsSource" }
    | { kind: "tooManyDays"; max: 366 };

/**
 * § 5.5 precedence (the one rule for `availableSlots`, `slotDecision` and `planDay`): an override of the date
 * replaces its defaults entirely; no override → the rules of the date's ISO weekday, sorted by start.
 */
export function dayWindows(rules: AvailabilityRule[], override: DayOverride | undefined, date: LocalDate)
    : { source: "default" | "dayHours" | "dayOff"; windows: LocalWindow[] } {
    if (override === undefined) {
        const weekday = isoWeekday(date);
        const windows = rules.filter((r) => r.weekday === weekday)
            .map((r) => ({ start: r.start, end: r.end }))
            .sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start));
        return { source: "default", windows };
    }
    switch (override.kind) {
        case "dayOff": return { source: "dayOff", windows: [] };
        case "dayHours": return { source: "dayHours", windows: override.windows.map((w) => ({ start: w.start, end: w.end })) };
        default: return assertNever(override);
    }
}

/** § 5.5 horizon: the tenant's local today + 7 × `horizonWeeks` days. */
export function lastBookableDate(now: Instant, tz: TimeZone, horizonWeeks: number): LocalDate {
    return addDays(instantToLocal(now, tz).date, 7 * horizonWeeks);
}

/**
 * § 5.5 the one normalization of an interval read (display reads only): (1) group by booking; (2) keep the copies
 * with the highest `rev` (equal copies: the first in input order); (3) keep those intersecting `span`; (4) keep the
 * active ones. One entry per booking, in order of first appearance. The guarantee is only "the highest `rev` the
 * query returned"; no write decides on this.
 */
export function activeEntries(raw: ContainerEntry[], span: { start: Instant; end: Instant }, now: Instant): ContainerEntry[] {
    const newest = new Map<string, ContainerEntry>();
    for (const entry of raw) {
        const kept = newest.get(entry.bookingId);
        if (kept === undefined || entry.rev > kept.rev) newest.set(entry.bookingId, entry);
    }
    return [...newest.values()].filter((e) => e.s < span.end && span.start < e.e && entryActive(e, now));
}

/**
 * § 5.5 one planner day. `entries` must be `activeEntries(raw, localDaySpan(date, tz), now)`. A date before local
 * today − 6 is `past` (its overrides are pruned). `removed` = default windows minus the effective ones; `open` =
 * effective windows as instants minus the entries; `outsideHours` = entries whose part inside the local day is not
 * inside one window.
 */
export function planDay(input: {
    rules: AvailabilityRule[]; days: DayOverrides; date: LocalDate; entries: ContainerEntry[]; tz: TimeZone; now: Instant;
}): PlannedDay {
    const { rules, days, date, entries, tz, now } = input;
    const ids = entries.map((e) => e.bookingId);
    const today = instantToLocal(now, tz).date;
    if (date < addDays(today, -KEPT_PAST_DAYS)) return { kind: "past", date, entries: ids };

    const override = days[date] as DayOverride | undefined;
    const effective = dayWindows(rules, override, date);
    const toMinutes = (w: LocalWindow): Span => ({ start: minutesOfDay(w.start), end: minutesOfDay(w.end) });
    let removed: LocalWindow[];
    switch (effective.source) {
        case "default": removed = []; break;
        case "dayHours":
        case "dayOff":
            removed = subtract(dayWindows(rules, undefined, date).windows.map(toMinutes), effective.windows.map(toMinutes))
                .map((s) => ({ start: timeOfMinutes(s.start), end: timeOfMinutes(s.end) }));
            break;
        default: return assertNever(effective.source);
    }
    const windowSpans = effective.windows.map((w) => windowInstants(date, w, tz)).filter((s): s is Span => s !== null);
    const open = subtract(windowSpans, entries.map((e) => ({ start: e.s, end: e.e })));
    const day = localDaySpan(date, tz);
    const outsideHours = entries.filter((e) => {
        const part = { start: Math.max(e.s, day.start), end: Math.min(e.e, day.end) };
        if (part.end <= part.start) return false;
        return !windowSpans.some((w) => w.start <= part.start && part.end <= w.end);
    }).map((e) => e.bookingId);
    return {
        kind: "planned", date, source: effective.source, windows: effective.windows, removed,
        ...(override?.note !== undefined ? { note: override.note } : {}),
        entries: ids, open, outsideHours,
    };
}

function applySetting(days: DayOverrides, date: LocalDate, setting: DaySetting): void {
    switch (setting.kind) {
        case "default": delete days[date]; return;
        case "dayOff":
        case "dayHours": days[date] = setting; return;
        default: return assertNever(setting);
    }
}

function sameOverride(a: DayOverride | undefined, b: DayOverride | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    switch (a.kind) {
        case "dayOff": return b.kind === "dayOff" && a.note === b.note;
        case "dayHours":
            return b.kind === "dayHours" && a.note === b.note && a.windows.length === b.windows.length
                && a.windows.every((w, i) => w.start === b.windows[i].start && w.end === b.windows[i].end);
        default: return assertNever(a);
    }
}

/**
 * § 5.5 a day edit on one resource's overrides, then pruning (dates before `today − 6` leave `next`) and the
 * 366-key bound. `changed` = dates whose state differs between `current` and `next`, pruned keys excluded.
 * Precondition: `copyWeek.weeks` is an integer 1-52 (`DaysEditSchema`); a violation throws.
 */
export function editDays(current: DayOverrides, edit: DaysEdit, today: LocalDate)
    : Result<{ next: DayOverrides; changed: LocalDate[] }, DaysEditError> {
    const oldest = addDays(today, -KEPT_PAST_DAYS);
    const next: DayOverrides = { ...current };
    switch (edit.kind) {
        case "set": {
            if (edit.from > edit.to) return err({ kind: "rangeInverted" });
            if (daysBetween(edit.from, edit.to) + 1 > MAX_STORED_DAYS) return err({ kind: "rangeTooLong", maxDays: 366 });
            if (edit.from < today) return err({ kind: "startsInPast", today });
            for (let d = edit.from; d <= edit.to; d = addDays(d, 1)) applySetting(next, d, edit.value);
            break;
        }
        case "copyWeek": {
            if (!Number.isInteger(edit.weeks) || edit.weeks < 1 || edit.weeks > 52) {
                throw new RangeError(`copyWeek.weeks must be an integer 1-52, got ${edit.weeks}`);
            }
            if (isoWeekday(edit.sourceStart) !== isoWeekday(edit.targetStart)) return err({ kind: "weekdayMismatch" });
            if (edit.sourceStart < oldest) return err({ kind: "sourceTooOld", oldest });
            if (edit.targetStart < today) return err({ kind: "startsInPast", today });
            const sources = Array.from({ length: 7 }, (_, i) => addDays(edit.sourceStart, i));
            const targets = Array.from({ length: 7 * edit.weeks }, (_, j) => addDays(edit.targetStart, j));
            if (targets.some((t) => sources.includes(t))) return err({ kind: "targetOverlapsSource" });
            const sourceStates = sources.map((s) => current[s] as DayOverride | undefined); // read once, before any write
            targets.forEach((target, j) => {
                const state = sourceStates[j % 7];
                if (state === undefined) delete next[target];
                else next[target] = state;
            });
            break;
        }
        default: return assertNever(edit);
    }
    for (const d of Object.keys(next)) if (d < oldest) delete next[d];
    if (Object.keys(next).length > MAX_STORED_DAYS) return err({ kind: "tooManyDays", max: 366 });
    const dates = new Set([...Object.keys(current), ...Object.keys(next)]);
    const changed = [...dates]
        .filter((d) => d >= oldest && !sameOverride(current[d] as DayOverride | undefined, next[d] as DayOverride | undefined))
        .sort(byCodeUnit);
    return ok({ next, changed });
}

/**
 * § 5.5 weekly mail (D18): due when the local weekday of `now` is Sunday and the local time is 09:00 or later;
 * `weekStart` = the next local date (the Monday). It stops being due at local Monday 00:00.
 */
export function weekMailDue(now: Instant, tz: TimeZone): { kind: "due"; weekStart: LocalDate } | { kind: "notDue" } {
    const local = instantToLocal(now, tz);
    if (isoWeekday(local.date) === 7 && local.time >= "09:00") return { kind: "due", weekStart: addDays(local.date, 1) };
    return { kind: "notDue" };
}
