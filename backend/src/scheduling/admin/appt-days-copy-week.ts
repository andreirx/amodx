/**
 * SCHED-1E1 — POST /scheduling/admin/resources/{resourceId}/days/copy-week (E+T; docs/slices/sched-1.md § 10.3,
 * § 5.5): `{ sourceStart: LocalDate; targetStart: LocalDate; weeks: 1-52 }` → `DayEditResult`. Strict body (an
 * unknown key → 400 `invalid`); `weeks` an integer 1-52 (`"3"`, 2.5, 0, 53 → 400 `invalid`). The kernel `editDays`
 * `copyWeek` decides: 400 `weekdayMismatch`, `sourceTooOld`, `startsInPast`, `targetOverlapsSource`, `tooManyDays`.
 * Same write, retry, answer and audit as the PUT (`applyDayEdit`, appt-common.ts).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { LocalDateSchema } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { parseBody, pathParam } from "../common.js";
import { applyDayEdit } from "./appt-common.js";

const CopyWeekBodySchema = z.object({
    sourceStart: LocalDateSchema,
    targetStart: LocalDateSchema,
    weeks: z.number().int().min(1).max(52), // § 4.5 "copy-week ≤ 52 target weeks"
}).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-days-copy-week", EDITOR_OR_ADMIN, async (ctx) => {
        const id = pathParam(event, "resourceId");
        if (!id.ok) return id.answer;
        const body = parseBody(event, CopyWeekBodySchema);
        if (!body.ok) return body.answer;
        const { sourceStart, targetStart, weeks } = body.value;
        return applyDayEdit({
            ctx, store: schedulingStoreFromEnv(), resourceId: id.value,
            edit: { kind: "copyWeek", sourceStart, targetStart, weeks },
            action: "COPY_SCHEDULING_WEEK",
            details: { sourceStart, targetStart, weeks },
        });
    });
