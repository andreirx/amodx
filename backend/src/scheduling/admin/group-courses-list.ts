/**
 * SCHED-1F1 — GET /scheduling/admin/courses (E+T; docs/slices/sched-1.md § 10.3): `{ courses: CourseDTO[] }`, the whole
 * list (≤ 200, § 4.5), sorted by name. `CourseDTO = { id, name, defaultCapacity, languages }` (the stored `Course`).
 * A display read (not consistent).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { listCourses, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer } from "../common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-courses-list", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const courses = await listCourses(schedulingStoreFromEnv(), tenantId, false);
        courses.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        return answer(200, {
            courses: courses.map((c) => ({ id: c.id, name: c.name, defaultCapacity: c.defaultCapacity, languages: c.languages })),
        });
    });
