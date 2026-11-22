/**
 * SCHED-1F1 — GET /scheduling/admin/courses/{courseId}/runs/{runId}/roster (E+T; docs/slices/sched-1.md § 10.3, AP7):
 * `{ run: RunAdminDTO; people: RosterRow[] }`.
 *
 * AP7: the run (display read), then ONE BatchGet of the `BOOKING#` items of its seat map with the roster projection
 * (`id, ref, who, state, source`; § 6.4 rule 2: unprocessed keys retried, still unprocessed → 503 `busy`, never a
 * partial list). `people` = exactly the active seats (row F2): an entry held and expired at the time of the request is
 * left out, and a booking whose own state is not active (cancelled, or held and expired) is left out; an id that the
 * BatchGet does not return (erased) is skipped. Order: name, then ref.
 * Customer data (name, email, phone, language): this answer goes only to the roles § 10.3 names (E+T, and
 * GLOBAL_ADMIN by policy); nothing of it is logged. The CSV export of the admin page (`sched-1f2`) is built from this
 * JSON (§ 10.3: no route).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { getBookingViews, getRun, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, pathParam, refusal } from "../common.js";
import { rosterRow, runAdminDTO, type RosterRow } from "./group-common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-roster", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const courseId = pathParam(event, "courseId");
        if (!courseId.ok) return courseId.answer;
        const runId = pathParam(event, "runId");
        if (!runId.ok) return runId.answer;
        const store = schedulingStoreFromEnv();
        const run = await getRun(store, tenantId, courseId.value, runId.value, false);
        if (run === undefined) return refusal(404, "notFound", "Group not found.");
        const now = Date.now();
        const ids = Object.entries(run.seats).filter(([, s]) => s.x === undefined || now < s.x).map(([id]) => id);
        const views = await getBookingViews(store, tenantId, ids, "roster");
        if (!views.ok) return refusal(503, "busy", "Busy, please try again.");
        const people = views.value.map((v) => rosterRow(v, now)).filter((r): r is RosterRow => r !== undefined)
            .sort((a, b) => a.name.localeCompare(b.name) || a.ref.localeCompare(b.ref));
        return answer(200, { run: runAdminDTO(run, now), people });
    });
