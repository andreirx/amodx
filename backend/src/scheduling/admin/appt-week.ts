/**
 * SCHED-1E1 — GET /scheduling/admin/resources/{resourceId}/week?start (E+T; docs/slices/sched-1.md § 10.3, § 5.5,
 * § 23.5) → `WeekPlanDTO`: 7 `DayDTO`s from `start` (any date; the screen sends Mondays). Works with the switch off
 * (no read of `schedulingEnabled`). `start` absent or not a real `YYYY-MM-DD` date → 400 `invalid`; unknown resource
 * (or one of another tenant) → 404; no stored time zone → 409 `timezoneNotSet`; a BOOKING# batch read that cannot
 * finish → 503 `busy`.
 *
 * Reads (§ 6.3 consumer row "Planner week"; all display reads, not consistent): the tenant record (`scheduling`,
 * through `readSchedulingTenant`: a stored setting that fails its schema → 500 `storedDataInvalid`); `RESOURCE#<r>`
 * (name); `AVAILABILITY#<r>` (rules); `DAYS#<r>` (overrides; a stored item that fails its schema → 500, § 23.7);
 * ONE `readIntervals` over the 7 local days (the § 5.5 `activeEntries` list function of `scheduling-db.ts`: each
 * booking once, at the highest `rev` the query returned, active only); one BatchGet of `BOOKING#` display views.
 * Per day: `activeEntries` of the week's entries on that local day, then `planDay` (the kernel decides `past`,
 * `source`, `windows`, `removed`, `open`, `outsideHours`). An entry whose booking the BatchGet does not return is
 * skipped (§ 6.3, as the appointments read), in `entries` and in `outsideHours`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import {
    activeEntries, lastBookableDate, localDaySpan, planDay, LocalDateSchema,
    type AvailabilityRule, type ContainerEntry, type LocalDate, type LocalWindow,
} from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import {
    getAvailability, getBookingViews, getDays, getResource, iso, readIntervals, schedulingStoreFromEnv,
    type BookingDisplayView,
} from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, parseValue, pathParam, readSchedulingTenant, refusal } from "../common.js";
import { appointmentEntry, localDatesSpan, refOfBookingId, zonedSettings, type AppointmentEntryDTO } from "./appt-common.js";

type PlannerEntryDTO = AppointmentEntryDTO & { expiresAt?: string };
type DayDTO = { date: LocalDate } & (
    | { kind: "past"; entries: PlannerEntryDTO[] }
    | {
        kind: "planned"; source: "default" | "dayHours" | "dayOff"; windows: LocalWindow[]; removed: LocalWindow[];
        note?: string; entries: PlannerEntryDTO[]; open: { start: string; end: string }[]; outsideHours: string[];
    });
type WeekPlanDTO = {
    timezone: string; resourceId: string; resourceName: string; lastBookableDate: LocalDate;
    defaults: AvailabilityRule[]; days: DayDTO[];
};

const WeekQuerySchema = z.object({ start: LocalDateSchema });

/** The 7 local dates from `start` (calendar arithmetic on the date, no time zone involved). */
function weekDates(start: LocalDate): LocalDate[] {
    const base = Date.parse(`${start}T00:00:00.000Z`);
    return Array.from({ length: 7 }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-week", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const id = pathParam(event, "resourceId");
        if (!id.ok) return id.answer;
        const query = parseValue(event.queryStringParameters ?? {}, WeekQuerySchema);
        if (!query.ok) return query.answer;
        const tenant = await readSchedulingTenant(tenantId, false);
        if (tenant === undefined) return refusal(404, "notFound", "Site not found.");
        const settings = zonedSettings(tenant);
        if (!settings.ok) return settings.answer;
        const tz = settings.value.timezone;

        const store = schedulingStoreFromEnv();
        const resource = await getResource(store, tenantId, id.value, false);
        if (resource === undefined) return refusal(404, "notFound", "Resource not found.");
        const [rules, days] = await Promise.all([
            getAvailability(store, tenantId, id.value, false),
            getDays(store, tenantId, id.value, false),
        ]);
        const now = Date.now();
        const dates = weekDates(query.value.start);
        const entries = await readIntervals(store, tenantId, id.value, localDatesSpan(dates[0], dates[6], tz), now);
        const views = await getBookingViews(store, tenantId, entries.map((e) => e.bookingId), "display");
        if (!views.ok) return refusal(503, "busy", "Busy, please try again.");
        const viewOf = new Map<string, BookingDisplayView>(views.value.map((v) => [v.id, v]));

        const shown = (dayEntries: ContainerEntry[]): PlannerEntryDTO[] => dayEntries.flatMap((e) => {
            const view = viewOf.get(e.bookingId);
            if (view === undefined) return [];
            return [{ ...appointmentEntry(e, view), ...(e.x !== undefined ? { expiresAt: iso(e.x) } : {}) }];
        });

        const dayDTOs: DayDTO[] = dates.map((date) => {
            const dayEntries = activeEntries(entries, localDaySpan(date, tz), now);
            const planned = planDay({ rules, days, date, entries: dayEntries, tz, now });
            switch (planned.kind) {
                case "past": return { date, kind: "past", entries: shown(dayEntries) };
                case "planned": return {
                    date, kind: "planned", source: planned.source, windows: planned.windows, removed: planned.removed,
                    ...(planned.note !== undefined ? { note: planned.note } : {}),
                    entries: shown(dayEntries),
                    open: planned.open.map((o) => ({ start: iso(o.start), end: iso(o.end) })),
                    outsideHours: planned.outsideHours.filter((b) => viewOf.has(b)).map(refOfBookingId),
                };
                default: {
                    const never: never = planned;
                    throw new Error(`Unhandled day ${JSON.stringify(never)}`);
                }
            }
        });

        const week: WeekPlanDTO = {
            timezone: tz, resourceId: id.value, resourceName: resource.name,
            lastBookableDate: lastBookableDate(now, tz, settings.value.bookingHorizonWeeks),
            defaults: rules, days: dayDTOs,
        };
        return answer(200, week);
    });
