/**
 * SCHED-1F1 — POST /scheduling/admin/courses/{courseId}/runs (E+T; docs/slices/sched-1.md § 10.3, § 4.3, § 5.4, § 7.6):
 * `{ meetings, capacity?, trainerIds, language?, groupLink? }` → 201 `RunAdminDTO`.
 *
 * Validation: the body is strict; `trainerIds` 1-10 ids (an empty list → 400, row F1); `capacity` 1-45, default the
 * course's `defaultCapacity`, above 45 → 400 with "A group in this version holds at most 45 people." (row F1);
 * `language` one of the course's languages (absent → `notSet`, D7); `groupLink` an `https:` URL ≤ 500 (D10). The
 * meetings are checked by the kernel's `validateMeetings` inside `createRun`: each `MeetingError` → 400 with its kind
 * as the code (row F1). The run's time zone is the tenant's `scheduling.timezone`, copied at creation (§ 4.3); a tenant
 * without one → 409 `timezoneNotSet`.
 *
 * Before the write: the tenant (`readTenantBeforeWrite`: consistent; a malformed stored setting → 500
 * `storedDataInvalid`, nothing written); the course, CONSISTENT (404 decides the write; its languages and default
 * capacity decide the run); the trainers, CONSISTENT (`checkTrainers`: unknown → 400, being removed → 409
 * `resourceUnavailable`). The write (`createRun`) carries the resource guard on each trainer when the run has a
 * future meeting (§ 7.6), so a removal that starts after the check → 409 `resourceUnavailable`; and it raises the
 * course's dependent version (S1F1-COURSE-DELETE-GUARD), so a course deleted after the read → 404, and a course
 * delete that read the course before this commit is refused. Duplicate trainer ids → 400 (review S1F1-R03).
 * Limit (operator ruling S1F1-LANGUAGE-CONSIST, amends § 4.3): `language` is checked against the course list at the
 * time it is set. A course update that removes that language between the course read and this commit succeeds and
 * leaves
 * a run whose language is no longer in its course's list. That state is VALID stored data: the course list is what
 * new runs and new first bookings may choose from, and no reader, schema or writer refuses or fails on such a run
 * (it is read, shown, booked and moved normally; test "S1F1-LANGUAGE-CONSIST" in scheduling-group.test.ts).
 * Audit (§ 6.5 point 2): one main-table event right after the write — the admin's email, `target.title` = course name
 * and first local date, `details` = first and last date, meeting count, capacity; no `ip`; no customer data.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { RunSchema } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { createRun, getCourse, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, parseBody, pathParam, refusal } from "../common.js";
import { IdSchema, readTenantBeforeWrite, zonedSettings } from "./appt-common.js";
import {
    CapacityBodySchema, MeetingsBodySchema, checkTrainers, languageNotOffered, meetingErrorAnswer, runAdminDTO, runAuditDates, runAuditTitle,
} from "./group-common.js";

/**
 * § 10.3: 1-10 DISTINCT trainers. Review S1F1-R03, rule for the class "a validated request yields a transaction that
 * names one item twice" (DynamoDB refuses such a transaction): an id list whose ids become transaction items is
 * distinct at validation. Today that list is `trainerIds` (one guard per trainer, § 7.6), shared by run create and
 * run update through this one schema.
 */
export const TrainerIdsSchema = z.tuple([IdSchema], IdSchema)
    .refine((ids) => ids.length <= 10, { message: "At most 10 trainers." })
    .refine((ids) => new Set(ids).size === ids.length, { message: "Each trainer once." });
/** D10: an `https:` URL ≤ 500 (the stored run's schema). */
export const GroupLinkSchema = RunSchema.shape.groupLink.unwrap();

const CreateRunBodySchema = z.object({
    meetings: MeetingsBodySchema,
    capacity: CapacityBodySchema.optional(),
    trainerIds: TrainerIdsSchema,
    language: z.string().min(1).optional(),
    groupLink: GroupLinkSchema.optional(),
}).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-runs-create", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const courseId = pathParam(event, "courseId");
        if (!courseId.ok) return courseId.answer;
        const body = parseBody(event, CreateRunBodySchema);
        if (!body.ok) return body.answer;
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const settings = zonedSettings(read.tenant);
        if (!settings.ok) return settings.answer;

        const store = schedulingStoreFromEnv();
        const course = await getCourse(store, tenantId, courseId.value, true);
        if (course === undefined) return refusal(404, "notFound", "Course not found.");
        const { meetings, capacity, trainerIds, language, groupLink } = body.value;
        if (language !== undefined) {
            const notOffered = languageNotOffered(course, language, "language");
            if (notOffered !== null) return notOffered;
        }
        const trainers = await checkTrainers(store, tenantId, trainerIds);
        if (trainers !== null) return trainers;

        const now = Date.now();
        const created = await createRun(store, {
            tenantId, courseId: course.id, meetings, timezone: settings.value.timezone,
            capacity: capacity ?? course.defaultCapacity, trainerIds,
            language: language === undefined ? { kind: "notSet" } : { kind: "set", tag: language },
            ...(groupLink !== undefined ? { groupLink } : {}), now,
        });
        if (!created.ok) {
            const e = created.error;
            switch (e.kind) {
                case "resourceUnavailable": return refusal(409, "resourceUnavailable", "A trainer does not exist or is being removed.");
                case "notFound": return refusal(404, "notFound", "Course not found."); // deleted after the read above
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
        const run = created.value;
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_SCHEDULING_RUN",
            target: { id: run.id, title: runAuditTitle(course.name, run) },
            details: { ...runAuditDates(run), capacity: run.capacity },
        });
        return answer(201, runAdminDTO(run, now));
    });
