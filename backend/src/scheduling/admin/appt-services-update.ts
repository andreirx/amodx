/**
 * SCHED-1E1 — PUT /scheduling/admin/services/{serviceId} (E+T; docs/slices/sched-1.md § 10.3, § 13): the body of the
 * create → `ServiceDTO`. Before any write: the tenant through `readTenantBeforeWrite` (a malformed stored setting →
 * 500 `storedDataInvalid`; review S1E1-R01); listed resources must exist (as the create). The write is
 * `replaceService`: one Put under `attribute_exists(SK)`, so an unknown service — or one deleted after this request
 * started — answers 404 and is never re-created (review S1E1-R03). § 13: bookings keep their stored start, end and
 * `serviceName` — the service item is the only item written; new slots use the new duration.
 * Audit (§ 6.5 point 2): the new name as `target.title`; no `details`; no `ip`.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { replaceService, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer, parseBody, pathParam, refusal } from "../common.js";
import { ServiceBodySchema, unknownResources } from "./appt-services-create.js";
import { readTenantBeforeWrite } from "./appt-common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-services-update", EDITOR_OR_ADMIN, async ({ tenantId, auth }) => {
        const id = pathParam(event, "serviceId");
        if (!id.ok) return id.answer;
        const body = parseBody(event, ServiceBodySchema);
        if (!body.ok) return body.answer;
        const read = await readTenantBeforeWrite(tenantId);
        if (!read.ok) return read.answer;
        const store = schedulingStoreFromEnv();
        const unknown = await unknownResources(store, tenantId, body.value.eligibility);
        if (unknown !== null) return unknown;
        const replaced = await replaceService(store, tenantId, { id: id.value, ...body.value });
        if (!replaced.ok) return refusal(404, "notFound", "Service not found.");
        const service = replaced.value;
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_SCHEDULING_SERVICE",
            target: { id: service.id, title: service.name },
        });
        return answer(200, { id: service.id, name: service.name, durationMin: service.durationMin, eligibility: service.eligibility });
    });
