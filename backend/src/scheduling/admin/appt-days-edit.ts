/**
 * SCHED-1E1 — PUT /scheduling/admin/resources/{resourceId}/days (E+T; docs/slices/sched-1.md § 10.3, § 5.5, § 23.4):
 * `{ from: LocalDate; to: LocalDate; value: DaySetting }` → `DayEditResult { changed, outsideHours }`. One day =
 * `from = to`. The body is strict: an unknown key (for example a `v`: the version never leaves the server) → 400
 * `invalid`; `value` is `dayOff` / `dayHours` (windows per § 4.2) / `default` (removes the override).
 * The kernel `editDays` `set` decides (`today` = the tenant's local today): 400 `rangeInverted`, `rangeTooLong`,
 * `startsInPast`, `tooManyDays`. The edit stands when bookings fall outside the new hours: their refs are listed in
 * `outsideHours`, nobody is mailed (§ 23.4). Write, retry, answer and audit: `applyDayEdit` (appt-common.ts).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { DaySettingSchema, LocalDateSchema } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { parseBody, pathParam } from "../common.js";
import { applyDayEdit } from "./appt-common.js";

const DaysBodySchema = z.object({ from: LocalDateSchema, to: LocalDateSchema, value: DaySettingSchema }).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-days-edit", EDITOR_OR_ADMIN, async (ctx) => {
        const id = pathParam(event, "resourceId");
        if (!id.ok) return id.answer;
        const body = parseBody(event, DaysBodySchema);
        if (!body.ok) return body.answer;
        const { from, to, value } = body.value;
        return applyDayEdit({
            ctx, store: schedulingStoreFromEnv(), resourceId: id.value,
            edit: { kind: "set", from, to, value },
            action: "EDIT_SCHEDULING_DAYS",
            details: { from, to, setting: value.kind },
        });
    });
