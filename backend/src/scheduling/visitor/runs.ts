/**
 * SCHED-1D2 — GET /scheduling/visitor/courses/{courseId}/runs?language&all (renderer op `runs`;
 * docs/slices/sched-1.md § 10.2, § 5.4) → `ProposalDTO`. Public derived read (§ 16.3 class 1).
 *
 * Reads (display): the course (`COURSE#`, absent → 404 `notFound`) and its runs (AP4). The kernel's `propose` chooses
 * (D6, D7): the partly filled run first, other runs counted; `all=1` → `choose` with every candidate. `language` is the
 * person's language tag (absent = every language). Seats are counts (`seatsLeft`); no trainer, no group link, no
 * booking id (row D9).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { getCourse, listRuns, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { answer, parseValue, pathParam, refusal } from "../common.js";
import { visitorRoute } from "./common.js";
import { proposalDTO } from "./dto.js";

const QuerySchema = z.object({
    language: z.string().min(1).max(35).optional(),
    all: z.enum(["0", "1"]).optional(),
});

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    visitorRoute(event, "runs", { consistent: false }, async ({ tenantId }) => {
        const courseId = pathParam(event, "courseId");
        if (!courseId.ok) return courseId.answer;
        const q = parseValue(event.queryStringParameters ?? {}, QuerySchema);
        if (!q.ok) return q.answer;
        const store = schedulingStoreFromEnv();
        const course = await getCourse(store, tenantId, courseId.value, false);
        if (course === undefined) return refusal(404, "notFound", "Course not found.");
        const runs = await listRuns(store, tenantId, course.id);
        return answer(200, proposalDTO(runs, q.value.language, q.value.all === "1", Date.now()));
    });
