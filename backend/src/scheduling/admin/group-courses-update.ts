/**
 * SCHED-1F1 — PUT /scheduling/admin/courses/{courseId} (E+T; docs/slices/sched-1.md § 10.3, § 4.3, § 13): the body of
 * the create → `CourseDTO`.
 * Before any write: the tenant through `readTenantBeforeWrite` (a malformed stored setting → 500 `storedDataInvalid`);
 * the course, CONSISTENT (404; its stored language list); the course's runs, CONSISTENT (`listRuns(…, true)`: they
 * decide whether the write runs). § 10.3 "removing a language a run uses → 409": the REMOVED tags are those of the
 * stored list that the new list leaves out; any run — open, closed or cancelled (§ 10.3 excepts none; review
 * S1F1-R06) — whose language is set to a removed tag → 409 `languageInUse` with those tags. A run tag that is not in
 * the stored list is not being removed by this update, so it never refuses it (ruling S1F1-LANGUAGE-CONSIST below:
 * such a run is valid stored data; a guard over every run tag would refuse even a rename of the course).
 * The write is `replaceCourse`: one UpdateItem of name, default capacity and languages under `attribute_exists(SK)`, so
 * an unknown course — or one deleted after this request started — answers 404 and is never re-created. Runs keep
 * their own capacity (§ 13: `defaultCapacity` is only the default of a new run).
 * Limit (operator ruling S1F1-LANGUAGE-CONSIST, amends § 4.3: a run's language is one of its course's languages AT
 * THE TIME IT IS SET): the `languageInUse` refusal is a sequential guard. A writer that sets a run language at the same
 * moment — a run create, a run update, or a visitor's first booking that sets a `notSet` run — can commit between the
 * run read and this write; the update then succeeds and leaves
 * a run whose language is no longer in its course's list. That state is VALID stored data: the course list is what
 * new runs and new first bookings may choose from, and no reader, schema or writer refuses or fails on such a run
 * (it is read, shown, booked and moved normally; test "S1F1-LANGUAGE-CONSIST" in scheduling-group.test.ts).
 * Audit (§ 6.5 point 2): the new name as `target.title`; no `details`; no `ip`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { getCourse, listRuns, replaceCourse, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, parseBody, pathParam, refusal } from "../common.js";
import { readTenantBeforeWrite } from "./appt-common.js";
import { CourseBodySchema } from "./group-courses-create.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-courses-update", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const id = pathParam(event, "courseId");
        if (!id.ok) return id.answer;
        const body = parseBody(event, CourseBodySchema);
        if (!body.ok) return body.answer;
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const store = schedulingStoreFromEnv();
        const stored = await getCourse(store, tenantId, id.value, true);
        if (stored === undefined) return refusal(404, "notFound", "Course not found.");
        const removed = new Set(stored.languages.filter((tag) => !body.value.languages.includes(tag)));
        const inUse = new Set<string>();
        for (const run of await listRuns(store, tenantId, id.value, true)) {
            switch (run.language.kind) {
                case "notSet": break;
                case "set": if (removed.has(run.language.tag)) inUse.add(run.language.tag); break;
                default: {
                    const never: never = run.language;
                    throw new Error(`Unhandled language ${JSON.stringify(never)}`);
                }
            }
        }
        if (inUse.size > 0) {
            return refusal(409, "languageInUse", "A group of this course uses a language the new list removes.", { languages: [...inUse].sort() });
        }
        const replaced = await replaceCourse(store, tenantId, { id: id.value, ...body.value });
        if (!replaced.ok) return refusal(404, "notFound", "Course not found.");
        const course = replaced.value;
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_SCHEDULING_COURSE",
            target: { id: course.id, title: course.name },
        });
        return answer(200, { id: course.id, name: course.name, defaultCapacity: course.defaultCapacity, languages: course.languages });
    });
