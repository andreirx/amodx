/**
 * SCHED-1D1 — DELETE /scheduling/admin/resources/{resourceId} (E+T; docs/slices/sched-1.md § 10.3, § 13): the three
 * steps of `removeResource` (fence, consistent check, release or delete with `AVAILABILITY#` and `DAYS#`).
 * 204; 404 `notFound`; 409 `resourceInUse { activeBookings }`; 409 `resourceRemovalInProgress`; 503 `busy`.
 * Audit (§ 6.5 point 2) on a completed removal only: the resource name; no `ip`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { getResource, removeResource, schedulingStoreFromEnv, type RemoveResourceRefusal } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, refusal, type Answer, pathParam } from "../common.js";

function refusalAnswer(r: RemoveResourceRefusal): Answer {
    switch (r.kind) {
        case "notFound": return refusal(404, "notFound", "Resource not found.");
        case "resourceInUse":
            return refusal(409, "resourceInUse", "The resource has future bookings.", { activeBookings: r.activeBookings });
        case "resourceRemovalInProgress": return refusal(409, "resourceRemovalInProgress", "Another removal of this resource is in progress.");
        case "busy": return refusal(503, "busy", "Busy, please try again.");
        default: {
            const never: never = r;
            throw new Error(`Unhandled refusal ${JSON.stringify(never)}`);
        }
    }
}

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "resources-delete", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const id = pathParam(event, "resourceId");
        if (!id.ok) return id.answer;
        const store = schedulingStoreFromEnv();
        const resource = await getResource(store, tenantId, id.value, true);
        if (resource === undefined) return refusal(404, "notFound", "Resource not found.");
        const removed = await removeResource(store, tenantId, id.value, Date.now());
        if (!removed.ok) return refusalAnswer(removed.error);
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "DELETE_SCHEDULING_RESOURCE",
            target: { id: id.value, title: resource.name },
        });
        return answer(204);
    });
