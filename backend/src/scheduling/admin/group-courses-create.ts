/**
 * SCHED-1F1 — POST /scheduling/admin/courses (E+T; docs/slices/sched-1.md § 10.3, § 4.3, § 4.5):
 * `{ name, defaultCapacity, languages }` → 201 `CourseDTO`. Validation: name 1-200 characters (trimmed);
 * `defaultCapacity` 1-45, above 45 → 400 with "A group in this version holds at most 45 people."; `languages` ≤ 10
 * distinct non-empty tags (empty = the booking form does not ask, § 4.3); unknown keys → 400.
 * Before any write: the tenant through `readTenantBeforeWrite` (consistent; a malformed stored scheduling setting or
 * mail configuration → 500 `storedDataInvalid`, nothing written). Course bound (§ 4.5, ruling S1D1-R02): the count is
 * a CONSISTENT read of the course list (`listCourses(…, true)`), so sequential creates are refused above 200 (400
 * `invalid`); two simultaneous creates at 199 can both succeed; no reader breaks above 200.
 * Audit (§ 6.5 point 2): one main-table event right after the write, the admin's email and the course name; no
 * `details`; no `ip`.
 */
import { randomUUID } from "node:crypto";
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { CourseSchema } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { listCourses, putCourse, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, parseBody, refusal } from "../common.js";
import { readTenantBeforeWrite } from "./appt-common.js";
import { CapacityBodySchema } from "./group-common.js";

const MAX_COURSES = 200; // § 4.5

/** The body of POST and PUT (§ 10.3 "same"): the stored `CourseSchema` without `id`, strict. */
export const CourseBodySchema = z.object({
    name: z.string().trim().pipe(CourseSchema.shape.name),
    defaultCapacity: CapacityBodySchema,
    languages: CourseSchema.shape.languages.refine((tags) => new Set(tags).size === tags.length, { message: "Each language once." }),
}).strict();

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-courses-create", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const body = parseBody(event, CourseBodySchema);
        if (!body.ok) return body.answer;
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const store = schedulingStoreFromEnv();
        if ((await listCourses(store, tenantId, true)).length >= MAX_COURSES) {
            return refusal(400, "invalid", `A site can have at most ${MAX_COURSES} courses.`);
        }
        const course = await putCourse(store, tenantId, { id: randomUUID(), ...body.value });
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_SCHEDULING_COURSE",
            target: { id: course.id, title: course.name },
        });
        return answer(201, { id: course.id, name: course.name, defaultCapacity: course.defaultCapacity, languages: course.languages });
    });
