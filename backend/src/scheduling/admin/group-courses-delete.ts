/**
 * SCHED-1F1 — DELETE /scheduling/admin/courses/{courseId} (E+T; docs/slices/sched-1.md § 10.3) → 204. Refused with 409
 * `courseInUse` while any run (open, closed or cancelled: a run is never deleted) or any `UNPLACED#` booking of the
 * course exists.
 * Before any write: the tenant through `readTenantBeforeWrite` (a malformed stored setting → 500 `storedDataInvalid`,
 * nothing deleted). Then `deleteCourse` (ruling S1F1-COURSE-DELETE-GUARD): the course read consistently (404), its
 * runs and unplaced bookings read consistently (409), then one Delete under the course's dependent version as read —
 * every write that gives the course a new dependent (run create, unplaced manual entry, a person moved out of a run,
 * a run cancel that unplaces people) raises that version in its own transaction, so a dependent written between the
 * checks and the Delete makes the Delete fail (409 `courseInUse`), and a dependent written after the Delete finds no
 * course and is refused. No dependent is left without its course (review S1F1-R04).
 * Audit (§ 6.5 point 2): one main-table event right after the delete, the course name as `target.title`; no `details`;
 * no `ip`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { deleteCourse, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, pathParam, refusal } from "../common.js";
import { readTenantBeforeWrite } from "./appt-common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-courses-delete", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const id = pathParam(event, "courseId");
        if (!id.ok) return id.answer;
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const deleted = await deleteCourse(schedulingStoreFromEnv(), tenantId, id.value);
        if (!deleted.ok) {
            const e = deleted.error;
            switch (e.kind) {
                case "notFound": return refusal(404, "notFound", "Course not found.");
                case "courseInUse": return refusal(409, "courseInUse", "The course has groups or people without a group.");
                default: {
                    const never: never = e;
                    throw new Error(`Unhandled refusal ${JSON.stringify(never)}`);
                }
            }
        }
        const course = deleted.value;
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "DELETE_SCHEDULING_COURSE",
            target: { id: course.id, title: course.name },
        });
        return answer(204);
    });
