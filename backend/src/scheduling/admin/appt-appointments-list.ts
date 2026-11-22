/**
 * SCHED-1E1 — GET /scheduling/admin/appointments?from&to (E+T; docs/slices/sched-1.md § 10.3, § 6.3 consumer row
 * "All-resource appointments"; operator ruling § 15: the reviewed day view across resources, kept beside the planner)
 * → `{ timezone; resources: { resourceId; name; entries: AppointmentEntryDTO[] }[] }`.
 *
 * `from`, `to`: real `YYYY-MM-DD` dates (else 400 `invalid`); `from > to` → 400 `rangeInverted`; more than 31 local
 * days → 400 `rangeTooLong { maxDays: 31 }` (§ 4.5). No stored time zone → 409 `timezoneNotSet`.
 * Reads (display, not consistent): the tenant record; `RESOURCE#` list (AP10); per resource ONE `readIntervals` over
 * the local days `from`…`to` (§ 5.5 `activeEntries`: each booking once, at the highest `rev` the query returned,
 * active only, kept when it intersects those days); one BatchGet of `BOOKING#` display views for every entry id (503
 * `busy` when it cannot finish). An id the BatchGet does not return is skipped. Resources by name, entries by start.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { LocalDateSchema } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { getBookingViews, listResources, readIntervals, schedulingStoreFromEnv, type BookingDisplayView } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, parseValue, readSchedulingTenant, refusal } from "../common.js";
import { appointmentEntry, localDatesSpan, zonedSettings } from "./appt-common.js";

const MAX_DAYS = 31; // § 4.5 "Admin appointments range ≤ 31 days per request"
const RangeQuerySchema = z.object({ from: LocalDateSchema, to: LocalDateSchema });

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-appointments-list", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const query = parseValue(event.queryStringParameters ?? {}, RangeQuerySchema);
        if (!query.ok) return query.answer;
        const { from, to } = query.value;
        if (from > to) return refusal(400, "rangeInverted", "The first date is after the last date.");
        const days = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000 + 1;
        if (days > MAX_DAYS) return refusal(400, "rangeTooLong", `One request covers at most ${MAX_DAYS} days.`, { maxDays: MAX_DAYS });

        const tenant = await readSchedulingTenant(tenantId, false);
        if (tenant === undefined) return refusal(404, "notFound", "Site not found.");
        const settings = zonedSettings(tenant);
        if (!settings.ok) return settings.answer;
        const tz = settings.value.timezone;

        const store = schedulingStoreFromEnv();
        const now = Date.now();
        const span = localDatesSpan(from, to, tz);
        const resources = await listResources(store, tenantId, false);
        const perResource = await Promise.all(resources.map(async (r) => ({ r, entries: await readIntervals(store, tenantId, r.id, span, now) })));
        const views = await getBookingViews(store, tenantId, perResource.flatMap((p) => p.entries.map((e) => e.bookingId)), "display");
        if (!views.ok) return refusal(503, "busy", "Busy, please try again.");
        const viewOf = new Map<string, BookingDisplayView>(views.value.map((v) => [v.id, v]));

        const out = perResource.map(({ r, entries }) => ({
            resourceId: r.id,
            name: r.name,
            entries: entries.flatMap((e) => {
                const view = viewOf.get(e.bookingId);
                return view === undefined ? [] : [appointmentEntry(e, view)];
            }).sort((a, b) => a.start.localeCompare(b.start) || a.bookingId.localeCompare(b.bookingId)),
        }));
        out.sort((a, b) => a.name.localeCompare(b.name) || a.resourceId.localeCompare(b.resourceId));
        return answer(200, { timezone: tz, resources: out });
    });
