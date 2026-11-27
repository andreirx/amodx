import { z } from "zod";
import type { FormField } from "./index.js";
import { normalizeLocale } from "./locale-strings.js";
import { instantToLocal, isTimeZone, type Instant, type LocalDate } from "./zoned-time.js";

/**
 * STAY-1A (docs/slices/stay-1.md § 2, Build record) — the `date` field of stored forms. Pure: no clock read, no ambient
 * zone, no I/O. Users: the submit handler (`backend/src/forms/public-submit.ts`), the form save handlers
 * (`backend/src/forms/create.ts`, `update.ts`), the renderer's form pass (`formForBlock` in `SitePage.tsx`), the admin
 * submission view (`FormSubmissions.tsx`).
 *
 * Value contract: the text `YYYY-MM-DD` of a real calendar date (`isFormDate`: pattern plus a round trip, so
 * `2026-02-30` is refused), stored as that same text. No time, no zone conversion of the value. Every four-digit year
 * 0000–9999 is accepted (ISO 8601, proleptic Gregorian calendar).
 *
 * One rule for every calendar step here (finding F-STAY1A-YEAR-REMAP): a day is built from (year, month, day) only by
 * `utcDay` (`setUTCFullYear`), never by `Date.UTC` or `new Date(y, …)` — those read a year 0–99 as 1900–1999. A shown
 * year is the stored four-digit text, never the number `Intl` prints (`99` for 0099, `1` with era BC for 0000).
 */

const FORM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of the calendar day (year, month 1-12, day); out-of-range month or day rolls over (the round trip
 *  of `isFormDate` detects it). The year is taken as given: no 0-99 → 19xx mapping. */
function utcDay(year: number, month: number, day: number): Date {
    const t = new Date(0);
    t.setUTCFullYear(year, month - 1, day);
    return t;
}

/** The `YYYY-MM-DD` text of a UTC day; null when its year is outside 0000-9999. */
function formDateText(t: Date): LocalDate | null {
    const y = t.getUTCFullYear();
    if (y < 0 || y > 9999) return null;
    return `${String(y).padStart(4, "0")}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** True only for the exact text `YYYY-MM-DD` of a real calendar date, year 0000-9999 (round trip through `utcDay`). */
export function isFormDate(value: string): boolean {
    const m = FORM_DATE.exec(value);
    if (m === null) return false;
    return formDateText(utcDay(Number(m[1]), Number(m[2]), Number(m[3]))) === value;
}

/**
 * The optional pair rule of a form: the date of field `later` must be later than the date of field `earlier`. Both
 * are field ids of the same form and name two different `date` fields (`resolveFormDateOrder`).
 */
export const FormDateOrderSchema = z.object({
    earlier: z.string(),
    later: z.string(),
});
export type FormDateOrder = z.infer<typeof FormDateOrderSchema>;

/** The two fields a valid pair rule names. */
export type FormDatePair = { earlier: FormField; later: FormField };

/**
 * The pair rule of a form, read against the form's fields (the submit handler's field list: `formFieldsOf`).
 * - `{ ok: true, value: null }`: the form has no rule (`rule` absent).
 * - `{ ok: true, value: pair }`: the rule names two different `date` fields of `fields`.
 * - `{ ok: false, error }`: the rule is present and is not valid; `error` names the problem and the key.
 * The save handlers refuse an error (400); the submit handler and the renderer do not apply a rule that errors.
 */
export function resolveFormDateOrder(
    fields: readonly FormField[], rule: unknown,
): { ok: true; value: FormDatePair | null } | { ok: false; error: string } {
    if (rule === undefined) return { ok: true, value: null };
    const parsed = FormDateOrderSchema.safeParse(rule);
    if (!parsed.success) return { ok: false, error: "dateOrder: must be { earlier, later }, two field ids." };
    const { earlier, later } = parsed.data;
    if (earlier === later) return { ok: false, error: "dateOrder: earlier and later must be two different fields." };
    const earlierField = fields.find((f) => f.id === earlier);
    const laterField = fields.find((f) => f.id === later);
    if (earlierField === undefined) return { ok: false, error: `dateOrder.earlier: the form has no field with id "${earlier}".` };
    if (laterField === undefined) return { ok: false, error: `dateOrder.later: the form has no field with id "${later}".` };
    if (earlierField.type !== "date") return { ok: false, error: `dateOrder.earlier: the field "${earlierField.label}" is not a date field.` };
    if (laterField.type !== "date") return { ok: false, error: `dateOrder.later: the field "${laterField.label}" is not a date field.` };
    return { ok: true, value: { earlier: earlierField, later: laterField } };
}

/**
 * The earliest date a field with `min: "today"` accepts at the instant `now`.
 * - `timezone` is a valid IANA zone name (the site's `scheduling.timezone`): today's calendar date in that zone.
 * - Otherwise (no zone stored): the UTC date of `now` minus one day. A visitor west of UTC, whose own today is still
 *   the previous UTC date, is not refused; the cost is that a visitor may choose yesterday. The server is lenient by
 *   at most one day; it never refuses a visitor's own today. (`now` outside the years 0000-9999 has no form-date day
 *   before it: `0000-01-01`, the earliest form date, is returned.)
 */
export function earliestFormDate(now: Instant, timezone: unknown): LocalDate {
    if (typeof timezone === "string" && timezone !== "" && isTimeZone(timezone)) return instantToLocal(now, timezone).date;
    const [y, m, d] = instantToLocal(now, "UTC").date.split("-").map(Number);
    return formDateText(utcDay(y, m, d - 1)) ?? "0000-01-01";
}

/**
 * A stored date value as the site's locale writes a date: `2026-11-27` → `27.11.2026` (ro-RO, de-DE), `11/27/2026`
 * (en-US), `27/11/2026` (fr-FR); `0099-12-31` → `31.12.0099` (ro-RO). `locale` goes through `normalizeLocale` (absent or
 * malformed → en-US). The day is read from the text and formatted in UTC (`utcDay` + `timeZone: "UTC"`), never through a
 * local-time `Date`, so no zone can move it by one day; the locale gives the order and the separators, the year part is
 * the stored four-digit text. A value that is not a date text is returned unchanged.
 */
export function formatFormDate(value: string, locale: unknown): string {
    if (!isFormDate(value)) return value;
    const [y, m, d] = value.split("-").map(Number);
    const parts = new Intl.DateTimeFormat(normalizeLocale(locale), { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(utcDay(y, m, d));
    return parts.map((p) => (p.type === "year" ? value.slice(0, 4) : p.value)).join("");
}
