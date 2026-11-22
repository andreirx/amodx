/**
 * SCHED-1D2 — GET /scheduling/visitor/slots?serviceId&from&to (renderer op `slots`; docs/slices/sched-1.md § 10.2,
 * § 5.2, § 5.5) → `SlotsDTO`. Public derived read (§ 16.3 class 1).
 *
 * Reads (§ 6.3 consumer row "Visitor slots", display, not consistent): the tenant record (switch, zone, horizon); the
 * service (`SERVICE#`, absent → 404 `notFound`); the resources (`RESOURCE#`), kept when the service's eligibility names
 * them; one BatchGet of `AVAILABILITY#` + `DAYS#` per eligible resource (`UnprocessedKeys` exhausted → 503 `busy`);
 * per eligible resource ONE interval query over the local days `from`…`min(to, lastBookableDate)` (`readIntervals`,
 * active entries only). Then the kernel's `availableSlots` decides every start (§ 5.5 precedence: a date's override
 * replaces its defaults; the horizon; busy intervals).
 *
 * The range is checked by the kernel BEFORE any interval read: `availableSlots` with no resource reads nothing and
 * answers only `rangeInverted` / `rangeTooLong(62)` → 400. Days after `lastBookableDate` are in the answer with no
 * start (row D15), and no interval is read for them; `from` after it → every day empty, no read.
 * Stored `bookingHorizonWeeks` outside 1-52 → 500 `storedDataInvalid` (row D14, `readSchedulingTenant`).
 *
 * D9: the answer carries starts only — no resource id or name, no customer data.
 * The listed resources carry no `retiring` (the AP10 projection of § 6.3 does not read it), so a resource inside a
 * removal attempt (≤ 10 minutes, § 13) can still show starts; its hold is refused by the resource guard and the hold
 * tries the next resource (§ 7.3).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { LocalDateSchema, availableSlots, lastBookableDate, localDaySpan, type LocalDate } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { getResourcePlans, getService, iso, listResources, readIntervals, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { answer, parseValue, refusal } from "../common.js";
import { eligibleIds, visitorRoute } from "./common.js";

export type SlotsDTO = {
    timezone: string; serviceId: string; durationMin: number; lastBookableDate: LocalDate;
    days: { date: LocalDate; starts: string[] }[];
};

const QuerySchema = z.object({
    serviceId: z.string().min(1).max(100).refine((v) => !v.includes("#"), { message: "Must not contain #." }),
    from: LocalDateSchema,
    to: LocalDateSchema,
});

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    visitorRoute(event, "slots", { consistent: false }, async ({ tenantId, settings }) => {
        const q = parseValue(event.queryStringParameters ?? {}, QuerySchema);
        if (!q.ok) return q.answer;
        const { serviceId, from, to } = q.value;
        const tz = settings.timezone;
        const now = Date.now();
        const lastDate = lastBookableDate(now, tz, settings.bookingHorizonWeeks);
        const store = schedulingStoreFromEnv();
        const service = await getService(store, tenantId, serviceId, false);
        if (service === undefined) return refusal(404, "notFound", "Service not found.");

        const empty = { service, resources: [], rules: {}, days: {}, busy: [], from, to, lastBookableDate: lastDate, tz, now };
        const range = availableSlots(empty);
        if (!range.ok) {
            switch (range.error.kind) {
                case "rangeInverted": return refusal(400, "rangeInverted", "The range ends before it starts.");
                case "rangeTooLong": return refusal(400, "rangeTooLong", "The range is too long.", { maxDays: range.error.maxDays });
                default: {
                    const never: never = range.error;
                    throw new Error(`Unhandled range error ${JSON.stringify(never)}`);
                }
            }
        }

        const resources = (await listResources(store, tenantId, false)).map((r) => ({ id: r.id, name: r.name }));
        const ids = eligibleIds(service.eligibility, resources.map((r) => r.id));
        const lastDay = to < lastDate ? to : lastDate;
        let input = empty as Parameters<typeof availableSlots>[0];
        if (ids.length > 0 && from <= lastDay) {
            const plans = await getResourcePlans(store, tenantId, ids);
            if (!plans.ok) return refusal(503, "busy", "Busy, please try again.");
            const span = { start: localDaySpan(from, tz).start, end: localDaySpan(lastDay, tz).end };
            const entries = await Promise.all(ids.map((r) => readIntervals(store, tenantId, r, span, now)));
            input = {
                ...empty,
                resources: resources.filter((r) => ids.includes(r.id)),
                rules: Object.fromEntries(ids.map((r) => [r, plans.value[r].rules])),
                days: Object.fromEntries(ids.map((r) => [r, plans.value[r].days])),
                busy: entries.flatMap((list, i) => list.map((e) => ({ resourceId: ids[i], start: e.s, end: e.e }))),
            };
        }
        const slots = availableSlots(input);
        if (!slots.ok) throw new Error("[scheduling] slots: the range was accepted above");
        const dto: SlotsDTO = {
            timezone: tz, serviceId: service.id, durationMin: service.durationMin, lastBookableDate: lastDate,
            days: slots.value.map((d) => ({ date: d.day, starts: d.starts.map((s) => iso(s.start)) })),
        };
        return answer(200, dto);
    });
