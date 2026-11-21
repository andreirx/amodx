/**
 * SCHED-1A (docs/slices/sched-1.md § 5.1) — local wall time ↔ UTC instant in an explicit IANA time zone.
 * Maturity: PROTOTYPE (until `sched-1i` passes on staging, § 17).
 *
 * Pure: no clock read and no ambient zone. The zone is always a parameter. Zone data comes from the platform
 * `Intl.DateTimeFormat` (Node 22 ships full ICU); no date library (§ 19: a dependency in every workspace for about
 * forty lines on `Intl`).
 *
 * How it works. For an instant `t`, `offsetAt(t, tz)` is "the wall clock in `tz` at `t`, read as if it were UTC,
 * minus `t`". A wall time `w` (also read as if UTC) maps to every instant `t = w − o` whose own offset is `o`. The
 * offsets that can apply near `w` are sampled one day before, at, and one day after `w`; each one that maps back
 * to `w` is a candidate. No candidate → the wall time is in a spring gap. Two candidates → it is ambiguous (autumn);
 * the rule of § 5.1 takes the earlier one.
 *
 * Inputs are expected in their validated forms (`LocalDateSchema`, `LocalTimeSchema`, `TimeZoneSchema` of
 * `scheduling.ts`). A malformed date or time string is a caller defect and throws a `RangeError`; it is not an
 * expected outcome, so it has no `Result` variant.
 */

/** Epoch milliseconds (UTC). */
export type Instant = number;
/** `"YYYY-MM-DD"`, a real calendar date. String order = date order. */
export type LocalDate = string;
/** `"HH:MM"`, 00:00-23:59. String order = time order. */
export type LocalTime = string;
/** An IANA zone name that `Intl.DateTimeFormat` accepts. */
export type TimeZone = string;
/** Expected outcomes of the scheduling kernel (§ 5). */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalDate(value: string): boolean {
    const m = LOCAL_DATE.exec(value);
    if (m === null) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function isLocalTime(value: string): boolean {
    return LOCAL_TIME.test(value);
}

export function isTimeZone(value: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

function dateParts(date: LocalDate): [number, number, number] {
    const m = LOCAL_DATE.exec(date);
    if (m === null || !isLocalDate(date)) throw new RangeError(`Not a local date: ${date}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Minutes since local midnight of a `"HH:MM"` time. */
export function minutesOfDay(time: LocalTime): number {
    const m = LOCAL_TIME.exec(time);
    if (m === null) throw new RangeError(`Not a local time: ${time}`);
    return Number(m[1]) * 60 + Number(m[2]);
}

/** The `"HH:MM"` time of a minute count 0-1439. */
export function timeOfMinutes(minutes: number): LocalTime {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) throw new RangeError(`Not a minute of a day: ${minutes}`);
    return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

function formatDate(utcMidnight: number): LocalDate {
    const t = new Date(utcMidnight);
    return `${String(t.getUTCFullYear()).padStart(4, "0")}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

function dayNumber(date: LocalDate): number {
    const [y, mo, d] = dateParts(date);
    return Date.UTC(y, mo - 1, d);
}

/** Calendar arithmetic on local dates (no zone involved). */
export function addDays(date: LocalDate, days: number): LocalDate {
    return formatDate(dayNumber(date) + days * DAY_MS);
}

/** `b − a` in whole calendar days. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
    return Math.round((dayNumber(b) - dayNumber(a)) / DAY_MS);
}

/** ISO weekday: Monday 1 … Sunday 7. */
export function isoWeekday(date: LocalDate): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
    const js = new Date(dayNumber(date)).getUTCDay(); // 0 = Sunday
    return (js === 0 ? 7 : js) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

// One formatter per zone. A cache of a pure function: it changes no result.
const formatters = new Map<TimeZone, Intl.DateTimeFormat>();

function formatter(tz: TimeZone): Intl.DateTimeFormat {
    let f = formatters.get(tz);
    if (f === undefined) {
        f = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hourCycle: "h23",
            year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
        formatters.set(tz, f);
    }
    return f;
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

function wallAt(at: Instant, tz: TimeZone): Wall {
    const p: Record<string, number> = {};
    for (const part of formatter(tz).formatToParts(at)) {
        if (part.type !== "literal") p[part.type] = Number(part.value);
    }
    return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

/** Wall clock of `tz` at `at`, read as UTC, minus `at` (both at whole seconds: zone data has no finer step). */
function offsetAt(at: Instant, tz: TimeZone): number {
    const w = wallAt(at, tz);
    const atSecond = at - (((at % 1000) + 1000) % 1000);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - atSecond;
}

function wallMs(date: LocalDate, time: LocalTime): number {
    return dayNumber(date) + minutesOfDay(time) * MINUTE_MS;
}

/**
 * § 5.1: the instant of a local date and time in `tz`. A time in a spring gap → `nonexistentLocalTime`; an
 * ambiguous time (autumn) → the earlier instant.
 */
export function localToInstant(date: LocalDate, time: LocalTime, tz: TimeZone): Result<Instant, { kind: "nonexistentLocalTime" }> {
    const w = wallMs(date, time);
    const offsets = new Set([offsetAt(w - DAY_MS, tz), offsetAt(w, tz), offsetAt(w + DAY_MS, tz)]);
    let earliest: Instant | undefined;
    for (const o of offsets) {
        const t = w - o;
        if (offsetAt(t, tz) === o && (earliest === undefined || t < earliest)) earliest = t;
    }
    return earliest === undefined ? { ok: false, error: { kind: "nonexistentLocalTime" } } : { ok: true, value: earliest };
}

/**
 * The instant of a local date and time; when the time is in a spring gap, the instant at which the gap ends (the
 * first local minute that exists after it). § 5.5: "a window bound in a spring gap is taken at the first local
 * minute that exists after it". Ambiguous times → the earlier instant, as `localToInstant`.
 */
export function localToInstantOrGapEnd(date: LocalDate, time: LocalTime, tz: TimeZone): Instant {
    const exact = localToInstant(date, time, tz);
    if (exact.ok) return exact.value;
    // In a gap the offset grows from `before` to `after` at one instant T, and T lies in (w − after, w − before].
    const w = wallMs(date, time);
    const before = offsetAt(w - DAY_MS, tz);
    const after = offsetAt(w + DAY_MS, tz);
    let lo = w - after;
    let hi = w - before;
    if (offsetAt(lo, tz) !== before || offsetAt(hi, tz) !== after) {
        throw new Error(`Zone data of ${tz} does not show one gap around ${date} ${time}`);
    }
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (offsetAt(mid, tz) === after) hi = mid;
        else lo = mid;
    }
    return hi;
}

/** § 5.1: the local date and time (minutes; seconds dropped) of an instant in `tz`. */
export function instantToLocal(at: Instant, tz: TimeZone): { date: LocalDate; time: LocalTime } {
    const w = wallAt(at, tz);
    return {
        date: `${String(w.y).padStart(4, "0")}-${pad2(w.mo)}-${pad2(w.d)}`,
        time: `${pad2(w.h)}:${pad2(w.mi)}`,
    };
}

/**
 * The local day `date` in `tz` as the half-open instant span `[start of date, start of date + 1)` (§ 5.5 planDay:
 * "the local day D"). A midnight in a spring gap is taken at the end of the gap. A caller passes this span to
 * `activeEntries` for one planner day.
 */
export function localDaySpan(date: LocalDate, tz: TimeZone): { start: Instant; end: Instant } {
    return {
        start: localToInstantOrGapEnd(date, "00:00", tz),
        end: localToInstantOrGapEnd(addDays(date, 1), "00:00", tz),
    };
}
