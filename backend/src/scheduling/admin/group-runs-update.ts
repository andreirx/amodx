/**
 * SCHED-1F1 — PUT /scheduling/admin/courses/{courseId}/runs/{runId} (E+T; docs/slices/sched-1.md § 10.3, § 13, § 7.4):
 * `{ capacity?, trainerIds?, language?: string | null, groupLink?: string | null, status?: "open" | "closed" }` →
 * `RunAdminDTO`. At least one field (an empty body would only bump the version); unknown keys → 400.
 *
 * `updateRun` (`scheduling-db.ts`) writes under the run's version `v` (re-read on a lost condition; 503 `busy` after
 * three); a cancelled run refuses every change (409 `runCancelled`); `cancelled` is not a value of `status` here (only
 * the cancel route sets it). § 13: a capacity below the seats taken is allowed — nobody is removed, `overCapacityBy`
 * shows the excess, new seats are refused until taken < capacity (row F6). `language: null` = not set (D7);
 * `groupLink: null` removes the link (D10). A new trainer list carries the resource guard while the run has a future
 * meeting (409 `resourceUnavailable`).
 *
 * Before the write: the tenant (`readTenantBeforeWrite`: consistent; malformed stored setting → 500
 * `storedDataInvalid`); the course, CONSISTENT (404; a `language` must be one of its languages → else 400 — checked
 * when the language is SET, ruling S1F1-LANGUAGE-CONSIST: an update that does not set `language` never checks or
 * refuses the run's stored language, which may have left the course list; a concurrent course update can also
 * remove the language just set — valid stored data, as group-courses-update.ts states); a new
 * trainer list (`checkTrainers`, consistent: unknown → 400, being removed → 409).
 * Audit (§ 6.5 point 2): one main-table event right after the write — the admin's email, `target.title` = course name
 * and first local date; no `details` (counts and dates only: a field change has neither); no `ip`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { getCourse, schedulingStoreFromEnv, updateRun } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, parseBody, pathParam, refusal } from "../common.js";
import { readTenantBeforeWrite } from "./appt-common.js";
import { CapacityBodySchema, checkTrainers, languageNotOffered, runAdminDTO, runAuditTitle } from "./group-common.js";
import { GroupLinkSchema, TrainerIdsSchema } from "./group-runs-create.js";

const UpdateRunBodySchema = z.object({
    capacity: CapacityBodySchema.optional(),
    trainerIds: TrainerIdsSchema.optional(),
    language: z.string().min(1).nullable().optional(),
    groupLink: GroupLinkSchema.nullable().optional(),
    status: z.enum(["open", "closed"]).optional(),
}).strict().refine((b) => Object.keys(b).length > 0, { message: "Name at least one field to change." });

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-runs-update", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const courseId = pathParam(event, "courseId");
        if (!courseId.ok) return courseId.answer;
        const runId = pathParam(event, "runId");
        if (!runId.ok) return runId.answer;
        const body = parseBody(event, UpdateRunBodySchema);
        if (!body.ok) return body.answer;
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;

        const store = schedulingStoreFromEnv();
        const course = await getCourse(store, tenantId, courseId.value, true);
        if (course === undefined) return refusal(404, "notFound", "Course not found.");
        const change = body.value;
        if (typeof change.language === "string") {
            const notOffered = languageNotOffered(course, change.language, "language");
            if (notOffered !== null) return notOffered;
        }
        if (change.trainerIds !== undefined) {
            const trainers = await checkTrainers(store, tenantId, change.trainerIds);
            if (trainers !== null) return trainers;
        }

        const now = Date.now();
        const updated = await updateRun(store, tenantId, course.id, runId.value, change, now);
        if (!updated.ok) {
            const e = updated.error;
            switch (e.kind) {
                case "notFound": return refusal(404, "notFound", "Group not found.");
                case "runCancelled": return refusal(409, "runCancelled", "The group is cancelled.");
                case "resourceUnavailable": return refusal(409, "resourceUnavailable", "A trainer does not exist or is being removed.");
                case "busy": return refusal(503, "busy", "Busy, please try again.");
                default: {
                    const never: never = e;
                    throw new Error(`Unhandled refusal ${JSON.stringify(never)}`);
                }
            }
        }
        const run = updated.value;
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_SCHEDULING_RUN",
            target: { id: run.id, title: runAuditTitle(course.name, run) },
        });
        return answer(200, runAdminDTO(run, now));
    });
