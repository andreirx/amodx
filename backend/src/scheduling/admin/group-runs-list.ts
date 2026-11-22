/**
 * SCHED-1F1 — GET /scheduling/admin/courses/{courseId}/runs (E+T; docs/slices/sched-1.md § 10.3, AP4):
 * `{ runs: RunAdminDTO[] }`, every run of the course (open, closed, cancelled) by first meeting, then id. `taken` =
 * the active seats at the time of the request (held unexpired + confirmed, § 5.4); `overCapacityBy` (§ 13). The seat
 * map never leaves the server: only counts. Unknown course → 404. Display reads (not consistent).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { getCourse, listRuns, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, pathParam, refusal } from "../common.js";
import { runAdminDTO } from "./group-common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-runs-list", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const courseId = pathParam(event, "courseId");
        if (!courseId.ok) return courseId.answer;
        const store = schedulingStoreFromEnv();
        const course = await getCourse(store, tenantId, courseId.value, false);
        if (course === undefined) return refusal(404, "notFound", "Course not found.");
        const now = Date.now();
        const runs = (await listRuns(store, tenantId, course.id, false))
            .sort((a, b) => a.firstStartIso.localeCompare(b.firstStartIso) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return answer(200, { runs: runs.map((r) => runAdminDTO(r, now)) });
    });
