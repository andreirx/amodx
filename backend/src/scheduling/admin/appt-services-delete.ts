/**
 * SCHED-1E1 — DELETE /scheduling/admin/services/{serviceId} (E+T; docs/slices/sched-1.md § 10.3, § 13) → 204.
 * Before any write the tenant is read through `readTenantBeforeWrite` (a malformed stored setting → 500
 * `storedDataInvalid`, nothing deleted; review S1E1-R01). Unknown service → 404 (a consistent read: it decides whether
 * the delete runs and gives the audit title). § 13:
 * bookings keep `serviceId` and `serviceName`; the service leaves `offer` at once; an admin move of such a booking keeps
 * its stored duration (`moveSlot`).
 * Audit (§ 6.5 point 2): the service name as `target.title`; no `details`; no `ip`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { deleteService, getService, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, pathParam, refusal } from "../common.js";
import { readTenantBeforeWrite } from "./appt-common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-services-delete", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const id = pathParam(event, "serviceId");
        if (!id.ok) return id.answer;
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const store = schedulingStoreFromEnv();
        const service = await getService(store, tenantId, id.value, true);
        if (service === undefined) return refusal(404, "notFound", "Service not found.");
        await deleteService(store, tenantId, id.value);
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "DELETE_SCHEDULING_SERVICE",
            target: { id: service.id, title: service.name },
        });
        return answer(204);
    });
