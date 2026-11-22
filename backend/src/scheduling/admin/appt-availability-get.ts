/**
 * SCHED-1E1 — GET /scheduling/admin/resources/{resourceId}/availability (E+T; docs/slices/sched-1.md § 10.3, D16):
 * `{ rules: AvailabilityRule[] }`, the defaults of one resource (no item = `[]`). Unknown resource (or one of another
 * tenant: every key is under the tenant's partition) → 404. Display reads (not consistent).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { getAvailability, getResource, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, pathParam, refusal } from "../common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-availability-get", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const id = pathParam(event, "resourceId");
        if (!id.ok) return id.answer;
        const store = schedulingStoreFromEnv();
        if ((await getResource(store, tenantId, id.value, false)) === undefined) return refusal(404, "notFound", "Resource not found.");
        return answer(200, { rules: await getAvailability(store, tenantId, id.value, false) });
    });
