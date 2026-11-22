/**
 * SCHED-1F1 — POST /scheduling/admin/courses/{courseId}/runs/{runId}/move (E+T; docs/slices/sched-1.md § 10.3, § 5.4,
 * § 7.6, § 11.1, § 13): `{ meetings }` → `{ run: RunAdminDTO; mailed: number; notSentPlacementChanged: number }` (the
 * last field: operator ruling on review S1F1-R01, an addition to the § 10.3 answer).
 *
 * `moveRun` (`scheduling-db.ts`): `validateMeetings` on the new list (each `MeetingError` → 400 with its kind); a
 * cancelled run → 409 `runCancelled`; the resource guard on each trainer when the new last meeting ends in the future
 * (409 `resourceUnavailable`); the run item, its `RUNSPAN#` index and the guards in one versioned transaction (503
 * `busy` after three lost versions). People stay in the run (§ 13). The meetings stay in the run's own time zone.
 *
 * Before the write: the tenant (`readTenantBeforeWrite`: consistent; malformed stored setting → 500
 * `storedDataInvalid`); the time zone (409 `timezoneNotSet`: the mails' `{{expiresAt}}` rule of `sendVisitorMail`); the
 * course, CONSISTENT (404; its name is the audit title and the mails' `{{courseName}}`).
 * Right after the commit (§ 6.5 point 2): ONE main-table audit event — the admin's email, `target.title` = course name
 * and the NEW first local date, `details` = new first and last date, meeting count, the count of active bookings;
 * never a booking id, ref or customer data; no `ip`. A run move changes no booking's `what` or `state`, so no booking
 * gets a `history` entry (§ 4.4: "Not recorded: … a run move").
 * Then, per active booking (held unexpired or confirmed seat at the commit, the list `moveRun` returns): a NEW link
 * token (`mintToken`, § 8.4) and the mail `moved` (customer per `sendToCustomer`) through `sendVisitorMail`, with the
 * booking as the mint saved it and the run as the move saved it. `mailed` = the number of customer mails SES accepted.
 * Review S1F1-R01 (`hasPlacement`): a booking that, as the mint saved it, is no longer in this run (a person move
 * committed in between) gets no `moved` notice from here — its own move mailed it — and is counted in
 * `notSentPlacementChanged`. Limit: a second move of the same run between our commit and a mint makes the notice show
 * this move's meetings; the second move mails every person again with its own.
 * Limits (recorded): a mint or send failure is logged with the booking id and skips that person — the move stands
 * and the answer is still 200 (`mailed` is then lower than the active count in the audit); a booking cancelled after
 * the commit gets no mail (`linkNotIssued`). Mails go one after the other (≤ 45 per run, § 4.5) inside the function's
 * 29 s timeout.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { getCourse, mintToken, moveRun, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, parseBody, pathParam, refusal } from "../common.js";
import { sendVisitorMail } from "../visitor/mail.js";
import { readTenantBeforeWrite, zonedSettings } from "./appt-common.js";
import { MeetingsBodySchema, hasPlacement, meetingErrorAnswer, runAdminDTO, runAuditDates, runAuditTitle } from "./group-common.js";

const MoveRunBodySchema = z.object({ meetings: MeetingsBodySchema }).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-runs-move", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const courseId = pathParam(event, "courseId");
        if (!courseId.ok) return courseId.answer;
        const runId = pathParam(event, "runId");
        if (!runId.ok) return runId.answer;
        const body = parseBody(event, MoveRunBodySchema);
        if (!body.ok) return body.answer;
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const tenant = read.tenant;
        const settings = zonedSettings(tenant);
        if (!settings.ok) return settings.answer;

        const store = schedulingStoreFromEnv();
        const course = await getCourse(store, tenantId, courseId.value, true);
        if (course === undefined) return refusal(404, "notFound", "Course not found.");
        const now = Date.now();
        const moved = await moveRun(store, tenantId, course.id, runId.value, body.value.meetings, now);
        if (!moved.ok) {
            const e = moved.error;
            switch (e.kind) {
                case "notFound": return refusal(404, "notFound", "Group not found.");
                case "runCancelled": return refusal(409, "runCancelled", "The group is cancelled.");
                case "resourceUnavailable": return refusal(409, "resourceUnavailable", "A trainer does not exist or is being removed.");
                case "busy": return refusal(503, "busy", "Busy, please try again.");
                case "empty":
                case "endNotAfterStart":
                case "overlap":
                case "nonexistentLocalTime":
                case "tooMany":
                    return meetingErrorAnswer(e);
                default: {
                    const never: never = e;
                    throw new Error(`Unhandled refusal ${JSON.stringify(never)}`);
                }
            }
        }
        const { run, activeBookingIds } = moved.value;
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "MOVE_SCHEDULING_RUN",
            target: { id: run.id, title: runAuditTitle(course.name, run) },
            details: { ...runAuditDates(run), activeBookings: activeBookingIds.length },
        });

        let mailed = 0;
        let notSentPlacementChanged = 0;
        for (const bookingId of activeBookingIds) {
            try {
                const minted = await mintToken(store, tenantId, bookingId, now, { countForEmail: false });
                if (!minted.ok) {
                    console.error("[scheduling] group-runs-move no link for the moved mail", bookingId, minted.error.kind);
                    continue;
                }
                // Review S1F1-R01: the notice is about THIS run; the booking as the mint saved it must still be in it.
                if (!hasPlacement(minted.value.booking, { kind: "seat", courseId: course.id, runId: run.id })) {
                    notSentPlacementChanged++;
                    continue;
                }
                const outcome = await sendVisitorMail({
                    key: "moved", tenantId, tenant, settings: settings.value, booking: minted.value.booking,
                    place: { course, run }, token: minted.value.token,
                });
                if (outcome === "sent") mailed++;
            } catch (e) {
                console.error("[scheduling] group-runs-move mail step failed", bookingId, e instanceof Error ? e.name : "unknown");
            }
        }
        return answer(200, { run: runAdminDTO(run, now), mailed, notSentPlacementChanged });
    });
