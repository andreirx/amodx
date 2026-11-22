/**
 * SCHED-1F1 — GET /scheduling/admin/courses/{courseId}/unplaced?cursor (E+T; docs/slices/sched-1.md § 10.3, AP8):
 * `{ people: RosterRow[]; cursor?: string }`, 100 `UNPLACED#` keys per page (§ 6.4 rule 1 exception), in key order
 * (booking id order); `cursor` = the opaque next-page token, absent on the last page. A cursor that is not this
 * tenant's and course's → 400 `invalid`. Unknown course → 404.
 * Per page ONE BatchGet of the `BOOKING#` items with the roster projection (§ 6.4 rule 2: still unprocessed → 503
 * `busy`, never a partial page). An id that the BatchGet does not return (erased) or whose booking is not active is
 * skipped, so a page can hold fewer than 100 rows while `cursor` is present.
 * Customer data: this answer goes only to the roles § 10.3 names; nothing of it is logged. Display reads.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { getBookingViews, getCourse, listUnplacedPage, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, pathParam, refusal } from "../common.js";
import { rosterRow, type RosterRow } from "./group-common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "group-unplaced", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const courseId = pathParam(event, "courseId");
        if (!courseId.ok) return courseId.answer;
        const cursor = event.queryStringParameters?.cursor;
        const store = schedulingStoreFromEnv();
        const course = await getCourse(store, tenantId, courseId.value, false);
        if (course === undefined) return refusal(404, "notFound", "Course not found.");
        const page = await listUnplacedPage(store, tenantId, course.id, cursor === undefined || cursor === "" ? undefined : cursor);
        if (!page.ok) {
            return refusal(400, "invalid", "The request is not valid.", { issues: [{ path: "cursor", message: "Unknown cursor." }] });
        }
        const views = await getBookingViews(store, tenantId, page.value.bookingIds, "roster");
        if (!views.ok) return refusal(503, "busy", "Busy, please try again.");
        const now = Date.now();
        const byId = new Map(views.value.map((v) => [v.id, v]));
        const people: RosterRow[] = [];
        for (const id of page.value.bookingIds) {
            const v = byId.get(id);
            const row = v === undefined ? undefined : rosterRow(v, now);
            if (row !== undefined) people.push(row);
        }
        return answer(200, { people, ...(page.value.cursor !== undefined ? { cursor: page.value.cursor } : {}) });
    });
