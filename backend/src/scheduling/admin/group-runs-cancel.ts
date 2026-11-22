/**
 * SCHED-1F1 — POST /scheduling/admin/courses/{courseId}/runs/{runId}/cancel (E+T; docs/slices/sched-1.md § 10.3, § 5.4,
 * § 7.6, § 11.1, § 6.5): body `{}` → `{ unplaced: number; cancelled: number; notSentPlacementChanged: number;
 * tokenCleanupFailed: number }` (the last two fields: operator rulings on reviews S1F1-R01 and S1F1-R02, additions to
 * the § 10.3 answer).
 *
 * `cancelRun` (`scheduling-db.ts`, § 7.6): ONE versioned transaction — the run `cancelled` with no seats, its
 * `RUNSPAN#` deleted; each confirmed seat → `unplaced` (a `moved` history entry with `by` = this admin, `UNPLACED#`
 * put); each held unexpired seat → `cancelled` (a `cancelled` history entry, `by` = this admin); expired entries are
 * ignored; the course's dependent version is raised when someone is unplaced (S1F1-COURSE-DELETE-GUARD; ≤ 93 items).
 * `cancelRun` returns as soon as that transaction commits, with the committed result (ruling S1F1-CANCEL-OUTCOME).
 * A cancelled run → 409 `runCancelled`; unknown → 404; 503 `busy`. A caller without an email cannot be the `by` of the
 * history entries → 403.
 *
 * Before the write: the tenant (`readTenantBeforeWrite`: consistent; malformed stored setting → 500
 * `storedDataInvalid`); the time zone (409 `timezoneNotSet`, as every mailing group route); the course, CONSISTENT (404;
 * audit title, `{{courseName}}`).
 * Right after the commit, from the committed result and before any later work (§ 6.5 point 2, review S1F1-R02): ONE
 * main-table audit event — `details` = `{ unplaced, cancelled }` (counts only, § 6.5), `target.title` = course name and
 * the first local date of the run snapshot the cancel transaction decided on (`result.run`); no booking id, ref or
 * customer data; no `ip`.
 * Then, and only then (review S1F1-R02: the audit precedes every later request), the store-owned token cleanup
 * `clearCancelledRunTokens(result.cancelled)`: the link tokens of each cancelled hold are deleted (one transaction
 * each); a failure is counted in `tokenCleanupFailed` and logged by booking id, never thrown.
 * Then the mails (§ 11.1), through `sendGroupAdminMail`: per unplaced booking a NEW link token (`mintToken`) and the
 * mail `unplaced` (the page shows the new proposal); per cancelled booking the mail `cancelled`, no link (its tokens
 * are deleted), no owner copy. Mail details come from the booking as saved (the mint's result; a consistent read of
 * the cancelled booking) and the committed run snapshot. Review S1F1-R01 (`hasPlacement`): an `unplaced` notice is
 * sent only when the booking as the mint saved it is still unplaced in this course (an admin may have placed it into
 * another run in between: no notice from here, counted in `notSentPlacementChanged`); a `cancelled` notice only for a
 * booking that is cancelled in this run.
 * Limits (recorded): a mint, read or send failure is logged with the booking id and skips that person — the cancel
 * stands and the answer is still 200.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { cancelRun, clearCancelledRunTokens, getBooking, getCourse, mintToken, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminActor, adminRoute } from "./common.js";
import { answer, parseBody, pathParam, refusal } from "../common.js";
import { readTenantBeforeWrite, zonedSettings } from "./appt-common.js";
import { hasPlacement, runAuditTitle, sendGroupAdminMail } from "./group-common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-runs-cancel", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const courseId = pathParam(event, "courseId");
        if (!courseId.ok) return courseId.answer;
        const runId = pathParam(event, "runId");
        if (!runId.ok) return runId.answer;
        const body = parseBody(event, z.object({}).strict());
        if (!body.ok) return body.answer;
        const actor = adminActor(auth);
        if (actor === null) return refusal(403, "forbidden", "Changing a booking needs a signed-in user with an email address.");
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const tenant = read.tenant;
        const settings = zonedSettings(tenant);
        if (!settings.ok) return settings.answer;

        const store = schedulingStoreFromEnv();
        const course = await getCourse(store, tenantId, courseId.value, true);
        if (course === undefined) return refusal(404, "notFound", "Course not found.");
        const now = Date.now();
        const cancelled = await cancelRun(store, tenantId, course.id, runId.value, actor.email, now);
        if (!cancelled.ok) {
            const e = cancelled.error;
            switch (e.kind) {
                case "notFound": return refusal(404, "notFound", "Group not found.");
                case "runCancelled": return refusal(409, "runCancelled", "The group is cancelled.");
                case "busy": return refusal(503, "busy", "Busy, please try again.");
                default: {
                    const never: never = e;
                    throw new Error(`Unhandled refusal ${JSON.stringify(never)}`);
                }
            }
        }
        // Review S1F1-R02 / ruling S1F1-CANCEL-OUTCOME: the audit comes from the committed result — the run snapshot the
        // cancel transaction decided on — before any later request; the token cleanup follows it.
        const result = cancelled.value;
        const snapshot = result.run;
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CANCEL_SCHEDULING_RUN",
            target: { id: snapshot.id, title: runAuditTitle(course.name, snapshot) },
            details: { unplaced: result.unplaced.length, cancelled: result.cancelled.length },
        });
        const cleanup = await clearCancelledRunTokens(store, tenantId, result.cancelled, now);

        let notSentPlacementChanged = 0;

        for (const bookingId of result.unplaced) {
            try {
                const minted = await mintToken(store, tenantId, bookingId, now, { countForEmail: false });
                if (!minted.ok) {
                    console.error("[scheduling] group-runs-cancel no link for the unplaced mail", bookingId, minted.error.kind);
                    continue;
                }
                // Review S1F1-R01: the notice is about "no group in this course"; the booking as saved must still be so.
                if (!hasPlacement(minted.value.booking, { kind: "unplaced", courseId: course.id })) {
                    notSentPlacementChanged++;
                    continue;
                }
                await sendGroupAdminMail({ key: "unplaced", tenantId, tenant, booking: minted.value.booking, place: { course }, token: minted.value.token });
            } catch (e) {
                console.error("[scheduling] group-runs-cancel mail step failed", bookingId, e instanceof Error ? e.name : "unknown");
            }
        }
        for (const bookingId of result.cancelled) {
            try {
                const booking = await getBooking(store, tenantId, bookingId, true);
                if (booking === undefined) continue; // erased after the commit: nobody to mail
                // The same rule: the notice is about the cancelled seat in THIS run.
                if (booking.state.kind !== "cancelled" || !hasPlacement(booking, { kind: "seat", courseId: course.id, runId: snapshot.id })) {
                    notSentPlacementChanged++;
                    continue;
                }
                await sendGroupAdminMail({ key: "cancelled", tenantId, tenant, booking, place: { course, run: snapshot }, token: null });
            } catch (e) {
                console.error("[scheduling] group-runs-cancel mail step failed", bookingId, e instanceof Error ? e.name : "unknown");
            }
        }
        return answer(200, {
            unplaced: result.unplaced.length, cancelled: result.cancelled.length,
            notSentPlacementChanged, tokenCleanupFailed: cleanup.failed.length,
        });
    });
